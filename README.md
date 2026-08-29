# Departementet för middagsfrågor

*Samordnad livsmedelsförsörjning för hushållet.*

En privat webbapp som planerar veckans middagar och översätter dem till en
inköpslista med **verkliga produkter, verkliga förpackningsstorlekar och
verkliga priser** från City Gross.

Skillnaden mot en vanlig matsedelsapp är sista steget. En lista som säger
"potatis, 1 kg" hjälper inte i butiken. Den här appen säger *"Potatis Mjölig,
0,9 kg lösvikt, 12,55 kr"* - och vet skillnaden mellan att köpa 2 × 500 g och
1 × 1 kg.

---

## Vad appen gör

| | |
|---|---|
| **Veckoplanerare** | Genererar en matsedel ur receptsamlingen med hänsyn till tillagningstid, allergier, vad ni inte tycker om, och vad ni åt förra veckan. Regelbaserad - samma frö ger samma plan. |
| **Inköpslista** | Skalar recepten till rätt antal portioner, slår ihop ingredienser, drar av skafferiet, matchar mot City Gross sortiment, väljer förpackning och räknar pris. |
| **Handlingsläge** | Stora kryssrutor, kryssade varor sjunker till botten, "visa bara kvarvarande", egna rader. Byggt för att användas med en hand. |
| **Skafferi** | Det som finns hemma dras av innan produkterna väljs. |
| **Veckans fynd** | Kampanjvaror i din butik, och möjligheten att bygga matsedeln runt dem. |
| **Budget** | Veckobudget med planerat och kvarvarande. |

## Det appen inte gör

- **Den är inget allergiskydd.** City Gross anger sällan allergener för sina
  produkter. Appen markerar sådana varor som `OKÄND` och kontrollerar dem aldrig
  åt dig. Läs alltid förpackningen.
- **Priserna är uppskattningar** från senaste sortimentshämtningen, inte kvitton.
  Tidpunkten visas alltid tillsammans med summan.
- **Lagerstatus** speglar City Gross onlinesortiment, inte hyllan i butiken.
- **Poster utan pris räknas inte in i summan**, och antalet sådana redovisas
  separat. En uppskattning som utger sig för att vara komplett är värre än ingen.

---

## Kom igång från noll

### 1. Klona och installera

```bash
npm install
```

### 2. Skapa ett Supabase-projekt

Skapa ett projekt på [supabase.com](https://supabase.com). Free tier räcker för
ett hushåll.

### 3. Kör migrationerna

Med [Supabase CLI](https://supabase.com/docs/guides/local-development):

```bash
supabase link --project-ref DITT_PROJEKT_REF
```

```bash
supabase db push
```

Migrationerna i `supabase/migrations/` körs i ordning och skapar schema, RLS,
ingredienskatalogen och samtliga City Gross-butiker.

### 4. Konfigurera autentisering

I Supabase-panelen under **Authentication → URL Configuration**:

- **Site URL**: `https://<ditt-användarnamn>.github.io/middagsdepartementet/`
- **Redirect URLs**: lägg till samma adress och `http://localhost:5173/`

Appen använder PKCE-flödet. Se `src/lib/supabase.ts` för varför det inte är
valfritt.

### 5. Sätt miljövariabler

```bash
cp .env.example .env.local
```

Fyll i `VITE_SUPABASE_URL` och `VITE_SUPABASE_ANON_KEY` från Supabase-panelen
under **Project Settings → API**. Båda är publika värden - skyddet ligger i RLS.

### 6. Skapa ditt konto

Appen har ingen självregistrering. Skapa användaren i Supabase-panelen under
**Authentication → Users → Add user**, och kryssa i *Auto Confirm User*.

Ge dig själv administratörsbehörighet så att du kommer åt diagnostiksidan:

```sql
update public.profiles set is_admin = true where id = (
  select id from auth.users where email = 'din@epost.se'
);
```

### 7. Kör igång

```bash
npm run dev
```

Logga in, gå igenom de sex onboardingstegen, och **kör en sortimentshämtning**
från *Diagnostik och tillsyn*. Utan den är produktkatalogen tom och
inköpslistan kan inte prissättas. Första körningen tar några minuter.

### 8. Publicera

Se [DEPLOYMENT.md](docs/DEPLOYMENT.md).

---

## Kommandon

```bash
npm run dev              # utvecklingsserver
```

```bash
npm test                 # 166 tester: domänlogik, matchning, sidrendering
```

```bash
npm run test:live        # tester mot riktiga City Gross (körs aldrig i CI)
```

```bash
npm run typecheck        # tsc över hela projektet
```

```bash
npm run build            # produktionsbygge till dist/
```

```bash
npm run functions:build  # buntar Edge Functions inför deploy
```

```bash
npm run seed:generate    # genererar ingrediens-seed ur src/domain/ingredients.ts
```

---

## Så är det byggt

```
src/features/   gränssnitt
src/services/   datalager mot Supabase och City Gross
src/domain/     ren TypeScript - all matte, inga beroenden
supabase/       migrationer och Edge Functions
```

`src/domain/` är kärnan och känner varken till React, Supabase eller nätverk.
Enhetskonvertering, receptskalning, skafferiavdrag, förpackningsoptimering,
kampanjberäkning och produktmatchning bor där, och testas utan att något
behöver startas. Det är också där buggarna hade gjort mest skada.

Läs vidare i [ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Dokumentation

| Dokument | Innehåll |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Lagerindelning, domänlogik, medvetna avsteg |
| [CITYGROSS-INTEGRATION.md](docs/CITYGROSS-INTEGRATION.md) | Endpoints, fältfällor, hämtningsetikett |
| [DATABASE.md](docs/DATABASE.md) | Schema och varför det ser ut som det gör |
| [SECURITY.md](docs/SECURITY.md) | RLS-modell, hemligheter, antaganden |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | GitHub Pages, Edge Functions, schemalagd synk |
| [HUSHALL.md](docs/HUSHALL.md) | Förslag: flera personer på samma inköpslista |

## Kända begränsningar

- Allergidata från City Gross är gles → appen är ingen allergisäkerhet.
- Prishistoriken börjar vid första synken och har inga data bakåt i tiden.
- Styckvikter (1 gul lök ≈ 110 g) är uppskattningar med intervall, inte mätvärden.
- Skafferiavdrag gäller inte behov som anges i hela förpackningar ("2 burkar").
- City Gross API är odokumenterat och kan ändras utan förvarning. `npm run
  test:live` säger till när det händer.
- AI-driven menygenerering är förberedd men inte inkopplad. V1 är regelbaserad.
