import { Injectable } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { Prisma, type User } from '@prisma/client'
import * as argon2 from 'argon2'
import { OAuth2Client } from 'google-auth-library'
import { createHash, randomInt, timingSafeEqual } from 'node:crypto'
import { AppConfig } from '../../../infrastructure/config/app-config.service'
import { MailService } from '../../../infrastructure/mail/mail.service'
import { mailTemplates } from '../../../infrastructure/mail/mail-templates'
import { PrismaService } from '../../../infrastructure/prisma/prisma.service'
import {
  ConflictError,
  UnauthorizedError,
  ValidationError,
} from '../../../shared/domain/domain-error'
import { Events, type UserRegisteredEvent } from '../../../shared/events'
import { generateReferralCode } from '../../users/application/referral-code'
import { type IssuedTokens, TokenService } from './token.service'

const RESET_TTL_MS = 15 * 60 * 1000
const RESET_MAX_ATTEMPTS = 5
const hashCode = (code: string) => createHash('sha256').update(code).digest()

export interface AuthResult {
  user: User
  tokens: IssuedTokens
}

@Injectable()
export class AuthService {
  private readonly google: OAuth2Client

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly mail: MailService,
    private readonly config: AppConfig,
    private readonly events: EventEmitter2,
  ) {
    this.google = new OAuth2Client(config.get('GOOGLE_CLIENT_ID'))
  }

  async register(input: {
    email: string
    password: string
    firstName: string
    lastName: string
    referralCode?: string
  }): Promise<AuthResult> {
    const email = input.email.trim().toLowerCase()
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictError('Cet e-mail est déjà utilisé')
    }
    const user = await this.createUser({
      email,
      passwordHash: await argon2.hash(input.password, { type: argon2.argon2id }),
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
    })
    this.events.emit(Events.UserRegistered, {
      userId: user.id,
      firstName: user.firstName,
      referralCode: input.referralCode?.trim().toUpperCase() || undefined,
    } satisfies UserRegisteredEvent)
    return { user, tokens: await this.tokens.issue(user) }
  }

  async login(emailInput: string, password: string): Promise<AuthResult> {
    const email = emailInput.trim().toLowerCase()
    const user = await this.prisma.user.findUnique({ where: { email } })
    // Même message dans tous les cas pour ne pas révéler l'existence d'un compte.
    const invalid = new UnauthorizedError('E-mail ou mot de passe incorrect')
    if (!user || user.deletedAt || !user.isActive) throw invalid
    if (!user.passwordHash) {
      throw new UnauthorizedError('Ce compte utilise la connexion Google')
    }
    if (!(await argon2.verify(user.passwordHash, password))) throw invalid

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    return { user, tokens: await this.tokens.issue(user) }
  }

  async loginWithGoogle(credential: string): Promise<AuthResult> {
    const clientId = this.config.get('GOOGLE_CLIENT_ID')
    if (!clientId) throw new ValidationError('Connexion Google non configurée')

    let payload
    try {
      const ticket = await this.google.verifyIdToken({ idToken: credential, audience: clientId })
      payload = ticket.getPayload()
    } catch {
      throw new UnauthorizedError('Jeton Google invalide')
    }
    if (!payload?.email || !payload.email_verified) {
      throw new UnauthorizedError('E-mail Google non vérifié')
    }

    const email = payload.email.toLowerCase()
    let user = await this.prisma.user.findFirst({
      where: { OR: [{ googleId: payload.sub }, { email }] },
    })
    let created = false
    if (!user) {
      user = await this.createUser({
        email,
        googleId: payload.sub,
        firstName: payload.given_name ?? email.split('@')[0] ?? 'Client',
        lastName: payload.family_name ?? '',
        avatarUrl: payload.picture,
      })
      created = true
    } else if (!user.googleId) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { googleId: payload.sub, avatarUrl: user.avatarUrl ?? payload.picture },
      })
    }
    if (user.deletedAt || !user.isActive) throw new UnauthorizedError('Compte désactivé')

    if (created) {
      this.events.emit(Events.UserRegistered, {
        userId: user.id,
        firstName: user.firstName,
      } satisfies UserRegisteredEvent)
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    return { user, tokens: await this.tokens.issue(user) }
  }

  async refresh(refreshToken: string): Promise<IssuedTokens> {
    return this.tokens.rotate(refreshToken)
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (refreshToken) await this.tokens.revoke(refreshToken)
  }

  /** Envoie un code à 6 chiffres. La réponse est identique que le compte existe ou non. */
  async requestPasswordReset(emailInput: string): Promise<void> {
    const email = emailInput.trim().toLowerCase()
    const user = await this.prisma.user.findUnique({ where: { email } })
    if (!user || user.deletedAt || !user.isActive) return

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0')
    await this.prisma.$transaction([
      this.prisma.passwordReset.deleteMany({ where: { userId: user.id } }),
      this.prisma.passwordReset.create({
        data: {
          userId: user.id,
          codeHash: hashCode(code).toString('hex'),
          expiresAt: new Date(Date.now() + RESET_TTL_MS),
        },
      }),
    ])
    await this.mail.send({ to: user.email, ...mailTemplates.passwordResetCode(user.firstName, code) })
  }

  async verifyResetCode(email: string, code: string): Promise<void> {
    await this.consumeAttempt(email, code, false)
  }

  async resetPassword(email: string, code: string, newPassword: string): Promise<void> {
    const userId = await this.consumeAttempt(email, code, true)
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await argon2.hash(newPassword, { type: argon2.argon2id }) },
    })
    await this.tokens.revokeAllForUser(userId)
  }

  async changePassword(userId: string, current: string | undefined, next: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } })
    if (user.passwordHash && !(current && (await argon2.verify(user.passwordHash, current)))) {
      throw new ValidationError('Mot de passe actuel incorrect')
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await argon2.hash(next, { type: argon2.argon2id }) },
    })
  }

  /** Vérifie un code ; chaque échec consomme un essai, au-delà de 5 le code est invalidé. */
  private async consumeAttempt(emailInput: string, code: string, markUsed: boolean): Promise<string> {
    const invalid = new ValidationError('Code invalide ou expiré')
    const user = await this.prisma.user.findUnique({
      where: { email: emailInput.trim().toLowerCase() },
    })
    if (!user) throw invalid
    const reset = await this.prisma.passwordReset.findFirst({
      where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    })
    if (!reset || reset.attempts >= RESET_MAX_ATTEMPTS) throw invalid

    const expected = Buffer.from(reset.codeHash, 'hex')
    const actual = hashCode(code)
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      await this.prisma.passwordReset.update({
        where: { id: reset.id },
        data: { attempts: { increment: 1 } },
      })
      throw invalid
    }
    if (markUsed) {
      await this.prisma.passwordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } })
    }
    return user.id
  }

  private async createUser(data: Omit<Prisma.UserCreateInput, 'referralCode'>): Promise<User> {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.prisma.user.create({
          data: { ...data, referralCode: generateReferralCode(data.firstName) },
        })
      } catch (e) {
        const collision =
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002' &&
          String(e.meta?.target).includes('referralCode')
        if (!collision) throw e
      }
    }
    throw new ConflictError('Impossible de générer un code de parrainage')
  }
}
