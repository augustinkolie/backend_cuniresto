import { ValidationPipe, VersioningType } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import { Logger } from 'nestjs-pino'
import { AppModule } from './app.module'
import { AppConfig } from './infrastructure/config/app-config.service'

async function bootstrap(): Promise<void> {
  // rawBody : nécessaire à la vérification de signature des webhooks Stripe.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    rawBody: true,
  })
  const config = app.get(AppConfig)

  app.useLogger(app.get(Logger))
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }))
  app.use(cookieParser())
  app.set('trust proxy', 1)
  app.enableCors({ origin: config.get('WEB_URL'), credentials: true })

  app.setGlobalPrefix('api')
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  )
  app.enableShutdownHooks()

  const openApi = new DocumentBuilder()
    .setTitle('Maison Braise API')
    .setDescription('API du restaurant Maison Braise (montants en GNF)')
    .setVersion('1.0')
    .addCookieAuth('mb_access')
    .build()
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, openApi), {
    jsonDocumentUrl: 'api/docs/openapi.json',
  })

  await app.listen(config.get('PORT'))
}

void bootstrap()
