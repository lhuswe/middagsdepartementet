/**
 * Domäntyper. Ren TypeScript - inga beroenden på React, Supabase eller nätverk.
 *
 * Hela poängen med det här lagret är att all matte som avgör vad som hamnar i
 * kundvagnen går att testa utan att starta något. Om en siffra är fel ska ett
 * enhetstest säga det, inte en förvånad person i kassan.
 */

/** Enheter som får förekomma i ett recept. */
export type RecipeUnit =
  | 'g'
  | 'kg'
  | 'ml'
  | 'cl'
  | 'dl'
  | 'l'
  | 'tsk'
  | 'msk'
  | 'krm'
  | 'st'
  | 'klyfta'
  | 'näve'
  | 'förpackning'
  | 'burk'
  | 'pkt'

/**
 * Enheter som mängder normaliseras till internt. Allt aggregeras och jämförs i
 * gram eller milliliter; `st` finns kvar som egen bas för sådant som bara är
 * meningsfullt styckvis (ägg, buljongtärningar).
 */
export type BaseUnit = 'g' | 'ml' | 'st'

/**
 * Hur säker en omräkning är.
 *
 * - `exact`     - samma dimension, ren faktor (kg→g, dl→ml)
 * - `estimated` - korsad dimension via styckvikt eller densitet (1 lök → 110 g)
 * - `unknown`   - data saknas, omräkningen gick inte att göra
 *
 * `estimated` och `unknown` måste synas i gränssnittet. Appen får gissa, men
 * aldrig gissa tyst.
 */
export type Confidence = 'exact' | 'estimated' | 'unknown'

/** En mängd så som den står i receptet. */
export interface Quantity {
  value: number
  unit: RecipeUnit
}

/** En mängd normaliserad till basenhet, med spårad osäkerhet. */
export interface BaseQuantity {
  value: number
  unit: BaseUnit
  confidence: Confidence
  /** Rimligt intervall när `confidence` är `estimated`. Saknas vid `exact`. */
  range?: { min: number; max: number }
}

/**
 * En ingrediens i den normaliserade katalogen. `canonicalUnit` avgör vilken
 * basenhet ingrediensen aggregeras i - potatis i gram, grädde i milliliter.
 */
export interface Ingredient {
  id: string
  /** Visningsnamn, gemener: "gul lök" */
  name: string
  /** Alias som ska falla ut på samma ingrediens: ["lök", "lökar"] */
  aliases: string[]
  canonicalUnit: Extract<BaseUnit, 'g' | 'ml'>
  /** Vikt i gram för ett medelstort exemplar, när "st" är meningsfullt. */
  pieceWeight?: { grams: number; min: number; max: number }
  /** Gram per deciliter, för ingredienser som mäts i volym men säljs i vikt. */
  gramsPerDl?: number
  /** Butikskategori för gruppering av inköpslistan. */
  category: ShoppingCategory
  /**
   * Skafferivara som normalt finns hemma. Utesluts från inköpslistan om
   * användaren inte uttryckligen säger att den är slut.
   */
  staple: boolean
}

/** Rubrikerna inköpslistan grupperas under, i den ordning man går i butiken. */
export type ShoppingCategory =
  | 'frukt-gront'
  | 'kott-fagel'
  | 'fisk'
  | 'mejeri-agg'
  | 'chark'
  | 'brod'
  | 'frys'
  | 'skafferi'
  | 'konserver'
  | 'dryck'
  | 'snacks'
  | 'hushall'
  | 'ovrigt'

export const SHOPPING_CATEGORY_LABELS: Record<ShoppingCategory, string> = {
  'frukt-gront': 'Frukt & grönt',
  'kott-fagel': 'Kött & fågel',
  fisk: 'Fisk',
  'mejeri-agg': 'Mejeri & ägg',
  chark: 'Chark & pålägg',
  brod: 'Bröd',
  frys: 'Frys',
  skafferi: 'Skafferi',
  konserver: 'Konserver',
  dryck: 'Dryck',
  snacks: 'Snacks',
  hushall: 'Hushåll',
  ovrigt: 'Övrigt',
}

/** Ordningen inköpslistan renderas i. Följer en normal runda genom butiken. */
export const SHOPPING_CATEGORY_ORDER: ShoppingCategory[] = [
  'frukt-gront',
  'brod',
  'kott-fagel',
  'fisk',
  'chark',
  'mejeri-agg',
  'frys',
  'skafferi',
  'konserver',
  'dryck',
  'snacks',
  'hushall',
  'ovrigt',
]

/** En ingrediensrad i ett recept. */
export interface RecipeIngredient {
  ingredientId: string
  quantity: Quantity
  optional: boolean
  /** Fritext som visas i receptet: "finhackad", "efter smak" */
  note?: string
}

export interface Recipe {
  id: string
  name: string
  description: string
  servings: number
  prepMinutes: number
  cookMinutes: number
  ingredients: RecipeIngredient[]
  instructions: string[]
  tags: string[]
}

/** Hur en vara säljs. Avgör vilken gren av förpackningsmatten som gäller. */
export type SellingUnit =
  /** Styckvara - priset gäller per förpackning. */
  | 'PCE'
  /** Lösvikt - priset gäller per kilo, mängden är fritt valbar. */
  | 'KGM'

export interface Promotion {
  id: string
  /** `PriceChangeAll` = rakt nedsatt pris. `ItemsTotal` = "3 för 28 kr". */
  effectType: string
  /** Antal som krävs för att kampanjen ska gälla. */
  minQuantity: number
  /** Kampanjens värde. Betydelsen beror på `effectType`. */
  value: number
  membersOnly: boolean
  from: string
  to: string
  /** Kampanjpris per enhet, när City Gross anger det. */
  price?: number
  /** Max antal gånger kampanjen får tillämpas per kvitto. 0 = obegränsat. */
  maxAppliedPerReceipt?: number
}

/** En produkt hämtad från City Gross, normaliserad till appens form. */
export interface Product {
  /** EAN - stabil nyckel över tid. */
  gtin: string
  /** City Gross eget id, används för produktlänkar. */
  externalId: string
  name: string
  /** "390G GARANT" */
  subtitle: string
  brand: string | null
  /** Förpackningens innehåll i basenhet. `null` om storleken inte gick att tolka. */
  netContent: { value: number; unit: 'g' | 'ml' } | null
  /** Rå storleksuppgift från City Gross: "1,17KG", "CA600G" */
  descriptiveSize: string
  sellingUnit: SellingUnit
  /** Hierarkisk kategorikod från City Gross, för kategorifiltrering. */
  categoryCode: string | null
  categoryPath: string[]
  /** Ordinarie pris i kronor. Per förpackning (PCE) eller per kilo (KGM). */
  price: number
  /** Jämförpris, färdigberäknat av City Gross. */
  comparativePrice: number | null
  comparativePriceUnit: string | null
  promotions: Promotion[]
  /** `null` när butik inte angavs i anropet - då är lagerstatus okänd. */
  inStock: boolean | null
  imageUrl: string | null
  productUrl: string | null
  /**
   * Allergener enligt City Gross. `null` betyder *okänt*, inte *inga*.
   * Fältet är tomt för de allra flesta produkter.
   */
  allergens: string[] | null
  storeNumber: string
  syncedAt: string
}
