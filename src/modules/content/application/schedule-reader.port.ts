// Port public du module contenus : horaires, fermetures et capacité, lus par les réservations.
export const SCHEDULE_READER = Symbol('SCHEDULE_READER')

export interface DaySchedule {
  isOpen: boolean
  opensAt: string
  closesAt: string
  closureReason: string | null
}

export interface ScheduleReader {
  dayFor(date: Date): Promise<DaySchedule>
  reservationSettings(): Promise<ReservationSettings>
}

export interface ReservationSettings {
  /** Couverts maximum par créneau de 30 minutes. */
  capacityPerSlot: number
  /** Délai minimal avant l'arrivée, en minutes. */
  minNoticeMinutes: number
  /** Réservation possible jusqu'à N jours à l'avance. */
  maxDaysAhead: number
  /** Dernière arrivée N minutes avant la fermeture. */
  lastSeatingBeforeCloseMinutes: number
}
