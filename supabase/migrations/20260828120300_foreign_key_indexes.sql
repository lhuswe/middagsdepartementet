-- Index på främmandenycklar. Utan dem måste Postgres scanna hela barntabellen
-- vid varje cascade-delete och vid join tillbaka mot föräldern.

create index cooking_history_recipe_idx           on public.cooking_history (recipe_id);
create index favorite_products_ingredient_idx     on public.favorite_products (ingredient_id);
create index favorite_products_store_idx          on public.favorite_products (store_number);
create index favorite_recipes_recipe_idx          on public.favorite_recipes (recipe_id);
create index ingredient_mappings_ingredient_idx   on public.ingredient_product_mappings (ingredient_id);
create index ingredient_mappings_store_idx        on public.ingredient_product_mappings (store_number);
create index meal_plan_items_recipe_idx           on public.meal_plan_items (recipe_id);
create index pantry_items_ingredient_idx          on public.pantry_items (ingredient_id);
create index profiles_store_idx                   on public.profiles (store_number);
create index recipe_ingredients_ingredient_idx    on public.recipe_ingredients (ingredient_id);
create index shopping_list_items_ingredient_idx   on public.shopping_list_items (ingredient_id);
create index shopping_lists_meal_plan_idx         on public.shopping_lists (meal_plan_id);
create index shopping_lists_store_idx             on public.shopping_lists (store_number);
