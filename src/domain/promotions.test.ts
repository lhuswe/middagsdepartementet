import { describe, expect, it } from 'vitest'

import { makeProduct, makePromotion } from './fixtures.ts'
import { applicablePromotions, calculatePrice, isPromotionActive } from './promotions.ts'

/** Inom kampanjfönstret i fixturerna (2026-08-24 → 2026-08-30). */
const DURING = new Date('2026-08-28T12:00:00+02:00')
const AFTER = new Date('2026-09-05T12:00:00+02:00')

describe('calculatePrice — ItemsTotal ("3 för 28 kr")', () => {
  const product = makeProduct({
    name: 'Tomater Krossade',
    descriptiveSize: '390G',
    price: 10.35,
    promotions: [
      makePromotion({ effectType: 'ItemsTotal', minQuantity: 3, value: 28 }),
    ],
  })

  // Det här är felet originalspecen hade byggt in: den hade räknat rabatt
  // oavsett antal och underskattat notan varje gång.
  it('ger INTE rabatt under minimiantalet', () => {
    const result = calculatePrice(product, 2, { at: DURING })
    expect(result.total).toBeCloseTo(20.7, 2)
    expect(result.promotion).toBeNull()
    expect(result.promotionUnmet).toBe(true)
    expect(result.missingForPromotion).toBe(1)
  })

  it('ger rabatt vid exakt minimiantal', () => {
    const result = calculatePrice(product, 3, { at: DURING })
    expect(result.total).toBeCloseTo(28, 2)
    expect(result.savings).toBeCloseTo(31.05 - 28, 2)
  })

  it('räknar hela grupper och ordinarie pris på resten', () => {
    // 7 st = 2 grupper à 28 kr + 1 st à 10,35 kr
    const result = calculatePrice(product, 7, { at: DURING })
    expect(result.total).toBeCloseTo(28 * 2 + 10.35, 2)
  })

  it('respekterar maxAppliedPerReceipt', () => {
    const limited = makeProduct({
      name: 'Tomater Krossade',
      descriptiveSize: '390G',
      price: 10.35,
      promotions: [
        makePromotion({
          effectType: 'ItemsTotal',
          minQuantity: 3,
          value: 28,
          maxAppliedPerReceipt: 1,
        }),
      ],
    })
    // 6 st, men bara en grupp får rabatteras: 28 kr + 3 × 10,35 kr
    const result = calculatePrice(limited, 6, { at: DURING })
    expect(result.total).toBeCloseTo(28 + 3 * 10.35, 2)
  })
})

describe('calculatePrice — PriceChangeAll', () => {
  const product = makeProduct({
    name: 'Spetskål',
    descriptiveSize: 'CA600G',
    price: 39.95,
    sellingUnit: 'KGM',
    promotions: [
      makePromotion({ effectType: 'PriceChangeAll', minQuantity: 1, value: 21.95, price: 21.95 }),
    ],
  })

  it('sätter ned priset rakt av', () => {
    const result = calculatePrice(product, 2, { at: DURING })
    expect(result.total).toBeCloseTo(43.9, 2)
    expect(result.savings).toBeCloseTo(79.9 - 43.9, 2)
  })
})

describe('kampanjers giltighet', () => {
  const product = makeProduct({
    name: 'Kaffe',
    price: 79.95,
    promotions: [makePromotion({ effectType: 'PriceChangeAll', value: 59.95, price: 59.95 })],
  })

  it('ignorerar kampanjer utanför sitt tidsfönster', () => {
    expect(calculatePrice(product, 1, { at: AFTER }).total).toBeCloseTo(79.95, 2)
    expect(calculatePrice(product, 1, { at: DURING }).total).toBeCloseTo(59.95, 2)
  })

  it('räknar medlemspris bara för medlemmar', () => {
    const memberOnly = makeProduct({
      name: 'Kaffe',
      price: 79.95,
      promotions: [
        makePromotion({
          effectType: 'PriceChangeAll',
          value: 49.95,
          price: 49.95,
          membersOnly: true,
        }),
      ],
    })
    expect(calculatePrice(memberOnly, 1, { at: DURING }).total).toBeCloseTo(79.95, 2)
    expect(
      calculatePrice(memberOnly, 1, { at: DURING, isMember: true }).total,
    ).toBeCloseTo(49.95, 2)
  })

  it('ignorerar okända kampanjtyper och använder ordinarie pris', () => {
    const weird = makeProduct({
      name: 'Mystisk vara',
      price: 50,
      promotions: [makePromotion({ effectType: 'NågotHeltNytt', value: 5 })],
    })
    const result = calculatePrice(weird, 2, { at: DURING })
    expect(result.total).toBeCloseTo(100, 2)
    expect(result.promotion).toBeNull()
    expect(applicablePromotions(weird, { at: DURING })).toHaveLength(0)
  })

  it('hanterar trasiga datum utan att krascha', () => {
    expect(isPromotionActive(makePromotion({ from: 'inte-ett-datum' }), DURING)).toBe(false)
  })
})

describe('calculatePrice — gränsfall', () => {
  it('noll i antal kostar noll', () => {
    const result = calculatePrice(makeProduct({ name: 'Vara' }), 0)
    expect(result.total).toBe(0)
  })
})
