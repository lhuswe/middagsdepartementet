-- los_in_inbjudan tog tidigare bort ett befintligt medlemskap och skapade ett
-- nytt. Det innebar att den som redan hade ett hushåll förlorade åtkomsten till
-- sina recept, sitt skafferi och sina inköpslistor genom att klistra in en kod.
-- Ingenting i gränssnittet sa det.
--
-- Nu krävs att man först lämnar sitt hushåll aktivt. Det flödet varnar explicit
-- för att data blir kvar hos de övriga medlemmarna.

create or replace function public.los_in_inbjudan(kod text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  inbjudan public.household_invites;
  anvandare uuid := (select auth.uid());
begin
  if anvandare is null then
    raise exception 'Inte inloggad.';
  end if;

  if exists (select 1 from public.household_members where user_id = anvandare) then
    raise exception 'Du tillhör redan ett hushåll. Lämna det först om du vill byta.';
  end if;

  select * into inbjudan from public.household_invites
  where code = trim(kod) for update;

  if not found then raise exception 'Inbjudningskoden finns inte.'; end if;
  if inbjudan.used_at is not null then raise exception 'Inbjudningskoden är redan använd.'; end if;
  if inbjudan.expires_at < now() then raise exception 'Inbjudningskoden har gått ut.'; end if;

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
