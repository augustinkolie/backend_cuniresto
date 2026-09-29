// Stratégie de paiement (principe ouvert/fermé) : ajouter MTN Mobile Money = ajouter une classe.
import type { PaymentProvider } from '@prisma/client'

export interface GatewayContext {
  paymentId: string
  /** Libellé affiché par le fournisseur (ex. : « Commande Maison Braise n° 42 »). */
  label: string
  /** Page du site où revient le client après paiement, et en cas d'abandon. */
  returnUrl: string
  cancelUrl: string
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
