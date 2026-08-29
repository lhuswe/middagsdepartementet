/**
 * Veckoplaner.
 *
 * En plan per vecka och användare, identifierad av måndagens datum. Att låsa
 * nyckeln till veckostart gör "den här veckan" entydigt och gör det trivialt
 * att kopiera en vecka till nästa.
 */

import { addDays, format, parseISO, startOfWeek } from 'date-fns'

import type { PlannedMeal } from '../domain/aggregate.ts'
import type { Recipe } from '../domain/types.ts'
import { supabase } from '../lib/supabase.ts'
import type { MealPlanItemRow, MealPlanRow } from '../types/database.ts'

export type Maltidstyp = 'breakfast' | 'lunch' | 'dinner'

export interface Veckoplan {
  plan: MealPlanRow
  poster: MealPlanItemRow[]
}

/** Måndagen i veckan som datumet ligger i, som ISO-datum. */
export function veckostart(datum: Date = new Date()): string {
  return format(startOfWeek(datum, { weekStartsOn: 1 }), 'yyyy-MM-dd')
}

export function veckansDagar(weekStart: string): Date[] {
  const start = parseISO(weekStart)
  return Array.from({ length: 7 }, (_, index) => addDays(start, index))
}

export const VECKODAGAR = [
  'Måndag',
  'Tisdag',
  'Onsdag',
  'Torsdag',
  'Fredag',
  'Lördag',
  'Söndag',
] as const

export async function hamtaVeckoplan(
  userId: string,
  weekStart: string,
): Promise<Veckoplan | null> {
  const { data, error } = await supabase
    .from('meal_plans')
    .select('*, meal_plan_items(*)')
    .eq('user_id', userId)
    .eq('week_start', weekStart)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const { meal_plan_items: poster, ...plan } = data as MealPlanRow & {
    meal_plan_items: MealPlanItemRow[]
  }
  return { plan, poster: poster ?? [] }
}

async function sakerstallPlan(userId: string, weekStart: string): Promise<MealPlanRow> {
  const befintlig = await hamtaVeckoplan(userId, weekStart)
  if (befintlig) return befintlig.plan

  const { data, error } = await supabase
    .from('meal_plans')
    .insert({ user_id: userId, week_start: weekStart })
    .select('*')
    .single()

  if (error) throw error
  return data
}

/**
 * Skriver en hel veckoplan. Ersätter befintliga middagar för veckan - det är
 * vad "generera ny matsedel" betyder, och att smyga in dubbletter vore värre.
 */
export async function sparaVeckoplan(
  userId: string,
  weekStart: string,
  meals: PlannedMeal[],
  recipeIdFor: (recipe: Recipe) => string,
  mealType: Maltidstyp = 'dinner',
): Promise<void> {
  const plan = await sakerstallPlan(userId, weekStart)

  const { error: raderaFel } = await supabase
    .from('meal_plan_items')
    .delete()
    .eq('meal_plan_id', plan.id)
    .eq('meal_type', mealType)

  if (raderaFel) throw raderaFel

  const rader = meals.map((meal) => ({
    meal_plan_id: plan.id,
    served_on: meal.slotId?.split('/')[0] ?? weekStart,
    meal_type: mealType,
    recipe_id: recipeIdFor(meal.recipe),
    servings: meal.servings,
  }))

  if (rader.length === 0) return

  const { error } = await supabase.from('meal_plan_items').insert(rader)
  if (error) throw error
}

export async function sattMaltid(
  userId: string,
  weekStart: string,
  servedOn: string,
  recipeId: string | null,
  servings: number,
  mealType: Maltidstyp = 'dinner',
): Promise<void> {
  const plan = await sakerstallPlan(userId, weekStart)

  if (recipeId === null) {
    const { error } = await supabase
      .from('meal_plan_items')
      .delete()
      .eq('meal_plan_id', plan.id)
      .eq('served_on', servedOn)
      .eq('meal_type', mealType)
    if (error) throw error
    return
  }

  const { error } = await supabase.from('meal_plan_items').upsert(
    {
      meal_plan_id: plan.id,
      served_on: servedOn,
      meal_type: mealType,
      recipe_id: recipeId,
      servings,
    },
    { onConflict: 'meal_plan_id,served_on,meal_type' },
  )

  if (error) throw error
}

/** Kopierar en veckas middagar till en annan vecka. */
export async function kopieraVecka(
  userId: string,
  franWeekStart: string,
  tillWeekStart: string,
): Promise<number> {
  const kalla = await hamtaVeckoplan(userId, franWeekStart)
  if (!kalla || kalla.poster.length === 0) return 0

  const mal = await sakerstallPlan(userId, tillWeekStart)
  const skillnad =
    (parseISO(tillWeekStart).getTime() - parseISO(franWeekStart).getTime()) / 86_400_000

  const rader = kalla.poster.map((post) => ({
    meal_plan_id: mal.id,
    served_on: format(addDays(parseISO(post.served_on), Math.round(skillnad)), 'yyyy-MM-dd'),
    meal_type: post.meal_type,
    recipe_id: post.recipe_id,
    servings: post.servings,
  }))

  const { error } = await supabase
    .from('meal_plan_items')
    .upsert(rader, { onConflict: 'meal_plan_id,served_on,meal_type' })

  if (error) throw error
  return rader.length
}
