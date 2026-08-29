/**
 * Att ingredienskatalogen i TypeScript och den i Postgres säger samma sak.
 *
 * `seed-recipes.test.ts` kontrollerar att recepten bara pekar på ingredienser
 * som finns i `src/domain/ingredients.ts`. Det räcker inte. Migrationerna är en
 * genererad kopia av samma katalog, och kopian kan bli efter.
 *
 * Det hände: `rodbetor` lades till i katalogen men seed-SQL:en regenererades
 * aldrig. Receptet "Pytt i panna med stekt ägg" pekade på den, och eftersom
 * `importeraStartrecept` skriver alla receptrader i ett enda anrop sprängde
 * främmandenyckeln hela batchen. Trettio recept fick noll ingredienser, och
 * varje inköpslista blev tom. Ingenting i gränssnittet sa något.
 *
 * Testet jämför därför mot det databasen faktiskt får, inte mot katalogen.
 */

import { readFileSync, globSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { INGREDIENTS } from '../domain/ingredients.ts'
import { SEED_RECIPES } from '../domain/seed-recipes.ts'

const rot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * Ingrediens-id som migrationerna seedar.
 *
 * Läser samtliga migrationer, eftersom en senare migration får lägga till
 * ingredienser som en tidigare saknade. Det är summan som databasen får.
 */
function seedadeIngredienser(): Set<string> {
  const filer = globSync('supabase/migrations/*.sql', { cwd: rot })
  const ids = new Set<string>()

  for (const fil of filer) {
    const innehall = readFileSync(join(rot, fil), 'utf8')

    // Bara block som skriver till ingredienstabellen. Aliasraderna har samma
    // form men hör till en annan tabell och ska inte räknas som ingredienser.
    for (const block of innehall.split(/insert\s+into\s+public\./i).slice(1)) {
      if (!/^ingredients\b/i.test(block)) continue
      const slut = block.search(/;/)
      const kropp = slut === -1 ? block : block.slice(0, slut)
      for (const rad of kropp.matchAll(/^\s*\('([a-z0-9_]+)'/gim)) {
        ids.add(rad[1]!)
      }
    }
  }

  return ids
}

describe('seedade ingredienser', () => {
  it('hittar migrationerna', () => {
    expect(seedadeIngredienser().size).toBeGreaterThan(50)
  })

  it('täcker hela katalogen i src/domain/ingredients.ts', () => {
    const seedade = seedadeIngredienser()
    const saknade = Object.keys(INGREDIENTS).filter((id) => !seedade.has(id))

    expect(
      saknade,
      `Ingredienser finns i katalogen men seedas aldrig till databasen: ${saknade.join(', ')}.\n` +
        'Kör `npm run seed:generate` och lägg resultatet i en ny migration.',
    ).toEqual([])
  })

  // Det här är främmandenyckeln som faktiskt gick sönder.
  it('täcker varje ingrediens som startrecepten refererar', () => {
    const seedade = seedadeIngredienser()
    const saknade: string[] = []

    for (const recipe of SEED_RECIPES) {
      for (const item of recipe.ingredients) {
        if (!seedade.has(item.ingredientId)) {
          saknade.push(`${recipe.name} -> ${item.ingredientId}`)
        }
      }
    }

    expect(
      saknade,
      `Startrecept pekar på ingredienser som databasen aldrig får:\n${saknade.join('\n')}`,
    ).toEqual([])
  })
})
