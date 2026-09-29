import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis'
import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_FILTER, APP_GUARD } from '@nestjs/core'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { ScheduleModule } from '@nestjs/schedule'
import { ServeStaticModule } from '@nestjs/serve-static'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { LoggerModule } from 'nestjs-pino'
import { resolve } from 'node:path'
import { AppConfig } from './infrastructure/config/app-config.service'
import { validateEnv } from './infrastructure/config/env'
import { InfrastructureModule } from './infrastructure/infrastructure.module'
import { AcademyModule } from './modules/academy/academy.module'
import { AnalyticsModule } from './modules/analytics/analytics.module'
import { AuthModule } from './modules/auth/auth.module'
import { CallsModule } from './modules/calls/calls.module'
import { CartModule } from './modules/cart/cart.module'
import { ChatbotModule } from './modules/chatbot/chatbot.module'
import { ChefContentModule } from './modules/chef-content/chef-content.module'
import { ContactModule } from './modules/contact/contact.module'
import { ContentModule } from './modules/content/content.module'
import { CorporateModule } from './modules/corporate/corporate.module'
import { DeliveryModule } from './modules/delivery/delivery.module'
import { HealthModule } from './modules/health/health.module'
import { LoyaltyModule } from './modules/loyalty/loyalty.module'
import { MenuModule } from './modules/menu/menu.module'
import { MessagingModule } from './modules/messaging/messaging.module'
import { NotificationsModule } from './modules/notifications/notifications.module'
import { OrdersModule } from './modules/orders/orders.module'
import { PaymentsModule } from './modules/payments/payments.module'
import { ReservationsModule } from './modules/reservations/reservations.module'
import { ReviewsModule } from './modules/reviews/reviews.module'
import { TablesModule } from './modules/tables/tables.module'
import { UsersModule } from './modules/users/users.module'
import { JwtAuthGuard } from './shared/auth/jwt-auth.guard'
import { RolesGuard } from './shared/auth/roles.guard'
import { ProblemDetailsFilter } from './shared/http/problem-details.filter'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, cache: true }),
    LoggerModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        pinoHttp: {
          level: config.isProduction ? 'info' : 'debug',
          transport: config.isProduction ? undefined : { target: 'pino-pretty', options: { singleLine: true } },
          redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
          autoLogging: { ignore: (req) => req.url?.startsWith('/api/v1/health') ?? false },
        },
      }),
    }),
    InfrastructureModule,
    EventEmitterModule.forRoot({ wildcard: false }),
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({ connection: { url: config.get('REDIS_URL') } }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
        storage: new ThrottlerStorageRedisService(config.get('REDIS_URL')),
      }),
    }),
    ServeStaticModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => [
        {
          rootPath: resolve(config.get('UPLOAD_DIR')),
          serveRoot: '/uploads',
          serveStaticOptions: { index: false, maxAge: '30d', immutable: true },
        },
      ],
    }),
    AuthModule,
    UsersModule,
    MenuModule,
    CartModule,
    PaymentsModule,
    OrdersModule,
    DeliveryModule,
    TablesModule,
    ContentModule,
    ReservationsModule,
    NotificationsModule,
    ReviewsModule,
    LoyaltyModule,
    CorporateModule,
    MessagingModule,
    CallsModule,
    ChefContentModule,
    AcademyModule,
    ChatbotModule,
    ContactModule,
    AnalyticsModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule {}
