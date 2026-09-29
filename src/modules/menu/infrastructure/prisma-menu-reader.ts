import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../../infrastructure/prisma/prisma.service'
import type { DishSnapshot, MenuReader } from '../application/menu-reader.port'

@Injectable()
export class PrismaMenuReader implements MenuReader {
  constructor(private readonly prisma: PrismaService) {}

  findByIds(ids: string[]): Promise<DishSnapshot[]> {
    return this.prisma.dish.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, name: true, price: true, imageUrl: true, stock: true, isAvailable: true },
    })
  }
}
