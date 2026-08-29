/**
 * Recept.
 *
 * Varje användare äger sina egna recept — även startrecepten, som kopieras in i
 * samlingen vid första inloggningen. Det gör dem redigerbara utan att någon
 * annans kopia påverkas, och det håller RLS-modellen enkel: allt i `recipes`
 * har en ägare.
 */

import { SEED_RECIPES } from '../domain/seed-recipes.ts'
import type { Recipe, RecipeUnit } from '../domain/types.ts'
import { supabase } from '../lib/supabase.ts'
import type { RecipeIngredientRow, RecipeRow } from '../types/database.ts'

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

export async function hamtaRecept(userId: string): Promise<Recipe[]> {
  const { data, error } = await supabase
    .from('recipes')
    .select('*, recipe_ingredients(*)')
    .eq('user_id', userId)
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
 * Lägger in startrecepten i användarens samling.
 *
 * Körs en gång, vid onboarding. Är samlingen redan fylld händer ingenting —
 * funktionen ska gå att anropa om utan att skapa dubbletter.
 */
export async function importeraStartrecept(userId: string): Promise<number> {
  const { count } = await supabase
    .from('recipes')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)

  if ((count ?? 0) > 0) return 0

  const { data: skapade, error } = await supabase
    .from('recipes')
    .insert(
      SEED_RECIPES.map((recipe) => ({
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

  // Koppla ingredienserna. Namnet är nyckeln tillbaka till källreceptet,
  // eftersom databasen genererar egna id:n.
  const idFörNamn = new Map((skapade ?? []).map((row) => [row.name, row.id]))
  const rader = SEED_RECIPES.flatMap((recipe) => {
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
  })

  const { error: ingrediensFel } = await supabase.from('recipe_ingredients').insert(rader)
  if (ingrediensFel) throw ingrediensFel

  return skapade?.length ?? 0
}

export async function markeraLagad(
  userId: string,
  recipeId: string,
  servings: number,
): Promise<void> {
  const { error } = await supabase
    .from('cooking_history')
    .insert({ user_id: userId, recipe_id: recipeId, servings })
  if (error) throw error
}

export interface Lagningshistorik {
  recipeId: string
  daysAgo: number
  antal: number
}

/** Vad som lagats den senaste tiden, för planerarens repetitionsspärr. */
export async function hamtaLagningshistorik(userId: string): Promise<Lagningshistorik[]> {
  const { data, error } = await supabase
    .from('cooking_history')
    .select('recipe_id, cooked_on')
    .eq('user_id', userId)
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
  userId: string,
  recipeId: string,
  favorit: boolean,
): Promise<void> {
  if (favorit) {
    const { error } = await supabase
      .from('favorite_recipes')
      .insert({ user_id: userId, recipe_id: recipeId })
    if (error && error.code !== '23505') throw error
  } else {
    const { error } = await supabase
      .from('favorite_recipes')
      .delete()
      .eq('user_id', userId)
      .eq('recipe_id', recipeId)
    if (error) throw error
  }
}

export async function hamtaFavoriter(userId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('favorite_recipes')
    .select('recipe_id')
    .eq('user_id', userId)

  if (error) throw error
  return new Set((data ?? []).map((rad) => rad.recipe_id))
}
