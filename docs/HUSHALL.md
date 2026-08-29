# Hushåll

Flera personer knutna till samma matsedel, inköpslista, skafferi och recept.

Implementerat i migrationerna `20260829100000_hushall.sql` och
`20260829110000_hushall_funktioner.sql`. Det här dokumentet beskriver hur det
fungerar och varför det ser ut som det gör.

---

## Vad som delas och vad som är personligt

Den svåra frågan var inte hur man kopplar ihop personer. Den var vilken data som
tillhör hushållet och vilken som tillhör personen. Fel svar där ger antingen en
app där ingenting går att dela, eller en app som läcker sådant som borde vara
privat.

| Data | Ägare | Varför |
|---|---|---|
| Inköpslistor | Hushåll | Två personer i butiken ska se samma lista och samma kryss. |
| Veckomatsedel | Hushåll | Man äter tillsammans. |
| Skafferi | Hushåll | Det finns ett kylskåp. |
| Recept | Hushåll | En gemensam samling är enklare att förstå än två som glider isär. |
| Produktval och favoriter | Hushåll | Knutna till butiken, inte till personen. |
| Lagningshistorik | Hushåll | Planeraren undviker upprepning för hushållet, inte per person. |
| Butik, budget, portioner, tillagningstid | Hushåll | Egenskaper hos hushållet. |
| Namn | Person | Identitet. |
| Ogillar | Person | Smak är personlig, även om den påverkar planeringen. |
| **Allergier** | **Person, men gäller alla** | Se nedan. |

De hushållsägda tabellerna behåller `user_id` som "vem lade till det här".
Åtkomsten avgörs aldrig av den kolumnen, bara av `household_id`.

### Allergier är personliga men får konsekvenser för hela hushållet

Planeraren utgår från **unionen** av allas allergier. En rätt som är olämplig
för en i hushållet är olämplig för måltiden.

Det betyder att allergier läses för samtliga medlemmar när en matsedel
genereras, vilket i sin tur betyder att medlemmar kan se varandras allergier.
Det är rimligt inom ett hushåll, men det är ett medvetet val, och därför visas
allergierna öppet per medlem på hushållssidan i stället för att tyst påverka
förslagen.

Ogillar fungerar inte så. Att en person inte tycker om broccoli utesluter inte
rätten för alla - det är en viktning som bara påverkar den som angett den.

---

## Datamodell

```sql
create table public.households (
  id                       uuid primary key default gen_random_uuid(),
  name                     text not null,
  store_number             text references public.stores(store_number),
  adults                   integer not null default 2,
  children                 integer not null default 0,
  servings_per_meal        integer not null default 2,
  max_cooking_minutes      integer,
  weekly_budget            numeric(10, 2),
  is_member                boolean not null default false,
  assume_staples_available boolean not null default true,
  repetition_avoidance     text not null default 'medium',
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null unique references auth.users(id) on delete cascade,
  role         text not null default 'member' check (role in ('owner', 'member')),
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);
```

`user_id` är **unik**: en person tillhör högst ett hushåll. Det är en förenkling
med verkliga följder - man kan inte vara med i både sitt eget och sina
föräldrars hushåll - men det gör hela resten av modellen enklare. Frågan "vilket
hushålls skafferi ska dras av?" har alltid ett svar.

`profiles` behåller `display_name`, `allergies`, `dislikes`, `diets`, `is_admin`
och `onboarded_at`. Hushållsinställningarna finns bara i `households`.

Tabeller som bytte ägare från person till hushåll: `recipes`,
`recipe_ingredients` (via receptet), `meal_plans`, `pantry_items`,
`shopping_lists`, `ingredient_product_mappings`, `favorite_products`,
`favorite_recipes`, `cooking_history`.

Unikhetsvillkor flyttade med. `pantry_items` var unik per
`(user_id, ingredient_id)` och är nu unik per `(household_id, ingredient_id)` -
annars hade två medlemmar kunnat lagerföra samma vara två gånger i samma
skafferi.

---

## RLS, och fällan

Policyerna gick från

```sql
using ((select auth.uid()) = user_id)
```

till

```sql
using (household_id = (select public.mitt_hushall()))
```

### Rekursionsfällan

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
```

Den är säker trots `security definer`, eftersom den bara returnerar anroparens
eget medlemskap. Den kan inte förmås att returnera någon annans - det finns
ingen parameter att manipulera.

`(select public.mitt_hushall())` i policyn gör att den utvärderas en gång per
fråga i stället för en gång per rad. Skillnaden märks direkt på en inköpslista
med femtio poster.

### Kolumnskyddet gäller fortfarande

Samma lärdom som från privilegieeskaleringen i `profiles`: **RLS avgör vilka
rader man får röra, inte vilka kolumner.** Utan skydd hade en medlem kunnat
göra sig själv till ägare, eller flytta sig själv till ett annat hushåll:

```sql
revoke insert, update on public.household_members from authenticated;
```

Medlemskap ändras aldrig direkt från klienten. Det sker bara genom
`skapa_hushall()` och `los_in_inbjudan()`, som båda är `security definer` och
sätter rollen själva. Att lämna hushållet är den enda `delete` som är tillåten,
och bara på den egna raden.

---

## Att bjuda in någon

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

Inlösen sker i `los_in_inbjudan(kod)`, inte genom att klienten skriver i
`household_members`. Funktionen kontrollerar i en transaktion att koden finns,
inte är utgången och inte redan använd, och att den som löser in inte redan
tillhör ett hushåll.

Tre saker som inte fick missas:

- Koden är nio slumpbytes, alltså 72 bitar. Den går inte att gissa.
- En inbjudan kan bara skapas av någon som redan är medlem.
- Utgångstiden kontrolleras i databasen, aldrig i gränssnittet.

Inbjudningar kan återkallas så länge de är oanvända.

---

## Databasfunktioner

| Funktion | Vad den gör |
|---|---|
| `mitt_hushall()` | Anroparens hushålls-id. Grunden för samtliga policyer. |
| `skapa_hushall(namn)` | Skapar hushållet och lägger till anroparen som ägare. Vägrar om personen redan har ett. |
| `los_in_inbjudan(kod)` | Validerar och löser in en kod, i en transaktion. |
| `hushallets_allergier()` | Unionen av medlemmarnas allergier. Används av planeraren. |

Samtliga är `security definer` med `set search_path = ''`, och execute är
återkallat från `public` och `anon`.

---

## Att lämna hushållet

Data följer **inte** med. Recept, matsedel, skafferi och inköpslistor tillhör
hushållet och blir kvar hos de andra medlemmarna. Lämnar den sista medlemmen
blir raderna oåtkomliga - de finns kvar i databasen men ingen policy släpper
igenom dem.

Det är ett medvetet val: alternativet hade varit att kopiera data, vilket ger
två divergerande skafferier som båda påstår sig vara sanningen. Gränssnittet
säger rakt ut vad som händer innan man bekräftar.

Att **byta** hushåll kräver därför två steg: lämna, sedan lösa in koden.
`los_in_inbjudan()` vägrar den som redan tillhör ett hushåll. En tidigare version
tog tyst bort det gamla medlemskapet, vilket innebar att en inklistrad kod kunde
kosta någon deras recept och skafferi utan att något sagts. Rättat i
`20260829120000_inbjudan_flyttar_inte_tyst.sql`.

---

## Verifierad isolering

Isoleringen testades med två hushåll och en medlem som inte är ägare. Sett från
medlem A2 i hushåll A:

| Fråga | Eget hushåll | Annat hushåll |
|---|---|---|
| `households` | 1 | 0 |
| `household_members` | 2 | 0 |
| `profiles` | 2 | 0 |
| `recipes` | 1 | 0 |
| `recipe_ingredients` | 1 | 0 |
| `pantry_items` | 1 | 0 |

`hushallets_allergier()` returnerade unionen över båda medlemmarna, inte bara
den inloggades egna.

Försök att ändra sin egen roll gav `permission denied for table
household_members`.

---

## Vad som medvetet inte byggdes

- **Flera hushåll per person.** `user_id` är unik. Se motiveringen ovan.
- **Roller med olika rättigheter.** `owner` och `member` finns i schemat, men
  ägaren har i praktiken inga extra befogenheter utöver att ha skapat hushållet.
  Ett hushåll är inte en organisation.
- **Att kasta ut någon.** Man lämnar själv. Behovet får uppstå först.
