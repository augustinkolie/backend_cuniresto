// Port public du module paiements, utilisé par les commandes et les inscriptions aux formations.

export const PAYMENT_INITIATOR = Symbol('PAYMENT_INITIATOR')

export type OnlinePaymentMethod = 'ORANGE_MONEY' | 'CARD' | 'PAYPAL'

export interface InitiatePaymentCommand {
  orderId: string
  orderNumber: number
  amount: number
  method: OnlinePaymentMethod | 'ON_SITE'
  payerPhone?: string
  customerEmail?: string
}

export interface PaymentInitiation {
  /** Page de paiement du fournisseur vers laquelle rediriger le client. */
  checkoutUrl: string | null
  /** Message à afficher (ex. : « validez le paiement sur votre téléphone »). */
  instructions: string | null
}

export interface InitiateEnrollmentPaymentCommand {
  enrollmentId: string
  enrollmentNumber: number
  courseTitle: string
  amount: number
  method: OnlinePaymentMethod
  payerPhone?: string
  customerEmail?: string
}

export interface PaymentInitiator {
  initiate(cmd: InitiatePaymentCommand): Promise<PaymentInitiation>
  initiateEnrollment(cmd: InitiateEnrollmentPaymentCommand): Promise<PaymentInitiation>
}
