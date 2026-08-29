import { describe, expect, it } from 'vitest'

import { aggregateNeeds } from './aggregate.ts'
import { getIngredient } from './ingredients.ts'
import { SEED_RECIPES } from './seed-recipes.ts'
import { toBase } from './units.ts'

describe('startrecepten', () => {
  it('har unika id:n', () => {
    const ids = SEED_RECIPES.map((recipe) => recipe.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('är tillräckligt många för att planera varierade veckor', () => {
    expect(SEED_RECIPES.length).toBeGreaterThanOrEqual(28)
  })

  // Ett recept som pekar på en ingrediens som inte finns går inte att handla.
  // Felet ska fångas här, inte i kassan.
  it('refererar bara ingredienser som finns i katalogen', () => {
    const saknade: string[] = []
    for (const recipe of SEED_RECIPES) {
      for (const item of recipe.ingredients) {
        if (!getIngredient(item.ingredientId)) {
          saknade.push(`${recipe.id} → ${item.ingredientId}`)
        }
      }
    }
    expect(saknade).toEqual([])
  })

  it('har positiva mängder överallt', () => {
    const ogiltiga: string[] = []
    for (const recipe of SEED_RECIPES) {
      for (const item of recipe.ingredients) {
        if (!(item.quantity.value > 0)) {
          ogiltiga.push(`${recipe.id} → ${item.ingredientId}: ${item.quantity.value}`)
        }
      }
    }
    expect(ogiltiga).toEqual([])
  })

  it('har rimliga grunduppgifter', () => {
    for (const recipe of SEED_RECIPES) {
      expect(recipe.servings, recipe.id).toBeGreaterThan(0)
      expect(recipe.name.length, recipe.id).toBeGreaterThan(3)
      expect(recipe.description.length, recipe.id).toBeGreaterThan(10)
      expect(recipe.instructions.length, recipe.id).toBeGreaterThanOrEqual(3)
      expect(recipe.tags.length, recipe.id).toBeGreaterThan(0)
      expect(recipe.ingredients.length, recipe.id).toBeGreaterThanOrEqual(4)
    }
  })

  /**
   * Varje mängd måste gå att räkna om till en köpbar enhet. En ingrediens som
   * anges i "st" utan styckvikt blir en post på inköpslistan som ingen kan
   * handla — det är precis det felet originalspecen byggde in.
   */
  it('har mängder som går att räkna om till gram eller milliliter', () => {
    const olosliga: string[] = []
    for (const recipe of SEED_RECIPES) {
      for (const item of recipe.ingredients) {
        const ingredient = getIngredient(item.ingredientId)
        if (!ingredient) continue
        const base = toBase(item.quantity, ingredient)
        if (base.confidence === 'unknown' && item.quantity.unit !== 'pkt') {
          olosliga.push(
            `${recipe.id} → ${item.ingredientId} (${item.quantity.value} ${item.quantity.unit})`,
          )
        }
      }
    }
    expect(olosliga).toEqual([])
  })

  it('går att aggregera till en veckas behov utan olösta poster', () => {
    const vecka = SEED_RECIPES.slice(0, 7).map((recipe) => ({ recipe, servings: 4 }))
    const needs = aggregateNeeds(vecka)

    expect(needs.length).toBeGreaterThan(10)
    expect(needs.filter((need) => need.unresolved).map((n) => n.ingredient.id)).toEqual([])
  })

  it('täcker de matlagningsstilar veckoplaneraren behöver variera mellan', () => {
    const taggar = new Set(SEED_RECIPES.flatMap((recipe) => recipe.tags))
    for (const krav of ['husmanskost', 'billigt', 'snabbt', 'vegetariskt', 'fisk', 'frysvänligt']) {
      expect(taggar, `saknar taggen ${krav}`).toContain(krav)
    }
  })
})
