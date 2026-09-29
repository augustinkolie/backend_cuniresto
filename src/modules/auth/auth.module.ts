import { Module } from '@nestjs/common'
import { AuthService } from './application/auth.service'
import { TokenService } from './application/token.service'
import { AuthController } from './presentation/auth.controller'

@Module({
  controllers: [AuthController],
  providers: [AuthService, TokenService],
  exports: [TokenService],
})
export class AuthModule {}
