import { Injectable } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import type { Prisma, ReviewStatus, Sentiment } from '@prisma/client'
import { PrismaService } from '../../infrastructure/prisma/prisma.service'
import { type AuthUser, isManager } from '../../shared/auth/auth-user'
import { ConflictError, ForbiddenError, NotFoundError } from '../../shared/domain/domain-error'
import { Events } from '../../shared/events'
import { cursorArgs, type CursorQueryDto, toCursorPage } from '../../shared/http/pagination'
import { NotificationsService } from '../notifications/notifications.service'

export function sentimentFor(rating: number): Sentiment {
  return rating >= 4 ? 'POSITIVE' : rating <= 2 ? 'NEGATIVE' : 'NEUTRAL'
}

const authorSelect = { id: true, firstName: true, lastName: true, avatarUrl: true, role: true } as const

const reviewInclude = {
  user: { select: authorSelect },
  replies: { include: { author: { select: authorSelect } }, orderBy: { createdAt: 'asc' } },
  _count: { select: { likes: true } },
} satisfies Prisma.ReviewInclude

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly events: EventEmitter2,
  ) {}

  async forDish(dishId: string, viewer: AuthUser | undefined, query: CursorQueryDto) {
    const rows = await this.prisma.review.findMany({
      where: { dishId, status: 'PUBLISHED' },
      include: {
        ...reviewInclude,
        likes: viewer ? { where: { userId: viewer.id }, select: { userId: true } } : false,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...cursorArgs(query),
    })
    const page = toCursorPage(rows, query.limit)
    const distribution = await this.prisma.review.groupBy({
      by: ['rating'],
      where: { dishId, status: 'PUBLISHED' },
      _count: true,
    })
    return {
      ...page,
      items: page.items.map(({ likes, _count, ...r }) => ({
        ...r,
        likeCount: _count.likes,
        likedByMe: Array.isArray(likes) && likes.length > 0,
      })),
      distribution: Object.fromEntries(distribution.map((d) => [d.rating, d._count])),
    }
  }

  latest(limit = 3) {
    return this.prisma.review.findMany({
      where: { status: 'PUBLISHED', rating: { gte: 4 } },
      include: { user: { select: authorSelect }, dish: { select: { name: true, slug: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
  }

  async summary() {
    const agg = await this.prisma.review.aggregate({
      where: { status: 'PUBLISHED' },
      _avg: { rating: true },
      _count: true,
    })
    return { average: Math.round((agg._avg.rating ?? 0) * 10) / 10, count: agg._count }
  }

  async create(userId: string, dishId: string, rating: number, comment: string) {
    const dish = await this.prisma.dish.findFirst({ where: { id: dishId, deletedAt: null } })
    if (!dish) throw new NotFoundError('Plat')
    if (await this.prisma.review.findUnique({ where: { userId_dishId: { userId, dishId } } })) {
      throw new ConflictError('Vous avez déjà donné votre avis sur ce plat : modifiez-le')
    }
    const order = await this.prisma.order.findFirst({
      where: { userId, status: { in: ['DELIVERED', 'COMPLETED', 'SERVED'] }, items: { some: { dishId } } },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    })
    const review = await this.prisma.review.create({
      data: { userId, dishId, orderId: order?.id, rating, comment: comment.trim(), sentiment: sentimentFor(rating) },
      include: reviewInclude,
    })
    await this.refreshDishRating(dishId)
    return review
  }

  async update(id: string, user: AuthUser, input: { rating?: number; comment?: string }) {
    const review = await this.find(id)
    if (review.userId !== user.id) throw new ForbiddenError('Ce n’est pas votre avis')
    const updated = await this.prisma.review.update({
      where: { id },
      data: {
        rating: input.rating,
        comment: input.comment?.trim(),
        sentiment: input.rating ? sentimentFor(input.rating) : undefined,
      },
      include: reviewInclude,
    })
    await this.refreshDishRating(review.dishId)
    return updated
  }

  async remove(id: string, user: AuthUser): Promise<void> {
    const review = await this.find(id)
    if (review.userId !== user.id && !isManager(user)) throw new ForbiddenError('Accès refusé')
    await this.prisma.review.delete({ where: { id } })
    await this.refreshDishRating(review.dishId)
  }

  async toggleLike(id: string, userId: string) {
    const review = await this.find(id)
    const key = { reviewId_userId: { reviewId: id, userId } }
    let liked: boolean
    if (await this.prisma.reviewLike.findUnique({ where: key })) {
      await this.prisma.reviewLike.delete({ where: key })
      liked = false
    } else {
      await this.prisma.reviewLike.create({ data: { reviewId: id, userId } })
      liked = true
      const dish = await this.prisma.dish.findUniqueOrThrow({ where: { id: review.dishId }, select: { slug: true } })
      await this.notifications.notify(review.userId, {
        type: 'LIKE',
        senderId: userId,
        content: 'a aimé votre avis',
        link: `/carte/${dish.slug}#avis`,
      })
    }
    const likeCount = await this.prisma.reviewLike.count({ where: { reviewId: id } })
    return { liked, likeCount }
  }

  async reply(id: string, authorId: string, content: string) {
    const review = await this.find(id)
    const reply = await this.prisma.reviewReply.create({
      data: { reviewId: id, authorId, content: content.trim() },
      include: { author: { select: authorSelect } },
    })
    const dish = await this.prisma.dish.findUniqueOrThrow({ where: { id: review.dishId }, select: { slug: true } })
    await this.notifications.notify(review.userId, {
      type: 'REPLY',
      senderId: authorId,
      content: 'a répondu à votre avis',
      link: `/carte/${dish.slug}#avis`,
    })
    return reply
  }

  async removeReply(replyId: string, user: AuthUser): Promise<void> {
    const reply = await this.prisma.reviewReply.findUnique({ where: { id: replyId } })
    if (!reply) throw new NotFoundError('Réponse')
    if (reply.authorId !== user.id && !isManager(user)) throw new ForbiddenError('Accès refusé')
    await this.prisma.reviewReply.delete({ where: { id: replyId } })
  }

  // ───────── Modération

  async list(filters: { search?: string; status?: ReviewStatus; sentiment?: Sentiment } & CursorQueryDto) {
    const where: Prisma.ReviewWhereInput = {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.sentiment ? { sentiment: filters.sentiment } : {}),
      ...(filters.search
        ? {
            OR: [
              { comment: { contains: filters.search, mode: 'insensitive' } },
              { user: { firstName: { contains: filters.search, mode: 'insensitive' } } },
              { user: { lastName: { contains: filters.search, mode: 'insensitive' } } },
              { dish: { name: { contains: filters.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    }
    const rows = await this.prisma.review.findMany({
      where,
      include: { ...reviewInclude, dish: { select: { id: true, name: true, slug: true, imageUrl: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...cursorArgs(filters),
    })
    return toCursorPage(rows, filters.limit)
  }

  async moderate(id: string, status: ReviewStatus) {
    const review = await this.prisma.review.update({ where: { id }, data: { status } })
    await this.refreshDishRating(review.dishId)
    return review
  }

  async statistics() {
    const [bySentiment, byDish, complaints] = await Promise.all([
      this.prisma.review.groupBy({ by: ['sentiment'], _count: true }),
      this.prisma.review.groupBy({
        by: ['dishId'],
        where: { status: 'PUBLISHED' },
        _count: true,
        _avg: { rating: true },
        orderBy: { _count: { dishId: 'desc' } },
        take: 20,
      }),
      this.prisma.review.findMany({
        where: { rating: { lte: 2 } },
        include: { user: { select: authorSelect }, dish: { select: { name: true, slug: true } } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ])
    const dishes = await this.prisma.dish.findMany({
      where: { id: { in: byDish.map((d) => d.dishId) } },
      select: { id: true, name: true, imageUrl: true },
    })
    const counts = Object.fromEntries(bySentiment.map((s) => [s.sentiment, s._count]))
    return {
      total: bySentiment.reduce((sum, s) => sum + s._count, 0),
      positive: counts.POSITIVE ?? 0,
      neutral: counts.NEUTRAL ?? 0,
      negative: counts.NEGATIVE ?? 0,
      byDish: byDish.map((d) => ({
        dish: dishes.find((x) => x.id === d.dishId),
        count: d._count,
        average: Math.round((d._avg.rating ?? 0) * 10) / 10,
      })),
      complaints,
    }
  }

  private async find(id: string) {
    const review = await this.prisma.review.findUnique({ where: { id } })
    if (!review) throw new NotFoundError('Avis')
    return review
  }

  private async refreshDishRating(dishId: string): Promise<void> {
    const agg = await this.prisma.review.aggregate({
      where: { dishId, status: 'PUBLISHED' },
      _avg: { rating: true },
      _count: true,
    })
    const dish = await this.prisma.dish.update({
      where: { id: dishId },
      data: { ratingAvg: Math.round((agg._avg.rating ?? 0) * 10) / 10, ratingCount: agg._count },
      select: { slug: true },
    })
    this.events.emit(Events.MenuUpdated, { dishSlug: dish.slug })
  }
}
