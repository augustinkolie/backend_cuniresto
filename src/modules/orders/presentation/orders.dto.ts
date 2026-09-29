import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { DeliveryMode, OrderStatus, OrderType } from '@prisma/client'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'
import { CursorQueryDto } from '../../../shared/http/pagination'
import { PHONE_PATTERN } from '../../users/presentation/users.dto'

export class OrderItemDto {
  @ApiProperty() @IsUUID() dishId!: string
  @ApiProperty({ minimum: 1, maximum: 50 }) @IsInt() @Min(1) @Max(50) quantity!: number
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) notes?: string
}

export class DeliveryInfoDto {
  @ApiProperty({ enum: ['EXPRESS', 'STANDARD'] }) @IsIn(['EXPRESS', 'STANDARD']) mode!: 'EXPRESS' | 'STANDARD'
  @ApiProperty() @IsString() @Length(3, 200) street!: string
  @ApiProperty() @IsString() @Length(2, 80) city!: string
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(100) distanceKm?: number
}

export class PlaceOrderDto {
  @ApiProperty({ enum: ['DELIVERY', 'PICKUP'] }) @IsIn(['DELIVERY', 'PICKUP']) type!: 'DELIVERY' | 'PICKUP'

  @ApiProperty({ type: [OrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items!: OrderItemDto[]

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) contactName?: string
  @ApiProperty() @Matches(PHONE_PATTERN, { message: 'Téléphone invalide' }) contactPhone!: string

  @ApiPropertyOptional({ type: DeliveryInfoDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DeliveryInfoDto)
  delivery?: DeliveryInfoDto

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) instructions?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) tastePreferences?: string

  @ApiProperty({ enum: ['ORANGE_MONEY', 'CARD', 'PAYPAL'] })
  @IsIn(['ORANGE_MONEY', 'CARD', 'PAYPAL'])
  paymentMethod!: 'ORANGE_MONEY' | 'CARD' | 'PAYPAL'

  @ApiPropertyOptional({ description: 'Numéro Orange Money du payeur' })
  @IsOptional()
  @Matches(PHONE_PATTERN, { message: 'Numéro Orange Money invalide' })
  orangeMoneyPhone?: string
}

export class ChangeStatusDto {
  @ApiProperty({ enum: OrderStatus }) @IsEnum(OrderStatus) status!: OrderStatus
}

export class OrdersFilterDto extends CursorQueryDto {
  @ApiPropertyOptional({ enum: OrderStatus }) @IsOptional() @IsEnum(OrderStatus) status?: OrderStatus
  @ApiPropertyOptional({ enum: OrderType }) @IsOptional() @IsEnum(OrderType) type?: OrderType
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) search?: string
}

export class DeliveryEstimateDto {
  @ApiProperty({ enum: DeliveryMode }) @IsEnum(DeliveryMode) mode!: DeliveryMode
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100) distanceKm?: number
}
