import { Injectable } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../../infrastructure/prisma/prisma.service'
import { StorageService, type UploadedFileLike } from '../../../infrastructure/storage/storage.service'
import { ConflictError, NotFoundError } from '../../../shared/domain/domain-error'
import { slugify } from '../../../shared/domain/slug'
import { Events, type MenuUpdatedEvent } from '../../../shared/events'
import { cursorArgs, toCursorPage } from '../../../shared/http/pagination'
import type { CategoryDto, CreateDishDto, DishesQueryDto, UpdateDishDto } from '../presentation/menu.dto'

const dishInclude = {
  category: { select: { id: true, name: true, slug: true } },
  options: { select: { id: true, name: true, extraPrice: true } },
} satisfies Prisma.DishInclude

@Injectable()
export class MenuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly events: EventEmitter2,
  ) {}

  // ───────── Lecture publique

  async categories(includeHidden = false) {
    const categories = await this.prisma.category.findMany({
      where: includeHidden ? {} : { isVisible: true },
      orderBy: { position: 'asc' },
      include: {
        _count: { select: { dishes: { where: { deletedAt: null, isAvailable: true } } } },
      },
    })
    return categories.map(({ _count, ...c }) => ({ ...c, dishCount: _count.dishes }))
  }

  async dishes(query: DishesQueryDto) {
    const where: Prisma.DishWhereInput = {
      deletedAt: null,
      ...(query.includeUnavailable ? {} : { isAvailable: true, category: { isVisible: true } }),
      ...(query.category ? { category: { slug: query.category } } : {}),
      ...(query.featured ? { isFeatured: true } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.tags?.length ? { tags: { hasEvery: query.tags } } : {}),
      ...(query.excludeAllergens?.length
        ? { NOT: { allergens: { hasSome: query.excludeAllergens } } }
        : {}),
    }
    const rows = await this.prisma.dish.findMany({
      where,
      include: dishInclude,
      orderBy: [{ isFeatured: 'desc' }, { name: 'asc' }, { id: 'asc' }],
      ...cursorArgs(query),
    })
    return toCursorPage(rows, query.limit)
  }

  async dishBySlug(slug: string) {
    const dish = await this.prisma.dish.findFirst({
      where: { slug, deletedAt: null },
      include: dishInclude,
    })
    if (!dish) throw new NotFoundError('Plat')
    return dish
  }

  /** Slugs de tous les plats (génération statique des fiches côté Next.js). */
  slugs() {
    return this.prisma.dish.findMany({
      where: { deletedAt: null, isAvailable: true },
      select: { slug: true, updatedAt: true },
    })
  }

  // ───────── Administration des catégories

  async createCategory(dto: CategoryDto) {
    const category = await this.prisma.category.create({
      data: { ...dto, slug: await this.uniqueCategorySlug(dto.name) },
    })
    this.changed()
    return category
  }

  async updateCategory(id: string, dto: CategoryDto) {
    const category = await this.prisma.category.update({ where: { id }, data: dto })
    this.changed()
    return category
  }

  async deleteCategory(id: string): Promise<void> {
    const count = await this.prisma.dish.count({ where: { categoryId: id, deletedAt: null } })
    if (count > 0) throw new ConflictError('Cette catégorie contient encore des plats')
    await this.prisma.category.delete({ where: { id } })
    this.changed()
  }

  // ───────── Administration des plats

  async createDish(dto: CreateDishDto) {
    const { options, ...data } = dto
    const dish = await this.prisma.dish.create({
      data: {
        ...data,
        slug: await this.uniqueDishSlug(dto.name),
        options: options ? { create: options } : undefined,
      },
      include: dishInclude,
    })
    this.changed(dish.slug)
    return dish
  }

  async updateDish(id: string, dto: UpdateDishDto) {
    await this.findDish(id)
    const { options, ...data } = dto
    const dish = await this.prisma.$transaction(async (tx) => {
      if (options) {
        await tx.dishOption.deleteMany({ where: { dishId: id } })
        await tx.dishOption.createMany({ data: options.map((o) => ({ ...o, dishId: id })) })
      }
      return tx.dish.update({ where: { id }, data, include: dishInclude })
    })
    this.changed(dish.slug)
    return dish
  }

  async uploadDishImage(id: string, file: UploadedFileLike) {
    const dish = await this.findDish(id)
    const stored = await this.storage.save(file, ['image'])
    const updated = await this.prisma.dish.update({
      where: { id },
      data: { imageUrl: stored.url },
      include: dishInclude,
    })
    await this.storage.remove(dish.imageUrl)
    this.changed(dish.slug)
    return updated
  }

  async deleteDish(id: string): Promise<void> {
    const dish = await this.findDish(id)
    await this.prisma.dish.update({
      where: { id },
      data: { deletedAt: new Date(), isAvailable: false },
    })
    this.changed(dish.slug)
  }

  async uploadImage(file: UploadedFileLike) {
    return this.storage.save(file, ['image'])
  }

  private async findDish(id: string) {
    const dish = await this.prisma.dish.findFirst({ where: { id, deletedAt: null } })
    if (!dish) throw new NotFoundError('Plat')
    return dish
  }

  private async uniqueDishSlug(name: string): Promise<string> {
    const base = slugify(name) || 'plat'
    let slug = base
    for (let i = 2; await this.prisma.dish.findUnique({ where: { slug } }); i++) slug = `${base}-${i}`
    return slug
  }

  private async uniqueCategorySlug(name: string): Promise<string> {
    const base = slugify(name) || 'categorie'
    let slug = base
    for (let i = 2; await this.prisma.category.findUnique({ where: { slug } }); i++) {
      slug = `${base}-${i}`
    }
    return slug
  }

  private changed(dishSlug?: string): void {
    this.events.emit(Events.MenuUpdated, { dishSlug } satisfies MenuUpdatedEvent)
  }
}
