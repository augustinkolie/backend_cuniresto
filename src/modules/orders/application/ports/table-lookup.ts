// Accès en lecture minimal aux tables de salle, pour router les notifications temps réel.
export const TABLE_LOOKUP = Symbol('TABLE_LOOKUP')

export interface TableLookup {
  qrTokenForOrder(orderId: string): Promise<string | null>
}
