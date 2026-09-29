import { Injectable } from '@nestjs/common'
import { AppConfig } from '../../../infrastructure/config/app-config.service'
import { PaymentError } from '../../../shared/domain/domain-error'
import type { GatewayContext, GatewayInitiation, PaymentGateway } from '../application/payment-gateway'

interface TokenCache {
  value: string
  expiresAt: number
}

/**
 * PayPal (API Orders v2). PayPal ne prend pas en charge le GNF : le montant est converti
 * dans PAYPAL_CURRENCY au taux PAYPAL_GNF_RATE. La capture est faite côté serveur au retour.
 */
@Injectable()
export class PayPalGateway implements PaymentGateway {
  readonly provider = 'PAYPAL' as const
  private token: TokenCache | null = null

  constructor(private readonly config: AppConfig) {}

  isConfigured(): boolean {
    return !!(this.config.get('PAYPAL_CLIENT_ID') && this.config.get('PAYPAL_CLIENT_SECRET'))
  }

  convert(amountGnf: number): string {
    return (Math.ceil((amountGnf / this.config.get('PAYPAL_GNF_RATE')) * 100) / 100).toFixed(2)
  }

  async initiate(ctx: GatewayContext): Promise<GatewayInitiation> {
    const api = this.config.get('API_URL')
    const res = await this.call('/v2/checkout/orders', {
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: ctx.paymentId,
          custom_id: ctx.paymentId,
          description: ctx.label,
          amount: { currency_code: this.config.get('PAYPAL_CURRENCY'), value: this.convert(ctx.amount) },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: 'Maison Braise',
            locale: 'fr-FR',
            user_action: 'PAY_NOW',
            return_url: `${api}/api/v1/payments/paypal/return`,
            cancel_url: `${api}/api/v1/payments/paypal/cancel`,
          },
        },
      },
    })
    const data = (await res.json()) as { id?: string; links?: Array<{ rel: string; href: string }> }
    const approve = data.links?.find((l) => l.rel === 'payer-action' || l.rel === 'approve')
    if (!res.ok || !data.id || !approve) throw new PaymentError('PayPal indisponible, réessayez plus tard')
    return { providerRef: data.id, checkoutUrl: approve.href, instructions: null }
  }

  /** Capture la commande PayPal approuvée ; renvoie vrai si les fonds sont encaissés. */
  async capture(paypalOrderId: string): Promise<boolean> {
    const res = await this.call(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {})
    const data = (await res.json().catch(() => ({}))) as { status?: string }
    return res.ok && data.status === 'COMPLETED'
  }

  private async call(path: string, body: unknown): Promise<Response> {
    return fetch(`${this.config.get('PAYPAL_API_URL')}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await this.accessToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value
    const basic = Buffer.from(
      `${this.config.get('PAYPAL_CLIENT_ID')}:${this.config.get('PAYPAL_CLIENT_SECRET')}`,
    ).toString('base64')
    const res = await fetch(`${this.config.get('PAYPAL_API_URL')}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    })
    if (!res.ok) throw new PaymentError('Authentification PayPal impossible')
    const data = (await res.json()) as { access_token: string; expires_in: number }
    this.token = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
    return data.access_token
  }
}
