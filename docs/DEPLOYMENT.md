# Publicering

Frontenden är en statisk sajt på GitHub Pages. Backenden är Supabase. Ingenting
körs på en egen server.

---

## 1. GitHub Pages

### Repo och basadress

Vite bygger med `base: '/middagsdepartementet/'`. **Repot måste heta
`middagsdepartementet`**, annars 404:ar alla assets i produktion.

Byter du namn på repot: ändra `BASE` i `vite.config.ts` och `SEGMENT` i
`public/404.html` (`1` för ett projektrepo, `0` för en användarsajt
`<namn>.github.io`).

### Slå på Pages

**Settings → Pages → Source: GitHub Actions.**

### Lägg in secrets

**Settings → Secrets and variables → Actions:**

| Secret | Värde |
|---|---|
| `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Publishable-nyckeln |

Båda är publika värden. De ligger som secrets ändå, så att en fork inte pekar på
din databas.

### Publicera

Pusha till `main`. Workflowen kör typkontroll, lint och tester, bygger,
kontrollerar att inga hemligheter följt med, och publicerar.

### Om djuplänkar

GitHub Pages har ingen server som kan svara på `/vecka`. `public/404.html` kodar
in sökvägen i query-strängen och skickar till `index.html`, som packar upp den
igen innan React Router startar. Utan det går varje direktlänk och varje
omladdning inne i appen sönder.

Testa efter första publiceringen: gå till `/inkopslista` och tryck F5.

---

## 2. Databasen

```bash
supabase link --project-ref DITT_REF
```

```bash
supabase db push
```

Migrationerna körs i ordning:

| Fil | Innehåll |
|---|---|
| `..._initial_schema.sql` | Tabeller, index, triggers |
| `..._rls.sql` | Row Level Security |
| `..._harden_functions.sql` | Låst search_path, indragen EXECUTE |
| `..._foreign_key_indexes.sql` | Index på främmandenycklar |
| `..._seed_ingredients.sql` | Ingredienskatalogen |
| `..._seed_stores.sql` | Samtliga 38 City Gross-butiker |

Kör säkerhetslintern efteråt. Den ska rapportera noll varningar.

### Autentisering

**Authentication → URL Configuration:**

- **Site URL**: `https://<användarnamn>.github.io/middagsdepartementet/`
- **Redirect URLs**: samma adress, plus `http://localhost:5173/`

Appen använder PKCE. Sessionen kommer tillbaka som `?code=` i query-strängen,
inte i URL-fragmentet — det senare hade krockat med routingen och betett sig
olika lokalt och i produktion.

---

## 3. Edge Functions

Domänmodulerna kopieras in och buntas före deploy:

```bash
npm run functions:build
```

```bash
supabase functions deploy citygross-sync
```

### Secrets

```bash
supabase secrets set CITYGROSS_STORE_NUMBER=3230
```

`SUPABASE_URL` och `SUPABASE_SERVICE_ROLE_KEY` sätts automatiskt av Supabase.

### Första körningen

Utan produktdata kan inköpslistan inte prissättas. Logga in, gå till
**Diagnostik och tillsyn** och tryck **Kör inhämtning nu**.

Körningen tar flera minuter — en kategori i taget med en sekunds paus mellan
anropen, medvetet beskedligt mot City Gross. Resultatet syns i körningslistan.

Sidan kräver `profiles.is_admin`:

```sql
update public.profiles set is_admin = true where id = (
  select id from auth.users where email = 'din@epost.se'
);
```

---

## 4. Schemalagd synk

Nattlig hämtning via `pg_cron` och `pg_net`. Kör i SQL-editorn:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
```

Lägg service role-nyckeln i Vault i stället för i klartext i cron-jobbet:

```sql
select vault.create_secret('DIN_SERVICE_ROLE_KEY', 'service_role_key');
```

Schemalägg 03:15 varje natt — utanför både City Gross trafiktoppar och den tid
någon planerar sin vecka:

```sql
select cron.schedule(
  'citygross-nattsynk',
  '15 3 * * *',
  $$
  select net.http_post(
    url := 'https://DITT_REF.supabase.co/functions/v1/citygross-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'service_role_key'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 900000
  );
  $$
);
```

Kontrollera:

```sql
select jobname, schedule, active from cron.job;
```

```sql
select * from public.sync_runs order by started_at desc limit 5;
```

Ta bort:

```sql
select cron.unschedule('citygross-nattsynk');
```

---

## Lokalt

```bash
npm run dev
```

Dev-servern kör från roten (`base: '/'`), så basadressen aldrig behöver tänkas på
under utveckling. Byggd version testas med:

```bash
npm run build && npm run preview
```

---

## Checklista efter publicering

- [ ] Appen laddar på Pages-adressen
- [ ] Djuplänk fungerar: gå till `/inkopslista`, tryck F5
- [ ] Inloggning med lösenord fungerar
- [ ] Inloggningslänk via e-post fungerar (PKCE-flödet i produktion)
- [ ] Sortimentshämtningen har körts och katalogen har varor
- [ ] En veckomeny går att generera och en inköpslista att skapa
- [ ] Appen går att installera på hemskärmen (PWA-manifest och ikoner)
- [ ] Inköpslistan går att läsa och kryssa i med flygplansläge på
