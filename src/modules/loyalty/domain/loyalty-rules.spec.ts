import { levelFor, meetsLevel, nextLevel, pointsForCashback, pointsForOrder } from './loyalty-rules'

describe('règles de fidélité', () => {
  it('attribue 10 points + 1 par tranche de 1 000 GNF', () => {
    expect(pointsForOrder(0)).toBe(10)
    expect(pointsForOrder(999)).toBe(10)
    expect(pointsForOrder(36_500)).toBe(46)
  })

  it('calcule le niveau à partir du cumul', () => {
    expect(levelFor(0)).toBe('BRONZE')
    expect(levelFor(499)).toBe('BRONZE')
    expect(levelFor(500)).toBe('SILVER')
    expect(levelFor(2_000)).toBe('GOLD')
    expect(levelFor(12_000)).toBe('PLATINUM')
  })

  it('indique le prochain palier', () => {
    expect(nextLevel(600)).toEqual({ level: 'GOLD', minPoints: 2_000 })
    expect(nextLevel(9_000)).toBeNull()
  })

  it('compare les niveaux', () => {
    expect(meetsLevel('GOLD', 'SILVER')).toBe(true)
    expect(meetsLevel('BRONZE', 'GOLD')).toBe(false)
  })

  it('convertit le cashback en points (1 point = 10 GNF)', () => {
    expect(pointsForCashback(10_000)).toBe(1_000)
    expect(pointsForCashback(10_005)).toBe(1_001)
  })
})
