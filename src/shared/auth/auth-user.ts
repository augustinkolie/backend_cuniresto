import type { Role } from '@prisma/client'

/** Utilisateur authentifié tel qu'extrait du jeton d'accès. */
export interface AuthUser {
  id: string
  role: Role
}

export const ACCESS_COOKIE = 'mb_access'
export const REFRESH_COOKIE = 'mb_refresh'

/** Rôles du personnel (accès au back-office). */
export const STAFF_ROLES: Role[] = ['ADMIN', 'MANAGER', 'KITCHEN', 'WAITER']

export function isStaff(user: AuthUser | undefined): boolean {
  return !!user && STAFF_ROLES.includes(user.role)
}

export function isManager(user: AuthUser | undefined): boolean {
  return !!user && (user.role === 'ADMIN' || user.role === 'MANAGER')
}
