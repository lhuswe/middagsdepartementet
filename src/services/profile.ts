/**
 * Hushållsprofilen.
 *
 * Inga hårdkodade värden: antal vuxna, portioner, butik, budget och
 * matpreferenser styr allt annat i appen. Raden skapas av en databastrigger vid
 * registrering, så appen behöver aldrig hantera fallet "inloggad men profillös".
 */

import { supabase } from '../lib/supabase.ts'
import type { ProfileRow, StoreRow } from '../types/database.ts'


export async function hamtaProfil(userId: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
  if (error) throw error
  return data
}

export async function sparaProfil(
  userId: string,
  andringar: Partial<ProfileRow>,
): Promise<ProfileRow> {
  const { data, error } = await supabase
    .from('profiles')
    .update(andringar)
    .eq('id', userId)
    .select('*')
    .single()

  if (error) throw error
  return data
}

export async function hamtaButiker(): Promise<StoreRow[]> {
  const { data, error } = await supabase.from('stores').select('*').order('city')
  if (error) throw error
  return data ?? []
}

/**
 * Portioner per måltid, härlett ur hushållet om användaren inte satt något
 * eget. Barn räknas som en halv portion - grovt, men bättre än att räkna dem
 * som vuxna och slänga mat varje vecka.
 */
export function portionerFor(profil: ProfileRow | null): number {
  if (!profil) return 2
  if (profil.servings_per_meal > 0) return profil.servings_per_meal
  return Math.max(1, Math.round(profil.adults + profil.children * 0.5))
}

/**
 * Butiken profilen pekar på, eller null.
 *
 * Returnerar medvetet ingen standardbutik. Priser och lagerstatus är
 * butiksspecifika, så en gissning här hade inte gett "ungefär rätt" utan
 * priser från fel stad, utan att någon märkte det. Saknas butik ska appen
 * säga ifrån, inte välja åt användaren.
 */
export function butikFor(profil: ProfileRow | null): string | null {
  return profil?.store_number ?? null
}
