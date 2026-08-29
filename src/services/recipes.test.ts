/**
 * Att receptimporten läker recept som saknar sina ingredienser.
 *
 * Bakgrunden är ett verkligt fel. Ingrediensraderna skrevs i ett enda anrop,
 * och en enda trasig främmandenyckel gjorde att inga rader alls kom in.
 * Trettio recept blev kvar utan ingredienser, och eftersom funktionen hoppade
 * av direkt när samlingen inte var tom fanns ingen väg tillbaka. Varje
 * inköpslista kom ut tom, utan att något felmeddelande visades.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SEED_RECIPES } from '../domain/seed-recipes.ts'
import { somHouseholdId } from '../types/ids.ts'

interface Skrivning {
  tabell: string
  rader: unknown[]
}

const skrivet: Skrivning[] = []
let befintligaRecept: { id: string; name: string; recipe_ingredients: unknown[] }[] = []

/**
 * Minimal attrapp: bara det `importeraStartrecept` faktiskt rör.
 *
 * Den delade attrappen i `src/test/` svarar med samma rader oavsett operation
 * och fångar inte insättningar, och det är just insättningarna som ska granskas
 * här.
 */
vi.mock('../lib/supabase.ts', () => {
  const kedja = (tabell: string) => {
    const self: Record<string, unknown> = {}
    const svar = { data: tabell === 'recipes' ? befintligaRecept : [], error: null }

    self.select = vi.fn(() => self)
    self.eq = vi.fn(() => self)
    self.insert = vi.fn((rader: unknown[]) => {
      skrivet.push({ tabell, rader })
      // Insättningen av recept ska kunna kedjas med .select() och ge tillbaka
      // id:n, precis som PostgREST gör.
      const skapade = (rader as { name: string }[]).map((rad, index) => ({
        id: `nytt-${index}`,
        name: rad.name,
      }))
      const efter: Record<string, unknown> = {
        select: vi.fn(async () => ({ data: skapade, error: null })),
        then: (los: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(los),
      }
      return efter
    })
    self.then = (los: (v: unknown) => unknown) => Promise.resolve(svar).then(los)
    return self
  }

  return { supabase: { from: vi.fn((tabell: string) => kedja(tabell)) } }
})

const { importeraStartrecept } = await import('./recipes.ts')

const HUSHALL = somHouseholdId('hushall-1')
const ANVANDARE = 'anvandare-1'

/** Antalet ingrediensrader startrecepten sammanlagt ska ge. */
const ALLA_RADER = SEED_RECIPES.reduce((summa, recipe) => summa + recipe.ingredients.length, 0)

function ingrediensrader(): unknown[] {
  return skrivet.filter((post) => post.tabell === 'recipe_ingredients').flatMap((post) => post.rader)
}

beforeEach(() => {
  skrivet.length = 0
  befintligaRecept = []
})

describe('importeraStartrecept', () => {
  it('skapar recepten och deras ingredienser i en tom samling', async () => {
    const antal = await importeraStartrecept(HUSHALL, ANVANDARE)

    expect(antal).toBe(SEED_RECIPES.length)
    expect(ingrediensrader()).toHaveLength(ALLA_RADER)
  })

  it('gör ingenting när samlingen redan är komplett', async () => {
    befintligaRecept = SEED_RECIPES.map((recipe, index) => ({
      id: `finns-${index}`,
      name: recipe.name,
      recipe_ingredients: [{ id: 'en rad' }],
    }))

    const antal = await importeraStartrecept(HUSHALL, ANVANDARE)

    expect(antal).toBe(0)
    expect(skrivet).toEqual([])
  })

  // Det här är läget som tidigare inte gick att ta sig ur.
  it('kompletterar recept som finns men saknar ingredienser', async () => {
    befintligaRecept = SEED_RECIPES.map((recipe, index) => ({
      id: `finns-${index}`,
      name: recipe.name,
      recipe_ingredients: [],
    }))

    const antal = await importeraStartrecept(HUSHALL, ANVANDARE)

    // Inga nya recept, men alla ingrediensrader.
    expect(antal).toBe(0)
    expect(skrivet.some((post) => post.tabell === 'recipes')).toBe(false)
    expect(ingrediensrader()).toHaveLength(ALLA_RADER)

    // Raderna ska peka på de befintliga recepten, inte på nyskapade.
    const recipeIds = new Set(
      (ingrediensrader() as { recipe_id: string }[]).map((rad) => rad.recipe_id),
    )
    expect(recipeIds.size).toBe(SEED_RECIPES.length)
    for (const id of recipeIds) expect(id.startsWith('finns-')).toBe(true)
  })

  it('rör inte recept som redan har sina ingredienser', async () => {
    befintligaRecept = SEED_RECIPES.map((recipe, index) => ({
      id: `finns-${index}`,
      name: recipe.name,
      // Bara det första receptet saknar sina rader.
      recipe_ingredients: index === 0 ? [] : [{ id: 'en rad' }],
    }))

    await importeraStartrecept(HUSHALL, ANVANDARE)

    expect(ingrediensrader()).toHaveLength(SEED_RECIPES[0]!.ingredients.length)
  })
})
