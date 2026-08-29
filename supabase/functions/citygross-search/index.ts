/**
 * Direktsökning mot City Gross.
 *
 * Appen söker i första hand i den synkade katalogen - den är snabbare, fungerar
 * med dålig täckning och belastar ingen annans servrar. Den här funktionen
 * finns för fallen där kopian inte räcker: en vara som tillkommit sedan senaste
 * nattsynken, eller en produktväljare som inte hittar något rimligt.
 *
 * Den finns som Edge Function och inte i klienten av ett enda skäl: City Gross
 * ska aldrig anropas från någons webbläsare.
 *
 * Kräver inloggning. Träffarna skrivs in i katalogen på vägen ut, så att nästa
 * sökning på samma sak går mot den lokala kopian.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'

// _lib genereras av scripts/prepare-functions.ts ur src/. Redigera aldrig där.
import { CityGrossProvider } from './_lib/citygross.ts'
import type { Product } from './_lib/types.ts'

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  })

/** Så många träffar som mest. Räcker gott för en produktväljare. */
const MAX_TRAFFAR = 30

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

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  if (!serviceKey || !supabaseUrl) return json({ error: 'Funktionen är felkonfigurerad.' }, 500)

  const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Otillåten.' }, 401)

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  // Vem användaren är läses ur JWT:n, aldrig ur anropets kropp.
  const { data: userData, error: userError } = await admin.auth.getUser(token)
  if (userError || !userData.user) return json({ error: 'Otillåten.' }, 401)

  let query = ''
  let storeNumber = ''
  try {
    const body = (await request.json()) as { query?: unknown; storeNumber?: unknown }
    if (typeof body.query === 'string') query = body.query.trim().slice(0, 100)
    // Butiksnumret går rakt in i en URL mot City Gross. Bara siffror släpps in.
    if (typeof body.storeNumber === 'string' && /^\d{3,6}$/.test(body.storeNumber)) {
      storeNumber = body.storeNumber
    }
  } catch {
    return json({ error: 'Ogiltig förfrågan.' }, 400)
  }

  // Ingen standardbutik: priser är butiksspecifika, och en gissning ger
  // sortiment från fel stad.
  if (!storeNumber) return json({ error: 'storeNumber saknas.' }, 400)

  if (query.length < 2) return json({ products: [] })

  try {
    const provider = new CityGrossProvider({ minRequestIntervalMs: 0 })
    const { products } = await provider.searchProducts(query, {
      storeNumber,
      take: MAX_TRAFFAR,
    })

    // Skriv in träffarna i katalogen så att nästa sökning slipper gå ut på nätet.
    if (products.length > 0) {
      await admin.from('products').upsert(products.map(toRow), { onConflict: 'gtin,store_number' })
    }

    return json({ products })
  } catch (error) {
    // Ett misslyckat direktanrop är inte kritiskt - appen har den synkade
    // katalogen att falla tillbaka på. Felet rapporteras rakt, utan gissningar.
    return json({ error: (error as Error).message, products: [] }, 502)
  }
})
