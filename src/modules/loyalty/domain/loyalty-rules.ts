import type { LoyaltyLevel } from '../../../shared/domain/types'

export const POINTS_PER_ORDER = 10
export const GNF_PER_BONUS_POINT = 1_000
export const REFERRER_POINTS = 500
export const REFERRED_POINTS = 300
/** Valeur d'un point en cashback Orange Money. */
export const GNF_PER_POINT = 10
export const MIN_CASHBACK_GNF = 5_000

export const LEVEL_THRESHOLDS: Array<{ level: LoyaltyLevel; minPoints: number }> = [
  { level: 'BRONZE', minPoints: 0 },
  { level: 'SILVER', minPoints: 500 },
  { level: 'GOLD', minPoints: 2_000 },
  { level: 'PLATINUM', minPoints: 5_000 },
]

const LEVEL_RANK: Record<LoyaltyLevel, number> = { BRONZE: 0, SILVER: 1, GOLD: 2, PLATINUM: 3 }

/** 10 points par commande + 1 point par tranche de 1 000 GNF. */
export function pointsForOrder(total: number): number {
  return POINTS_PER_ORDER + Math.floor(total / GNF_PER_BONUS_POINT)
}

/** Le niveau dépend du cumul de points gagnés (les points dépensés ne font pas descendre). */
export function levelFor(totalPoints: number): LoyaltyLevel {
  let level: LoyaltyLevel = 'BRONZE'
  for (const t of LEVEL_THRESHOLDS) if (totalPoints >= t.minPoints) level = t.level
  return level
}

export function nextLevel(totalPoints: number): { level: LoyaltyLevel; minPoints: number } | null {
  return LEVEL_THRESHOLDS.find((t) => t.minPoints > totalPoints) ?? null
}

export function meetsLevel(current: LoyaltyLevel, required: LoyaltyLevel): boolean {
  return LEVEL_RANK[current] >= LEVEL_RANK[required]
}

export function pointsForCashback(amountGnf: number): number {
  return Math.ceil(amountGnf / GNF_PER_POINT)
}
