import { Injectable, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { RealtimeGateway, rooms } from '../../../infrastructure/realtime/realtime.gateway'
import { ConflictError } from '../../../shared/domain/domain-error'
import {
  Events,
  type OrderPlacedEvent,
  type OrderStatusChangedEvent,
  type PaymentFailedEvent,
  type PaymentSucceededEvent,
} from '../../../shared/events'
import { ChangeOrderStatusUseCase } from './use-cases/change-order-status.use-case'

@Injectable()
export class OrderEventHandlers {
  private readonly logger = new Logger(OrderEventHandlers.name)

  constructor(
    private readonly changeStatus: ChangeOrderStatusUseCase,
    private readonly realtime: RealtimeGateway,
  ) {}

  @OnEvent(Events.PaymentSucceeded, { async: true, promisify: true })
  async onPaymentSucceeded(e: PaymentSucceededEvent): Promise<void> {
    await this.safely(() => this.changeStatus.execute(e.orderId, 'CONFIRMED', { kind: 'system' }))
  }

  @OnEvent(Events.PaymentFailed, { async: true, promisify: true })
  async onPaymentFailed(e: PaymentFailedEvent): Promise<void> {
    await this.safely(() => this.changeStatus.execute(e.orderId, 'CANCELLED', { kind: 'system' }))
  }

  @OnEvent(Events.OrderPlaced)
  onPlaced(e: OrderPlacedEvent): void {
    this.realtime.toStaff('order:placed', e)
  }

  @OnEvent(Events.OrderStatusChanged)
  onStatusChanged(e: OrderStatusChangedEvent): void {
    const payload = { orderId: e.orderId, number: e.number, status: e.to }
    this.realtime.toStaff('order:updated', payload)
    if (e.userId) this.realtime.toUser(e.userId, 'order:updated', payload)
    if (e.tableQrToken) this.realtime.toRoom(rooms.table(e.tableQrToken), 'order:updated', payload)
  }

  /** Un webhook rejoué ne doit pas faire échouer le traitement : la transition est ignorée. */
  private async safely(action: () => Promise<void>): Promise<void> {
    try {
      await action()
    } catch (e) {
      if (e instanceof ConflictError) this.logger.debug(e.message)
      else throw e
    }
  }
}
