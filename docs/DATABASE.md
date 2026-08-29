# Databasen

Postgres via Supabase. Migrationerna i `supabase/migrations/` är sanningskällan;
det här dokumentet förklarar varför schemat ser ut som det gör.

---

## Två sorters tabeller

| Referensdata | Användardata |
|---|---|
| `stores` | `profiles` |
| `ingredients` | `recipes`, `recipe_ingredients` |
| `ingredient_aliases` | `meal_plans`, `meal_plan_items` |
| `products` | `pantry_items` |
| `product_price_history` | `shopping_lists`, `shopping_list_items` |
| `sync_runs` | `ingredient_product_mappings`, `favorite_products` |
| | `favorite_recipes`, `cooking_history` |

Referensdata är gemensam och skrivs bara av synkjobbet. Användardata är privat.
Rättigheterna beskrivs i [SECURITY.md](SECURITY.md).

---

## Val värda att förklara

### `products` har sammansatt nyckel `(gtin, store_number)`

Priser och lagerstatus skiljer sig mellan butiker, så samma vara finns som flera
rader. `gtin` (EAN) är den stabila nyckeln över tid - City Gross egna `id`
innehåller ett suffix för säljenhet (`_ST`, `_KG`).

### `net_content_value` + `net_content_unit` i stället för deras enum

City Gross `netContent.unitOfMeasure` är `0` för både gram och milliliter.
Storleken tolkas därför ur textsträngen `descriptive_size` innan den skrivs, och
enheten sparas explicit. Se
[CITYGROSS-INTEGRATION.md](CITYGROSS-INTEGRATION.md).

### `in_stock` och `allergens` får vara `null`

I båda fallen betyder `null` **okänt** - inte "slut" respektive "fri från".
Skillnaden är hela poängen med hur appen kommunicerar osäkerhet, och den finns
dokumenterad som kommentar på kolumnerna.

### Styckvikter och densiteter på `ingredients`

`piece_weight_g` med `min`/`max`, och `grams_per_dl`. Det är det enda sättet att
jämföra "3 gula lökar" med "Gul lök 1kg", eller "3 dl vetemjöl" med "Vetemjöl
2kg".

Två villkor skyddar datan: antingen är alla tre styckviktskolumner ifyllda eller
ingen, och `min ≤ vikt ≤ max`.

Katalogen genereras ur `src/domain/ingredients.ts` av
`scripts/generate-seed.ts`. Redigera originalet, inte SQL-filen.

### `pantry_items.amount` i kanonisk enhet

Gram eller milliliter, aldrig "2 paket". Omräkningen sker i gränssnittet, så att
skafferiavdraget blir en ren subtraktion. Unikt per `(user_id, ingredient_id)` -
ett hushåll har ett lager av varje vara.

### `shopping_list_items.product_snapshot`

En ögonblicksbild av produkt och pris som JSON. Utan den skulle nästa nattsynk
kunna ändra en lista man redan står och handlar efter.

Därför finns också `shopping_lists.oldest_data_at`: listan ska aldrig se färskare
ut än underlaget.

### `items_without_price` som egen kolumn

`estimated_total` summerar bara poster som faktiskt har ett pris. Antalet
prislösa poster redovisas separat, så att en ofullständig summa aldrig kan
presenteras som komplett.

### `meal_plans` med nyckel på veckostart

Unikt per `(user_id, week_start)`, där `week_start` är måndagens datum. Det gör
"den här veckan" entydigt och gör det trivialt att kopiera en vecka till nästa.

### `product_price_history` med en rad per dygn

Unikt per `(gtin, store_number, observed_on)`. Nattsynken upsertar, så en extra
körning samma dag skriver inte dubbletter. Ger prishistorik utan extra anrop mot
City Gross.

---

## Automatik

**`touch_updated_at`** - trigger på `stores`, `ingredients`, `profiles`,
`recipes`, `meal_plans`, `pantry_items`, `shopping_lists`. Kör med låst
`search_path`.

**`handle_new_user`** - trigger på `auth.users` som skapar profilraden direkt vid
registrering. Appen behöver därför aldrig hantera fallet "inloggad men
profillös". `EXECUTE` är indraget från alla roller; den anropas bara av triggern.

---

## Index

Utöver primärnycklarna:

- `products`: `(store_number, name)`, `(store_number, category_code)`, partiellt
  index på rader med kampanjer, och ett GIN-index för svensk fritextsökning över
  `name || subtitle`.
- Samtliga främmandenycklar har täckande index. Utan dem måste Postgres scanna
  hela barntabellen vid varje cascade-delete.
- `pantry_items`: partiellt index på `expires_on` där det inte är null.

---

## Ändra schemat

1. Ny fil i `supabase/migrations/` med tidsstämpelprefix.
2. `supabase db push`
3. Kör säkerhetslintern - den ska rapportera noll varningar.
4. Uppdatera `src/types/database.ts`.

### Om `src/types/database.ts`

Typerna är handskrivna. Två fällor att inte städa bort:

**Raderna deklareras som `type`, inte `interface`.** Supabase kräver att de är
tilldelningsbara till `Record<string, unknown>`, och ett interface får ingen
implicit indexsignatur. Utan det faller schemat tillbaka och varje fråga får
typen `never`.

**Tomma schemablock skrivs `{ [_ in never]: never }`, inte
`Record<string, ...>`.** En indexsignatur på `Views` gör att varje tabellnamn
också tolkas som en vy; vyer saknar `Insert`, och då kollapsar typen för varje
insert till `never`. Symptomet ser ut som ett helt annat fel.

Relationer måste dessutom deklareras explicit för att inbäddade frågor
(`select('*, recipe_ingredients(*)')`) ska gå att typa.
