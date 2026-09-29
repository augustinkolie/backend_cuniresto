import { Inject, Injectable } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import type { Prisma, ReservationStatus } from '@prisma/client'
import { AppConfig } from '../../../infrastructure/config/app-config.service'
import { MailService } from '../../../infrastructure/mail/mail.service'
import { mailTemplates } from '../../../infrastructure/mail/mail-templates'
import { PrismaService } from '../../../infrastructure/prisma/prisma.service'
import { RealtimeGateway } from '../../../infrastructure/realtime/realtime.gateway'
import type { AuthUser } from '../../../shared/auth/auth-user'
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/domain/domain-error'
import { Events, type ReservationEvent } from '../../../shared/events'
import { SCHEDULE_READER, type ScheduleReader } from '../../content/application/schedule-reader.port'
import {
  arrivalInstant,
  assertBookable,
  isValidDateString,
  remainingCovers,
  slotsFor,
} from '../domain/reservation-policy'

export interface CreateReservationInput {
  firstName: string
  lastName: string
  email: string
  phone: string
  date: string
  timeSlot: string
  partySize: number
  message?: string
}

const ACTIVE: ReservationStatus[] = ['PENDING', 'CONFIRMED']
const formatDate = (d: Date) =>
  d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

@Injectable()
export class ReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(SCHEDULE_READER) private readonly schedule: ScheduleReader,
    private readonly mail: MailService,
    private readonly config: AppConfig,
    private readonly realtime: RealtimeGateway,
    private readonly events: EventEmitter2,
  ) {}

  /** Créneaux du jour avec les couverts restants (widget de réservation). */
  async availability(date: string, partySize = 2) {
    if (!isValidDateString(date)) throw new ValidationError('Date invalide')
    const day = await this.schedule.dayFor(new Date(`${date}T00:00:00Z`))
    const settings = await this.schedule.reservationSettings()
    const booked = await this.bookedBySlot(date)
    const now = Date.now()

    const slots = slotsFor(day, settings.lastSeatingBeforeCloseMinutes).map((time) => {
      const remaining = remainingCovers(settings.capacityPerSlot, booked.get(time) ?? 0)
      const tooSoon = arrivalInstant(date, time).getTime() < now + settings.minNoticeMinutes * 60_000
      return { time, remaining, available: !tooSoon && remaining >= partySize }
    })
    return { date, isOpen: day.isOpen, closureReason: day.closureReason, slots }
  }

  async create(input: CreateReservationInput, userId: string | null) {
    const day = await this.schedule.dayFor(new Date(`${input.date}T00:00:00Z`))
    const settings = await this.schedule.reservationSettings()

    // Sérialisable : deux demandes simultanées ne peuvent pas dépasser la capacité du créneau.
    const reservation = await this.prisma.$transaction(
      async (tx) => {
        const booked = await tx.reservation.aggregate({
          where: { date: new Date(input.date), timeSlot: input.timeSlot, status: { in: ACTIVE } },
          _sum: { partySize: true },
        })
        assertBookable({
          date: input.date,
          timeSlot: input.timeSlot,
          partySize: input.partySize,
          now: new Date(),
          day,
          settings,
          bookedCovers: booked._sum.partySize ?? 0,
        })
        return tx.reservation.create({
          data: {
            userId,
            firstName: input.firstName.trim(),
            lastName: input.lastName.trim(),
            email: input.email.trim().toLowerCase(),
            phone: input.phone.trim(),
            date: new Date(input.date),
            timeSlot: input.timeSlot,
            partySize: input.partySize,
            message: input.message?.trim() || null,
          },
        })
      },
      { isolationLevel: 'Serializable' },
    )

    const dateLabel = formatDate(reservation.date)
    await this.mail.send({
      to: this.config.get('ADMIN_NOTIFICATION_EMAIL'),
      ...mailTemplates.reservationReceivedAdmin({ ...reservation, date: dateLabel }),
    })
    await this.mail.send({
      to: reservation.email,
      ...mailTemplates.reservationStatus(reservation.firstName, dateLabel, reservation.timeSlot, 'PENDING'),
    })
    this.realtime.toStaff('reservation:created', { id: reservation.id })
    this.events.emit(Events.ReservationCreated, {
      reservationId: reservation.id,
      status: reservation.status,
    } satisfies ReservationEvent)
    return reservation
  }

  mine(userId: string) {
    return this.prisma.reservation.findMany({
      where: { userId },
      orderBy: [{ date: 'desc' }, { timeSlot: 'desc' }],
      include: { table: { select: { number: true } } },
    })
  }

  async cancelOwn(id: string, user: AuthUser) {
    const reservation = await this.prisma.reservation.findFirst({ where: { id, userId: user.id } })
    if (!reservation) throw new NotFoundError('Réservation')
    if (!ACTIVE.includes(reservation.status)) throw new ConflictError('Réservation déjà clôturée')
    return this.setStatus(id, 'CANCELLED')
  }

  list(filters: { date?: string; status?: ReservationStatus }) {
    const where: Prisma.ReservationWhereInput = {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.date && isValidDateString(filters.date) ? { date: new Date(filters.date) } : {}),
    }
    return this.prisma.reservation.findMany({
      where,
      include: {
        table: { select: { id: true, number: true } },
        user: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: [{ date: 'asc' }, { timeSlot: 'asc' }],
      take: 500,
    })
  }

  /** Planning : réservations d'une journée groupées par créneau, avec les couverts. */
  async planning(date: string) {
    const [availability, reservations] = await Promise.all([
      this.availability(date, 1),
      this.list({ date }),
    ])
    return {
      ...availability,
      slots: availability.slots.map((s) => ({
        ...s,
        reservations: reservations.filter((r) => r.timeSlot === s.time && r.status !== 'CANCELLED'),
      })),
    }
  }

  async manage(id: string, input: { status?: ReservationStatus; tableId?: string | null }) {
    const reservation = await this.prisma.reservation.findUnique({ where: { id } })
    if (!reservation) throw new NotFoundError('Réservation')
    if (input.tableId) {
      const table = await this.prisma.table.findUnique({ where: { id: input.tableId } })
      if (!table) throw new NotFoundError('Table')
      if (table.capacity < reservation.partySize) {
        throw new ValidationError(`La table ${table.number} n’accueille que ${table.capacity} personnes`)
      }
    }
    if (input.tableId !== undefined) {
      await this.prisma.reservation.update({ where: { id }, data: { tableId: input.tableId } })
    }
    if (input.status && input.status !== reservation.status) return this.setStatus(id, input.status)
    return this.prisma.reservation.findUniqueOrThrow({ where: { id } })
  }

  async remove(id: string): Promise<void> {
    await this.prisma.reservation.delete({ where: { id } })
  }

  private async setStatus(id: string, status: ReservationStatus) {
    const reservation = await this.prisma.reservation.update({ where: { id }, data: { status } })
    await this.mail.send({
      to: reservation.email,
      ...mailTemplates.reservationStatus(
        reservation.firstName,
        formatDate(reservation.date),
        reservation.timeSlot,
        status,
      ),
    })
    if (reservation.userId) {
      this.realtime.toUser(reservation.userId, 'reservation:updated', { id, status })
    }
    this.realtime.toStaff('reservation:updated', { id, status })
    this.events.emit(Events.ReservationStatusChanged, {
      reservationId: id,
      status,
    } satisfies ReservationEvent)
    return reservation
  }

  private async bookedBySlot(date: string): Promise<Map<string, number>> {
    const rows = await this.prisma.reservation.groupBy({
      by: ['timeSlot'],
      where: { date: new Date(date), status: { in: ACTIVE } },
      _sum: { partySize: true },
    })
    return new Map(rows.map((r) => [r.timeSlot, r._sum.partySize ?? 0]))
  }
}
