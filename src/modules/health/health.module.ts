import { Controller, Get, Injectable, Logger, Module } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { ApiTags } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'
import { HealthCheck, HealthCheckService, PrismaHealthIndicator, TerminusModule } from '@nestjs/terminus'
import { AppConfig } from '../../infrastructure/config/app-config.service'
import { PrismaService } from '../../infrastructure/prisma/prisma.service'
import { Public } from '../../shared/auth/decorators'
import { Events, type MenuUpdatedEvent } from '../../shared/events'

@ApiTags('health')
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([() => this.db.pingCheck('database', this.prisma)])
  }
}

/**
 * Vide le cache des pages Next.js (ISR à la demande) quand la carte ou les contenus changent.
 */
@Injectable()
export class RevalidationService {
  private readonly logger = new Logger(RevalidationService.name)

  constructor(private readonly config: AppConfig) {}

  @OnEvent(Events.MenuUpdated, { async: true })
  async onMenu(e: MenuUpdatedEvent): Promise<void> {
    await this.revalidate(['menu', ...(e?.dishSlug ? [`dish:${e.dishSlug}`] : [])])
  }

  @OnEvent(Events.ContentUpdated, { async: true })
  async onContent(): Promise<void> {
    await this.revalidate(['content'])
  }

  private async revalidate(tags: string[]): Promise<void> {
    const secret = this.config.get('REVALIDATE_SECRET')
    if (!secret) return
    try {
      await fetch(`${this.config.get('WEB_URL')}/api/revalidate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-revalidate-secret': secret },
        body: JSON.stringify({ tags }),
        signal: AbortSignal.timeout(5_000),
      })
    } catch (error) {
      this.logger.warn(`Revalidation Next.js impossible : ${String(error)}`)
    }
  }
}

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [RevalidationService],
})
export class HealthModule {}
