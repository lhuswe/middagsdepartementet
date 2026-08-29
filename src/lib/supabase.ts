/**
 * Supabase-klienten.
 *
 * Två saker här är inte valfria:
 *
 * 1. `flowType: 'pkce'`. Standardflödet returnerar sessionen i URL-fragmentet
 *    (`#access_token=...`), vilket kolliderar med hash-routing och beter sig
 *    olika på GitHub Pages jämfört med dev-servern. PKCE lägger i stället en
 *    `?code=` i query-strängen. Utan detta fungerar magisk länk lokalt men går
 *    sönder i produktion — den värsta sortens bugg.
 *
 * 2. Bara den publika nyckeln. Skyddet ligger i RLS, inte i att nyckeln är
 *    hemlig. Service role-nyckeln finns aldrig i frontenden.
 */

import { createClient } from '@supabase/supabase-js'

import type { Database } from '../types/database.ts'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * Null när konfigurationen är komplett, annars en förklaring att visa.
 *
 * Modulen kastar medvetet INTE här. Ett fel vid modulladdning inträffar innan
 * React hunnit rendera något, så ingen felgräns kan fånga det — resultatet blir
 * en vit skärm utan förklaring. Det har hänt en gång, i produktion, och ska
 * inte hända igen. `main.tsx` läser det här värdet och visar en läsbar sida.
 */
export const konfigurationsfel: string | null =
  !url || !anonKey
    ? 'Adressen till databasen saknas i bygget. Lokalt: kopiera .env.example till .env.local. ' +
      'I produktion: sätt VITE_SUPABASE_URL och VITE_SUPABASE_ANON_KEY som repository secrets och kör om publiceringen.'
    : null

// Platshållarvärden när konfigurationen saknas, så att importen går igenom och
// felet kan presenteras ordentligt i stället för att fälla hela appen.
export const supabase = createClient<Database>(url || 'https://saknas.invalid', anonKey || 'saknas', {
  auth: {
    flowType: 'pkce',
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
})

/** Basadress för appen, med GitHub Pages-prefixet inräknat. */
export function appUrl(path = ''): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  return `${window.location.origin}${base}${path}`
}
