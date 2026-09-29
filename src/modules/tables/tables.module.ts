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
} from '@nestjs/common'
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { TableStatus, TableZone } from '@prisma/client'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'
import type { AuthUser } from '../../shared/auth/auth-user'
import { CurrentUser, Public, Roles } from '../../shared/auth/decorators'
import { OrdersModule } from '../orders/orders.module'
import { OrderQueries } from '../orders/application/order-queries'
import { OrderItemDto } from '../orders/presentation/orders.dto'
import { PHONE_PATTERN } from '../users/presentation/users.dto'
import { TablesService } from './tables.service'

class TableOrderDto {
  @ApiProperty({ type: [OrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items!: OrderItemDto[]
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) customerName?: string
  @ApiPropertyOptional() @IsOptional() @Matches(PHONE_PATTERN) customerPhone?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) specialRequests?: string
}

class CreateTableDto {
  @ApiProperty() @IsInt() @Min(1) @Max(999) number!: number
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(30) capacity?: number
  @ApiPropertyOptional({ enum: TableZone }) @IsOptional() @IsEnum(TableZone) zone?: TableZone
}

class UpdateTableDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(30) capacity?: number
  @ApiPropertyOptional({ enum: TableZone }) @IsOptional() @IsEnum(TableZone) zone?: TableZone
  @ApiPropertyOptional({ enum: TableStatus }) @IsOptional() @IsEnum(TableStatus) status?: TableStatus
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean
}

const uuid = new ParseUUIDPipe({ version: '4' })

@ApiTags('tables')
@Public()
@Controller('tables/qr/:qrToken')
export class TableQrController {
  constructor(
    private readonly tables: TablesService,
    private readonly orders: OrderQueries,
  ) {}

  @Get()
  table(@Param('qrToken') qrToken: string) {
    return this.tables.publicTable(qrToken)
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('orders')
  order(@Param('qrToken') qrToken: string, @Body() dto: TableOrderDto, @CurrentUser() user?: AuthUser) {
    return this.tables.order(qrToken, user?.id ?? null, dto)
  }

  @Get('orders')
  async orders_(@Param('qrToken') qrToken: string) {
    await this.tables.publicTable(qrToken)
    return this.orders.forTable(qrToken)
  }

  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('call-waiter')
  callWaiter(@Param('qrToken') qrToken: string) {
    return this.tables.callWaiter(qrToken)
  }
}

@ApiTags('admin/tables')
@Roles('MANAGER', 'WAITER')
@Controller('admin')
export class AdminTablesController {
  constructor(private readonly tables: TablesService) {}

  @Get('tables')
  list() {
    return this.tables.list()
  }

  @Roles('MANAGER')
  @Post('tables')
  create(@Body() dto: CreateTableDto) {
    return this.tables.create(dto)
  }

  @Patch('tables/:id')
  update(@Param('id', uuid) id: string, @Body() dto: UpdateTableDto) {
    return this.tables.update(id, dto)
  }

  @Roles('MANAGER')
  @Post('tables/:id/qr')
  regenerate(@Param('id', uuid) id: string) {
    return this.tables.regenerateQr(id)
  }

  @Roles('MANAGER')
  @Delete('tables/:id')
  @HttpCode(204)
  remove(@Param('id', uuid) id: string) {
    return this.tables.remove(id)
  }

  @Get('tables/:id/orders')
  orders(@Param('id', uuid) id: string) {
    return this.tables.orders(id)
  }

  @Get('waiter-calls')
  calls() {
    return this.tables.waiterCalls()
  }

  @Patch('waiter-calls/:id/acknowledge')
  @HttpCode(204)
  acknowledge(@Param('id', uuid) id: string) {
    return this.tables.acknowledge(id)
  }
}

@Module({
  imports: [OrdersModule],
  controllers: [TableQrController, AdminTablesController],
  providers: [TablesService],
})
export class TablesModule {}
