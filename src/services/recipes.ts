/**
 * Recept.
 *
 * Varje användare äger sina egna recept - även startrecepten, som kopieras in i
 * samlingen vid första inloggningen. Det gör dem redigerbara utan att någon
 * annans kopia påverkas, och det håller RLS-modellen enkel: allt i `recipes`
 * har en ägare.
 */

import { SEED_RECIPES } from '../domain/seed-recipes.ts'
import type { Recipe, RecipeUnit } from '../domain/types.ts'
import { supabase } from '../lib/supabase.ts'
import type { RecipeIngredientRow, RecipeRow } from '../types/database.ts'
import type { HouseholdId } from '../types/ids.ts'

type RadMedIngredienser = RecipeRow & { recipe_ingredients: RecipeIngredientRow[] }

function toRecipe(row: RadMedIngredienser): Recipe {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    servings: row.servings,
    prepMinutes: row.prep_minutes,
    cookMinutes: row.cook_minutes,
    instructions: row.instructions ?? [],
    tags: row.tags ?? [],
    ingredients: [...(row.recipe_ingredients ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((item) => ({
        ingredientId: item.ingredient_id,
        quantity: { value: Number(item.quantity), unit: item.unit as RecipeUnit },
        optional: item.optional,
        ...(item.note ? { note: item.note } : {}),
      })),
  }
}

export async function hamtaRecept(householdId: HouseholdId): Promise<Recipe[]> {
  const { data, error } = await supabase
    .from('recipes')
    .select('*, recipe_ingredients(*)')
    .eq('household_id', householdId)
    .order('name')

  if (error) throw error
  return ((data ?? []) as RadMedIngredienser[]).map(toRecipe)
}

export async function hamtaRecept1(id: string): Promise<Recipe | null> {
  const { data, error } = await supabase
    .from('recipes')
    .select('*, recipe_ingredients(*)')
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  return data ? toRecipe(data as RadMedIngredienser) : null
}

/**
 * Lägger in startrecepten i hushållets samling.
 *
 * Körs vid onboarding, men går att anropa om: recept som redan finns skapas
 * inte igen, och recept som saknar sina ingrediensrader repareras.
 *
 * Reparationen finns av en anledning. Ingrediensraderna skrevs tidigare i ett
 * enda anrop, så en enda trasig främmandenyckel gjorde att *inga* rader kom in.
 * Recepten fanns men var tomma, och eftersom funktionen hoppade av direkt när
 * samlingen inte var tom fanns ingen väg tillbaka. Ett recept utan ingredienser
 * går inte att handla för, så det läget måste kunna läka.
 */
export async function importeraStartrecept(
  householdId: HouseholdId,
  userId: string,
): Promise<number> {
  const { data: befintliga, error: lasFel } = await supabase
    .from('recipes')
    .select('id, name, recipe_ingredients(id)')
    .eq('household_id', householdId)

  if (lasFel) throw lasFel

  const rader = (befintliga ?? []) as { id: string; name: string; recipe_ingredients: unknown[] }[]
  const idFörNamn = new Map(rader.map((rad) => [rad.name, rad.id]))
  const utanIngredienser = new Set(
    rader.filter((rad) => (rad.recipe_ingredients ?? []).length === 0).map((rad) => rad.name),
  )

  const saknas = SEED_RECIPES.filter((recipe) => !idFörNamn.has(recipe.name))

  if (saknas.length > 0) {
    const { data: skapade, error } = await supabase
      .from('recipes')
      .insert(
        saknas.map((recipe) => ({
          household_id: householdId,
          user_id: userId,
          name: recipe.name,
          description: recipe.description,
          servings: recipe.servings,
          prep_minutes: recipe.prepMinutes,
          cook_minutes: recipe.cookMinutes,
          instructions: recipe.instructions,
          tags: recipe.tags,
          source: 'Departementet för middagsfrågor',
          is_seed: true,
        })),
      )
      .select('id, name')

    if (error) throw error

    for (const skapad of skapade ?? []) {
      idFörNamn.set(skapad.name, skapad.id)
      utanIngredienser.add(skapad.name)
    }
  }

  // Koppla ingredienserna. Namnet är nyckeln tillbaka till källreceptet,
  // eftersom databasen genererar egna id:n.
  const ingrediensrader = SEED_RECIPES.filter((recipe) => utanIngredienser.has(recipe.name)).flatMap(
    (recipe) => {
      const recipeId = idFörNamn.get(recipe.name)
      if (!recipeId) return []
      return recipe.ingredients.map((item, index) => ({
        recipe_id: recipeId,
        ingredient_id: item.ingredientId,
        quantity: item.quantity.value,
        unit: item.quantity.unit,
        optional: item.optional,
        sort_order: index,
      }))
    },
  )

  if (ingrediensrader.length > 0) {
    const { error: ingrediensFel } = await supabase
      .from('recipe_ingredients')
      .insert(ingrediensrader)
    if (ingrediensFel) throw ingrediensFel
  }

  return saknas.length
}

export async function markeraLagad(
  householdId: HouseholdId,
  userId: string,
  recipeId: string,
  servings: number,
): Promise<void> {
  const { error } = await supabase
    .from('cooking_history')
    .insert({ household_id: householdId, user_id: userId, recipe_id: recipeId, servings })
  if (error) throw error
}

export interface Lagningshistorik {
  recipeId: string
  daysAgo: number
  antal: number
}

/** Vad som lagats den senaste tiden, för planerarens repetitionsspärr. */
export async function hamtaLagningshistorik(householdId: HouseholdId): Promise<Lagningshistorik[]> {
  const { data, error } = await supabase
    .from('cooking_history')
    .select('recipe_id, cooked_on')
    .eq('household_id', householdId)
    .order('cooked_on', { ascending: false })
    .limit(200)

  if (error) throw error

  const idag = Date.now()
  const senaste = new Map<string, { daysAgo: number; antal: number }>()

  for (const rad of data ?? []) {
    const dagar = Math.floor((idag - new Date(rad.cooked_on).getTime()) / 86_400_000)
    const befintlig = senaste.get(rad.recipe_id)
    if (befintlig) {
      befintlig.antal += 1
    } else {
      senaste.set(rad.recipe_id, { daysAgo: Math.max(0, dagar), antal: 1 })
    }
  }

  return [...senaste.entries()].map(([recipeId, värde]) => ({ recipeId, ...värde }))
}

export async function vaxlaFavorit(
  householdId: HouseholdId,
  userId: string,
  recipeId: string,
  favorit: boolean,
): Promise<void> {
  if (favorit) {
    const { error } = await supabase
      .from('favorite_recipes')
      .insert({ household_id: householdId, user_id: userId, recipe_id: recipeId })
    if (error && error.code !== '23505') throw error
  } else {
    const { error } = await supabase
      .from('favorite_recipes')
      .delete()
      .eq('household_id', householdId)
      .eq('recipe_id', recipeId)
    if (error) throw error
  }
}

export async function hamtaFavoriter(householdId: HouseholdId): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('favorite_recipes')
    .select('recipe_id')
    .eq('household_id', householdId)

  if (error) throw error
  return new Set((data ?? []).map((rad) => rad.recipe_id))
}
