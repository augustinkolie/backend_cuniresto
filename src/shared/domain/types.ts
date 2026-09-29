// Types du domaine, déclarés ici pour que les couches « domain » ne dépendent pas de Prisma.
// Ils sont identiques aux énumérations du schéma, donc interchangeables avec elles.

export type OrderType = 'DELIVERY' | 'PICKUP' | 'DINE_IN'

export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'CONFIRMED'
  | 'PREPARING'
  | 'READY'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'SERVED'
  | 'COMPLETED'
  | 'CANCELLED'

export type DeliveryMode = 'EXPRESS' | 'STANDARD' | 'CLICK_COLLECT'

export type DeliveryStatus =
  | 'PENDING'
  | 'PREPARING'
  | 'READY'
  | 'ASSIGNED'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'ARRIVED'
  | 'DELIVERED'
  | 'CANCELLED'

export type LoyaltyLevel = 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM'

export type ReservationStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED'
