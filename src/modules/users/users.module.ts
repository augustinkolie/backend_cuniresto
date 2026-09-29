import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { UsersService } from './application/users.service'
import { AdminUsersController, DriversController, MeController } from './presentation/users.controller'

@Module({
  imports: [AuthModule],
  controllers: [MeController, AdminUsersController, DriversController],
  providers: [UsersService],
})
export class UsersModule {}
