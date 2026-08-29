/**
 * Veckoplaneraren.
 *
 * Regelbaserad, inte AI-driven. Det är ett medvetet val för V1: uppgiften är
 * "välj sju rätter ur en lista med trettio, utan att upprepa dig, med hänsyn
 * till vad någon tycker illa om" - och det är en sorteringsuppgift, inte en
 * språkuppgift. Regler ger dessutom samma svar två gånger, går att testa, och
 * kostar ingenting att köra.
 *
 * `AIProvider` byggs vid sidan av och kan ta över urvalet senare. Vad den
 * *aldrig* ska göra är kvantitetsmatten - den bor i `aggregate` och `packaging`
 * och ska förbli deterministisk.
 *
 * Urvalet är girigt: välj den bäst poängsatta rätten, lägg till den, poängsätt
 * om resten med hänsyn till vad som redan valts. Det ger ingrediensåteranvändning
 * nästan gratis, eftersom en rätt som delar råvaror med gårdagens får bonus.
 */

import type { PlannedMeal } from './aggregate.ts'
import type { Recipe } from './types.ts'

export interface PlanOptions {
  /** Antal dagar att planera. */
  days: number
  /** Första dagen i planen. */
  startDate: Date
  /** Portioner per måltid. */
  servings: number
  /** Rätter som tar längre tid än så här väljs bort. */
  maxMinutes?: number
  /** Ingredienser hushållet inte vill ha - ogillat eller allergener. */
  avoidIngredientIds?: string[]
  /** Minst en av dessa taggar måste finnas, om listan inte är tom. */
  requiredTags?: string[]
  /** Rätter med någon av dessa taggar väljs bort. */
  excludedTags?: string[]
  /** Hur hårt upprepning ska undvikas. */
  repetitionAvoidance?: 'low' | 'medium' | 'high'
  /** Vad som lagats nyligen, för att slippa samma rätt två veckor i rad. */
  recentlyCooked?: { recipeId: string; daysAgo: number }[]
  /** Ingredienser som är på kampanj den här veckan. Ger bonus. */
  favoredIngredientIds?: string[]
  /** Frö för det slumpmässiga inslaget. Samma frö ger samma plan. */
  seed?: number
}

export interface PlanResult {
  meals: PlannedMeal[]
  /** Dagar som inte kunde fyllas, med skäl. */
  ofyllda: { date: Date; reason: string }[]
  /** Kort motivering per vald rätt, för gränssnittet. */
  motiveringar: Record<string, string>
}

/** Hur många dagar tillbaka en tidigare lagad rätt straffas. */
const REPETITION_WINDOW: Record<NonNullable<PlanOptions['repetitionAvoidance']>, number> = {
  low: 7,
  medium: 21,
  high: 45,
}

/**
 * Enkel deterministisk slumpgenerator (mulberry32).
 *
 * Behövs för att "slumpa om veckan" ska vara reproducerbar: samma frö ger samma
 * plan, vilket gör både tester och en ångra-knapp möjliga.
 */
function slump(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Rätter som över huvud taget får förekomma i planen. */
export function kandidater(recipes: Recipe[], options: PlanOptions): Recipe[] {
  const avoid = new Set(options.avoidIngredientIds ?? [])
  const excluded = new Set(options.excludedTags ?? [])
  const required = options.requiredTags ?? []

  return recipes.filter((recipe) => {
    const totalMinutes = recipe.prepMinutes + recipe.cookMinutes
    if (options.maxMinutes !== undefined && totalMinutes > options.maxMinutes) return false

    if (recipe.tags.some((tag) => excluded.has(tag))) return false
    if (required.length > 0 && !recipe.tags.some((tag) => required.includes(tag))) return false

    // En rätt utesluts om en oönskad ingrediens är obligatorisk i den. Valfria
    // ingredienser räknas inte - de går att hoppa över.
    const traffar = recipe.ingredients.some(
      (item) => !item.optional && avoid.has(item.ingredientId),
    )
    if (traffar) return false

    return true
  })
}

function huvudingredienser(recipe: Recipe): Set<string> {
  return new Set(recipe.ingredients.filter((item) => !item.optional).map((item) => item.ingredientId))
}

/**
 * Grov kategorisering av vad rätten bygger på, för att inte servera färs fem
 * dagar i rad. Bygger på ingredienskatalogens id:n, inte på taggar, eftersom
 * taggar är fritext och lätt blir inkonsekventa.
 */
function proteinbas(recipe: Recipe): string {
  const ids = huvudingredienser(recipe)
  if (ids.has('blandfars')) return 'fars'
  if (ids.has('kycklingfile') || ids.has('kycklinglarfile')) return 'kyckling'
  if (ids.has('laxfile') || ids.has('torskfile') || ids.has('rakor')) return 'fisk'
  if (ids.has('falukorv') || ids.has('prinskorv')) return 'korv'
  if (ids.has('flaskfile') || ids.has('flaskkarre') || ids.has('flask_rimmat')) return 'flask'
  if (ids.has('notkott_gryta')) return 'not'
  if (ids.has('kidneybonor') || recipe.tags.includes('vegetariskt')) return 'vegetariskt'
  return 'ovrigt'
}

interface Poang {
  recipe: Recipe
  poang: number
  skal: string[]
}

function poangsatt(
  recipe: Recipe,
  valda: Recipe[],
  options: PlanOptions,
  brus: number,
): Poang {
  const skal: string[] = []
  let poang = 50

  const fonster = REPETITION_WINDOW[options.repetitionAvoidance ?? 'medium']

  // Redan vald den här veckan - nästan alltid fel.
  if (valda.some((valdRecipe) => valdRecipe.id === recipe.id)) {
    poang -= 100
  }

  // Nyligen lagad.
  const senast = options.recentlyCooked?.find((entry) => entry.recipeId === recipe.id)
  if (senast && senast.daysAgo < fonster) {
    const straff = Math.round(40 * (1 - senast.daysAgo / fonster))
    poang -= straff
    if (straff > 10) skal.push(`lagades för ${senast.daysAgo} dagar sedan`)
  }

  // Variation i proteinbas.
  const bas = proteinbas(recipe)
  const antalSammaBas = valda.filter((valdRecipe) => proteinbas(valdRecipe) === bas).length
  if (antalSammaBas > 0) {
    poang -= antalSammaBas * 18
  } else if (valda.length > 0) {
    poang += 8
    skal.push('varierar veckan')
  }

  // Ingrediensåteranvändning: delade råvaror minskar svinn och antal inköp.
  if (valda.length > 0) {
    const mina = huvudingredienser(recipe)
    const redan = new Set(valda.flatMap((valdRecipe) => [...huvudingredienser(valdRecipe)]))
    const delade = [...mina].filter((id) => redan.has(id) && !STAPLE_LIKE.has(id))
    if (delade.length >= 3) {
      poang += Math.min(delade.length * 3, 15)
      skal.push('återanvänder råvaror')
    }
  }

  // Kampanjvaror.
  const favored = new Set(options.favoredIngredientIds ?? [])
  if (favored.size > 0) {
    const traffar = [...huvudingredienser(recipe)].filter((id) => favored.has(id)).length
    if (traffar > 0) {
      poang += Math.min(traffar * 8, 20)
      skal.push('bygger på veckans erbjudanden')
    }
  }

  // Snabb mat en vardag är värt något i sig.
  const total = recipe.prepMinutes + recipe.cookMinutes
  if (total <= 30) {
    poang += 6
    skal.push('klar på en halvtimme')
  } else if (total > 75) {
    poang -= 8
  }

  // Litet slumpinslag så att två veckor i rad inte blir identiska.
  poang += brus * 10

  return { recipe, poang, skal }
}

/**
 * Ingredienser som nästan alla recept delar. De ska inte räknas som
 * "återanvändning" - annars får varje rätt med lök och salt bonus.
 */
const STAPLE_LIKE = new Set([
  'salt',
  'peppar',
  'rapsolja',
  'smor',
  'vetemjol',
  'socker',
  'buljongtarning',
  'gul_lok',
  'vitlok',
])

function datumFor(start: Date, offset: number): Date {
  const date = new Date(start)
  date.setDate(date.getDate() + offset)
  date.setHours(12, 0, 0, 0)
  return date
}

/** Bygger en veckoplan. */
export function planeraVecka(recipes: Recipe[], options: PlanOptions): PlanResult {
  const pool = kandidater(recipes, options)
  const slumpa = slump(options.seed ?? 1)

  const meals: PlannedMeal[] = []
  const ofyllda: PlanResult['ofyllda'] = []
  const motiveringar: Record<string, string> = {}
  const valda: Recipe[] = []

  for (let dag = 0; dag < options.days; dag += 1) {
    const date = datumFor(options.startDate, dag)

    if (pool.length === 0) {
      ofyllda.push({
        date,
        reason: 'Inga recept matchar hushållets inställningar.',
      })
      continue
    }

    const rankade = pool
      .map((recipe) => poangsatt(recipe, valda, options, slumpa()))
      .sort((a, b) => b.poang - a.poang)

    const bast = rankade[0]
    if (!bast || bast.poang < -50) {
      ofyllda.push({ date, reason: 'För få recept för att undvika upprepning.' })
      continue
    }

    valda.push(bast.recipe)
    meals.push({
      recipe: bast.recipe,
      servings: options.servings,
      slotId: `${date.toISOString().slice(0, 10)}/dinner`,
    })
    motiveringar[bast.recipe.id] =
      bast.skal.length > 0 ? bast.skal.join(', ') : 'passar hushållets inställningar'
  }

  return { meals, ofyllda, motiveringar }
}

/**
 * Byter ut en enskild dag mot ett annat recept, med hänsyn till resten av
 * veckan. Används av "slumpa om den här dagen" i planeraren.
 */
export function bytUtMaltid(
  meals: PlannedMeal[],
  slotId: string,
  recipes: Recipe[],
  options: PlanOptions,
): PlannedMeal[] {
  const index = meals.findIndex((meal) => meal.slotId === slotId)
  if (index === -1) return meals

  const ovriga = meals.filter((_, position) => position !== index).map((meal) => meal.recipe)
  const pool = kandidater(recipes, options).filter(
    (recipe) => recipe.id !== meals[index]!.recipe.id,
  )
  if (pool.length === 0) return meals

  const slumpa = slump(options.seed ?? Date.now())
  const bast = pool
    .map((recipe) => poangsatt(recipe, ovriga, options, slumpa()))
    .sort((a, b) => b.poang - a.poang)[0]

  if (!bast) return meals

  const nya = [...meals]
  nya[index] = { ...meals[index]!, recipe: bast.recipe }
  return nya
}
