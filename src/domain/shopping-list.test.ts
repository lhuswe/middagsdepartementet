import { describe, expect, it } from 'vitest'

import { makeProduct, makeRecipe } from './fixtures.ts'
import { getIngredient } from './ingredients.ts'
import { buildShoppingList, checkAllergens, type ProductLookup } from './shopping-list.ts'
import type { PlannedMeal } from './aggregate.ts'
import type { Product } from './types.ts'

const kottfarssas = makeRecipe(
  { id: 'kottfarssas', name: 'Köttfärssås', servings: 4 },
  [
    ['blandfars', 500, 'g'],
    ['gul_lok', 1, 'st'],
    ['krossade_tomater', 400, 'g'],
    ['pasta', 300, 'g'],
    ['salt', 1, 'tsk'],
    ['persilja', 10, 'g', true],
  ],
)

const KATALOG: Record<string, Product[]> = {
  blandfars: [
    makeProduct({
      name: 'Blandfärs 50/50',
      subtitle: '500G GARANT',
      descriptiveSize: '500G',
      categoryPath: ['Kött & fågel', 'Färs'],
      price: 45,
    }),
    makeProduct({
      name: 'Blandfärs 50/50',
      subtitle: '1KG GARANT',
      descriptiveSize: '1KG',
      categoryPath: ['Kött & fågel', 'Färs'],
      price: 82,
    }),
  ],
  gul_lok: [
    makeProduct({
      name: 'Gul Lök',
      subtitle: '1KG SVERIGE',
      descriptiveSize: '1KG',
      categoryPath: ['Frukt & grönt', 'Grönsaker'],
      price: 22,
    }),
  ],
  krossade_tomater: [
    makeProduct({
      name: 'Tomater Krossade',
      subtitle: '390G GARANT',
      descriptiveSize: '390G',
      categoryPath: ['Skafferiet', 'Konserver', 'Tomatkonserver'],
      price: 10.35,
    }),
  ],
  pasta: [
    makeProduct({
      name: 'Pasta Spaghetti',
      subtitle: '500G GARANT',
      descriptiveSize: '500G',
      categoryPath: ['Skafferiet', 'Pasta'],
      price: 15,
    }),
  ],
}

const lookup: ProductLookup = (ingredient) => KATALOG[ingredient.id] ?? []

const vecka: PlannedMeal[] = [{ recipe: kottfarssas, servings: 4 }]

describe('buildShoppingList', () => {
  it('grupperar posterna i butiksordning', () => {
    const list = buildShoppingList(vecka, [], lookup)
    expect(list.groups.map((group) => group.label)).toEqual([
      'Frukt & grönt',
      'Kött & fågel',
      'Skafferi',
      'Konserver',
    ])
  })

  it('utelämnar skafferivaror som antas finnas hemma', () => {
    const list = buildShoppingList(vecka, [], lookup)
    const alla = list.groups.flatMap((group) => group.items.map((item) => item.ingredient.id))
    expect(alla).not.toContain('salt')
  })

  it('utelämnar rent valfria ingredienser om man inte ber om dem', () => {
    const utan = buildShoppingList(vecka, [], lookup)
    expect(utan.groups.flatMap((g) => g.items.map((i) => i.ingredient.id))).not.toContain(
      'persilja',
    )

    const med = buildShoppingList(vecka, [], lookup, { includeOptional: true })
    expect(med.groups.flatMap((g) => g.items.map((i) => i.ingredient.id))).toContain('persilja')
  })

  it('räknar bara med poster som faktiskt har ett pris', () => {
    const list = buildShoppingList(vecka, [], lookup)
    // Färs 45 + lök 22 + tomater 10,35 + pasta 15. Behovet på 400 g täcks av
    // en 390-grams burk tack vare avrundningstoleransen.
    expect(list.estimatedTotal).toBeCloseTo(92.35, 2)
    expect(list.itemsWithoutPrice).toBe(0)
  })

  it('lämnar poster utan produkt utanför summan och rapporterar dem', () => {
    const glesKatalog: ProductLookup = (ingredient) =>
      ingredient.id === 'blandfars' ? (KATALOG.blandfars ?? []) : []
    const list = buildShoppingList(vecka, [], glesKatalog)

    expect(list.itemsWithoutPrice).toBe(3)
    expect(list.needsAttentionCount).toBe(3)
    expect(list.estimatedTotal).toBeCloseTo(45, 2)

    const lok = list.groups
      .flatMap((group) => group.items)
      .find((item) => item.ingredient.id === 'gul_lok')
    expect(lok?.status).toBe('unavailable')
    expect(lok?.estimatedCost).toBeNull()
  })

  it('drar av skafferiet innan produkterna väljs', () => {
    const list = buildShoppingList(vecka, [{ ingredientId: 'blandfars', amount: 500 }], lookup)
    const ids = list.groups.flatMap((group) => group.items.map((item) => item.ingredient.id))
    expect(ids).not.toContain('blandfars')
  })

  it('redovisar äldsta synktidpunkt så listan aldrig ser färskare ut än den är', () => {
    const list = buildShoppingList(vecka, [], lookup)
    expect(list.oldestDataAt).toBe('2026-08-28T03:00:00.000Z')
  })

  it('varnar när mängden bygger på en uppskattning', () => {
    const list = buildShoppingList(vecka, [], lookup)
    const lok = list.groups
      .flatMap((group) => group.items)
      .find((item) => item.ingredient.id === 'gul_lok')
    expect(lok?.warnings.join(' ')).toContain('Uppskattad mängd')
  })
})

describe('checkAllergens', () => {
  const utanInfo = makeProduct({ name: 'Pasta', allergens: null })
  const medInfo = makeProduct({ name: 'Pasta', allergens: ['Gluten', 'Ägg'] })

  // City Gross allergifält är tomt för de allra flesta varor. Regeln måste
  // därför vara att tystnad betyder okänt — aldrig "fri från".
  it('säger unknown när information saknas, aldrig "fri från"', () => {
    expect(checkAllergens(utanInfo, ['gluten'])).toBe('unknown')
    expect(checkAllergens(makeProduct({ name: 'X', allergens: [] }), ['gluten'])).toBe('unknown')
  })

  it('säger contains när en registrerad allergen finns med', () => {
    expect(checkAllergens(medInfo, ['gluten'])).toBe('contains')
    expect(checkAllergens(medInfo, ['ägg'])).toBe('contains')
  })

  it('säger clear när informationen finns och allergenen inte gör det', () => {
    expect(checkAllergens(medInfo, ['jordnötter'])).toBe('clear')
  })

  it('bryr sig inte om allergier när inga är registrerade', () => {
    expect(checkAllergens(utanInfo, [])).toBe('clear')
  })
})

describe('buildShoppingList — allergier', () => {
  it('flaggar okänd allergiinformation i stället för att tiga', () => {
    const list = buildShoppingList(vecka, [], lookup, { allergies: ['gluten'] })
    const pasta = list.groups
      .flatMap((group) => group.items)
      .find((item) => item.ingredient.id === 'pasta')
    expect(pasta?.allergy).toBe('unknown')
    expect(pasta?.warnings.join(' ')).toContain('Allergiinformation saknas')
  })

  it('kräver ett beslut när produkten innehåller en registrerad allergen', () => {
    const glutenLookup: ProductLookup = (ingredient) =>
      ingredient.id === 'pasta'
        ? [
            makeProduct({
              name: 'Pasta Spaghetti',
              subtitle: '500G',
              descriptiveSize: '500G',
              categoryPath: ['Skafferiet', 'Pasta'],
              price: 15,
              allergens: ['Gluten'],
            }),
          ]
        : []
    const list = buildShoppingList(vecka, [], glutenLookup, { allergies: ['gluten'] })
    const pasta = list.groups
      .flatMap((group) => group.items)
      .find((item) => item.ingredient.id === 'pasta')
    expect(pasta?.allergy).toBe('contains')
    expect(pasta?.status).toBe('needs-choice')
  })
})

describe('getIngredient', () => {
  it('finns för alla ingredienser receptfixturen använder', () => {
    for (const item of kottfarssas.ingredients) {
      expect(getIngredient(item.ingredientId)).toBeDefined()
    }
  })
})
