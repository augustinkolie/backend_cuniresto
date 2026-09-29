import { BullModule } from '@nestjs/bullmq'
import { Global, Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { AppConfig } from './config/app-config.service'
import { MAIL_QUEUE, MailProcessor, MailService } from './mail/mail.service'
import { PrismaService } from './prisma/prisma.service'
import { RealtimeGateway } from './realtime/realtime.gateway'
import { StorageService } from './storage/storage.service'

/** Services techniques partagés par tous les modules métier. */
@Global()
@Module({
  imports: [JwtModule.register({}), BullModule.registerQueue({ name: MAIL_QUEUE })],
  providers: [AppConfig, PrismaService, MailService, MailProcessor, StorageService, RealtimeGateway],
  exports: [AppConfig, PrismaService, MailService, StorageService, RealtimeGateway, JwtModule],
})
export class InfrastructureModule {}
