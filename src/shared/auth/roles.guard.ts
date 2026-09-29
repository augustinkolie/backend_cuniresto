import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Role } from '@prisma/client'
import type { AuthUser } from './auth-user'
import { ROLES } from './decorators'

/** Garde global : vérifie @Roles(). L'administrateur a tous les droits. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, [
      ctx.getHandler(),
      ctx.getClass(),
    ])
    if (!roles || roles.length === 0) return true

    const user = ctx.switchToHttp().getRequest<{ user?: AuthUser }>().user
    if (user && (user.role === 'ADMIN' || roles.includes(user.role))) return true
    throw new ForbiddenException('Accès refusé')
  }
}
