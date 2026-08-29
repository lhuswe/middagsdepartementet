/**
 * Hushållet.
 *
 * Allt som handlar om maten ägs av hushållet: recept, matsedel, skafferi,
 * inköpslistor, produktval och lagningshistorik. Personen äger sin identitet,
 * sina allergier och sin smak.
 *
 * En person tillhör exakt ett hushåll. Det är en medveten förenkling som tar
 * bort frågan "vilket hushåll agerar jag i" ur varje fråga i appen.
 *
 * Att skapa ett hushåll och att gå med i ett sker via databasfunktioner, inte
 * genom att skriva i household_members. Medlemskap har villkor, och de hör
 * hemma där de inte går att kringgå.
 */

import { supabase } from '../lib/supabase.ts'
import type { HouseholdInviteRow, HouseholdMemberRow, HouseholdRow, ProfileRow } from '../types/database.ts'

export interface Medlem {
  userId: string
  roll: 'owner' | 'member'
  medSedan: string
  namn: string | null
  allergier: string[]
}

/** Hushållet den inloggade tillhör, eller null om hen inte hör till något. */
export async function hamtaHushall(): Promise<HouseholdRow | null> {
  const { data, error } = await supabase.from('households').select('*').maybeSingle()
  if (error) throw error
  return data
}

export async function sparaHushall(
  householdId: string,
  andringar: Partial<HouseholdRow>,
): Promise<HouseholdRow> {
  const { data, error } = await supabase
    .from('households')
    .update(andringar)
    .eq('id', householdId)
    .select('*')
    .single()

  if (error) throw error
  return data
}

/**
 * Medlemmarna med namn och allergier.
 *
 * Allergierna behövs för att matsedeln ska kunna ta hänsyn till hela hushållet,
 * och visas i gränssnittet så att det är tydligt att de delas. RLS gör att bara
 * profiler i det egna hushållet är läsbara.
 */
export async function hamtaMedlemmar(): Promise<Medlem[]> {
  const { data: medlemmar, error } = await supabase
    .from('household_members')
    .select('*')
    .order('joined_at')

  if (error) throw error
  if (!medlemmar || medlemmar.length === 0) return []

  const { data: profiler } = await supabase
    .from('profiles')
    .select('id, display_name, allergies')
    .in(
      'id',
      medlemmar.map((rad: HouseholdMemberRow) => rad.user_id),
    )

  const perId = new Map(
    (profiler ?? []).map((rad) => [rad.id, rad as Pick<ProfileRow, 'id' | 'display_name' | 'allergies'>]),
  )

  return medlemmar.map((rad: HouseholdMemberRow) => ({
    userId: rad.user_id,
    roll: rad.role,
    medSedan: rad.joined_at,
    namn: perId.get(rad.user_id)?.display_name ?? null,
    allergier: perId.get(rad.user_id)?.allergies ?? [],
  }))
}

/**
 * Hushållets samlade allergier.
 *
 * Läses ur databasen och inte ihopsatt i klienten, så att regeln bara finns på
 * ett ställe. En rätt som är olämplig för en medlem är olämplig för måltiden.
 */
export async function hamtaHushallsallergier(): Promise<string[]> {
  const { data, error } = await supabase.rpc('hushallets_allergier')
  if (error) throw error
  return (data as string[] | null) ?? []
}

export async function skapaHushall(namn: string): Promise<string> {
  const { data, error } = await supabase.rpc('skapa_hushall', { namn })
  if (error) throw error
  return data as string
}

/** Löser in en inbjudningskod. Villkoren kontrolleras i databasen. */
export async function losInInbjudan(kod: string): Promise<string> {
  const { data, error } = await supabase.rpc('los_in_inbjudan', { kod: kod.trim() })
  if (error) throw new Error(oversattHushallsfel(error.message))
  return data as string
}

export async function hamtaInbjudningar(): Promise<HouseholdInviteRow[]> {
  const { data, error } = await supabase
    .from('household_invites')
    .select('*')
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })

  if (error) throw error
  return data ?? []
}

export async function skapaInbjudan(
  householdId: string,
  userId: string,
): Promise<HouseholdInviteRow> {
  const { data, error } = await supabase
    .from('household_invites')
    .insert({ household_id: householdId, created_by: userId })
    .select('*')
    .single()

  if (error) throw error
  return data
}

export async function aterkallaInbjudan(kod: string): Promise<void> {
  const { error } = await supabase.from('household_invites').delete().eq('code', kod)
  if (error) throw error
}

/**
 * Lämnar hushållet.
 *
 * Data följer inte med, eftersom den tillhör hushållet och inte personen. Det
 * ska sägas rakt ut i gränssnittet innan någon trycker.
 */
export async function lamnaHushall(userId: string): Promise<void> {
  const { error } = await supabase.from('household_members').delete().eq('user_id', userId)
  if (error) throw error
}

/** Portioner per måltid, härlett ur hushållet om inget eget värde är satt. */
export function portionerFor(hushall: HouseholdRow | null): number {
  if (!hushall) return 2
  if (hushall.servings_per_meal > 0) return hushall.servings_per_meal
  // Barn räknas som en halv portion. Grovt, men bättre än att räkna dem som
  // vuxna och slänga mat varje vecka.
  return Math.max(1, Math.round(hushall.adults + hushall.children * 0.5))
}

/** Databasen svarar på svenska redan, men undantagstexten är inbakad i felet. */
function oversattHushallsfel(message: string): string {
  const match = message.match(/(Inbjudningskoden[^"]*|Du tillhör[^"]*|Inte inloggad\.)/)
  return match?.[1]?.trim() ?? `Kunde inte gå med: ${message}`
}
