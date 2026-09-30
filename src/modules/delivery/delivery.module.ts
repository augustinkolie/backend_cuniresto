import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common'
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { DeliveryStatus } from '@prisma/client'
import {
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator'
import type { AuthUser } from '../../shared/auth/auth-user'
import { CurrentUser, Roles } from '../../shared/auth/decorators'
import { OrdersModule } from '../orders/orders.module'
import { PHONE_PATTERN } from '../users/presentation/users.dto'
import { DeliveryService } from './application/delivery.service'

class AssignDriverDto {
  @ApiPropertyOptional({ description: 'Compte livreur (rôle DRIVER)' }) @IsOptional() @IsUUID() driverId?: string
  @ApiPropertyOptional({ description: 'Livreur externe' }) @IsOptional() @IsString() @Length(2, 80) driverName?: string
  @ApiPropertyOptional() @IsOptional() @Matches(PHONE_PATTERN) driverPhone?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) driverVehicle?: string
}

class DriverStatusDto {
  @ApiProperty({ enum: DeliveryStatus }) @IsEnum(DeliveryStatus) status!: DeliveryStatus
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) message?: string
}

class LocationDto {
  @ApiProperty() @IsLatitude() lat!: number
  @ApiProperty() @IsLongitude() lng!: number
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) address?: string
}

class DeliveryFilterDto {
  @ApiPropertyOptional({ enum: DeliveryStatus }) @IsOptional() @IsEnum(DeliveryStatus) status?: DeliveryStatus
}

const uuid = new ParseUUIDPipe({ version: '4' })

@ApiTags('delivery')
@Controller()
export class DeliveryController {
  constructor(private readonly deliveries: DeliveryService) {}

  @Get('orders/:orderId/delivery')
  forOrder(@CurrentUser() user: AuthUser, @Param('orderId', uuid) orderId: string) {
    return this.deliveries.forOrder(orderId, user)
  }

  @Roles('MANAGER')
  @Get('admin/deliveries')
  list(@Query() filter: DeliveryFilterDto) {
    return this.deliveries.list(filter.status)
  }

  @Roles('MANAGER')
  @Patch('admin/deliveries/:id/assign')
  assign(@Param('id', uuid) id: string, @Body() dto: AssignDriverDto) {
    return this.deliveries.assign(id, dto)
  }

  @Roles('DRIVER', 'MANAGER')
  @Get('driver/deliveries')
  mine(@CurrentUser() user: AuthUser) {
    return this.deliveries.forDriver(user)
  }

  @Roles('DRIVER', 'MANAGER')
  @Patch('driver/deliveries/:id/status')
  @HttpCode(204)
  status(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string, @Body() dto: DriverStatusDto) {
    return this.deliveries.driverUpdate(id, user, dto.status, dto.message)
  }

  @Roles('DRIVER', 'MANAGER')
  @Post('driver/deliveries/:id/location')
  @HttpCode(204)
  location(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string, @Body() dto: LocationDto) {
    return this.deliveries.updateLocation(id, user, dto)
  }
}

@Module({
  imports: [OrdersModule],
  controllers: [DeliveryController],
  providers: [DeliveryService],
})
export class DeliveryModule {}
