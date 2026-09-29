import { Injectable } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import type { AttachmentType, Prisma } from '@prisma/client'
import { PrismaService } from '../../infrastructure/prisma/prisma.service'
import { RealtimeGateway } from '../../infrastructure/realtime/realtime.gateway'
import {
  type MediaKind,
  StorageService,
  type UploadedFileLike,
} from '../../infrastructure/storage/storage.service'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../shared/domain/domain-error'
import { cursorArgs, type CursorQueryDto, toCursorPage } from '../../shared/http/pagination'
import { publicUserSelect } from '../users/application/user.presenter'
import { NotificationsService } from '../notifications/notifications.service'

const MAX_GROUP_SIZE = 100

const messageInclude = {
  sender: { select: publicUserSelect },
  attachments: true,
  reactions: { select: { userId: true, emoji: true } },
  replyTo: {
    select: { id: true, content: true, deletedAt: true, sender: { select: { firstName: true } } },
  },
} satisfies Prisma.MessageInclude

const KIND_TO_TYPE: Record<MediaKind, AttachmentType> = {
  image: 'IMAGE',
  video: 'VIDEO',
  audio: 'AUDIO',
  file: 'FILE',
}

@Injectable()
export class MessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
  ) {}

  // ───────── Conversations

  async conversations(userId: string) {
    const memberships = await this.prisma.conversationMember.findMany({
      where: { userId },
      include: {
        conversation: {
          include: {
            members: { include: { user: { select: publicUserSelect } } },
            messages: {
              where: { deletedAt: null },
              orderBy: { createdAt: 'desc' },
              take: 1,
              include: { attachments: { select: { type: true } }, sender: { select: { firstName: true } } },
            },
          },
        },
      },
      orderBy: { conversation: { lastMessageAt: 'desc' } },
    })
    return Promise.all(
      memberships.map(async (m) => {
        const unread = await this.prisma.message.count({
          where: {
            conversationId: m.conversationId,
            senderId: { not: userId },
            deletedAt: null,
            ...(m.lastReadAt ? { createdAt: { gt: m.lastReadAt } } : {}),
          },
        })
        const { messages, members, ...conversation } = m.conversation
        return {
          ...conversation,
          members: members.map((x) => ({ ...x.user, isAdmin: x.isAdmin, lastReadAt: x.lastReadAt })),
          lastMessage: messages[0] ?? null,
          unread,
        }
      }),
    )
  }

  async openDirect(userId: string, otherId: string) {
    if (userId === otherId) throw new ValidationError('Impossible de vous écrire à vous-même')
    const other = await this.prisma.user.findFirst({ where: { id: otherId, deletedAt: null, isActive: true } })
    if (!other) throw new NotFoundError('Utilisateur')
    await this.assertNotBlocked(userId, otherId)

    const existing = await this.prisma.conversation.findFirst({
      where: {
        isGroup: false,
        AND: [{ members: { some: { userId } } }, { members: { some: { userId: otherId } } }],
      },
    })
    const conversation =
      existing ??
      (await this.prisma.conversation.create({
        data: { isGroup: false, members: { create: [{ userId }, { userId: otherId }] } },
      }))
    return this.conversation(conversation.id, userId)
  }

  async createGroup(userId: string, name: string, participantIds: string[]) {
    const ids = [...new Set(participantIds.filter((id) => id !== userId))]
    if (ids.length === 0) throw new ValidationError('Ajoutez au moins un participant')
    if (ids.length + 1 > MAX_GROUP_SIZE) throw new ValidationError(`${MAX_GROUP_SIZE} membres maximum`)
    const found = await this.prisma.user.count({ where: { id: { in: ids }, deletedAt: null } })
    if (found !== ids.length) throw new ValidationError('Participant introuvable')

    const conversation = await this.prisma.conversation.create({
      data: {
        name: name.trim(),
        isGroup: true,
        members: { create: [{ userId, isAdmin: true }, ...ids.map((id) => ({ userId: id }))] },
      },
    })
    for (const id of ids) this.realtime.toUser(id, 'conversation:new', { id: conversation.id })
    return this.conversation(conversation.id, userId)
  }

  async conversation(id: string, userId: string) {
    await this.membership(id, userId)
    const conversation = await this.prisma.conversation.findUniqueOrThrow({
      where: { id },
      include: { members: { include: { user: { select: publicUserSelect } } } },
    })
    return {
      ...conversation,
      members: conversation.members.map((m) => ({ ...m.user, isAdmin: m.isAdmin, lastReadAt: m.lastReadAt })),
    }
  }

  async update(id: string, userId: string, input: { name?: string; disappearingSeconds?: number }) {
    const member = await this.membership(id, userId)
    const conversation = await this.prisma.conversation.findUniqueOrThrow({ where: { id } })
    if (input.name !== undefined && (!conversation.isGroup || !member.isAdmin)) {
      throw new ForbiddenError('Seul un administrateur du groupe peut le renommer')
    }
    await this.prisma.conversation.update({ where: { id }, data: input })
    await this.broadcast(id, 'conversation:updated', { id })
    return this.conversation(id, userId)
  }

  async addMembers(id: string, userId: string, userIds: string[]) {
    const member = await this.membership(id, userId)
    const conversation = await this.prisma.conversation.findUniqueOrThrow({
      where: { id },
      include: { _count: { select: { members: true } } },
    })
    if (!conversation.isGroup || !member.isAdmin) throw new ForbiddenError('Réservé aux administrateurs du groupe')
    if (conversation._count.members + userIds.length > MAX_GROUP_SIZE) {
      throw new ValidationError(`${MAX_GROUP_SIZE} membres maximum`)
    }
    await this.prisma.conversationMember.createMany({
      data: userIds.map((u) => ({ conversationId: id, userId: u })),
      skipDuplicates: true,
    })
    await this.broadcast(id, 'conversation:updated', { id })
    return this.conversation(id, userId)
  }

  /** Retirer un membre (administrateur) ou quitter la conversation (soi-même). */
  async removeMember(id: string, userId: string, targetId: string): Promise<void> {
    const member = await this.membership(id, userId)
    if (targetId !== userId) {
      const conversation = await this.prisma.conversation.findUniqueOrThrow({ where: { id } })
      if (!conversation.isGroup || !member.isAdmin) throw new ForbiddenError('Réservé aux administrateurs du groupe')
    }
    await this.prisma.conversationMember.delete({
      where: { conversationId_userId: { conversationId: id, userId: targetId } },
    })
    const remaining = await this.prisma.conversationMember.findMany({ where: { conversationId: id } })
    if (remaining.length === 0) {
      await this.prisma.conversation.delete({ where: { id } })
      return
    }
    // Un groupe garde toujours au moins un administrateur.
    if (!remaining.some((m) => m.isAdmin)) {
      await this.prisma.conversationMember.update({
        where: { conversationId_userId: { conversationId: id, userId: remaining[0]!.userId } },
        data: { isAdmin: true },
      })
    }
    await this.broadcast(id, 'conversation:updated', { id })
  }

  // ───────── Messages

  async messages(conversationId: string, userId: string, query: CursorQueryDto) {
    await this.membership(conversationId, userId)
    const rows = await this.prisma.message.findMany({
      where: { conversationId },
      include: {
        ...messageInclude,
        stars: { where: { userId }, select: { userId: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...cursorArgs(query),
    })
    const page = toCursorPage(rows, query.limit)
    return {
      ...page,
      items: page.items.reverse().map(({ stars, ...m }) => this.present({ ...m, isStarred: stars.length > 0 })),
    }
  }

  async send(
    conversationId: string,
    userId: string,
    input: { content?: string; replyToId?: string },
    files: UploadedFileLike[],
  ) {
    await this.membership(conversationId, userId)
    const content = input.content?.trim() ?? ''
    if (!content && files.length === 0) throw new ValidationError('Message vide')

    const conversation = await this.prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      include: { members: { select: { userId: true } } },
    })
    if (!conversation.isGroup) {
      const other = conversation.members.find((m) => m.userId !== userId)
      if (other) await this.assertNotBlocked(userId, other.userId)
    }
    if (input.replyToId) {
      const target = await this.prisma.message.findFirst({ where: { id: input.replyToId, conversationId } })
      if (!target) throw new ValidationError('Message cité introuvable')
    }

    const stored = await Promise.all(files.map((f) => this.storage.save(f, ['image', 'video', 'audio', 'file'])))
    const now = new Date()
    const message = await this.prisma.message.create({
      data: {
        conversationId,
        senderId: userId,
        content,
        replyToId: input.replyToId,
        attachments: {
          create: stored.map((s) => ({
            type: KIND_TO_TYPE[s.kind],
            url: s.url,
            filename: s.filename,
            size: s.size,
            mimeType: s.mimeType,
          })),
        },
      },
      include: messageInclude,
    })
    await this.prisma.$transaction([
      this.prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: now } }),
      this.prisma.conversationMember.update({
        where: { conversationId_userId: { conversationId, userId } },
        data: { lastReadAt: now },
      }),
    ])

    const presented = this.present({ ...message, isStarred: false })
    await this.broadcast(conversationId, 'message:new', presented)

    // Notification pour les membres hors ligne.
    const sender = message.sender
    for (const m of conversation.members) {
      if (m.userId === userId || this.realtime.isOnline(m.userId)) continue
      await this.notifications.notify(m.userId, {
        type: 'MESSAGE',
        senderId: userId,
        content: conversation.isGroup
          ? `${sender.firstName} a écrit dans « ${conversation.name ?? 'Groupe'} »`
          : `${sender.firstName} vous a envoyé un message`,
        link: `/messages?c=${conversationId}`,
      })
    }
    return presented
  }

  async markRead(conversationId: string, userId: string): Promise<void> {
    await this.membership(conversationId, userId)
    const at = new Date()
    await this.prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { lastReadAt: at },
    })
    await this.broadcast(conversationId, 'conversation:read', { conversationId, userId, at })
  }

  async deleteMessage(id: string, userId: string): Promise<void> {
    const message = await this.prisma.message.findUnique({ where: { id } })
    if (!message || message.deletedAt) throw new NotFoundError('Message')
    if (message.senderId !== userId) throw new ForbiddenError('Vous ne pouvez supprimer que vos messages')
    await this.prisma.message.update({ where: { id }, data: { deletedAt: new Date(), content: '' } })
    const attachments = await this.prisma.messageAttachment.findMany({ where: { messageId: id } })
    await this.prisma.messageAttachment.deleteMany({ where: { messageId: id } })
    await Promise.all(attachments.map((a) => this.storage.remove(a.url)))
    await this.broadcast(message.conversationId, 'message:deleted', { id, conversationId: message.conversationId })
  }

  async react(id: string, userId: string, emoji: string) {
    const message = await this.messageForMember(id, userId)
    const key = { messageId_userId: { messageId: id, userId } }
    const existing = await this.prisma.messageReaction.findUnique({ where: key })
    if (existing?.emoji === emoji) await this.prisma.messageReaction.delete({ where: key })
    else await this.prisma.messageReaction.upsert({ where: key, create: { messageId: id, userId, emoji }, update: { emoji } })

    const reactions = await this.prisma.messageReaction.findMany({
      where: { messageId: id },
      select: { userId: true, emoji: true },
    })
    await this.broadcast(message.conversationId, 'message:reactions', { id, reactions })
    return reactions
  }

  async toggleStar(id: string, userId: string) {
    await this.messageForMember(id, userId)
    const key = { messageId_userId: { messageId: id, userId } }
    if (await this.prisma.messageStar.findUnique({ where: key })) {
      await this.prisma.messageStar.delete({ where: key })
      return { isStarred: false }
    }
    await this.prisma.messageStar.create({ data: { messageId: id, userId } })
    return { isStarred: true }
  }

  async starred(userId: string) {
    const rows = await this.prisma.messageStar.findMany({
      where: { userId, message: { deletedAt: null, conversation: { members: { some: { userId } } } } },
      include: { message: { include: { ...messageInclude, conversation: { select: { id: true, name: true } } } } },
      take: 200,
    })
    return rows.map((r) => ({ ...this.present({ ...r.message, isStarred: true }), conversation: r.message.conversation }))
  }

  /** Vérifie l'appartenance (utilisé aussi par la passerelle temps réel et les appels). */
  async membership(conversationId: string, userId: string) {
    const member = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    })
    if (!member) throw new ForbiddenError('Vous ne participez pas à cette conversation')
    return member
  }

  async memberIds(conversationId: string): Promise<string[]> {
    const members = await this.prisma.conversationMember.findMany({
      where: { conversationId },
      select: { userId: true },
    })
    return members.map((m) => m.userId)
  }

  /** Messages éphémères : suppression des messages expirés chaque minute. */
  @Cron(CronExpression.EVERY_MINUTE)
  async purgeExpired(): Promise<void> {
    const conversations = await this.prisma.conversation.findMany({
      where: { disappearingSeconds: { gt: 0 } },
      select: { id: true, disappearingSeconds: true },
    })
    for (const c of conversations) {
      await this.prisma.message.deleteMany({
        where: { conversationId: c.id, createdAt: { lt: new Date(Date.now() - c.disappearingSeconds * 1000) } },
      })
    }
  }

  private async messageForMember(id: string, userId: string) {
    const message = await this.prisma.message.findUnique({ where: { id } })
    if (!message || message.deletedAt) throw new NotFoundError('Message')
    await this.membership(message.conversationId, userId)
    return message
  }

  private async assertNotBlocked(a: string, b: string): Promise<void> {
    const block = await this.prisma.userBlock.findFirst({
      where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] },
    })
    if (block) {
      throw new ConflictError(
        block.blockerId === a ? 'Vous avez bloqué cet utilisateur' : 'Cet utilisateur ne peut pas recevoir vos messages',
      )
    }
  }

  private async broadcast(conversationId: string, event: string, payload: unknown): Promise<void> {
    for (const id of await this.memberIds(conversationId)) this.realtime.toUser(id, event, payload)
  }

  private present<T extends { deletedAt: Date | null; content: string }>(m: T) {
    return m.deletedAt ? { ...m, content: '', attachments: [], reactions: [] } : m
  }
}
