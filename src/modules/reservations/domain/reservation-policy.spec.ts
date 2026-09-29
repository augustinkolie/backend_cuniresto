import { ValidationError } from '../../../shared/domain/domain-error'
import { assertBookable, slotsFor } from './reservation-policy'

const day = { isOpen: true, opensAt: '11:00', closesAt: '22:00' }
const settings = { capacityPerSlot: 40, minNoticeMinutes: 60, maxDaysAhead: 60, lastSeatingBeforeCloseMinutes: 60 }
const now = new Date('2026-10-01T10:00:00Z')

describe('slotsFor', () => {
  it('propose des créneaux de 30 min jusqu’à une heure avant la fermeture', () => {
    const slots = slotsFor(day, 60)
    expect(slots[0]).toBe('11:00')
    expect(slots.at(-1)).toBe('21:00')
    expect(slots).toHaveLength(21)
  })

  it('ne propose rien un jour de fermeture', () => {
    expect(slotsFor({ ...day, isOpen: false }, 60)).toEqual([])
  })
})

describe('assertBookable', () => {
  const base = { date: '2026-10-02', timeSlot: '19:30', partySize: 4, now, day, settings, bookedCovers: 0 }

  it('accepte une demande valide', () => {
    expect(() => assertBookable(base)).not.toThrow()
  })

  it.each([
    ['date invalide', { date: '02/10/2026' }],
    ['groupe trop grand', { partySize: 25 }],
    ['créneau hors horaires', { timeSlot: '21:30' }],
    ['créneau non aligné', { timeSlot: '19:15' }],
    ['déjà passé', { date: '2026-09-30' }],
    ['délai de prévenance non respecté', { date: '2026-10-01', timeSlot: '11:00', now: new Date('2026-10-01T10:30:00Z') }],
    ['trop loin', { date: '2027-01-15' }],
    ['complet', { bookedCovers: 38 }],
    ['jour fermé', { day: { ...day, isOpen: false } }],
  ])('refuse : %s', (_label, override) => {
    expect(() => assertBookable({ ...base, ...override })).toThrow(ValidationError)
  })
})
