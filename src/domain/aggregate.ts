/**
 * Skalning, aggregering och skafferiavdrag.
 *
 * Pipelinen är avsiktligt rak och utan avrundning: recept skalas till önskat
 * antal portioner, mängder normaliseras till basenhet, lika ingredienser slås
 * ihop, och det man redan har hemma dras av. Först i `packaging.ts` möter
 * resultatet verkligheten i form av förpackningsstorlekar.
 *
 * Att avrunda tidigt är den klassiska buggen här. "1,5 lök" ska förbli 1,5 lök
 * hela vägen fram till att någon ska köpa faktiska lökar - annars ackumuleras
 * avrundningsfelet över veckans alla recept.
 */

import { getIngredient } from './ingredients.ts'
import type {
  BaseQuantity,
  Ingredient,
  Quantity,
  Recipe,
  RecipeIngredient,
} from './types.ts'
import { isPackageUnit, toBase, weakestConfidence } from './units.ts'

/** Ett planerat mål: ett recept lagat till ett visst antal portioner. */
export interface PlannedMeal {
  recipe: Recipe
  servings: number
  /** Valfri identifierare för spårbarhet i gränssnittet, t.ex. "2026-08-31/middag". */
  slotId?: string
}

/** Vad användaren redan har hemma, uttryckt i ingrediensens kanoniska enhet. */
export interface PantryEntry {
  ingredientId: string
  /** Mängd i ingrediensens kanoniska basenhet (g eller ml). */
  amount: number
}

/** Var ett behov kommer ifrån. Gör inköpslistan spårbar tillbaka till receptet. */
export interface NeedSource {
  recipeId: string
  recipeName: string
  servings: number
  original: Quantity
}

/** Ett sammanslaget behov av en ingrediens för hela perioden. */
export interface AggregatedNeed {
  ingredient: Ingredient
  /** Totalt behov innan skafferiavdrag, i kanonisk basenhet. */
  required: BaseQuantity
  /** Mängd som täcks av skafferiet. */
  fromPantry: number
  /** Kvar att köpa efter skafferiavdrag. Aldrig negativ. */
  toBuy: BaseQuantity
  /**
   * Behov uttryckta i hela förpackningar ("2 burkar krossade tomater").
   * Löses upp mot faktisk förpackningsstorlek först i `packaging.ts`, eftersom
   * det är där vi vet hur stor en burk faktiskt är i den här butiken.
   */
  packageCount: number
  /** Alla recept som bidrar till behovet. */
  sources: NeedSource[]
  /** Sant om minst en ingående mängd inte gick att räkna om. */
  unresolved: boolean
  optionalOnly: boolean
}

/**
 * Skalar en receptingrediens till önskat antal portioner.
 * Ingen avrundning - se modulkommentaren.
 */
export function scaleIngredient(
  item: RecipeIngredient,
  fromServings: number,
  toServings: number,
): Quantity {
  if (fromServings <= 0) {
    throw new Error(`Recept med ${fromServings} portioner går inte att skala`)
  }
  const factor = toServings / fromServings
  return { value: item.quantity.value * factor, unit: item.quantity.unit }
}

/** Skalar hela receptet. */
export function scaleRecipe(recipe: Recipe, toServings: number): RecipeIngredient[] {
  return recipe.ingredients.map((item) => ({
    ...item,
    quantity: scaleIngredient(item, recipe.servings, toServings),
  }))
}

/**
 * Slår ihop alla planerade mål till ett behov per ingrediens.
 *
 * Ingredienser som mäts i hela förpackningar ackumuleras separat i
 * `packageCount`, eftersom "1 burk" inte betyder något i gram förrän vi vet
 * vilken burk butiken säljer.
 */
export function aggregateNeeds(meals: PlannedMeal[]): AggregatedNeed[] {
  const byIngredient = new Map<string, AggregatedNeed>()

  for (const meal of meals) {
    for (const item of scaleRecipe(meal.recipe, meal.servings)) {
      const ingredient = getIngredient(item.ingredientId)
      if (!ingredient) continue

      let need = byIngredient.get(ingredient.id)
      if (!need) {
        need = {
          ingredient,
          required: { value: 0, unit: ingredient.canonicalUnit, confidence: 'exact' },
          fromPantry: 0,
          toBuy: { value: 0, unit: ingredient.canonicalUnit, confidence: 'exact' },
          packageCount: 0,
          sources: [],
          unresolved: false,
          optionalOnly: true,
        }
        byIngredient.set(ingredient.id, need)
      }

      need.sources.push({
        recipeId: meal.recipe.id,
        recipeName: meal.recipe.name,
        servings: meal.servings,
        original: item.quantity,
      })
      if (!item.optional) need.optionalOnly = false

      if (isPackageUnit(item.quantity.unit)) {
        need.packageCount += item.quantity.value
        continue
      }

      const base = toBase(item.quantity, ingredient)
      if (base.confidence === 'unknown') {
        need.unresolved = true
        continue
      }

      need.required = addQuantities(need.required, base)
    }
  }

  for (const need of byIngredient.values()) {
    need.toBuy = { ...need.required }
  }

  return [...byIngredient.values()]
}

/** Summerar två mängder i samma basenhet och slår ihop deras osäkerhet. */
function addQuantities(a: BaseQuantity, b: BaseQuantity): BaseQuantity {
  const value = a.value + b.value
  const confidence = weakestConfidence(a.confidence, b.confidence)

  const aRange = a.range ?? { min: a.value, max: a.value }
  const bRange = b.range ?? { min: b.value, max: b.value }
  const range = { min: aRange.min + bRange.min, max: aRange.max + bRange.max }

  return {
    value,
    unit: a.unit,
    confidence,
    ...(confidence === 'estimated' ? { range } : {}),
  }
}

/**
 * Drar av det som redan finns hemma.
 *
 * Skafferivaror (salt, mjöl, olja) som användaren inte uttryckligen har angett
 * en mängd för antas finnas i tillräcklig mängd och nollställs helt - annars
 * fylls inköpslistan varje vecka av en tesked salt.
 */
export function subtractPantry(
  needs: AggregatedNeed[],
  pantry: PantryEntry[],
  options: { assumeStaplesAvailable?: boolean } = {},
): AggregatedNeed[] {
  const { assumeStaplesAvailable = true } = options
  const available = new Map(pantry.map((entry) => [entry.ingredientId, entry.amount]))

  return needs.map((need) => {
    const stocked = available.get(need.ingredient.id)

    if (stocked === undefined) {
      if (assumeStaplesAvailable && need.ingredient.staple) {
        return {
          ...need,
          fromPantry: need.required.value,
          toBuy: { ...need.toBuy, value: 0 },
        }
      }
      return need
    }

    const used = Math.min(stocked, need.required.value)
    const remaining = Math.max(0, need.required.value - stocked)

    return {
      ...need,
      fromPantry: used,
      toBuy: { ...need.required, value: remaining },
    }
  })
}

/** Behov som faktiskt ska hamna på inköpslistan. */
export function needsRequiringPurchase(needs: AggregatedNeed[]): AggregatedNeed[] {
  return needs.filter(
    (need) => need.toBuy.value > 0 || need.packageCount > 0 || need.unresolved,
  )
}
