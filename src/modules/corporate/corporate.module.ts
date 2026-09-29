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
  Put,
  Query,
} from '@nestjs/common'
import { ApiProperty, ApiPropertyOptional, ApiTags, PartialType } from '@nestjs/swagger'
import {
  BillingCycle,
  CompanyStatus,
  CorporateOrderStatus,
  InvoiceStatus,
  Recurrence,
} from '@prisma/client'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
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
  ValidateNested,
} from 'class-validator'
import type { AuthUser } from '../../shared/auth/auth-user'
import { CurrentUser, Roles } from '../../shared/auth/decorators'
import { MenuModule } from '../menu/menu.module'
import { OrderItemDto } from '../orders/presentation/orders.dto'
import { PHONE_PATTERN } from '../users/presentation/users.dto'
import { CorporateService } from './application/corporate.service'

class CompanyDto {
  @ApiProperty() @IsString() @Length(2, 120) name!: string
  @ApiProperty() @IsEmail() email!: string
  @ApiProperty() @Matches(PHONE_PATTERN) phone!: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) street?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) city?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) contactName?: string
  @ApiPropertyOptional() @IsOptional() @IsEmail() contactEmail?: string
  @ApiPropertyOptional() @IsOptional() @Matches(PHONE_PATTERN) contactPhone?: string
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(80) discountPercent?: number
  @ApiPropertyOptional({ enum: BillingCycle }) @IsOptional() @IsEnum(BillingCycle) billingCycle?: BillingCycle
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(120) paymentTermsDays?: number
  @ApiPropertyOptional({ enum: CompanyStatus }) @IsOptional() @IsEnum(CompanyStatus) status?: CompanyStatus
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsDateString() subscriptionEnd?: string | null
}

class CreateCompanyDto extends CompanyDto {
  @ApiProperty({ description: 'E-mail du compte responsable' }) @IsEmail() adminEmail!: string
}

class UpdateCompanyDto extends PartialType(CompanyDto) {}

class EmployeeDto {
  @ApiProperty() @IsEmail() email!: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) employeeCode?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) department?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) position?: string
}

class PriceDto {
  @ApiProperty() @IsUUID() dishId!: string
  @ApiProperty() @IsInt() @Min(0) price!: number
}

class PricesDto {
  @ApiProperty({ type: [PriceDto] })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => PriceDto)
  prices!: PriceDto[]
}

class CorporateOrderDto {
  @ApiProperty({ type: [OrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items!: OrderItemDto[]
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) deliveryStreet?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) deliveryCity?: string
  @ApiPropertyOptional() @IsOptional() @IsDateString() deliveryDate?: string
  @ApiPropertyOptional({ enum: Recurrence }) @IsOptional() @IsEnum(Recurrence) recurrence?: Recurrence
  @ApiPropertyOptional({ type: [Number] }) @IsOptional() @IsArray() @IsInt({ each: true }) recurrenceDays?: number[]
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string
}

class OrdersFilterDto {
  @ApiPropertyOptional({ enum: CorporateOrderStatus }) @IsOptional() @IsEnum(CorporateOrderStatus) status?: CorporateOrderStatus
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string
}

class InvoiceRequestDto {
  @ApiProperty() @IsDateString() periodStart!: string
  @ApiProperty() @IsDateString() periodEnd!: string
}

class OrderStatusDto {
  @ApiProperty({ enum: CorporateOrderStatus }) @IsEnum(CorporateOrderStatus) status!: CorporateOrderStatus
}

class InvoiceStatusDto {
  @ApiProperty({ enum: InvoiceStatus }) @IsEnum(InvoiceStatus) status!: InvoiceStatus
}

const uuid = new ParseUUIDPipe({ version: '4' })

@ApiTags('corporate')
@Controller('companies')
export class CorporateController {
  constructor(private readonly corporate: CorporateService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.corporate.list(user)
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.corporate.get(id, user)
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string, @Body() dto: UpdateCompanyDto) {
    return this.corporate.update(id, user, dto)
  }

  @Post(':id/employees')
  addEmployee(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string, @Body() dto: EmployeeDto) {
    return this.corporate.addEmployee(id, user, dto)
  }

  @Delete(':id/employees/:userId')
  @HttpCode(204)
  removeEmployee(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Param('userId', uuid) userId: string,
  ) {
    return this.corporate.removeEmployee(id, user, userId)
  }

  @Get(':id/menu')
  menu(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.corporate.menuFor(id, user)
  }

  @Post(':id/orders')
  order(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string, @Body() dto: CorporateOrderDto) {
    return this.corporate.placeOrder(id, user, dto)
  }

  @Get(':id/orders')
  orders(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string, @Query() filter: OrdersFilterDto) {
    return this.corporate.orders(id, user, filter)
  }

  @Post('orders/:orderId/stop-recurrence')
  @HttpCode(204)
  stopRecurrence(@CurrentUser() user: AuthUser, @Param('orderId', uuid) orderId: string) {
    return this.corporate.stopRecurrence(orderId, user)
  }

  @Post(':id/invoices')
  invoice(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string, @Body() dto: InvoiceRequestDto) {
    return this.corporate.generateInvoice(id, user, dto.periodStart, dto.periodEnd)
  }

  @Get(':id/invoices')
  invoices(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.corporate.invoices(id, user)
  }
}

@ApiTags('admin/corporate')
@Roles('MANAGER')
@Controller('admin/companies')
export class AdminCorporateController {
  constructor(private readonly corporate: CorporateService) {}

  @Post()
  create(@Body() dto: CreateCompanyDto) {
    return this.corporate.create(dto)
  }

  @Put(':id/prices')
  prices(@Param('id', uuid) id: string, @Body() dto: PricesDto) {
    return this.corporate.setPrices(id, dto.prices)
  }

  @Patch('orders/:orderId/status')
  orderStatus(@Param('orderId', uuid) orderId: string, @Body() dto: OrderStatusDto) {
    return this.corporate.setOrderStatus(orderId, dto.status)
  }

  @Patch('invoices/:invoiceId/status')
  invoiceStatus(@Param('invoiceId', uuid) invoiceId: string, @Body() dto: InvoiceStatusDto) {
    return this.corporate.setInvoiceStatus(invoiceId, dto.status)
  }
}

@Module({
  imports: [MenuModule],
  controllers: [CorporateController, AdminCorporateController],
  providers: [CorporateService],
})
export class CorporateModule {}
