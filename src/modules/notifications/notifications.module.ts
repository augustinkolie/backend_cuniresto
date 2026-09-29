import { Controller, Delete, Get, Global, HttpCode, Module, Param, ParseUUIDPipe, Patch } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../shared/auth/auth-user'
import { CurrentUser } from '../../shared/auth/decorators'
import { NotificationsService } from './notifications.service'

const uuid = new ParseUUIDPipe({ version: '4' })

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.notifications.list(user.id)
  }

  @Patch('read-all')
  @HttpCode(204)
  readAll(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user.id)
  }

  @Patch(':id/read')
  @HttpCode(204)
  read(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.notifications.markRead(user.id, id)
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.notifications.remove(user.id, id)
  }
}

/** Global : tout module peut notifier un utilisateur. */
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
