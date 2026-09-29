import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, Put } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { ApiProperty, ApiTags } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsInt, IsUUID, Max, Min, ValidateNested } from 'class-validator'
import { PrismaService } from '../../infrastructure/prisma/prisma.service'
import type { AuthUser } from '../../shared/auth/auth-user'
import { CurrentUser } from '../../shared/auth/decorators'
import { Events, type OrderPlacedEvent } from '../../shared/events'

class CartLineDto {
  @ApiProperty() @IsUUID() dishId!: string
  @ApiProperty() @IsInt() @Min(1) @Max(50) quantity!: number
}

class ReplaceCartDto {
  @ApiProperty({ type: [CartLineDto] })
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => CartLineDto)
  items!: CartLineDto[]
}

/**
 * Panier serveur des clients connectés. Le navigateur tient le panier (Zustand) et le
 * synchronise ici à la connexion et à chaque modification, pour le retrouver sur un autre appareil.
 */
@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string) {
    const cart = await this.prisma.cart.findUnique({
      where: { userId },
      include: {
        items: {
          where: { dish: { deletedAt: null } },
          include: {
            dish: {
              select: {
                id: true,
                slug: true,
                name: true,
                price: true,
                imageUrl: true,
                imageAlt: true,
                isAvailable: true,
                stock: true,
              },
            },
          },
        },
      },
    })
    const items = (cart?.items ?? []).map((i) => ({ dishId: i.dishId, quantity: i.quantity, dish: i.dish }))
    return {
      items,
      total: items.reduce((sum, i) => sum + i.dish.price * i.quantity, 0),
      itemCount: items.reduce((sum, i) => sum + i.quantity, 0),
    }
  }

  async replace(userId: string, lines: CartLineDto[]) {
    const merged = new Map<string, number>()
    for (const l of lines) merged.set(l.dishId, Math.min(50, (merged.get(l.dishId) ?? 0) + l.quantity))
    const existing = await this.prisma.dish.findMany({
      where: { id: { in: [...merged.keys()] }, deletedAt: null },
      select: { id: true },
    })
    const valid = existing.map((d) => d.id)

    await this.prisma.$transaction(async (tx) => {
      const cart = await tx.cart.upsert({ where: { userId }, create: { userId }, update: {} })
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } })
      await tx.cartItem.createMany({
        data: valid.map((dishId) => ({ cartId: cart.id, dishId, quantity: merged.get(dishId)! })),
      })
    })
    return this.get(userId)
  }

  async clear(userId: string): Promise<void> {
    await this.prisma.cartItem.deleteMany({ where: { cart: { userId } } })
  }

  /** Une commande passée vide le panier du client. */
  @OnEvent(Events.OrderPlaced, { async: true })
  async onOrderPlaced(e: OrderPlacedEvent): Promise<void> {
    if (e.userId && e.type !== 'DINE_IN') await this.clear(e.userId)
  }
}

@ApiTags('cart')
@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.cart.get(user.id)
  }

  @Put()
  replace(@CurrentUser() user: AuthUser, @Body() dto: ReplaceCartDto) {
    return this.cart.replace(user.id, dto.items)
  }

  @Delete()
  @HttpCode(204)
  clear(@CurrentUser() user: AuthUser) {
    return this.cart.clear(user.id)
  }
}

@Module({ controllers: [CartController], providers: [CartService] })
export class CartModule {}
