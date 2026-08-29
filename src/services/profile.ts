/**
 * Den personliga profilen: identitet, allergier och smak.
 *
 * Hushållets inställningar (butik, budget, portioner) ligger i services/hushall.
 * Allergier stannar här eftersom de tillhör personen, men matsedeln måste utgå
 * från unionen av hushållets alla allergier.
 *
 * Raden skapas av en databastrigger vid registrering, så appen behöver aldrig
 * hantera fallet "inloggad men profillös".
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
