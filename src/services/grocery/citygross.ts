/**
 * City Gross-adapter.
 *
 * Endpoints och fältformat är kartlagda mot www.citygross.se 2026-08-28. Det
 * finns ingen publik dokumentation - se `docs/CITYGROSS-INTEGRATION.md` för hur
 * kartläggningen gjordes och vad som gäller om formatet ändras.
 *
 *   GET /api/v1/sites?siteTypeId=3                          butikslista
 *   GET /api/v1/navigation                                  kategoriträd
 *   GET /api/v1/Loop54/search?searchQuery=&store=           sök
 *   GET /api/v1/Loop54/category/{id}/products?store=        kategorilistning
 *
 * `store` ska vara butiksnumret ("3230" = Sundsvall). Utan det returneras
 * rikspriser och `stockStatus: null` - alltså okänd lagerstatus, vilket är
 * precis den sortens tysta felkälla appen inte får bygga på.
 *
 * Koden här körs i Supabase Edge Functions, aldrig i webbläsaren.
 */

import type { Product, Promotion, SellingUnit } from '../../domain/types.ts'
import { parseDescriptiveSize } from '../../domain/units.ts'
import {
  GroceryProviderError,
  type CategoryNode,
  type GroceryProvider,
  type SearchOptions,
  type SearchResult,
  type Store,
} from './provider.ts'

const BASE_URL = 'https://www.citygross.se'
const IMAGE_BASE = `${BASE_URL}/images/products/`

/** Roten "Matvaror" i kategoriträdet. */
export const FOOD_ROOT_ID = 69

/**
 * Avdelningarna som är värda att synka. Resten av trädet är säsongskampanjer
 * ("Lucia", "Kräftskiva") som pekar på samma varor en gång till.
 */
export const FOOD_DEPARTMENT_IDS = [
  1493, // Kött & fågel
  1448, // Frukt & grönt
  1503, // Mejeri, ost & ägg
  1507, // Skafferiet
  1511, // Fryst
  1502, // Bröd & bageri
  1504, // Chark & pålägg
  1505, // Fisk & skaldjur
  1506, // Kyld färdigmat
  3473, // Vegetariskt
  1510, // Dryck
  23453, // Hushåll
] as const

/** Kampanjsidor som "Veckans fynd" hämtas från. */
export const PROMOTION_CATEGORY_IDS = [
  2930, // Veckans erbjudanden
  25908, // Klipp varje dag
  22193, // Köp fler, spara mer
  23842, // PRIO-priser
] as const

// ── Råformat från City Gross ────────────────────────────────────────────────
// Bara fälten vi faktiskt läser. Allt är valfritt: API:et är odokumenterat och
// får ändras utan att adaptern kraschar.

interface RawPriceDetails {
  price?: number
  unit?: string
  comparativePrice?: number
  comparativePriceUnit?: string
}

interface RawPromotion {
  id?: string
  effectType?: string
  minQuantity?: number
  value?: number
  membersOnly?: boolean
  from?: string
  to?: string
  maxAppliedPerReceipt?: number
  priceDetails?: RawPriceDetails
}

interface RawProduct {
  id?: string
  gtin?: string
  name?: string
  subtitle?: string
  brand?: string | null
  url?: string
  descriptiveSize?: string
  netContent?: { unitOfMeasure?: number; value?: number }
  superCategory?: string
  category?: string
  bfCategory?: string
  bfCategoryCode?: string
  sellingUnitOfMeasure?: number
  images?: { url?: string }[]
  foodAndBeverageExtension?: {
    allergenInformation?: {
      allergens?: { typeCode?: string; levelOfContainment?: number }[] | null
    } | null
  } | null
  productStoreDetails?: {
    id?: string
    stockStatus?: number | null
    prices?: {
      currentPrice?: RawPriceDetails
      ordinaryPrice?: RawPriceDetails
      promotions?: RawPromotion[]
    }
  }
}

// ── Mappning ────────────────────────────────────────────────────────────────

/**
 * `sellingUnitOfMeasure` 1 = styckvara (pris per förpackning),
 * 2 = lösvikt (pris per kilo). Verifierat mot prisfältens `unit`: PCE och KGM.
 */
function toSellingUnit(value: number | undefined): SellingUnit {
  return value === 2 ? 'KGM' : 'PCE'
}

/**
 * Allergener. `null` betyder *okänt*, inte *inga* - fältet är tomt för många
 * varor, och skillnaden är hela poängen med allergihanteringen.
 */
function toAllergens(raw: RawProduct): string[] | null {
  const allergens = raw.foodAndBeverageExtension?.allergenInformation?.allergens
  if (!allergens || allergens.length === 0) return null
  const codes = allergens
    .map((entry) => entry.typeCode)
    .filter((code): code is string => typeof code === 'string' && code.length > 0)
  return codes.length > 0 ? codes : null
}

function toPromotions(raw: RawPromotion[] | undefined): Promotion[] {
  if (!raw) return []
  return raw
    .filter((promotion) => promotion.effectType && promotion.from && promotion.to)
    .map((promotion) => ({
      id: promotion.id ?? '',
      effectType: promotion.effectType as string,
      minQuantity: promotion.minQuantity ?? 1,
      value: promotion.value ?? 0,
      membersOnly: promotion.membersOnly ?? false,
      from: promotion.from as string,
      to: promotion.to as string,
      maxAppliedPerReceipt: promotion.maxAppliedPerReceipt ?? 0,
      ...(promotion.priceDetails?.price !== undefined
        ? { price: promotion.priceDetails.price }
        : {}),
    }))
}

/**
 * Förpackningsstorlek.
 *
 * `netContent.unitOfMeasure` är 0 för *både* gram och milliliter - "390G" och
 * "1,5L" har båda 0. Enumet går alltså inte att lita på. `descriptiveSize` är
 * entydigt och används som primärkälla; netContent.value används bara för att
 * fylla i när texten saknas.
 */
function toNetContent(raw: RawProduct): Product['netContent'] {
  const parsed = parseDescriptiveSize(raw.descriptiveSize ?? '')
  if (parsed) return parsed

  const value = raw.netContent?.value
  if (typeof value === 'number' && value > 0) {
    // Utan enhetsangivelse i texten kan vi inte veta om det är gram eller
    // milliliter. Gram är den överlägset vanligaste torrvaran, men gissningen
    // markeras genom att jämförpriset får avgöra i matchningen.
    return { value, unit: 'g' }
  }
  return null
}

/** Översätter en rå City Gross-produkt till appens form. */
export function mapProduct(raw: RawProduct, storeNumber: string, syncedAt: string): Product | null {
  const gtin = raw.gtin?.trim()
  const name = raw.name?.trim()
  if (!gtin || !name) return null

  const prices = raw.productStoreDetails?.prices
  const ordinary = prices?.ordinaryPrice ?? prices?.currentPrice
  const price = ordinary?.price

  const stockStatus = raw.productStoreDetails?.stockStatus
  const image = raw.images?.[0]?.url

  return {
    gtin,
    externalId: raw.id ?? '',
    name,
    subtitle: raw.subtitle?.trim() ?? '',
    brand: raw.brand?.trim() || null,
    netContent: toNetContent(raw),
    descriptiveSize: raw.descriptiveSize?.trim() ?? '',
    sellingUnit: toSellingUnit(raw.sellingUnitOfMeasure),
    categoryCode: raw.bfCategoryCode ?? null,
    categoryPath: [raw.superCategory, raw.category, raw.bfCategory].filter(
      (part): part is string => typeof part === 'string' && part.length > 0,
    ),
    price: typeof price === 'number' ? price : 0,
    comparativePrice: ordinary?.comparativePrice ?? null,
    comparativePriceUnit: ordinary?.comparativePriceUnit ?? null,
    promotions: toPromotions(prices?.promotions),
    // stockStatus saknas helt när butik inte angetts. Då är svaret okänt.
    inStock: typeof stockStatus === 'number' ? stockStatus > 0 : null,
    imageUrl: image ? `${IMAGE_BASE}${image}` : null,
    productUrl: raw.url ? `${BASE_URL}${raw.url}` : null,
    allergens: toAllergens(raw),
    storeNumber,
    syncedAt,
  }
}

// ── Provider ────────────────────────────────────────────────────────────────

export interface CityGrossOptions {
  /**
   * Identifierar appen mot City Gross. Att gå fram med eget namn är billigt och
   * gör det möjligt för dem att höra av sig i stället för att bara blockera.
   */
  userAgent?: string
  /** Minsta tid mellan anrop, i millisekunder. Håller synken beskedlig. */
  minRequestIntervalMs?: number
  fetchImpl?: typeof fetch
  now?: () => Date
}

export class CityGrossProvider implements GroceryProvider {
  readonly id = 'citygross'

  private readonly fetchImpl: typeof fetch
  private readonly userAgent: string
  private readonly minInterval: number
  private readonly now: () => Date
  private lastRequestAt = 0

  constructor(options: CityGrossOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch
    // Header-värden måste vara latin-1. Ett å här ger 400 från deras edge -
    // verifierat, och en förvånansvärt svårhittad bugg. Håll strängen ASCII.
    this.userAgent = assertAscii(
      options.userAgent ?? 'Middagsdepartementet/1.0 (private household app)',
    )
    this.minInterval = options.minRequestIntervalMs ?? 1000
    this.now = options.now ?? (() => new Date())
  }

  /** Väntar in takten så vi aldrig hamrar på deras servrar. */
  private async throttle(): Promise<void> {
    if (this.minInterval <= 0) return
    const elapsed = Date.now() - this.lastRequestAt
    const wait = this.minInterval - elapsed
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    this.lastRequestAt = Date.now()
  }

  private async getJson<T>(path: string): Promise<T> {
    await this.throttle()
    const url = `${BASE_URL}${path}`

    let response: Response
    try {
      response = await this.fetchImpl(url, {
        headers: { accept: 'application/json', 'user-agent': this.userAgent },
      })
    } catch (cause) {
      throw new GroceryProviderError('City Gross gick inte att nå.', { url, cause })
    }

    if (!response.ok) {
      throw new GroceryProviderError(`City Gross svarade ${response.status}.`, {
        url,
        status: response.status,
      })
    }

    try {
      return (await response.json()) as T
    } catch (cause) {
      throw new GroceryProviderError('City Gross svarade med något som inte är JSON.', {
        url,
        cause,
      })
    }
  }

  async listStores(): Promise<Store[]> {
    const raw = await this.getJson<{ sites?: RawSite[] }>('/api/v1/sites?siteTypeId=3')

    return (raw.sites ?? [])
      .filter((site) => site.storeNumber && site.city)
      .map((site) => ({
        storeNumber: site.storeNumber as string,
        name: site.name ?? `City Gross ${site.city}`,
        city: site.city as string,
        streetAddress: site.streetAddress ?? '',
        zipCode: site.zipcode ?? '',
      }))
  }

  async getStore(city: string): Promise<Store | null> {
    const stores = await this.listStores()
    const target = city.trim().toLowerCase()
    return stores.find((store) => store.city.toLowerCase() === target) ?? null
  }

  async searchProducts(query: string, options: SearchOptions): Promise<SearchResult> {
    const params = new URLSearchParams({
      searchQuery: query,
      store: options.storeNumber,
      skip: String(options.skip ?? 0),
      take: String(options.take ?? 24),
    })
    const raw = await this.getJson<{
      searchResults?: { products?: RawProduct[]; totalCount?: number }
    }>(`/api/v1/Loop54/search?${params}`)

    return this.toResult(raw.searchResults?.products, raw.searchResults?.totalCount, options)
  }

  async listCategoryProducts(categoryId: number, options: SearchOptions): Promise<SearchResult> {
    const params = new URLSearchParams({
      store: options.storeNumber,
      skip: String(options.skip ?? 0),
      take: String(options.take ?? 100),
    })
    const raw = await this.getJson<{ items?: RawProduct[]; totalCount?: number }>(
      `/api/v1/Loop54/category/${categoryId}/products?${params}`,
    )
    return this.toResult(raw.items, raw.totalCount, options)
  }

  async getCategoryTree(): Promise<CategoryNode[]> {
    const raw = await this.getJson<{ data?: { tree?: RawTreeNode | RawTreeNode[] } }>(
      '/api/v1/navigation',
    )
    // `data.tree` är en enda rotnod vars children är sajtens huvudsektioner -
    // inte en array, vilket är lätt att anta fel.
    const tree = raw.data?.tree
    const sections = Array.isArray(tree) ? tree : (tree?.children ?? [])
    const food = sections.find((node) => node.id === FOOD_ROOT_ID)
    return food ? mapTree(food.children ?? []) : []
  }

  private toResult(
    items: RawProduct[] | undefined,
    totalCount: number | undefined,
    options: SearchOptions,
  ): SearchResult {
    const syncedAt = this.now().toISOString()
    const products = (items ?? [])
      .map((item) => mapProduct(item, options.storeNumber, syncedAt))
      .filter((product): product is Product => product !== null)
    return { products, totalCount: totalCount ?? products.length }
  }
}

interface RawSite {
  id?: number
  name?: string
  city?: string
  storeNumber?: string
  streetAddress?: string
  zipcode?: string
}

/**
 * HTTP-headervarden ska vara US-ASCII (RFC 9110). City Gross edge svarar 400 pa
 * allt annat - verifierat med ett svenskt a-ring i user-agent, vilket ar en
 * obehagligt svarhittad bugg. Fangas darfor vid kallan i stallet.
 */
function assertAscii(value: string): string {
  if (/[^ -~]/.test(value)) {
    throw new GroceryProviderError(
      'User-agent maste vara ren ASCII - City Gross svarar 400 pa andra tecken.',
    )
  }
  return value
}

interface RawTreeNode {
  id?: number
  name?: string
  type?: string
  link?: { url?: string }
  children?: RawTreeNode[]
}

/** Plockar ut de noder som faktiskt listar produkter. */
function mapTree(nodes: RawTreeNode[]): CategoryNode[] {
  const result: CategoryNode[] = []
  for (const node of nodes) {
    if (node.type !== 'ProductCategoryPage' || typeof node.id !== 'number') continue
    result.push({
      id: node.id,
      name: node.name ?? '',
      url: node.link?.url ?? '',
      children: mapTree(node.children ?? []),
    })
  }
  return result
}
