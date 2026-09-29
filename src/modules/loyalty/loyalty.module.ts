import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common'
import { ApiProperty, ApiPropertyOptional, ApiTags, PartialType } from '@nestjs/swagger'
import {
  CashbackStatus,
  LoyaltyLevel,
  RewardCategory,
  RewardType,
  RewardValueType,
} from '@prisma/client'
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  Min,
  NotEquals,
} from 'class-validator'
import type { AuthUser } from '../../shared/auth/auth-user'
import { CurrentUser, Roles } from '../../shared/auth/decorators'
import { PHONE_PATTERN } from '../users/presentation/users.dto'
import { LoyaltyService } from './application/loyalty.service'

class ReferralCodeDto {
  @ApiProperty() @IsString() @Length(4, 20) code!: string
}

class CashbackDto {
  @ApiProperty({ description: 'Montant en GNF' }) @IsInt() @Min(5000) amount!: number
  @ApiProperty() @Matches(PHONE_PATTERN, { message: 'Numéro Orange Money invalide' }) orangeMoneyNumber!: string
}

class RewardDto {
  @ApiProperty() @IsString() @Length(2, 80) name!: string
  @ApiProperty() @IsString() @MaxLength(500) description!: string
  @ApiProperty() @IsInt() @Min(1) pointsCost!: number
  @ApiProperty({ enum: RewardType }) @IsEnum(RewardType) type!: RewardType
  @ApiProperty() @IsInt() @Min(0) value!: number
  @ApiPropertyOptional({ enum: RewardValueType }) @IsOptional() @IsEnum(RewardValueType) valueType?: RewardValueType
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) imageUrl?: string
  @ApiPropertyOptional({ enum: RewardCategory }) @IsOptional() @IsEnum(RewardCategory) category?: RewardCategory
  @ApiPropertyOptional({ enum: LoyaltyLevel }) @IsOptional() @IsEnum(LoyaltyLevel) minLevel?: LoyaltyLevel
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsInt() @Min(0) stock?: number | null
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsDateString() expiresAt?: string | null
}

class UpdateRewardDto extends PartialType(RewardDto) {}

class SettleCashbackDto {
  @ApiProperty({ enum: ['PAID', 'REJECTED'] }) @IsIn(['PAID', 'REJECTED']) status!: 'PAID' | 'REJECTED'
}

class CashbackFilterDto {
  @ApiPropertyOptional({ enum: CashbackStatus }) @IsOptional() @IsEnum(CashbackStatus) status?: CashbackStatus
}

class AdjustPointsDto {
  @ApiProperty() @IsInt() @NotEquals(0) points!: number
  @ApiProperty() @IsString() @Length(3, 160) description!: string
}

const uuid = new ParseUUIDPipe({ version: '4' })

@ApiTags('loyalty')
@Controller('loyalty')
export class LoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Get()
  account(@CurrentUser() user: AuthUser) {
    return this.loyalty.account(user.id)
  }

  @Get('transactions')
  transactions(@CurrentUser() user: AuthUser) {
    return this.loyalty.transactions(user.id)
  }

  @Get('rewards')
  rewards(@CurrentUser() user: AuthUser) {
    return this.loyalty.rewards(user.id)
  }

  @Get('redemptions')
  redemptions(@CurrentUser() user: AuthUser) {
    return this.loyalty.redemptions(user.id)
  }

  @Post('rewards/:id/redeem')
  redeem(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.loyalty.redeem(user.id, id)
  }

  @Get('referral')
  referral(@CurrentUser() user: AuthUser) {
    return this.loyalty.referral(user.id)
  }

  @Post('referral')
  useCode(@CurrentUser() user: AuthUser, @Body() dto: ReferralCodeDto) {
    return this.loyalty.useReferralCode(user.id, dto.code)
  }

  @Get('cashback')
  cashbackList(@CurrentUser() user: AuthUser) {
    return this.loyalty.cashbackRequests(user.id)
  }

  @Post('cashback')
  cashback(@CurrentUser() user: AuthUser, @Body() dto: CashbackDto) {
    return this.loyalty.requestCashback(user.id, dto.amount, dto.orangeMoneyNumber)
  }
}

@ApiTags('admin/loyalty')
@Roles('MANAGER')
@Controller('admin/loyalty')
export class AdminLoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Get('statistics')
  statistics() {
    return this.loyalty.statistics()
  }

  @Get('referrals')
  referrals() {
    return this.loyalty.allReferrals()
  }

  @Get('rewards')
  rewards() {
    return this.loyalty.allRewards()
  }

  @Post('rewards')
  createReward(@Body() dto: RewardDto) {
    return this.loyalty.createReward(dto)
  }

  @Patch('rewards/:id')
  updateReward(@Param('id', uuid) id: string, @Body() dto: UpdateRewardDto) {
    return this.loyalty.updateReward(id, dto)
  }

  @Delete('rewards/:id')
  @HttpCode(204)
  deleteReward(@Param('id', uuid) id: string) {
    return this.loyalty.deleteReward(id)
  }

  @Get('cashback')
  cashback(@Query() filter: CashbackFilterDto) {
    return this.loyalty.allCashback(filter.status)
  }

  @Patch('cashback/:id')
  settle(@Param('id', uuid) id: string, @Body() dto: SettleCashbackDto) {
    return this.loyalty.settleCashback(id, dto.status)
  }

  @Roles('ADMIN')
  @Post('users/:userId/adjust')
  adjust(@Param('userId', uuid) userId: string, @Body() dto: AdjustPointsDto) {
    return this.loyalty.adjust(userId, dto.points, dto.description)
  }
}

@Module({
  controllers: [LoyaltyController, AdminLoyaltyController],
  providers: [LoyaltyService],
})
export class LoyaltyModule {}
