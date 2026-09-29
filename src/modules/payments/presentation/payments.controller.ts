import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  type RawBodyRequest,
} from '@nestjs/common'
import { ApiExcludeEndpoint, ApiProperty, ApiTags } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'
import { IsBoolean } from 'class-validator'
import type { Request, Response } from 'express'
import { timingSafeEqual } from 'node:crypto'
import { AppConfig } from '../../../infrastructure/config/app-config.service'
import type { AuthUser } from '../../../shared/auth/auth-user'
import { CurrentUser, Public, Roles } from '../../../shared/auth/decorators'
import { UnauthorizedError } from '../../../shared/domain/domain-error'
import { PaymentsService } from '../application/payments.service'
import { OrangeMoneyGateway } from '../infrastructure/orange-money.gateway'
import { PayPalGateway } from '../infrastructure/paypal.gateway'
import { StripeGateway } from '../infrastructure/stripe.gateway'

class SimulateDto {
  @ApiProperty() @IsBoolean() succeeded!: boolean
}

const uuid = new ParseUUIDPipe({ version: '4' })

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly orange: OrangeMoneyGateway,
    private readonly stripe: StripeGateway,
    private readonly paypal: PayPalGateway,
    private readonly config: AppConfig,
  ) {}

  @Public()
  @Get('methods')
  methods() {
    return this.payments.availableMethods()
  }

  @Get(':orderId/status')
  status(@CurrentUser() user: AuthUser, @Param('orderId', uuid) orderId: string) {
    return this.payments.status(orderId, user)
  }

  @Post(':orderId/simulate')
  @HttpCode(204)
  simulate(@CurrentUser() user: AuthUser, @Param('orderId', uuid) orderId: string, @Body() dto: SimulateDto) {
    return this.payments.simulate(orderId, user, dto.succeeded)
  }

  @Post('enrollments/:enrollmentId/simulate')
  @HttpCode(204)
  simulateEnrollment(
    @CurrentUser() user: AuthUser,
    @Param('enrollmentId', uuid) enrollmentId: string,
    @Body() dto: SimulateDto,
  ) {
    return this.payments.simulateEnrollment(enrollmentId, user, dto.succeeded)
  }

  @Roles('MANAGER', 'WAITER')
  @Post(':orderId/mark-paid')
  @HttpCode(204)
  markPaid(@Param('orderId', uuid) orderId: string) {
    return this.payments.markPaidOnSite(orderId)
  }

  // ───────── Webhooks : authentifiés par signature ou secret, idempotents.

  /**
   * Orange Money : l'URL de notification contient un secret connu de nous seuls, et le
   * notif_token reçu doit correspondre à celui remis à l'initiation. Le statut est ensuite
   * revérifié auprès d'Orange.
   */
  @Public()
  @SkipThrottle()
  @ApiExcludeEndpoint()
  @HttpCode(200)
  @Post('webhooks/orange-money')
  async orangeMoney(
    @Query('s') secret: string | undefined,
    @Body() body: { status?: string; notif_token?: string; txnid?: string },
  ) {
    const expected = this.config.get('OM_WEBHOOK_SECRET')
    if (!expected || !secret || !safeEqual(secret, expected)) throw new UnauthorizedError('Secret invalide')
    if (!body.notif_token) return 'OK'

    const payment = await this.payments.findPendingByWebhookToken(body.notif_token)
    if (!payment?.providerRef) return 'OK'

    const confirmed = await this.orange.transactionStatus(payment.id, payment.amount, payment.providerRef)
    const status = confirmed ?? body.status
    if (status === 'SUCCESS' || status === 'FAILED' || status === 'EXPIRED') {
      await this.payments.applyOutcome('ORANGE_MONEY', {
        eventKey: `${body.txnid ?? body.notif_token}:${status}`,
        paymentId: payment.id,
        succeeded: status === 'SUCCESS',
        reason: status,
      })
    }
    return 'OK'
  }

  @Public()
  @SkipThrottle()
  @ApiExcludeEndpoint()
  @HttpCode(200)
  @Post('webhooks/stripe')
  async stripeWebhook(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature?: string) {
    const outcome = this.stripe.parseWebhook(req.rawBody ?? Buffer.alloc(0), signature)
    if (outcome) await this.payments.applyOutcome('CARD', outcome)
    return { received: true }
  }

  /** Retour du client après approbation PayPal : capture côté serveur puis redirection. */
  @Public()
  @ApiExcludeEndpoint()
  @Get('paypal/return')
  async paypalReturn(@Query('token') token: string | undefined, @Res() res: Response) {
    const web = this.config.get('WEB_URL')
    const payment = token ? await this.payments.findByProviderRef(token) : null
    if (!payment) return res.redirect(`${web}/panier?paiement=erreur`)

    if (payment.status === 'PENDING') {
      const captured = await this.paypal.capture(token!)
      await this.payments.applyOutcome('PAYPAL', {
        eventKey: `capture:${token}`,
        paymentId: payment.id,
        succeeded: captured,
        reason: captured ? undefined : 'capture refusée',
      })
    }
    return res.redirect(
      payment.enrollmentId
        ? `${web}/academie/inscription/${payment.enrollmentId}?paiement=retour`
        : `${web}/commande/${payment.orderId}?paiement=retour`,
    )
  }

  @Public()
  @ApiExcludeEndpoint()
  @Get('paypal/cancel')
  async paypalCancel(@Query('token') token: string | undefined, @Res() res: Response) {
    const payment = token ? await this.payments.findByProviderRef(token) : null
    if (payment?.status === 'PENDING') {
      await this.payments.applyOutcome('PAYPAL', {
        eventKey: `cancel:${token}`,
        paymentId: payment.id,
        succeeded: false,
        reason: 'annulé par le client',
      })
    }
    const web = this.config.get('WEB_URL')
    return res.redirect(
      payment?.enrollmentId ? `${web}/academie/inscription/${payment.enrollmentId}?paiement=annule` : `${web}/panier?paiement=annule`,
    )
  }
}
