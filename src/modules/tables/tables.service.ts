import { Injectable, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import type { TableStatus, TableZone } from '@prisma/client'
import { randomBytes } from 'node:crypto'
import { AppConfig } from '../../infrastructure/config/app-config.service'
import { PrismaService } from '../../infrastructure/prisma/prisma.service'
import { RealtimeGateway } from '../../infrastructure/realtime/realtime.gateway'
import { ConflictError, NotFoundError, ValidationError } from '../../shared/domain/domain-error'
import { Events, type OrderPlacedEvent, type OrderStatusChangedEvent } from '../../shared/events'
import { PlaceTableOrderUseCase } from '../orders/application/use-cases/place-table-order.use-case'
import type { RequestedItem } from '../orders/domain/order.entity'

const newQrToken = () => randomBytes(16).toString('base64url')
const WAITER_CALL_COOLDOWN_MS = 2 * 60 * 1000

@Injectable()
export class TablesService {
  private readonly logger = new Logger(TablesService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly realtime: RealtimeGateway,
    private readonly placeTableOrder: PlaceTableOrderUseCase,
  ) {}

  qrUrl(qrToken: string): string {
    return `${this.config.get('WEB_URL')}/table/${qrToken}`
  }

  // ───────── Parcours client (QR code)

  async publicTable(qrToken: string) {
    const table = await this.byToken(qrToken)
    return { number: table.number, capacity: table.capacity, zone: table.zone }
  }

  async order(
    qrToken: string,
    customerId: string | null,
    input: { items: RequestedItem[]; customerName?: string; customerPhone?: string; specialRequests?: string },
  ) {
    const table = await this.byToken(qrToken)
    return this.placeTableOrder.execute({ tableId: table.id, customerId, ...input })
  }

  async callWaiter(qrToken: string) {
    const table = await this.byToken(qrToken)
    const recent = await this.prisma.waiterCall.findFirst({
      where: {
        tableId: table.id,
        acknowledgedAt: null,
        createdAt: { gt: new Date(Date.now() - WAITER_CALL_COOLDOWN_MS) },
      },
    })
    if (recent) return { tableNumber: table.number, alreadyCalled: true }

    const call = await this.prisma.waiterCall.create({ data: { tableId: table.id } })
    this.realtime.toStaff('waiter:called', { id: call.id, tableNumber: table.number, at: call.createdAt })
    return { tableNumber: table.number, alreadyCalled: false }
  }

  // ───────── Gestion (personnel)

  async list() {
    const tables = await this.prisma.table.findMany({
      orderBy: { number: 'asc' },
      include: {
        orders: {
          where: { status: { notIn: ['COMPLETED', 'CANCELLED'] } },
          select: { id: true, number: true, status: true, total: true, createdAt: true },
        },
      },
    })
    return tables.map((t) => ({ ...t, qrUrl: this.qrUrl(t.qrToken) }))
  }

  async create(input: { number: number; capacity?: number; zone?: TableZone }) {
    if (await this.prisma.table.findUnique({ where: { number: input.number } })) {
      throw new ConflictError(`La table ${input.number} existe déjà`)
    }
    const table = await this.prisma.table.create({ data: { ...input, qrToken: newQrToken() } })
    return { ...table, qrUrl: this.qrUrl(table.qrToken) }
  }

  async update(
    id: string,
    input: { capacity?: number; zone?: TableZone; status?: TableStatus; isActive?: boolean },
  ) {
    await this.find(id)
    const table = await this.prisma.table.update({ where: { id }, data: input })
    return { ...table, qrUrl: this.qrUrl(table.qrToken) }
  }

  /** Nouveau QR code : l'ancien cesse immédiatement de fonctionner. */
  async regenerateQr(id: string) {
    await this.find(id)
    const table = await this.prisma.table.update({ where: { id }, data: { qrToken: newQrToken() } })
    return { ...table, qrUrl: this.qrUrl(table.qrToken) }
  }

  async remove(id: string): Promise<void> {
    await this.find(id)
    const active = await this.prisma.order.count({
      where: { tableId: id, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
    })
    if (active > 0) throw new ConflictError('Des commandes sont en cours sur cette table')
    await this.prisma.table.delete({ where: { id } })
  }

  orders(id: string) {
    return this.prisma.order.findMany({
      where: { tableId: id },
      include: { items: true, payment: { select: { status: true, provider: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
  }

  waiterCalls() {
    return this.prisma.waiterCall.findMany({
      where: { acknowledgedAt: null, createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) } },
      include: { table: { select: { number: true, zone: true } } },
      orderBy: { createdAt: 'asc' },
    })
  }

  async acknowledge(id: string): Promise<void> {
    const { count } = await this.prisma.waiterCall.updateMany({
      where: { id, acknowledgedAt: null },
      data: { acknowledgedAt: new Date() },
    })
    if (count === 0) throw new NotFoundError('Appel')
    this.realtime.toStaff('waiter:acknowledged', { id })
  }

  // ───────── Statut automatique des tables

  @OnEvent(Events.OrderPlaced, { async: true })
  async onOrderPlaced(e: OrderPlacedEvent): Promise<void> {
    if (e.type !== 'DINE_IN') return
    try {
      const order = await this.prisma.order.findUnique({ where: { id: e.orderId }, select: { tableId: true } })
      if (order?.tableId) {
        await this.prisma.table.update({ where: { id: order.tableId }, data: { status: 'OCCUPIED' } })
      }
    } catch (error) {
      this.logger.error('Mise à jour du statut de table impossible', error as Error)
    }
  }

  @OnEvent(Events.OrderStatusChanged, { async: true })
  async onOrderStatusChanged(e: OrderStatusChangedEvent): Promise<void> {
    if (e.type !== 'DINE_IN' || !['COMPLETED', 'CANCELLED'].includes(e.to)) return
    try {
      const order = await this.prisma.order.findUnique({ where: { id: e.orderId }, select: { tableId: true } })
      if (!order?.tableId) return
      const active = await this.prisma.order.count({
        where: { tableId: order.tableId, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      })
      if (active === 0) {
        await this.prisma.table.update({ where: { id: order.tableId }, data: { status: 'CLEANING' } })
      }
    } catch (error) {
      this.logger.error('Libération de la table impossible', error as Error)
    }
  }

  private async byToken(qrToken: string) {
    if (!/^[A-Za-z0-9_-]{10,64}$/.test(qrToken)) throw new ValidationError('QR code invalide')
    const table = await this.prisma.table.findUnique({ where: { qrToken } })
    if (!table || !table.isActive) throw new NotFoundError('Table')
    return table
  }

  private async find(id: string) {
    const table = await this.prisma.table.findUnique({ where: { id } })
    if (!table) throw new NotFoundError('Table')
    return table
  }
}
