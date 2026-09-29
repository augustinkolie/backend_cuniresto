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
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { ReservationStatus } from '@prisma/client'
import { Type } from 'class-transformer'
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator'
import type { AuthUser } from '../../shared/auth/auth-user'
import { CurrentUser, Public, Roles } from '../../shared/auth/decorators'
import { ContentModule } from '../content/content.module'
import { PHONE_PATTERN } from '../users/presentation/users.dto'
import { ReservationsService } from './application/reservations.service'

const DATE = /^\d{4}-\d{2}-\d{2}$/

class AvailabilityQuery {
  @ApiProperty({ example: '2026-10-02' }) @Matches(DATE) date!: string
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) partySize?: number
}

class CreateReservationDto {
  @ApiProperty() @IsString() @Length(1, 80) firstName!: string
  @ApiProperty() @IsString() @Length(1, 80) lastName!: string
  @ApiProperty() @IsEmail() email!: string
  @ApiProperty() @Matches(PHONE_PATTERN, { message: 'Téléphone invalide' }) phone!: string
  @ApiProperty({ example: '2026-10-02' }) @Matches(DATE) date!: string
  @ApiProperty({ example: '19:30' }) @Matches(/^([01]\d|2[0-3]):(00|30)$/) timeSlot!: string
  @ApiProperty() @IsInt() @Min(1) @Max(20) partySize!: number
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) message?: string
}

class ReservationFilterDto {
  @ApiPropertyOptional() @IsOptional() @Matches(DATE) date?: string
  @ApiPropertyOptional({ enum: ReservationStatus }) @IsOptional() @IsEnum(ReservationStatus) status?: ReservationStatus
}

class ManageReservationDto {
  @ApiPropertyOptional({ enum: ReservationStatus }) @IsOptional() @IsEnum(ReservationStatus) status?: ReservationStatus
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  tableId?: string | null
}

const uuid = new ParseUUIDPipe({ version: '4' })

@ApiTags('reservations')
@Controller()
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Public()
  @Get('reservations/availability')
  availability(@Query() q: AvailabilityQuery) {
    return this.reservations.availability(q.date, q.partySize)
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('reservations')
  create(@Body() dto: CreateReservationDto, @CurrentUser() user?: AuthUser) {
    return this.reservations.create(dto, user?.id ?? null)
  }

  @Get('reservations/me')
  mine(@CurrentUser() user: AuthUser) {
    return this.reservations.mine(user.id)
  }

  @Patch('reservations/:id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.reservations.cancelOwn(id, user)
  }

  @Roles('MANAGER', 'WAITER')
  @Get('admin/reservations')
  list(@Query() filter: ReservationFilterDto) {
    return this.reservations.list(filter)
  }

  @Roles('MANAGER', 'WAITER')
  @Get('admin/reservations/planning')
  planning(@Query() q: AvailabilityQuery) {
    return this.reservations.planning(q.date)
  }

  @Roles('MANAGER', 'WAITER')
  @Patch('admin/reservations/:id')
  manage(@Param('id', uuid) id: string, @Body() dto: ManageReservationDto) {
    return this.reservations.manage(id, dto)
  }

  @Roles('MANAGER')
  @Delete('admin/reservations/:id')
  @HttpCode(204)
  remove(@Param('id', uuid) id: string) {
    return this.reservations.remove(id)
  }
}

@Module({
  imports: [ContentModule],
  controllers: [ReservationsController],
  providers: [ReservationsService],
})
export class ReservationsModule {}
