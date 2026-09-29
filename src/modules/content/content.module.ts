import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common'
import { ApiProperty, ApiTags } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsObject,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator'
import { Public, Roles } from '../../shared/auth/decorators'
import { ContentService } from './application/content.service'
import { SCHEDULE_READER } from './application/schedule-reader.port'

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

class DayHoursDto {
  @ApiProperty({ minimum: 0, maximum: 6 }) @IsInt() @Min(0) @Max(6) dayOfWeek!: number
  @ApiProperty({ example: '11:00' }) @Matches(TIME) opensAt!: string
  @ApiProperty({ example: '22:00' }) @Matches(TIME) closesAt!: string
  @ApiProperty() @IsBoolean() isClosed!: boolean
}

class OpeningHoursDto {
  @ApiProperty({ type: [DayHoursDto] })
  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => DayHoursDto)
  days!: DayHoursDto[]
}

class ClosureDto {
  @ApiProperty() @IsDateString() date!: string
  @ApiProperty() @IsString() @Length(2, 160) reason!: string
}

class JsonValueDto {
  @ApiProperty({ type: 'object', additionalProperties: true }) @IsObject() value!: Record<string, unknown>
}

@ApiTags('content')
@Controller()
export class ContentController {
  constructor(private readonly content: ContentService) {}

  @Public()
  @Get('opening-hours')
  hours() {
    return this.content.openingHours()
  }

  @Public()
  @Get('settings/public')
  publicSettings() {
    return this.content.publicSettings()
  }

  @Public()
  @Get('content/:key')
  get(@Param('key') key: string) {
    return this.content.content(key)
  }

  @Roles('MANAGER')
  @Put('admin/opening-hours')
  setHours(@Body() dto: OpeningHoursDto) {
    return this.content.setOpeningHours(dto.days)
  }

  @Roles('MANAGER')
  @Post('admin/closures')
  addClosure(@Body() dto: ClosureDto) {
    return this.content.addClosure(dto.date, dto.reason)
  }

  @Roles('MANAGER')
  @Delete('admin/closures/:id')
  @HttpCode(204)
  removeClosure(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.content.removeClosure(id)
  }

  @Roles('MANAGER')
  @Put('admin/content/:key')
  update(@Param('key') key: string, @Body() dto: JsonValueDto) {
    return this.content.updateContent(key, dto.value)
  }

  @Roles('ADMIN')
  @Get('admin/settings')
  settings() {
    return this.content.allSettings()
  }

  @Roles('ADMIN')
  @Put('admin/settings/:key')
  updateSetting(@Param('key') key: string, @Body() dto: JsonValueDto) {
    return this.content.updateSetting(key, dto.value)
  }
}

@Module({
  controllers: [ContentController],
  providers: [ContentService, { provide: SCHEDULE_READER, useExisting: ContentService }],
  exports: [SCHEDULE_READER, ContentService],
})
export class ContentModule {}
