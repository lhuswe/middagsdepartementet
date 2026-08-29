# Säkerhet

Appen hanterar ett hushålls matvanor, matpreferenser och allergier. Det är inte
statshemligheter, men det är personuppgifter, och de ska inte gå att läsa av
någon annan.

---

## Modellen

Två sorters data med helt olika ägarskap. Att blanda ihop dem är det klassiska
misstaget i en app som den här.

### Referensdata - gemensam

`stores`, `ingredients`, `ingredient_aliases`, `products`,
`product_price_history`

- **Läsbar** för alla inloggade.
- **Skrivbar** endast av `service_role`, alltså synkjobbet.

Det finns medvetet **inga** INSERT/UPDATE/DELETE-policyer på dessa tabeller. En
tabell med RLS påslaget och utan skrivpolicy går inte att skriva till, oavsett
vem som frågar. `service_role` går förbi RLS och är den enda vägen in.

> Den ursprungliga specen sa "varje användares data ska vara isolerad". Tillämpad
> rakt av på produktkatalogen hade den regeln tvingat varje hushåll att ha en
> egen kopia av City Gross sortiment.

### Användardata - privat

`profiles`, `recipes`, `recipe_ingredients`, `meal_plans`, `meal_plan_items`,
`pantry_items`, `shopping_lists`, `shopping_list_items`,
`ingredient_product_mappings`, `favorite_products`, `favorite_recipes`,
`cooking_history`

Fyra policyer per tabell (SELECT, INSERT, UPDATE, DELETE), alla mot
`auth.uid() = user_id`.

**Barntabeller** (`recipe_ingredients`, `meal_plan_items`,
`shopping_list_items`) har inget eget `user_id`. De ärver ägarskapet via en
`exists`-kontroll mot förälderns rad - i policyn, inte i frontend.

### Driftdata

`sync_runs` är läsbar endast för användare med `profiles.is_admin`. Adminsidan
döljs för andra, men det är inte döljandet som är skyddet.

---

## Genomförd granskning

En genomgång gjordes 2026-08-29. Den hittade ett allvarligt fel och ett antal
mindre saker.

### Privilegieeskalering i profiles (åtgärdad)

RLS-policyn för `profiles` tillät en användare att uppdatera hela sin egen rad.
`is_admin` är en kolumn på den raden, så följande fungerade:

```sql
update profiles set is_admin = true where id = <sitt eget id>
```

Det gav åtkomst till driftdata i `sync_runs` och möjlighet att trigga
sortimentshämtningen mot City Gross.

Grundorsaken är en gränsdragning som är lätt att missa: **RLS avgör vilka rader
man får röra, inte vilka kolumner.** Policyn såg helt korrekt ut, och gör det
fortfarande.

Åtgärdat med kolumnrättigheter. Tabellnivå-UPDATE är indragen från
`authenticated`, och bara de kolumner användaren faktiskt äger är återgivna.
`is_admin`, `id` och `created_at` kan nu enbart ändras av `service_role`.

Verifierat åt båda hållen: eskaleringsförsöket avvisas med `permission denied`,
och vanliga profiländringar fungerar oförändrat.

### Content Security Policy (tillagd)

Sätts som meta-tagg i `index.html`, eftersom GitHub Pages inte kan sätta
svarsheader. `script-src` klarar sig utan `'unsafe-inline'` tack vare att
omdirigeringsskriptet flyttades till `public/spa-redirect.js`.

Verifierad i webbläsare: en bild från City Gross släpps igenom, en bild från
annan domän blockeras av `img-src`, och appen själv ger noll överträdelser.

**Känd lucka:** `frame-ancestors` fungerar inte via meta-tagg, bara som header.
Klickjackningsskydd saknas därför. Det kräver en värd som kan sätta headers.

### CORS-allowlist (tillagd)

Edge Functions svarade tidigare med `access-control-allow-origin: *`. Det var
inte direkt utnyttjbart, eftersom funktionerna kräver en användares JWT som en
annan webbplats inte kommer åt, men en allowlist kostar ingenting. Nu speglas
bara kända ursprung: localhost i utveckling och `*.github.io`. Fler kan läggas
till via secreten `TILLATNA_URSPRUNG`.

### Spärr mot parallella synkkörningar (tillagd)

Upprepade klick på inhämtningsknappen kunde starta flera samtidiga hämtningar.
Fördröjningen på en sekund mellan anrop gäller per körning, så tre parallella
körningar innebar tre gånger så mycket trafik mot City Gross. Funktionen svarar
nu 409 om en körning redan pågår för butiken.

### Genomgånget utan anmärkning

- Ingen `dangerouslySetInnerHTML`, `innerHTML` eller `eval` någonstans
- Inga externa CDN, inga tredjepartsspårare
- Data från City Gross renderas bara i `img src`, och URL:en är alltid prefixad
  med deras domän
- Inga `target="_blank"` utan `rel`
- Ingen direkt användning av `localStorage`; sessionen sköts av Supabase
- Samtliga 18 tabeller har RLS påslaget med policyer som täcker rätt kommandon

### Kvar att göra, kräver panelen

**Leaked password protection är avstängd.** Supabase kan kontrollera lösenord mot
HaveIBeenPwned. Slå på under Authentication, Policies. Det går inte att göra via
API:et med de verktyg som finns här.

---

## Verifiering

RLS-policyer som *ser* rätt ut men läcker är hela poängen med att testa dem.
Kontrollen som kördes vid uppsättningen skapade två användare, ett recept var,
och frågade databasen som respektive användare:

| Kontroll | Egna | Andras |
|---|---|---|
| Recept | 1 | 0 |
| Receptrader (via förälderpolicy) | 1 | 0 |
| Profil | 1 | 0 |
| Delad referensdata | 1 | - |

Kolumnskyddet på `profiles` bör testas på samma sätt vid schemaändringar:

```sql
set local role authenticated;
set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
update public.profiles set is_admin = true where id = '<uuid>';
-- Ska ge: permission denied for table profiles
```

Att köra om den vid schemaändringar är billigt. Använd en transaktion med
`set local role authenticated` och `set local request.jwt.claims`, och avsluta
med `rollback`.

Supabase egen säkerhetslinter rapporterar noll varningar. Kör den efter varje
schemaändring.

---

## Hemligheter

| Nyckel | Var den finns | Var den aldrig finns |
|---|---|---|
| Anon/publishable | `.env.local`, GitHub-secrets, byggd frontend | - |
| Service role | Supabase Edge Function-miljö | Frontend, repo, byggartefakter |

Anon-nyckeln är **avsedd** att ligga i klienten. Skyddet ligger i RLS, inte i att
nyckeln är hemlig.

Deploy-workflowen har ett steg som söker igenom `dist/` efter något som liknar en
service role-nyckel och avbryter bygget om något hittas. Kontrollen är billig och
fångar misstaget innan det publiceras.

---

## Databasfunktioner

Två funktioner härdades efter påpekande från säkerhetslintern:

`touch_updated_at` kör med `set search_path = ''`. Utan låst sökväg kan en
angripare med rättighet att skapa scheman påverka vilken `now()` som anropas.

`handle_new_user` är `SECURITY DEFINER` och skapar profilrader. Som exponerad
RPC hade den kunnat anropas av vem som helst via `/rest/v1/rpc/handle_new_user`.
`EXECUTE` är därför indraget från `public`, `anon` och `authenticated`. Triggern
påverkas inte - den körs av tabellägaren.

---

## Edge Functions

`citygross-sync` accepterar två anropare:

1. Supabase Cron med service role-nyckeln.
2. En inloggad administratör från adminsidan.

I det andra fallet slås användaren upp ur JWT:n med `auth.getUser(token)` och
`is_admin` läses ur databasen med service role. **Klientens påstående om vem den
är används aldrig.**

Butiksnumret från anropet valideras mot `/^\d{3,6}$/` innan det går in i en URL
mot City Gross.

---

## Övrigt

- **Ingen `dangerouslySetInnerHTML`** någonstans. All text renderas av React.
- **Inga tredjepartsspårare.** Appen laddar inget från andra domäner än City
  Gross produktbilder och Supabase.
- **Inloggningsfel översätts** utan att avslöja om en adress finns registrerad.
- **PKCE-flödet** används, så sessionen aldrig hamnar i URL-fragmentet.
- **Serviceworkerns cache** ligger i användarens webbläsare och innehåller
  inköpslistan och veckoplanen. På en delad enhet bör man logga ut.

## Antaganden

- Appen har ingen självregistrering. Konton skapas i Supabase-panelen. Skulle
  självregistrering slås på behöver `is_admin` och åtkomsten till `sync_runs`
  ses över.
- Modellen förutsätter en användare per hushåll. Delade hushåll med flera konton
  är inte implementerat. Se `docs/HUSHALL.md` för ett förslag, och notera att
  det förslaget ändrar RLS-modellen i grunden.
- City Gross-integrationen läser endast publika, oautentiserade endpoints. Ingen
  inloggning, CAPTCHA eller bot-skydd kringgås. Se
  [CITYGROSS-INTEGRATION.md](CITYGROSS-INTEGRATION.md).

## Om något ser fel ut

Appen är privat och har inget säkerhetsprogram. Hittar du något: skapa ett issue,
eller lägg ned den tills det är åtgärdat.
