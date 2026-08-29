import { describe, expect, it, vi } from 'vitest'

import { CityGrossProvider, mapProduct } from './citygross.ts'
import { GroceryProviderError } from './provider.ts'

const SYNCED_AT = '2026-08-28T03:00:00.000Z'

/**
 * Verkliga svarsutdrag från www.citygross.se, hämtade 2026-08-28. Testerna kör
 * mot dem i stället för mot påhittade former — det är det enda sättet att
 * upptäcka att adaptern gör fel antaganden om deras format.
 */
const RAW_KROSSADE_TOMATER = {
  id: '101285406_ST',
  gtin: '7340083469602',
  name: 'Tomater Krossade',
  subtitle: '390G GARANT',
  brand: 'GARANT',
  url: '/matvaror/skafferiet/konserver/tomater-krossade-p101285406_ST',
  descriptiveSize: '390G',
  netContent: { unitOfMeasure: 0, value: 390 },
  superCategory: 'Skafferiet',
  category: 'Konserver',
  bfCategory: 'Tomatkonserver',
  bfCategoryCode: '10183602',
  sellingUnitOfMeasure: 1,
  images: [{ url: 'VI_7340083469602.jpeg' }],
  foodAndBeverageExtension: { allergenInformation: { allergenStatement: null, allergens: null } },
  productStoreDetails: {
    id: '3230',
    stockStatus: 1,
    prices: {
      currentPrice: { price: 10.35, unit: 'PCE', comparativePrice: 26.54, comparativePriceUnit: 'KGM' },
      ordinaryPrice: { price: 10.35, unit: 'PCE', comparativePrice: 26.54, comparativePriceUnit: 'KGM' },
      promotions: [
        {
          id: '1478544,2500295480',
          effectType: 'ItemsTotal',
          minQuantity: 3,
          value: 28,
          membersOnly: false,
          from: '2026-05-04T00:00:00+02:00',
          to: '2026-08-30T23:59:00+02:00',
          maxAppliedPerReceipt: 0,
          priceDetails: { price: 9.33, unit: 'PCE', comparativePrice: 23.92, comparativePriceUnit: 'KGM' },
        },
      ],
    },
  },
}

/** Lösviktsvara: beställs i antal, betalas per kilo. */
const RAW_TOMATER_KVIST = {
  id: '101215340_KG',
  gtin: '2090955500005',
  name: 'Tomater Kvist',
  subtitle: 'CA 160G SVERIGE KLASS 1',
  brand: null,
  descriptiveSize: 'CA 160G',
  netContent: { unitOfMeasure: 0, value: 160 },
  superCategory: 'Frukt & grönt',
  category: 'Grönsaker',
  bfCategory: 'Tomater',
  bfCategoryCode: '03051001',
  sellingUnitOfMeasure: 2,
  productStoreDetails: {
    id: '3230',
    stockStatus: 1,
    prices: {
      ordinaryPrice: { price: 36.95, unit: 'KGM', comparativePrice: 36.95, comparativePriceUnit: 'KGM' },
      promotions: [],
    },
  },
}

/** Mjölk i liter — testar att gram/milliliter inte blandas ihop. */
const RAW_MELLANMJOLK = {
  id: '101233933_ST',
  gtin: '7340083443893',
  name: 'Mellanmjölk Längre Hållbarhet',
  subtitle: '1,5L 1,5% GARANT',
  brand: 'GARANT',
  descriptiveSize: '1,5L',
  netContent: { unitOfMeasure: 0, value: 1500 },
  superCategory: 'Mejeri, ost & ägg',
  category: 'Mjölk',
  sellingUnitOfMeasure: 1,
  foodAndBeverageExtension: {
    allergenInformation: { allergens: [{ levelOfContainment: 0, typeCode: 'Mjölk' }] },
  },
  productStoreDetails: {
    id: '3230',
    stockStatus: 1,
    prices: { ordinaryPrice: { price: 16.5, unit: 'PCE' }, promotions: [] },
  },
}

describe('mapProduct', () => {
  it('mappar en styckvara med kampanj', () => {
    const product = mapProduct(RAW_KROSSADE_TOMATER, '3230', SYNCED_AT)!
    expect(product.gtin).toBe('7340083469602')
    expect(product.sellingUnit).toBe('PCE')
    expect(product.netContent).toEqual({ value: 390, unit: 'g' })
    expect(product.categoryPath).toEqual(['Skafferiet', 'Konserver', 'Tomatkonserver'])
    expect(product.price).toBe(10.35)
    expect(product.comparativePrice).toBe(26.54)
    expect(product.inStock).toBe(true)
    expect(product.promotions).toHaveLength(1)
    expect(product.promotions[0]).toMatchObject({
      effectType: 'ItemsTotal',
      minQuantity: 3,
      value: 28,
      price: 9.33,
    })
  })

  it('känner igen lösviktsvaror', () => {
    const product = mapProduct(RAW_TOMATER_KVIST, '3230', SYNCED_AT)!
    expect(product.sellingUnit).toBe('KGM')
    expect(product.price).toBe(36.95)
  })

  // unitOfMeasure är 0 för både "390G" och "1,5L". Enumet är oanvändbart —
  // det är descriptiveSize som avgör.
  it('skiljer liter från gram trots att enum-fältet är identiskt', () => {
    const mjolk = mapProduct(RAW_MELLANMJOLK, '3230', SYNCED_AT)!
    const tomater = mapProduct(RAW_KROSSADE_TOMATER, '3230', SYNCED_AT)!
    expect(RAW_MELLANMJOLK.netContent.unitOfMeasure).toBe(
      RAW_KROSSADE_TOMATER.netContent.unitOfMeasure,
    )
    expect(mjolk.netContent).toEqual({ value: 1500, unit: 'ml' })
    expect(tomater.netContent).toEqual({ value: 390, unit: 'g' })
  })

  it('läser allergener när de finns', () => {
    expect(mapProduct(RAW_MELLANMJOLK, '3230', SYNCED_AT)!.allergens).toEqual(['Mjölk'])
  })

  // Tystnad betyder okänt, aldrig "fri från".
  it('ger null för allergener när fältet är tomt', () => {
    expect(mapProduct(RAW_KROSSADE_TOMATER, '3230', SYNCED_AT)!.allergens).toBeNull()
  })

  it('ger okänd lagerstatus när butik inte angetts', () => {
    const utanButik = {
      ...RAW_KROSSADE_TOMATER,
      productStoreDetails: { ...RAW_KROSSADE_TOMATER.productStoreDetails, stockStatus: null },
    }
    expect(mapProduct(utanButik, '1', SYNCED_AT)!.inStock).toBeNull()
  })

  it('bygger fullständiga bild- och produktlänkar', () => {
    const product = mapProduct(RAW_KROSSADE_TOMATER, '3230', SYNCED_AT)!
    expect(product.imageUrl).toBe('https://www.citygross.se/images/products/VI_7340083469602.jpeg')
    expect(product.productUrl).toContain('https://www.citygross.se/matvaror/')
  })

  it('kastar bort produkter utan GTIN eller namn i stället för att hitta på', () => {
    expect(mapProduct({ name: 'Namnlös' }, '3230', SYNCED_AT)).toBeNull()
    expect(mapProduct({ gtin: '123' }, '3230', SYNCED_AT)).toBeNull()
  })

  it('överlever fält som saknas helt', () => {
    const product = mapProduct({ gtin: '123', name: 'Mystisk vara' }, '3230', SYNCED_AT)!
    expect(product.price).toBe(0)
    expect(product.netContent).toBeNull()
    expect(product.promotions).toEqual([])
    expect(product.inStock).toBeNull()
  })
})

describe('CityGrossProvider', () => {
  function providerWith(handler: (url: string) => unknown, status = 200) {
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      new Response(JSON.stringify(handler(String(url))), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch

    return {
      fetchImpl,
      provider: new CityGrossProvider({
        fetchImpl,
        minRequestIntervalMs: 0,
        now: () => new Date(SYNCED_AT),
      }),
    }
  }

  it('hittar Sundsvall och dess butiksnummer', async () => {
    // Svaret är inslaget i { sites: [...] }, inte en naken array.
    const { provider } = providerWith(() => ({
      sites: [
        { id: 21, name: 'City Gross Borås', city: 'Borås', storeNumber: '3204' },
        {
          id: 36,
          name: 'City Gross Sundsvall',
          city: 'Sundsvall',
          storeNumber: '3230',
          streetAddress: 'Norra vägen 10',
          zipcode: '85009',
        },
      ],
    }))

    const store = await provider.getStore('Sundsvall')
    expect(store?.storeNumber).toBe('3230')
    expect(store?.streetAddress).toBe('Norra vägen 10')
  })

  it('skickar alltid med butiksnumret i sökningen', async () => {
    const { provider, fetchImpl } = providerWith(() => ({
      searchResults: { products: [RAW_KROSSADE_TOMATER], totalCount: 1 },
    }))

    const result = await provider.searchProducts('krossade tomater', { storeNumber: '3230' })
    expect(result.products).toHaveLength(1)
    expect(result.totalCount).toBe(1)

    const [calledUrl] = vi.mocked(fetchImpl).mock.calls[0]!
    expect(String(calledUrl)).toContain('store=3230')
    expect(String(calledUrl)).toContain('searchQuery=krossade+tomater')
  })

  it('identifierar sig med en egen user-agent', async () => {
    const { provider, fetchImpl } = providerWith(() => ({ searchResults: { products: [] } }))
    await provider.searchProducts('mjölk', { storeNumber: '3230' })

    const [, init] = vi.mocked(fetchImpl).mock.calls[0]!
    const headers = (init?.headers ?? {}) as Record<string, string>
    expect(headers['user-agent']).toContain('Middagsdepartementet')
  })

  // Verifierat mot produktion: ett å i user-agent ger 400 från City Gross edge.
  // Felet är omöjligt att gissa sig till, så det fångas vid källan i stället.
  it.each([
    ['ett svenskt å', 'Middagsdepartementet (hushållsapp)'],
    ['en emoji', 'Middagsdepartementet 🍲'],
  ])('vägrar en user-agent med %s', (_namn, userAgent) => {
    // 'å' ligger i latin-1 men inte i ASCII, och det var precis det tecknet som
    // gav 400 mot produktion. Guarden måste vara ASCII, inte latin-1.
    expect(() => new CityGrossProvider({ userAgent })).toThrow(/ASCII/)
  })

  it('standard-user-agent är ren ASCII', () => {
    const fetchImpl = vi.fn(async () => new Response('{}')) as unknown as typeof fetch
    expect(() => new CityGrossProvider({ fetchImpl })).not.toThrow()
  })

  it('plockar ut produktkategorier ur navigationsträdet', async () => {
    // data.tree är en enda rotnod vars children är huvudsektionerna.
    const { provider } = providerWith(() => ({
      data: {
        tree: {
          id: 1,
          name: 'root',
          children: [
          {
            id: 69,
            name: 'Matvaror',
            children: [
              { id: 4508, name: 'Mina favoritvaror', type: 'ContentForCategoryPage' },
              {
                id: 1448,
                name: 'Frukt & grönt',
                type: 'ProductCategoryPage',
                link: { url: '/matvaror/frukt-och-gront' },
                children: [
                  { id: 1449, name: 'Grönsaker', type: 'ProductCategoryPage', children: [] },
                ],
              },
            ],
          },
          ],
        },
      },
    }))

    const tree = await provider.getCategoryTree()
    expect(tree).toHaveLength(1)
    expect(tree[0]?.name).toBe('Frukt & grönt')
    expect(tree[0]?.children[0]?.name).toBe('Grönsaker')
  })

  it('ger ett begripligt fel när City Gross svarar med en felkod', async () => {
    const { provider } = providerWith(() => ({}), 503)
    await expect(provider.searchProducts('mjölk', { storeNumber: '3230' })).rejects.toThrow(
      GroceryProviderError,
    )
  })

  it('ger ett begripligt fel när nätverket fallerar', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET')
    }) as unknown as typeof fetch
    const provider = new CityGrossProvider({ fetchImpl, minRequestIntervalMs: 0 })

    await expect(provider.searchProducts('mjölk', { storeNumber: '3230' })).rejects.toThrow(
      'City Gross gick inte att nå.',
    )
  })
})
