-- Hushållsfunktioner: skapa, gå med, och läsa hushållets allergier.
--
-- household_members saknar insert-policy med avsikt. Att gå med i ett hushåll
-- är inte en radskrivning användaren ska få göra fritt, utan en handling med
-- villkor: koden ska finnas, inte vara utgången, och inte redan använd.

create or replace function public.skapa_hushall(namn text default 'Hushållet')
returns uuid language plpgsql security definer set search_path = ''
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

-- Utgångstiden kontrolleras här och inte i gränssnittet, av samma skäl som
-- allt annat: klienten är inte den som avgör.
--
-- `for update` låser inbjudningsraden. Utan den kan två samtidiga inlösen av
-- samma kod båda passera kontrollen av `used_at`.
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

  select * into inbjudan from public.household_invites
  where code = trim(kod) for update;

  if not found then raise exception 'Inbjudningskoden finns inte.'; end if;
  if inbjudan.used_at is not null then raise exception 'Inbjudningskoden är redan använd.'; end if;
  if inbjudan.expires_at < now() then raise exception 'Inbjudningskoden har gått ut.'; end if;
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

-- Matsedeln måste utgå från unionen av hushållets allergier: en rätt som är
-- olämplig för en medlem är olämplig för måltiden. Ligger som funktion så att
-- regeln inte kan glömmas bort på ett anropsställe.
create or replace function public.hushallets_allergier()
returns text[] language sql security definer stable set search_path = ''
as $$
  select coalesce(array_agg(distinct allergen), '{}')
  from public.household_members m
  join public.profiles p on p.id = m.user_id
  cross join lateral unnest(p.allergies) as allergen
  where m.household_id = (select public.mitt_hushall())
$$;

revoke execute on function public.hushallets_allergier() from public, anon;
grant execute on function public.hushallets_allergier() to authenticated;
