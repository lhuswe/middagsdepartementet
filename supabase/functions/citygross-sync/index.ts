/**
 * Nattlig synk av City Gross sortiment till Postgres.
 *
 * Varför synk och inte live-sök: att slå mot City Gross vid varje inköpslista
 * vore långsamt för användaren, opålitligt utan täckning i butiken, och onödigt
 * belastande för dem. En körning per dygn ger i stället snabb matchning mot
 * lokal data, prishistorik på köpet, och en trafikprofil som är beskedlig.
 *
 * Två sätt att anropa funktionen, båda kontrollerade:
 *
 *   1. Supabase Cron med service role-nyckeln — den schemalagda körningen.
 *   2. En inloggad administratör från "Diagnostik och tillsyn" — knappen som
 *      gör att man kan fylla katalogen första gången utan att hantera hemliga
 *      nycklar för hand.
 *
 * Klientens påstående om vem den är används aldrig: användaren slås upp ur
 * JWT:n och `is_admin` läses ur databasen med service role.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'

// _lib genereras av scripts/prepare-functions.ts ur src/. Redigera aldrig där.
import {
  CityGrossProvider,
  FOOD_DEPARTMENT_IDS,
  PROMOTION_CATEGORY_IDS,
} from './_lib/citygross.ts'
import type { Product } from './_lib/types.ts'

/** Sidstorlek mot City Gross. Större sidor = färre anrop. */
const PAGE_SIZE = 100

/** Skyddsräcke så en trasig paginering inte kan loopa i evighet. */
const MAX_PAGES_PER_CATEGORY = 40

/** Hur många rader som skrivs till Postgres åt gången. */
const UPSERT_BATCH = 500

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  })

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

function toRow(product: Product) {
  return {
    gtin: product.gtin,
    store_number: product.storeNumber,
    external_id: product.externalId,
    name: product.name,
    subtitle: product.subtitle,
    brand: product.brand,
    net_content_value: product.netContent?.value ?? null,
    net_content_unit: product.netContent?.unit ?? null,
    descriptive_size: product.descriptiveSize,
    selling_unit: product.sellingUnit,
    category_code: product.categoryCode,
    category_path: product.categoryPath,
    price: product.price,
    comparative_price: product.comparativePrice,
    comparative_price_unit: product.comparativePriceUnit,
    promotions: product.promotions,
    in_stock: product.inStock,
    image_url: product.imageUrl,
    product_url: product.productUrl,
    allergens: product.allergens,
    synced_at: product.syncedAt,
  }
}

/** En prisobservation per vara och dygn. Ger historik utan extra anrop. */
function toPriceRow(product: Product) {
  return {
    gtin: product.gtin,
    store_number: product.storeNumber,
    price: product.price,
    comparative_price: product.comparativePrice,
    had_promotion: product.promotions.length > 0,
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  if (!serviceKey || !supabaseUrl) {
    return json({ error: 'Funktionen är felkonfigurerad.' }, 500)
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  const authHeader = request.headers.get('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Otillåten.' }, 401)

  // Cron kommer med service role-nyckeln. Allt annat måste vara en admin.
  let arCron = token === serviceKey

  if (!arCron) {
    const { data: userData, error: userError } = await admin.auth.getUser(token)
    if (userError || !userData.user) return json({ error: 'Otillåten.' }, 401)

    const { data: profil } = await admin
      .from('profiles')
      .select('is_admin')
      .eq('id', userData.user.id)
      .maybeSingle()

    if (!profil?.is_admin) return json({ error: 'Behörighet saknas.' }, 403)
  }

  let storeNumber = Deno.env.get('CITYGROSS_STORE_NUMBER') ?? '3230'
  if (!arCron) {
    try {
      const body = (await request.json()) as { storeNumber?: unknown }
      // Bara siffror — butiksnumret går rakt in i en URL mot City Gross.
      if (typeof body.storeNumber === 'string' && /^\d{3,6}$/.test(body.storeNumber)) {
        storeNumber = body.storeNumber
      }
    } catch {
      // Ingen kropp skickad. Använd standardbutiken.
    }
  }

  const { data: run, error: runError } = await admin
    .from('sync_runs')
    .insert({ store_number: storeNumber })
    .select('id')
    .single()

  if (runError) return json({ error: runError.message }, 500)

  let categoriesProcessed = 0
  let productsUpserted = 0
  const failures: string[] = []

  // Kampanjkategorierna läses också, eftersom de innehåller varor som inte
  // nödvändigtvis dyker upp i avdelningslistningarna.
  const categories = [...FOOD_DEPARTMENT_IDS, ...PROMOTION_CATEGORY_IDS]
  const provider = new CityGrossProvider({ minRequestIntervalMs: 1000 })

  try {
    for (const categoryId of categories) {
      const collected = new Map<string, Product>()

      try {
        for (let page = 0; page < MAX_PAGES_PER_CATEGORY; page += 1) {
          const { products, totalCount } = await provider.listCategoryProducts(categoryId, {
            storeNumber,
            skip: page * PAGE_SIZE,
            take: PAGE_SIZE,
          })

          for (const product of products) collected.set(product.gtin, product)

          if (products.length === 0 || (page + 1) * PAGE_SIZE >= totalCount) break
        }
      } catch (error) {
        // En trasig kategori får inte fälla hela synken. Den loggas och
        // körningen fortsätter — halvfärsk data slår ingen data alls.
        failures.push(`Kategori ${categoryId}: ${(error as Error).message}`)
        continue
      }

      const rows = [...collected.values()]
      for (let index = 0; index < rows.length; index += UPSERT_BATCH) {
        const batch = rows.slice(index, index + UPSERT_BATCH)

        const { error: productError } = await admin
          .from('products')
          .upsert(batch.map(toRow), { onConflict: 'gtin,store_number' })
        if (productError) {
          failures.push(`Kategori ${categoryId}: ${productError.message}`)
          continue
        }

        await admin
          .from('product_price_history')
          .upsert(batch.map(toPriceRow), { onConflict: 'gtin,store_number,observed_on' })

        productsUpserted += batch.length
      }

      categoriesProcessed += 1
    }

    const status = failures.length === 0 ? 'success' : 'failed'
    await admin
      .from('sync_runs')
      .update({
        finished_at: new Date().toISOString(),
        status,
        categories_processed: categoriesProcessed,
        products_upserted: productsUpserted,
        error_message: failures.length > 0 ? failures.join('\n') : null,
      })
      .eq('id', run.id)

    return json({ status, storeNumber, categoriesProcessed, productsUpserted, failures })
  } catch (error) {
    const message = (error as Error).message
    await admin
      .from('sync_runs')
      .update({
        finished_at: new Date().toISOString(),
        status: 'failed',
        categories_processed: categoriesProcessed,
        products_upserted: productsUpserted,
        error_message: message,
      })
      .eq('id', run.id)

    return json({ error: message }, 500)
  }
})
