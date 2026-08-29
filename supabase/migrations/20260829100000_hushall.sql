-- Hushåll: flera personer på samma inköpslista, matsedel, skafferi och recept.
--
-- Ägarskapet flyttar från person till hushåll för allt som handlar om maten,
-- och stannar hos personen för det som är identitet eller medicin.
--
-- En person tillhör exakt ett hushåll. Det är en medveten förenkling: den tar
-- bort frågan "vilket hushåll agerar jag i just nu" ur varje fråga, varje
-- policy och varje vy. Behöver någon dela mellan två hem får den begränsningen
-- omprövas då.

-- ── Nya tabeller ────────────────────────────────────────────────────────────

create table public.households (
  id                       uuid primary key default gen_random_uuid(),
  name                     text not null default 'Hushållet',
  store_number             text references public.stores(store_number),
  adults                   integer not null default 2 check (adults >= 0),
  children                 integer not null default 0 check (children >= 0),
  servings_per_meal        integer not null default 2 check (servings_per_meal > 0),
  max_cooking_minutes      integer check (max_cooking_minutes > 0),
  weekly_budget            numeric(10, 2) check (weekly_budget >= 0),
  is_member                boolean not null default false,
  assume_staples_available boolean not null default true,
  repetition_avoidance     text not null default 'medium'
                           check (repetition_avoidance in ('low', 'medium', 'high')),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

comment on column public.households.is_member is
  'Medlem i City Gross kundklubb. Medlemspriser räknas bara in när detta är sant, annars blir uppskattningen systematiskt för låg.';

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  -- Unik: en person tillhör ett hushåll. Se kommentaren överst.
  user_id      uuid not null references auth.users(id) on delete cascade unique,
  role         text not null default 'member' check (role in ('owner', 'member')),
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

create index household_members_user_idx on public.household_members (user_id);

create table public.household_invites (
  -- 12 slumpbytes ger 96 bitar. Inte gissningsbar.
  code         text primary key default encode(gen_random_bytes(12), 'hex'),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by   uuid not null references auth.users(id) on delete cascade,
  expires_at   timestamptz not null default now() + interval '7 days',
  used_by      uuid references auth.users(id) on delete set null,
  used_at      timestamptz,
  created_at   timestamptz not null default now()
);

create index household_invites_household_idx on public.household_invites (household_id);

-- ── Hjälpfunktion ───────────────────────────────────────────────────────────

/*
 * Anroparens hushåll.
 *
 * security definer är nödvändigt, inte bekvämt: en policy på household_members
 * som frågar household_members utlöser sig själv och ger ett rekursionsfel som
 * pekar åt fel håll. Funktionen går förbi RLS och bryter cykeln.
 *
 * Den är ändå säker, eftersom den bara kan returnera anroparens eget
 * medlemskap. Det finns ingen parameter att manipulera.
 */
create or replace function public.mitt_hushall()
returns uuid
language sql
security definer
stable
set search_path = ''
as $$
  select household_id
  from public.household_members
  where user_id = (select auth.uid())
  limit 1
$$;

revoke execute on function public.mitt_hushall() from public, anon;
grant execute on function public.mitt_hushall() to authenticated;

-- ── Flytta hushållsinställningarna från profiles ─────────────────────────────

-- Ett hushåll per befintlig användare, skapat och kopplat i samma steg.
--
-- Görs radvis i stället för med två insert-satser: att i efterhand matcha ihop
-- hushåll och profiler kräver ett gemensamt fält, och namn duger inte som
-- nyckel. Två personer som heter samma sak hade hamnat i fel hushåll.
do $$
declare
  profil record;
  nytt_id uuid;
begin
  for profil in select * from public.profiles loop
    insert into public.households (
      name, store_number, adults, children, servings_per_meal,
      max_cooking_minutes, weekly_budget, is_member, assume_staples_available,
      repetition_avoidance
    )
    values (
      coalesce(nullif(trim(profil.display_name), ''), 'Hushållet'),
      profil.store_number, profil.adults, profil.children, profil.servings_per_meal,
      profil.max_cooking_minutes, profil.weekly_budget, profil.is_member,
      profil.assume_staples_available, profil.repetition_avoidance
    )
    returning id into nytt_id;

    insert into public.household_members (household_id, user_id, role)
    values (nytt_id, profil.id, 'owner');
  end loop;
end;
$$;

-- ── household_id på de tabeller som byter ägare ─────────────────────────────

-- favorite_recipes har user_id i sin primärnyckel. NOT NULL går inte att ta
-- bort så länge nyckeln finns kvar, så den måste släppas först. Ny nyckel på
-- (household_id, recipe_id) sätts längre ned.
alter table public.favorite_recipes drop constraint if exists favorite_recipes_pkey;

do $$
declare
  tabell text;
begin
  foreach tabell in array array[
    'recipes', 'meal_plans', 'pantry_items', 'shopping_lists',
    'ingredient_product_mappings', 'favorite_products', 'favorite_recipes',
    'cooking_history'
  ]
  loop
    -- Nullbar först, fyll, gör obligatorisk. Ingen punkt där data är oåtkomlig.
    execute format(
      'alter table public.%I add column household_id uuid references public.households(id) on delete cascade',
      tabell);

    execute format(
      'update public.%I t set household_id = m.household_id
         from public.household_members m where m.user_id = t.user_id',
      tabell);

    execute format('delete from public.%I where household_id is null', tabell);
    execute format('alter table public.%I alter column household_id set not null', tabell);
    execute format('create index %I on public.%I (household_id)', tabell || '_household_idx', tabell);

    /*
     * user_id blir "vem lade till det här", inte "vem äger det".
     *
     * Kaskaden måste bort samtidigt: med on delete cascade hade hushållets
     * gemensamma recept och inköpslistor försvunnit den dagen en medlem tog
     * bort sitt konto.
     */
    execute format('alter table public.%I drop constraint if exists %I', tabell, tabell || '_user_id_fkey');
    execute format('alter table public.%I alter column user_id drop not null', tabell);
    execute format(
      'alter table public.%I add constraint %I foreign key (user_id) references auth.users(id) on delete set null',
      tabell, tabell || '_user_id_fkey');
  end loop;
end;
$$;

-- Unika villkor som byggde på user_id måste nu gälla per hushåll.
alter table public.meal_plans drop constraint if exists meal_plans_user_id_week_start_key;
alter table public.meal_plans add constraint meal_plans_household_week_key unique (household_id, week_start);

alter table public.pantry_items drop constraint if exists pantry_items_user_id_ingredient_id_key;
alter table public.pantry_items add constraint pantry_items_household_ingredient_key unique (household_id, ingredient_id);

alter table public.ingredient_product_mappings drop constraint if exists ingredient_product_mappings_user_id_ingredient_id_store_number_key;
alter table public.ingredient_product_mappings add constraint ingredient_mappings_household_key unique (household_id, ingredient_id, store_number);

alter table public.favorite_products drop constraint if exists favorite_products_user_id_ingredient_id_store_number_key;
alter table public.favorite_products add constraint favorite_products_household_key unique (household_id, ingredient_id, store_number);

alter table public.favorite_recipes add constraint favorite_recipes_pkey primary key (household_id, recipe_id);

-- ── Profiles: bara identitet och det som är personligt ──────────────────────

alter table public.profiles
  drop column store_number,
  drop column adults,
  drop column children,
  drop column servings_per_meal,
  drop column max_cooking_minutes,
  drop column weekly_budget,
  drop column is_member,
  drop column assume_staples_available,
  drop column repetition_avoidance;

comment on column public.profiles.allergies is
  'Personliga. Matsedeln måste utgå från unionen av hushållets alla allergier, eftersom en rätt som är olämplig för en medlem är olämplig för måltiden.';
comment on column public.profiles.dislikes is
  'Personliga och viktas mjukt, till skillnad från allergier som är hårda villkor.';

-- ── RLS ─────────────────────────────────────────────────────────────────────

alter table public.households        enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;

create policy "Las eget hushall" on public.households for select to authenticated
  using (id = (select public.mitt_hushall()));

create policy "Andra eget hushall" on public.households for update to authenticated
  using (id = (select public.mitt_hushall()))
  with check (id = (select public.mitt_hushall()));

create policy "Las medlemmar i eget hushall" on public.household_members for select to authenticated
  using (household_id = (select public.mitt_hushall()));

-- Man far lamna sitt hushall, men inte kasta ut nagon annan.
create policy "Lamna eget hushall" on public.household_members for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "Las inbjudningar i eget hushall" on public.household_invites for select to authenticated
  using (household_id = (select public.mitt_hushall()));

create policy "Skapa inbjudan till eget hushall" on public.household_invites for insert to authenticated
  with check (
    household_id = (select public.mitt_hushall())
    and created_by = (select auth.uid())
  );

create policy "Ateraterkalla egen inbjudan" on public.household_invites for delete to authenticated
  using (household_id = (select public.mitt_hushall()));

-- Byt policyerna pa de tabeller som nu ags av hushallet.
do $$
declare
  tabell text;
begin
  foreach tabell in array array[
    'recipes', 'meal_plans', 'pantry_items', 'shopping_lists',
    'ingredient_product_mappings', 'favorite_products', 'favorite_recipes',
    'cooking_history'
  ]
  loop
    execute format('drop policy if exists "Las egna rader" on public.%I', tabell);
    execute format('drop policy if exists "Skapa egna rader" on public.%I', tabell);
    execute format('drop policy if exists "Andra egna rader" on public.%I', tabell);
    execute format('drop policy if exists "Radera egna rader" on public.%I', tabell);

    execute format($f$
      create policy "Las hushallets rader" on public.%1$I
        for select to authenticated
        using (household_id = (select public.mitt_hushall()));

      create policy "Skapa i hushallet" on public.%1$I
        for insert to authenticated
        with check (household_id = (select public.mitt_hushall()));

      create policy "Andra hushallets rader" on public.%1$I
        for update to authenticated
        using (household_id = (select public.mitt_hushall()))
        with check (household_id = (select public.mitt_hushall()));

      create policy "Radera hushallets rader" on public.%1$I
        for delete to authenticated
        using (household_id = (select public.mitt_hushall()));
    $f$, tabell);
  end loop;
end;
$$;

-- Barntabellerna arver nu via hushallet i stallet for via anvandaren.
do $$
declare
  spec record;
begin
  for spec in
    select * from (values
      ('recipe_ingredients',  'recipe_id',        'recipes'),
      ('meal_plan_items',     'meal_plan_id',     'meal_plans'),
      ('shopping_list_items', 'shopping_list_id', 'shopping_lists')
    ) as t(child, fk, parent)
  loop
    execute format('drop policy if exists "Las rader under egen foralder" on public.%I', spec.child);
    execute format('drop policy if exists "Skapa rader under egen foralder" on public.%I', spec.child);
    execute format('drop policy if exists "Andra rader under egen foralder" on public.%I', spec.child);
    execute format('drop policy if exists "Radera rader under egen foralder" on public.%I', spec.child);

    execute format($f$
      create policy "Las under hushallets foralder" on public.%1$I
        for select to authenticated using (
          exists (select 1 from public.%3$I p
                  where p.id = %1$I.%2$I and p.household_id = (select public.mitt_hushall()))
        );

      create policy "Skapa under hushallets foralder" on public.%1$I
        for insert to authenticated with check (
          exists (select 1 from public.%3$I p
                  where p.id = %2$I and p.household_id = (select public.mitt_hushall()))
        );

      create policy "Andra under hushallets foralder" on public.%1$I
        for update to authenticated
        using (
          exists (select 1 from public.%3$I p
                  where p.id = %1$I.%2$I and p.household_id = (select public.mitt_hushall()))
        )
        with check (
          exists (select 1 from public.%3$I p
                  where p.id = %2$I and p.household_id = (select public.mitt_hushall()))
        );

      create policy "Radera under hushallets foralder" on public.%1$I
        for delete to authenticated using (
          exists (select 1 from public.%3$I p
                  where p.id = %1$I.%2$I and p.household_id = (select public.mitt_hushall()))
        );
    $f$, spec.child, spec.fk, spec.parent);
  end loop;
end;
$$;

-- Medlemmar maste kunna se varandras allergier, annars kan matsedeln inte ta
-- hansyn till dem. Det ar ett medvetet val och galler bara inom hushallet.
create policy "Las profiler i eget hushall" on public.profiles for select to authenticated
  using (
    id in (
      select m.user_id from public.household_members m
      where m.household_id = (select public.mitt_hushall())
    )
  );

-- ── Kolumnrattigheter ───────────────────────────────────────────────────────

/*
 * Samma lardom som fran privilegieeskaleringen i profiles: RLS avgor vilka
 * rader man far rora, inte vilka kolumner. Utan detta kunde en medlem gora sig
 * sjalv till agare av hushallet.
 */
revoke update on public.households from authenticated;
grant update (
  name, store_number, adults, children, servings_per_meal,
  max_cooking_minutes, weekly_budget, is_member,
  assume_staples_available, repetition_avoidance, updated_at
) on public.households to authenticated;

revoke insert, update on public.household_members from authenticated;

create trigger households_touch_updated_at
  before update on public.households
  for each row execute function public.touch_updated_at();

-- ── Skapa och gå med ────────────────────────────────────────────────────────

/*
 * household_members saknar insert-policy med avsikt. Att gå med i ett hushåll
 * är inte en radskrivning användaren ska få göra fritt, utan en handling med
 * villkor: koden ska finnas, inte vara utgången, och inte redan använd.
 *
 * Därför sker det i security definer-funktioner som äger hela kontrollen, i en
 * transaktion, i stället för i klienten.
 */

create or replace function public.skapa_hushall(namn text default 'Hushållet')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  nytt_id uuid;
  anvandare uuid := (select auth.uid());
begin
  if anvandare is null then
    raise exception 'Inte inloggad.';
  end if;

  if exists (select 1 from public.household_members where user_id = anvandare) then
    raise exception 'Du tillhör redan ett hushåll.';
  end if;

  insert into public.households (name)
  values (coalesce(nullif(trim(namn), ''), 'Hushållet'))
  returning id into nytt_id;

  insert into public.household_members (household_id, user_id, role)
  values (nytt_id, anvandare, 'owner');

  return nytt_id;
end;
$$;

revoke execute on function public.skapa_hushall(text) from public, anon;
grant execute on function public.skapa_hushall(text) to authenticated;

/*
 * Löser in en inbjudan.
 *
 * Utgångstiden kontrolleras här och inte i gränssnittet, av samma skäl som
 * allt annat: klienten är inte den som avgör.
 *
 * En användare som redan tillhör ett hushåll lämnar det. Det följer av att en
 * person tillhör exakt ett hushåll. Data i det gamla hushållet följer inte med,
 * eftersom den tillhör hushållet och inte personen.
 */
create or replace function public.los_in_inbjudan(kod text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  inbjudan public.household_invites;
  anvandare uuid := (select auth.uid());
begin
  if anvandare is null then
    raise exception 'Inte inloggad.';
  end if;

  select * into inbjudan
  from public.household_invites
  where code = trim(kod)
  for update;

  if not found then
    raise exception 'Inbjudningskoden finns inte.';
  end if;
  if inbjudan.used_at is not null then
    raise exception 'Inbjudningskoden är redan använd.';
  end if;
  if inbjudan.expires_at < now() then
    raise exception 'Inbjudningskoden har gått ut.';
  end if;
  if exists (
    select 1 from public.household_members
    where user_id = anvandare and household_id = inbjudan.household_id
  ) then
    raise exception 'Du tillhör redan det hushållet.';
  end if;

  -- En person tillhör ett hushåll. Att gå med i ett nytt innebär att lämna det gamla.
  delete from public.household_members where user_id = anvandare;

  insert into public.household_members (household_id, user_id, role)
  values (inbjudan.household_id, anvandare, 'member');

  update public.household_invites
  set used_by = anvandare, used_at = now()
  where code = inbjudan.code;

  return inbjudan.household_id;
end;
$$;

revoke execute on function public.los_in_inbjudan(text) from public, anon;
grant execute on function public.los_in_inbjudan(text) to authenticated;

/*
 * Hushållets samlade allergier.
 *
 * Matsedeln måste utgå från unionen: en rätt som är olämplig för en medlem är
 * olämplig för måltiden. Ligger som funktion i databasen så att regeln inte
 * kan glömmas bort på ett anropsställe.
 */
create or replace function public.hushallets_allergier()
returns text[]
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(array_agg(distinct allergen), '{}')
  from public.household_members m
  join public.profiles p on p.id = m.user_id
  cross join lateral unnest(p.allergies) as allergen
  where m.household_id = (select public.mitt_hushall())
$$;

revoke execute on function public.hushallets_allergier() from public, anon;
grant execute on function public.hushallets_allergier() to authenticated;
