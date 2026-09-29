import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'
import { CursorQueryDto } from '../../../shared/http/pagination'

export const DISH_TAGS = ['vegetarian', 'vegan', 'spicy', 'signature', 'new', 'halal'] as const
export const ALLERGENS = [
  'gluten',
  'lactose',
  'eggs',
  'nuts',
  'peanuts',
  'soy',
  'fish',
  'shellfish',
  'sesame',
  'celery',
  'mustard',
] as const

const toArray = ({ value }: { value: unknown }) =>
  value === undefined ? undefined : Array.isArray(value) ? value : String(value).split(',')
const toBool = ({ value }: { value: unknown }) =>
  value === undefined ? undefined : value === true || value === 'true'

export class DishesQueryDto extends CursorQueryDto {
  @ApiPropertyOptional({ description: 'Slug de catégorie' }) @IsOptional() @IsString() category?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) search?: string
  @ApiPropertyOptional() @IsOptional() @Transform(toBool) @IsBoolean() featured?: boolean
  @ApiPropertyOptional({ type: [String], enum: DISH_TAGS })
  @IsOptional()
  @Transform(toArray)
  @IsIn(DISH_TAGS, { each: true })
  tags?: string[]
  @ApiPropertyOptional({ type: [String], enum: ALLERGENS, description: 'Allergènes à exclure' })
  @IsOptional()
  @Transform(toArray)
  @IsIn(ALLERGENS, { each: true })
  excludeAllergens?: string[]
  @ApiPropertyOptional({ description: 'Inclure les plats indisponibles (personnel)' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  includeUnavailable?: boolean
}

export class DishOptionDto {
  @ApiProperty() @IsString() @Length(1, 60) name!: string
  @ApiProperty() @IsInt() @Min(0) extraPrice!: number
}

export class CreateDishDto {
  @ApiProperty() @IsString() @Length(2, 120) name!: string
  @ApiProperty() @IsString() @MaxLength(2000) description!: string
  @ApiProperty({ description: 'Prix en GNF' }) @IsInt() @Min(0) price!: number
  @ApiProperty() @IsUUID() categoryId!: string
  @ApiProperty() @IsString() @MaxLength(500) imageUrl!: string
  @ApiProperty({ description: 'Texte alternatif obligatoire (accessibilité)' })
  @IsString()
  @Length(3, 200)
  imageAlt!: string
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) prepTimeMinutes?: number
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isFeatured?: boolean
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isAvailable?: boolean
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) stock?: number
  @ApiPropertyOptional({ enum: DISH_TAGS, isArray: true })
  @IsOptional()
  @IsArray()
  @IsIn(DISH_TAGS, { each: true })
  tags?: string[]
  @ApiPropertyOptional({ enum: ALLERGENS, isArray: true })
  @IsOptional()
  @IsArray()
  @IsIn(ALLERGENS, { each: true })
  allergens?: string[]
  @ApiPropertyOptional() @IsOptional() @IsUrl() chefVideoUrl?: string
  @ApiPropertyOptional({ type: [DishOptionDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => DishOptionDto)
  options?: DishOptionDto[]
}

export class UpdateDishDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 120) name?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) price?: number
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) imageUrl?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(3, 200) imageAlt?: string
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) prepTimeMinutes?: number
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isFeatured?: boolean
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isAvailable?: boolean
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) stock?: number
  @ApiPropertyOptional({ enum: DISH_TAGS, isArray: true })
  @IsOptional()
  @IsArray()
  @IsIn(DISH_TAGS, { each: true })
  tags?: string[]
  @ApiPropertyOptional({ enum: ALLERGENS, isArray: true })
  @IsOptional()
  @IsArray()
  @IsIn(ALLERGENS, { each: true })
  allergens?: string[]
  @ApiPropertyOptional() @IsOptional() @IsUrl() chefVideoUrl?: string
  @ApiPropertyOptional({ type: [DishOptionDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => DishOptionDto)
  options?: DishOptionDto[]
}

export class CategoryDto {
  @ApiProperty() @IsString() @Length(2, 60) name!: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) imageUrl?: string
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) position?: number
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isVisible?: boolean
}
