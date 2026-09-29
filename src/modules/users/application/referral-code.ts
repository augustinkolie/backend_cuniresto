import { randomInt } from 'node:crypto'

// Alphabet sans caractères ambigus (0/O, 1/I).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function generateReferralCode(firstName: string): string {
  const prefix = (firstName.trim()[0] ?? 'M').toUpperCase().replace(/[^A-Z]/, 'M')
  let suffix = ''
  for (let i = 0; i < 6; i++) suffix += ALPHABET[randomInt(ALPHABET.length)]
  return `${prefix}${suffix}`
}
