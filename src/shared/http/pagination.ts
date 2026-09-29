import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator'

/** Pagination par curseur (id du dernier élément reçu). */
export class CursorQueryDto {
  @ApiPropertyOptional({ description: "Id du dernier élément de la page précédente" })
  @IsOptional()
  @IsUUID()
  cursor?: string

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20
}

export interface CursorPage<T> {
  items: T[]
  nextCursor: string | null
}

/** Construit une page à partir de `limit + 1` éléments lus en base. */
export function toCursorPage<T extends { id: string }>(rows: T[], limit: number): CursorPage<T> {
  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  return { items, nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null }
}

/** Arguments Prisma correspondants. */
export function cursorArgs(query: CursorQueryDto): { take: number; skip?: number; cursor?: { id: string } } {
  return query.cursor
    ? { take: query.limit + 1, skip: 1, cursor: { id: query.cursor } }
    : { take: query.limit + 1 }
}
