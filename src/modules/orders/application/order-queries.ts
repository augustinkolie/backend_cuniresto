import { Injectable } from '@nestjs/common'
import type { OrderStatus, OrderType, Prisma } from '@prisma/client'
import { PrismaService } from '../../../infrastructure/prisma/prisma.service'
import { type AuthUser, isStaff } from '../../../shared/auth/auth-user'
import { ForbiddenError, NotFoundError } from '../../../shared/domain/domain-error'
import { cursorArgs, type CursorQueryDto, toCursorPage } from '../../../shared/http/pagination'
import { ACTIVE_STATUSES, allowedTransitions } from '../domain/order-status'

const orderInclude = {
  items: true,
  payment: { select: { provider: true, status: true, checkoutUrl: true } },
  delivery: {
    include: { events: { orderBy: { createdAt: 'asc' } } },
  },
  table: { select: { number: true } },
  user: { select: { id: true, firstName: true, lastName: true, phone: true } },
} satisfies Prisma.OrderInclude

type OrderWithRelations = Prisma.OrderGetPayload<{ include: typeof orderInclude }>

export function presentOrder(o: OrderWithRelations) {
  return {
    ...o,
    nextStatuses: allowedTransitions(o.type, o.status),
  }
}

/** Côté lecture : requêtes directes, sans passer par l'agrégat. */
@Injectable()
export class OrderQueries {
  constructor(private readonly prisma: PrismaService) {}

  async mine(userId: string, query: CursorQueryDto) {
    const rows = await this.prisma.order.findMany({
      where: { userId },
      include: orderInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...cursorArgs(query),
    })
    const page = toCursorPage(rows, query.limit)
    return { ...page, items: page.items.map(presentOrder) }
  }

  async byId(id: string, user: AuthUser) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: orderInclude })
    if (!order) throw new NotFoundError('Commande')
    const isDriver = user.role === 'DRIVER' && order.delivery?.driverId === user.id
    if (order.userId !== user.id && !isStaff(user) && !isDriver) {
      throw new ForbiddenError('Accès refusé')
    }
    return presentOrder(order)
  }

  /** Suivi public d'une commande passée à table (le jeton du QR code fait office de preuve). */
  async forTable(qrToken: string) {
    const orders = await this.prisma.order.findMany({
      where: {
        table: { qrToken },
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
      },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })
    return orders.map((o) => ({
      id: o.id,
      number: o.number,
      status: o.status,
      total: o.total,
      createdAt: o.createdAt,
      items: o.items.map((i) => ({ name: i.nameSnapshot, quantity: i.quantity })),
    }))
  }

  /** Écran cuisine : commandes en cours, les plus anciennes d'abord. */
  async kitchen() {
    const rows = await this.prisma.order.findMany({
      where: { status: { in: ACTIVE_STATUSES } },
      include: orderInclude,
      orderBy: { createdAt: 'asc' },
      take: 200,
    })
    return rows.map(presentOrder)
  }

  async list(filters: { status?: OrderStatus; type?: OrderType; search?: string } & CursorQueryDto) {
    const number = filters.search && /^\d+$/.test(filters.search) ? Number(filters.search) : undefined
    const rows = await this.prisma.order.findMany({
      where: {
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.type ? { type: filters.type } : {}),
        ...(filters.search
          ? {
              OR: [
                ...(number ? [{ number }] : []),
                { contactPhone: { contains: filters.search } },
                { user: { lastName: { contains: filters.search, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
      },
      include: orderInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...cursorArgs(filters),
    })
    const page = toCursorPage(rows, filters.limit)
    return { ...page, items: page.items.map(presentOrder) }
  }

  /** Recommander en un clic : lignes d'une ancienne commande encore disponibles. */
  async reorderItems(orderId: string, userId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      include: { items: { include: { dish: true } } },
    })
    if (!order) throw new NotFoundError('Commande')
    return order.items
      .filter((i) => i.dish && i.dish.isAvailable && !i.dish.deletedAt)
      .map((i) => ({
        dishId: i.dish!.id,
        quantity: i.quantity,
        slug: i.dish!.slug,
        name: i.dish!.name,
        price: i.dish!.price,
        imageUrl: i.dish!.imageUrl,
        imageAlt: i.dish!.imageAlt,
      }))
  }
}
