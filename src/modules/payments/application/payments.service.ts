import { Inject, Injectable, Logger } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { Prisma, type PaymentProvider } from '@prisma/client'
import { AppConfig } from '../../../infrastructure/config/app-config.service'
import { PrismaService } from '../../../infrastructure/prisma/prisma.service'
import { type AuthUser, isStaff } from '../../../shared/auth/auth-user'
import {
  ForbiddenError,
  NotFoundError,
  PaymentError,
  ValidationError,
} from '../../../shared/domain/domain-error'
import { Events, type PaymentFailedEvent, type PaymentSucceededEvent } from '../../../shared/events'
import { PAYMENT_GATEWAYS, type PaymentGateway, type PaymentOutcome } from './payment-gateway'
import type {
  InitiatePaymentCommand,
  PaymentInitiation,
  PaymentInitiator,
} from './payment-initiator.port'

@Injectable()
export class PaymentsService implements PaymentInitiator {
  private readonly logger = new Logger(PaymentsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly events: EventEmitter2,
    @Inject(PAYMENT_GATEWAYS) private readonly gateways: PaymentGateway[],
  ) {}

  /** Moyens de paiement proposés au client. */
  availableMethods() {
    const simulated = !this.config.isProduction
    return (['ORANGE_MONEY', 'CARD', 'PAYPAL'] as const).map((provider) => ({
      provider,
      enabled: simulated || this.gateway(provider).isConfigured(),
      simulated: !this.gateway(provider).isConfigured() && simulated,
    }))
  }

  async initiate(cmd: InitiatePaymentCommand): Promise<PaymentInitiation> {
    const gateway = this.gateway(cmd.method)
    const payment = await this.prisma.payment.create({
      data: {
        orderId: cmd.orderId,
        provider: cmd.method,
        amount: cmd.amount,
        payerPhone: cmd.payerPhone,
      },
    })

    if (!gateway.isConfigured()) {
      if (this.config.isProduction) throw new PaymentError('Ce moyen de paiement est indisponible')
      // Développement : page de simulation au lieu du vrai fournisseur.
      const checkoutUrl = `${this.config.get('WEB_URL')}/paiement/simulation?commande=${cmd.orderId}`
      await this.prisma.payment.update({ where: { id: payment.id }, data: { checkoutUrl } })
      return { checkoutUrl, instructions: 'Mode simulation : aucun paiement réel.' }
    }

    const result = await gateway.initiate({
      paymentId: payment.id,
      orderId: cmd.orderId,
      orderNumber: cmd.orderNumber,
      amount: cmd.amount,
      payerPhone: cmd.payerPhone,
      customerEmail: cmd.customerEmail,
    })
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        providerRef: result.providerRef,
        webhookToken: result.webhookToken,
        checkoutUrl: result.checkoutUrl,
      },
    })
    return { checkoutUrl: result.checkoutUrl, instructions: result.instructions }
  }

  /**
   * Applique un résultat de paiement une seule fois (clé d'idempotence en base),
   * puis publie PaymentSucceeded / PaymentFailed.
   */
  async applyOutcome(provider: PaymentProvider, outcome: PaymentOutcome): Promise<void> {
    try {
      await this.prisma.paymentWebhookEvent.create({ data: { provider, eventKey: outcome.eventKey } })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return
      throw e
    }

    const { count } = await this.prisma.payment.updateMany({
      where: { id: outcome.paymentId, provider, status: 'PENDING' },
      data: { status: outcome.succeeded ? 'SUCCEEDED' : 'FAILED' },
    })
    if (count === 0) return

    const { orderId } = await this.prisma.payment.findUniqueOrThrow({
      where: { id: outcome.paymentId },
      select: { orderId: true },
    })
    this.logger.log(`Paiement ${outcome.paymentId} : ${outcome.succeeded ? 'réussi' : 'échoué'}`)
    if (outcome.succeeded) {
      await this.events.emitAsync(Events.PaymentSucceeded, { orderId } satisfies PaymentSucceededEvent)
    } else {
      await this.events.emitAsync(Events.PaymentFailed, {
        orderId,
        reason: outcome.reason ?? 'refusé',
      } satisfies PaymentFailedEvent)
    }
  }

  async findByProviderRef(providerRef: string) {
    return this.prisma.payment.findUnique({ where: { providerRef } })
  }

  async findPendingByWebhookToken(webhookToken: string) {
    return this.prisma.payment.findFirst({
      where: { webhookToken, provider: 'ORANGE_MONEY', status: 'PENDING' },
    })
  }

  async status(orderId: string, user: AuthUser) {
    const payment = await this.prisma.payment.findUnique({
      where: { orderId },
      include: { order: { select: { userId: true, status: true } } },
    })
    if (!payment) throw new NotFoundError('Paiement')
    if (payment.order.userId !== user.id && !isStaff(user)) throw new ForbiddenError('Accès refusé')
    return {
      provider: payment.provider,
      status: payment.status,
      amount: payment.amount,
      orderStatus: payment.order.status,
      checkoutUrl: payment.status === 'PENDING' ? payment.checkoutUrl : null,
    }
  }

  /** Simulation (hors production uniquement) : le client choisit l'issue du paiement. */
  async simulate(orderId: string, user: AuthUser, succeeded: boolean): Promise<void> {
    if (this.config.isProduction) throw new ForbiddenError('Simulation désactivée en production')
    const payment = await this.prisma.payment.findUnique({
      where: { orderId },
      include: { order: { select: { userId: true } } },
    })
    if (!payment) throw new NotFoundError('Paiement')
    if (payment.order.userId !== user.id) throw new ForbiddenError('Accès refusé')
    if (this.gateway(payment.provider).isConfigured()) {
      throw new ValidationError('Ce moyen de paiement est réel, simulation impossible')
    }
    await this.applyOutcome(payment.provider, {
      eventKey: `simulation:${payment.id}`,
      paymentId: payment.id,
      succeeded,
      reason: succeeded ? undefined : 'simulation',
    })
  }

  /** Encaissement au comptoir validé par le personnel. */
  async markPaidOnSite(orderId: string): Promise<void> {
    const payment = await this.prisma.payment.findUnique({ where: { orderId } })
    if (!payment) throw new NotFoundError('Paiement')
    if (payment.provider !== 'ON_SITE') throw new ValidationError('Paiement en ligne, rien à encaisser')
    await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'SUCCEEDED' } })
  }

  private gateway(provider: PaymentProvider): PaymentGateway {
    const gateway = this.gateways.find((g) => g.provider === provider)
    if (!gateway) throw new ValidationError('Moyen de paiement inconnu')
    return gateway
  }
}
