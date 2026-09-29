import { Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { Role } from '@prisma/client'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { AppConfig } from '../../../infrastructure/config/app-config.service'
import { PrismaService } from '../../../infrastructure/prisma/prisma.service'
import { UnauthorizedError } from '../../../shared/domain/domain-error'

export const ACCESS_TTL_SECONDS = 15 * 60
export const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60

export interface IssuedTokens {
  accessToken: string
  refreshToken: string
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex')

/**
 * Jetons d'accès JWT (15 min) et jetons de rafraîchissement opaques en rotation.
 * Réutiliser un jeton déjà consommé révoque toute sa famille (vol de jeton détecté).
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  async issue(user: { id: string; role: Role }, familyId: string = randomUUID()): Promise<IssuedTokens> {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, role: user.role },
      { secret: this.config.get('JWT_ACCESS_SECRET'), expiresIn: ACCESS_TTL_SECONDS },
    )
    const refreshToken = randomBytes(48).toString('base64url')
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        familyId,
        tokenHash: hash(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
      },
    })
    return { accessToken, refreshToken }
  }

  async rotate(refreshToken: string): Promise<IssuedTokens> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hash(refreshToken) },
      include: { user: { select: { id: true, role: true, isActive: true, deletedAt: true } } },
    })
    if (!stored) throw new UnauthorizedError('Session invalide')

    if (stored.revokedAt) {
      await this.revokeFamily(stored.familyId)
      throw new UnauthorizedError('Session révoquée')
    }
    if (stored.expiresAt < new Date() || !stored.user.isActive || stored.user.deletedAt) {
      throw new UnauthorizedError('Session expirée')
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    })
    return this.issue(stored.user, stored.familyId)
  }

  async revoke(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hash(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    })
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
  }
}
