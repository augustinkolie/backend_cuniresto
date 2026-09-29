import type { Order } from '../../domain/order.entity'

export const ORDER_REPOSITORY = Symbol('ORDER_REPOSITORY')

export interface OrderRepository {
  /**
   * Enregistre une nouvelle commande et réserve le stock de façon atomique.
   * Lève ConflictError si le stock a changé entre-temps.
   */
  create(order: Order): Promise<void>

  findById(id: string): Promise<Order | null>

  /**
   * Persiste le nouveau statut si personne ne l'a modifié depuis le chargement
   * (verrou optimiste sur l'ancien statut). Remet le stock en cas d'annulation.
   */
  saveStatus(order: Order, previous: Order['status']): Promise<void>
}
