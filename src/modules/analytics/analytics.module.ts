import { Controller, Get, Injectable, Module, Query } from '@nestjs/common'
import { ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { Prisma } from '@prisma/client'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, Max, Min } from 'class-validator'
import { PrismaService } from '../../infrastructure/prisma/prisma.service'
import { Roles } from '../../shared/auth/decorators'

class PeriodQuery {
  @ApiPropertyOptional({ default: 30, maximum: 365 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days: number = 30
}

// Une commande compte dans le chiffre d'affaires dès qu'elle est payée (ou servie sur place).
const REVENUE = Prisma.sql`o.status NOT IN ('PENDING_PAYMENT', 'CANCELLED')`

const startOfToday = () => {
  const d = new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}
const since = (days: number) => new Date(Date.now() - days * 86_400_000)

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Tableau de bord : chiffres du jour. */
  async summary() {
    const today = startOfToday()
    const [revenue, inProgress, upcoming, pendingReservations, lowStock] = await Promise.all([
      this.prisma.order.aggregate({
        where: { createdAt: { gte: today }, status: { notIn: ['PENDING_PAYMENT', 'CANCELLED'] } },
        _sum: { total: true },
        _count: true,
      }),
      this.prisma.order.count({ where: { status: { in: ['CONFIRMED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY'] } } }),
      this.prisma.reservation.findMany({
        where: { date: { gte: today }, status: { in: ['PENDING', 'CONFIRMED'] } },
        orderBy: [{ date: 'asc' }, { timeSlot: 'asc' }],
        take: 8,
      }),
      this.prisma.reservation.count({ where: { status: 'PENDING', date: { gte: today } } }),
      this.prisma.dish.findMany({
        where: { deletedAt: null, stock: { lt: 10 } },
        select: { id: true, name: true, stock: true },
        orderBy: { stock: 'asc' },
        take: 10,
      }),
    ])
    return {
      todayRevenue: revenue._sum.total ?? 0,
      todayOrders: revenue._count,
      averageTicket: revenue._count ? Math.round((revenue._sum.total ?? 0) / revenue._count) : 0,
      ordersInProgress: inProgress,
      pendingReservations,
      upcomingReservations: upcoming,
      lowStock,
    }
  }

  /** Chiffre d'affaires et nombre de commandes par jour, avec tendance sur la période précédente. */
  async sales(days: number) {
    const from = since(days)
    const rows = await this.prisma.$queryRaw<Array<{ day: Date; revenue: bigint; orders: bigint }>>`
      SELECT date_trunc('day', o."createdAt") AS day, SUM(o.total)::bigint AS revenue, COUNT(*)::bigint AS orders
      FROM "Order" o
      WHERE o."createdAt" >= ${from} AND ${REVENUE}
      GROUP BY 1 ORDER BY 1`
    const previous = await this.prisma.order.aggregate({
      where: {
        createdAt: { gte: since(days * 2), lt: from },
        status: { notIn: ['PENDING_PAYMENT', 'CANCELLED'] },
      },
      _sum: { total: true },
    })
    const byDay = rows.map((r) => ({
      day: r.day.toISOString().slice(0, 10),
      revenue: Number(r.revenue),
      orders: Number(r.orders),
    }))
    const total = byDay.reduce((s, d) => s + d.revenue, 0)
    const prev = previous._sum.total ?? 0
    const byType = await this.prisma.order.groupBy({
      by: ['type'],
      where: { createdAt: { gte: from }, status: { notIn: ['PENDING_PAYMENT', 'CANCELLED'] } },
      _sum: { total: true },
      _count: true,
    })
    const byProvider = await this.prisma.payment.groupBy({
      by: ['provider'],
      where: { createdAt: { gte: from }, status: 'SUCCEEDED' },
      _sum: { amount: true },
      _count: true,
    })
    return {
      days,
      byDay,
      total,
      orders: byDay.reduce((s, d) => s + d.orders, 0),
      trend: prev ? Math.round(((total - prev) / prev) * 1000) / 10 : null,
      byType: byType.map((t) => ({ type: t.type, revenue: t._sum.total ?? 0, orders: t._count })),
      byProvider: byProvider.map((p) => ({ provider: p.provider, amount: p._sum.amount ?? 0, count: p._count })),
    }
  }

  /** Plats les plus vendus sur la période. */
  async topDishes(days: number) {
    const rows = await this.prisma.$queryRaw<Array<{ dishId: string; name: string; quantity: bigint; revenue: bigint }>>`
      SELECT i."dishId", MAX(i."nameSnapshot") AS name, SUM(i.quantity)::bigint AS quantity,
             SUM(i.quantity * i."unitPrice")::bigint AS revenue
      FROM "OrderItem" i JOIN "Order" o ON o.id = i."orderId"
      WHERE o."createdAt" >= ${since(days)} AND ${REVENUE} AND i."dishId" IS NOT NULL
      GROUP BY i."dishId" ORDER BY quantity DESC LIMIT 15`
    return rows.map((r) => ({ dishId: r.dishId, name: r.name, quantity: Number(r.quantity), revenue: Number(r.revenue) }))
  }

  /** Affluence : commandes par heure et par jour de semaine, réservations par créneau. */
  async peakHours(days: number) {
    const from = since(days)
    const byHour = await this.prisma.$queryRaw<Array<{ hour: number; orders: bigint }>>`
      SELECT EXTRACT(HOUR FROM o."createdAt")::int AS hour, COUNT(*)::bigint AS orders
      FROM "Order" o WHERE o."createdAt" >= ${from} AND ${REVENUE}
      GROUP BY 1 ORDER BY 1`
    const byWeekday = await this.prisma.$queryRaw<Array<{ weekday: number; orders: bigint }>>`
      SELECT EXTRACT(DOW FROM o."createdAt")::int AS weekday, COUNT(*)::bigint AS orders
      FROM "Order" o WHERE o."createdAt" >= ${from} AND ${REVENUE}
      GROUP BY 1 ORDER BY 1`
    const bySlot = await this.prisma.reservation.groupBy({
      by: ['timeSlot'],
      where: { date: { gte: from }, status: { in: ['CONFIRMED', 'COMPLETED'] } },
      _sum: { partySize: true },
      _count: true,
      orderBy: { timeSlot: 'asc' },
    })
    return {
      byHour: byHour.map((r) => ({ hour: r.hour, orders: Number(r.orders) })),
      byWeekday: byWeekday.map((r) => ({ weekday: r.weekday, orders: Number(r.orders) })),
      reservationsBySlot: bySlot.map((s) => ({ slot: s.timeSlot, reservations: s._count, covers: s._sum.partySize ?? 0 })),
    }
  }

  /** Indicateurs de performance : réservations, satisfaction, clients. */
  async performance(days: number) {
    const from = since(days)
    const [reservations, reviews, newUsers, activeUsers, cancelled, orders] = await Promise.all([
      this.prisma.reservation.groupBy({ by: ['status'], where: { createdAt: { gte: from } }, _count: true }),
      this.prisma.review.groupBy({ by: ['sentiment'], where: { createdAt: { gte: from } }, _count: true }),
      this.prisma.user.count({ where: { createdAt: { gte: from }, deletedAt: null } }),
      this.prisma.user.count({ where: { lastLoginAt: { gte: from }, deletedAt: null } }),
      this.prisma.order.count({ where: { createdAt: { gte: from }, status: 'CANCELLED' } }),
      this.prisma.order.count({ where: { createdAt: { gte: from } } }),
    ])
    const r = Object.fromEntries(reservations.map((x) => [x.status, x._count]))
    const s = Object.fromEntries(reviews.map((x) => [x.sentiment, x._count]))
    const totalReservations = reservations.reduce((sum, x) => sum + x._count, 0)
    const totalReviews = reviews.reduce((sum, x) => sum + x._count, 0)
    return {
      days,
      reservations: {
        total: totalReservations,
        confirmed: (r.CONFIRMED ?? 0) + (r.COMPLETED ?? 0),
        cancelled: r.CANCELLED ?? 0,
        confirmationRate: totalReservations
          ? Math.round((((r.CONFIRMED ?? 0) + (r.COMPLETED ?? 0)) / totalReservations) * 100)
          : 0,
      },
      reviews: {
        total: totalReviews,
        positive: s.POSITIVE ?? 0,
        negative: s.NEGATIVE ?? 0,
        satisfactionRate: totalReviews ? Math.round(((s.POSITIVE ?? 0) / totalReviews) * 100) : 0,
      },
      users: { new: newUsers, active: activeUsers },
      orders: { total: orders, cancelled, cancellationRate: orders ? Math.round((cancelled / orders) * 100) : 0 },
    }
  }

  /**
   * Matrice d'ingénierie de menu : popularité (ventes) × satisfaction (note).
   * Stars = populaire et apprécié, Plowhorse = populaire mais moins apprécié,
   * Puzzle = apprécié mais peu vendu, Dog = ni l'un ni l'autre.
   */
  async menuOptimization(days: number) {
    const sales = await this.topDishesAll(days)
    const dishes = await this.prisma.dish.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, price: true, ratingAvg: true, ratingCount: true, stock: true, category: { select: { name: true } } },
    })
    const quantities = dishes.map((d) => sales.get(d.id) ?? 0)
    const avgQty = quantities.reduce((a, b) => a + b, 0) / Math.max(1, quantities.length)
    const rated = dishes.filter((d) => d.ratingCount > 0)
    const avgRating = rated.reduce((a, d) => a + d.ratingAvg, 0) / Math.max(1, rated.length)

    return dishes
      .map((d) => {
        const quantity = sales.get(d.id) ?? 0
        const popular = quantity >= avgQty
        const liked = d.ratingCount === 0 ? true : d.ratingAvg >= avgRating
        const quadrant = popular && liked ? 'STAR' : popular ? 'PLOWHORSE' : liked ? 'PUZZLE' : 'DOG'
        return { ...d, category: d.category.name, quantity, revenue: quantity * d.price, quadrant }
      })
      .sort((a, b) => b.revenue - a.revenue)
  }

  /** Historique quotidien détaillé (export CSV/PDF côté administration). */
  async history(days: number) {
    const from = since(days)
    const rows = await this.prisma.$queryRaw<
      Array<{ day: Date; orders: bigint; revenue: bigint; delivery: bigint; pickup: bigint; dine_in: bigint }>
    >`
      SELECT date_trunc('day', o."createdAt") AS day,
             COUNT(*)::bigint AS orders,
             SUM(o.total)::bigint AS revenue,
             COUNT(*) FILTER (WHERE o.type = 'DELIVERY')::bigint AS delivery,
             COUNT(*) FILTER (WHERE o.type = 'PICKUP')::bigint AS pickup,
             COUNT(*) FILTER (WHERE o.type = 'DINE_IN')::bigint AS dine_in
      FROM "Order" o WHERE o."createdAt" >= ${from} AND ${REVENUE}
      GROUP BY 1 ORDER BY 1 DESC`
    const reservations = await this.prisma.$queryRaw<Array<{ day: Date; count: bigint; covers: bigint }>>`
      SELECT r.date AS day, COUNT(*)::bigint AS count, SUM(r."partySize")::bigint AS covers
      FROM "Reservation" r WHERE r.date >= ${from} AND r.status IN ('CONFIRMED', 'COMPLETED')
      GROUP BY 1`
    const resByDay = new Map(reservations.map((r) => [r.day.toISOString().slice(0, 10), r]))
    return rows.map((r) => {
      const day = r.day.toISOString().slice(0, 10)
      const res = resByDay.get(day)
      return {
        day,
        orders: Number(r.orders),
        revenue: Number(r.revenue),
        delivery: Number(r.delivery),
        pickup: Number(r.pickup),
        dineIn: Number(r.dine_in),
        reservations: Number(res?.count ?? 0),
        covers: Number(res?.covers ?? 0),
      }
    })
  }

  private async topDishesAll(days: number): Promise<Map<string, number>> {
    const rows = await this.prisma.$queryRaw<Array<{ dishId: string; quantity: bigint }>>`
      SELECT i."dishId", SUM(i.quantity)::bigint AS quantity
      FROM "OrderItem" i JOIN "Order" o ON o.id = i."orderId"
      WHERE o."createdAt" >= ${since(days)} AND ${REVENUE} AND i."dishId" IS NOT NULL
      GROUP BY i."dishId"`
    return new Map(rows.map((r) => [r.dishId, Number(r.quantity)]))
  }
}

@ApiTags('admin/analytics')
@Roles('MANAGER')
@Controller('admin/analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('summary') summary() { return this.analytics.summary() }
  @Get('sales') sales(@Query() q: PeriodQuery) { return this.analytics.sales(q.days) }
  @Get('top-dishes') top(@Query() q: PeriodQuery) { return this.analytics.topDishes(q.days) }
  @Get('peak-hours') peak(@Query() q: PeriodQuery) { return this.analytics.peakHours(q.days) }
  @Get('performance') performance(@Query() q: PeriodQuery) { return this.analytics.performance(q.days) }
  @Get('menu-optimization') menu(@Query() q: PeriodQuery) { return this.analytics.menuOptimization(q.days) }
  @Get('history') history(@Query() q: PeriodQuery) { return this.analytics.history(q.days) }
}

@Module({ controllers: [AnalyticsController], providers: [AnalyticsService] })
export class AnalyticsModule {}
