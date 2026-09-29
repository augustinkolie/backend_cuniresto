// Stratégie de paiement (principe ouvert/fermé) : ajouter MTN Mobile Money = ajouter une classe.
import type { PaymentProvider } from '@prisma/client'

export interface GatewayContext {
  paymentId: string
  orderId: string
  orderNumber: number
  amount: number
  payerPhone?: string
  customerEmail?: string
}

export interface GatewayInitiation {
  providerRef: string | null
  webhookToken?: string | null
  checkoutUrl: string | null
  instructions: string | null
}

export interface PaymentGateway {
  readonly provider: PaymentProvider
  /** Faux si les identifiants du fournisseur ne sont pas configurés. */
  isConfigured(): boolean
  initiate(ctx: GatewayContext): Promise<GatewayInitiation>
}

export const PAYMENT_GATEWAYS = Symbol('PAYMENT_GATEWAYS')

/** Résultat normalisé d'une notification de fournisseur. */
export interface PaymentOutcome {
  /** Clé d'idempotence : un même événement n'est traité qu'une fois. */
  eventKey: string
  paymentId: string
  succeeded: boolean
  reason?: string
}
