import type { OrderStatus, OrderType } from '../../../shared/domain/types'

// Transitions autorisées du cycle de vie d'une commande (cahier des charges §5.5).
const COMMON: Partial<Record<OrderStatus, OrderStatus[]>> = {
  PENDING_PAYMENT: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY'],
}

const BY_TYPE: Record<OrderType, Partial<Record<OrderStatus, OrderStatus[]>>> = {
  DELIVERY: { READY: ['OUT_FOR_DELIVERY'], OUT_FOR_DELIVERY: ['DELIVERED'] },
  PICKUP: { READY: ['COMPLETED'] },
  DINE_IN: { READY: ['SERVED'], SERVED: ['COMPLETED'] },
}

export function allowedTransitions(type: OrderType, from: OrderStatus): OrderStatus[] {
  return [...(COMMON[from] ?? []), ...(BY_TYPE[type][from] ?? [])]
}

export function canTransition(type: OrderType, from: OrderStatus, to: OrderStatus): boolean {
  return allowedTransitions(type, from).includes(to)
}

/** Statuts que la cuisine peut appliquer (jusqu'à « prête »). */
export const KITCHEN_STATUSES: OrderStatus[] = ['PREPARING', 'READY']

/** Statuts « en cours » affichés sur l'écran cuisine. */
export const ACTIVE_STATUSES: OrderStatus[] = ['CONFIRMED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'SERVED']

export const TERMINAL_STATUSES: OrderStatus[] = ['DELIVERED', 'COMPLETED', 'CANCELLED']
