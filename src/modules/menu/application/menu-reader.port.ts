// Port public du module carte, utilisé par les commandes, le panier et les entreprises.
// Aucun autre module ne lit directement les tables de la carte (cahier des charges §5.3).

export const MENU_READER = Symbol('MENU_READER')

export interface DishSnapshot {
  id: string
  name: string
  price: number
  imageUrl: string
  stock: number
  isAvailable: boolean
}

export interface MenuReader {
  /** Plats non supprimés correspondant aux ids (disponibles ou non). */
  findByIds(ids: string[]): Promise<DishSnapshot[]>
}
