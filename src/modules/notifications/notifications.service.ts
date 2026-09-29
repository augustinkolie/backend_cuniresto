import { Injectable, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import type { NotificationType } from '@prisma/client'
import { MailService } from '../../infrastructure/mail/mail.service'
import { mailTemplates } from '../../infrastructure/mail/mail-templates'
import { PrismaService } from '../../infrastructure/prisma/prisma.service'
import { RealtimeGateway } from '../../infrastructure/realtime/realtime.gateway'
import { NotFoundError } from '../../shared/domain/domain-error'
import {
  type DeliveryStatusChangedEvent,
  Events,
  type OrderStatusChangedEvent,
} from '../../shared/events'

export interface NotifyInput {
  type: NotificationType
  content: string
  link: string
  senderId?: string | null
}

const ORDER_MESSAGES: Partial<Record<OrderStatusChangedEvent['to'], string>> = {
  CONFIRMED: 'Paiement reçu : votre commande est confirmée',
  PREPARING: 'Votre commande est en préparation',
  READY: 'Votre commande est prête',
  COMPLETED: 'Commande terminée. Merci et à bientôt !',
  CANCELLED: 'Votre commande a été annulée',
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly mail: MailService,
  ) {}

  async notify(recipientId: string, input: NotifyInput): Promise<void> {
    if (input.senderId && input.senderId === recipientId) return
    const notification = await this.prisma.notification.create({
      data: { recipientId, ...input },
      include: { sender: { select: { firstName: true, lastName: true, avatarUrl: true } } },
    })
    this.realtime.toUser(recipientId, 'notification:new', notification)
  }

  async list(userId: string) {
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where: { recipientId: userId },
        include: { sender: { select: { firstName: true, lastName: true, avatarUrl: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.notification.count({ where: { recipientId: userId, readAt: null } }),
    ])
    return { items, unread }
  }

  async markRead(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.notification.updateMany({
      where: { id, recipientId: userId, readAt: null },
      data: { readAt: new Date() },
    })
    if (count === 0) {
      const exists = await this.prisma.notification.count({ where: { id, recipientId: userId } })
      if (!exists) throw new NotFoundError('Notification')
    }
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { recipientId: userId, readAt: null },
      data: { readAt: new Date() },
    })
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.prisma.notification.deleteMany({ where: { id, recipientId: userId } })
  }

  // ───────── Suivi des commandes et livraisons

  @OnEvent(Events.OrderStatusChanged, { async: true })
  async onOrderStatus(e: OrderStatusChangedEvent): Promise<void> {
    const message = ORDER_MESSAGES[e.to]
    if (!e.userId || !message) return
    // Pour une livraison, « prête » est relayé par le suivi de livraison.
    if (e.type === 'DELIVERY' && e.to === 'READY') return
    try {
      await this.notify(e.userId, {
        type: 'ORDER',
        content: `Commande n° ${e.number} : ${message}`,
        link: `/commande/${e.orderId}`,
      })
      if (e.to === 'CONFIRMED') await this.sendReceipt(e.orderId)
    } catch (error) {
      this.logger.error('Notification de commande impossible', error as Error)
    }
  }

  @OnEvent(Events.DeliveryStatusChanged, { async: true })
  async onDeliveryStatus(e: DeliveryStatusChangedEvent): Promise<void> {
    if (!e.userId || e.status === 'PENDING' || e.status === 'PREPARING') return
    try {
      await this.notify(e.userId, {
        type: 'ORDER',
        content: `Commande n° ${e.orderNumber} : ${e.message}`,
        link: `/commande/${e.orderId}`,
      })
    } catch (error) {
      this.logger.error('Notification de livraison impossible', error as Error)
    }
  }

  private async sendReceipt(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, user: { select: { email: true, firstName: true } } },
    })
    if (!order?.user) return
    await this.mail.send({
      to: order.user.email,
      ...mailTemplates.orderReceipt({
        firstName: order.user.firstName,
        number: order.number,
        items: order.items.map((i) => ({ name: i.nameSnapshot, quantity: i.quantity, unitPrice: i.unitPrice })),
        deliveryFee: order.deliveryFee,
        total: order.total,
      }),
    })
  }
}
