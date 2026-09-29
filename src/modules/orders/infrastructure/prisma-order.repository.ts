import { Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { PrismaService } from '../../../infrastructure/prisma/prisma.service'
import { ConflictError } from '../../../shared/domain/domain-error'
import type { OrderRepository } from '../application/ports/order.repository'
import type { TableLookup } from '../application/ports/table-lookup'
import { Order } from '../domain/order.entity'

type OrderRow = Prisma.OrderGetPayload<{ include: { items: true } }>

@Injectable()
export class PrismaOrderRepository implements OrderRepository, TableLookup {
  constructor(private readonly prisma: PrismaService) {}

  async create(order: Order): Promise<void> {
    const s = order.snapshot()
    const created = await this.prisma.$transaction(async (tx) => {
      // Décrément conditionnel : aucune survente même avec des commandes simultanées.
      for (const line of s.lines) {
        if (!line.dishId) continue
        const { count } = await tx.dish.updateMany({
          where: { id: line.dishId, stock: { gte: line.quantity }, isAvailable: true, deletedAt: null },
          data: { stock: { decrement: line.quantity } },
        })
        if (count === 0) throw new ConflictError(`Stock insuffisant pour « ${line.name} »`)
      }
      return tx.order.create({
        data: {
          userId: s.customerId,
          type: s.type,
          status: s.status,
          subtotal: s.subtotal,
          deliveryFee: s.deliveryFee,
          deliveryMode: s.deliveryMode,
          total: s.total,
          contactName: s.contactName,
          contactPhone: s.contactPhone,
          deliveryStreet: s.deliveryStreet,
          deliveryCity: s.deliveryCity,
          tableId: s.tableId,
          instructions: s.instructions,
          tastePreferences: s.tastePreferences,
          items: {
            create: s.lines.map((l) => ({
              dishId: l.dishId,
              nameSnapshot: l.name,
              unitPrice: l.unitPrice,
              quantity: l.quantity,
              imageUrl: l.imageUrl,
              notes: l.notes,
            })),
          },
        },
        select: { id: true, number: true },
      })
    })
    order.assignIdentity(created.id, created.number)
  }

  async findById(id: string): Promise<Order | null> {
    const row = await this.prisma.order.findUnique({ where: { id }, include: { items: true } })
    return row ? toDomain(row) : null
  }

  async saveStatus(order: Order, previous: Order['status']): Promise<void> {
    const s = order.snapshot()
    const now = new Date()
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({
        where: { id: order.id, status: previous },
        data: {
          status: s.status,
          ...(s.status === 'CANCELLED' ? { cancelledAt: now } : {}),
          ...(s.status === 'SERVED' ? { servedAt: now } : {}),
          ...(['COMPLETED', 'DELIVERED'].includes(s.status) ? { completedAt: now } : {}),
        },
      })
      if (count === 0) throw new ConflictError('La commande a été modifiée entre-temps, rechargez-la')

      if (s.status === 'CANCELLED') {
        for (const line of s.lines) {
          if (!line.dishId) continue
          await tx.dish.update({
            where: { id: line.dishId },
            data: { stock: { increment: line.quantity } },
          })
        }
      }
    })
  }

  async qrTokenForOrder(orderId: string): Promise<string | null> {
    const row = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { table: { select: { qrToken: true } } },
    })
    return row?.table?.qrToken ?? null
  }
}

function toDomain(row: OrderRow): Order {
  return Order.restore({
    id: row.id,
    number: row.number,
    customerId: row.userId,
    type: row.type,
    status: row.status,
    lines: row.items.map((i) => ({
      dishId: i.dishId,
      name: i.nameSnapshot,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
      imageUrl: i.imageUrl,
      notes: i.notes,
    })),
    subtotal: row.subtotal,
    deliveryFee: row.deliveryFee,
    deliveryMode: row.deliveryMode,
    total: row.total,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    deliveryStreet: row.deliveryStreet,
    deliveryCity: row.deliveryCity,
    tableId: row.tableId,
    instructions: row.instructions,
    tastePreferences: row.tastePreferences,
  })
}
