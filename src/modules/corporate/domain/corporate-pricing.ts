// Règles tarifaires et de facturation B2B.

export const VAT_RATE_PERCENT = 18

/** Prix négocié s'il existe, sinon remise de l'entreprise appliquée au prix public. */
export function corporateUnitPrice(publicPrice: number, discountPercent: number, customPrice?: number): number {
  if (customPrice !== undefined) return customPrice
  return Math.round((publicPrice * (100 - discountPercent)) / 100)
}

export interface InvoiceLine {
  description: string
  quantity: number
  unitPrice: number
  total: number
}

/**
 * Les prix des commandes intègrent déjà la remise : la facture n'en applique pas une seconde
 * fois (l'ancien système remisait deux fois).
 */
export function invoiceTotals(lines: InvoiceLine[]): { subtotal: number; tax: number; total: number } {
  const subtotal = lines.reduce((sum, l) => sum + l.total, 0)
  const tax = Math.round((subtotal * VAT_RATE_PERCENT) / 100)
  return { subtotal, tax, total: subtotal + tax }
}

/** Regroupe les articles de plusieurs commandes par désignation et prix. */
export function aggregateLines(
  items: Array<{ name: string; unitPrice: number; quantity: number }>,
): InvoiceLine[] {
  const map = new Map<string, InvoiceLine>()
  for (const item of items) {
    const key = `${item.name}|${item.unitPrice}`
    const line = map.get(key) ?? { description: item.name, quantity: 0, unitPrice: item.unitPrice, total: 0 }
    line.quantity += item.quantity
    line.total = line.quantity * line.unitPrice
    map.set(key, line)
  }
  return [...map.values()]
}

export type Recurrence = 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY'

/** Une commande récurrente doit-elle être générée ce jour-là ? (jours : 0 = dimanche) */
export function isDueOn(
  day: Date,
  recurrence: Recurrence,
  recurrenceDays: number[],
  anchor: Date,
): boolean {
  switch (recurrence) {
    case 'DAILY':
      return true
    case 'WEEKLY':
      return recurrenceDays.length > 0 ? recurrenceDays.includes(day.getUTCDay()) : day.getUTCDay() === anchor.getUTCDay()
    case 'MONTHLY': {
      const lastDay = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0)).getUTCDate()
      return day.getUTCDate() === Math.min(anchor.getUTCDate(), lastDay)
    }
    default:
      return false
  }
}
