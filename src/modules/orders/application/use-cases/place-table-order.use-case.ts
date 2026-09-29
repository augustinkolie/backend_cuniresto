import { Inject, Injectable } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { Events, type OrderPlacedEvent } from '../../../../shared/events'
import { MENU_READER, type MenuReader } from '../../../menu/application/menu-reader.port'
import { PAYMENT_INITIATOR, type PaymentInitiator } from '../../../payments/application/payment-initiator.port'
import { Order, type RequestedItem } from '../../domain/order.entity'
import { ORDER_REPOSITORY, type OrderRepository } from '../ports/order.repository'

export interface PlaceTableOrderCommand {
  tableId: string
  customerId: string | null
  items: RequestedItem[]
  customerName?: string
  customerPhone?: string
  specialRequests?: string
}

/** Commande passée depuis le QR code d'une table : payée sur place, envoyée en cuisine. */
@Injectable()
export class PlaceTableOrderUseCase {
  constructor(
    @Inject(ORDER_REPOSITORY) private readonly orders: OrderRepository,
    @Inject(MENU_READER) private readonly menu: MenuReader,
    @Inject(PAYMENT_INITIATOR) private readonly payments: PaymentInitiator,
    private readonly events: EventEmitter2,
  ) {}

  async execute(cmd: PlaceTableOrderCommand) {
    const dishes = await this.menu.findByIds(cmd.items.map((i) => i.dishId))
    const order = Order.place({
      customerId: cmd.customerId,
      type: 'DINE_IN',
      items: cmd.items,
      dishes,
      tableId: cmd.tableId,
      contactName: cmd.customerName,
      contactPhone: cmd.customerPhone,
      instructions: cmd.specialRequests,
    })
    await this.orders.create(order)
    await this.payments.initiate({
      orderId: order.id,
      orderNumber: order.number,
      amount: order.total,
      method: 'ON_SITE',
    })

    this.events.emit(Events.OrderPlaced, {
      orderId: order.id,
      number: order.number,
      userId: cmd.customerId,
      type: order.type,
      total: order.total,
    } satisfies OrderPlacedEvent)

    return { orderId: order.id, number: order.number, total: order.total }
  }
}
