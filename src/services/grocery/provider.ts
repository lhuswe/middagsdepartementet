/**
 * Abstraktionen mot en dagligvarukedja.
 *
 * City Gross API är odokumenterat och kan ändras utan förvarning. Hela poängen
 * med det här gränssnittet är att den dagen det gör det — eller den dagen appen
 * ska handla någon annanstans — finns det exakt ett ställe att laga.
 */

import type { Product } from '../../domain/types.ts'

export interface Store {
  /** Butiksnumret som API:et vill ha, t.ex. "3230" för Sundsvall. */
  storeNumber: string
  name: string
  city: string
  streetAddress: string
  zipCode: string
}

export interface SearchOptions {
  storeNumber: string
  skip?: number
  take?: number
}

export interface SearchResult {
  products: Product[]
  totalCount: number
}

export interface CategoryNode {
  id: number
  name: string
  url: string
  children: CategoryNode[]
}

export interface GroceryProvider {
  readonly id: string
  listStores(): Promise<Store[]>
  getStore(city: string): Promise<Store | null>
  searchProducts(query: string, options: SearchOptions): Promise<SearchResult>
  listCategoryProducts(categoryId: number, options: SearchOptions): Promise<SearchResult>
  getCategoryTree(): Promise<CategoryNode[]>
}

/** Fel från en leverantör, med tillräckligt sammanhang för att felsöka. */
export class GroceryProviderError extends Error {
  // Fältet deklareras separat i stället för som parameteregenskap: det senare
  // är TypeScript-syntax som inte går att bara radera, och projektet kör med
  // erasableSyntaxOnly så att filerna fungerar direkt i Node och Deno.
  readonly context: { url?: string; status?: number; cause?: unknown }

  constructor(
    message: string,
    context: { url?: string; status?: number; cause?: unknown } = {},
  ) {
    super(message)
    this.context = context
    this.name = 'GroceryProviderError'
  }
}
