import { Inject, Injectable, Logger } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { PaymentError } from '../../../../shared/domain/domain-error'
import { Events, type OrderPlacedEvent } from '../../../../shared/events'
import type { DeliveryMode, OrderType } from '../../../../shared/domain/types'
import { MENU_READER, type MenuReader } from '../../../menu/application/menu-reader.port'
import {
  type OnlinePaymentMethod,
  PAYMENT_INITIATOR,
  type PaymentInitiation,
  type PaymentInitiator,
} from '../../../payments/application/payment-initiator.port'
import { Order, type RequestedItem } from '../../domain/order.entity'
import { ORDER_REPOSITORY, type OrderRepository } from '../ports/order.repository'

export interface PlaceOrderCommand {
  customerId: string
  customerEmail?: string
  type: Extract<OrderType, 'DELIVERY' | 'PICKUP'>
  items: RequestedItem[]
  contactName?: string
  contactPhone: string
  delivery?: { mode: DeliveryMode; street: string; city: string; distanceKm?: number }
  instructions?: string
  tastePreferences?: string
  paymentMethod: OnlinePaymentMethod
  orangeMoneyPhone?: string
}

export interface PlaceOrderResult {
  orderId: string
  number: number
  total: number
  payment: PaymentInitiation
}

@Injectable()
export class PlaceOrderUseCase {
  private readonly logger = new Logger(PlaceOrderUseCase.name)

  constructor(
    @Inject(ORDER_REPOSITORY) private readonly orders: OrderRepository,
    @Inject(MENU_READER) private readonly menu: MenuReader,
    @Inject(PAYMENT_INITIATOR) private readonly payments: PaymentInitiator,
    private readonly events: EventEmitter2,
  ) {}

  async execute(cmd: PlaceOrderCommand): Promise<PlaceOrderResult> {
    const dishes = await this.menu.findByIds(cmd.items.map((i) => i.dishId))
    const order = Order.place({
      customerId: cmd.customerId,
      type: cmd.type,
      items: cmd.items,
      dishes,
      contactName: cmd.contactName,
      contactPhone: cmd.contactPhone,
      delivery: cmd.delivery,
      instructions: cmd.instructions,
      tastePreferences: cmd.tastePreferences,
    })
    await this.orders.create(order)

    const s = order.snapshot()
    this.events.emit(Events.OrderPlaced, {
      orderId: order.id,
      number: order.number,
      userId: cmd.customerId,
      type: order.type,
      total: order.total,
      delivery:
        s.deliveryMode && s.deliveryStreet && s.deliveryCity
          ? {
              mode: s.deliveryMode,
              street: s.deliveryStreet,
              city: s.deliveryCity,
              fee: s.deliveryFee,
              distanceKm: cmd.delivery?.distanceKm,
            }
          : undefined,
    } satisfies OrderPlacedEvent)

    let payment: PaymentInitiation
    try {
      payment = await this.payments.initiate({
        orderId: order.id,
        orderNumber: order.number,
        amount: order.total,
        method: cmd.paymentMethod,
        payerPhone: cmd.orangeMoneyPhone ?? cmd.contactPhone,
        customerEmail: cmd.customerEmail,
      })
    } catch (error) {
      // Paiement impossible à initier : la commande est annulée et le stock libéré.
      this.logger.warn(`Paiement non initié pour la commande ${order.number} : ${String(error)}`)
      order.cancel()
      await this.orders.saveStatus(order, 'PENDING_PAYMENT')
      throw error instanceof PaymentError ? error : new PaymentError('Le paiement n’a pas pu être initié')
    }

    return { orderId: order.id, number: order.number, total: order.total, payment }
  }
}
