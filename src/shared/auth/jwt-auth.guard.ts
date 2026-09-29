import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import type { Request } from 'express'
import { AppConfig } from '../../infrastructure/config/app-config.service'
import { ACCESS_COOKIE, type AuthUser } from './auth-user'
import { IS_PUBLIC } from './decorators'

interface AccessPayload {
  sub: string
  role: AuthUser['role']
}

/** Garde global : toutes les routes exigent un jeton d'accès, sauf celles marquées @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ])
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>()
    const token = extractAccessToken(req)

    if (token) {
      const user = await this.verify(token)
      if (user) {
        req.user = user
        return true
      }
    }
    if (isPublic) return true
    throw new UnauthorizedException('Authentification requise')
  }

  async verify(token: string): Promise<AuthUser | null> {
    try {
      const payload = await this.jwt.verifyAsync<AccessPayload>(token, {
        secret: this.config.get('JWT_ACCESS_SECRET'),
      })
      return { id: payload.sub, role: payload.role }
    } catch {
      return null
    }
  }
}

export function extractAccessToken(req: Request): string | undefined {
  const cookies = req.cookies as Record<string, string> | undefined
  const fromCookie = cookies?.[ACCESS_COOKIE]
  if (fromCookie) return fromCookie
  const header = req.headers.authorization
  return header?.startsWith('Bearer ') ? header.slice(7) : undefined
}
