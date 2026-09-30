import {
  Controller,
  Get,
  Injectable,
  Logger,
  Module,
  OnModuleDestroy,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets'
import type { CallStatus, CallType } from '@prisma/client'
import { AppConfig } from '../../infrastructure/config/app-config.service'
import { PrismaService } from '../../infrastructure/prisma/prisma.service'
import { type AuthedSocket, RealtimeGateway } from '../../infrastructure/realtime/realtime.gateway'
import type { AuthUser } from '../../shared/auth/auth-user'
import { CurrentUser } from '../../shared/auth/decorators'
import { publicUserSelect } from '../users/application/user.presenter'
import { MessagingModule } from '../messaging/messaging.module'
import { MessagingService } from '../messaging/messaging.service'
import { NotificationsService } from '../notifications/notifications.service'

const RING_TIMEOUT_MS = 45_000

type Ack = { ok: true; callId?: string } | { ok: false; error: string }

@Injectable()
export class CallsService implements OnModuleDestroy {
  private readonly logger = new Logger(CallsService.name)
  private readonly ringTimers = new Map<string, NodeJS.Timeout>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly messaging: MessagingService,
    private readonly notifications: NotificationsService,
    private readonly config: AppConfig,
  ) {}

  onModuleDestroy(): void {
    for (const t of this.ringTimers.values()) clearTimeout(t)
  }

  iceServers() {
    const servers: Array<{ urls: string; username?: string; credential?: string }> = [
      { urls: 'stun:stun.l.google.com:19302' },
    ]
    const turn = this.config.get('TURN_URL')
    if (turn) {
      servers.push({
        urls: turn,
        username: this.config.get('TURN_USERNAME'),
        credential: this.config.get('TURN_CREDENTIAL'),
      })
    }
    return { iceServers: servers }
  }

  async initiate(caller: AuthUser, conversationId: string, receiverId: string, type: CallType): Promise<Ack> {
    await this.messaging.membership(conversationId, caller.id)
    await this.messaging.membership(conversationId, receiverId)
    const blocked = await this.prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: caller.id, blockedId: receiverId },
          { blockerId: receiverId, blockedId: caller.id },
        ],
      },
    })
    if (blocked) return { ok: false, error: 'Appel impossible' }

    const call = await this.prisma.call.create({
      data: { conversationId, callerId: caller.id, receiverId, type },
      include: { caller: { select: publicUserSelect } },
    })

    if (!this.realtime.isOnline(receiverId)) {
      await this.finish(call.id, 'MISSED')
      await this.notifyMissed(receiverId, caller.id, conversationId)
      return { ok: false, error: 'Votre correspondant n’est pas joignable' }
    }

    this.realtime.toUser(receiverId, 'call:incoming', {
      callId: call.id,
      conversationId,
      type,
      caller: call.caller,
    })
    this.ringTimers.set(
      call.id,
      setTimeout(() => void this.timeout(call.id), RING_TIMEOUT_MS),
    )
    return { ok: true, callId: call.id }
  }

  async respond(user: AuthUser, callId: string, action: 'accept' | 'reject' | 'cancel' | 'end'): Promise<Ack> {
    const call = await this.prisma.call.findUnique({ where: { id: callId } })
    if (!call || (call.callerId !== user.id && call.receiverId !== user.id)) {
      return { ok: false, error: 'Appel introuvable' }
    }
    const other = call.callerId === user.id ? call.receiverId : call.callerId

    if (action === 'accept' && call.receiverId === user.id && call.status === 'RINGING') {
      this.clearTimer(callId)
      await this.prisma.call.update({ where: { id: callId }, data: { status: 'ANSWERED', answeredAt: new Date() } })
      this.realtime.toUser(other, 'call:accepted', { callId })
    } else if (action === 'reject' && call.receiverId === user.id && call.status === 'RINGING') {
      await this.finish(callId, 'REJECTED')
      this.realtime.toUser(other, 'call:rejected', { callId })
    } else if (action === 'cancel' && call.callerId === user.id && call.status === 'RINGING') {
      await this.finish(callId, 'CANCELLED')
      this.realtime.toUser(other, 'call:cancelled', { callId })
      await this.notifyMissed(call.receiverId, call.callerId, call.conversationId)
    } else if (action === 'end' && call.status === 'ANSWERED') {
      await this.finish(callId, 'ENDED')
      this.realtime.toUser(other, 'call:ended', { callId })
    } else {
      return { ok: false, error: 'Action impossible dans l’état actuel de l’appel' }
    }
    return { ok: true }
  }

  /** Relais des messages WebRTC (offre, réponse, candidats ICE) vers l'autre participant. */
  async signal(user: AuthUser, callId: string, data: unknown): Promise<Ack> {
    const call = await this.prisma.call.findUnique({ where: { id: callId } })
    if (!call || (call.callerId !== user.id && call.receiverId !== user.id)) {
      return { ok: false, error: 'Appel introuvable' }
    }
    if (call.status !== 'RINGING' && call.status !== 'ANSWERED') return { ok: false, error: 'Appel terminé' }
    const other = call.callerId === user.id ? call.receiverId : call.callerId
    this.realtime.toUser(other, 'call:signal', { callId, data })
    return { ok: true }
  }

  /** Qui, parmi les autres membres de la conversation, a l'application ouverte en ce moment. */
  async presence(conversationId: string, userId: string) {
    await this.messaging.membership(conversationId, userId)
    const members = await this.prisma.conversationMember.findMany({
      where: { conversationId, userId: { not: userId } },
      select: { userId: true },
    })
    return Object.fromEntries(members.map((m) => [m.userId, this.realtime.isOnline(m.userId)]))
  }

  async history(conversationId: string, userId: string) {
    await this.messaging.membership(conversationId, userId)
    return this.prisma.call.findMany({
      where: { conversationId },
      include: { caller: { select: publicUserSelect }, receiver: { select: publicUserSelect } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
  }

  recent(userId: string) {
    return this.prisma.call.findMany({
      where: { OR: [{ callerId: userId }, { receiverId: userId }] },
      include: { caller: { select: publicUserSelect }, receiver: { select: publicUserSelect } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
  }

  private async timeout(callId: string): Promise<void> {
    this.ringTimers.delete(callId)
    const { count } = await this.prisma.call.updateMany({
      where: { id: callId, status: 'RINGING' },
      data: { status: 'MISSED', endedAt: new Date() },
    })
    if (count === 0) return
    const call = await this.prisma.call.findUniqueOrThrow({ where: { id: callId } })
    this.realtime.toUser(call.callerId, 'call:unanswered', { callId })
    this.realtime.toUser(call.receiverId, 'call:cancelled', { callId })
    await this.notifyMissed(call.receiverId, call.callerId, call.conversationId)
  }

  private async finish(callId: string, status: CallStatus): Promise<void> {
    this.clearTimer(callId)
    const call = await this.prisma.call.findUniqueOrThrow({ where: { id: callId } })
    const endedAt = new Date()
    await this.prisma.call.update({
      where: { id: callId },
      data: {
        status,
        endedAt,
        durationSeconds: call.answeredAt ? Math.round((endedAt.getTime() - call.answeredAt.getTime()) / 1000) : 0,
      },
    })
  }

  private async notifyMissed(receiverId: string, callerId: string, conversationId: string): Promise<void> {
    try {
      await this.notifications.notify(receiverId, {
        type: 'MESSAGE',
        senderId: callerId,
        content: 'a essayé de vous appeler',
        link: `/messages?c=${conversationId}`,
      })
    } catch (error) {
      this.logger.warn(`Notification d'appel manqué impossible : ${String(error)}`)
    }
  }

  private clearTimer(callId: string): void {
    const timer = this.ringTimers.get(callId)
    if (timer) clearTimeout(timer)
    this.ringTimers.delete(callId)
  }
}

@WebSocketGateway({ path: '/socket.io', cors: { origin: true, credentials: true } })
export class CallsGateway {
  constructor(private readonly calls: CallsService) {}

  @SubscribeMessage('call:initiate')
  async initiate(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: { conversationId?: string; receiverId?: string; type?: CallType },
  ): Promise<Ack> {
    const user = socket.data.user
    if (!user) return { ok: false, error: 'Non connecté' }
    if (!body?.conversationId || !body.receiverId || !['AUDIO', 'VIDEO'].includes(body.type ?? '')) {
      return { ok: false, error: 'Requête invalide' }
    }
    try {
      return await this.calls.initiate(user, body.conversationId, body.receiverId, body.type!)
    } catch {
      return { ok: false, error: 'Appel impossible' }
    }
  }

  @SubscribeMessage('call:respond')
  respond(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: { callId?: string; action?: 'accept' | 'reject' | 'cancel' | 'end' },
  ): Promise<Ack> | Ack {
    const user = socket.data.user
    if (!user || !body?.callId || !['accept', 'reject', 'cancel', 'end'].includes(body.action ?? '')) {
      return { ok: false, error: 'Requête invalide' }
    }
    return this.calls.respond(user, body.callId, body.action!)
  }

  @SubscribeMessage('call:signal')
  signal(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: { callId?: string; data?: unknown },
  ): Promise<Ack> | Ack {
    const user = socket.data.user
    if (!user || !body?.callId) return { ok: false, error: 'Requête invalide' }
    return this.calls.signal(user, body.callId, body.data)
  }
}

const uuid = new ParseUUIDPipe({ version: '4' })

@ApiTags('calls')
@Controller()
export class CallsController {
  constructor(private readonly calls: CallsService) {}

  @Get('calls/ice-servers')
  ice() {
    return this.calls.iceServers()
  }

  @Get('calls')
  recent(@CurrentUser() user: AuthUser) {
    return this.calls.recent(user.id)
  }

  @Get('conversations/:id/presence')
  presence(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.calls.presence(id, user.id)
  }

  @Get('conversations/:id/calls')
  history(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.calls.history(id, user.id)
  }
}

@Module({
  imports: [MessagingModule],
  controllers: [CallsController],
  providers: [CallsService, CallsGateway],
})
export class CallsModule {}
