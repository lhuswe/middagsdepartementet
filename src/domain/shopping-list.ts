/**
 * Inköpslistan - pipelinen som binder ihop domänen.
 *
 * Recept → skalning → aggregering → skafferiavdrag → matchning →
 * förpackningsoptimering → pris → kategorisering.
 *
 * Två principer styr utformningen:
 *
 * 1. **Summan ljuger aldrig.** Poster utan verifierat pris räknas inte in i
 *    totalen, och antalet sådana poster rapporteras separat. En uppskattning
 *    som utger sig för att vara komplett är värre än ingen uppskattning.
 * 2. **Allergier är hårda villkor.** Saknas allergiinformation blir svaret
 *    `unknown`, aldrig "fri från". City Gross fyller sällan i fältet, så det
 *    här inträffar ofta - och måste synas.
 */

import {
  aggregateNeeds,
  needsRequiringPurchase,
  subtractPantry,
  type AggregatedNeed,
  type PantryEntry,
  type PlannedMeal,
} from './aggregate.ts'
import { matchIngredient, type MatchOptions, type MatchResult } from './matching.ts'
import { selectPackaging, type PackagingResult } from './packaging.ts'
import type { PriceOptions } from './promotions.ts'
import {
  SHOPPING_CATEGORY_LABELS,
  SHOPPING_CATEGORY_ORDER,
  type Ingredient,
  type Product,
  type ShoppingCategory,
} from './types.ts'
import { formatQuantity } from './units.ts'

export type ItemStatus =
  /** Produkt vald, mängd och pris klara. */
  | 'ready'
  /** Flera produkter passar - användaren måste välja. */
  | 'needs-choice'
  /** Ingen tillgänglig produkt hittades. */
  | 'unavailable'
  /** Behovet gick inte att räkna om till en köpbar mängd. */
  | 'unresolved'

export type AllergyFlag =
  /** Produkten anger allergener och ingen av användarens finns med. */
  | 'clear'
  /** Allergiinformation saknas. Betyder *okänt*, aldrig *fritt från*. */
  | 'unknown'
  /** Produkten anger en allergen användaren reagerar på. */
  | 'contains'

export interface ShoppingListItem {
  ingredient: Ingredient
  need: AggregatedNeed
  match: MatchResult
  packaging: PackagingResult | null
  status: ItemStatus
  /** Kostnad för raden. `null` när priset inte kunnat fastställas. */
  estimatedCost: number | null
  /** `null` när användaren inte har registrerat några allergier. */
  allergy: AllergyFlag | null
  /** Text som ska visas för användaren, t.ex. osäker omräkning. */
  warnings: string[]
}

export interface ShoppingListGroup {
  category: ShoppingCategory
  label: string
  items: ShoppingListItem[]
}

export interface ShoppingList {
  groups: ShoppingListGroup[]
  /** Summan av de poster som faktiskt har ett pris. */
  estimatedTotal: number
  /** Antal poster som saknar pris och därför inte ingår i summan. */
  itemsWithoutPrice: number
  itemCount: number
  /** Poster som kräver ett beslut av användaren innan de är klara. */
  needsAttentionCount: number
  generatedAt: string
  /** Äldsta synktidpunkt bland de valda produkterna. */
  oldestDataAt: string | null
}

/** Hämtar kandidatprodukter för en ingrediens. Implementeras av katalogtjänsten. */
export type ProductLookup = (ingredient: Ingredient) => Product[]

export interface BuildOptions extends PriceOptions {
  /** Sparade val: ingrediens-id → GTIN. */
  savedMappings?: Record<string, string>
  /** Favoritprodukter: ingrediens-id → GTIN. */
  favorites?: Record<string, string>
  /** Användarens allergier, med City Gross benämningar. */
  allergies?: string[]
  /** Antas skafferivaror som salt och mjöl finnas hemma? Default: ja. */
  assumeStaplesAvailable?: boolean
  /** Ta med ingredienser som bara förekommer som valfria. Default: nej. */
  includeOptional?: boolean
}

/**
 * Avgör om en produkt är förenlig med användarens allergier.
 *
 * Returnerar `unknown` så snart informationen saknas. Det inträffar ofta -
 * City Gross allergifält är tomt för de allra flesta varor - och det är hela
 * poängen: appen får aldrig påstå att något är säkert som den inte vet.
 */
export function checkAllergens(product: Product, allergies: string[]): AllergyFlag {
  if (allergies.length === 0) return 'clear'
  if (product.allergens === null || product.allergens.length === 0) return 'unknown'

  const declared = product.allergens.map((entry) => entry.toLowerCase())
  const hit = allergies.some((allergy) =>
    declared.some((entry) => entry.includes(allergy.toLowerCase())),
  )
  return hit ? 'contains' : 'clear'
}

function buildItem(
  need: AggregatedNeed,
  lookup: ProductLookup,
  options: BuildOptions,
): ShoppingListItem {
  const warnings: string[] = []
  const { ingredient } = need

  if (need.unresolved) {
    warnings.push('Delar av behovet gick inte att räkna om till en köpbar mängd.')
  }
  if (need.toBuy.confidence === 'estimated' && need.toBuy.range) {
    warnings.push(
      `Uppskattad mängd - någonstans mellan ${formatQuantity(need.toBuy.range.min, need.toBuy.unit)} och ${formatQuantity(need.toBuy.range.max, need.toBuy.unit)}.`,
    )
  }

  const matchOptions: MatchOptions = {}
  const saved = options.savedMappings?.[ingredient.id]
  const favorite = options.favorites?.[ingredient.id]
  if (saved) matchOptions.savedGtin = saved
  if (favorite) matchOptions.favoriteGtin = favorite

  const match = matchIngredient(ingredient, lookup(ingredient), matchOptions)

  if (match.confidence === 'unavailable' || match.confidence === 'unknown') {
    return {
      ingredient,
      need,
      match,
      packaging: null,
      status: 'unavailable',
      estimatedCost: null,
      allergy: null,
      warnings: [...warnings, match.note ?? 'Ingen produkt kunde verifieras.'],
    }
  }

  if (match.confidence === 'ambiguous') {
    return {
      ingredient,
      need,
      match,
      packaging: null,
      status: 'needs-choice',
      estimatedCost: null,
      allergy: null,
      warnings: [...warnings, match.note ?? 'Flera produkter passar.'],
    }
  }

  // Förpackningsvalet görs bland alla dugliga kandidater, inte bara vinnaren -
  // det är där jämförelsen mellan 500 g och 1 kg faktiskt hör hemma. Vid ett
  // sparat val respekteras dock användarens produkt.
  const candidates =
    match.confidence === 'confirmed' && match.best
      ? [match.best]
      : match.candidates.map((candidate) => candidate.product)

  const packaging = selectPackaging(need, candidates, options)

  if (!packaging.best) {
    return {
      ingredient,
      need,
      match,
      packaging,
      status: 'unresolved',
      estimatedCost: null,
      allergy: null,
      warnings: [...warnings, packaging.reason ?? 'Mängden gick inte att omsätta i förpackningar.'],
    }
  }

  const allergies = options.allergies ?? []
  const allergy = allergies.length > 0 ? checkAllergens(packaging.best.product, allergies) : null

  if (allergy === 'contains') {
    warnings.push('Produkten anger en allergen du har registrerat.')
  } else if (allergy === 'unknown') {
    warnings.push('Allergiinformation saknas för produkten - kontrollera förpackningen.')
  }

  if (packaging.best.price.promotionUnmet && packaging.best.price.note) {
    warnings.push(`Kampanj finns: ${packaging.best.price.note}. Antalet räcker inte upp.`)
  }

  return {
    ingredient,
    need,
    match,
    packaging,
    status: allergy === 'contains' ? 'needs-choice' : 'ready',
    estimatedCost: packaging.best.price.total,
    allergy,
    warnings,
  }
}

/** Bygger en komplett inköpslista från veckans planerade mål. */
export function buildShoppingList(
  meals: PlannedMeal[],
  pantry: PantryEntry[],
  lookup: ProductLookup,
  options: BuildOptions = {},
): ShoppingList {
  const staples = options.assumeStaplesAvailable ?? true
  const aggregated = subtractPantry(aggregateNeeds(meals), pantry, {
    assumeStaplesAvailable: staples,
  })

  const relevant = needsRequiringPurchase(aggregated).filter(
    (need) => options.includeOptional === true || !need.optionalOnly,
  )

  const items = relevant.map((need) => buildItem(need, lookup, options))

  const byCategory = new Map<ShoppingCategory, ShoppingListItem[]>()
  for (const item of items) {
    const bucket = byCategory.get(item.ingredient.category) ?? []
    bucket.push(item)
    byCategory.set(item.ingredient.category, bucket)
  }

  const groups: ShoppingListGroup[] = SHOPPING_CATEGORY_ORDER.filter((category) =>
    byCategory.has(category),
  ).map((category) => ({
    category,
    label: SHOPPING_CATEGORY_LABELS[category],
    items: (byCategory.get(category) ?? []).sort((a, b) =>
      a.ingredient.name.localeCompare(b.ingredient.name, 'sv'),
    ),
  }))

  const priced = items.filter((item) => item.estimatedCost !== null)
  const syncTimes = items
    .map((item) => item.packaging?.best?.product.syncedAt)
    .filter((value): value is string => Boolean(value))
    .sort()

  return {
    groups,
    estimatedTotal: priced.reduce((sum, item) => sum + (item.estimatedCost ?? 0), 0),
    itemsWithoutPrice: items.length - priced.length,
    itemCount: items.length,
    needsAttentionCount: items.filter((item) => item.status !== 'ready').length,
    generatedAt: new Date().toISOString(),
    oldestDataAt: syncTimes[0] ?? null,
  }
}
