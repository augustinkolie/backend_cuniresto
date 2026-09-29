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
import { ReviewStatus, Sentiment } from '@prisma/client'
import { IsEnum, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator'
import type { AuthUser } from '../../shared/auth/auth-user'
import { CurrentUser, Public, Roles } from '../../shared/auth/decorators'
import { CursorQueryDto } from '../../shared/http/pagination'
import { ReviewsService } from './reviews.service'

class CreateReviewDto {
  @ApiProperty({ minimum: 1, maximum: 5 }) @IsInt() @Min(1) @Max(5) rating!: number
  @ApiProperty() @IsString() @Length(3, 2000) comment!: string
}

class UpdateReviewDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(5) rating?: number
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(3, 2000) comment?: string
}

class ReplyDto {
  @ApiProperty() @IsString() @Length(1, 1000) content!: string
}

class ModerateDto {
  @ApiProperty({ enum: ReviewStatus }) @IsEnum(ReviewStatus) status!: ReviewStatus
}

class ReviewFilterDto extends CursorQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) search?: string
  @ApiPropertyOptional({ enum: ReviewStatus }) @IsOptional() @IsEnum(ReviewStatus) status?: ReviewStatus
  @ApiPropertyOptional({ enum: Sentiment }) @IsOptional() @IsEnum(Sentiment) sentiment?: Sentiment
}

const uuid = new ParseUUIDPipe({ version: '4' })

@ApiTags('reviews')
@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Public()
  @Get('dishes/:dishId/reviews')
  forDish(@Param('dishId', uuid) dishId: string, @Query() q: CursorQueryDto, @CurrentUser() user?: AuthUser) {
    return this.reviews.forDish(dishId, user, q)
  }

  @Public()
  @Get('reviews/latest')
  latest() {
    return this.reviews.latest()
  }

  @Public()
  @Get('reviews/summary')
  summary() {
    return this.reviews.summary()
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('dishes/:dishId/reviews')
  create(@CurrentUser() user: AuthUser, @Param('dishId', uuid) dishId: string, @Body() dto: CreateReviewDto) {
    return this.reviews.create(user.id, dishId, dto.rating, dto.comment)
  }

  @Patch('reviews/:id')
  update(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string, @Body() dto: UpdateReviewDto) {
    return this.reviews.update(id, user, dto)
  }

  @Delete('reviews/:id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.reviews.remove(id, user)
  }

  @Post('reviews/:id/like')
  like(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.reviews.toggleLike(id, user.id)
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('reviews/:id/replies')
  reply(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string, @Body() dto: ReplyDto) {
    return this.reviews.reply(id, user.id, dto.content)
  }

  @Delete('reviews/replies/:replyId')
  @HttpCode(204)
  removeReply(@CurrentUser() user: AuthUser, @Param('replyId', uuid) replyId: string) {
    return this.reviews.removeReply(replyId, user)
  }

  @Roles('MANAGER')
  @Get('admin/reviews')
  list(@Query() filter: ReviewFilterDto) {
    return this.reviews.list(filter)
  }

  @Roles('MANAGER')
  @Get('admin/reviews/statistics')
  statistics() {
    return this.reviews.statistics()
  }

  @Roles('MANAGER')
  @Patch('admin/reviews/:id')
  moderate(@Param('id', uuid) id: string, @Body() dto: ModerateDto) {
    return this.reviews.moderate(id, dto.status)
  }
}

@Module({ controllers: [ReviewsController], providers: [ReviewsService] })
export class ReviewsModule {}
