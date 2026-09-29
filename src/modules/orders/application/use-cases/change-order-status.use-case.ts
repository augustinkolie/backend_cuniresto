import { Inject, Injectable } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { ForbiddenError, NotFoundError } from '../../../../shared/domain/domain-error'
import { Events, type OrderStatusChangedEvent } from '../../../../shared/events'
import type { OrderStatus } from '../../../../shared/domain/types'
import { KITCHEN_STATUSES } from '../../domain/order-status'
import { ORDER_REPOSITORY, type OrderRepository } from '../ports/order.repository'
import { TABLE_LOOKUP, type TableLookup } from '../ports/table-lookup'

export type Actor =
  | { kind: 'system' }
  | { kind: 'user'; id: string; role: 'CUSTOMER' | 'ADMIN' | 'MANAGER' | 'KITCHEN' | 'WAITER' | 'DRIVER' }

@Injectable()
export class ChangeOrderStatusUseCase {
  constructor(
    @Inject(ORDER_REPOSITORY) private readonly orders: OrderRepository,
    @Inject(TABLE_LOOKUP) private readonly tables: TableLookup,
    private readonly events: EventEmitter2,
  ) {}

  async execute(orderId: string, to: OrderStatus, actor: Actor): Promise<void> {
    const order = await this.orders.findById(orderId)
    if (!order) throw new NotFoundError('Commande')
    this.authorize(order.customerId, order.status, to, actor)

    const previous = order.status
    order.transitionTo(to)
    await this.orders.saveStatus(order, previous)

    const tableQrToken = await this.tables.qrTokenForOrder(order.id)
    for (const change of order.pullChanges()) {
      this.events.emit(Events.OrderStatusChanged, {
        orderId: order.id,
        number: order.number,
        userId: order.customerId,
        tableQrToken,
        type: order.type,
        from: change.from,
        to: change.to,
        total: order.total,
      } satisfies OrderStatusChangedEvent)
    }
  }

  private authorize(customerId: string | null, from: OrderStatus, to: OrderStatus, actor: Actor): void {
    if (actor.kind === 'system') return
    switch (actor.role) {
      case 'ADMIN':
      case 'MANAGER':
        return
      case 'KITCHEN':
        if (KITCHEN_STATUSES.includes(to)) return
        break
      case 'WAITER':
        if (['SERVED', 'COMPLETED', 'READY'].includes(to)) return
        break
      case 'DRIVER':
        if (['OUT_FOR_DELIVERY', 'DELIVERED'].includes(to)) return
        break
      case 'CUSTOMER':
        // Le client peut abandonner une commande tant qu'elle n'est pas payée.
        if (actor.id === customerId && from === 'PENDING_PAYMENT' && to === 'CANCELLED') return
        break
    }
    throw new ForbiddenError('Vous ne pouvez pas appliquer ce statut')
  }
}
