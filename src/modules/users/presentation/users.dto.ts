import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger'
import { Role } from '@prisma/client'
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator'

export const PHONE_PATTERN = /^\+?[0-9 ]{8,20}$/

export class UpdateProfileDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 80) firstName?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 80) lastName?: string
  @ApiPropertyOptional() @IsOptional() @Matches(PHONE_PATTERN, { message: 'Téléphone invalide' }) phone?: string
  @ApiPropertyOptional() @IsOptional() @IsDateString() birthDate?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) bio?: string
  @ApiPropertyOptional() @IsOptional() @Matches(PHONE_PATTERN) orangeMoneyNumber?: string
}

export class AddressDto {
  @ApiProperty() @IsString() @Length(1, 40) label!: string
  @ApiProperty() @IsString() @Length(3, 200) street!: string
  @ApiProperty() @IsString() @Length(2, 80) city!: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) instructions?: string
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean
}

export class UpdateRoleDto {
  @ApiProperty({ enum: Role }) @IsEnum(Role) role!: Role
}

export class SetActiveDto {
  @ApiProperty() @IsBoolean() isActive!: boolean
}

export class SearchUsersQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) q?: string
}
