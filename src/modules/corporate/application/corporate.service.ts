import { Inject, Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import type {
  BillingCycle,
  CompanyStatus,
  CorporateOrderStatus,
  InvoiceStatus,
  Prisma,
  Recurrence,
} from '@prisma/client'
import { PrismaService } from '../../../infrastructure/prisma/prisma.service'
import { type AuthUser, isManager } from '../../../shared/auth/auth-user'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../../shared/domain/domain-error'
import { MENU_READER, type MenuReader } from '../../menu/application/menu-reader.port'
import { aggregateLines, corporateUnitPrice, invoiceTotals, isDueOn } from '../domain/corporate-pricing'

export interface CompanyInput {
  name: string
  email: string
  phone: string
  street?: string
  city?: string
  contactName?: string
  contactEmail?: string
  contactPhone?: string
  discountPercent?: number
  billingCycle?: BillingCycle
  paymentTermsDays?: number
  status?: CompanyStatus
  subscriptionEnd?: string | null
}

export interface CorporateOrderInput {
  items: Array<{ dishId: string; quantity: number }>
  deliveryStreet?: string
  deliveryCity?: string
  deliveryDate?: string
  recurrence?: Recurrence
  recurrenceDays?: number[]
  notes?: string
}

type Access = 'platform' | 'admin' | 'employee'

const companyInclude = {
  admin: { select: { id: true, firstName: true, lastName: true, email: true } },
  employees: { include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } } },
  prices: { include: { dish: { select: { id: true, name: true, price: true } } } },
} satisfies Prisma.CompanyInclude

@Injectable()
export class CorporateService {
  private readonly logger = new Logger(CorporateService.name)

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MENU_READER) private readonly menu: MenuReader,
  ) {}

  // ───────── Entreprises

  async list(user: AuthUser) {
    return this.prisma.company.findMany({
      where: isManager(user)
        ? {}
        : { OR: [{ adminId: user.id }, { employees: { some: { userId: user.id } } }] },
      include: { admin: companyInclude.admin, _count: { select: { employees: true, orders: true } } },
      orderBy: { createdAt: 'desc' },
    })
  }

  async get(id: string, user: AuthUser) {
    const access = await this.access(id, user)
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id }, include: companyInclude })
    return { ...company, access }
  }

  async create(input: CompanyInput & { adminEmail: string }) {
    const admin = await this.prisma.user.findFirst({
      where: { email: input.adminEmail.toLowerCase(), deletedAt: null },
    })
    if (!admin) throw new ValidationError('Aucun compte ne correspond à l’e-mail du responsable')
    const { adminEmail: _ignored, subscriptionEnd, ...data } = input
    return this.prisma.company.create({
      data: {
        ...data,
        email: data.email.toLowerCase(),
        adminId: admin.id,
        subscriptionEnd: subscriptionEnd ? new Date(subscriptionEnd) : null,
        employees: { create: { userId: admin.id, position: 'Responsable' } },
      },
      include: companyInclude,
    })
  }

  async update(id: string, user: AuthUser, input: Partial<CompanyInput>) {
    const access = await this.access(id, user)
    if (access === 'employee') throw new ForbiddenError('Réservé au responsable de l’entreprise')
    // Les conditions commerciales ne sont modifiables que par le restaurant.
    const { discountPercent, status, paymentTermsDays, subscriptionEnd, ...contact } = input
    const data: Prisma.CompanyUpdateInput =
      access === 'platform'
        ? {
            ...contact,
            discountPercent,
            status,
            paymentTermsDays,
            subscriptionEnd: subscriptionEnd === undefined ? undefined : subscriptionEnd ? new Date(subscriptionEnd) : null,
          }
        : contact
    return this.prisma.company.update({ where: { id }, data, include: companyInclude })
  }

  async addEmployee(
    id: string,
    user: AuthUser,
    input: { email: string; employeeCode?: string; department?: string; position?: string },
  ) {
    await this.assertAdmin(id, user)
    const employee = await this.prisma.user.findFirst({ where: { email: input.email.toLowerCase(), deletedAt: null } })
    if (!employee) throw new ValidationError('Aucun compte ne correspond à cet e-mail')
    const { email: _ignored, ...details } = input
    await this.prisma.companyEmployee.upsert({
      where: { companyId_userId: { companyId: id, userId: employee.id } },
      create: { companyId: id, userId: employee.id, ...details },
      update: details,
    })
    return this.get(id, user)
  }

  async removeEmployee(id: string, user: AuthUser, userId: string): Promise<void> {
    await this.assertAdmin(id, user)
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id } })
    if (company.adminId === userId) throw new ConflictError('Le responsable ne peut pas être retiré')
    await this.prisma.companyEmployee.delete({ where: { companyId_userId: { companyId: id, userId } } })
  }

  async setPrices(id: string, prices: Array<{ dishId: string; price: number }>) {
    await this.prisma.$transaction([
      this.prisma.companyPrice.deleteMany({ where: { companyId: id } }),
      this.prisma.companyPrice.createMany({ data: prices.map((p) => ({ ...p, companyId: id })) }),
    ])
    return this.prisma.companyPrice.findMany({ where: { companyId: id }, include: { dish: { select: { name: true, price: true } } } })
  }

  /** Carte avec les prix appliqués à l'entreprise. */
  async menuFor(id: string, user: AuthUser) {
    await this.access(id, user)
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id }, include: { prices: true } })
    const dishes = await this.prisma.dish.findMany({
      where: { deletedAt: null, isAvailable: true },
      select: { id: true, name: true, price: true, imageUrl: true, imageAlt: true, category: { select: { name: true } } },
      orderBy: { name: 'asc' },
    })
    return dishes.map((d) => ({
      ...d,
      corporatePrice: corporateUnitPrice(
        d.price,
        company.discountPercent,
        company.prices.find((p) => p.dishId === d.id)?.price,
      ),
    }))
  }

  // ───────── Commandes

  async placeOrder(id: string, user: AuthUser, input: CorporateOrderInput) {
    await this.access(id, user)
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id }, include: { prices: true } })
    if (company.status !== 'ACTIVE') throw new ConflictError('Le compte entreprise n’est pas actif')
    if (input.items.length === 0) throw new ValidationError('Commande vide')
    if (input.recurrence === 'WEEKLY' && input.recurrenceDays?.some((d) => d < 0 || d > 6)) {
      throw new ValidationError('Jours de récurrence invalides')
    }

    const dishes = await this.menu.findByIds(input.items.map((i) => i.dishId))
    const lines = input.items.map((item) => {
      const dish = dishes.find((d) => d.id === item.dishId)
      if (!dish || !dish.isAvailable) throw new ConflictError('Un plat n’est plus disponible')
      const unitPrice = corporateUnitPrice(
        dish.price,
        company.discountPercent,
        company.prices.find((p) => p.dishId === dish.id)?.price,
      )
      return { dishId: dish.id, nameSnapshot: dish.name, unitPrice, quantity: item.quantity }
    })

    return this.prisma.corporateOrder.create({
      data: {
        companyId: id,
        employeeId: user.id,
        total: lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0),
        deliveryStreet: input.deliveryStreet ?? company.street,
        deliveryCity: input.deliveryCity ?? company.city,
        deliveryDate: input.deliveryDate ? new Date(input.deliveryDate) : null,
        recurrence: input.recurrence ?? 'NONE',
        recurrenceDays: input.recurrenceDays ?? [],
        lastGeneratedAt: input.recurrence && input.recurrence !== 'NONE' ? new Date() : null,
        notes: input.notes,
        items: { create: lines },
      },
      include: { items: true },
    })
  }

  async orders(id: string, user: AuthUser, filters: { status?: CorporateOrderStatus; from?: string; to?: string }) {
    const access = await this.access(id, user)
    return this.prisma.corporateOrder.findMany({
      where: {
        companyId: id,
        ...(access === 'employee' ? { employeeId: user.id } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.from || filters.to
          ? {
              createdAt: {
                ...(filters.from ? { gte: new Date(filters.from) } : {}),
                ...(filters.to ? { lte: new Date(filters.to) } : {}),
              },
            }
          : {}),
      },
      include: {
        items: true,
        employee: { select: { firstName: true, lastName: true } },
        invoice: { select: { number: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    })
  }

  async setOrderStatus(orderId: string, status: CorporateOrderStatus) {
    const order = await this.prisma.corporateOrder.findUnique({ where: { id: orderId } })
    if (!order) throw new NotFoundError('Commande entreprise')
    if (order.invoiceId && status === 'CANCELLED') throw new ConflictError('Commande déjà facturée')
    return this.prisma.corporateOrder.update({ where: { id: orderId }, data: { status } })
  }

  async stopRecurrence(orderId: string, user: AuthUser): Promise<void> {
    const order = await this.prisma.corporateOrder.findUnique({ where: { id: orderId } })
    if (!order) throw new NotFoundError('Commande entreprise')
    const access = await this.access(order.companyId, user)
    if (access === 'employee' && order.employeeId !== user.id) throw new ForbiddenError('Accès refusé')
    await this.prisma.corporateOrder.update({ where: { id: orderId }, data: { recurrence: 'NONE' } })
  }

  // ───────── Factures

  async generateInvoice(id: string, user: AuthUser, periodStart: string, periodEnd: string) {
    const access = await this.access(id, user)
    if (access === 'employee') throw new ForbiddenError('Réservé au responsable de l’entreprise')
    const start = new Date(periodStart)
    const end = new Date(periodEnd)
    if (start >= end) throw new ValidationError('Période invalide')
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id } })

    return this.prisma.$transaction(async (tx) => {
      const orders = await tx.corporateOrder.findMany({
        where: { companyId: id, invoiceId: null, status: { not: 'CANCELLED' }, createdAt: { gte: start, lte: end } },
        include: { items: true },
      })
      if (orders.length === 0) throw new ValidationError('Aucune commande à facturer sur cette période')

      const lines = aggregateLines(
        orders.flatMap((o) => o.items.map((i) => ({ name: i.nameSnapshot, unitPrice: i.unitPrice, quantity: i.quantity }))),
      )
      const totals = invoiceTotals(lines)
      const year = new Date().getUTCFullYear()
      const count = await tx.corporateInvoice.count({ where: { number: { startsWith: `FAC-${year}-` } } })
      const dueDate = new Date(end.getTime() + company.paymentTermsDays * 86_400_000)

      const invoice = await tx.corporateInvoice.create({
        data: {
          number: `FAC-${year}-${String(count + 1).padStart(5, '0')}`,
          companyId: id,
          periodStart: start,
          periodEnd: end,
          ...totals,
          dueDate,
          lines: lines as unknown as Prisma.InputJsonValue,
        },
      })
      await tx.corporateOrder.updateMany({
        where: { id: { in: orders.map((o) => o.id) } },
        data: { invoiceId: invoice.id },
      })
      await tx.company.update({ where: { id }, data: { currentBalance: { increment: totals.total } } })
      return invoice
    })
  }

  async invoices(id: string, user: AuthUser) {
    const access = await this.access(id, user)
    if (access === 'employee') throw new ForbiddenError('Réservé au responsable de l’entreprise')
    return this.prisma.corporateInvoice.findMany({
      where: { companyId: id },
      include: { company: { select: { name: true, email: true, street: true, city: true } } },
      orderBy: { createdAt: 'desc' },
    })
  }

  async setInvoiceStatus(invoiceId: string, status: InvoiceStatus) {
    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.corporateInvoice.findUnique({ where: { id: invoiceId } })
      if (!invoice) throw new NotFoundError('Facture')
      if (invoice.status === status) return invoice
      const wasOpen = invoice.status !== 'PAID' && invoice.status !== 'CANCELLED'
      const isOpen = status !== 'PAID' && status !== 'CANCELLED'
      if (wasOpen !== isOpen) {
        await tx.company.update({
          where: { id: invoice.companyId },
          data: { currentBalance: { [isOpen ? 'increment' : 'decrement']: invoice.total } },
        })
      }
      if (status === 'CANCELLED') {
        await tx.corporateOrder.updateMany({ where: { invoiceId }, data: { invoiceId: null } })
      }
      return tx.corporateInvoice.update({
        where: { id: invoiceId },
        data: { status, paidAt: status === 'PAID' ? new Date() : null },
      })
    })
  }

  /** Chaque matin à 6 h : génération des commandes récurrentes du jour. */
  @Cron('0 6 * * *', { timeZone: 'Africa/Conakry' })
  async generateRecurring(): Promise<void> {
    const today = new Date()
    const startOfDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
    const templates = await this.prisma.corporateOrder.findMany({
      where: {
        recurrence: { not: 'NONE' },
        status: { not: 'CANCELLED' },
        company: { status: 'ACTIVE' },
        OR: [{ lastGeneratedAt: null }, { lastGeneratedAt: { lt: startOfDay } }],
      },
      include: { items: true },
    })
    for (const t of templates) {
      if (!isDueOn(startOfDay, t.recurrence, t.recurrenceDays, t.createdAt)) continue
      try {
        await this.prisma.$transaction([
          this.prisma.corporateOrder.create({
            data: {
              companyId: t.companyId,
              employeeId: t.employeeId,
              total: t.total,
              deliveryStreet: t.deliveryStreet,
              deliveryCity: t.deliveryCity,
              deliveryDate: startOfDay,
              notes: t.notes,
              parentOrderId: t.id,
              items: {
                create: t.items.map((i) => ({
                  dishId: i.dishId,
                  nameSnapshot: i.nameSnapshot,
                  unitPrice: i.unitPrice,
                  quantity: i.quantity,
                })),
              },
            },
          }),
          this.prisma.corporateOrder.update({ where: { id: t.id }, data: { lastGeneratedAt: new Date() } }),
        ])
      } catch (error) {
        this.logger.error(`Commande récurrente ${t.id} non générée`, error as Error)
      }
    }
  }

  private async access(id: string, user: AuthUser): Promise<Access> {
    const company = await this.prisma.company.findUnique({
      where: { id },
      include: { employees: { where: { userId: user.id }, select: { userId: true } } },
    })
    if (!company) throw new NotFoundError('Entreprise')
    if (isManager(user)) return 'platform'
    if (company.adminId === user.id) return 'admin'
    if (company.employees.length > 0) return 'employee'
    throw new ForbiddenError('Accès refusé')
  }

  private async assertAdmin(id: string, user: AuthUser): Promise<void> {
    if ((await this.access(id, user)) === 'employee') {
      throw new ForbiddenError('Réservé au responsable de l’entreprise')
    }
  }
}
