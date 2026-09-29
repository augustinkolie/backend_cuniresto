import { Body, Controller, Get, HttpCode, Injectable, Module, Post, Query } from '@nestjs/common'
import { ApiProperty, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { IsEmail, IsString, Length, Matches } from 'class-validator'
import { randomBytes } from 'node:crypto'
import { AppConfig } from '../../infrastructure/config/app-config.service'
import { MailService } from '../../infrastructure/mail/mail.service'
import { mailTemplates } from '../../infrastructure/mail/mail-templates'
import { PrismaService } from '../../infrastructure/prisma/prisma.service'
import { Public, Roles } from '../../shared/auth/decorators'
import { NotFoundError } from '../../shared/domain/domain-error'
import { PHONE_PATTERN } from '../users/presentation/users.dto'

class ContactDto {
  @ApiProperty() @IsString() @Length(1, 80) firstName!: string
  @ApiProperty() @IsString() @Length(1, 80) lastName!: string
  @ApiProperty() @IsEmail() email!: string
  @ApiProperty() @Matches(PHONE_PATTERN, { message: 'Téléphone invalide' }) phone!: string
  @ApiProperty() @IsString() @Length(2, 160) subject!: string
  @ApiProperty() @IsString() @Length(10, 5000) message!: string
}

class NewsletterDto {
  @ApiProperty() @IsEmail() email!: string
}

class ConfirmQuery {
  @ApiProperty() @IsString() @Length(10, 64) token!: string
}

@Injectable()
export class ContactService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: AppConfig,
  ) {}

  async contact(dto: ContactDto): Promise<void> {
    await this.mail.send({ to: this.config.get('ADMIN_NOTIFICATION_EMAIL'), ...mailTemplates.contactMessage(dto) })
  }

  /** Inscription avec double confirmation : aucune adresse n'est active sans clic sur le lien. */
  async subscribe(emailInput: string): Promise<void> {
    const email = emailInput.trim().toLowerCase()
    const existing = await this.prisma.newsletterSubscriber.findUnique({ where: { email } })
    if (existing?.confirmedAt) return
    const confirmToken = randomBytes(24).toString('base64url')
    await this.prisma.newsletterSubscriber.upsert({
      where: { email },
      create: { email, confirmToken },
      update: { confirmToken },
    })
    const url = `${this.config.get('WEB_URL')}/newsletter/confirmation?token=${confirmToken}`
    await this.mail.send({ to: email, ...mailTemplates.newsletterConfirm(url) })
  }

  async confirm(token: string): Promise<void> {
    const { count } = await this.prisma.newsletterSubscriber.updateMany({
      where: { confirmToken: token, confirmedAt: null },
      data: { confirmedAt: new Date() },
    })
    if (count === 0) {
      const done = await this.prisma.newsletterSubscriber.findUnique({ where: { confirmToken: token } })
      if (!done) throw new NotFoundError('Lien de confirmation')
    }
  }

  subscribers() {
    return this.prisma.newsletterSubscriber.findMany({
      where: { confirmedAt: { not: null } },
      select: { email: true, confirmedAt: true },
      orderBy: { confirmedAt: 'desc' },
    })
  }
}

@ApiTags('contact')
@Controller()
export class ContactController {
  constructor(private readonly contact: ContactService) {}

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(202)
  @Post('contact')
  async send(@Body() dto: ContactDto) {
    await this.contact.contact(dto)
    return { message: 'Votre message a bien été envoyé.' }
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(202)
  @Post('newsletter')
  async subscribe(@Body() dto: NewsletterDto) {
    await this.contact.subscribe(dto.email)
    return { message: 'Vérifiez votre boîte mail pour confirmer votre inscription.' }
  }

  @Public()
  @HttpCode(204)
  @Post('newsletter/confirm')
  confirm(@Query() q: ConfirmQuery) {
    return this.contact.confirm(q.token)
  }

  @Roles('MANAGER')
  @Get('admin/newsletter')
  subscribers() {
    return this.contact.subscribers()
  }
}

@Module({ controllers: [ContactController], providers: [ContactService] })
export class ContactModule {}
