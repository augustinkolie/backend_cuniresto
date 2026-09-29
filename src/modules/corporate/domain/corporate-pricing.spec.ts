import { aggregateLines, corporateUnitPrice, invoiceTotals, isDueOn } from './corporate-pricing'

describe('tarifs entreprise', () => {
  it('applique le prix négocié en priorité, sinon la remise', () => {
    expect(corporateUnitPrice(15_000, 10, 12_000)).toBe(12_000)
    expect(corporateUnitPrice(15_000, 10)).toBe(13_500)
    expect(corporateUnitPrice(15_000, 0)).toBe(15_000)
  })

  it('calcule la facture avec une TVA de 18 % sans double remise', () => {
    const lines = aggregateLines([
      { name: 'Lapin braisé', unitPrice: 13_500, quantity: 2 },
      { name: 'Lapin braisé', unitPrice: 13_500, quantity: 1 },
      { name: 'Jus', unitPrice: 3_000, quantity: 2 },
    ])
    expect(lines).toHaveLength(2)
    expect(invoiceTotals(lines)).toEqual({ subtotal: 46_500, tax: 8_370, total: 54_870 })
  })
})

describe('récurrence', () => {
  const anchor = new Date('2026-01-31T00:00:00Z')

  it('génère les commandes hebdomadaires les jours choisis', () => {
    expect(isDueOn(new Date('2026-10-05T00:00:00Z'), 'WEEKLY', [1, 3], anchor)).toBe(true) // lundi
    expect(isDueOn(new Date('2026-10-06T00:00:00Z'), 'WEEKLY', [1, 3], anchor)).toBe(false)
  })

  it('reporte au dernier jour du mois une récurrence mensuelle du 31', () => {
    expect(isDueOn(new Date('2026-02-28T00:00:00Z'), 'MONTHLY', [], anchor)).toBe(true)
    expect(isDueOn(new Date('2026-03-30T00:00:00Z'), 'MONTHLY', [], anchor)).toBe(false)
    expect(isDueOn(new Date('2026-03-31T00:00:00Z'), 'MONTHLY', [], anchor)).toBe(true)
  })

  it('ne génère rien sans récurrence', () => {
    expect(isDueOn(new Date(), 'NONE', [], anchor)).toBe(false)
  })
})
