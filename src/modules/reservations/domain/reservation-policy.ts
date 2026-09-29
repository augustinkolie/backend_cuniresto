import { ValidationError } from '../../../shared/domain/domain-error'

// Conakry est à UTC+0 toute l'année (pas d'heure d'été) : les heures locales sont traitées en UTC.

export const SLOT_MINUTES = 30
export const MIN_PARTY = 1
export const MAX_PARTY = 20

export interface ScheduleForDay {
  isOpen: boolean
  opensAt: string
  closesAt: string
}

export interface PolicySettings {
  capacityPerSlot: number
  minNoticeMinutes: number
  maxDaysAhead: number
  lastSeatingBeforeCloseMinutes: number
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}
const toHhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

/** Créneaux d'arrivée d'une journée : de l'ouverture à la dernière heure d'accueil. */
export function slotsFor(day: ScheduleForDay, lastSeatingBeforeCloseMinutes: number): string[] {
  if (!day.isOpen) return []
  const start = toMinutes(day.opensAt)
  const end = toMinutes(day.closesAt) - lastSeatingBeforeCloseMinutes
  const slots: string[] = []
  for (let t = start; t <= end; t += SLOT_MINUTES) slots.push(toHhmm(t))
  return slots
}

/** « 2026-10-02 » + « 19:30 » → instant UTC. */
export function arrivalInstant(date: string, timeSlot: string): Date {
  return new Date(`${date}T${timeSlot}:00.000Z`)
}

export function isValidDateString(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())
}

export function remainingCovers(capacity: number, booked: number): number {
  return Math.max(0, capacity - booked)
}

/** Vérifie une demande ; lève ValidationError avec un message affichable. */
export function assertBookable(input: {
  date: string
  timeSlot: string
  partySize: number
  now: Date
  day: ScheduleForDay
  settings: PolicySettings
  bookedCovers: number
}): void {
  const { date, timeSlot, partySize, now, day, settings } = input
  if (!isValidDateString(date)) throw new ValidationError('Date invalide')
  if (!Number.isInteger(partySize) || partySize < MIN_PARTY || partySize > MAX_PARTY) {
    throw new ValidationError(`De ${MIN_PARTY} à ${MAX_PARTY} personnes (au-delà, contactez-nous)`)
  }
  if (!day.isOpen) throw new ValidationError('Le restaurant est fermé ce jour-là')
  if (!slotsFor(day, settings.lastSeatingBeforeCloseMinutes).includes(timeSlot)) {
    throw new ValidationError('Ce créneau n’est pas proposé')
  }

  const arrival = arrivalInstant(date, timeSlot)
  if (arrival.getTime() < now.getTime() + settings.minNoticeMinutes * 60_000) {
    throw new ValidationError('Ce créneau est trop proche ou déjà passé')
  }
  if (arrival.getTime() > now.getTime() + settings.maxDaysAhead * 24 * 3_600_000) {
    throw new ValidationError(`Réservation possible jusqu’à ${settings.maxDaysAhead} jours à l’avance`)
  }
  if (remainingCovers(settings.capacityPerSlot, input.bookedCovers) < partySize) {
    throw new ValidationError('Ce créneau est complet, choisissez un autre horaire')
  }
}
