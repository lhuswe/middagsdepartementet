/**
 * Skafferiet.
 *
 * Mängderna lagras i ingrediensens kanoniska enhet (gram eller milliliter), så
 * att avdraget mot veckans behov blir en ren subtraktion. Omräkningen från vad
 * användaren skriver ("2 paket pasta") sker i gränssnittet, inte här.
 */

import type { PantryEntry } from '../domain/aggregate.ts'
import { getIngredient } from '../domain/ingredients.ts'
import { toBase } from '../domain/units.ts'
import type { RecipeUnit } from '../domain/types.ts'
import { supabase } from '../lib/supabase.ts'
import type { PantryItemRow } from '../types/database.ts'

export async function hamtaSkafferi(userId: string): Promise<PantryItemRow[]> {
  const { data, error } = await supabase
    .from('pantry_items')
    .select('*')
    .eq('user_id', userId)
    .order('ingredient_id')

  if (error) throw error
  return data ?? []
}

/** Omvandlar skafferiraderna till domänens form. */
export function tillPantryEntries(rader: PantryItemRow[]): PantryEntry[] {
  return rader.map((rad) => ({ ingredientId: rad.ingredient_id, amount: Number(rad.amount) }))
}

/**
 * Sparar en skafferipost. Mängden anges i valfri receptenhet och räknas om till
 * kanonisk enhet - annars skulle "3 dl ris" och "250 g ris" inte gå att jämföra.
 */
export async function sparaSkafferipost(
  userId: string,
  ingredientId: string,
  varde: number,
  enhet: RecipeUnit,
  extra: { expiresOn?: string | null; minStock?: number | null } = {},
): Promise<void> {
  const ingredient = getIngredient(ingredientId)
  if (!ingredient) throw new Error(`Okänd ingrediens: ${ingredientId}`)

  const bas = toBase({ value: varde, unit: enhet }, ingredient)
  if (bas.confidence === 'unknown') {
    throw new Error(
      `Mängden går inte att räkna om till ${ingredient.canonicalUnit} för ${ingredient.name}.`,
    )
  }

  const { error } = await supabase.from('pantry_items').upsert(
    {
      user_id: userId,
      ingredient_id: ingredientId,
      amount: Math.round(bas.value * 1000) / 1000,
      expires_on: extra.expiresOn ?? null,
      min_stock: extra.minStock ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,ingredient_id' },
  )

  if (error) throw error
}

export async function taBortSkafferipost(userId: string, ingredientId: string): Promise<void> {
  const { error } = await supabase
    .from('pantry_items')
    .delete()
    .eq('user_id', userId)
    .eq('ingredient_id', ingredientId)

  if (error) throw error
}

/** Poster som går ut inom angivet antal dagar. */
export function utgarSnart(rader: PantryItemRow[], dagar = 7): PantryItemRow[] {
  const grans = Date.now() + dagar * 86_400_000
  return rader
    .filter((rad) => rad.expires_on !== null && new Date(rad.expires_on).getTime() <= grans)
    .sort((a, b) => (a.expires_on ?? '').localeCompare(b.expires_on ?? ''))
}
