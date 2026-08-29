-- Privilegieeskalering: en användare kunde göra sig själv till administratör.
--
-- RLS-policyn för profiles tillät uppdatering av hela den egna raden, och
-- is_admin är en kolumn på den raden. En inloggad användare kunde alltså köra
--
--   update profiles set is_admin = true where id = <sitt eget id>
--
-- och därmed komma åt driftdata i sync_runs samt kunna trigga
-- sortimentshämtningen mot City Gross.
--
-- Grundorsaken är en gränsdragning som är lätt att missa: RLS avgör VILKA
-- RADER man får röra, inte VILKA KOLUMNER. Policyn såg helt korrekt ut.
--
-- Lösningen är kolumnrättigheter. Tabellnivå-UPDATE dras in, och bara de
-- kolumner användaren faktiskt äger ges tillbaka. is_admin, id och created_at
-- kan därefter enbart ändras av service_role.

revoke update on public.profiles from authenticated;

grant update (
  display_name,
  store_number,
  adults,
  children,
  servings_per_meal,
  max_cooking_minutes,
  weekly_budget,
  allergies,
  dislikes,
  diets,
  is_member,
  assume_staples_available,
  repetition_avoidance,
  onboarded_at,
  updated_at
) on public.profiles to authenticated;

comment on column public.profiles.is_admin is
  'Ger åtkomst till sync_runs och sortimentshämtningen. Skyddad av kolumnrättigheter: authenticated saknar UPDATE på den här kolumnen och kan alltså inte höja sig själv. Sätts endast av service_role.';
