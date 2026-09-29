// Erreurs du domaine, indépendantes de HTTP. Le filtre global les traduit en Problem Details (RFC 9457).

export abstract class DomainError extends Error {
  abstract readonly status: number
  abstract readonly code: string

  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

export class ValidationError extends DomainError {
  readonly status = 400
  readonly code = 'validation-error'
}

export class UnauthorizedError extends DomainError {
  readonly status = 401
  readonly code = 'unauthorized'
}

export class ForbiddenError extends DomainError {
  readonly status = 403
  readonly code = 'forbidden'
}

export class NotFoundError extends DomainError {
  readonly status = 404
  readonly code = 'not-found'

  constructor(resource: string) {
    super(`${resource} introuvable`)
  }
}

export class ConflictError extends DomainError {
  readonly status = 409
  readonly code = 'conflict'
}

export class PaymentError extends DomainError {
  readonly status = 402
  readonly code = 'payment-failed'
}
