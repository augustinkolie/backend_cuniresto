import { Module } from '@nestjs/common'
import { MenuModule } from '../menu/menu.module'
import { PaymentsModule } from '../payments/payments.module'
import { OrderEventHandlers } from './application/order-event-handlers'
import { OrderQueries } from './application/order-queries'
import { ORDER_REPOSITORY } from './application/ports/order.repository'
import { TABLE_LOOKUP } from './application/ports/table-lookup'
import { ChangeOrderStatusUseCase } from './application/use-cases/change-order-status.use-case'
import { PlaceOrderUseCase } from './application/use-cases/place-order.use-case'
import { PlaceTableOrderUseCase } from './application/use-cases/place-table-order.use-case'
import { PrismaOrderRepository } from './infrastructure/prisma-order.repository'
import { AdminOrdersController, OrdersController } from './presentation/orders.controller'

@Module({
  imports: [MenuModule, PaymentsModule],
  controllers: [OrdersController, AdminOrdersController],
  providers: [
    PrismaOrderRepository,
    { provide: ORDER_REPOSITORY, useExisting: PrismaOrderRepository },
    { provide: TABLE_LOOKUP, useExisting: PrismaOrderRepository },
    PlaceOrderUseCase,
    PlaceTableOrderUseCase,
    ChangeOrderStatusUseCase,
    OrderQueries,
    OrderEventHandlers,
  ],
  exports: [PlaceTableOrderUseCase, ChangeOrderStatusUseCase, OrderQueries],
})
export class OrdersModule {}
