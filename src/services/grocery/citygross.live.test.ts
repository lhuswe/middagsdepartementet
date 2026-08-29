/**
 * Live-test mot riktiga City Gross.
 *
 * Körs ALDRIG i CI och aldrig som del av `npm test`. Syftet är att upptäcka när
 * deras odokumenterade API ändrar format — då slutar de här testerna fungera
 * långt innan användaren märker något konstigt i inköpslistan.
 *
 *   npm run test:live
 *
 * Testerna är medvetet fåtaliga och långsamma (en request i sekunden). De ska
 * ställa frågan "ser formatet likadant ut?", inte belasta någon annans servrar.
 */

import { describe, expect, it } from 'vitest'

import { CityGrossProvider, FOOD_DEPARTMENT_IDS } from './citygross.ts'

const SUNDSVALL = '3230'
const enabled = process.env.CITYGROSS_LIVE === '1'

describe.skipIf(!enabled)('City Gross (live)', () => {
  const provider = new CityGrossProvider()

  it('hittar Sundsvall med butiksnummer 3230', { timeout: 30_000 }, async () => {
    const store = await provider.getStore('Sundsvall')
    expect(store).not.toBeNull()
    expect(store?.storeNumber).toBe(SUNDSVALL)
  })

  it('returnerar butiksspecifika priser och lagerstatus', { timeout: 30_000 }, async () => {
    const { products } = await provider.searchProducts('mellanmjölk', {
      storeNumber: SUNDSVALL,
      take: 5,
    })

    expect(products.length).toBeGreaterThan(0)
    const first = products[0]!
    expect(first.gtin).toMatch(/^\d{8,14}$/)
    expect(first.price).toBeGreaterThan(0)
    expect(first.storeNumber).toBe(SUNDSVALL)
    // Med butik angiven ska lagerstatus vara känd. Är den null har something
    // ändrats i hur `store` tolkas — och då blir hela matchningen otillförlitlig.
    expect(first.inStock).not.toBeNull()
  })

  it('anger förpackningsstorlek i rätt enhet', { timeout: 30_000 }, async () => {
    const { products } = await provider.searchProducts('mellanmjölk', {
      storeNumber: SUNDSVALL,
      take: 10,
    })
    const medStorlek = products.filter((product) => product.netContent !== null)
    expect(medStorlek.length).toBeGreaterThan(0)
    // Mjölk mäts i volym. Får vi gram här har descriptiveSize-tolkningen gått fel.
    expect(medStorlek.some((product) => product.netContent?.unit === 'ml')).toBe(true)
  })

  it('kan lista produkter ur en avdelning', { timeout: 30_000 }, async () => {
    const { products, totalCount } = await provider.listCategoryProducts(
      FOOD_DEPARTMENT_IDS[1], // Frukt & grönt
      { storeNumber: SUNDSVALL, take: 5 },
    )
    expect(products.length).toBeGreaterThan(0)
    expect(totalCount).toBeGreaterThan(products.length)
  })

  it('kan läsa kategoriträdet', { timeout: 30_000 }, async () => {
    const tree = await provider.getCategoryTree()
    expect(tree.length).toBeGreaterThan(5)
    expect(tree.some((node) => node.name.includes('Frukt'))).toBe(true)
  })
})
