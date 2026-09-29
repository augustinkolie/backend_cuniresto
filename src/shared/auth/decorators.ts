import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common'
import type { Role } from '@prisma/client'
import type { AuthUser } from './auth-user'

export const IS_PUBLIC = 'isPublic'
export const ROLES = 'roles'

/** Route accessible sans authentification. Un utilisateur connecté y est tout de même reconnu. */
export const Public = () => SetMetadata(IS_PUBLIC, true)

/** Restreint la route aux rôles donnés (vérifié par RolesGuard). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles)

/** Injecte l'utilisateur authentifié (undefined sur une route publique sans session). */
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser | undefined =>
    ctx.switchToHttp().getRequest<{ user?: AuthUser }>().user,
)
