-- Härdning av databasfunktioner, efter påpekande från Supabase säkerhetslinter.

-- Låst search_path så att funktionen inte kan kapas via en manipulerad sökväg.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- handle_new_user är en triggerfunktion och ska aldrig kunna anropas som RPC.
-- Som SECURITY DEFINER skulle den annars kunna kallas av vem som helst via
-- /rest/v1/rpc/handle_new_user. Triggern påverkas inte av att EXECUTE dras in,
-- eftersom den körs av tabellägaren.
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.handle_new_user() from anon;
revoke execute on function public.handle_new_user() from authenticated;

revoke execute on function public.touch_updated_at() from public;
revoke execute on function public.touch_updated_at() from anon;
revoke execute on function public.touch_updated_at() from authenticated;
