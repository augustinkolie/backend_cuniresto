import { ConflictError, ValidationError } from '../../../shared/domain/domain-error'
import { type AvailableDish, Order } from './order.entity'

const dishes: AvailableDish[] = [
  { id: 'lapin', name: 'Lapin braisé', price: 15_000, imageUrl: '/l.jpg', stock: 10, isAvailable: true },
  { id: 'jus', name: 'Jus de bissap', price: 3_000, imageUrl: '/j.jpg', stock: 2, isAvailable: true },
  { id: 'off', name: 'Plat retiré', price: 9_000, imageUrl: '/o.jpg', stock: 5, isAvailable: false },
]

const delivery = { mode: 'STANDARD' as const, street: 'Rue KA-020', city: 'Conakry' }

describe('Order.place', () => {
  it('calcule le total avec les prix du serveur et les frais de livraison', () => {
    const order = Order.place({
      customerId: 'u1',
      type: 'DELIVERY',
      items: [
        { dishId: 'lapin', quantity: 2 },
        { dishId: 'jus', quantity: 1 },
      ],
      dishes,
      contactPhone: '620000000',
      delivery,
    })
    const s = order.snapshot()
    expect(s.subtotal).toBe(33_000)
    expect(s.deliveryFee).toBe(3_000)
    expect(s.total).toBe(36_000)
    expect(s.status).toBe('PENDING_PAYMENT')
  })

  it('fusionne les lignes d’un même plat', () => {
    const order = Order.place({
      customerId: null,
      type: 'PICKUP',
      items: [
        { dishId: 'lapin', quantity: 1 },
        { dishId: 'lapin', quantity: 2 },
      ],
      dishes,
      contactPhone: '620000000',
    })
    expect(order.lines).toHaveLength(1)
    expect(order.lines[0]?.quantity).toBe(3)
    expect(order.snapshot().deliveryFee).toBe(0)
  })

  it.each([0, -3, 1.5, 51])('refuse la quantité %p', (quantity) => {
    expect(() =>
      Order.place({
        customerId: 'u1',
        type: 'PICKUP',
        items: [{ dishId: 'lapin', quantity }],
        dishes,
        contactPhone: '620000000',
      }),
    ).toThrow(ValidationError)
  })

  it('refuse un plat indisponible ou un stock insuffisant', () => {
    const base = { customerId: 'u1', type: 'PICKUP' as const, dishes, contactPhone: '620000000' }
    expect(() => Order.place({ ...base, items: [{ dishId: 'off', quantity: 1 }] })).toThrow(ConflictError)
    expect(() => Order.place({ ...base, items: [{ dishId: 'jus', quantity: 3 }] })).toThrow(ConflictError)
    expect(() => Order.place({ ...base, items: [{ dishId: 'inconnu', quantity: 1 }] })).toThrow(ConflictError)
  })

  it('exige une adresse pour la livraison et une table pour le service en salle', () => {
    const items = [{ dishId: 'lapin', quantity: 1 }]
    expect(() =>
      Order.place({ customerId: 'u1', type: 'DELIVERY', items, dishes, contactPhone: '620000000' }),
    ).toThrow(ValidationError)
    expect(() => Order.place({ customerId: null, type: 'DINE_IN', items, dishes })).toThrow(ValidationError)
  })

  it('confirme directement une commande sur place', () => {
    const order = Order.place({
      customerId: null,
      type: 'DINE_IN',
      items: [{ dishId: 'lapin', quantity: 1 }],
      dishes,
      tableId: 't1',
    })
    expect(order.status).toBe('CONFIRMED')
  })
})

describe('Order.transitionTo', () => {
  const place = (type: 'DELIVERY' | 'PICKUP' | 'DINE_IN') =>
    Order.place({
      customerId: 'u1',
      type,
      items: [{ dishId: 'lapin', quantity: 1 }],
      dishes,
      contactPhone: '620000000',
      delivery,
      tableId: 't1',
    })

  it('suit le cycle complet d’une livraison', () => {
    const order = place('DELIVERY')
    for (const s of ['CONFIRMED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED'] as const) {
      order.transitionTo(s)
    }
    expect(order.pullChanges()).toHaveLength(5)
    expect(order.pullChanges()).toHaveLength(0)
  })

  it('termine un retrait sans passer par la livraison', () => {
    const order = place('PICKUP')
    order.transitionTo('CONFIRMED')
    order.transitionTo('PREPARING')
    order.transitionTo('READY')
    expect(() => order.transitionTo('OUT_FOR_DELIVERY')).toThrow(ConflictError)
    order.transitionTo('COMPLETED')
  })

  it('sert puis clôture une commande en salle', () => {
    const order = place('DINE_IN')
    order.transitionTo('PREPARING')
    order.transitionTo('READY')
    order.transitionTo('SERVED')
    order.transitionTo('COMPLETED')
    expect(order.status).toBe('COMPLETED')
  })

  it('interdit d’annuler une commande en préparation', () => {
    const order = place('DELIVERY')
    order.transitionTo('CONFIRMED')
    order.transitionTo('PREPARING')
    expect(() => order.cancel()).toThrow(ConflictError)
  })
})
