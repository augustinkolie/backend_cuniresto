import { Logger } from '@nestjs/common'
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets'
import { JwtService } from '@nestjs/jwt'
import type { Server, Socket } from 'socket.io'
import { ACCESS_COOKIE, type AuthUser, STAFF_ROLES } from '../../shared/auth/auth-user'
import { AppConfig } from '../config/app-config.service'
import { PrismaService } from '../prisma/prisma.service'

export type AuthedSocket = Socket & { data: { user?: AuthUser } }

export const rooms = {
  user: (id: string) => `user:${id}`,
  staff: 'staff',
  drivers: 'drivers',
  table: (qrToken: string) => `table:${qrToken}`,
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return undefined
}

/**
 * Passerelle Socket.IO unique. L'identité vient du cookie d'accès (ou du champ auth.token),
 * jamais d'un identifiant envoyé par le client : l'ancien `user:register` permettait l'usurpation.
 */
@WebSocketGateway({ path: '/socket.io', cors: { origin: true, credentials: true } })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name)
  @WebSocketServer() server!: Server

  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  afterInit(server: Server): void {
    server.use(async (socket: AuthedSocket, next) => {
      const token =
        readCookie(socket.handshake.headers.cookie, ACCESS_COOKIE) ??
        (socket.handshake.auth as { token?: string } | undefined)?.token
      if (token) {
        try {
          const payload = await this.jwt.verifyAsync<{ sub: string; role: AuthUser['role'] }>(
            token,
            { secret: this.config.get('JWT_ACCESS_SECRET') },
          )
          socket.data.user = { id: payload.sub, role: payload.role }
        } catch {
          // Jeton invalide : connexion anonyme (suivi de table uniquement).
        }
      }
      next()
    })
  }

  async handleConnection(socket: AuthedSocket): Promise<void> {
    const user = socket.data.user
    if (!user) return
    await socket.join(rooms.user(user.id))
    if (STAFF_ROLES.includes(user.role)) await socket.join(rooms.staff)
    if (user.role === 'DRIVER') await socket.join(rooms.drivers)
    this.logger.debug(`Socket ${socket.id} connecté (${user.id})`)
  }

  /** Un client à table suit sa commande grâce au jeton du QR code. */
  @SubscribeMessage('table:join')
  async joinTable(@ConnectedSocket() socket: AuthedSocket, @MessageBody() qrToken: string) {
    if (typeof qrToken !== 'string') return { ok: false }
    const table = await this.prisma.table.findUnique({ where: { qrToken } })
    if (!table) return { ok: false }
    await socket.join(rooms.table(qrToken))
    return { ok: true }
  }

  toUser(userId: string, event: string, payload: unknown): void {
    this.server.to(rooms.user(userId)).emit(event, payload)
  }

  toStaff(event: string, payload: unknown): void {
    this.server.to(rooms.staff).emit(event, payload)
  }

  toRoom(room: string, event: string, payload: unknown): void {
    this.server.to(room).emit(event, payload)
  }

  isOnline(userId: string): boolean {
    return (this.server.sockets.adapter.rooms.get(rooms.user(userId))?.size ?? 0) > 0
  }
}
