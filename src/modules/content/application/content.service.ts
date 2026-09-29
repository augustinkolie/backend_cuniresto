import { Injectable } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import type { Prisma } from '@prisma/client'
import { PrismaService } from '../../../infrastructure/prisma/prisma.service'
import { NotFoundError, ValidationError } from '../../../shared/domain/domain-error'
import { Events } from '../../../shared/events'
import type { DaySchedule, ReservationSettings, ScheduleReader } from './schedule-reader.port'
import { CONTENT_KEYS, type ContentKey, DEFAULT_SETTINGS, type SettingKey, settingSchemas } from './settings'

export interface OpeningHoursInput {
  dayOfWeek: number
  opensAt: string
  closesAt: string
  isClosed: boolean
}

const DEFAULT_HOURS: OpeningHoursInput[] = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
  dayOfWeek: day,
  opensAt: day === 0 || day === 6 ? '10:00' : '11:00',
  closesAt: day === 0 || day === 6 ? '23:00' : '22:00',
  isClosed: false,
}))

const dateOnly = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))

@Injectable()
export class ContentService implements ScheduleReader {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  // ───────── Horaires

  async openingHours() {
    const rows = await this.prisma.openingHours.findMany({ orderBy: { dayOfWeek: 'asc' } })
    const hours = DEFAULT_HOURS.map((d) => rows.find((r) => r.dayOfWeek === d.dayOfWeek) ?? d)
    const closures = await this.prisma.closure.findMany({
      where: { date: { gte: dateOnly(new Date()) } },
      orderBy: { date: 'asc' },
      take: 20,
    })
    return { hours, closures }
  }

  async setOpeningHours(input: OpeningHoursInput[]) {
    for (const h of input) {
      if (!h.isClosed && h.opensAt >= h.closesAt) {
        throw new ValidationError(`Horaires incohérents pour le jour ${h.dayOfWeek}`)
      }
    }
    await this.prisma.$transaction(
      input.map((h) =>
        this.prisma.openingHours.upsert({ where: { dayOfWeek: h.dayOfWeek }, create: h, update: h }),
      ),
    )
    this.changed()
    return this.openingHours()
  }

  async addClosure(date: string, reason: string) {
    const closure = await this.prisma.closure.upsert({
      where: { date: new Date(date) },
      create: { date: new Date(date), reason },
      update: { reason },
    })
    this.changed()
    return closure
  }

  async removeClosure(id: string): Promise<void> {
    await this.prisma.closure.delete({ where: { id } })
    this.changed()
  }

  async dayFor(date: Date): Promise<DaySchedule> {
    const day = dateOnly(date)
    const closure = await this.prisma.closure.findUnique({ where: { date: day } })
    const row =
      (await this.prisma.openingHours.findUnique({ where: { dayOfWeek: day.getUTCDay() } })) ??
      DEFAULT_HOURS[day.getUTCDay()]!
    return {
      isOpen: !closure && !row.isClosed,
      opensAt: row.opensAt,
      closesAt: row.closesAt,
      closureReason: closure?.reason ?? null,
    }
  }

  async reservationSettings(): Promise<ReservationSettings> {
    return this.setting('reservations')
  }

  // ───────── Paramètres

  async setting<K extends SettingKey>(key: K): Promise<(typeof DEFAULT_SETTINGS)[K]> {
    const row = await this.prisma.setting.findUnique({ where: { key } })
    const parsed = row ? settingSchemas[key].safeParse(row.value) : null
    return (parsed?.success ? parsed.data : DEFAULT_SETTINGS[key]) as (typeof DEFAULT_SETTINGS)[K]
  }

  async publicSettings() {
    return { restaurant: await this.setting('restaurant') }
  }

  async allSettings() {
    return {
      restaurant: await this.setting('restaurant'),
      reservations: await this.setting('reservations'),
    }
  }

  async updateSetting(key: string, value: unknown) {
    if (!(key in settingSchemas)) throw new NotFoundError('Paramètre')
    const parsed = settingSchemas[key as SettingKey].safeParse(value)
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' ; '))
    }
    const json = parsed.data as Prisma.InputJsonValue
    await this.prisma.setting.upsert({ where: { key }, create: { key, value: json }, update: { value: json } })
    this.changed()
    return parsed.data
  }

  // ───────── Blocs de contenu

  async content(key: string) {
    this.assertContentKey(key)
    const row = await this.prisma.setting.findUnique({ where: { key: `content:${key}` } })
    return { key, value: row?.value ?? null, updatedAt: row?.updatedAt ?? null }
  }

  async updateContent(key: string, value: Record<string, unknown>) {
    this.assertContentKey(key)
    const json = value as Prisma.InputJsonValue
    await this.prisma.setting.upsert({
      where: { key: `content:${key}` },
      create: { key: `content:${key}`, value: json },
      update: { value: json },
    })
    this.changed()
    return this.content(key)
  }

  private assertContentKey(key: string): asserts key is ContentKey {
    if (!(CONTENT_KEYS as readonly string[]).includes(key)) throw new NotFoundError('Contenu')
  }

  private changed(): void {
    this.events.emit(Events.ContentUpdated)
  }
}
