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
  Put,
} from '@nestjs/common'
import { ApiProperty, ApiPropertyOptional, ApiTags, PartialType } from '@nestjs/swagger'
import type { Prisma } from '@prisma/client'
import { Type } from 'class-transformer'
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'
import { PrismaService } from '../../infrastructure/prisma/prisma.service'
import { RealtimeGateway } from '../../infrastructure/realtime/realtime.gateway'
import { Public, Roles } from '../../shared/auth/decorators'

// L'ancien site stockait ressources et état du direct dans le navigateur de l'administrateur :
// ils sont maintenant en base et visibles de tous.

class CourseModuleDto {
  @ApiProperty() @IsString() @Length(1, 120) title!: string
  @ApiProperty() @IsString() @Length(1, 20) duration!: string
}

class CourseDto {
  @ApiProperty() @IsString() @Length(2, 160) title!: string
  @ApiProperty() @IsString() @Length(2, 80) instructor!: string
  @ApiProperty() @IsString() @Length(2, 40) level!: string
  @ApiProperty() @IsString() @Length(2, 40) duration!: string
  @ApiProperty() @IsInt() @Min(0) lessons!: number
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) students?: number
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(5) rating?: number
  @ApiProperty({ description: 'Prix en GNF' }) @IsInt() @Min(0) price!: number
  @ApiProperty() @IsString() @MaxLength(500) imageUrl!: string
  @ApiProperty() @IsString() @Length(2, 60) category!: string
  @ApiProperty() @IsString() @MaxLength(2000) description!: string
  @ApiProperty({ type: [CourseModuleDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CourseModuleDto)
  modules!: CourseModuleDto[]
  @ApiPropertyOptional() @IsOptional() @IsInt() position?: number
}

class UpdateCourseDto extends PartialType(CourseDto) {}

const RESOURCE_TYPES = ['pdf', 'video', 'link', 'image'] as const

class ResourceDto {
  @ApiProperty() @IsString() @Length(2, 160) title!: string
  @ApiProperty() @IsString() @MaxLength(1000) description!: string
  @ApiProperty() @IsString() @MaxLength(500) fileUrl!: string
  @ApiProperty() @IsString() @Length(2, 40) category!: string
  @ApiProperty({ enum: RESOURCE_TYPES }) @IsIn(RESOURCE_TYPES) type!: string
}

class LiveDto {
  @ApiProperty() @IsBoolean() isLive!: boolean
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) title?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) streamUrl?: string
}

@Injectable()
export class AcademyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  courses() {
    return this.prisma.academyCourse.findMany({ orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] })
  }

  createCourse(dto: CourseDto) {
    return this.prisma.academyCourse.create({
      data: { ...dto, modules: dto.modules as unknown as Prisma.InputJsonValue },
    })
  }

  updateCourse(id: string, dto: UpdateCourseDto) {
    return this.prisma.academyCourse.update({
      where: { id },
      data: { ...dto, modules: dto.modules as unknown as Prisma.InputJsonValue | undefined },
    })
  }

  async deleteCourse(id: string): Promise<void> {
    await this.prisma.academyCourse.delete({ where: { id } })
  }

  resources() {
    return this.prisma.academyResource.findMany({ orderBy: { createdAt: 'desc' } })
  }

  createResource(dto: ResourceDto) {
    return this.prisma.academyResource.create({ data: dto })
  }

  async deleteResource(id: string): Promise<void> {
    await this.prisma.academyResource.delete({ where: { id } })
  }

  live() {
    return this.prisma.liveSession.upsert({ where: { id: 'studio' }, create: {}, update: {} })
  }

  async setLive(dto: LiveDto) {
    const current = await this.live()
    const live = await this.prisma.liveSession.update({
      where: { id: 'studio' },
      data: {
        ...dto,
        startedAt: dto.isLive ? (current.isLive ? current.startedAt : new Date()) : null,
      },
    })
    this.realtime.server.emit('studio:live', live)
    return live
  }
}

const uuid = new ParseUUIDPipe({ version: '4' })

@ApiTags('academy')
@Controller()
export class AcademyController {
  constructor(private readonly academy: AcademyService) {}

  @Public() @Get('academy/courses') courses() { return this.academy.courses() }
  @Public() @Get('academy/resources') resources() { return this.academy.resources() }
  @Public() @Get('academy/live') live() { return this.academy.live() }

  @Roles('MANAGER') @Post('admin/academy/courses')
  createCourse(@Body() dto: CourseDto) { return this.academy.createCourse(dto) }

  @Roles('MANAGER') @Patch('admin/academy/courses/:id')
  updateCourse(@Param('id', uuid) id: string, @Body() dto: UpdateCourseDto) { return this.academy.updateCourse(id, dto) }

  @Roles('MANAGER') @Delete('admin/academy/courses/:id') @HttpCode(204)
  deleteCourse(@Param('id', uuid) id: string) { return this.academy.deleteCourse(id) }

  @Roles('MANAGER') @Post('admin/academy/resources')
  createResource(@Body() dto: ResourceDto) { return this.academy.createResource(dto) }

  @Roles('MANAGER') @Delete('admin/academy/resources/:id') @HttpCode(204)
  deleteResource(@Param('id', uuid) id: string) { return this.academy.deleteResource(id) }

  @Roles('MANAGER') @Put('admin/academy/live')
  setLive(@Body() dto: LiveDto) { return this.academy.setLive(dto) }
}

@Module({ controllers: [AcademyController], providers: [AcademyService] })
export class AcademyModule {}
