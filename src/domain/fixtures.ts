/**
 * Testfixturer. Bara till för enhetstester — importeras aldrig av appen.
 *
 * Produktformen speglar City Gross faktiska svar, inklusive de fält som är
 * lätta att göra fel på: `sellingUnit` och kampanjer med minimiantal.
 */

import type { Product, Promotion, Recipe, RecipeIngredient, RecipeUnit } from './types.ts'
import { parseDescriptiveSize } from './units.ts'

let sequence = 0

export function makeProduct(overrides: Partial<Product> & { name: string }): Product {
  sequence += 1
  const descriptiveSize = overrides.descriptiveSize ?? '500G'
  return {
    gtin: `730000000000${sequence}`,
    externalId: `10000000${sequence}_ST`,
    subtitle: `${descriptiveSize} TESTMÄRKE`,
    brand: 'TESTMÄRKE',
    netContent: parseDescriptiveSize(descriptiveSize),
    descriptiveSize,
    sellingUnit: 'PCE',
    categoryCode: null,
    categoryPath: [],
    price: 25,
    comparativePrice: null,
    comparativePriceUnit: null,
    promotions: [],
    inStock: true,
    imageUrl: null,
    productUrl: null,
    allergens: null,
    storeNumber: '3230',
    syncedAt: '2026-08-28T03:00:00.000Z',
    ...overrides,
  }
}

export function makePromotion(overrides: Partial<Promotion> = {}): Promotion {
  return {
    id: 'kampanj-1',
    effectType: 'PriceChangeAll',
    minQuantity: 1,
    value: 0,
    membersOnly: false,
    from: '2026-08-24T00:00:00+02:00',
    to: '2026-08-30T23:59:00+02:00',
    maxAppliedPerReceipt: 0,
    ...overrides,
  }
}

type IngredientSpec = [ingredientId: string, value: number, unit: RecipeUnit, optional?: boolean]

export function makeRecipe(
  overrides: Partial<Recipe> & { id: string; name: string; servings: number },
  ingredients: IngredientSpec[] = [],
): Recipe {
  const recipeIngredients: RecipeIngredient[] = ingredients.map(
    ([ingredientId, value, unit, optional]) => ({
      ingredientId,
      quantity: { value, unit },
      optional: optional ?? false,
    }),
  )

  return {
    description: '',
    prepMinutes: 10,
    cookMinutes: 20,
    instructions: [],
    tags: [],
    ingredients: recipeIngredients,
    ...overrides,
  }
}
