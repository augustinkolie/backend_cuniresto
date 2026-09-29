// Événements de domaine échangés entre modules (cahier des charges §5.3) :
// un module ne lit jamais le repository d'un autre, il réagit à ces événements.
import type {
  DeliveryMode,
  DeliveryStatus,
  OrderStatus,
  OrderType,
  ReservationStatus,
} from './domain/types'

export const Events = {
  UserRegistered: 'user.registered',
  OrderPlaced: 'order.placed',
  OrderStatusChanged: 'order.status-changed',
  PaymentSucceeded: 'payment.succeeded',
  PaymentFailed: 'payment.failed',
  EnrollmentPaymentSucceeded: 'enrollment.payment-succeeded',
  EnrollmentPaymentFailed: 'enrollment.payment-failed',
  ReservationCreated: 'reservation.created',
  ReservationStatusChanged: 'reservation.status-changed',
  MenuUpdated: 'menu.updated',
  ContentUpdated: 'content.updated',
  WaiterCalled: 'table.waiter-called',
  DeliveryStatusChanged: 'delivery.status-changed',
} as const

export interface UserRegisteredEvent {
  userId: string
  firstName: string
  referralCode?: string
}

export interface OrderPlacedEvent {
  orderId: string
  number: number
  userId: string | null
  type: OrderType
  total: number
  delivery?: { mode: DeliveryMode; street: string; city: string; fee: number; distanceKm?: number }
}

export interface DeliveryStatusChangedEvent {
  deliveryId: string
  orderId: string
  orderNumber: number
  userId: string | null
  status: DeliveryStatus
  message: string
}

export interface OrderStatusChangedEvent {
  orderId: string
  number: number
  userId: string | null
  tableQrToken: string | null
  type: OrderType
  from: OrderStatus
  to: OrderStatus
  total: number
}

export interface PaymentSucceededEvent {
  orderId: string
}

export interface PaymentFailedEvent {
  orderId: string
  reason: string
}

export interface ReservationEvent {
  reservationId: string
  status: ReservationStatus
}

export interface MenuUpdatedEvent {
  dishSlug?: string
}

export interface WaiterCalledEvent {
  orderId: string | null
  tableNumber: number
}

export interface EnrollmentPaymentEvent {
  enrollmentId: string
}
