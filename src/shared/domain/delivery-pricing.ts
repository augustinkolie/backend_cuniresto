// Politique tarifaire de livraison (reprise de l'ancien système, en GNF).
// Partagée par les commandes (calcul du total) et la livraison (estimation affichée).
import type { DeliveryMode } from './types'

const BASE_FEE: Record<DeliveryMode, number> = {
  EXPRESS: 5_000,
  STANDARD: 3_000,
  CLICK_COLLECT: 0,
}

const BASE_MINUTES: Record<DeliveryMode, number> = {
  EXPRESS: 15,
  STANDARD: 30,
  CLICK_COLLECT: 20,
}

/** Au-delà de 10 km : 500 GNF par km commencé. */
export function deliveryFee(mode: DeliveryMode, distanceKm?: number): number {
  const extra =
    mode !== 'CLICK_COLLECT' && distanceKm && distanceKm > 10 ? Math.ceil(distanceKm - 10) * 500 : 0
  return BASE_FEE[mode] + extra
}

/** Au-delà de 5 km : une minute par km commencé. */
export function deliveryMinutes(mode: DeliveryMode, distanceKm?: number): number {
  const extra = distanceKm && distanceKm > 5 ? Math.ceil(distanceKm - 5) : 0
  return BASE_MINUTES[mode] + extra
}
