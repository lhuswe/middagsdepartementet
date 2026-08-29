# City Gross-integrationen

Det finns ingen publik, dokumenterad API från City Gross. Det som finns är de
endpoints deras egen webbplats anropar, och de går att läsa utan inloggning.
Det här dokumentet beskriver vad som kartlagts, hur, och vad som gäller den dag
formatet ändras.

**Kartlagt 2026-08-28 mot `https://www.citygross.se`.**

---

## Endpoints

```
GET /api/v1/sites?siteTypeId=3
GET /api/v1/navigation
GET /api/v1/Loop54/search?searchQuery={q}&store={nr}&skip={n}&take={n}
GET /api/v1/Loop54/category/{kategoriId}/products?store={nr}&skip={n}&take={n}
GET /images/products/{filnamn}?w={bredd}
```

Söket drivs av Loop54, en svensk sökmotor för e-handel. Svaren är JSON.

### Butiker

`/api/v1/sites?siteTypeId=3` svarar `{ sites: [...] }` — **inte** en naken
array. 38 butiker, var och en med ett `storeNumber`.

**City Gross Sundsvall = `3230`.**

### Butiksnumret är inte valfritt

Utan `store` i frågan får man rikspriser och `stockStatus: null`. Det senare är
den farliga delen: `null` betyder *okänd* lagerstatus, och en app som tolkar det
som "finns" ljuger för användaren. Skicka alltid butik.

### Kategoriträdet

`/api/v1/navigation` svarar `{ data: { tree: ... } }` där `tree` är **en enda
rotnod**, inte en array. Dess `children` är sajtens huvudsektioner. Noden med
`id: 69` är "Matvaror"; noder med `type: "ProductCategoryPage"` listar produkter.

Avdelningarna som synkas (`FOOD_DEPARTMENT_IDS` i `citygross.ts`):

| id | Avdelning | | id | Avdelning |
|---|---|---|---|---|
| 1493 | Kött & fågel | | 1504 | Chark & pålägg |
| 1448 | Frukt & grönt | | 1505 | Fisk & skaldjur |
| 1503 | Mejeri, ost & ägg | | 1506 | Kyld färdigmat |
| 1507 | Skafferiet | | 3473 | Vegetariskt |
| 1511 | Fryst | | 1510 | Dryck |
| 1502 | Bröd & bageri | | 23453 | Hushåll |

Kampanjkategorier: `2930` Veckans erbjudanden, `25908` Klipp varje dag,
`22193` Köp fler spara mer, `23842` PRIO-priser.

Resten av trädet är säsongssidor ("Lucia", "Kräftskiva") som pekar på samma
varor en gång till.

---

## Fyra fällor i produktformatet

Alla fyra upptäcktes mot skarp data, inte i förväg.

### 1. `netContent.unitOfMeasure` går inte att lita på

Fältet är `0` för **både** gram och milliliter. Verifierat: `"390G"` och
`"1,5L"` har båda `unitOfMeasure: 0`.

Sanningskällan är textsträngen `descriptiveSize`, som parsas i
`parseDescriptiveSize()`. Den hanterar svenskt decimalkomma (`"1,17KG"`) och
cirkavikter (`"CA600G"`).

### 2. Två sätt att sälja samma sorts vara

`sellingUnitOfMeasure` är `1` för styckvara (pris per förpackning, `unit: "PCE"`)
och `2` för lösvikt (pris per kilo, `unit: "KGM"`).

"Tomater Kvist CA 160G" beställs i antal men **betalas per kilo**. Ett
förpackningsval som bara kan räkna hela förpackningar ger fel svar för hela
frukt- och gröntavdelningen.

### 3. Kampanjer med minimiantal

Den vanligaste kampanjformen är `effectType: "ItemsTotal"` — "3 för 28 kr" —
där `value` är priset för **hela gruppen** och `minQuantity` antalet som krävs.

Rabatten gäller inte om man köper två. En prisberäkning som inte modellerar det
underskattar systematiskt notan. `maxAppliedPerReceipt` begränsar hur många
grupper som får rabatteras (`0` = obegränsat).

Okända `effectType` ignoreras och ordinarie pris används. Att bli positivt
överraskad i kassan är acceptabelt; motsatsen är det inte.

### 4. Header-värden måste vara ren ASCII

En user-agent med ett svenskt `å` ger **400 Bad Request** från deras edge.
Felet ser ut som ett generellt integrationshaveri och tog lång tid att hitta.
`assertAscii()` fångar det numera vid källan.

---

## Fält som är bättre än väntat

- **`comparativePrice`** — jämförpriset är färdigberäknat. Ingen anledning att
  räkna kr/kg själv.
- **`bfCategoryCode`** — hierarkisk kategorikod (`10183602` = Skafferiet ›
  Konserver › Tomatkonserver). Används både för att filtrera bort felaktiga
  matchningar och för att avgöra om två kandidater är samma sorts vara.
- **`gtin`** — EAN-koden är en stabil nyckel över tid. `id` innehåller ett
  suffix för säljenhet (`_ST`, `_KG`) och duger sämre.
- **`allergens`** — finns, men är tomt för de allra flesta varor. Se nedan.

## Allergener

`foodAndBeverageExtension.allergenInformation.allergens` innehåller ibland
`[{ typeCode: "Mjölk", levelOfContainment: 0 }]`, men är oftast `null`.

Appen tolkar `null` som **okänt** — aldrig som "fri från". Eftersom fältet är
tomt så ofta betyder det att `OKÄND` visas för nästan allt, och det är avsikten.
Appen får inte, och gör inte, anspråk på att vara ett allergiskydd.

---

## Hämtningsetikett

`robots.txt` disallowar `/mina-sidor/` och `/loop54/`. API-vägen
`/api/v1/Loop54/` matchar inte det prefixet bokstavligt, men avsikten är tydlig
nog att den förtjänar respekt. Villkoren kan dessutom säga saker om automatiserad
åtkomst.

Avvägningen som gjorts, för en privat app i ett hushåll:

- **En hämtning per dygn**, inte per inköpslista. Katalogen läses till Postgres
  och appen matchar mot kopian.
- **Max ett anrop per sekund**, sekventiellt, `take=100`.
- **Egen user-agent** (`Middagsdepartementet/1.0`) som identifierar appen — det
  är billigare att bli kontaktad än blockerad.
- **Aldrig från webbläsaren.** All hämtning sker i en Edge Function.
- **Ingen bypass** av inloggning, CAPTCHA eller bot-skydd. Endast publika,
  oautentiserade endpoints.

Skalas appen upp till fler användare bör det här omprövas.

---

## När formatet ändras

Det kommer att hända. Två saker begränsar skadan:

**`GroceryProvider`-gränssnittet** (`src/services/grocery/provider.ts`) gör att
det finns exakt ett ställe att laga — `CityGrossProvider`. Resten av appen vet
inte var produkterna kommer ifrån.

**Live-testerna** säger till innan användaren märker något:

```bash
npm run test:live
```

De körs aldrig i CI, eftersom de beror på någon annans produktionsmiljö. Kör dem
när något ser konstigt ut, eller med jämna mellanrum. De kontrollerar att
Sundsvall fortfarande är `3230`, att priser och lagerstatus är butiksspecifika,
att förpackningsstorlekar tolkas i rätt enhet, och att kategoriträdet går att
läsa.

`pipeline.live.test.ts` går ett steg längre och bygger en hel inköpslista av
fem middagar mot skarp data. Den skriver ut listan, eftersom siffror som ser fel
ut för ett mänskligt öga är fel även när alla assertions passerar.
