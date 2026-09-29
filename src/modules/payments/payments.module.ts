import { Module } from '@nestjs/common'
import { PAYMENT_GATEWAYS } from './application/payment-gateway'
import { PAYMENT_INITIATOR } from './application/payment-initiator.port'
import { PaymentsService } from './application/payments.service'
import { OnSiteGateway } from './infrastructure/on-site.gateway'
import { OrangeMoneyGateway } from './infrastructure/orange-money.gateway'
import { PayPalGateway } from './infrastructure/paypal.gateway'
import { StripeGateway } from './infrastructure/stripe.gateway'
import { PaymentsController } from './presentation/payments.controller'

@Module({
  controllers: [PaymentsController],
  providers: [
    OrangeMoneyGateway,
    StripeGateway,
    PayPalGateway,
    OnSiteGateway,
    {
      provide: PAYMENT_GATEWAYS,
      useFactory: (...gateways: unknown[]) => gateways,
      inject: [OrangeMoneyGateway, StripeGateway, PayPalGateway, OnSiteGateway],
    },
    PaymentsService,
    { provide: PAYMENT_INITIATOR, useExisting: PaymentsService },
  ],
  exports: [PAYMENT_INITIATOR],
})
export class PaymentsModule {}
