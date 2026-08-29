/**
 * End-to-end mot riktiga City Gross.
 *
 * Det här är provet på om appen faktiskt duger: en veckomeny av startrecepten,
 * matchad mot Sundsvalls verkliga sortiment och verkliga priser, hela vägen ner
 * till hur många förpackningar man ska lägga i vagnen.
 *
 * Körs inte i CI och inte av `npm test`:
 *
 *   npm run test:live
 *
 * Testet skriver ut listan, eftersom en inköpslista som ser fel ut för ett
 * mänskligt öga är fel även om alla assertions går igenom.
 */

import { describe, expect, it } from 'vitest'

import { SEED_RECIPES } from '../../domain/seed-recipes.ts'
import { buildShoppingList, type ProductLookup } from '../../domain/shopping-list.ts'
import { searchTermsFor } from '../../domain/matching.ts'
import { aggregateNeeds, subtractPantry, type PlannedMeal } from '../../domain/aggregate.ts'
import { formatQuantity } from '../../domain/units.ts'
import type { Ingredient, Product } from '../../domain/types.ts'
import { CityGrossProvider } from './citygross.ts'

const SUNDSVALL = '3230'
const enabled = process.env.CITYGROSS_LIVE === '1'

/** En vecka som blandar färs, korv, kyckling och fisk. */
const VECKAN: PlannedMeal[] = [
  'kottfarssas-spaghetti',
  'korvstroganoff',
  'kycklinggryta-curry',
  'ugnslax-potatis',
  'falukorv-i-ugn',
]
  .map((id) => SEED_RECIPES.find((recipe) => recipe.id === id)!)
  .map((recipe, index) => ({ recipe, servings: 2, slotId: `dag-${index + 1}` }))

/**
 * Hämtar kandidater för varje ingrediens i förväg. Motsvarar det appen gör mot
 * den synkade katalogen, men går direkt mot City Gross här.
 */
async function prefetch(
  ingredients: Ingredient[],
  provider: CityGrossProvider,
): Promise<Map<string, Product[]>> {
  const result = new Map<string, Product[]>()
  for (const ingredient of ingredients) {
    const found: Product[] = []
    for (const term of searchTermsFor(ingredient)) {
      const { products } = await provider.searchProducts(term, {
        storeNumber: SUNDSVALL,
        take: 20,
      })
      found.push(...products)
    }
    const unique = new Map(found.map((product) => [product.gtin, product]))
    result.set(ingredient.id, [...unique.values()])
  }
  return result
}

describe.skipIf(!enabled)('Veckomeny → inköpslista (live)', () => {
  it(
    'producerar en inköpslista med verkliga produkter och priser',
    { timeout: 300_000 },
    async () => {
      const provider = new CityGrossProvider({ minRequestIntervalMs: 700 })

      const needs = subtractPantry(aggregateNeeds(VECKAN), [])
      const ingredients = needs
        .filter((need) => need.toBuy.value > 0 || need.packageCount > 0)
        .filter((need) => !need.optionalOnly)
        .map((need) => need.ingredient)

      const catalog = await prefetch(ingredients, provider)
      const lookup: ProductLookup = (ingredient) => catalog.get(ingredient.id) ?? []

      const list = buildShoppingList(VECKAN, [], lookup, { at: new Date() })

      // Utskrift, eftersom siffror som ser fel ut för ett mänskligt öga är fel.
      const rader: string[] = []
      for (const group of list.groups) {
        rader.push(`\n${group.label.toUpperCase()}`)
        for (const item of group.items) {
          const best = item.packaging?.best
          const behov = formatQuantity(item.need.toBuy.value, item.need.toBuy.unit)
          if (best) {
            rader.push(
              `  ${item.ingredient.name.padEnd(22)} behöver ${behov.padEnd(9)}` +
                ` → ${best.quantity} × ${best.product.descriptiveSize.padEnd(8)}` +
                ` ${best.product.name} (${best.price.total.toFixed(2)} kr)`,
            )
          } else {
            rader.push(`  ${item.ingredient.name.padEnd(22)} behöver ${behov.padEnd(9)} → ${item.status}`)
          }
        }
      }
      rader.push(
        `\nUppskattad summa: ${list.estimatedTotal.toFixed(2)} kr` +
          ` (${list.itemCount} poster, ${list.itemsWithoutPrice} utan pris)`,
      )
      console.log(rader.join('\n'))

      // Listan ska faktiskt innehålla något.
      expect(list.itemCount).toBeGreaterThan(10)
      expect(list.groups.length).toBeGreaterThan(3)

      // Merparten ska gå att handla utan att användaren behöver ingripa.
      const klara = list.groups
        .flatMap((group) => group.items)
        .filter((item) => item.status === 'ready')
      expect(klara.length / list.itemCount).toBeGreaterThan(0.6)

      // Summan ska vara i rätt storleksordning för fem middagar för två.
      expect(list.estimatedTotal).toBeGreaterThan(150)
      expect(list.estimatedTotal).toBeLessThan(2500)

      // Varje vald produkt ska ha ett riktigt pris och en tolkad storlek.
      for (const item of klara) {
        const best = item.packaging!.best!
        expect(best.product.price, item.ingredient.name).toBeGreaterThan(0)
        expect(best.quantity, item.ingredient.name).toBeGreaterThan(0)
        expect(best.product.storeNumber).toBe(SUNDSVALL)
      }
    },
  )
})
