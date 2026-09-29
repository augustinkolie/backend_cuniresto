import { Injectable, Logger } from '@nestjs/common'
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter'
import type { DeliveryStatus, Prisma } from '@prisma/client'
import { PrismaService } from '../../../infrastructure/prisma/prisma.service'
import { RealtimeGateway } from '../../../infrastructure/realtime/realtime.gateway'
import { type AuthUser, isManager } from '../../../shared/auth/auth-user'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../../shared/domain/domain-error'
import { deliveryMinutes } from '../../../shared/domain/delivery-pricing'
import {
  type DeliveryStatusChangedEvent,
  Events,
  type OrderPlacedEvent,
  type OrderStatusChangedEvent,
} from '../../../shared/events'
import { ChangeOrderStatusUseCase } from '../../orders/application/use-cases/change-order-status.use-case'
import {
  ACTIVE_DELIVERY_STATUSES,
  canMoveDelivery,
  DELIVERY_MESSAGES,
  DRIVER_STATUSES,
  deliveryStatusFor,
  orderStatusFor,
} from '../domain/delivery-status'

const deliveryInclude = {
  order: {
    select: {
      id: true,
      number: true,
      status: true,
      total: true,
      contactName: true,
      contactPhone: true,
      instructions: true,
      userId: true,
      items: { select: { nameSnapshot: true, quantity: true } },
    },
  },
  driver: { select: { id: true, firstName: true, lastName: true, phone: true } },
  events: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.DeliveryInclude

@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly events: EventEmitter2,
    private readonly orderStatus: ChangeOrderStatusUseCase,
  ) {}

  // ───────── Réactions aux commandes

  @OnEvent(Events.OrderPlaced, { async: true })
  async onOrderPlaced(e: OrderPlacedEvent): Promise<void> {
    if (!e.delivery) return
    try {
      await this.prisma.delivery.create({
        data: {
          orderId: e.orderId,
          mode: e.delivery.mode,
          fee: e.delivery.fee,
          street: e.delivery.street,
          city: e.delivery.city,
          estimatedMinutes: deliveryMinutes(e.delivery.mode, e.delivery.distanceKm),
          events: { create: { status: 'PENDING', message: DELIVERY_MESSAGES.PENDING } },
        },
      })
    } catch (error) {
      this.logger.error(`Création de la livraison impossible (commande ${e.number})`, error as Error)
    }
  }

  @OnEvent(Events.OrderStatusChanged, { async: true })
  async onOrderStatusChanged(e: OrderStatusChangedEvent): Promise<void> {
    const target = deliveryStatusFor(e.to)
    if (!target || e.type !== 'DELIVERY') return
    try {
      const delivery = await this.prisma.delivery.findUnique({ where: { orderId: e.orderId } })
      // Une livraison déjà assignée garde son statut : le livreur voit l'avancement de la cuisine.
      if (!delivery || delivery.status === target) return
      if (delivery.status === 'ASSIGNED' && target !== 'CANCELLED') return
      if (!canMoveDelivery(delivery.status, target)) return
      await this.apply(delivery.id, target, DELIVERY_MESSAGES[target])
    } catch (error) {
      this.logger.error('Synchronisation de la livraison impossible', error as Error)
    }
  }

  // ───────── Lecture

  async forOrder(orderId: string, user: AuthUser) {
    const delivery = await this.prisma.delivery.findUnique({ where: { orderId }, include: deliveryInclude })
    if (!delivery) throw new NotFoundError('Livraison')
    this.assertCanView(delivery.order.userId, delivery.driverId, user)
    return delivery
  }

  list(status?: DeliveryStatus) {
    return this.prisma.delivery.findMany({
      where: status ? { status } : { status: { notIn: ['DELIVERED', 'CANCELLED'] } },
      include: deliveryInclude,
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
  }

  forDriver(driverId: string) {
    return this.prisma.delivery.findMany({
      where: { driverId, status: { in: ACTIVE_DELIVERY_STATUSES } },
      include: deliveryInclude,
      orderBy: { createdAt: 'asc' },
    })
  }

  // ───────── Actions

  async assign(
    id: string,
    input: { driverId?: string; driverName?: string; driverPhone?: string; driverVehicle?: string },
  ) {
    const delivery = await this.find(id)
    if (!canMoveDelivery(delivery.status, 'ASSIGNED')) {
      throw new ConflictError('Cette livraison ne peut plus être réassignée')
    }
    let driver: { firstName: string; lastName: string; phone: string | null } | null = null
    if (input.driverId) {
      driver = await this.prisma.user.findFirst({
        where: { id: input.driverId, role: 'DRIVER', isActive: true },
        select: { firstName: true, lastName: true, phone: true },
      })
      if (!driver) throw new ValidationError('Livreur introuvable')
    }
    const name = driver ? `${driver.firstName} ${driver.lastName}` : input.driverName
    if (!name) throw new ValidationError('Livreur requis')

    await this.prisma.delivery.update({
      where: { id },
      data: {
        driverId: input.driverId ?? null,
        driverName: name,
        driverPhone: input.driverPhone ?? driver?.phone ?? null,
        driverVehicle: input.driverVehicle ?? null,
      },
    })
    await this.apply(id, 'ASSIGNED', `${DELIVERY_MESSAGES.ASSIGNED} : ${name}`)
    if (input.driverId) this.realtime.toUser(input.driverId, 'delivery:assigned', { deliveryId: id })
    return this.prisma.delivery.findUniqueOrThrow({ where: { id }, include: deliveryInclude })
  }

  async driverUpdate(id: string, user: AuthUser, status: DeliveryStatus, message?: string) {
    const delivery = await this.find(id)
    const isOwnDriver = user.role === 'DRIVER' && delivery.driverId === user.id
    if (!isOwnDriver && !isManager(user)) throw new ForbiddenError('Livraison non assignée à vous')
    if (!DRIVER_STATUSES.includes(status)) throw new ValidationError('Statut réservé à la cuisine')
    if (!canMoveDelivery(delivery.status, status)) {
      throw new ConflictError(`Passage ${delivery.status} → ${status} impossible`)
    }

    const orderTarget = orderStatusFor(status)
    if (orderTarget) {
      await this.orderStatus.execute(delivery.orderId, orderTarget, { kind: 'system' })
    }
    await this.apply(id, status, message?.trim() || DELIVERY_MESSAGES[status])
  }

  async updateLocation(id: string, user: AuthUser, loc: { lat: number; lng: number; address?: string }) {
    const delivery = await this.find(id)
    if (!(user.role === 'DRIVER' && delivery.driverId === user.id) && !isManager(user)) {
      throw new ForbiddenError('Livraison non assignée à vous')
    }
    const event = await this.prisma.deliveryEvent.create({
      data: {
        deliveryId: id,
        status: delivery.status,
        message: 'Position mise à jour',
        lat: loc.lat,
        lng: loc.lng,
        address: loc.address,
      },
    })
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: delivery.orderId },
      select: { userId: true },
    })
    if (order.userId) this.realtime.toUser(order.userId, 'delivery:location', { deliveryId: id, ...loc, at: event.createdAt })
  }

  private async apply(id: string, status: DeliveryStatus, message: string): Promise<void> {
    const now = new Date()
    const delivery = await this.prisma.delivery.update({
      where: { id },
      data: {
        status,
        ...(status === 'PICKED_UP' ? { pickedUpAt: now } : {}),
        events: { create: { status, message } },
      },
      include: { order: { select: { number: true, userId: true } } },
    })
    if (status === 'DELIVERED') {
      await this.prisma.delivery.update({
        where: { id },
        data: {
          deliveredAt: now,
          actualMinutes: delivery.pickedUpAt
            ? Math.round((now.getTime() - delivery.pickedUpAt.getTime()) / 60_000)
            : null,
        },
      })
    }

    const event: DeliveryStatusChangedEvent = {
      deliveryId: id,
      orderId: delivery.orderId,
      orderNumber: delivery.order.number,
      userId: delivery.order.userId,
      status,
      message,
    }
    this.events.emit(Events.DeliveryStatusChanged, event)
    this.realtime.toStaff('delivery:updated', event)
    if (delivery.order.userId) this.realtime.toUser(delivery.order.userId, 'delivery:updated', event)
  }

  private async find(id: string) {
    const delivery = await this.prisma.delivery.findUnique({ where: { id } })
    if (!delivery) throw new NotFoundError('Livraison')
    return delivery
  }

  private assertCanView(customerId: string | null, driverId: string | null, user: AuthUser): void {
    if (customerId === user.id || driverId === user.id || isManager(user)) return
    if (user.role === 'KITCHEN' || user.role === 'WAITER') return
    throw new ForbiddenError('Accès refusé')
  }
}
