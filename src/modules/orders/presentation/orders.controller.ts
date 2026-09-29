import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { PrismaService } from '../../../infrastructure/prisma/prisma.service'
import type { AuthUser } from '../../../shared/auth/auth-user'
import { CurrentUser, Public, Roles } from '../../../shared/auth/decorators'
import { deliveryFee, deliveryMinutes } from '../../../shared/domain/delivery-pricing'
import { CursorQueryDto } from '../../../shared/http/pagination'
import { OrderQueries } from '../application/order-queries'
import { ChangeOrderStatusUseCase } from '../application/use-cases/change-order-status.use-case'
import { PlaceOrderUseCase } from '../application/use-cases/place-order.use-case'
import { ChangeStatusDto, DeliveryEstimateDto, OrdersFilterDto, PlaceOrderDto } from './orders.dto'

const uuid = new ParseUUIDPipe({ version: '4' })

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly placeOrder: PlaceOrderUseCase,
    private readonly changeStatus: ChangeOrderStatusUseCase,
    private readonly queries: OrderQueries,
    private readonly prisma: PrismaService,
  ) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  async place(@CurrentUser() user: AuthUser, @Body() dto: PlaceOrderDto) {
    const { email } = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { email: true },
    })
    return this.placeOrder.execute({ ...dto, customerId: user.id, customerEmail: email })
  }

  @Public()
  @Get('delivery-estimate')
  estimate(@Query() dto: DeliveryEstimateDto) {
    return {
      mode: dto.mode,
      fee: deliveryFee(dto.mode, dto.distanceKm),
      estimatedMinutes: deliveryMinutes(dto.mode, dto.distanceKm),
    }
  }

  @Get('me')
  mine(@CurrentUser() user: AuthUser, @Query() query: CursorQueryDto) {
    return this.queries.mine(user.id, query)
  }

  @Get(':id')
  one(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.queries.byId(id, user)
  }

  @Get(':id/reorder')
  reorder(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.queries.reorderItems(id, user.id)
  }

  @Post(':id/cancel')
  @HttpCode(204)
  cancel(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.changeStatus.execute(id, 'CANCELLED', { kind: 'user', ...user })
  }
}

@ApiTags('admin/orders')
@Roles('MANAGER', 'KITCHEN', 'WAITER')
@Controller('admin/orders')
export class AdminOrdersController {
  constructor(
    private readonly changeStatus: ChangeOrderStatusUseCase,
    private readonly queries: OrderQueries,
  ) {}

  @Get()
  list(@Query() filters: OrdersFilterDto) {
    return this.queries.list(filters)
  }

  @Get('kitchen')
  kitchen() {
    return this.queries.kitchen()
  }

  @Patch(':id/status')
  @HttpCode(204)
  @Roles('MANAGER', 'KITCHEN', 'WAITER', 'DRIVER')
  status(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string, @Body() dto: ChangeStatusDto) {
    return this.changeStatus.execute(id, dto.status, { kind: 'user', ...user })
  }
}
