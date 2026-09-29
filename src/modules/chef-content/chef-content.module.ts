import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common'
import { ApiProperty, ApiPropertyOptional, ApiTags, PartialType } from '@nestjs/swagger'
import {
  ChefContentCategory,
  ChefContentType,
  type Prisma,
  PublicationStatus,
} from '@prisma/client'
import { Transform } from 'class-transformer'
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  Min,
} from 'class-validator'
import { PrismaService } from '../../infrastructure/prisma/prisma.service'
import { type AuthUser, isManager } from '../../shared/auth/auth-user'
import { CurrentUser, Public, Roles } from '../../shared/auth/decorators'
import { NotFoundError } from '../../shared/domain/domain-error'
import { cursorArgs, CursorQueryDto, toCursorPage } from '../../shared/http/pagination'

class ChefContentDto {
  @ApiProperty() @IsString() @Length(2, 160) title!: string
  @ApiProperty() @IsString() @MaxLength(4000) description!: string
  @ApiPropertyOptional({ enum: ChefContentType }) @IsOptional() @IsEnum(ChefContentType) type?: ChefContentType
  @ApiPropertyOptional({ enum: ChefContentCategory }) @IsOptional() @IsEnum(ChefContentCategory) category?: ChefContentCategory
  @ApiProperty() @IsString() @Length(2, 80) chefName!: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) chefImageUrl?: string
  @ApiProperty() @IsString() @MaxLength(500) thumbnailUrl!: string
  @ApiProperty() @IsString() @MaxLength(500) videoUrl!: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) streamUrl?: string
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isLive?: boolean
  @ApiPropertyOptional() @IsOptional() @IsDateString() liveStartsAt?: string
  @ApiPropertyOptional() @IsOptional() @IsDateString() liveEndsAt?: string
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) durationSeconds?: number
  @ApiPropertyOptional({ enum: PublicationStatus }) @IsOptional() @IsEnum(PublicationStatus) status?: PublicationStatus
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isFeatured?: boolean
  @ApiPropertyOptional() @IsOptional() @IsUUID() dishId?: string
}

class UpdateChefContentDto extends PartialType(ChefContentDto) {}

const toBool = ({ value }: { value: unknown }) => (value === undefined ? undefined : value === true || value === 'true')

class ChefContentQuery extends CursorQueryDto {
  @ApiPropertyOptional({ enum: ChefContentType }) @IsOptional() @IsEnum(ChefContentType) type?: ChefContentType
  @ApiPropertyOptional() @IsOptional() @Transform(toBool) @IsBoolean() featured?: boolean
  @ApiPropertyOptional() @IsOptional() @Transform(toBool) @IsBoolean() live?: boolean
  @ApiPropertyOptional({ enum: PublicationStatus }) @IsOptional() @IsEnum(PublicationStatus) status?: PublicationStatus
}

const include = {
  dish: { select: { id: true, name: true, slug: true, imageUrl: true } },
  publishedBy: { select: { firstName: true, lastName: true } },
  _count: { select: { likes: true } },
} satisfies Prisma.ChefContentInclude

const toData = <T extends Partial<ChefContentDto>>(dto: T) => ({
  ...dto,
  liveStartsAt: dto.liveStartsAt ? new Date(dto.liveStartsAt) : undefined,
  liveEndsAt: dto.liveEndsAt ? new Date(dto.liveEndsAt) : undefined,
})

@Injectable()
export class ChefContentService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ChefContentQuery, viewer?: AuthUser) {
    const where: Prisma.ChefContentWhereInput = {
      status: isManager(viewer) && query.status ? query.status : isManager(viewer) ? undefined : 'PUBLISHED',
      ...(query.type ? { type: query.type } : {}),
      ...(query.featured ? { isFeatured: true } : {}),
      ...(query.live ? { isLive: true } : {}),
    }
    const rows = await this.prisma.chefContent.findMany({
      where,
      include,
      orderBy: [{ isFeatured: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      ...cursorArgs(query),
    })
    return toCursorPage(rows, query.limit)
  }

  async get(id: string, viewer?: AuthUser) {
    const content = await this.prisma.chefContent.findUnique({
      where: { id },
      include: { ...include, likes: viewer ? { where: { userId: viewer.id } } : false },
    })
    if (!content || (content.status !== 'PUBLISHED' && !isManager(viewer))) throw new NotFoundError('Contenu')
    await this.prisma.chefContent.update({ where: { id }, data: { views: { increment: 1 } } })
    const { likes, ...rest } = content
    return { ...rest, likedByMe: Array.isArray(likes) && likes.length > 0 }
  }

  create(dto: ChefContentDto, userId: string) {
    return this.prisma.chefContent.create({ data: { ...toData(dto), publishedById: userId }, include })
  }

  update(id: string, dto: UpdateChefContentDto) {
    return this.prisma.chefContent.update({ where: { id }, data: toData(dto), include })
  }

  async remove(id: string): Promise<void> {
    await this.prisma.chefContent.delete({ where: { id } })
  }

  async toggleLike(id: string, userId: string) {
    const content = await this.prisma.chefContent.findFirst({ where: { id, status: 'PUBLISHED' } })
    if (!content) throw new NotFoundError('Contenu')
    const key = { contentId_userId: { contentId: id, userId } }
    const liked = !(await this.prisma.chefContentLike.findUnique({ where: key }))
    if (liked) await this.prisma.chefContentLike.create({ data: { contentId: id, userId } })
    else await this.prisma.chefContentLike.delete({ where: key })
    return { liked, likeCount: await this.prisma.chefContentLike.count({ where: { contentId: id } }) }
  }
}

const uuid = new ParseUUIDPipe({ version: '4' })

@ApiTags('chef-content')
@Controller()
export class ChefContentController {
  constructor(private readonly contents: ChefContentService) {}

  @Public()
  @Get('chef-content')
  list(@Query() query: ChefContentQuery, @CurrentUser() user?: AuthUser) {
    return this.contents.list(query, user)
  }

  @Public()
  @Get('chef-content/:id')
  get(@Param('id', uuid) id: string, @CurrentUser() user?: AuthUser) {
    return this.contents.get(id, user)
  }

  @Post('chef-content/:id/like')
  like(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.contents.toggleLike(id, user.id)
  }

  @Roles('MANAGER')
  @Post('admin/chef-content')
  create(@CurrentUser() user: AuthUser, @Body() dto: ChefContentDto) {
    return this.contents.create(dto, user.id)
  }

  @Roles('MANAGER')
  @Patch('admin/chef-content/:id')
  update(@Param('id', uuid) id: string, @Body() dto: UpdateChefContentDto) {
    return this.contents.update(id, dto)
  }

  @Roles('MANAGER')
  @Delete('admin/chef-content/:id')
  @HttpCode(204)
  remove(@Param('id', uuid) id: string) {
    return this.contents.remove(id)
  }
}

@Module({ controllers: [ChefContentController], providers: [ChefContentService] })
export class ChefContentModule {}
