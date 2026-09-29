import { Injectable } from '@nestjs/common'
import { AppConfig } from '../../../infrastructure/config/app-config.service'
import { PaymentError } from '../../../shared/domain/domain-error'
import type { GatewayContext, GatewayInitiation, PaymentGateway } from '../application/payment-gateway'

interface TokenCache {
  value: string
  expiresAt: number
}

/** Orange Money Web Payment (Guinée) : redirection vers la page de paiement Orange. */
@Injectable()
export class OrangeMoneyGateway implements PaymentGateway {
  readonly provider = 'ORANGE_MONEY' as const
  private token: TokenCache | null = null

  constructor(private readonly config: AppConfig) {}

  isConfigured(): boolean {
    return !!(
      this.config.get('OM_CLIENT_ID') &&
      this.config.get('OM_CLIENT_SECRET') &&
      this.config.get('OM_MERCHANT_KEY') &&
      this.config.get('OM_WEBHOOK_SECRET')
    )
  }

  async initiate(ctx: GatewayContext): Promise<GatewayInitiation> {
    const base = `${this.config.get('OM_API_URL')}${this.config.get('OM_WEBPAY_PATH')}`
    const web = this.config.get('WEB_URL')
    const notifUrl = new URL('/api/v1/payments/webhooks/orange-money', this.config.get('API_URL'))
    notifUrl.searchParams.set('s', this.config.get('OM_WEBHOOK_SECRET')!)

    const res = await fetch(`${base}/webpayment`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await this.accessToken()}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        merchant_key: this.config.get('OM_MERCHANT_KEY'),
        currency: this.config.get('OM_CURRENCY'),
        order_id: ctx.paymentId,
        amount: ctx.amount,
        return_url: `${web}/commande/${ctx.orderId}?paiement=retour`,
        cancel_url: `${web}/panier?paiement=annule`,
        notif_url: notifUrl.toString(),
        lang: 'fr',
        reference: `Maison Braise n° ${ctx.orderNumber}`,
      }),
    })
    const data = (await res.json().catch(() => ({}))) as {
      payment_url?: string
      pay_token?: string
      notif_token?: string
      message?: string
    }
    if (!res.ok || !data.payment_url || !data.pay_token) {
      throw new PaymentError(data.message ?? 'Orange Money indisponible, réessayez plus tard')
    }
    return {
      providerRef: data.pay_token,
      webhookToken: data.notif_token ?? null,
      checkoutUrl: data.payment_url,
      instructions: null,
    }
  }

  /** Vérifie auprès d'Orange l'état réel d'une transaction (on ne se fie pas au seul webhook). */
  async transactionStatus(paymentId: string, amount: number, payToken: string): Promise<string | null> {
    const base = `${this.config.get('OM_API_URL')}${this.config.get('OM_WEBPAY_PATH')}`
    const res = await fetch(`${base}/transactionstatus`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await this.accessToken()}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ order_id: paymentId, amount, pay_token: payToken }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { status?: string }
    return data.status ?? null
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value
    const basic = Buffer.from(
      `${this.config.get('OM_CLIENT_ID')}:${this.config.get('OM_CLIENT_SECRET')}`,
    ).toString('base64')
    const res = await fetch(`${this.config.get('OM_API_URL')}/oauth/v3/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    })
    if (!res.ok) throw new PaymentError('Authentification Orange Money impossible')
    const data = (await res.json()) as { access_token: string; expires_in: number }
    this.token = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
    return data.access_token
  }
}
