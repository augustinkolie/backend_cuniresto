import { Injectable, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import {
  type CashbackStatus,
  type LoyaltyTxnType,
  Prisma,
  type RewardCategory,
  type RewardType,
  type RewardValueType,
  type LoyaltyLevel,
} from '@prisma/client'
import { randomBytes } from 'node:crypto'
import { PrismaService } from '../../../infrastructure/prisma/prisma.service'
import { RealtimeGateway } from '../../../infrastructure/realtime/realtime.gateway'
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/domain/domain-error'
import {
  Events,
  type OrderStatusChangedEvent,
  type UserRegisteredEvent,
} from '../../../shared/events'
import {
  levelFor,
  LEVEL_THRESHOLDS,
  meetsLevel,
  MIN_CASHBACK_GNF,
  nextLevel,
  pointsForCashback,
  pointsForOrder,
  REFERRED_POINTS,
  REFERRER_POINTS,
} from '../domain/loyalty-rules'

type Tx = Prisma.TransactionClient

export interface RewardInput {
  name: string
  description: string
  pointsCost: number
  type: RewardType
  value: number
  valueType?: RewardValueType
  imageUrl?: string
  category?: RewardCategory
  minLevel?: LoyaltyLevel
  stock?: number | null
  isActive?: boolean
  expiresAt?: string | null
}

@Injectable()
export class LoyaltyService {
  private readonly logger = new Logger(LoyaltyService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  // ───────── Réactions aux événements

  @OnEvent(Events.UserRegistered, { async: true })
  async onUserRegistered(e: UserRegisteredEvent): Promise<void> {
    try {
      await this.prisma.loyaltyAccount.upsert({
        where: { userId: e.userId },
        create: { userId: e.userId },
        update: {},
      })
      if (e.referralCode) await this.useReferralCode(e.userId, e.referralCode).catch(() => undefined)
    } catch (error) {
      this.logger.error('Création du compte fidélité impossible', error as Error)
    }
  }

  /** Les points sont attribués à la confirmation (paiement validé), jamais avant. */
  @OnEvent(Events.OrderStatusChanged, { async: true })
  async onOrderStatusChanged(e: OrderStatusChangedEvent): Promise<void> {
    if (e.to !== 'CONFIRMED' || !e.userId) return
    const userId = e.userId
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.credit(tx, userId, pointsForOrder(e.total), 'ORDER', `Commande n° ${e.number}`, e.orderId)

        const referral = await tx.referral.findFirst({ where: { referredId: userId, status: 'PENDING' } })
        if (referral) {
          await tx.referral.update({
            where: { id: referral.id },
            data: { status: 'COMPLETED', firstOrderId: e.orderId, completedAt: new Date() },
          })
          await this.credit(tx, referral.referrerId, REFERRER_POINTS, 'REFERRAL', 'Bonus parrainage', e.orderId)
          await this.credit(tx, userId, REFERRED_POINTS, 'REFERRAL', 'Bonus de bienvenue (parrainage)', e.orderId)
          this.realtime.toUser(referral.referrerId, 'loyalty:updated', {})
        }
      })
      this.realtime.toUser(userId, 'loyalty:updated', {})
    } catch (error) {
      // Violation d'unicité = points déjà attribués pour cette commande (événement rejoué).
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
        this.logger.error(`Attribution des points impossible (commande ${e.number})`, error as Error)
      }
    }
  }

  // ───────── Espace client

  async account(userId: string) {
    const account = await this.prisma.loyaltyAccount.upsert({
      where: { userId },
      create: { userId },
      update: {},
    })
    const next = nextLevel(account.totalPoints)
    const current = LEVEL_THRESHOLDS.find((t) => t.level === account.level)!
    return {
      ...account,
      nextLevel: next,
      progress: next
        ? Math.round(((account.totalPoints - current.minPoints) / (next.minPoints - current.minPoints)) * 100)
        : 100,
      levels: LEVEL_THRESHOLDS,
    }
  }

  transactions(userId: string) {
    return this.prisma.loyaltyTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
  }

  async rewards(userId: string) {
    const { level, availablePoints } = await this.account(userId)
    const rewards = await this.prisma.reward.findMany({
      where: { isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      orderBy: { pointsCost: 'asc' },
    })
    return rewards.map((r) => ({
      ...r,
      soldOut: r.stock !== null && r.used >= r.stock,
      levelOk: meetsLevel(level, r.minLevel),
      affordable: availablePoints >= r.pointsCost,
    }))
  }

  redemptions(userId: string) {
    return this.prisma.rewardRedemption.findMany({
      where: { userId },
      include: { reward: { select: { name: true, type: true, value: true, valueType: true } } },
      orderBy: { createdAt: 'desc' },
    })
  }

  async redeem(userId: string, rewardId: string) {
    return this.prisma.$transaction(async (tx) => {
      const reward = await tx.reward.findUnique({ where: { id: rewardId } })
      if (!reward || !reward.isActive || (reward.expiresAt && reward.expiresAt < new Date())) {
        throw new NotFoundError('Récompense')
      }
      const account = await tx.loyaltyAccount.findUnique({ where: { userId } })
      if (!account || !meetsLevel(account.level, reward.minLevel)) {
        throw new ValidationError(`Réservé au niveau ${reward.minLevel} et plus`)
      }
      if (reward.stock !== null) {
        const { count } = await tx.reward.updateMany({
          where: { id: rewardId, used: { lt: reward.stock } },
          data: { used: { increment: 1 } },
        })
        if (count === 0) throw new ConflictError('Récompense épuisée')
      } else {
        await tx.reward.update({ where: { id: rewardId }, data: { used: { increment: 1 } } })
      }
      await this.debit(tx, userId, reward.pointsCost, 'REDEMPTION', `Échange : ${reward.name}`)
      return tx.rewardRedemption.create({
        data: { userId, rewardId, code: `MB-${randomBytes(4).toString('hex').toUpperCase()}` },
        include: { reward: true },
      })
    })
  }

  async referral(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { referralCode: true },
    })
    const [made, received] = await Promise.all([
      this.prisma.referral.findMany({
        where: { referrerId: userId },
        include: { referred: { select: { firstName: true, lastName: true, createdAt: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.referral.findUnique({
        where: { referredId: userId },
        include: { referrer: { select: { firstName: true, lastName: true } } },
      }),
    ])
    return {
      code: user.referralCode,
      referrals: made,
      referredBy: received,
      total: made.length,
      completed: made.filter((r) => r.status === 'COMPLETED').length,
      pointsEarned: made.filter((r) => r.status === 'COMPLETED').length * REFERRER_POINTS,
    }
  }

  async useReferralCode(userId: string, rawCode: string) {
    const code = rawCode.trim().toUpperCase()
    if (await this.prisma.referral.findUnique({ where: { referredId: userId } })) {
      throw new ConflictError('Vous avez déjà utilisé un code de parrainage')
    }
    const confirmedOrders = await this.prisma.order.count({
      where: { userId, status: { notIn: ['PENDING_PAYMENT', 'CANCELLED'] } },
    })
    if (confirmedOrders > 0) throw new ConflictError('Le parrainage est réservé aux nouveaux clients')
    const referrer = await this.prisma.user.findUnique({ where: { referralCode: code } })
    if (!referrer || referrer.id === userId || referrer.deletedAt) {
      throw new ValidationError('Code de parrainage invalide')
    }
    return this.prisma.referral.create({ data: { referrerId: referrer.id, referredId: userId, code } })
  }

  async requestCashback(userId: string, amount: number, phone: string) {
    if (amount < MIN_CASHBACK_GNF) throw new ValidationError(`Minimum ${MIN_CASHBACK_GNF} GNF`)
    const points = pointsForCashback(amount)
    return this.prisma.$transaction(async (tx) => {
      await this.debit(tx, userId, points, 'CASHBACK', `Cashback Orange Money : ${amount} GNF`)
      await tx.user.update({ where: { id: userId }, data: { orangeMoneyNumber: phone } })
      return tx.cashbackRequest.create({ data: { userId, amount, points, phone } })
    })
  }

  cashbackRequests(userId: string) {
    return this.prisma.cashbackRequest.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } })
  }

  // ───────── Administration

  async statistics() {
    const [accounts, points, referrals, completed, pendingCashback] = await Promise.all([
      this.prisma.loyaltyAccount.count(),
      this.prisma.loyaltyAccount.aggregate({ _sum: { totalPoints: true, usedPoints: true } }),
      this.prisma.referral.count(),
      this.prisma.referral.count({ where: { status: 'COMPLETED' } }),
      this.prisma.cashbackRequest.aggregate({ where: { status: 'PENDING' }, _sum: { amount: true }, _count: true }),
    ])
    const byLevel = await this.prisma.loyaltyAccount.groupBy({ by: ['level'], _count: true })
    return {
      accounts,
      pointsIssued: points._sum.totalPoints ?? 0,
      pointsUsed: points._sum.usedPoints ?? 0,
      referrals,
      completedReferrals: completed,
      pendingCashback: { count: pendingCashback._count, amount: pendingCashback._sum.amount ?? 0 },
      byLevel: Object.fromEntries(byLevel.map((l) => [l.level, l._count])),
    }
  }

  allReferrals() {
    return this.prisma.referral.findMany({
      include: {
        referrer: { select: { firstName: true, lastName: true, email: true, referralCode: true } },
        referred: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    })
  }

  allRewards() {
    return this.prisma.reward.findMany({ orderBy: { createdAt: 'desc' } })
  }

  createReward(input: RewardInput) {
    return this.prisma.reward.create({
      data: { ...input, expiresAt: input.expiresAt ? new Date(input.expiresAt) : null },
    })
  }

  updateReward(id: string, input: Partial<RewardInput>) {
    return this.prisma.reward.update({
      where: { id },
      data: {
        ...input,
        expiresAt: input.expiresAt === undefined ? undefined : input.expiresAt ? new Date(input.expiresAt) : null,
      },
    })
  }

  async deleteReward(id: string): Promise<void> {
    await this.prisma.reward.update({ where: { id }, data: { isActive: false } })
  }

  allCashback(status?: CashbackStatus) {
    return this.prisma.cashbackRequest.findMany({
      where: status ? { status } : {},
      include: { user: { select: { firstName: true, lastName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    })
  }

  /** Un cashback refusé rend ses points au client. */
  async settleCashback(id: string, status: Exclude<CashbackStatus, 'PENDING'>) {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.cashbackRequest.updateMany({
        where: { id, status: 'PENDING' },
        data: { status },
      })
      if (count === 0) throw new ConflictError('Demande déjà traitée')
      const request = await tx.cashbackRequest.findUniqueOrThrow({ where: { id } })
      if (status === 'REJECTED') {
        await tx.loyaltyAccount.update({
          where: { userId: request.userId },
          data: { availablePoints: { increment: request.points }, usedPoints: { decrement: request.points } },
        })
        await tx.loyaltyTransaction.create({
          data: {
            userId: request.userId,
            type: 'ADJUSTMENT',
            points: request.points,
            description: 'Cashback refusé : points restitués',
          },
        })
      }
      return request
    })
  }

  async adjust(userId: string, points: number, description: string) {
    if (points === 0) throw new ValidationError('Nombre de points nul')
    await this.prisma.$transaction(async (tx) => {
      if (points > 0) await this.credit(tx, userId, points, 'ADJUSTMENT', description)
      else await this.debit(tx, userId, -points, 'ADJUSTMENT', description)
    })
    return this.account(userId)
  }

  // ───────── Écritures

  private async credit(
    tx: Tx,
    userId: string,
    points: number,
    type: LoyaltyTxnType,
    description: string,
    orderId?: string,
  ): Promise<void> {
    await tx.loyaltyTransaction.create({ data: { userId, type, points, description, orderId } })
    const account = await tx.loyaltyAccount.upsert({
      where: { userId },
      create: { userId, totalPoints: points, availablePoints: points },
      update: { totalPoints: { increment: points }, availablePoints: { increment: points } },
    })
    const level = levelFor(account.totalPoints)
    if (level !== account.level) await tx.loyaltyAccount.update({ where: { userId }, data: { level } })
  }

  /** Débit atomique : échoue si le solde est insuffisant, même en cas de requêtes simultanées. */
  private async debit(tx: Tx, userId: string, points: number, type: LoyaltyTxnType, description: string) {
    const { count } = await tx.loyaltyAccount.updateMany({
      where: { userId, availablePoints: { gte: points } },
      data: { availablePoints: { decrement: points }, usedPoints: { increment: points } },
    })
    if (count === 0) throw new ValidationError('Points insuffisants')
    await tx.loyaltyTransaction.create({ data: { userId, type, points: -points, description } })
  }
}
