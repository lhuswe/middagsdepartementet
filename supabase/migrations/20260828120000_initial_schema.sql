-- Departementet för middagsfrågor - grundschema
--
-- Två sorters data, med helt olika ägarskap:
--
--   Referensdata (stores, ingredients, products, priser) är GEMENSAM. Den läses
--   av alla inloggade och skrivs bara av synkjobbet via service role.
--
--   Användardata (recept, matsedlar, skafferi, inköpslistor) är PRIVAT och
--   isoleras med RLS på user_id.
--
-- Originalspecens "varje användares data ska vara isolerad" får inte tillämpas
-- rakt av på produktkatalogen - då skulle varje hushåll behöva sin egen kopia
-- av City Gross sortiment. Rättigheterna sätts i 20260828120100_rls.sql.

create extension if not exists "pgcrypto";

-- ── Referensdata ────────────────────────────────────────────────────────────

create table public.stores (
  store_number text primary key,
  name         text not null,
  city         text not null,
  street_address text not null default '',
  zip_code     text not null default '',
  updated_at   timestamptz not null default now()
);

comment on column public.stores.store_number is
  'Butiksnumret City Gross API vill ha i ?store=. Sundsvall = 3230.';

-- Ingredienskatalogen. Styckvikter och densiteter bor här eftersom de är det
-- enda sättet att jämföra "3 gula lökar" med "Gul lök 1kg".
create table public.ingredients (
  id             text primary key,
  name           text not null,
  canonical_unit text not null check (canonical_unit in ('g', 'ml')),
  category       text not null,
  staple         boolean not null default false,
  piece_weight_g       numeric(10, 3),
  piece_weight_min_g   numeric(10, 3),
  piece_weight_max_g   numeric(10, 3),
  grams_per_dl         numeric(10, 3),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint piece_weight_complete check (
    (piece_weight_g is null and piece_weight_min_g is null and piece_weight_max_g is null)
    or (piece_weight_g is not null and piece_weight_min_g is not null and piece_weight_max_g is not null)
  ),
  constraint piece_weight_ordered check (
    piece_weight_g is null or (piece_weight_min_g <= piece_weight_g and piece_weight_g <= piece_weight_max_g)
  )
);

comment on column public.ingredients.staple is
  'Skafferivara som antas finnas hemma. Utesluts från inköpslistan om inget annat sägs.';

create table public.ingredient_aliases (
  ingredient_id text not null references public.ingredients(id) on delete cascade,
  alias         text not null,
  primary key (ingredient_id, alias)
);

create index ingredient_aliases_alias_idx on public.ingredient_aliases (alias);

-- Produktkatalogen, en rad per vara och butik. Priser och lagerstatus skiljer
-- sig mellan butiker, så butiksnumret måste ingå i nyckeln.
create table public.products (
  gtin            text not null,
  store_number    text not null references public.stores(store_number) on delete cascade,
  external_id     text not null default '',
  name            text not null,
  subtitle        text not null default '',
  brand           text,
  -- Förpackningsstorlek tolkad ur descriptive_size. netContent.unitOfMeasure
  -- från City Gross är 0 för både gram och milliliter och används därför inte.
  net_content_value numeric(10, 3),
  net_content_unit  text check (net_content_unit in ('g', 'ml')),
  descriptive_size  text not null default '',
  selling_unit    text not null default 'PCE' check (selling_unit in ('PCE', 'KGM')),
  category_code   text,
  category_path   text[] not null default '{}',
  price           numeric(10, 2) not null default 0,
  comparative_price numeric(10, 2),
  comparative_price_unit text,
  promotions      jsonb not null default '[]'::jsonb,
  -- null = okänd lagerstatus, inte "slut". Skillnaden är avsiktlig.
  in_stock        boolean,
  image_url       text,
  product_url     text,
  -- null = okänd allergiinformation, aldrig "fri från".
  allergens       text[],
  synced_at       timestamptz not null default now(),
  primary key (gtin, store_number)
);

create index products_store_name_idx on public.products (store_number, name);
create index products_category_idx on public.products (store_number, category_code);
create index products_promotions_idx on public.products (store_number)
  where jsonb_array_length(promotions) > 0;
-- Fritextsökning på svenska för produktväljaren.
create index products_search_idx on public.products
  using gin (to_tsvector('swedish', name || ' ' || subtitle));

comment on column public.products.in_stock is
  'null betyder okänd lagerstatus (butik saknades i anropet), inte slut i butiken.';
comment on column public.products.allergens is
  'null betyder att City Gross inte anger allergener. Aldrig tolkat som "fri från".';

-- En prisobservation per vara och dygn. Ger prishistorik utan extra anrop.
create table public.product_price_history (
  id           uuid primary key default gen_random_uuid(),
  gtin         text not null,
  store_number text not null,
  price        numeric(10, 2) not null,
  comparative_price numeric(10, 2),
  had_promotion boolean not null default false,
  observed_on  date not null default current_date,
  unique (gtin, store_number, observed_on)
);

create index price_history_lookup_idx
  on public.product_price_history (gtin, store_number, observed_on desc);

-- Synkkörningar, för adminsidan "Diagnostik och tillsyn".
create table public.sync_runs (
  id                 uuid primary key default gen_random_uuid(),
  store_number       text not null,
  started_at         timestamptz not null default now(),
  finished_at        timestamptz,
  status             text not null default 'running'
                     check (status in ('running', 'success', 'failed')),
  categories_processed integer not null default 0,
  products_upserted  integer not null default 0,
  error_message      text
);

create index sync_runs_recent_idx on public.sync_runs (store_number, started_at desc);

-- ── Användardata ────────────────────────────────────────────────────────────

create table public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  display_name      text,
  store_number      text references public.stores(store_number),
  adults            integer not null default 2 check (adults >= 0),
  children          integer not null default 0 check (children >= 0),
  servings_per_meal integer not null default 2 check (servings_per_meal > 0),
  max_cooking_minutes integer check (max_cooking_minutes > 0),
  weekly_budget     numeric(10, 2) check (weekly_budget >= 0),
  allergies         text[] not null default '{}',
  dislikes          text[] not null default '{}',
  diets             text[] not null default '{}',
  -- Medlemspriser räknas bara in för medlemmar - annars blir uppskattningen
  -- systematiskt för låg.
  is_member         boolean not null default false,
  assume_staples_available boolean not null default true,
  repetition_avoidance text not null default 'medium'
                       check (repetition_avoidance in ('low', 'medium', 'high')),
  is_admin          boolean not null default false,
  onboarded_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table public.recipes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  description   text not null default '',
  servings      integer not null check (servings > 0),
  prep_minutes  integer not null default 0 check (prep_minutes >= 0),
  cook_minutes  integer not null default 0 check (cook_minutes >= 0),
  instructions  text[] not null default '{}',
  tags          text[] not null default '{}',
  source        text,
  source_url    text,
  image_url     text,
  -- Sant för de recept som följer med appen. Originalinnehåll, inte kopierat.
  is_seed       boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index recipes_user_idx on public.recipes (user_id, name);
create index recipes_tags_idx on public.recipes using gin (tags);

create table public.recipe_ingredients (
  id            uuid primary key default gen_random_uuid(),
  recipe_id     uuid not null references public.recipes(id) on delete cascade,
  ingredient_id text not null references public.ingredients(id),
  quantity      numeric(10, 3) not null check (quantity > 0),
  unit          text not null,
  optional      boolean not null default false,
  note          text,
  sort_order    integer not null default 0
);

create index recipe_ingredients_recipe_idx on public.recipe_ingredients (recipe_id, sort_order);

create table public.meal_plans (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  name       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, week_start)
);

create table public.meal_plan_items (
  id           uuid primary key default gen_random_uuid(),
  meal_plan_id uuid not null references public.meal_plans(id) on delete cascade,
  served_on    date not null,
  meal_type    text not null default 'dinner'
               check (meal_type in ('breakfast', 'lunch', 'dinner')),
  recipe_id    uuid references public.recipes(id) on delete set null,
  servings     integer not null check (servings > 0),
  note         text,
  unique (meal_plan_id, served_on, meal_type)
);

create index meal_plan_items_plan_idx on public.meal_plan_items (meal_plan_id, served_on);

create table public.pantry_items (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  ingredient_id text not null references public.ingredients(id),
  -- Mängd i ingrediensens kanoniska enhet (g eller ml).
  amount        numeric(10, 3) not null check (amount >= 0),
  min_stock     numeric(10, 3) check (min_stock >= 0),
  expires_on    date,
  updated_at    timestamptz not null default now(),
  unique (user_id, ingredient_id)
);

create index pantry_expiring_idx on public.pantry_items (user_id, expires_on)
  where expires_on is not null;

create table public.shopping_lists (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  meal_plan_id uuid references public.meal_plans(id) on delete set null,
  name         text not null default 'Inköpslista',
  store_number text not null references public.stores(store_number),
  status       text not null default 'open' check (status in ('open', 'done', 'archived')),
  -- Summan av de poster som faktiskt hade ett pris. Aldrig en gissning för
  -- helheten - antalet prislösa poster redovisas separat.
  estimated_total     numeric(10, 2) not null default 0,
  items_without_price integer not null default 0,
  -- Äldsta synktidpunkt bland de valda produkterna, så listan aldrig ser
  -- färskare ut än underlaget.
  oldest_data_at timestamptz,
  generated_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index shopping_lists_user_idx on public.shopping_lists (user_id, created_at desc);

create table public.shopping_list_items (
  id               uuid primary key default gen_random_uuid(),
  shopping_list_id uuid not null references public.shopping_lists(id) on delete cascade,
  ingredient_id    text references public.ingredients(id),
  -- Visningsnamn sparas separat så manuella rader ("Toapapper") fungerar utan
  -- att behöva finnas i ingredienskatalogen.
  display_name     text not null,
  category         text not null default 'ovrigt',
  required_amount  numeric(10, 3),
  required_unit    text check (required_unit in ('g', 'ml', 'st')),
  buy_quantity     numeric(10, 3),
  product_gtin     text,
  -- Ögonblicksbild av produkt och pris vid genereringen. Utan den skulle en
  -- nattlig synk kunna ändra en redan utskriven lista under fötterna på en.
  product_snapshot jsonb,
  unit_price       numeric(10, 2),
  line_total       numeric(10, 2),
  match_confidence text check (match_confidence in
                   ('confirmed', 'probable', 'ambiguous', 'unavailable', 'unknown')),
  status           text not null default 'ready'
                   check (status in ('ready', 'needs-choice', 'unavailable', 'unresolved')),
  warnings         text[] not null default '{}',
  checked          boolean not null default false,
  checked_at       timestamptz,
  is_manual        boolean not null default false,
  sort_order       integer not null default 0
);

create index shopping_list_items_list_idx
  on public.shopping_list_items (shopping_list_id, category, sort_order);

-- Användarens egna produktval. Det är den här tabellen som gör matchningen
-- bättre över tid - inte en smartare algoritm.
create table public.ingredient_product_mappings (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  ingredient_id text not null references public.ingredients(id),
  store_number  text not null references public.stores(store_number),
  gtin          text not null,
  created_at    timestamptz not null default now(),
  unique (user_id, ingredient_id, store_number)
);

create table public.favorite_products (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  ingredient_id text not null references public.ingredients(id),
  store_number  text not null references public.stores(store_number),
  gtin          text not null,
  created_at    timestamptz not null default now(),
  unique (user_id, ingredient_id, store_number)
);

create table public.favorite_recipes (
  user_id    uuid not null references auth.users(id) on delete cascade,
  recipe_id  uuid not null references public.recipes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, recipe_id)
);

create table public.cooking_history (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  recipe_id  uuid not null references public.recipes(id) on delete cascade,
  cooked_on  date not null default current_date,
  servings   integer check (servings > 0),
  rating     integer check (rating between 1 and 5),
  created_at timestamptz not null default now()
);

create index cooking_history_user_idx on public.cooking_history (user_id, cooked_on desc);

-- ── updated_at ──────────────────────────────────────────────────────────────

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  target text;
begin
  foreach target in array array[
    'stores', 'ingredients', 'profiles', 'recipes', 'meal_plans',
    'pantry_items', 'shopping_lists'
  ]
  loop
    execute format(
      'create trigger %I_touch_updated_at before update on public.%I
         for each row execute function public.touch_updated_at()',
      target, target
    );
  end loop;
end;
$$;

-- Ny användare får en profil direkt, så appen aldrig behöver hantera fallet
-- "inloggad men profillös".
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
