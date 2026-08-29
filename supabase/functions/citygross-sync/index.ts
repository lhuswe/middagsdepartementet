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
 *   1. Supabase Cron med service role-nyckeln - den schemalagda körningen.
 *   2. En inloggad administratör från "Diagnostik och tillsyn" - knappen som
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

/**
 * Hur länge en körning får stå som pågående innan den räknas som död.
 * En körning tar minuter, inte timmar.
 */
const PAGAENDE_TIMEOUT_MS = 60 * 60 * 1000

/** Butiksnumret går rakt in i en URL mot City Gross. Bara siffror släpps in. */
const GILTIGT_BUTIKSNUMMER = /^\d{3,6}$/

const json = (body: unknown, cors: Record<string, string>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...cors },
  })

/**
 * Tillatna ursprung.
 *
 * Funktionerna kraver en Authorization-header med en anvandares JWT, som en
 * annan webbplats inte kan komma at. CORS ar darfor inte det som skyddar dem.
 * Men en allowlist kostar ingenting och tar bort en klass av misstag, sa den
 * finns anda. Satt TILLATNA_URSPRUNG som secret for att lagga till fler.
 */
const STANDARD_URSPRUNG = [
  'http://localhost:5173',
  'http://localhost:4173',
]

function corsFor(request: Request): Record<string, string> {
  const extra = (Deno.env.get('TILLATNA_URSPRUNG') ?? '')
    .split(',')
    .map((rad) => rad.trim())
    .filter(Boolean)

  const tillatna = [...STANDARD_URSPRUNG, ...extra]
  const ursprung = request.headers.get('Origin') ?? ''

  // github.io-sajter tillats via mönster, sa att repot kan bytas namn utan
  // att funktionen behover deployas om.
  const godkand =
    tillatna.includes(ursprung) || /^https:\/\/[a-z0-9-]+\.github\.io$/i.test(ursprung)

  return {
    'access-control-allow-origin': godkand ? ursprung : STANDARD_URSPRUNG[0],
    'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
    vary: 'Origin',
  }
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

/**
 * Hämtar en butiks hela sortiment och skriver in det i katalogen.
 *
 * En trasig kategori fäller inte körningen. Den loggas och arbetet fortsätter,
 * eftersom halvfärsk data slår ingen data alls.
 */
async function synkaButik(
  admin: ReturnType<typeof createClient>,
  storeNumber: string,
): Promise<ButiksResultat> {
  const { data: run, error: runError } = await admin
    .from('sync_runs')
    .insert({ store_number: storeNumber })
    .select('id')
    .single()

  if (runError) {
    return {
      storeNumber,
      status: 'failed',
      categoriesProcessed: 0,
      productsUpserted: 0,
      failures: [runError.message],
    }
  }

  const provider = new CityGrossProvider({ minRequestIntervalMs: 1000 })
  const categories = [...FOOD_DEPARTMENT_IDS, ...PROMOTION_CATEGORY_IDS]

  let categoriesProcessed = 0
  let productsUpserted = 0
  const failures: string[] = []

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
  } catch (error) {
    failures.push((error as Error).message)
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
    .eq('id', (run as { id: string }).id)

  return { storeNumber, status, categoriesProcessed, productsUpserted, failures }
}

interface ButiksResultat {
  storeNumber: string
  status: string
  categoriesProcessed: number
  productsUpserted: number
  failures: string[]
}

/**
 * Avgör vilka butiker som ska hämtas.
 *
 * En administratör som trycker på knappen anger sin butik. Cron anger ingen,
 * och då hämtas de butiker som faktiskt är valda av något hushåll. Tidigare
 * hämtades alltid en fast butik, vilket innebar att ett hushåll i en annan
 * stad fick en inköpslista helt utan priser utan att någon märkte det.
 */
async function valjButiker(
  admin: ReturnType<typeof createClient>,
  begard: string | null,
): Promise<string[]> {
  if (begard) return [begard]

  const konfigurerad = Deno.env.get('CITYGROSS_STORE_NUMBER')
  if (konfigurerad && GILTIGT_BUTIKSNUMMER.test(konfigurerad)) return [konfigurerad]

  const { data } = await admin
    .from('households')
    .select('store_number')
    .not('store_number', 'is', null)

  const nummer = (data ?? [])
    .map((rad) => (rad as { store_number: string | null }).store_number)
    .filter((nr): nr is string => typeof nr === 'string' && GILTIGT_BUTIKSNUMMER.test(nr))

  return [...new Set(nummer)]
}

Deno.serve(async (request) => {
  const cors = corsFor(request)
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  if (!serviceKey || !supabaseUrl) return json({ error: 'Funktionen är felkonfigurerad.' }, cors, 500)

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Otillåten.' }, cors, 401)

  // Cron kommer med service role-nyckeln. Allt annat måste vara en admin.
  const arCron = token === serviceKey

  if (!arCron) {
    const { data: userData, error: userError } = await admin.auth.getUser(token)
    if (userError || !userData.user) return json({ error: 'Otillåten.' }, cors, 401)

    const { data: profil } = await admin
      .from('profiles')
      .select('is_admin')
      .eq('id', userData.user.id)
      .maybeSingle()

    if (!(profil as { is_admin?: boolean } | null)?.is_admin) {
      return json({ error: 'Behörighet saknas.' }, cors, 403)
    }
  }

  let begard: string | null = null
  try {
    const body = (await request.json()) as { storeNumber?: unknown }
    // Bara siffror: butiksnumret går rakt in i en URL mot City Gross.
    if (typeof body.storeNumber === 'string' && GILTIGT_BUTIKSNUMMER.test(body.storeNumber)) {
      begard = body.storeNumber
    }
  } catch {
    // Ingen kropp skickad.
  }

  const butiker = await valjButiker(admin, begard)
  if (butiker.length === 0) {
    return json(
      {
        error:
          'Ingen butik att hämta. Ange storeNumber, sätt CITYGROSS_STORE_NUMBER, eller välj butik i ett hushåll.',
      },
      cors,
      400,
    )
  }

  /*
   * Vägra starta om en körning redan pågår.
   *
   * Utan spärren kan upprepade klick på knappen starta flera samtidiga
   * hämtningar mot City Gross. Fördröjningen på en sekund mellan anrop gäller
   * per körning, inte mellan körningar, så tre parallella körningar innebär tre
   * gånger så mycket trafik mot någon annans servrar.
   *
   * Tidsgränsen finns för att en körning som dött utan att skriva klart inte
   * ska blockera för alltid.
   */
  const grans = new Date(Date.now() - PAGAENDE_TIMEOUT_MS).toISOString()
  const { data: pagaende } = await admin
    .from('sync_runs')
    .select('store_number')
    .eq('status', 'running')
    .gt('started_at', grans)
    .in('store_number', butiker)

  if (pagaende && pagaende.length > 0) {
    return json(
      {
        error: 'En inhämtning pågår redan för butiken. Vänta tills den är klar.',
        butiker: (pagaende as { store_number: string }[]).map((rad) => rad.store_number),
      },
      cors,
      409,
    )
  }

  const resultat: ButiksResultat[] = []
  for (const storeNumber of butiker) {
    resultat.push(await synkaButik(admin, storeNumber))
  }

  return json({
    status: resultat.every((rad) => rad.status === 'success') ? 'success' : 'failed',
    butiker: butiker.length,
    productsUpserted: resultat.reduce((summa, rad) => summa + rad.productsUpserted, 0),
    // Kvar för adminsidan, som arbetar med en butik i taget.
    storeNumber: butiker[0],
    categoriesProcessed: resultat[0]?.categoriesProcessed ?? 0,
    failures: resultat.flatMap((rad) => rad.failures),
    perButik: resultat,
  }, cors)
})
