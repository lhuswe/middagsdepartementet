-- Row Level Security.
--
-- Grundregeln: RLS på ALLT. Men rättigheterna ser olika ut för de två sorternas
-- data, och att blanda ihop dem är det klassiska misstaget här.
--
--   Referensdata  — läsbar för alla inloggade, skrivbar bara av service role.
--                   Ingen INSERT/UPDATE/DELETE-policy skrivs, vilket betyder
--                   att ingen vanlig användare kan skriva. service_role går
--                   förbi RLS och används av synkjobbet.
--
--   Användardata  — helt privat. Varje rad ägs av en user_id, och policyerna
--                   jämför alltid mot auth.uid(). Klientens uppfattning om vem
--                   den är spelar ingen roll.
--
-- Barntabeller (recipe_ingredients, meal_plan_items, shopping_list_items) har
-- inget eget user_id. De ärver ägarskapet via förälderns rad — och kontrollen
-- görs i policyn, inte i frontend.

-- ── Referensdata: läs för inloggade, skriv bara via service role ────────────

alter table public.stores                enable row level security;
alter table public.ingredients           enable row level security;
alter table public.ingredient_aliases    enable row level security;
alter table public.products              enable row level security;
alter table public.product_price_history enable row level security;
alter table public.sync_runs             enable row level security;

create policy "Inloggade far lasa butiker"
  on public.stores for select to authenticated using (true);

create policy "Inloggade far lasa ingredienser"
  on public.ingredients for select to authenticated using (true);

create policy "Inloggade far lasa ingrediensalias"
  on public.ingredient_aliases for select to authenticated using (true);

create policy "Inloggade far lasa produkter"
  on public.products for select to authenticated using (true);

create policy "Inloggade far lasa prishistorik"
  on public.product_price_history for select to authenticated using (true);

-- Synkloggen är driftinformation. Bara administratörer ser den, eftersom den
-- avslöjar hur integrationen mår snarare än något användaren behöver.
create policy "Administratorer far lasa synkloggen"
  on public.sync_runs for select to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid()) and profiles.is_admin
    )
  );

-- ── Användardata ────────────────────────────────────────────────────────────

alter table public.profiles                    enable row level security;
alter table public.recipes                     enable row level security;
alter table public.recipe_ingredients          enable row level security;
alter table public.meal_plans                  enable row level security;
alter table public.meal_plan_items             enable row level security;
alter table public.pantry_items                enable row level security;
alter table public.shopping_lists              enable row level security;
alter table public.shopping_list_items         enable row level security;
alter table public.ingredient_product_mappings enable row level security;
alter table public.favorite_products           enable row level security;
alter table public.favorite_recipes            enable row level security;
alter table public.cooking_history             enable row level security;

-- Profilen: man får se och ändra sin egen, aldrig någon annans. Raden skapas
-- av triggern på auth.users, så ingen INSERT-policy behövs.
create policy "Las egen profil"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

create policy "Andra egen profil"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Tabeller med eget user_id får identiska policyer. Att generera dem i stället
-- för att skriva av dem tolv gånger tar bort möjligheten att missa en.
do $$
declare
  target text;
begin
  foreach target in array array[
    'recipes', 'meal_plans', 'pantry_items', 'shopping_lists',
    'ingredient_product_mappings', 'favorite_products', 'favorite_recipes',
    'cooking_history'
  ]
  loop
    execute format($f$
      create policy "Las egna rader" on public.%1$I
        for select to authenticated using ((select auth.uid()) = user_id);

      create policy "Skapa egna rader" on public.%1$I
        for insert to authenticated with check ((select auth.uid()) = user_id);

      create policy "Andra egna rader" on public.%1$I
        for update to authenticated
        using ((select auth.uid()) = user_id)
        with check ((select auth.uid()) = user_id);

      create policy "Radera egna rader" on public.%1$I
        for delete to authenticated using ((select auth.uid()) = user_id);
    $f$, target);
  end loop;
end;
$$;

-- Barntabeller ärver ägarskapet via föräldern.
do $$
declare
  spec record;
begin
  for spec in
    select * from (values
      ('recipe_ingredients',   'recipe_id',        'recipes'),
      ('meal_plan_items',      'meal_plan_id',     'meal_plans'),
      ('shopping_list_items',  'shopping_list_id', 'shopping_lists')
    ) as t(child, fk, parent)
  loop
    execute format($f$
      create policy "Las rader under egen foralder" on public.%1$I
        for select to authenticated using (
          exists (
            select 1 from public.%3$I p
            where p.id = %1$I.%2$I and p.user_id = (select auth.uid())
          )
        );

      create policy "Skapa rader under egen foralder" on public.%1$I
        for insert to authenticated with check (
          exists (
            select 1 from public.%3$I p
            where p.id = %2$I and p.user_id = (select auth.uid())
          )
        );

      create policy "Andra rader under egen foralder" on public.%1$I
        for update to authenticated
        using (
          exists (
            select 1 from public.%3$I p
            where p.id = %1$I.%2$I and p.user_id = (select auth.uid())
          )
        )
        with check (
          exists (
            select 1 from public.%3$I p
            where p.id = %2$I and p.user_id = (select auth.uid())
          )
        );

      create policy "Radera rader under egen foralder" on public.%1$I
        for delete to authenticated using (
          exists (
            select 1 from public.%3$I p
            where p.id = %1$I.%2$I and p.user_id = (select auth.uid())
          )
        );
    $f$, spec.child, spec.fk, spec.parent);
  end loop;
end;
$$;

-- Anonyma får inte röra någonting. Standard i Supabase, men skrivet uttryckligen
-- så att det syns att det är ett beslut och inte en glömska.
revoke all on all tables in schema public from anon;
