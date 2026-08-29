/**
 * Databastyper.
 *
 * Handskrivna i stället för genererade, av två skäl: de täcker bara det appen
 * faktiskt använder, och de går att läsa. Kör `supabase gen types typescript`
 * när schemat ändrats mycket och stäm av mot den här filen.
 *
 * OBS: typerna deklareras som `type`, inte `interface`. Supabase-klienten
 * kräver att raderna är tilldelningsbara till `Record<string, unknown>`, och ett
 * interface får ingen implicit indexsignatur — då faller hela schemat tillbaka
 * och varje fråga får typen `never`. Ett svårläst fel med en enkel orsak.
 *
 * Namngivningen är databasens (snake_case). Översättningen till domänens
 * camelCase sker i `src/services/`, inte här — det är gränsen mellan lagren.
 */

export type ShoppingListItemStatus = 'ready' | 'needs-choice' | 'unavailable' | 'unresolved'
export type MatchConfidenceRow = 'confirmed' | 'probable' | 'ambiguous' | 'unavailable' | 'unknown'

export type StoreRow = {
  store_number: string
  name: string
  city: string
  street_address: string
  zip_code: string
}

export type IngredientRow = {
  id: string
  name: string
  canonical_unit: 'g' | 'ml'
  category: string
  staple: boolean
  piece_weight_g: number | null
  piece_weight_min_g: number | null
  piece_weight_max_g: number | null
  grams_per_dl: number | null
}

export type ProductRow = {
  gtin: string
  store_number: string
  external_id: string
  name: string
  subtitle: string
  brand: string | null
  net_content_value: number | null
  net_content_unit: 'g' | 'ml' | null
  descriptive_size: string
  selling_unit: 'PCE' | 'KGM'
  category_code: string | null
  category_path: string[]
  price: number
  comparative_price: number | null
  comparative_price_unit: string | null
  promotions: unknown
  in_stock: boolean | null
  image_url: string | null
  product_url: string | null
  allergens: string[] | null
  synced_at: string
}

export type ProfileRow = {
  id: string
  display_name: string | null
  store_number: string | null
  adults: number
  children: number
  servings_per_meal: number
  max_cooking_minutes: number | null
  weekly_budget: number | null
  allergies: string[]
  dislikes: string[]
  diets: string[]
  is_member: boolean
  assume_staples_available: boolean
  repetition_avoidance: 'low' | 'medium' | 'high'
  is_admin: boolean
  onboarded_at: string | null
  created_at: string
  updated_at: string
}

export type RecipeRow = {
  id: string
  user_id: string
  name: string
  description: string
  servings: number
  prep_minutes: number
  cook_minutes: number
  instructions: string[]
  tags: string[]
  source: string | null
  source_url: string | null
  image_url: string | null
  is_seed: boolean
  created_at: string
  updated_at: string
}

export type RecipeIngredientRow = {
  id: string
  recipe_id: string
  ingredient_id: string
  quantity: number
  unit: string
  optional: boolean
  note: string | null
  sort_order: number
}

export type MealPlanRow = {
  id: string
  user_id: string
  week_start: string
  name: string | null
  created_at: string
  updated_at: string
}

export type MealPlanItemRow = {
  id: string
  meal_plan_id: string
  served_on: string
  meal_type: 'breakfast' | 'lunch' | 'dinner'
  recipe_id: string | null
  servings: number
  note: string | null
}

export type PantryItemRow = {
  id: string
  user_id: string
  ingredient_id: string
  amount: number
  min_stock: number | null
  expires_on: string | null
  updated_at: string
}

export type ShoppingListRow = {
  id: string
  user_id: string
  meal_plan_id: string | null
  name: string
  store_number: string
  status: 'open' | 'done' | 'archived'
  estimated_total: number
  items_without_price: number
  oldest_data_at: string | null
  generated_at: string
  created_at: string
  updated_at: string
}

export type ShoppingListItemRow = {
  id: string
  shopping_list_id: string
  ingredient_id: string | null
  display_name: string
  category: string
  required_amount: number | null
  required_unit: 'g' | 'ml' | 'st' | null
  buy_quantity: number | null
  product_gtin: string | null
  product_snapshot: unknown
  unit_price: number | null
  line_total: number | null
  match_confidence: MatchConfidenceRow | null
  status: ShoppingListItemStatus
  warnings: string[]
  checked: boolean
  checked_at: string | null
  is_manual: boolean
  sort_order: number
}

export type IngredientProductMappingRow = {
  id: string
  user_id: string
  ingredient_id: string
  store_number: string
  gtin: string
  created_at: string
}

export type FavoriteProductRow = IngredientProductMappingRow

export type CookingHistoryRow = {
  id: string
  user_id: string
  recipe_id: string
  cooked_on: string
  servings: number | null
  rating: number | null
  created_at: string
}

export type PriceHistoryRow = {
  id: string
  gtin: string
  store_number: string
  price: number
  comparative_price: number | null
  had_promotion: boolean
  observed_on: string
}

export type FavoriteRecipeRow = {
  user_id: string
  recipe_id: string
  created_at: string
}

export type SyncRunRow = {
  id: string
  store_number: string
  started_at: string
  finished_at: string | null
  status: 'running' | 'success' | 'failed'
  categories_processed: number
  products_upserted: number
  error_message: string | null
}

/**
 * Hjälptyp för insert: ange vilka kolumner som faktiskt måste anges.
 *
 * Resten är antingen genererade (id, tidsstämplar) eller har ett default i
 * schemat, och ska därför vara valfria. Att räkna upp de obligatoriska är
 * kortare och mer ärligt än att räkna upp allt som har ett default.
 */
type InsertOf<T, Obligatoriska extends keyof T> = Pick<T, Obligatoriska> &
  Partial<Omit<T, Obligatoriska>>

/**
 * Främmandenyckel så som PostgREST beskriver den.
 *
 * Måste deklareras för att inbäddade frågor (`select('*, recipe_ingredients(*)')`)
 * ska gå att typa. Utan relationerna svarar typsystemet med
 * "could not find the relation" i stället för raderna.
 */
type Relation<Kolumn extends string, Refererad extends string, RefKolumn extends string> = {
  foreignKeyName: string
  columns: [Kolumn]
  isOneToOne: false
  referencedRelation: Refererad
  referencedColumns: [RefKolumn]
}

type Table<Row, Insert = Row, Rel extends readonly unknown[] = []> = {
  Row: Row
  Insert: Insert
  Update: Partial<Insert>
  Relationships: Rel
}

export type Database = {
  public: {
    Tables: {
      stores: Table<StoreRow, InsertOf<StoreRow, 'store_number' | 'name' | 'city'>>
      ingredients: Table<
        IngredientRow,
        InsertOf<IngredientRow, 'id' | 'name' | 'canonical_unit' | 'category'>
      >
      ingredient_aliases: Table<{ ingredient_id: string; alias: string }>
      products: Table<ProductRow, InsertOf<ProductRow, 'gtin' | 'store_number' | 'name'>>
      product_price_history: Table<
        PriceHistoryRow,
        InsertOf<PriceHistoryRow, 'gtin' | 'store_number' | 'price'>
      >
      sync_runs: Table<SyncRunRow, InsertOf<SyncRunRow, 'store_number'>>
      profiles: Table<ProfileRow, InsertOf<ProfileRow, 'id'>>
      recipes: Table<RecipeRow, InsertOf<RecipeRow, 'user_id' | 'name' | 'servings'>>
      recipe_ingredients: Table<
        RecipeIngredientRow,
        InsertOf<RecipeIngredientRow, 'recipe_id' | 'ingredient_id' | 'quantity' | 'unit'>,
        [Relation<'recipe_id', 'recipes', 'id'>, Relation<'ingredient_id', 'ingredients', 'id'>]
      >
      meal_plans: Table<MealPlanRow, InsertOf<MealPlanRow, 'user_id' | 'week_start'>>
      meal_plan_items: Table<
        MealPlanItemRow,
        InsertOf<MealPlanItemRow, 'meal_plan_id' | 'served_on' | 'servings'>,
        [Relation<'meal_plan_id', 'meal_plans', 'id'>, Relation<'recipe_id', 'recipes', 'id'>]
      >
      pantry_items: Table<
        PantryItemRow,
        InsertOf<PantryItemRow, 'user_id' | 'ingredient_id' | 'amount'>
      >
      shopping_lists: Table<
        ShoppingListRow,
        InsertOf<ShoppingListRow, 'user_id' | 'store_number'>
      >
      shopping_list_items: Table<
        ShoppingListItemRow,
        InsertOf<ShoppingListItemRow, 'shopping_list_id' | 'display_name'>,
        [Relation<'shopping_list_id', 'shopping_lists', 'id'>]
      >
      ingredient_product_mappings: Table<
        IngredientProductMappingRow,
        InsertOf<IngredientProductMappingRow, 'user_id' | 'ingredient_id' | 'store_number' | 'gtin'>
      >
      favorite_products: Table<
        FavoriteProductRow,
        InsertOf<FavoriteProductRow, 'user_id' | 'ingredient_id' | 'store_number' | 'gtin'>
      >
      favorite_recipes: Table<
        FavoriteRecipeRow,
        InsertOf<FavoriteRecipeRow, 'user_id' | 'recipe_id'>
      >
      cooking_history: Table<CookingHistoryRow, InsertOf<CookingHistoryRow, 'user_id' | 'recipe_id'>>
    }
    // `{ [_ in never]: never }` är Supabase egen idiom för ett tomt schemablock.
    // Skriv INTE `Record<string, ...>` här: en indexsignatur gör att varje
    // tabellnamn också tolkas som en vy, vyer saknar `Insert`, och då kollapsar
    // typen för varje insert till `never`. Symptomet ser ut som ett helt annat fel.
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
