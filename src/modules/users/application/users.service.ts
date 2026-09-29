import { Injectable } from '@nestjs/common'
import type { Role } from '@prisma/client'
import { PrismaService } from '../../../infrastructure/prisma/prisma.service'
import { StorageService, type UploadedFileLike } from '../../../infrastructure/storage/storage.service'
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/domain/domain-error'
import { TokenService } from '../../auth/application/token.service'
import type { AddressDto, UpdateProfileDto } from '../presentation/users.dto'
import { presentUser, publicUserSelect } from './user.presenter'

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly tokens: TokenService,
  ) {}

  // ───────── Profil

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        bio: dto.bio,
        orangeMoneyNumber: dto.orangeMoneyNumber,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
      },
    })
    return presentUser(user)
  }

  async setImage(userId: string, field: 'avatarUrl' | 'coverUrl', file: UploadedFileLike) {
    const current = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } })
    const stored = await this.storage.save(file, ['image'])
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { [field]: stored.url },
    })
    await this.storage.remove(current[field])
    return presentUser(user)
  }

  /** Suppression par l'utilisateur : données personnelles anonymisées, historique conservé. */
  async deleteAccount(userId: string): Promise<void> {
    await this.anonymize(userId)
  }

  // ───────── Adresses

  listAddresses(userId: string) {
    return this.prisma.address.findMany({ where: { userId }, orderBy: { isDefault: 'desc' } })
  }

  async createAddress(userId: string, dto: AddressDto) {
    const count = await this.prisma.address.count({ where: { userId } })
    if (count >= 10) throw new ValidationError('10 adresses maximum')
    const isDefault = dto.isDefault ?? count === 0
    return this.prisma.$transaction(async (tx) => {
      if (isDefault) await tx.address.updateMany({ where: { userId }, data: { isDefault: false } })
      return tx.address.create({ data: { ...dto, isDefault, userId } })
    })
  }

  async updateAddress(userId: string, id: string, dto: AddressDto) {
    await this.ownAddress(userId, id)
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) await tx.address.updateMany({ where: { userId }, data: { isDefault: false } })
      return tx.address.update({ where: { id }, data: dto })
    })
  }

  async deleteAddress(userId: string, id: string): Promise<void> {
    await this.ownAddress(userId, id)
    await this.prisma.address.delete({ where: { id } })
  }

  private async ownAddress(userId: string, id: string) {
    const address = await this.prisma.address.findFirst({ where: { id, userId } })
    if (!address) throw new NotFoundError('Adresse')
    return address
  }

  // ───────── Plats favoris

  async favoriteDishes(userId: string) {
    const rows = await this.prisma.favoriteDish.findMany({
      where: { userId, dish: { deletedAt: null } },
      include: { dish: { include: { category: true } } },
      orderBy: { createdAt: 'desc' },
    })
    return rows.map((r) => r.dish)
  }

  async toggleFavoriteDish(userId: string, dishId: string) {
    const existing = await this.prisma.favoriteDish.findUnique({
      where: { userId_dishId: { userId, dishId } },
    })
    if (existing) {
      await this.prisma.favoriteDish.delete({ where: { userId_dishId: { userId, dishId } } })
      return { isFavorite: false }
    }
    const dish = await this.prisma.dish.findFirst({ where: { id: dishId, deletedAt: null } })
    if (!dish) throw new NotFoundError('Plat')
    await this.prisma.favoriteDish.create({ data: { userId, dishId } })
    return { isFavorite: true }
  }

  // ───────── Contacts (messagerie)

  searchContacts(userId: string, q?: string) {
    return this.prisma.user.findMany({
      where: {
        id: { not: userId },
        deletedAt: null,
        isActive: true,
        ...(q
          ? {
              OR: [
                { firstName: { contains: q, mode: 'insensitive' } },
                { lastName: { contains: q, mode: 'insensitive' } },
                { email: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: publicUserSelect,
      orderBy: { firstName: 'asc' },
      take: 50,
    })
  }

  async block(userId: string, targetId: string): Promise<void> {
    if (userId === targetId) throw new ValidationError('Action impossible sur vous-même')
    await this.ensureUser(targetId)
    await this.prisma.userBlock.upsert({
      where: { blockerId_blockedId: { blockerId: userId, blockedId: targetId } },
      create: { blockerId: userId, blockedId: targetId },
      update: {},
    })
  }

  async unblock(userId: string, targetId: string): Promise<void> {
    await this.prisma.userBlock.deleteMany({ where: { blockerId: userId, blockedId: targetId } })
  }

  async blocked(userId: string) {
    const rows = await this.prisma.userBlock.findMany({
      where: { blockerId: userId },
      include: { blocked: { select: publicUserSelect } },
    })
    return rows.map((r) => r.blocked)
  }

  async toggleFavoriteContact(userId: string, targetId: string) {
    if (userId === targetId) throw new ValidationError('Action impossible sur vous-même')
    const key = { ownerId_contactId: { ownerId: userId, contactId: targetId } }
    if (await this.prisma.favoriteContact.findUnique({ where: key })) {
      await this.prisma.favoriteContact.delete({ where: key })
      return { isFavorite: false }
    }
    await this.ensureUser(targetId)
    await this.prisma.favoriteContact.create({ data: { ownerId: userId, contactId: targetId } })
    return { isFavorite: true }
  }

  async favoriteContacts(userId: string) {
    const rows = await this.prisma.favoriteContact.findMany({
      where: { ownerId: userId },
      include: { contact: { select: publicUserSelect } },
    })
    return rows.map((r) => r.contact)
  }

  // ───────── Administration

  async list(q?: string) {
    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        ...(q
          ? {
              OR: [
                { firstName: { contains: q, mode: 'insensitive' } },
                { lastName: { contains: q, mode: 'insensitive' } },
                { email: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    })
    return users.map((u) => ({ ...presentUser(u), isActive: u.isActive, lastLoginAt: u.lastLoginAt }))
  }

  async setRole(actorId: string, id: string, role: Role) {
    if (actorId === id) throw new ConflictError('Vous ne pouvez pas modifier votre propre rôle')
    const user = await this.prisma.user.update({ where: { id }, data: { role } })
    await this.tokens.revokeAllForUser(id)
    return presentUser(user)
  }

  async setActive(actorId: string, id: string, isActive: boolean) {
    if (actorId === id) throw new ConflictError('Vous ne pouvez pas vous désactiver vous-même')
    await this.prisma.user.update({ where: { id }, data: { isActive } })
    if (!isActive) await this.tokens.revokeAllForUser(id)
  }

  async remove(actorId: string, id: string): Promise<void> {
    if (actorId === id) throw new ConflictError('Vous ne pouvez pas supprimer votre propre compte ici')
    await this.anonymize(id)
  }

  private async anonymize(id: string): Promise<void> {
    await this.ensureUser(id)
    await this.prisma.user.update({
      where: { id },
      data: {
        email: `supprime-${id}@anonyme.invalid`,
        passwordHash: null,
        googleId: null,
        firstName: 'Utilisateur',
        lastName: 'supprimé',
        phone: null,
        bio: null,
        birthDate: null,
        avatarUrl: null,
        coverUrl: null,
        orangeMoneyNumber: null,
        isActive: false,
        deletedAt: new Date(),
      },
    })
    await this.prisma.address.deleteMany({ where: { userId: id } })
    await this.tokens.revokeAllForUser(id)
  }

  private async ensureUser(id: string): Promise<void> {
    const exists = await this.prisma.user.findFirst({ where: { id, deletedAt: null } })
    if (!exists) throw new NotFoundError('Utilisateur')
  }
}
