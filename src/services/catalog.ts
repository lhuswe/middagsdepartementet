/**
 * Produktkatalogen, läst ur Postgres.
 *
 * Appen slår aldrig mot City Gross direkt från webbläsaren. Katalogen synkas
 * nattligen av en Edge Function, och det här lagret läser den kopian. Det gör
 * matchningen snabb, fungerar med dålig täckning i butiken, och håller
 * trafiken mot City Gross på en nivå som är rimlig för en privat app.
 */

import { searchTermsFor } from '../domain/matching.ts'
import type { Ingredient, Product, Promotion } from '../domain/types.ts'
import { supabase } from '../lib/supabase.ts'
import type { ProductRow } from '../types/database.ts'

/** Antal kandidater per ingrediens. Fler ger bättre prisjämförelse, men tyngre svar. */
const KANDIDATER_PER_INGREDIENS = 25

export function toProduct(row: ProductRow): Product {
  return {
    gtin: row.gtin,
    externalId: row.external_id,
    name: row.name,
    subtitle: row.subtitle,
    brand: row.brand,
    netContent:
      row.net_content_value !== null && row.net_content_unit !== null
        ? { value: Number(row.net_content_value), unit: row.net_content_unit }
        : null,
    descriptiveSize: row.descriptive_size,
    sellingUnit: row.selling_unit,
    categoryCode: row.category_code,
    categoryPath: row.category_path ?? [],
    price: Number(row.price),
    comparativePrice: row.comparative_price === null ? null : Number(row.comparative_price),
    comparativePriceUnit: row.comparative_price_unit,
    promotions: Array.isArray(row.promotions) ? (row.promotions as Promotion[]) : [],
    inStock: row.in_stock,
    imageUrl: row.image_url,
    productUrl: row.product_url,
    allergens: row.allergens,
    storeNumber: row.store_number,
    syncedAt: row.synced_at,
  }
}

/**
 * Hämtar kandidatprodukter för en uppsättning ingredienser.
 *
 * Matchningen sker i domänlagret, inte i SQL — här görs bara en bred
 * fritextsökning som drar hem tillräckligt att välja bland. Att lägga
 * matchningsreglerna i databasen hade gjort dem omöjliga att enhetstesta.
 */
export async function hamtaKandidater(
  ingredients: Ingredient[],
  storeNumber: string,
): Promise<Map<string, Product[]>> {
  const resultat = new Map<string, Product[]>()
  if (ingredients.length === 0) return resultat

  await Promise.all(
    ingredients.map(async (ingredient) => {
      const termer = searchTermsFor(ingredient)
      const funna = new Map<string, Product>()

      for (const term of termer) {
        const { data, error } = await supabase
          .from('products')
          .select('*')
          .eq('store_number', storeNumber)
          .textSearch('name', term.split(/\s+/).join(' & '), {
            type: 'plain',
            config: 'swedish',
          })
          .limit(KANDIDATER_PER_INGREDIENS)

        if (error) {
          // Fritextsökning kan falla på udda tecken. Fall tillbaka på enkel
          // namnmatchning hellre än att lämna ingrediensen utan kandidater.
          const { data: fallback } = await supabase
            .from('products')
            .select('*')
            .eq('store_number', storeNumber)
            .ilike('name', `%${term}%`)
            .limit(KANDIDATER_PER_INGREDIENS)
          for (const row of fallback ?? []) funna.set(row.gtin, toProduct(row))
          continue
        }

        for (const row of data ?? []) funna.set(row.gtin, toProduct(row))
      }

      resultat.set(ingredient.id, [...funna.values()])
    }),
  )

  return resultat
}

/** Fritextsökning för produktväljaren. */
export async function sokProdukter(
  query: string,
  storeNumber: string,
  limit = 30,
): Promise<Product[]> {
  const term = query.trim()
  if (term.length < 2) return []

  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('store_number', storeNumber)
    .ilike('name', `%${term}%`)
    .order('name')
    .limit(limit)

  if (error) throw error
  return (data ?? []).map(toProduct)
}

/** Produkter med aktiv kampanj — underlaget till "Veckans fynd". */
export async function hamtaErbjudanden(storeNumber: string, limit = 60): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('store_number', storeNumber)
    .not('promotions', 'eq', '[]')
    .limit(limit * 3)

  if (error) throw error

  const nu = new Date()
  return (data ?? [])
    .map(toProduct)
    .filter((product) =>
      product.promotions.some((promotion) => {
        const from = new Date(promotion.from)
        const to = new Date(promotion.to)
        return !Number.isNaN(from.getTime()) && nu >= from && nu <= to
      }),
    )
    .sort((a, b) => besparing(b) - besparing(a))
    .slice(0, limit)
}

function besparing(product: Product): number {
  const kampanj = product.promotions[0]
  if (!kampanj?.price) return 0
  return Math.max(0, product.price - kampanj.price)
}

/** När katalogen senast uppdaterades. Visas alltid tillsammans med priser. */
export async function senasteSynk(storeNumber: string): Promise<string | null> {
  const { data } = await supabase
    .from('products')
    .select('synced_at')
    .eq('store_number', storeNumber)
    .order('synced_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return data?.synced_at ?? null
}

/** Antal produkter i katalogen för butiken. */
export async function antalProdukter(storeNumber: string): Promise<number> {
  const { count } = await supabase
    .from('products')
    .select('gtin', { count: 'exact', head: true })
    .eq('store_number', storeNumber)

  return count ?? 0
}
