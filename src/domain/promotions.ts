/**
 * Kampanjmodellering.
 *
 * Originalspecen sa "föredra kampanjvaror". Det är naivt på ett sätt som
 * systematiskt underskattar notan: City Gross vanligaste kampanjform är
 * `ItemsTotal` — "3 för 28 kr" — och den gäller *inte* om man köper två.
 *
 * Grundregeln här är att hellre räkna för högt än för lågt. En okänd
 * kampanjtyp ignoreras och ordinarie pris används. Att komma till kassan och
 * bli positivt överraskad är acceptabelt; motsatsen är det inte.
 */

import type { Product, Promotion } from './types.ts'

/** Kampanjtyper vi kan räkna på. Allt annat ignoreras medvetet. */
const KNOWN_EFFECT_TYPES = new Set(['PriceChangeAll', 'ItemsTotal'])

export interface PriceBreakdown {
  /** Vad raden faktiskt kostar. */
  total: number
  /** Vad raden hade kostat utan kampanj. */
  ordinaryTotal: number
  savings: number
  /** Kampanjen som tillämpats, om någon. */
  promotion: Promotion | null
  /** Förklarande text för gränssnittet, t.ex. "3 för 28 kr". */
  note?: string
  /**
   * Sant när en kampanj finns men antalet inte når upp till `minQuantity`.
   * Gränssnittet kan då erbjuda "köp en till så gäller kampanjen".
   */
  promotionUnmet?: boolean
  /** Antal som saknas för att kampanjen ska slå till. */
  missingForPromotion?: number
}

export interface PriceOptions {
  /** Tidpunkt kampanjens giltighet bedöms mot. Default: nu. */
  at?: Date
  /**
   * Om användaren är medlem i City Gross kundklubb. Medlemskampanjer räknas
   * bara när detta är sant — annars vore prisuppskattningen fel för icke-medlem.
   */
  isMember?: boolean
}

/** Är kampanjen giltig vid den givna tidpunkten? */
export function isPromotionActive(promotion: Promotion, at: Date = new Date()): boolean {
  const from = new Date(promotion.from)
  const to = new Date(promotion.to)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return false
  return at >= from && at <= to
}

/** Kampanjer vi både förstår och får tillämpa för den här användaren. */
export function applicablePromotions(
  product: Product,
  options: PriceOptions = {},
): Promotion[] {
  const { at = new Date(), isMember = false } = options
  return product.promotions.filter(
    (promotion) =>
      KNOWN_EFFECT_TYPES.has(promotion.effectType) &&
      isPromotionActive(promotion, at) &&
      (!promotion.membersOnly || isMember),
  )
}

/**
 * Räknar ut vad ett visst antal av en produkt kostar.
 *
 * `quantity` är antal förpackningar för styckvaror (`PCE`) och antal kilo för
 * lösviktsvaror (`KGM`), eftersom det är så City Gross anger priset.
 */
export function calculatePrice(
  product: Product,
  quantity: number,
  options: PriceOptions = {},
): PriceBreakdown {
  const ordinaryTotal = product.price * quantity

  if (quantity <= 0) {
    return { total: 0, ordinaryTotal: 0, savings: 0, promotion: null }
  }

  const candidates = applicablePromotions(product, options)
  if (candidates.length === 0) {
    return { total: ordinaryTotal, ordinaryTotal, savings: 0, promotion: null }
  }

  let best: PriceBreakdown = {
    total: ordinaryTotal,
    ordinaryTotal,
    savings: 0,
    promotion: null,
  }

  for (const promotion of candidates) {
    const candidate = applyPromotion(product, quantity, promotion, ordinaryTotal)
    if (candidate.total < best.total) best = candidate
    // En kampanj som inte nås ska ändå kunna rapporteras uppåt, men den får
    // aldrig ersätta ett faktiskt billigare alternativ.
    else if (candidate.promotionUnmet && !best.promotion && !best.promotionUnmet) {
      best = { ...best, ...pickUnmetFields(candidate) }
    }
  }

  return best
}

function pickUnmetFields(breakdown: PriceBreakdown) {
  return {
    promotionUnmet: breakdown.promotionUnmet,
    missingForPromotion: breakdown.missingForPromotion,
    note: breakdown.note,
  }
}

function applyPromotion(
  product: Product,
  quantity: number,
  promotion: Promotion,
  ordinaryTotal: number,
): PriceBreakdown {
  switch (promotion.effectType) {
    case 'PriceChangeAll': {
      // Rakt nedsatt pris. `minQuantity` är normalt 1, men respekteras.
      if (quantity < promotion.minQuantity) {
        return {
          total: ordinaryTotal,
          ordinaryTotal,
          savings: 0,
          promotion: null,
          promotionUnmet: true,
          missingForPromotion: promotion.minQuantity - quantity,
          note: `${formatKr(promotion.price ?? promotion.value)}/st vid minst ${promotion.minQuantity} st`,
        }
      }
      const unitPrice = promotion.price ?? promotion.value
      const total = unitPrice * quantity
      return {
        total,
        ordinaryTotal,
        savings: ordinaryTotal - total,
        promotion,
        note: `Nedsatt pris ${formatKr(unitPrice)}`,
      }
    }

    case 'ItemsTotal': {
      // "3 för 28 kr". `value` är priset för hela gruppen, inte per styck.
      const groupSize = promotion.minQuantity
      if (groupSize <= 0) {
        return { total: ordinaryTotal, ordinaryTotal, savings: 0, promotion: null }
      }

      if (quantity < groupSize) {
        return {
          total: ordinaryTotal,
          ordinaryTotal,
          savings: 0,
          promotion: null,
          promotionUnmet: true,
          missingForPromotion: groupSize - quantity,
          note: `${groupSize} för ${formatKr(promotion.value)}`,
        }
      }

      const maxGroups =
        promotion.maxAppliedPerReceipt && promotion.maxAppliedPerReceipt > 0
          ? promotion.maxAppliedPerReceipt
          : Number.POSITIVE_INFINITY
      const groups = Math.min(Math.floor(quantity / groupSize), maxGroups)
      const remainder = quantity - groups * groupSize
      const total = groups * promotion.value + remainder * product.price

      return {
        total,
        ordinaryTotal,
        savings: ordinaryTotal - total,
        promotion,
        note: `${groupSize} för ${formatKr(promotion.value)}`,
      }
    }

    default:
      // Okänd kampanjtyp — räkna ordinarie. Underskatta aldrig.
      return { total: ordinaryTotal, ordinaryTotal, savings: 0, promotion: null }
  }
}

/**
 * Effektivt jämförpris med kampanj inräknad, per kilo eller liter.
 * Används för att rangordna förpackningsalternativ mot varandra.
 */
export function effectiveComparativePrice(
  product: Product,
  quantity: number,
  options: PriceOptions = {},
): number | null {
  if (!product.netContent || quantity <= 0) return null
  const { total } = calculatePrice(product, quantity, options)
  const totalBaseUnits = product.netContent.value * quantity
  if (totalBaseUnits <= 0) return null
  // netContent är i gram eller milliliter; jämförpris anges per kilo/liter.
  return (total / totalBaseUnits) * 1000
}

function formatKr(value: number): string {
  return `${value.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`
}
