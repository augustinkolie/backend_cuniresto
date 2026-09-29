import type { DeliveryMode, OrderStatus, OrderType } from '../../../shared/domain/types'
import { ConflictError, ValidationError } from '../../../shared/domain/domain-error'
import { deliveryFee } from '../../../shared/domain/delivery-pricing'
import { allowedTransitions, canTransition } from './order-status'

export const MAX_QUANTITY_PER_LINE = 50
export const MAX_LINES = 40

export interface OrderLine {
  dishId: string | null
  name: string
  unitPrice: number
  quantity: number
  imageUrl: string | null
  notes: string | null
}

export interface RequestedItem {
  dishId: string
  quantity: number
  notes?: string
}

export interface AvailableDish {
  id: string
  name: string
  price: number
  imageUrl: string
  stock: number
  isAvailable: boolean
}

export interface DeliveryRequest {
  mode: DeliveryMode
  street: string
  city: string
  distanceKm?: number
}

export interface PlaceOrderProps {
  customerId: string | null
  type: OrderType
  items: RequestedItem[]
  dishes: AvailableDish[]
  contactName?: string
  contactPhone?: string
  delivery?: DeliveryRequest
  tableId?: string
  instructions?: string
  tastePreferences?: string
}

export interface OrderSnapshot {
  id: string | null
  number: number | null
  customerId: string | null
  type: OrderType
  status: OrderStatus
  lines: OrderLine[]
  subtotal: number
  deliveryFee: number
  deliveryMode: DeliveryMode | null
  total: number
  contactName: string | null
  contactPhone: string | null
  deliveryStreet: string | null
  deliveryCity: string | null
  tableId: string | null
  instructions: string | null
  tastePreferences: string | null
}

export interface StatusChange {
  from: OrderStatus
  to: OrderStatus
}

/**
 * Agrégat Commande. Toutes les règles de calcul et de transition vivent ici,
 * en TypeScript pur, sans dépendance à NestJS ni à Prisma.
 */
export class Order {
  private changes: StatusChange[] = []

  private constructor(private props: OrderSnapshot) {}

  static restore(snapshot: OrderSnapshot): Order {
    return new Order({ ...snapshot, lines: snapshot.lines.map((l) => ({ ...l })) })
  }

  /** Construit une nouvelle commande à partir des plats réellement disponibles (prix serveur). */
  static place(p: PlaceOrderProps): Order {
    if (p.items.length === 0) throw new ValidationError('La commande est vide')
    if (p.items.length > MAX_LINES) throw new ValidationError('Trop d’articles dans la commande')

    const byId = new Map(p.dishes.map((d) => [d.id, d]))
    const merged = new Map<string, RequestedItem>()
    for (const item of p.items) {
      if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_QUANTITY_PER_LINE) {
        throw new ValidationError(`Quantité invalide (1 à ${MAX_QUANTITY_PER_LINE})`)
      }
      const existing = merged.get(item.dishId)
      merged.set(item.dishId, {
        dishId: item.dishId,
        quantity: (existing?.quantity ?? 0) + item.quantity,
        notes: [existing?.notes, item.notes].filter(Boolean).join(' · ') || undefined,
      })
    }

    const lines: OrderLine[] = [...merged.values()].map((item) => {
      const dish = byId.get(item.dishId)
      if (!dish || !dish.isAvailable) throw new ConflictError('Un plat de la commande n’est plus disponible')
      if (dish.stock < item.quantity) throw new ConflictError(`Stock insuffisant pour « ${dish.name} »`)
      return {
        dishId: dish.id,
        name: dish.name,
        unitPrice: dish.price,
        quantity: item.quantity,
        imageUrl: dish.imageUrl,
        notes: item.notes?.trim() || null,
      }
    })

    if (p.type === 'DELIVERY' && !p.delivery) {
      throw new ValidationError('Adresse de livraison requise')
    }
    if (p.type === 'DINE_IN' && !p.tableId) throw new ValidationError('Table requise')
    if (p.type !== 'DINE_IN' && !p.contactPhone) throw new ValidationError('Téléphone requis')

    const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0)
    const mode = p.type === 'DELIVERY' ? (p.delivery?.mode ?? 'STANDARD') : null
    const fee = mode ? deliveryFee(mode, p.delivery?.distanceKm) : 0

    return new Order({
      id: null,
      number: null,
      customerId: p.customerId,
      type: p.type,
      // Sur place : paiement au comptoir, la commande part directement en cuisine.
      status: p.type === 'DINE_IN' ? 'CONFIRMED' : 'PENDING_PAYMENT',
      lines,
      subtotal,
      deliveryFee: fee,
      deliveryMode: mode,
      total: subtotal + fee,
      contactName: p.contactName?.trim() || null,
      contactPhone: p.contactPhone?.trim() || null,
      deliveryStreet: p.type === 'DELIVERY' ? p.delivery!.street.trim() : null,
      deliveryCity: p.type === 'DELIVERY' ? p.delivery!.city.trim() : null,
      tableId: p.tableId ?? null,
      instructions: p.instructions?.trim() || null,
      tastePreferences: p.tastePreferences?.trim() || null,
    })
  }

  get id(): string {
    if (!this.props.id) throw new Error('Commande non enregistrée')
    return this.props.id
  }
  get number(): number {
    if (this.props.number === null) throw new Error('Commande non enregistrée')
    return this.props.number
  }
  get status(): OrderStatus {
    return this.props.status
  }
  get type(): OrderType {
    return this.props.type
  }
  get total(): number {
    return this.props.total
  }
  get customerId(): string | null {
    return this.props.customerId
  }
  get lines(): readonly OrderLine[] {
    return this.props.lines
  }

  snapshot(): OrderSnapshot {
    return { ...this.props, lines: this.props.lines.map((l) => ({ ...l })) }
  }

  /** Appelé par le repository après insertion. */
  assignIdentity(id: string, number: number): void {
    this.props.id = id
    this.props.number = number
  }

  transitionTo(to: OrderStatus): void {
    const from = this.props.status
    if (!canTransition(this.props.type, from, to)) {
      const allowed = allowedTransitions(this.props.type, from)
      throw new ConflictError(
        `Transition ${from} → ${to} interdite${allowed.length ? ` (possibles : ${allowed.join(', ')})` : ''}`,
      )
    }
    this.props.status = to
    this.changes.push({ from, to })
  }

  cancel(): void {
    this.transitionTo('CANCELLED')
  }

  /** Changements de statut depuis le chargement, vidés à la lecture. */
  pullChanges(): StatusChange[] {
    const changes = this.changes
    this.changes = []
    return changes
  }
}
