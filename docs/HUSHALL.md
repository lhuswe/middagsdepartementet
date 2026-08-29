# Hushåll: förslag

Flera personer knutna till samma inköpslista, matsedel och skafferi.

Det här är ett förslag, inte implementerad funktionalitet. Det ändrar RLS
modellen i grunden och bör beslutas innan det byggs.

---

## Vad som faktiskt ska delas

Den svåra frågan är inte hur man kopplar ihop personer. Den är vilken data som
tillhör hushållet och vilken som tillhör personen. Fel svar här ger antingen en
app där ingenting går att dela, eller en app som läcker sådant som borde vara
privat.

| Data | Ägare | Varför |
|---|---|---|
| Inköpslistor | Hushåll | Hela poängen med förslaget. Två personer i butiken ska se samma lista och samma kryss. |
| Veckomatsedel | Hushåll | Man äter tillsammans. |
| Skafferi | Hushåll | Det finns ett kylskåp. |
| Recept | Hushåll | En gemensam samling är enklare att förstå än två som glider isär. |
| Produktval och favoriter | Hushåll | Knutna till butiken, inte till personen. |
| Lagningshistorik | Hushåll | Planeraren ska undvika upprepning för hushållet, inte per person. |
| Butik, budget, portioner, tillagningstid | Hushåll | Egenskaper hos hushållet. |
| Namn och avatar | Person | Identitet. |
| **Allergier** | **Person** | Se nedan. Det här är den viktiga raden. |
| Ogillar | Person | Smak är personlig, även om den påverkar planeringen. |

### Allergier är personliga men får konsekvenser för alla

Om två personer delar matsedel måste planeraren utgå från **unionen** av allas
allergier. En rätt som är olämplig för en i hushållet är olämplig för
matsedeln.

Det betyder att allergier måste läsas för samtliga medlemmar när en matsedel
genereras, vilket i sin tur betyder att medlemmar måste kunna se varandras
allergier. Det är rimligt inom ett hushåll, men det är ett medvetet val som bör
sägas högt, inte något som smyger in.

Samma sak gäller inte ogillar. Att en person inte tycker om broccoli behöver
inte utesluta rätten för alla. Förslag: allergier är hårda villkor för hela
hushållet, ogillar är en viktning som bara påverkar den som angett den.

---

## Datamodell

Två nya tabeller, och en kolumn på de tabeller som byter ägare.

```sql
create table public.households (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  store_number      text references public.stores(store_number),
  adults            integer not null default 2,
  children          integer not null default 0,
  servings_per_meal integer not null default 2,
  max_cooking_minutes integer,
  weekly_budget     numeric(10, 2),
  assume_staples_available boolean not null default true,
  repetition_avoidance text not null default 'medium',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'member' check (role in ('owner', 'member')),
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);
```

`profiles` behåller `display_name`, `allergies`, `dislikes` och `is_admin`.
Hushållsinställningarna flyttar till `households`.

Tabeller som byter från `user_id` till `household_id`: `recipes`, `meal_plans`,
`pantry_items`, `shopping_lists`, `ingredient_product_mappings`,
`favorite_products`, `favorite_recipes`, `cooking_history`.

Behåll gärna `user_id` som "vem lade till det här", men gör inte åtkomsten
beroende av det.

---

## RLS, och fällan som väntar

Policyerna går från

```sql
using ((select auth.uid()) = user_id)
```

till

```sql
using (household_id in (select public.mina_hushall()))
```

### Fällan

Den naiva varianten på `household_members` orsakar oändlig rekursion:

```sql
-- GÖR INTE SÅ HÄR
create policy "Se medlemmar" on household_members for select using (
  household_id in (select household_id from household_members where user_id = auth.uid())
);
```

Policyn frågar tabellen den skyddar, vilket utlöser policyn igen. Postgres
avbryter med ett rekursionsfel som pekar åt fel håll.

Lösningen är en `security definer`-funktion som går förbi RLS:

```sql
create or replace function public.mina_hushall()
returns setof uuid
language sql
security definer
stable
set search_path = ''
as $$
  select household_id
  from public.household_members
  where user_id = (select auth.uid())
$$;

revoke execute on function public.mina_hushall() from public, anon;
grant execute on function public.mina_hushall() to authenticated;
```

Den är säker trots `security definer`, eftersom den bara returnerar anroparens
egna medlemskap. Den kan inte förmås att returnera någon annans.

`(select public.mina_hushall())` i policyn gör att den utvärderas en gång per
fråga i stället för en gång per rad. Skillnaden märks direkt på en inköpslista
med femtio poster.

### Kolumnskyddet gäller fortfarande

Samma lärdom som från privilegieeskaleringen i `profiles`: RLS avgör vilka
rader man får röra, inte vilka kolumner. `household_members.role` måste skyddas
med kolumnrättigheter, annars kan en medlem göra sig själv till ägare.

---

## Att bjuda in någon

Enklast som räcker: en inbjudan med kod och utgångstid.

```sql
create table public.household_invites (
  code         text primary key default encode(gen_random_bytes(9), 'base64'),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by   uuid not null references auth.users(id),
  expires_at   timestamptz not null default now() + interval '7 days',
  used_by      uuid references auth.users(id),
  used_at      timestamptz
);
```

Inlösen sker i en `security definer`-funktion, inte genom att klienten skriver i
`household_members` direkt. Funktionen kontrollerar att koden finns, inte är
utgången och inte redan använd, och lägger till medlemmen i en transaktion.

Tre saker att inte missa:

- Koden ska vara tillräckligt lång för att inte gå att gissa. Nio slumpbytes ger
  72 bitar.
- En inbjudan får bara skapas av någon som redan är medlem.
- Utgångstiden ska kontrolleras i databasen, inte i gränssnittet.

---

## Migrering av befintlig data

Alla nuvarande användare får ett hushåll med sig själva som ägare:

```sql
insert into public.households (id, name, store_number, adults, children, ...)
select gen_random_uuid(), coalesce(display_name, 'Hushållet'), store_number, adults, children, ...
from public.profiles;
```

Sedan kopplas medlemskap och data över. Ordningen spelar roll: lägg till
`household_id` som nullbar kolumn, fyll den, gör den `not null`, och ta bort
`user_id`-beroendet i policyerna sist. Då finns inget läge där data är
oåtkomlig.

---

## Vad det kostar

Detta är inte ett litet ingrepp.

| Del | Omfattning |
|---|---|
| Migrationer | Två nya tabeller, kolumn på åtta tabeller, samtliga policyer skrivs om |
| Datalagret | Varje fråga i `src/services/` byter från `user_id` till `household_id` |
| Planeraren | Måste läsa allergier för alla medlemmar |
| Gränssnitt | Hushållsvy, inbjudningsflöde, medlemslista, lämna hushåll |
| Tester | RLS-isolering måste verifieras om, nu med två hushåll och två medlemmar |

Uppskattningsvis en dags arbete för grunden, plus tid för att verifiera
isoleringen ordentligt. Det sista steget är det som inte får slarvas med.

---

## Ett enklare alternativ, om syftet bara är inköpslistan

Om behovet i praktiken är "min sambo ska kunna kryssa i listan medan jag handlar"
finns en betydligt mindre lösning: **delning per lista.**

```sql
create table public.shopping_list_shares (
  shopping_list_id uuid not null references public.shopping_lists(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  primary key (shopping_list_id, user_id)
);
```

Policyn på `shopping_lists` blir `user_id = auth.uid() or id in (select ... from
shares where user_id = auth.uid())`. Ingenting annat ändras.

Det ger delad inköpslista utan att röra recept, skafferi, matsedel eller
allergier. Ungefär en timmes arbete i stället för en dag.

Nackdelen är att det inte skalar till "vi planerar mat tillsammans". Skafferiet
förblir personligt, vilket betyder att avdraget blir fel för den som inte äger
det.

---

## Rekommendation

Börja med att svara på vad som faktiskt efterfrågas:

1. **Bara delad inköpslista i butiken.** Ta det enkla alternativet. Det löser
   problemet i dag och stänger inga dörrar.
2. **Gemensam matplanering för ett hushåll.** Ta hela modellen. Halvvägs är
   sämst: ett delat skafferi utan delad matsedel ger fel avdrag, och en delad
   matsedel utan delade allergier är direkt olämpligt.

Frågan att ställa sig är om skafferiet och recepten ska vara gemensamma. Är
svaret ja är det hela modellen som gäller.
