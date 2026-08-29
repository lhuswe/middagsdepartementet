# Arkitektur

```
src/features/       gränssnitt, en mapp per område
        ↓
src/services/       datalager mot Supabase och City Gross
        ↓
src/domain/         ren TypeScript - all matte, noll beroenden
        ↓
Supabase            Postgres med RLS
        ↓
supabase/functions/ Edge Functions → City Gross
```

Regeln uppåt i stacken: **`src/domain/` importerar ingenting.** Inte React, inte
Supabase, inte `fetch`. Det är därför den går att testa utan att starta något,
och därför samma kod kan köras i webbläsaren och i en Deno-funktion.

---

## Domänlagret

Här bor allt som avgör vad som hamnar i kundvagnen.

| Modul | Ansvar |
|---|---|
| `units.ts` | Enhetskonvertering med spårad osäkerhet |
| `ingredients.ts` | Ingredienskatalog: alias, styckvikter, densiteter |
| `aggregate.ts` | Receptskalning, hopslagning, skafferiavdrag |
| `packaging.ts` | Förpackningsval - styckvara och lösvikt |
| `promotions.ts` | Kampanjberäkning |
| `matching.ts` | Ingrediens → produkt |
| `shopping-list.ts` | Pipelinen som binder ihop alltihop |
| `planner.ts` | Regelbaserad veckoplanerare |

### Osäkerhet är en förstaklassmedborgare

Varje omräkning bär med sig hur säker den är:

- `exact` - samma dimension, ren faktor (kg→g, dl→ml)
- `estimated` - styckvikt eller densitet, med intervall (1 lök → 110 g, 80-150)
- `unknown` - data saknas

Den svagaste länken vinner genom hela kedjan, och `estimated`/`unknown` syns i
gränssnittet. Appen får gissa. Den får inte gissa tyst.

### Enhetskonverteringen är hela poängen

Ett recept säger "3 gula lökar". Butiken säljer "Gul lök 1kg". Utan en styckvikt
går de två inte att jämföra, och utan densiteter går "3 dl vetemjöl" inte att
möta mot "Vetemjöl 2kg".

Varje ingrediens har en **kanonisk enhet** - potatis i gram, grädde i milliliter.
Att välja per ingrediens i stället för globalt gör att "5 dl grädde" och "2 dl
grädde" kan summeras utan att gå via en densitet som inte behövs.

### Ingen avrundning förrän i sista steget

Recept skalas rationellt: 1,5 lökar förblir 1,5 lökar. Först i `packaging.ts`
möter behovet verkligheten. Att avrunda tidigt ackumulerar fel över veckans alla
recept.

### Förpackningsvalet har två grenar

**Styckvara** (`PCE`): antalet måste bli ett heltal, överköp är oundvikligt.
Alternativ med orimligt överköp (> 50 % av behovet) väljs bort som förval även
när de är billigast - men finns kvar i produktväljaren.

**Lösvikt** (`KGM`): mängden är fritt valbar, inget överköp uppstår.

En liten tolerans (5 %, dock högst 25 g) gör att ett recept på 400 g krossade
tomater täcks av en 390-grams burk. Det absoluta taket är det som gör jobbet:
5 % av ett kilo köttfärs är 50 gram, vilket är en verklig brist i grytan.

### Matchning: kurerade regler, inte semantik

Originalspecen bad om semantisk matchning och varnade samtidigt för att `mjölk`
inte får bli `chokladmjölk`. Det är motsägelsefullt - textlikhet gör precis det
felet, eftersom "chokladmjölk" innehåller "mjölk".

I stället: en regeltabell för de ingredienser som faktiskt är tvetydiga, plus
City Gross egen kategorihierarki som filter. Regeln för mjölk kräver
mejerikategorin och utesluter `/choklad/`. Deterministiskt och testbart.

Ovanpå det en global spärr mot avdelningar som aldrig kan vara mat. Den
tillkom efter att en sökning på "nötfärs" gav *"Nötfärs i Sås För Kastrerad
Katt"* - utmärkt namnlikhet, fel kategori.

**Det som gör matchningen bra över tid är inte algoritmen utan återkopplingen.**
Varje produktval sparas i `ingredient_product_mappings` och blir `confirmed`
nästa vecka.

---

## Medvetna avsteg från den ursprungliga planen

### Inköpslistan genereras i klienten, inte i en Edge Function

Planen listade `generate-shopping-list` som Edge Function. Domänlogiken är ren
TypeScript och all data skyddas redan av RLS, så en serverrunda hade bara lagt
till latens och ett andra ställe att hålla i synk. City Gross nås fortfarande
enbart från servern - via nattsynken.

`citygross-search` finns kvar som planerad Edge Function för fall där katalogen
saknar träff, men produktväljaren söker i första hand i den synkade kopian.

### Ingredienskatalogen finns på två ställen, med en sanningskälla

`src/domain/ingredients.ts` är originalet. Databaskopian genereras av
`scripts/generate-seed.ts`. Att skriva den två gånger för hand vore ett löfte om
att de glider isär.

Samma princip för Edge Functions: `scripts/prepare-functions.ts` kopierar
domänmodulerna till en platt `_lib`-mapp och skriver om importsökvägarna, och
`scripts/build-functions.ts` buntar det hela med esbuild. `_lib/` och `dist/`
under funktionerna är genererade och gitignorerade.

### Veckoplaneraren är regelbaserad

Uppgiften är "välj sju rätter ur trettio utan att upprepa dig, med hänsyn till
vad någon tycker illa om". Det är en sorteringsuppgift, inte en språkuppgift.
Regler ger samma svar två gånger, går att testa, och kostar ingenting att köra.

`AIProvider` är förberedd och kan ta över *urvalet*. Kvantitetsmatten ska förbli
deterministisk oavsett.

---

## Gränssnittslagret

Sidorna laddas var för sig med `React.lazy`. Huvudpaketet är 212 kB (67 kB
gzippat); appen används på mobil i butik, och det som inte laddas är det
billigaste som finns.

Formspråket är dämpat av funktionella skäl: appen ska gå att läsa med en
kundvagn i ena handen i ett butiksljus som inte är någons vän. Minsta träffyta
är 44 px överallt, och 28 px kryssrutor i handlingsläget.

### Tonläge

Den torra myndighetssvenskan bor i namnet, i tomma lägen ("Inget lagerförs för
närvarande"), i laddningstexter ("Ärendet bereds") och på adminsidan
("Diagnostik och tillsyn").

Den bor **inte** i navigationen, i knappar, eller i handlingsläget - där ska man
hitta snabbt. Och varningar om osäkra priser, otillgängliga produkter eller
okänd allergiinformation formuleras alltid rakt. Ett skämt får aldrig göra en
varning otydlig.

---

## Testning

166 tester, inga beroenden på nätverk eller databas.

| Vad | Var |
|---|---|
| Domänlogik | `src/domain/*.test.ts` |
| Acceptanstest, hela kedjan | `packaging.test.ts` |
| City Gross-mappning mot verkliga svar | `citygross.test.ts` |
| Sidrendering med och utan data | `src/test/sidor.test.tsx` |
| Mot skarp City Gross | `*.live.test.ts` - körs aldrig i CI |

Sidtesterna finns eftersom sidorna bakom inloggningen inte går att klicka igenom
utan ett konto. De monterar varje sida två gånger - med data och helt utan - och
kräver att båda renderar något begripligt. De ersätter inte en människa som
använder appen, men de ser till att första klicket inte möts av en vit skärm.
