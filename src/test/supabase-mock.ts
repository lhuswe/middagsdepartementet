/**
 * Attrapp för Supabase-klienten.
 *
 * Finns för att sidorna ska gå att rendera i test utan databas och utan
 * inloggning. Kedjan (`.from().select().eq().order()`) byggs som en proxy som
 * returnerar sig själv tills någon väntar på den - då faller svaret ut ur
 * `TABELLDATA`.
 *
 * Syftet är inte att simulera Postgres, utan att fånga det som annars bara
 * upptäcks av en människa som klickar runt: krascher på tomma listor, fält som
 * är null, komponenter som importerats fel.
 */

import { vi } from 'vitest'

export interface MockOptions {
  /** Rader per tabell. Tabeller som saknas svarar med tom lista. */
  tabeller?: Record<string, unknown[]>
  /** Svar per databasfunktion. Saknas den svarar attrappen med null. */
  funktioner?: Record<string, unknown>
  /** Sätts till false för att simulera utloggad användare. */
  inloggad?: boolean
}

export const TESTHUSHALL = {
  id: '00000000-0000-4000-8000-000000000002',
  name: 'Testhushållet',
  store_number: '3230',
  adults: 2,
  children: 0,
  servings_per_meal: 2,
  max_cooking_minutes: 45,
  weekly_budget: 900,
  is_member: false,
  assume_staples_available: true,
  repetition_avoidance: 'medium',
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
}

export const TESTANVANDARE = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'test@example.com',
}

export const TESTPROFIL = {
  id: TESTANVANDARE.id,
  display_name: 'Testpersonen',
  allergies: [],
  dislikes: [],
  diets: [],
  is_admin: true,
  onboarded_at: '2026-08-01T00:00:00.000Z',
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
}

/** Bygger en kedjebar frågeattrapp som till slut svarar med tabellens rader. */
function frageKedja(rader: unknown[]) {
  const svar = { data: rader, error: null, count: rader.length }
  const enskilt = { data: rader[0] ?? null, error: null }

  const kedja: Record<string, unknown> = {}
  const metoder = [
    'select',
    'insert',
    'update',
    'upsert',
    'delete',
    'eq',
    'neq',
    'gt',
    'lt',
    'gte',
    'lte',
    'like',
    'ilike',
    'is',
    'in',
    'not',
    'or',
    'filter',
    'order',
    'limit',
    'range',
    'textSearch',
  ]

  for (const metod of metoder) {
    kedja[metod] = vi.fn(() => kedja)
  }

  kedja.single = vi.fn(async () => enskilt)
  kedja.maybeSingle = vi.fn(async () => enskilt)
  // Gör kedjan await-bar utan att .single() anropats.
  kedja.then = (
    lös: (value: typeof svar) => unknown,
    fånga?: (reason: unknown) => unknown,
  ) => Promise.resolve(svar).then(lös, fånga)

  return kedja
}

export function skapaSupabaseAttrapp(options: MockOptions = {}) {
  const { tabeller = {}, funktioner = {}, inloggad = true } = options

  const session = inloggad
    ? {
        access_token: 'test-token',
        refresh_token: 'test-refresh',
        expires_in: 3600,
        token_type: 'bearer',
        user: TESTANVANDARE,
      }
    : null

  return {
    from: vi.fn((tabell: string) => frageKedja(tabeller[tabell] ?? [])),
    rpc: vi.fn(async (namn: string) => ({ data: funktioner[namn] ?? null, error: null })),
    auth: {
      getSession: vi.fn(async () => ({ data: { session }, error: null })),
      getUser: vi.fn(async () => ({ data: { user: session?.user ?? null }, error: null })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      signInWithPassword: vi.fn(async () => ({ data: { session }, error: null })),
      signInWithOtp: vi.fn(async () => ({ data: {}, error: null })),
      resetPasswordForEmail: vi.fn(async () => ({ data: {}, error: null })),
      updateUser: vi.fn(async () => ({ data: { user: session?.user }, error: null })),
      signOut: vi.fn(async () => ({ error: null })),
    },
    functions: {
      invoke: vi.fn(async () => ({ data: { status: 'success', productsUpserted: 0 }, error: null })),
    },
  }
}
