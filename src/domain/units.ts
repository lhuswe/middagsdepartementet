/**
 * Enhetskonvertering.
 *
 * Det här är modulen originalspecen saknade, och skälet till att dess eget
 * räkneexempel landade i "0,5 lök". Ett recept säger "3 gula lökar", City Gross
 * säljer "Gul lök 1kg". Utan en styckvikt går de två aldrig att jämföra.
 *
 * Varje omräkning bär med sig hur säker den är. En faktoromräkning (kg→g) är
 * exakt. En styckvikt eller densitet är en uppskattning med ett intervall, och
 * det ska synas i gränssnittet.
 */

import type {
  BaseQuantity,
  BaseUnit,
  Confidence,
  Ingredient,
  Quantity,
  RecipeUnit,
} from './types.ts'

/** Volymenheter → milliliter. Fasta, exakta faktorer. */
const VOLUME_TO_ML: Partial<Record<RecipeUnit, number>> = {
  krm: 1,
  tsk: 5,
  msk: 15,
  ml: 1,
  cl: 10,
  dl: 100,
  l: 1000,
}

/** Massenheter → gram. Fasta, exakta faktorer. */
const MASS_TO_G: Partial<Record<RecipeUnit, number>> = {
  g: 1,
  kg: 1000,
}

/**
 * Enheter som betyder "en förpackning av den storlek butiken råkar sälja".
 * De konverteras aldrig till gram - de går rakt igenom till förpackningsmatten
 * som "köp N stycken av den matchade produkten".
 */
const PACKAGE_UNITS: ReadonlySet<RecipeUnit> = new Set(['förpackning', 'burk', 'pkt'])

/** Enheter som räknas styckvis. "klyfta" är vitlöksklyfta och beter sig som st. */
const PIECE_UNITS: ReadonlySet<RecipeUnit> = new Set(['st', 'klyfta'])

/**
 * En näve är inte en enhet, det är en gest. Används i praktiken bara för örter
 * och bladgrönt, där precisionen ändå inte spelar roll.
 */
const HANDFUL_GRAMS = { grams: 30, min: 15, max: 50 }

/** Relativ osäkerhet i en densitetsomräkning (volym ↔ vikt). */
const DENSITY_TOLERANCE = 0.1

export function isPackageUnit(unit: RecipeUnit): boolean {
  return PACKAGE_UNITS.has(unit)
}

export function isPieceUnit(unit: RecipeUnit): boolean {
  return PIECE_UNITS.has(unit)
}

/** Den svagaste säkerheten i en kedja av omräkningar vinner. */
export function weakestConfidence(...values: Confidence[]): Confidence {
  if (values.includes('unknown')) return 'unknown'
  if (values.includes('estimated')) return 'estimated'
  return 'exact'
}

function unknownQuantity(unit: BaseUnit): BaseQuantity {
  return { value: 0, unit, confidence: 'unknown' }
}

/**
 * Räknar om en receptmängd till ingrediensens kanoniska basenhet.
 *
 * Kanonisk enhet är den ingrediensen naturligt aggregeras i: potatis i gram,
 * grädde i milliliter. Att välja per ingrediens i stället för globalt är det
 * som gör att "5 dl grädde" och "2 dl grädde" kan summeras utan att gå via en
 * densitet som inte behövs.
 *
 * Förpackningsenheter (burk, pkt) kan inte konverteras och returnerar
 * `confidence: 'unknown'` - de hanteras separat i förpackningsmatten.
 */
export function toBase(quantity: Quantity, ingredient: Ingredient): BaseQuantity {
  const target = ingredient.canonicalUnit
  const { value, unit } = quantity

  if (!Number.isFinite(value) || value < 0) return unknownQuantity(target)
  if (isPackageUnit(unit)) return unknownQuantity(target)

  if (unit === 'näve') {
    const grams: BaseQuantity = {
      value: value * HANDFUL_GRAMS.grams,
      unit: 'g',
      confidence: 'estimated',
      range: { min: value * HANDFUL_GRAMS.min, max: value * HANDFUL_GRAMS.max },
    }
    return target === 'g' ? grams : convertBase(grams, 'ml', ingredient)
  }

  if (isPieceUnit(unit)) {
    const piece = ingredient.pieceWeight
    if (!piece) return unknownQuantity(target)
    const grams: BaseQuantity = {
      value: value * piece.grams,
      unit: 'g',
      confidence: 'estimated',
      range: { min: value * piece.min, max: value * piece.max },
    }
    return target === 'g' ? grams : convertBase(grams, 'ml', ingredient)
  }

  const massFactor = MASS_TO_G[unit]
  if (massFactor !== undefined) {
    const grams: BaseQuantity = { value: value * massFactor, unit: 'g', confidence: 'exact' }
    return target === 'g' ? grams : convertBase(grams, 'ml', ingredient)
  }

  const volumeFactor = VOLUME_TO_ML[unit]
  if (volumeFactor !== undefined) {
    const ml: BaseQuantity = { value: value * volumeFactor, unit: 'ml', confidence: 'exact' }
    return target === 'ml' ? ml : convertBase(ml, 'g', ingredient)
  }

  return unknownQuantity(target)
}

/**
 * Konverterar mellan gram och milliliter via ingrediensens densitet.
 *
 * Behövs när receptet mäter i volym men produkten säljs i vikt, eller tvärtom:
 * "5 dl grädde" mot "Vispgrädde 5 dl" är trivialt, men "3 dl vetemjöl" mot
 * "Vetemjöl 2 kg" kräver att vi vet att en deciliter mjöl väger 60 gram.
 */
export function convertBase(
  quantity: BaseQuantity,
  target: BaseUnit,
  ingredient: Ingredient,
): BaseQuantity {
  if (quantity.confidence === 'unknown') return unknownQuantity(target)
  if (quantity.unit === target) return quantity

  // "st" är inte en fysikalisk storhet - den går bara att lämna via styckvikt,
  // vilket toBase() redan har gjort. Hit ska vi aldrig komma med st.
  if (quantity.unit === 'st' || target === 'st') return unknownQuantity(target)

  const gramsPerDl = ingredient.gramsPerDl
  if (gramsPerDl === undefined) return unknownQuantity(target)

  const gramsPerMl = gramsPerDl / 100
  const converted = target === 'g' ? quantity.value * gramsPerMl : quantity.value / gramsPerMl

  return {
    value: converted,
    unit: target,
    confidence: weakestConfidence(quantity.confidence, 'estimated'),
    range: {
      min: converted * (1 - DENSITY_TOLERANCE),
      max: converted * (1 + DENSITY_TOLERANCE),
    },
  }
}

/**
 * Tolkar City Gross `descriptiveSize` till en strukturerad förpackningsstorlek.
 *
 * Nödvändigt eftersom `netContent.unitOfMeasure` är 0 för *både* gram och
 * milliliter - verifierat mot deras API: "390G" och "1,5L" har båda 0. Enumet
 * går alltså inte att lita på, men textsträngen är entydig.
 *
 * Hanterar svenskt decimalkomma ("1,17KG") och cirkavikter ("CA600G").
 * "3-PACK" ignoreras medvetet - totalvikten står redan i storleksangivelsen.
 */
export function parseDescriptiveSize(
  descriptiveSize: string,
): { value: number; unit: 'g' | 'ml' } | null {
  if (!descriptiveSize) return null

  const normalized = descriptiveSize.toUpperCase().replace(/\s+/g, '').replace(',', '.')
  const match = normalized.match(/(\d+(?:\.\d+)?)(KG|G|ML|CL|DL|L)(?![A-Z])/)
  if (!match) return null

  const amount = Number(match[1])
  const unit = match[2]
  if (!Number.isFinite(amount) || amount <= 0 || !unit) return null

  switch (unit) {
    case 'KG':
      return { value: amount * 1000, unit: 'g' }
    case 'G':
      return { value: amount, unit: 'g' }
    case 'L':
      return { value: amount * 1000, unit: 'ml' }
    case 'DL':
      return { value: amount * 100, unit: 'ml' }
    case 'CL':
      return { value: amount * 10, unit: 'ml' }
    case 'ML':
      return { value: amount, unit: 'ml' }
    default:
      return null
  }
}

/**
 * Formaterar en mängd för visning på svenska: 750 g, 1,5 kg, 5 dl, 2 st.
 * Väljer den enhet en människa hade sagt, inte den vi råkar räkna i.
 */
export function formatQuantity(value: number, unit: BaseUnit): string {
  const format = (n: number, decimals: number) =>
    n.toLocaleString('sv-SE', { maximumFractionDigits: decimals })

  if (unit === 'st') return `${format(Math.round(value * 10) / 10, 1)} st`

  if (unit === 'g') {
    if (value >= 1000) return `${format(value / 1000, 2)} kg`
    return `${format(Math.round(value), 0)} g`
  }

  if (value >= 1000) return `${format(value / 1000, 2)} l`
  if (value >= 100 && value % 100 === 0) return `${format(value / 100, 1)} dl`
  return `${format(Math.round(value), 0)} ml`
}
