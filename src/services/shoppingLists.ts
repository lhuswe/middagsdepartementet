/**
 * Inköpslistor — appens kärnleverans.
 *
 * Genereringen körs i klienten mot den synkade katalogen, inte i en Edge
 * Function. Domänlogiken är ren TypeScript och all data skyddas redan av RLS,
 * så en serverrunda hade bara lagt till latens och ett andra ställe att hålla
 * i synk. City Gross nås fortfarande enbart från servern — via nattsynken.
 *
 * En sparad lista bär med sig en ögonblicksbild av produkt och pris. Utan den
 * skulle nästa nattsynk kunna ändra en lista man redan står och handlar efter.
 */

import {
  buildShoppingList,
  type ShoppingList,
  type ShoppingListItem,
  type ProductLookup,
} from '../domain/shopping-list.ts'
import type { PantryEntry, PlannedMeal } from '../domain/aggregate.ts'
import { aggregateNeeds, needsRequiringPurchase, subtractPantry } from '../domain/aggregate.ts'
import type { Product } from '../domain/types.ts'
import { supabase } from '../lib/supabase.ts'
import type { ProfileRow, ShoppingListItemRow, ShoppingListRow } from '../types/database.ts'
import { hamtaKandidater } from './catalog.ts'

export interface GenereringsResultat {
  lista: ShoppingList
  listId: string
}

/** Användarens sparade produktval och favoriter för butiken. */
async function hamtaMappningar(
  userId: string,
  storeNumber: string,
): Promise<{ sparade: Record<string, string>; favoriter: Record<string, string> }> {
  const [mappningar, favoriter] = await Promise.all([
    supabase
      .from('ingredient_product_mappings')
      .select('ingredient_id, gtin')
      .eq('user_id', userId)
      .eq('store_number', storeNumber),
    supabase
      .from('favorite_products')
      .select('ingredient_id, gtin')
      .eq('user_id', userId)
      .eq('store_number', storeNumber),
  ])

  const tillObjekt = (rader: { ingredient_id: string; gtin: string }[] | null) =>
    Object.fromEntries((rader ?? []).map((rad) => [rad.ingredient_id, rad.gtin]))

  return {
    sparade: tillObjekt(mappningar.data),
    favoriter: tillObjekt(favoriter.data),
  }
}

/**
 * Genererar en inköpslista för veckans måltider och sparar den.
 *
 * Hela kedjan: skala → aggregera → dra av skafferi → matcha → välj förpackning
 * → prissätt → gruppera → spara.
 */
export async function genereraInkopslista(
  userId: string,
  profil: ProfileRow,
  meals: PlannedMeal[],
  skafferi: PantryEntry[],
  options: { mealPlanId?: string | null; namn?: string } = {},
): Promise<GenereringsResultat> {
  const storeNumber = profil.store_number ?? '3230'

  // Vilka ingredienser behöver vi över huvud taget slå upp?
  const behov = needsRequiringPurchase(
    subtractPantry(aggregateNeeds(meals), skafferi, {
      assumeStaplesAvailable: profil.assume_staples_available,
    }),
  ).filter((need) => !need.optionalOnly)

  const [katalog, mappningar] = await Promise.all([
    hamtaKandidater(
      behov.map((need) => need.ingredient),
      storeNumber,
    ),
    hamtaMappningar(userId, storeNumber),
  ])

  const lookup: ProductLookup = (ingredient) => katalog.get(ingredient.id) ?? []

  const lista = buildShoppingList(meals, skafferi, lookup, {
    savedMappings: mappningar.sparade,
    favorites: mappningar.favoriter,
    allergies: profil.allergies ?? [],
    assumeStaplesAvailable: profil.assume_staples_available,
    isMember: profil.is_member,
    at: new Date(),
  })

  const listId = await sparaLista(userId, profil, lista, options)
  return { lista, listId }
}

function tillRad(
  item: ShoppingListItem,
  listId: string,
  sortOrder: number,
): Omit<ShoppingListItemRow, 'id'> {
  const best = item.packaging?.best
  const produkt = best?.product

  return {
    shopping_list_id: listId,
    ingredient_id: item.ingredient.id,
    display_name: item.ingredient.name,
    category: item.ingredient.category,
    required_amount: Math.round(item.need.toBuy.value * 1000) / 1000,
    required_unit: item.need.toBuy.unit,
    buy_quantity: best?.quantity ?? null,
    product_gtin: produkt?.gtin ?? null,
    // Ögonblicksbild: listan får inte ändras under fötterna på en när
    // nattsynken uppdaterar katalogen.
    product_snapshot: produkt
      ? {
          gtin: produkt.gtin,
          name: produkt.name,
          subtitle: produkt.subtitle,
          descriptiveSize: produkt.descriptiveSize,
          sellingUnit: produkt.sellingUnit,
          imageUrl: produkt.imageUrl,
          productUrl: produkt.productUrl,
          price: produkt.price,
          comparativePrice: produkt.comparativePrice,
          syncedAt: produkt.syncedAt,
          promotionNote: best?.price.note ?? null,
          overbuy: best?.overbuy ?? null,
        }
      : null,
    unit_price: produkt?.price ?? null,
    line_total: item.estimatedCost,
    match_confidence: item.match.confidence,
    status: item.status,
    warnings: item.warnings,
    checked: false,
    checked_at: null,
    is_manual: false,
    sort_order: sortOrder,
  }
}

async function sparaLista(
  userId: string,
  profil: ProfileRow,
  lista: ShoppingList,
  options: { mealPlanId?: string | null; namn?: string },
): Promise<string> {
  const { data: listRad, error } = await supabase
    .from('shopping_lists')
    .insert({
      user_id: userId,
      meal_plan_id: options.mealPlanId ?? null,
      name: options.namn ?? 'Inköpslista',
      store_number: profil.store_number ?? '3230',
      estimated_total: Math.round(lista.estimatedTotal * 100) / 100,
      items_without_price: lista.itemsWithoutPrice,
      oldest_data_at: lista.oldestDataAt,
      generated_at: lista.generatedAt,
    })
    .select('id')
    .single()

  if (error) throw error

  let sortOrder = 0
  const rader = lista.groups.flatMap((group) =>
    group.items.map((item) => tillRad(item, listRad.id, sortOrder++)),
  )

  if (rader.length > 0) {
    const { error: radFel } = await supabase.from('shopping_list_items').insert(rader)
    if (radFel) throw radFel
  }

  return listRad.id
}

export interface SparadLista {
  lista: ShoppingListRow
  poster: ShoppingListItemRow[]
}

export async function hamtaLista(listId: string): Promise<SparadLista | null> {
  const { data, error } = await supabase
    .from('shopping_lists')
    .select('*, shopping_list_items(*)')
    .eq('id', listId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const { shopping_list_items: poster, ...lista } = data as ShoppingListRow & {
    shopping_list_items: ShoppingListItemRow[]
  }
  return { lista, poster: (poster ?? []).sort((a, b) => a.sort_order - b.sort_order) }
}

export async function hamtaListor(userId: string, limit = 20): Promise<ShoppingListRow[]> {
  const { data, error } = await supabase
    .from('shopping_lists')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return data ?? []
}

export async function senasteOppnaLista(userId: string): Promise<ShoppingListRow | null> {
  const { data, error } = await supabase
    .from('shopping_lists')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data
}

export async function kryssaPost(postId: string, kryssad: boolean): Promise<void> {
  const { error } = await supabase
    .from('shopping_list_items')
    .update({ checked: kryssad, checked_at: kryssad ? new Date().toISOString() : null })
    .eq('id', postId)

  if (error) throw error
}

export async function aterstallLista(listId: string): Promise<void> {
  const { error } = await supabase
    .from('shopping_list_items')
    .update({ checked: false, checked_at: null })
    .eq('shopping_list_id', listId)

  if (error) throw error
}

export async function laggTillManuellPost(
  listId: string,
  namn: string,
  kategori = 'ovrigt',
): Promise<ShoppingListItemRow> {
  const { data, error } = await supabase
    .from('shopping_list_items')
    .insert({
      shopping_list_id: listId,
      display_name: namn,
      category: kategori,
      is_manual: true,
      status: 'ready',
      sort_order: 9999,
      warnings: [],
      checked: false,
    })
    .select('*')
    .single()

  if (error) throw error
  return data
}

export async function taBortPost(postId: string): Promise<void> {
  const { error } = await supabase.from('shopping_list_items').delete().eq('id', postId)
  if (error) throw error
}

export async function sattListStatus(
  listId: string,
  status: 'open' | 'done' | 'archived',
): Promise<void> {
  const { error } = await supabase.from('shopping_lists').update({ status }).eq('id', listId)
  if (error) throw error
}

/**
 * Sparar användarens produktval för en ingrediens.
 *
 * Det här är mekanismen som gör matchningen bättre över tid. Nästa vecka blir
 * samma ingrediens `confirmed` i stället för att fråga igen.
 */
export async function sparaProduktval(
  userId: string,
  ingredientId: string,
  storeNumber: string,
  gtin: string,
): Promise<void> {
  const { error } = await supabase.from('ingredient_product_mappings').upsert(
    { user_id: userId, ingredient_id: ingredientId, store_number: storeNumber, gtin },
    { onConflict: 'user_id,ingredient_id,store_number' },
  )
  if (error) throw error
}

export async function sparaFavoritprodukt(
  userId: string,
  ingredientId: string,
  storeNumber: string,
  gtin: string,
): Promise<void> {
  const { error } = await supabase.from('favorite_products').upsert(
    { user_id: userId, ingredient_id: ingredientId, store_number: storeNumber, gtin },
    { onConflict: 'user_id,ingredient_id,store_number' },
  )
  if (error) throw error
}

/** Uppdaterar en listpost efter att användaren valt produkt manuellt. */
export async function bytProduktPaPost(
  postId: string,
  produkt: Product,
  antal: number,
  radsumma: number,
): Promise<void> {
  const { error } = await supabase
    .from('shopping_list_items')
    .update({
      product_gtin: produkt.gtin,
      buy_quantity: antal,
      unit_price: produkt.price,
      line_total: Math.round(radsumma * 100) / 100,
      match_confidence: 'confirmed',
      status: 'ready',
      warnings: [],
      product_snapshot: {
        gtin: produkt.gtin,
        name: produkt.name,
        subtitle: produkt.subtitle,
        descriptiveSize: produkt.descriptiveSize,
        sellingUnit: produkt.sellingUnit,
        imageUrl: produkt.imageUrl,
        productUrl: produkt.productUrl,
        price: produkt.price,
        comparativePrice: produkt.comparativePrice,
        syncedAt: produkt.syncedAt,
      },
    })
    .eq('id', postId)

  if (error) throw error
}

/** Räknar om listans totalsumma ur posterna. */
export async function uppdateraSumma(listId: string): Promise<void> {
  const { data } = await supabase
    .from('shopping_list_items')
    .select('line_total')
    .eq('shopping_list_id', listId)

  const poster = data ?? []
  const medPris = poster.filter((post) => post.line_total !== null)
  const summa = medPris.reduce((total, post) => total + Number(post.line_total), 0)

  await supabase
    .from('shopping_lists')
    .update({
      estimated_total: Math.round(summa * 100) / 100,
      items_without_price: poster.length - medPris.length,
    })
    .eq('id', listId)
}
