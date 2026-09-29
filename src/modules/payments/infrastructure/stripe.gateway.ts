import { Injectable } from '@nestjs/common'
import Stripe from 'stripe'
import { AppConfig } from '../../../infrastructure/config/app-config.service'
import { PaymentError, ValidationError } from '../../../shared/domain/domain-error'
import type {
  GatewayContext,
  GatewayInitiation,
  PaymentGateway,
  PaymentOutcome,
} from '../application/payment-gateway'

/**
 * Carte bancaire via Stripe Checkout : les numéros de carte ne transitent jamais par nos serveurs
 * (l'ancien système recevait et stockait des données de carte).
 * Le GNF est une devise sans décimales chez Stripe : le montant est envoyé tel quel.
 */
@Injectable()
export class StripeGateway implements PaymentGateway {
  readonly provider = 'CARD' as const
  private client: Stripe | null = null

  constructor(private readonly config: AppConfig) {}

  isConfigured(): boolean {
    return !!(this.config.get('STRIPE_SECRET_KEY') && this.config.get('STRIPE_WEBHOOK_SECRET'))
  }

  async initiate(ctx: GatewayContext): Promise<GatewayInitiation> {
    try {
      const session = await this.stripe().checkout.sessions.create({
        mode: 'payment',
        client_reference_id: ctx.paymentId,
        customer_email: ctx.customerEmail,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'gnf',
              unit_amount: ctx.amount,
              product_data: { name: ctx.label },
            },
          },
        ],
        metadata: { paymentId: ctx.paymentId },
        success_url: ctx.returnUrl,
        cancel_url: ctx.cancelUrl,
        expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      })
      return { providerRef: session.id, checkoutUrl: session.url, instructions: null }
    } catch {
      throw new PaymentError('Paiement par carte indisponible, réessayez plus tard')
    }
  }

  /** Vérifie la signature Stripe puis traduit l'événement. */
  parseWebhook(rawBody: Buffer, signature: string | undefined): PaymentOutcome | null {
    if (!signature) throw new ValidationError('Signature Stripe manquante')
    let event: Stripe.Event
    try {
      event = this.stripe().webhooks.constructEvent(
        rawBody,
        signature,
        this.config.get('STRIPE_WEBHOOK_SECRET')!,
      )
    } catch {
      throw new ValidationError('Signature Stripe invalide')
    }

    if (
      event.type === 'checkout.session.completed' ||
      event.type === 'checkout.session.async_payment_succeeded' ||
      event.type === 'checkout.session.async_payment_failed' ||
      event.type === 'checkout.session.expired'
    ) {
      const session = event.data.object
      const paymentId = session.metadata?.paymentId
      if (!paymentId) return null
      const succeeded =
        event.type === 'checkout.session.async_payment_succeeded' ||
        (event.type === 'checkout.session.completed' && session.payment_status === 'paid')
      const failed =
        event.type === 'checkout.session.async_payment_failed' || event.type === 'checkout.session.expired'
      if (!succeeded && !failed) return null
      return { eventKey: event.id, paymentId, succeeded, reason: failed ? event.type : undefined }
    }
    return null
  }

  private stripe(): Stripe {
    this.client ??= new Stripe(this.config.get('STRIPE_SECRET_KEY')!)
    return this.client
  }
}
