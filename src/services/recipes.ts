/**
 * Recept.
 *
 * Varje hushåll äger sina egna recept - även startrecepten, som kopieras in i
 * samlingen vid onboardingen. Det gör dem redigerbara utan att något annat
 * hushålls kopia påverkas, och det håller RLS-modellen enkel: allt i `recipes`
 * hör till ett hushåll.
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
 * Kompletterar recept som finns men saknar sina ingrediensrader.
 *
 * Finns av en anledning. Ingrediensraderna skrevs tidigare i ett enda anrop, så
 * en enda trasig främmandenyckel gjorde att *inga* rader kom in. Recepten fanns
 * men var tomma, och ett recept utan ingredienser går inte att handla för.
 *
 * Skiljd från `importeraStartrecept` med flit: den här rör bara recept som
 * redan finns, och kan därför aldrig återuppliva något användaren raderat.
 */
export async function kompletteraStartrecept(householdId: HouseholdId): Promise<number> {
  const { data, error } = await supabase
    .from('recipes')
    .select('id, name, recipe_ingredients(id)')
    .eq('household_id', householdId)
    .eq('is_seed', true)

  if (error) throw error

  const tomma = ((data ?? []) as { id: string; name: string; recipe_ingredients: unknown[] }[])
    .filter((rad) => (rad.recipe_ingredients ?? []).length === 0)

  const rader = tomma.flatMap((rad) => {
    const kalla = SEED_RECIPES.find((recipe) => recipe.name === rad.name)
    if (!kalla) return []
    return kalla.ingredients.map((item, index) => ({
      recipe_id: rad.id,
      ingredient_id: item.ingredientId,
      quantity: item.quantity.value,
      unit: item.quantity.unit,
      optional: item.optional,
      sort_order: index,
    }))
  })

  if (rader.length === 0) return 0

  const { error: skrivFel } = await supabase.from('recipe_ingredients').insert(rader)
  if (skrivFel) throw skrivFel

  return tomma.length
}

/**
 * Lägger in startrecepten i hushållets samling.
 *
 * Körs vid onboarding och när användaren uttryckligen ber om det. Recept som
 * redan finns skapas inte igen, och recept som saknar sina ingrediensrader
 * repareras på vägen.
 *
 * Att den återskapar startrecept som raderats är avsiktligt: den anropas bara
 * från onboardingen och från en knapp som heter "Hämta startrecepten". Den
 * automatiska reparationen ligger i `kompletteraStartrecept`, som aldrig
 * skapar något nytt.
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

/** Ett recept som det ser ut i redigeringsformuläret. */
export interface Receptutkast {
  name: string
  description: string
  servings: number
  prepMinutes: number
  cookMinutes: number
  instructions: string[]
  tags: string[]
  ingredients: {
    ingredientId: string
    quantity: number
    unit: RecipeUnit
    optional: boolean
    note?: string | null
  }[]
}

function tillIngrediensrader(recipeId: string, utkast: Receptutkast) {
  return utkast.ingredients.map((item, index) => ({
    recipe_id: recipeId,
    ingredient_id: item.ingredientId,
    quantity: item.quantity,
    unit: item.unit,
    optional: item.optional,
    note: item.note ?? null,
    sort_order: index,
  }))
}

/** Fälten som hör till receptraden, gemensamma för skapa och spara. */
function tillReceptrad(utkast: Receptutkast) {
  return {
    name: utkast.name.trim(),
    description: utkast.description.trim(),
    servings: utkast.servings,
    prep_minutes: utkast.prepMinutes,
    cook_minutes: utkast.cookMinutes,
    instructions: utkast.instructions.filter((steg) => steg.trim().length > 0),
    tags: utkast.tags,
  }
}

export async function skapaRecept(
  householdId: HouseholdId,
  userId: string,
  utkast: Receptutkast,
): Promise<string> {
  const { data, error } = await supabase
    .from('recipes')
    .insert({
      household_id: householdId,
      user_id: userId,
      ...tillReceptrad(utkast),
      source: null,
      is_seed: false,
    })
    .select('id')
    .single()

  if (error) throw error

  if (utkast.ingredients.length > 0) {
    const { error: radFel } = await supabase
      .from('recipe_ingredients')
      .insert(tillIngrediensrader(data.id, utkast))
    if (radFel) throw radFel
  }

  return data.id
}

/**
 * Sparar ändringar i ett befintligt recept.
 *
 * Ingredienserna ersätts i sin helhet i stället för att jämföras rad för rad.
 * Enklare, och skillnaden märks inte på tio rader. Ordningen är betydelsebärande
 * och kommer ur `sort_order`, så en diff hade ändå behövt skriva om allt som
 * flyttat sig.
 *
 * Ändringen gäller bara det egna hushållet. Det följer av datamodellen: varje
 * hushåll har egna receptrader, även för startrecepten, och RLS släpper bara
 * igenom de egna.
 */
export async function sparaRecept(recipeId: string, utkast: Receptutkast): Promise<void> {
  const { error } = await supabase
    .from('recipes')
    .update(tillReceptrad(utkast))
    .eq('id', recipeId)

  if (error) throw error

  const { error: raderaFel } = await supabase
    .from('recipe_ingredients')
    .delete()
    .eq('recipe_id', recipeId)

  if (raderaFel) throw raderaFel

  if (utkast.ingredients.length === 0) return

  const { error: radFel } = await supabase
    .from('recipe_ingredients')
    .insert(tillIngrediensrader(recipeId, utkast))

  if (radFel) throw radFel
}

/**
 * Hur många planerade måltider som försvinner om receptet raderas.
 *
 * `meal_plan_items.recipe_id` är `on delete set null`, så dagarna blir tomma
 * utan att något syns. Frågan ställs innan, så att varningen kan vara konkret.
 */
export async function planeradeMaltiderFor(recipeId: string): Promise<number> {
  const { count, error } = await supabase
    .from('meal_plan_items')
    .select('id', { count: 'exact', head: true })
    .eq('recipe_id', recipeId)

  if (error) throw error
  return count ?? 0
}

export async function taBortRecept(recipeId: string): Promise<void> {
  const { error } = await supabase.from('recipes').delete().eq('id', recipeId)
  if (error) throw error
}
