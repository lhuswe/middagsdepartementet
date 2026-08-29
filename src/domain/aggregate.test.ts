import { describe, expect, it } from 'vitest'

import {
  aggregateNeeds,
  needsRequiringPurchase,
  scaleIngredient,
  scaleRecipe,
  subtractPantry,
  type PlannedMeal,
} from './aggregate.ts'
import { makeRecipe } from './fixtures.ts'

const kottfarssas = makeRecipe(
  { id: 'kottfarssas', name: 'Köttfärssås', servings: 4 },
  [
    ['blandfars', 500, 'g'],
    ['gul_lok', 1, 'st'],
    ['krossade_tomater', 400, 'g'],
    ['pasta', 300, 'g'],
    ['salt', 1, 'tsk'],
  ],
)

function needFor(needs: ReturnType<typeof aggregateNeeds>, id: string) {
  const found = needs.find((need) => need.ingredient.id === id)
  if (!found) throw new Error(`Inget behov av ${id} i resultatet`)
  return found
}

describe('scaleIngredient', () => {
  it('skalar linjärt utan att avrunda', () => {
    const item = kottfarssas.ingredients[0]!
    expect(scaleIngredient(item, 4, 6).value).toBe(750)
    expect(scaleIngredient(item, 4, 2).value).toBe(250)
    expect(scaleIngredient(item, 4, 3).value).toBe(375)
  })

  it('behåller brutna styckantal i stället för att avrunda tidigt', () => {
    const lok = kottfarssas.ingredients[1]!
    expect(scaleIngredient(lok, 4, 6).value).toBe(1.5)
  })

  it('vägrar skala ett recept utan portioner', () => {
    expect(() => scaleIngredient(kottfarssas.ingredients[0]!, 0, 4)).toThrow()
  })

  it('skalar hela receptet', () => {
    const scaled = scaleRecipe(kottfarssas, 8)
    expect(scaled).toHaveLength(5)
    expect(scaled[0]!.quantity.value).toBe(1000)
  })
})

describe('aggregateNeeds', () => {
  const veckan: PlannedMeal[] = [
    { recipe: kottfarssas, servings: 4, slotId: 'mandag' },
    { recipe: kottfarssas, servings: 6, slotId: 'torsdag' },
  ]

  it('summerar samma ingrediens över veckans alla mål', () => {
    const needs = aggregateNeeds(veckan)
    expect(needFor(needs, 'blandfars').required.value).toBe(1250)
    expect(needFor(needs, 'krossade_tomater').required.value).toBe(1000)
    expect(needFor(needs, 'pasta').required.value).toBe(750)
  })

  it('räknar om styckantal till gram via styckvikt', () => {
    // 1 + 1,5 lökar = 2,5 × 110 g
    const lok = needFor(aggregateNeeds(veckan), 'gul_lok')
    expect(lok.required.value).toBeCloseTo(275, 5)
    expect(lok.required.confidence).toBe('estimated')
    expect(lok.required.range).toEqual({ min: 200, max: 375 })
  })

  it('behåller spårbarhet till varje bidragande recept', () => {
    const farsen = needFor(aggregateNeeds(veckan), 'blandfars')
    expect(farsen.sources).toHaveLength(2)
    expect(farsen.sources.map((s) => s.servings)).toEqual([4, 6])
  })

  it('samlar förpackningsangivna behov separat', () => {
    const medBurkar = makeRecipe(
      { id: 'gryta', name: 'Gryta', servings: 4 },
      [['krossade_tomater', 2, 'burk']],
    )
    const needs = aggregateNeeds([{ recipe: medBurkar, servings: 4 }])
    const tomater = needFor(needs, 'krossade_tomater')
    expect(tomater.packageCount).toBe(2)
    expect(tomater.required.value).toBe(0)
  })

  it('flaggar behov som inte gick att räkna om', () => {
    const oklart = makeRecipe(
      { id: 'oklart', name: 'Oklart', servings: 4 },
      [['blandfars', 2, 'st']],
    )
    const needs = aggregateNeeds([{ recipe: oklart, servings: 4 }])
    expect(needFor(needs, 'blandfars').unresolved).toBe(true)
  })

  it('markerar ingredienser som bara förekommer som valfria', () => {
    const recept = makeRecipe(
      { id: 'r', name: 'R', servings: 4 },
      [
        ['persilja', 20, 'g', true],
        ['blandfars', 400, 'g'],
      ],
    )
    const needs = aggregateNeeds([{ recipe: recept, servings: 4 }])
    expect(needFor(needs, 'persilja').optionalOnly).toBe(true)
    expect(needFor(needs, 'blandfars').optionalOnly).toBe(false)
  })
})

describe('subtractPantry', () => {
  const needs = aggregateNeeds([
    { recipe: kottfarssas, servings: 4 },
    { recipe: kottfarssas, servings: 6 },
  ])

  it('drar av det som finns hemma', () => {
    const result = subtractPantry(needs, [{ ingredientId: 'blandfars', amount: 200 }])
    const farsen = needFor(result, 'blandfars')
    expect(farsen.required.value).toBe(1250)
    expect(farsen.fromPantry).toBe(200)
    expect(farsen.toBuy.value).toBe(1050)
  })

  it('nollställer men går aldrig under noll', () => {
    const result = subtractPantry(needs, [{ ingredientId: 'pasta', amount: 1000 }])
    const pasta = needFor(result, 'pasta')
    expect(pasta.toBuy.value).toBe(0)
    expect(pasta.fromPantry).toBe(750)
  })

  it('antar att skafferivaror finns hemma — annars fylls listan av en tesked salt', () => {
    const result = subtractPantry(needs, [])
    expect(needFor(result, 'salt').toBuy.value).toBe(0)
    expect(needFor(result, 'blandfars').toBuy.value).toBe(1250)
  })

  it('kan sluta anta att skafferivaror finns', () => {
    const result = subtractPantry(needs, [], { assumeStaplesAvailable: false })
    expect(needFor(result, 'salt').toBuy.value).toBeGreaterThan(0)
  })

  it('låter en uttrycklig skafferimängd gå före antagandet', () => {
    const result = subtractPantry(needs, [{ ingredientId: 'salt', amount: 2 }])
    const salt = needFor(result, 'salt')
    expect(salt.fromPantry).toBe(2)
    expect(salt.toBuy.value).toBeGreaterThan(0)
  })
})

describe('needsRequiringPurchase', () => {
  it('plockar bort det som redan är täckt', () => {
    const needs = subtractPantry(
      aggregateNeeds([{ recipe: kottfarssas, servings: 4 }]),
      [{ ingredientId: 'pasta', amount: 1000 }],
    )
    const purchase = needsRequiringPurchase(needs)
    expect(purchase.map((n) => n.ingredient.id)).not.toContain('pasta')
    expect(purchase.map((n) => n.ingredient.id)).toContain('blandfars')
  })
})
