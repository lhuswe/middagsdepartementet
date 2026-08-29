import { describe, expect, it } from 'vitest'

import { bytUtMaltid, kandidater, planeraVecka, valjMaltidFor, type PlanOptions } from './planner.ts'
import { SEED_RECIPES } from './seed-recipes.ts'

const MANDAG = new Date('2026-08-31T12:00:00+02:00')

function options(overrides: Partial<PlanOptions> = {}): PlanOptions {
  return { days: 7, startDate: MANDAG, servings: 2, seed: 42, ...overrides }
}

describe('kandidater', () => {
  it('sållar bort rätter som tar för lång tid', () => {
    const snabba = kandidater(SEED_RECIPES, options({ maxMinutes: 30 }))
    expect(snabba.length).toBeGreaterThan(0)
    for (const recipe of snabba) {
      expect(recipe.prepMinutes + recipe.cookMinutes).toBeLessThanOrEqual(30)
    }
  })

  it('sållar bort rätter som innehåller något hushållet undviker', () => {
    const utanFisk = kandidater(SEED_RECIPES, options({ avoidIngredientIds: ['laxfile', 'torskfile'] }))
    for (const recipe of utanFisk) {
      const ids = recipe.ingredients.filter((i) => !i.optional).map((i) => i.ingredientId)
      expect(ids).not.toContain('laxfile')
      expect(ids).not.toContain('torskfile')
    }
  })

  // En valfri ingrediens går att hoppa över, så den ska inte utesluta rätten.
  it('låter en valfri ingrediens passera', () => {
    const utanRodbetor = kandidater(SEED_RECIPES, options({ avoidIngredientIds: ['rodbetor'] }))
    expect(utanRodbetor.map((r) => r.id)).toContain('pytt-i-panna')
  })

  it('kan begränsas till vissa taggar', () => {
    const vego = kandidater(SEED_RECIPES, options({ requiredTags: ['vegetariskt'] }))
    expect(vego.length).toBeGreaterThan(0)
    for (const recipe of vego) expect(recipe.tags).toContain('vegetariskt')
  })
})

describe('planeraVecka', () => {
  it('fyller alla dagar med olika rätter', () => {
    const { meals, ofyllda } = planeraVecka(SEED_RECIPES, options())
    expect(meals).toHaveLength(7)
    expect(ofyllda).toEqual([])
    expect(new Set(meals.map((meal) => meal.recipe.id)).size).toBe(7)
  })

  it('varierar proteinbasen i stället för att servera färs hela veckan', () => {
    const { meals } = planeraVecka(SEED_RECIPES, options())
    const farsrätter = meals.filter((meal) =>
      meal.recipe.ingredients.some((i) => i.ingredientId === 'blandfars' && !i.optional),
    )
    expect(farsrätter.length).toBeLessThanOrEqual(3)
  })

  it('ger samma plan för samma frö och en annan för ett annat', () => {
    const a = planeraVecka(SEED_RECIPES, options({ seed: 7 })).meals.map((m) => m.recipe.id)
    const b = planeraVecka(SEED_RECIPES, options({ seed: 7 })).meals.map((m) => m.recipe.id)
    const c = planeraVecka(SEED_RECIPES, options({ seed: 8 })).meals.map((m) => m.recipe.id)
    expect(a).toEqual(b)
    expect(c).not.toEqual(a)
  })

  it('sätter portioner och datum på varje måltid', () => {
    const { meals } = planeraVecka(SEED_RECIPES, options({ servings: 4, days: 3 }))
    expect(meals).toHaveLength(3)
    for (const meal of meals) expect(meal.servings).toBe(4)
    expect(meals[0]?.slotId).toBe('2026-08-31/dinner')
    expect(meals[2]?.slotId).toBe('2026-09-02/dinner')
  })

  it('undviker rätter som lagades nyligen', () => {
    const nyss = SEED_RECIPES.slice(0, 5).map((recipe) => ({ recipeId: recipe.id, daysAgo: 2 }))
    const { meals } = planeraVecka(
      SEED_RECIPES,
      options({ recentlyCooked: nyss, repetitionAvoidance: 'high' }),
    )
    const valda = meals.map((meal) => meal.recipe.id)
    const overlapp = valda.filter((id) => nyss.some((entry) => entry.recipeId === id))
    expect(overlapp.length).toBeLessThanOrEqual(1)
  })

  it('drar mot veckans erbjudanden när sådana finns', () => {
    const utan = planeraVecka(SEED_RECIPES, options()).meals
    const med = planeraVecka(
      SEED_RECIPES,
      options({ favoredIngredientIds: ['kycklingfile', 'kycklinglarfile'] }),
    ).meals

    const kycklingIn = (meals: typeof utan) =>
      meals.filter((meal) =>
        meal.recipe.ingredients.some((i) => i.ingredientId.startsWith('kyckling')),
      ).length

    expect(kycklingIn(med)).toBeGreaterThanOrEqual(kycklingIn(utan))
  })

  it('säger ifrån när inställningarna inte lämnar några recept kvar', () => {
    const { meals, ofyllda } = planeraVecka(SEED_RECIPES, options({ maxMinutes: 1 }))
    expect(meals).toHaveLength(0)
    expect(ofyllda).toHaveLength(7)
    expect(ofyllda[0]?.reason).toContain('Inga recept')
  })

  it('ger en motivering för varje vald rätt', () => {
    const { meals, motiveringar } = planeraVecka(SEED_RECIPES, options())
    for (const meal of meals) {
      expect(motiveringar[meal.recipe.id], meal.recipe.name).toBeTruthy()
    }
  })
})

describe('bytUtMaltid', () => {
  it('byter ut en dag mot ett annat recept och lämnar resten orörd', () => {
    const { meals } = planeraVecka(SEED_RECIPES, options())
    const slotId = meals[2]!.slotId!
    const nya = bytUtMaltid(meals, slotId, SEED_RECIPES, options())

    expect(nya).toHaveLength(meals.length)
    expect(nya[2]!.recipe.id).not.toBe(meals[2]!.recipe.id)
    expect(nya[0]!.recipe.id).toBe(meals[0]!.recipe.id)
    expect(nya[6]!.recipe.id).toBe(meals[6]!.recipe.id)
  })

  /*
   * Den här gick tidigare inte. `bytUtMaltid` letade upp dagen och gav upp när
   * den inte fanns, så en dag man just tagit bort kunde aldrig fyllas igen.
   * Gränssnittet såg ut att göra något - matsedeln markerades som ett osparat
   * utkast - men dagen förblev tom.
   */
  it('fyller en dag som tömts i stället för att ge upp', () => {
    const { meals } = planeraVecka(SEED_RECIPES, options())
    const tomd = meals[2]!.slotId!
    const utan = meals.filter((meal) => meal.slotId !== tomd)

    const nya = bytUtMaltid(utan, tomd, SEED_RECIPES, options())

    expect(nya).toHaveLength(meals.length)
    expect(nya.find((meal) => meal.slotId === tomd)).toBeDefined()
    // Veckan ska fortfarande ligga i datumordning.
    expect(nya.map((meal) => meal.slotId)).toEqual([...nya.map((meal) => meal.slotId)].sort())
  })

  it('lämnar planen orörd när inget recept är valbart', () => {
    const { meals } = planeraVecka(SEED_RECIPES, options())
    expect(bytUtMaltid(meals, meals[0]!.slotId!, [], options())).toBe(meals)
  })
})

describe('valjMaltidFor', () => {
  it('väljer något annat än det som redan ligger på dagen', () => {
    const { meals } = planeraVecka(SEED_RECIPES, options())
    const slotId = meals[2]!.slotId!

    const valt = valjMaltidFor(meals, slotId, SEED_RECIPES, options())

    expect(valt).not.toBeNull()
    expect(valt!.id).not.toBe(meals[2]!.recipe.id)
  })

  it('väljer även för en tom dag', () => {
    const { meals } = planeraVecka(SEED_RECIPES, options())
    const utan = meals.slice(1)

    expect(valjMaltidFor(utan, meals[0]!.slotId!, SEED_RECIPES, options())).not.toBeNull()
  })

  it('svarar null när det inte finns något att välja', () => {
    const { meals } = planeraVecka(SEED_RECIPES, options())
    expect(valjMaltidFor(meals, meals[0]!.slotId!, [], options())).toBeNull()
  })
})
