import { Injectable } from '@nestjs/common'
import type { GatewayInitiation, PaymentGateway } from '../application/payment-gateway'

/** Paiement au comptoir (commandes à table) : encaissé et validé par le personnel. */
@Injectable()
export class OnSiteGateway implements PaymentGateway {
  readonly provider = 'ON_SITE' as const

  isConfigured(): boolean {
    return true
  }

  async initiate(): Promise<GatewayInitiation> {
    return { providerRef: null, checkoutUrl: null, instructions: 'Réglez votre addition auprès du serveur.' }
  }
}
