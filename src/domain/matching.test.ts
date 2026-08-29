import { describe, expect, it } from 'vitest'

import { makeProduct } from './fixtures.ts'
import { getIngredient } from './ingredients.ts'
import { matchIngredient, scoreProduct, searchTermsFor, MATCH_RULES } from './matching.ts'
import type { Ingredient } from './types.ts'

function ingredient(id: string): Ingredient {
  const found = getIngredient(id)
  if (!found) throw new Error(`Okänd ingrediens i test: ${id}`)
  return found
}

const mellanmjolk = makeProduct({
  name: 'Mellanmjölk',
  subtitle: '1,5L 1,5% ARLA KO',
  descriptiveSize: '1,5L',
  categoryPath: ['Mejeri, ost & ägg', 'Mjölk', 'Mellanmjölk'],
  price: 17.25,
})

const chokladmjolk = makeProduct({
  name: 'Chokladmjölk',
  subtitle: '1L COCIO',
  descriptiveSize: '1L',
  categoryPath: ['Dryck', 'Mjölkdryck'],
  price: 22,
})

const vispgradde = makeProduct({
  name: 'Vispgrädde',
  subtitle: '5DL 40% ARLA',
  descriptiveSize: '5DL',
  categoryPath: ['Mejeri, ost & ägg', 'Grädde'],
  price: 29.9,
})

const graddfil = makeProduct({
  name: 'Gräddfil',
  subtitle: '5DL 12% ARLA',
  descriptiveSize: '5DL',
  categoryPath: ['Mejeri, ost & ägg', 'Grädde'],
  price: 19.9,
})

describe('matchIngredient — specens egna fällor', () => {
  // Originalspecen pekade ut båda de här fallen som saker som inte får hända,
  // men bad samtidigt om textlikhetsmatchning, som gör exakt de felen.
  it('matchar mjölk mot mellanmjölk och aldrig mot chokladmjölk', () => {
    const result = matchIngredient(ingredient('mjolk'), [chokladmjolk, mellanmjolk])
    expect(result.best?.name).toBe('Mellanmjölk')
    expect(result.candidates.map((c) => c.product.name)).not.toContain('Chokladmjölk')
  })

  it('matchar grädde mot vispgrädde och aldrig mot gräddfil', () => {
    const result = matchIngredient(ingredient('vispgradde'), [graddfil, vispgradde])
    expect(result.best?.name).toBe('Vispgrädde')
    expect(result.candidates.map((c) => c.product.name)).not.toContain('Gräddfil')
  })

  it('matchar gräddfil mot gräddfil när det faktiskt är det som efterfrågas', () => {
    const result = matchIngredient(ingredient('graddfil'), [graddfil, vispgradde])
    expect(result.best?.name).toBe('Gräddfil')
  })
})

describe('matchIngredient — säkerhetsnivåer', () => {
  const tomater400 = makeProduct({
    name: 'Tomater Krossade',
    subtitle: '390G GARANT',
    descriptiveSize: '390G',
    categoryPath: ['Skafferiet', 'Konserver', 'Tomatkonserver'],
    price: 10.35,
  })
  const tomater500 = makeProduct({
    name: 'Tomater Krossade',
    subtitle: '500G ZETA',
    descriptiveSize: '500G',
    categoryPath: ['Skafferiet', 'Konserver', 'Tomatkonserver'],
    price: 13,
  })

  it('behandlar två storlekar av samma vara som ett prisbeslut, inte en fråga', () => {
    const result = matchIngredient(ingredient('krossade_tomater'), [tomater400, tomater500])
    expect(result.confidence).toBe('probable')
    expect(result.best).not.toBeNull()
    expect(result.candidates).toHaveLength(2)
  })

  it('väljer utan att fråga när toppkandidaten är tydligt rätt', () => {
    // Med skarp data finns det alltid tre snarlika burkar. Att fråga varje gång
    // vore att flytta jobbet till användaren i stället för att göra det.
    const medVitlok = makeProduct({
      name: 'Krossade Tomater Vitlök',
      subtitle: '390G GARANT',
      descriptiveSize: '390G',
      categoryPath: ['Skafferiet', 'Konserver', 'Tomatkonserver'],
      price: 10.35,
    })
    const result = matchIngredient(ingredient('krossade_tomater'), [tomater400, medVitlok])
    expect(result.confidence).toBe('probable')
    expect(result.best?.name).toBe('Tomater Krossade')
  })

  it('säger ambiguous när ingen kandidat är övertygande', () => {
    // Fel kategori drar ner båda till en nivå där ingen förtjänar förtroendet,
    // och de är olika sorters vara. Då ska en människa avgöra.
    const iFelKategori = (name: string) =>
      makeProduct({
        name,
        subtitle: '390G',
        descriptiveSize: '390G',
        categoryPath: ['Skafferiet', 'Övrigt'],
        price: 10.35,
      })
    const result = matchIngredient(ingredient('krossade_tomater'), [
      iFelKategori('Tomater Krossade'),
      iFelKategori('Krossade Tomater Vitlök'),
    ])
    expect(result.confidence).toBe('ambiguous')
    expect(result.best).toBeNull()
    expect(result.note).toContain('manuell handläggning')
  })

  // Upptäckt mot skarp data: sökningen på "nötfärs" gav "Nötfärs i Sås För
  // Kastrerad Katt". Textlikheten var utmärkt. Kategorin var kattmat.
  it('matchar aldrig mot djurmat, hur bra namnet än stämmer', () => {
    const kattmat = makeProduct({
      name: 'Nötfärs i Sås För Kastrerad Katt',
      subtitle: '370G',
      descriptiveSize: '370G',
      categoryPath: ['Husdjur', 'Katt', 'Våtfoder'],
      price: 14.95,
    })
    const result = matchIngredient(ingredient('blandfars'), [kattmat])
    expect(result.candidates).toHaveLength(0)
    expect(result.best).toBeNull()
    expect(result.confidence).toBe('unavailable')
  })

  it('låter en sparad mappning bli confirmed', () => {
    const result = matchIngredient(
      ingredient('krossade_tomater'),
      [tomater400, tomater500],
      { savedGtin: tomater500.gtin },
    )
    expect(result.confidence).toBe('confirmed')
    expect(result.best?.gtin).toBe(tomater500.gtin)
  })

  it('låter en favoritprodukt bli confirmed', () => {
    const result = matchIngredient(ingredient('mjolk'), [mellanmjolk], {
      favoriteGtin: mellanmjolk.gtin,
    })
    expect(result.confidence).toBe('confirmed')
    expect(result.note).toContain('favoritprodukt')
  })

  it('säger unavailable när allt matchande är slut i butiken', () => {
    const slut = makeProduct({
      name: 'Tomater Krossade',
      subtitle: '390G GARANT',
      descriptiveSize: '390G',
      categoryPath: ['Skafferiet', 'Konserver', 'Tomatkonserver'],
      inStock: false,
    })
    const result = matchIngredient(ingredient('krossade_tomater'), [slut])
    expect(result.confidence).toBe('unavailable')
    expect(result.best).toBeNull()
  })

  it('säger unavailable när ingenting alls matchade', () => {
    const result = matchIngredient(ingredient('krossade_tomater'), [])
    expect(result.confidence).toBe('unavailable')
    expect(result.best).toBeNull()
  })

  it('säger probable när en kandidat vinner klart', () => {
    const result = matchIngredient(ingredient('mjolk'), [mellanmjolk, chokladmjolk])
    expect(result.confidence).toBe('probable')
  })
})

describe('scoreProduct', () => {
  it('diskvalificerar på exkluderingsmönster', () => {
    expect(scoreProduct(chokladmjolk, ingredient('mjolk'), MATCH_RULES.mjolk)).toBeNull()
  })

  it('straffar produkter som är slut', () => {
    const slut = makeProduct({ ...mellanmjolk, name: 'Mellanmjölk', inStock: false })
    const iLager = scoreProduct(mellanmjolk, ingredient('mjolk'), MATCH_RULES.mjolk)
    const slutISkyltl = scoreProduct(slut, ingredient('mjolk'), MATCH_RULES.mjolk)
    expect(slutISkyltl!.score).toBeLessThan(iLager!.score)
    expect(slutISkyltl!.reasons).toContain('slut i butiken')
  })

  it('straffar fel förpackningsenhet', () => {
    const iGram = makeProduct({
      name: 'Mellanmjölk',
      subtitle: '500G PULVER',
      descriptiveSize: '500G',
      categoryPath: ['Mejeri, ost & ägg', 'Mjölk'],
    })
    const scored = scoreProduct(iGram, ingredient('mjolk'), MATCH_RULES.mjolk)
    expect(scored!.reasons).toContain('oväntad förpackningsenhet')
  })

  it('förklarar varför en produkt fick sin poäng', () => {
    const scored = scoreProduct(mellanmjolk, ingredient('mjolk'), MATCH_RULES.mjolk)
    expect(scored!.reasons).toContain('rätt kategori')
    expect(scored!.score).toBeGreaterThan(30)
  })
})

describe('searchTermsFor', () => {
  it('använder kurerade söktermer när de finns', () => {
    expect(searchTermsFor(ingredient('mjolk'))).toContain('mellanmjölk')
  })

  it('faller tillbaka på ingrediensnamnet', () => {
    expect(searchTermsFor(ingredient('bacon'))).toEqual(['bacon'])
  })
})
