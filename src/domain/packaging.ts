/**
 * Förpackningsoptimering — steget där behovet möter verkligheten.
 *
 * Ett recept behöver 750 g köttfärs. Butiken säljer 500 g och 1 kg. Någon måste
 * bestämma vad som faktiskt läggs i vagnen, och göra det så att både överköpet
 * och notan är rimliga.
 *
 * Två grenar, eftersom City Gross säljer på två sätt:
 *
 * - **Styckvara** (`PCE`) — priset gäller per förpackning. Antalet måste bli ett
 *   heltal, och överköp är oundvikligt.
 * - **Lösvikt** (`KGM`) — priset gäller per kilo och mängden är fritt valbar.
 *   Inget överköp uppstår. Originalspecen kände bara till den första grenen.
 */

import { calculatePrice, effectiveComparativePrice, type PriceBreakdown, type PriceOptions } from './promotions.ts'
import type { AggregatedNeed } from './aggregate.ts'
import type { Product } from './types.ts'
import { convertBase } from './units.ts'

/**
 * Överköp över den här andelen av behovet väljs bort så länge det finns ett
 * rimligare alternativ. Att köpa 2 kg när man behöver 600 g är sällan ett fynd,
 * hur bra kilopriset än är.
 */
const MAX_ACCEPTABLE_OVERBUY_RATIO = 0.5

/** Minsta mängd som går att begära i lösviktsdisken, i gram. */
const LOOSE_WEIGHT_STEP_G = 10

/**
 * Hur mycket receptet får överskrida en jämn förpackningsmängd innan vi lägger
 * till ännu en förpackning.
 *
 * Svenska recept säger nästan alltid "400 g krossade tomater", medan burken är
 * 390 g. Utan tolerans blir svaret två burkar för tio grams skull.
 *
 * Toleransen har både en relativ och en absolut gräns, och den absoluta är den
 * som gör jobbet: fem procent av ett kilo köttfärs är 50 gram, vilket är en
 * verklig brist i grytan. Tjugofem gram är det inte.
 */
const PACKAGE_ROUNDING_TOLERANCE = 0.05
const MAX_ABSOLUTE_SHORTFALL = 25

export interface PackagingOption {
  product: Product
  /** Antal förpackningar för `PCE`, antal kilo för `KGM`. */
  quantity: number
  /** Total mängd som köps, i produktens basenhet (g eller ml). */
  purchased: number
  /** Hur mycket mer än behovet man blir tvungen att köpa. */
  overbuy: number
  price: PriceBreakdown
  /** Effektivt jämförpris per kilo eller liter, med kampanj inräknad. */
  comparativePrice: number | null
}

export interface PackagingResult {
  best: PackagingOption | null
  /** Övriga dugliga alternativ, billigast först. Visas i produktväljaren. */
  alternatives: PackagingOption[]
  /** Behovet uttryckt i den enhet produkterna säljs i. */
  requiredAmount: number
  requiredUnit: 'g' | 'ml'
  /** Förklaring när inget alternativ kunde väljas. */
  reason?: string
}

/**
 * Löser upp behovet till en mängd uttryckt i produktens enhet.
 *
 * Här hanteras också receptrader som anges i hela förpackningar ("2 burkar
 * krossade tomater"). De kan inte räknas om förrän vi vet hur stor en burk är i
 * just den här butiken, vilket är exakt varför de sparats till nu.
 *
 * Skafferiavdrag gäller inte förpackningsangivna behov — det är en känd
 * förenkling, dokumenterad i README.
 */
function resolveRequiredAmount(
  need: AggregatedNeed,
  product: Product,
): { amount: number; unit: 'g' | 'ml' } | null {
  const productUnit = product.netContent?.unit
  if (!productUnit) return null

  let base = need.toBuy.value
  let unit = need.toBuy.unit

  if (unit === 'st') return null

  if (unit !== productUnit) {
    const converted = convertBase(
      { value: base, unit, confidence: need.toBuy.confidence },
      productUnit,
      need.ingredient,
    )
    if (converted.confidence === 'unknown') return null
    base = converted.value
    unit = productUnit
  }

  if (need.packageCount > 0 && product.netContent) {
    base += need.packageCount * product.netContent.value
  }

  return { amount: base, unit: productUnit }
}

/** Beräknar ett inköpsalternativ för en enskild kandidatprodukt. */
function buildOption(
  need: AggregatedNeed,
  product: Product,
  options: PriceOptions,
): PackagingOption | null {
  const resolved = resolveRequiredAmount(need, product)
  if (!resolved || resolved.amount <= 0) return null

  if (product.sellingUnit === 'KGM') {
    // Lösvikt: begär exakt den mängd som behövs, avrundat uppåt till närmaste
    // tiotal gram. Inget överköp värt namnet uppstår.
    const grams = Math.ceil(resolved.amount / LOOSE_WEIGHT_STEP_G) * LOOSE_WEIGHT_STEP_G
    const kilos = grams / 1000
    const price = calculatePrice(product, kilos, options)
    return {
      product,
      quantity: kilos,
      purchased: grams,
      overbuy: grams - resolved.amount,
      price,
      comparativePrice: product.price,
    }
  }

  const packSize = product.netContent?.value
  if (!packSize || packSize <= 0) return null

  const allowedShortfall = Math.min(
    resolved.amount * PACKAGE_ROUNDING_TOLERANCE,
    MAX_ABSOLUTE_SHORTFALL,
  )
  const count = Math.max(1, Math.ceil((resolved.amount - allowedShortfall) / packSize))
  const purchased = count * packSize
  const price = calculatePrice(product, count, options)

  return {
    product,
    quantity: count,
    purchased,
    overbuy: purchased - resolved.amount,
    price,
    comparativePrice: effectiveComparativePrice(product, count, options),
  }
}

/**
 * Väljer bästa förpackningsalternativ bland kandidatprodukterna.
 *
 * Alternativ med orimligt överköp sorteras bort först — men bara om något
 * rimligare finns kvar. Bland de återstående vinner lägsta totalpris, med minsta
 * överköp som skiljedomare. Det ger "1 × 1 kg" framför "2 × 500 g" när kilot är
 * billigare, utan att någonsin föreslå ett 2-kilospaket för ett halvkilobehov.
 */
export function selectPackaging(
  need: AggregatedNeed,
  candidates: Product[],
  options: PriceOptions = {},
): PackagingResult {
  const referenceUnit = candidates.find((p) => p.netContent)?.netContent?.unit ?? 'g'
  const requiredAmount = resolveRequiredAmount(need, candidates[0] ?? emptyProbe(referenceUnit))

  if (candidates.length === 0) {
    return {
      best: null,
      alternatives: [],
      requiredAmount: need.toBuy.value,
      requiredUnit: need.toBuy.unit === 'ml' ? 'ml' : 'g',
      reason: 'Ingen matchande produkt hittades.',
    }
  }

  const viable = candidates
    .map((product) => buildOption(need, product, options))
    .filter((option): option is PackagingOption => option !== null)

  if (viable.length === 0) {
    return {
      best: null,
      alternatives: [],
      requiredAmount: requiredAmount?.amount ?? need.toBuy.value,
      requiredUnit: requiredAmount?.unit ?? (need.toBuy.unit === 'ml' ? 'ml' : 'g'),
      reason: 'Behovet gick inte att räkna om till produkternas förpackningsstorlek.',
    }
  }

  const needAmount = requiredAmount?.amount ?? need.toBuy.value

  const byCost = (a: PackagingOption, b: PackagingOption) => {
    const priceDiff = a.price.total - b.price.total
    if (Math.abs(priceDiff) > 0.005) return priceDiff
    return a.overbuy - b.overbuy
  }

  const ranked = [...viable].sort(byCost)
  const reasonable = ranked.filter(
    (option) => Math.max(0, option.overbuy) <= needAmount * MAX_ACCEPTABLE_OVERBUY_RATIO,
  )

  // Förvalet tas bland de rimliga, men *alla* dugliga alternativ följer med —
  // produktväljaren ska kunna erbjuda storpacket åt den som ändå vill ha det.
  const best = reasonable[0] ?? ranked[0] ?? null

  return {
    best,
    alternatives: ranked.filter((option) => option !== best),
    requiredAmount: needAmount,
    requiredUnit: requiredAmount?.unit ?? 'g',
  }
}

/** Minimal platshållare så enhetsupplösningen kan köras utan kandidater. */
function emptyProbe(unit: 'g' | 'ml'): Product {
  return {
    gtin: '',
    externalId: '',
    name: '',
    subtitle: '',
    brand: null,
    netContent: { value: 1, unit },
    descriptiveSize: '',
    sellingUnit: 'PCE',
    categoryCode: null,
    categoryPath: [],
    price: 0,
    comparativePrice: null,
    comparativePriceUnit: null,
    promotions: [],
    inStock: null,
    imageUrl: null,
    productUrl: null,
    allergens: null,
    storeNumber: '',
    syncedAt: '',
  }
}
