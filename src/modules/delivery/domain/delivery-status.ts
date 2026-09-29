import type { DeliveryStatus, OrderStatus } from '../../../shared/domain/types'

const NEXT: Record<DeliveryStatus, DeliveryStatus[]> = {
  PENDING: ['PREPARING', 'ASSIGNED', 'CANCELLED'],
  PREPARING: ['READY', 'ASSIGNED', 'CANCELLED'],
  READY: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['PREPARING', 'READY', 'ASSIGNED', 'PICKED_UP', 'CANCELLED'],
  PICKED_UP: ['IN_TRANSIT', 'ARRIVED', 'DELIVERED'],
  IN_TRANSIT: ['ARRIVED', 'DELIVERED'],
  ARRIVED: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
}

export function canMoveDelivery(from: DeliveryStatus, to: DeliveryStatus): boolean {
  return NEXT[from].includes(to)
}

/** Statuts que le livreur fait avancer lui-même. */
export const DRIVER_STATUSES: DeliveryStatus[] = ['PICKED_UP', 'IN_TRANSIT', 'ARRIVED', 'DELIVERED']

export const ACTIVE_DELIVERY_STATUSES: DeliveryStatus[] = ['ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED']

export const DELIVERY_MESSAGES: Record<DeliveryStatus, string> = {
  PENDING: 'Commande reçue, en attente de préparation',
  PREPARING: 'Votre commande est en préparation',
  READY: 'Votre commande est prête',
  ASSIGNED: 'Un livreur a été assigné à votre commande',
  PICKED_UP: 'Le livreur a récupéré votre commande',
  IN_TRANSIT: 'Votre commande est en route',
  ARRIVED: 'Votre livreur est arrivé',
  DELIVERED: 'Votre commande a été livrée. Bon appétit !',
  CANCELLED: 'La livraison a été annulée',
}

/** Répercussion d'un statut de livraison sur la commande. */
export function orderStatusFor(status: DeliveryStatus): OrderStatus | null {
  if (status === 'PICKED_UP') return 'OUT_FOR_DELIVERY'
  if (status === 'DELIVERED') return 'DELIVERED'
  return null
}

/** Répercussion d'un statut de commande sur la livraison. */
export function deliveryStatusFor(status: OrderStatus): DeliveryStatus | null {
  if (status === 'PREPARING') return 'PREPARING'
  if (status === 'READY') return 'READY'
  if (status === 'CANCELLED') return 'CANCELLED'
  return null
}
