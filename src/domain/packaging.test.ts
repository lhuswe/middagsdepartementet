import { describe, expect, it } from 'vitest'

import { aggregateNeeds, subtractPantry, type PlannedMeal } from './aggregate.ts'
import { makeProduct, makePromotion, makeRecipe } from './fixtures.ts'
import { selectPackaging } from './packaging.ts'
import type { AggregatedNeed } from './aggregate.ts'

const DURING = new Date('2026-08-28T12:00:00+02:00')

/** Bygger ett behov av en enda ingrediens, uttryckt i gram. */
function needOf(ingredientId: string, grams: number): AggregatedNeed {
  const recipe = makeRecipe(
    { id: 'test', name: 'Test', servings: 1 },
    [[ingredientId, grams, 'g']],
  )
  const [need] = aggregateNeeds([{ recipe, servings: 1 }])
  if (!need) throw new Error('Inget behov byggdes')
  return need
}

describe('selectPackaging - styckvara', () => {
  const halvkilo = makeProduct({ name: 'Blandfärs', descriptiveSize: '500G', price: 45 })
  const helkilo = makeProduct({ name: 'Blandfärs', descriptiveSize: '1KG', price: 82 })

  // Precis det fall originalspecen bad om: "föredra 1 kg framför 2 × 500 g
  // där det är ekonomiskt vettigt".
  it('väljer 1 kg framför 2 × 500 g när kilot är billigare', () => {
    const result = selectPackaging(needOf('blandfars', 900), [halvkilo, helkilo])
    expect(result.best?.product.descriptiveSize).toBe('1KG')
    expect(result.best?.quantity).toBe(1)
    expect(result.best?.price.total).toBeCloseTo(82, 2)
    expect(result.best?.overbuy).toBeCloseTo(100, 5)
  })

  it('väljer flera små förpackningar när det blir billigare', () => {
    const dyrtKilo = makeProduct({ name: 'Blandfärs', descriptiveSize: '1KG', price: 120 })
    const result = selectPackaging(needOf('blandfars', 900), [halvkilo, dyrtKilo])
    expect(result.best?.product.descriptiveSize).toBe('500G')
    expect(result.best?.quantity).toBe(2)
    expect(result.best?.price.total).toBeCloseTo(90, 2)
  })

  it('avvisar orimligt överköp även när det är billigast', () => {
    const tvakilo = makeProduct({ name: 'Blandfärs', descriptiveSize: '2KG', price: 60 })
    // 2 kg kostar 60 kr mot 90 kr för 2 × 500 g - men att köpa 2 kg för ett
    // behov på 900 g är över 100 % överköp. Billigast är inte alltid rimligast.
    const result = selectPackaging(needOf('blandfars', 900), [halvkilo, tvakilo])
    expect(result.best?.product.descriptiveSize).toBe('500G')
    expect(result.best?.quantity).toBe(2)
    // 2 kg finns kvar som alternativ i produktväljaren, bara inte som förval.
    expect(result.alternatives.map((o) => o.product.descriptiveSize)).toContain('2KG')
  })

  it('accepterar stort överköp när inget annat finns', () => {
    const kilopaket = makeProduct({ name: 'Gul lök', descriptiveSize: '1KG', price: 22 })
    const result = selectPackaging(needOf('gul_lok', 165), [kilopaket])
    expect(result.best?.quantity).toBe(1)
    expect(result.best?.overbuy).toBeCloseTo(835, 5)
  })

  it('avrundar uppåt till hela förpackningar', () => {
    const result = selectPackaging(needOf('krossade_tomater', 600), [
      makeProduct({ name: 'Krossade tomater', descriptiveSize: '400G', price: 10.35 }),
    ])
    expect(result.best?.quantity).toBe(2)
    expect(result.best?.purchased).toBe(800)
  })

  it('köper inte en extra burk för tio grams skull', () => {
    // Receptet säger 400 g, burken är 390 g. Två burkar vore aritmetiskt
    // korrekt och praktiskt dumt.
    const result = selectPackaging(needOf('krossade_tomater', 400), [
      makeProduct({ name: 'Krossade tomater', descriptiveSize: '390G', price: 10.35 }),
    ])
    expect(result.best?.quantity).toBe(1)
  })

  it('men lägger till en förpackning när glappet är verkligt', () => {
    const result = selectPackaging(needOf('krossade_tomater', 500), [
      makeProduct({ name: 'Krossade tomater', descriptiveSize: '390G', price: 10.35 }),
    ])
    expect(result.best?.quantity).toBe(2)
  })
})

describe('selectPackaging - lösvikt', () => {
  // Grenen originalspecen inte kände till. "Tomater Kvist CA 160G" beställs i
  // antal men betalas per kilo, och då uppstår inget överköp alls.
  const losvikt = makeProduct({
    name: 'Gul lök lösvikt',
    descriptiveSize: 'CA110G',
    sellingUnit: 'KGM',
    price: 19.9,
  })

  it('köper exakt mängd utan överköp värt namnet', () => {
    const result = selectPackaging(needOf('gul_lok', 165), [losvikt])
    expect(result.best?.quantity).toBeCloseTo(0.17, 3)
    expect(result.best?.price.total).toBeCloseTo(0.17 * 19.9, 2)
    expect(result.best?.overbuy).toBeLessThanOrEqual(10)
  })

  it('vinner över ett kilopaket när behovet är litet', () => {
    const kilopaket = makeProduct({ name: 'Gul lök', descriptiveSize: '1KG', price: 22 })
    const result = selectPackaging(needOf('gul_lok', 165), [kilopaket, losvikt])
    expect(result.best?.product.sellingUnit).toBe('KGM')
  })
})

describe('selectPackaging - kampanjer', () => {
  it('låter en uppnådd kampanj avgöra vilken förpackning som vinner', () => {
    const kampanjvara = makeProduct({
      name: 'Krossade tomater',
      descriptiveSize: '400G',
      price: 10.35,
      promotions: [makePromotion({ effectType: 'ItemsTotal', minQuantity: 3, value: 21 })],
    })
    const storpack = makeProduct({
      name: 'Krossade tomater',
      descriptiveSize: '500G',
      price: 11,
    })

    // Behov 1200 g: 3 × 400 g träffar kampanjen (21 kr) och slår 3 × 500 g (33 kr).
    const result = selectPackaging(needOf('krossade_tomater', 1200), [kampanjvara, storpack], {
      at: DURING,
    })
    expect(result.best?.product.descriptiveSize).toBe('400G')
    expect(result.best?.quantity).toBe(3)
    expect(result.best?.price.total).toBeCloseTo(21, 2)
  })

  it('räknar inte med en kampanj som antalet inte når upp till', () => {
    const kampanjvara = makeProduct({
      name: 'Krossade tomater',
      descriptiveSize: '400G',
      price: 10.35,
      promotions: [makePromotion({ effectType: 'ItemsTotal', minQuantity: 3, value: 21 })],
    })
    const result = selectPackaging(needOf('krossade_tomater', 400), [kampanjvara], {
      at: DURING,
    })
    expect(result.best?.quantity).toBe(1)
    expect(result.best?.price.total).toBeCloseTo(10.35, 2)
    expect(result.best?.price.promotionUnmet).toBe(true)
  })
})

describe('selectPackaging - förpackningsangivna behov', () => {
  it('löser upp "2 burkar" mot butikens faktiska burkstorlek', () => {
    const recipe = makeRecipe(
      { id: 'gryta', name: 'Gryta', servings: 4 },
      [['krossade_tomater', 2, 'burk']],
    )
    const [need] = aggregateNeeds([{ recipe, servings: 4 }])
    const result = selectPackaging(need!, [
      makeProduct({ name: 'Krossade tomater', descriptiveSize: '390G', price: 10.35 }),
    ])
    expect(result.requiredAmount).toBe(780)
    expect(result.best?.quantity).toBe(2)
  })
})

describe('selectPackaging - när det inte går', () => {
  it('säger ifrån när ingen produkt matchade', () => {
    const result = selectPackaging(needOf('blandfars', 500), [])
    expect(result.best).toBeNull()
    expect(result.reason).toContain('Ingen matchande produkt')
  })

  it('säger ifrån när storleken inte gick att tolka', () => {
    const otolkbar = makeProduct({
      name: 'Blandfärs',
      descriptiveSize: 'KLASS 1',
      price: 45,
    })
    const result = selectPackaging(needOf('blandfars', 500), [otolkbar])
    expect(result.best).toBeNull()
    expect(result.reason).toContain('gick inte att räkna om')
  })
})

/**
 * Acceptanstest - hela kedjan från veckoplan till kundvagn.
 *
 * Bygger på originalspecens räkneexempel, men med korrigerad aritmetik: specen
 * påstod att måndag (4 portioner) plus torsdag (6 portioner) ger 750 g köttfärs.
 * Det är bara torsdagen. Rätt svar är 500 + 750 = 1250 g.
 */
describe('acceptans: veckoplan → inköpslista', () => {
  const kottfarssas = makeRecipe(
    { id: 'kottfarssas', name: 'Köttfärssås', servings: 4 },
    [
      ['blandfars', 500, 'g'],
      ['gul_lok', 1, 'st'],
      ['krossade_tomater', 400, 'g'],
      ['pasta', 300, 'g'],
    ],
  )

  const vecka: PlannedMeal[] = [
    { recipe: kottfarssas, servings: 4, slotId: 'mandag' },
    { recipe: kottfarssas, servings: 6, slotId: 'torsdag' },
  ]

  const skafferi = [
    { ingredientId: 'blandfars', amount: 200 },
    { ingredientId: 'gul_lok', amount: 110 },
    { ingredientId: 'pasta', amount: 500 },
  ]

  const sortiment = {
    blandfars: [
      makeProduct({ name: 'Blandfärs 50/50', descriptiveSize: '500G', price: 45 }),
      makeProduct({ name: 'Blandfärs 50/50', descriptiveSize: '1KG', price: 82 }),
    ],
    krossade_tomater: [
      makeProduct({ name: 'Tomater Krossade', descriptiveSize: '400G', price: 10.35 }),
      makeProduct({ name: 'Tomater Krossade', descriptiveSize: '500G', price: 13 }),
    ],
    gul_lok: [makeProduct({ name: 'Gul Lök', descriptiveSize: '1KG', price: 22 })],
    pasta: [
      makeProduct({ name: 'Spaghetti', descriptiveSize: '500G', price: 15 }),
      makeProduct({ name: 'Spaghetti', descriptiveSize: '1KG', price: 25 }),
    ],
  } as const

  it('räknar hela vägen från recept till antal förpackningar', () => {
    const needs = subtractPantry(aggregateNeeds(vecka), skafferi)
    const byId = new Map(needs.map((need) => [need.ingredient.id, need]))

    const fars = selectPackaging(byId.get('blandfars')!, [...sortiment.blandfars])
    expect(byId.get('blandfars')!.toBuy.value).toBe(1050)
    expect(fars.best?.product.descriptiveSize).toBe('500G')
    expect(fars.best?.quantity).toBe(3)
    expect(fars.best?.price.total).toBeCloseTo(135, 2)

    const tomater = selectPackaging(byId.get('krossade_tomater')!, [
      ...sortiment.krossade_tomater,
    ])
    expect(byId.get('krossade_tomater')!.toBuy.value).toBe(1000)
    expect(tomater.best?.product.descriptiveSize).toBe('500G')
    expect(tomater.best?.quantity).toBe(2)
    expect(tomater.best?.overbuy).toBe(0)

    const lok = selectPackaging(byId.get('gul_lok')!, [...sortiment.gul_lok])
    expect(byId.get('gul_lok')!.toBuy.value).toBeCloseTo(165, 5)
    expect(lok.best?.quantity).toBe(1)

    const pastan = selectPackaging(byId.get('pasta')!, [...sortiment.pasta])
    expect(byId.get('pasta')!.toBuy.value).toBe(250)
    expect(pastan.best?.product.descriptiveSize).toBe('500G')
    expect(pastan.best?.quantity).toBe(1)
  })

  it('summerar veckans nota', () => {
    const needs = subtractPantry(aggregateNeeds(vecka), skafferi)
    const byId = new Map(needs.map((need) => [need.ingredient.id, need]))

    const total = (['blandfars', 'krossade_tomater', 'gul_lok', 'pasta'] as const)
      .map((id) => selectPackaging(byId.get(id)!, [...sortiment[id]]).best?.price.total ?? 0)
      .reduce((sum, value) => sum + value, 0)

    // 135 (färs) + 26 (tomater) + 22 (lök) + 15 (pasta)
    expect(total).toBeCloseTo(198, 2)
  })
})
