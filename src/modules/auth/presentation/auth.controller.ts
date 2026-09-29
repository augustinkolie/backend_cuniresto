import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import type { CookieOptions, Request, Response } from 'express'
import { AppConfig } from '../../../infrastructure/config/app-config.service'
import { PrismaService } from '../../../infrastructure/prisma/prisma.service'
import { ACCESS_COOKIE, type AuthUser, REFRESH_COOKIE } from '../../../shared/auth/auth-user'
import { CurrentUser, Public } from '../../../shared/auth/decorators'
import { UnauthorizedError } from '../../../shared/domain/domain-error'
import { presentUser } from '../../users/application/user.presenter'
import { AuthService } from '../application/auth.service'
import { ACCESS_TTL_SECONDS, type IssuedTokens, REFRESH_TTL_SECONDS } from '../application/token.service'
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  GoogleLoginDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyCodeDto,
} from './auth.dto'

// Limites strictes sur les routes sensibles (5 requêtes / minute / IP).
const STRICT = { default: { limit: 5, ttl: 60_000 } }

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Throttle(STRICT)
  @Post('register')
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const { user, tokens } = await this.auth.register(dto)
    this.setCookies(res, tokens)
    return { user: presentUser(user) }
  }

  @Public()
  @Throttle(STRICT)
  @HttpCode(200)
  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { user, tokens } = await this.auth.login(dto.email, dto.password)
    this.setCookies(res, tokens)
    return { user: presentUser(user) }
  }

  @Public()
  @Throttle(STRICT)
  @HttpCode(200)
  @Post('google')
  async google(@Body() dto: GoogleLoginDto, @Res({ passthrough: true }) res: Response) {
    const { user, tokens } = await this.auth.loginWithGoogle(dto.credential)
    this.setCookies(res, tokens)
    return { user: presentUser(user) }
  }

  @Public()
  @HttpCode(204)
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const token = (req.cookies as Record<string, string>)[REFRESH_COOKIE]
    if (!token) throw new UnauthorizedError('Session absente')
    try {
      this.setCookies(res, await this.auth.refresh(token))
    } catch (e) {
      this.clearCookies(res)
      throw e
    }
  }

  @Public()
  @HttpCode(204)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout((req.cookies as Record<string, string>)[REFRESH_COOKIE])
    this.clearCookies(res)
  }

  @Get('me')
  async me(@CurrentUser() current: AuthUser) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: current.id } })
    return { user: presentUser(user) }
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(202)
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.auth.requestPasswordReset(dto.email)
    return { message: 'Si cet e-mail existe, un code de vérification a été envoyé.' }
  }

  @Public()
  @Throttle(STRICT)
  @HttpCode(204)
  @Post('verify-code')
  async verifyCode(@Body() dto: VerifyCodeDto): Promise<void> {
    await this.auth.verifyResetCode(dto.email, dto.code)
  }

  @Public()
  @Throttle(STRICT)
  @HttpCode(204)
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    await this.auth.resetPassword(dto.email, dto.code, dto.password)
  }

  @HttpCode(204)
  @Post('change-password')
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto): Promise<void> {
    await this.auth.changePassword(user.id, dto.currentPassword, dto.newPassword)
  }

  private cookieOptions(maxAgeSeconds: number, path = '/'): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.isProduction,
      sameSite: 'lax',
      domain: this.config.get('COOKIE_DOMAIN'),
      path,
      maxAge: maxAgeSeconds * 1000,
    }
  }

  private setCookies(res: Response, tokens: IssuedTokens): void {
    res.cookie(ACCESS_COOKIE, tokens.accessToken, this.cookieOptions(ACCESS_TTL_SECONDS))
    // Chemin « / » : le middleware Next.js doit voir la session pour protéger les pages privées.
    res.cookie(
      REFRESH_COOKIE,
      tokens.refreshToken,
      this.cookieOptions(REFRESH_TTL_SECONDS),
    )
  }

  private clearCookies(res: Response): void {
    res.clearCookie(ACCESS_COOKIE, { ...this.cookieOptions(0), maxAge: undefined })
    res.clearCookie(REFRESH_COOKIE, { ...this.cookieOptions(0), maxAge: undefined })
  }
}
