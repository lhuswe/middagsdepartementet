/**
 * Produktmatchning — från ingrediens till en faktisk vara i hyllan.
 *
 * Originalspecen bad om "semantisk ingrediensmatchning" och varnade samtidigt
 * för att `mjölk` inte får bli `chokladmjölk` och `grädde` inte `gräddfil`.
 * Det är motsägelsefullt: ren textlikhet gör precis de felen, eftersom
 * "chokladmjölk" innehåller "mjölk".
 *
 * Lösningen här är enklare och mer träffsäker än en generisk matchare: en
 * kurerad regeltabell för de ingredienser som faktiskt är tvetydiga, plus
 * City Gross egen kategorihierarki som filter. Regeln för mjölk säger att
 * varan måste ligga i mejerikategorin *och* inte innehålla "choklad" — och då
 * är problemet borta, deterministiskt och testbart.
 *
 * Resten sköts av tokenöverlapp, vilket räcker gott för entydiga ingredienser.
 *
 * Det som gör matchningen bra över tid är inte algoritmen utan återkopplingen:
 * varje gång användaren väljer produkt i produktväljaren sparas valet och blir
 * `confirmed` nästa vecka.
 */

import type { Ingredient, Product } from './types.ts'

export interface MatchRule {
  /** Söktermer som skickas till katalogen. Första är den viktigaste. */
  searchTerms: string[]
  /**
   * Varan måste ligga under någon av dessa kategorier i City Gross hierarki.
   * Matchas skiftlägesokänsligt mot hela kategorisökvägen.
   */
  allowedCategories?: string[]
  /** Varans namn måste innehålla minst ett av dessa mönster. */
  require?: RegExp[]
  /** Varans namn får inte innehålla något av dessa mönster. */
  exclude?: RegExp[]
  /** Ger extra poäng, men är inte ett krav. */
  prefer?: RegExp[]
  /** Förväntad förpackningsenhet. Fel enhet är ett starkt varningstecken. */
  expectedUnit?: 'g' | 'ml'
}

export type MatchConfidence =
  /** Användarens egen sparade mappning eller favoritprodukt. */
  | 'confirmed'
  /** Tydlig vinnare med god marginal. */
  | 'probable'
  /** Flera jämnbra kandidater — fråga användaren, välj aldrig tyst. */
  | 'ambiguous'
  /** Kandidater fanns men ingen är tillgänglig i butiken. */
  | 'unavailable'
  /** Inget att gå på. */
  | 'unknown'

export interface ScoredProduct {
  product: Product
  score: number
  /** Varför produkten fick sin poäng. Visas i adminsidans matchningstestare. */
  reasons: string[]
}

export interface MatchResult {
  confidence: MatchConfidence
  /** Kandidater, bäst först. */
  candidates: ScoredProduct[]
  best: Product | null
  note?: string
}

/** Lägsta poäng för att över huvud taget räknas som en kandidat. */
const MIN_SCORE = 30
/** Poängmarginal som krävs för att en vinnare ska räknas som tydlig. */
const CLEAR_WINNER_MARGIN = 15
/**
 * Poäng där kandidaten är så tydligt rätt att den vinner även om en syskonvara
 * ligger nära. Utan detta blir nästan varje verklig sökning "tvetydig", för i
 * ett riktigt sortiment finns det alltid tre snarlika burkar.
 */
const STRONG_MATCH_SCORE = 65

/**
 * Avdelningar som aldrig innehåller en matingrediens.
 *
 * Nödvändigt av ett skäl som upptäcktes mot skarp data: sökningen på "nötfärs"
 * returnerade "Nötfärs i Sås För Kastrerad Katt". Textlikheten var utmärkt.
 * Kategorin var kattmat.
 */
const NEVER_FOOD_CATEGORIES = [
  'husdjur',
  'hem & städ',
  'hem & fritid',
  'skönhet',
  'hygien',
  'husapotek',
  'hälsa',
  'tobak',
  'blommor',
  'köket',
  'lego',
]

/**
 * Kurerade regler för de ingredienser där ren namnlikhet gör fel.
 *
 * Tabellen behöver bara täcka de tvetydiga fallen — allt annat klarar sig på
 * tokenöverlapp. Att lägga till en rad här är det normala sättet att rätta en
 * felmatchning.
 */
export const MATCH_RULES: Record<string, MatchRule> = {
  mjolk: {
    searchTerms: ['mellanmjölk', 'standardmjölk'],
    allowedCategories: ['mejeri', 'mjölk'],
    require: [/mjölk/i],
    // Specens eget exempel: mjölk får aldrig bli chokladmjölk.
    exclude: [/choklad/i, /havre/i, /soja/i, /mandel/i, /ris(dryck)?\b/i, /kokos/i, /surmjölk/i, /filmjölk/i],
    expectedUnit: 'ml',
  },
  vispgradde: {
    searchTerms: ['vispgrädde'],
    allowedCategories: ['mejeri', 'grädde'],
    require: [/grädde/i],
    // Specens andra exempel: grädde får inte bli gräddfil.
    exclude: [/gräddfil/i, /crème/i, /creme/i, /matlagningsgrädde/i, /kaffegrädde/i, /havre/i],
    expectedUnit: 'ml',
  },
  matlagningsgradde: {
    searchTerms: ['matlagningsgrädde'],
    allowedCategories: ['mejeri'],
    require: [/matlagningsgrädde/i],
    exclude: [/gräddfil/i, /havre/i],
    expectedUnit: 'ml',
  },
  graddfil: {
    searchTerms: ['gräddfil'],
    allowedCategories: ['mejeri'],
    require: [/gräddfil/i],
    expectedUnit: 'ml',
  },
  creme_fraiche: {
    searchTerms: ['crème fraiche'],
    allowedCategories: ['mejeri'],
    require: [/cr[eè]me\s*fraiche/i],
    expectedUnit: 'ml',
  },
  krossade_tomater: {
    searchTerms: ['krossade tomater'],
    allowedCategories: ['konserv', 'tomatkonserver'],
    require: [/tomat/i],
    exclude: [/soltorkad/i, /puré/i, /pure/i, /ketchup/i, /passerad/i],
    prefer: [/krossad/i],
    expectedUnit: 'g',
  },
  tomatpure: {
    searchTerms: ['tomatpuré'],
    // City Gross lägger tomatpuré under Skafferiet, inte alltid under Konserver.
    allowedCategories: ['konserv', 'skafferi'],
    require: [/tomatpur[eé]/i],
    expectedUnit: 'g',
  },
  vitlok: {
    // Recepten säger "vitlöksklyfta", men ingen produkt heter så.
    searchTerms: ['vitlök'],
    allowedCategories: ['frukt', 'grönt'],
    require: [/vitlök/i],
    // "Vitlök Kapsel" är kosttillskott, inte en vitlök.
    exclude: [/pulver/i, /salt/i, /kryddblandning/i, /kapsel/i, /tablett/i,
              /pur[eé]/i, /pressad/i, /krossad/i],
    expectedUnit: 'g',
  },
  falukorv: {
    searchTerms: ['falukorv'],
    allowedCategories: ['chark', 'korv'],
    require: [/falukorv/i],
    expectedUnit: 'g',
  },
  laxfile: {
    searchTerms: ['laxfilé'],
    allowedCategories: ['fisk', 'skaldjur'],
    require: [/laxfil[eé]/i],
    // "Pinklaxfilé i solrosolja" är konserv, inte färsk lax till ugnen.
    exclude: [/pinklax/i, /konserv/i, /olja/i, /rökt/i, /gravad/i, /pastej/i,
              /kaviar/i, /pate/i, /paté/i],
    expectedUnit: 'g',
  },
  blandfars: {
    searchTerms: ['blandfärs', 'nötfärs'],
    allowedCategories: ['kött', 'färs'],
    require: [/färs/i],
    exclude: [/fläskfärs/i, /kycklingfärs/i, /kalkonfärs/i, /vegetarisk/i, /sojafärs/i, /färsk/i],
    expectedUnit: 'g',
  },
  kycklingfile: {
    searchTerms: ['kycklingfilé'],
    allowedCategories: ['kött', 'fågel', 'kyckling'],
    // Kravet måste vara "filé", inte bara "kyckling" — annars vinner
    // Kycklingmage på namnlikhet. Verifierat mot skarp data.
    require: [/kycklingfil[eé]/i, /kyckling.*bröstfil[eé]/i],
    exclude: [/mage/i, /lever/i, /hjärta/i, /lår/i, /klubb/i, /vinge/i, /ben/i,
              /panerad/i, /marinerad/i, /grillad/i, /rökt/i],
    expectedUnit: 'g',
  },
  smor: {
    searchTerms: ['smör'],
    allowedCategories: ['mejeri'],
    require: [/smör/i],
    exclude: [/smörgås/i, /jordnötssmör/i, /bregott/i, /margarin/i],
    expectedUnit: 'g',
  },
  ost_riven: {
    searchTerms: ['riven ost'],
    allowedCategories: ['ost', 'mejeri'],
    require: [/ost/i],
    prefer: [/riven/i],
    exclude: [/färskost/i, /mögelost/i, /dessert/i],
    expectedUnit: 'g',
  },
  potatis: {
    searchTerms: ['potatis'],
    allowedCategories: ['frukt', 'grönt', 'potatis'],
    require: [/potatis/i],
    exclude: [/sötpotatis/i, /potatismos/i, /potatismjöl/i, /chips/i, /pommes/i, /gratäng/i],
    expectedUnit: 'g',
  },
  gul_lok: {
    searchTerms: ['gul lök'],
    allowedCategories: ['frukt', 'grönt'],
    require: [/lök/i],
    exclude: [/rödlök/i, /purjo/i, /vitlök/i, /salladslök/i, /schalotten/i, /rostad/i],
    expectedUnit: 'g',
  },
  ris: {
    searchTerms: ['ris'],
    allowedCategories: ['skafferi', 'ris'],
    require: [/\bris\b/i],
    exclude: [/risotto/i, /grynris/i, /riskaka/i, /risgryn/i],
    expectedUnit: 'g',
  },
  rapsolja: {
    searchTerms: ['rapsolja'],
    allowedCategories: ['skafferi'],
    require: [/olja/i],
    exclude: [/olivolja/i, /sesam/i, /tryffel/i],
    expectedUnit: 'ml',
  },
}

/** Delar upp en sträng i jämförbara ord. */
function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-zà-öø-ÿ0-9\s]/gi, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2)
}

function categoryHaystack(product: Product): string {
  return [...product.categoryPath, product.name].join(' ').toLowerCase()
}

/**
 * Poängsätter en produkt mot en ingrediens.
 * Returnerar `null` när produkten diskvalificerats av en exkluderingsregel.
 */
export function scoreProduct(
  product: Product,
  ingredient: Ingredient,
  rule: MatchRule | undefined,
): ScoredProduct | null {
  const reasons: string[] = []
  let score = 0

  const name = product.name.toLowerCase()
  const fullName = `${product.name} ${product.subtitle}`.toLowerCase()

  const haystack = categoryHaystack(product)
  if (NEVER_FOOD_CATEGORIES.some((category) => haystack.includes(category))) {
    return null
  }

  if (rule?.exclude?.some((pattern) => pattern.test(fullName))) {
    return null
  }

  if (rule?.require && !rule.require.some((pattern) => pattern.test(fullName))) {
    return null
  }

  if (rule?.allowedCategories) {
    const hit = rule.allowedCategories.some((category) => haystack.includes(category.toLowerCase()))
    if (hit) {
      score += 40
      reasons.push('rätt kategori')
    } else {
      score -= 25
      reasons.push('kategori stämmer inte')
    }
  }

  // Tokenöverlapp mellan ingrediensnamn (plus söktermer) och produktnamn.
  const wanted = new Set([
    ...tokenize(ingredient.name),
    ...(rule?.searchTerms ?? []).flatMap(tokenize),
  ])
  const found = new Set(tokenize(name))
  const shared = [...wanted].filter((token) => found.has(token))
  if (wanted.size > 0) {
    const overlap = shared.length / wanted.size
    const points = Math.round(overlap * 35)
    if (points > 0) {
      score += points
      reasons.push(`namnmatch ${Math.round(overlap * 100)} %`)
    }
  }

  if (rule?.prefer?.some((pattern) => pattern.test(fullName))) {
    score += 12
    reasons.push('föredraget utförande')
  }

  if (product.netContent) {
    score += 5
    if (rule?.expectedUnit && product.netContent.unit !== rule.expectedUnit) {
      score -= 25
      reasons.push('oväntad förpackningsenhet')
    }
  } else {
    score -= 10
    reasons.push('storleken gick inte att tolka')
  }

  if (product.inStock === false) {
    score -= 40
    reasons.push('slut i butiken')
  } else if (product.inStock === true) {
    score += 8
  }

  return { product, score, reasons }
}

export interface MatchOptions {
  /** Användarens sparade mappning: ingrediens → GTIN. Ger `confirmed`. */
  savedGtin?: string
  /** Användarens favoritprodukt för ingrediensen. Ger också `confirmed`. */
  favoriteGtin?: string
}

/**
 * Matchar en ingrediens mot kandidatprodukter.
 *
 * Väljer aldrig tyst mellan jämnbra alternativ — då returneras `ambiguous`
 * och gränssnittet får fråga. Det är hela skillnaden mot att gissa.
 */
export function matchIngredient(
  ingredient: Ingredient,
  products: Product[],
  options: MatchOptions = {},
): MatchResult {
  const rule = MATCH_RULES[ingredient.id]

  const scored = products
    .map((product) => scoreProduct(product, ingredient, rule))
    .filter((entry): entry is ScoredProduct => entry !== null)
    .sort((a, b) => b.score - a.score)

  const pinned = options.savedGtin ?? options.favoriteGtin
  if (pinned) {
    const match = scored.find((entry) => entry.product.gtin === pinned)
    if (match) {
      return {
        confidence: 'confirmed',
        candidates: [match, ...scored.filter((entry) => entry !== match)],
        best: match.product,
        note: options.savedGtin
          ? 'Tidigare val för den här ingrediensen.'
          : 'Din favoritprodukt.',
      }
    }
  }

  const viable = scored.filter((entry) => entry.score >= MIN_SCORE)

  if (viable.length === 0) {
    return {
      confidence: scored.length > 0 ? 'unknown' : 'unavailable',
      candidates: scored.slice(0, 5),
      best: null,
      note:
        scored.length > 0
          ? 'Ingen kandidat var tillräckligt säker.'
          : 'Ingen produkt matchade ingrediensen.',
    }
  }

  if (viable.every((entry) => entry.product.inStock === false)) {
    return {
      confidence: 'unavailable',
      candidates: viable,
      best: null,
      note: 'Matchande produkter finns men är slut i butiken.',
    }
  }

  const [first, second] = viable
  const clearOnScore = !second || first!.score - second.score >= CLEAR_WINNER_MARGIN
  const strong = first!.score >= STRONG_MATCH_SCORE

  // Två varianter av samma vara är ingen tvetydighet som kräver en människa —
  // det är ett prisbeslut, och det fattar förpackningsoptimeringen bättre än
  // användaren, eftersom den ändå väger alla kandidater mot varandra.
  // Bara genuint olika sorters vara ska stoppa listan.
  const sameProduct =
    second !== undefined &&
    (isSameProductName(first!.product, second.product) ||
      isSameCategory(first!.product, second.product))

  if (clearOnScore || strong || sameProduct) {
    return {
      confidence: 'probable',
      candidates: viable,
      best: first!.product,
    }
  }

  return {
    confidence: 'ambiguous',
    candidates: viable,
    best: null,
    note: 'Flera produkter passar lika bra — ärendet kräver manuell handläggning.',
  }
}

/** Samma vara i olika förpackning? Jämför namnet utan storlek och märke. */
function isSameProductName(a: Product, b: Product): boolean {
  const key = (product: Product) => tokenize(product.name).sort().join(' ')
  return key(a) === key(b)
}

/**
 * Samma sorts vara enligt City Gross egen kategorikod?
 *
 * Koden är hierarkisk (t.ex. 10183602 = Skafferiet > Konserver > Tomatkonserver),
 * så ett gemensamt prefix betyder att varorna hör till samma varugrupp. Två
 * krossade tomater från olika märken är då inget att fråga användaren om.
 */
function isSameCategory(a: Product, b: Product): boolean {
  if (!a.categoryCode || !b.categoryCode) return false
  const prefix = (code: string) => code.slice(0, 6)
  return prefix(a.categoryCode) === prefix(b.categoryCode)
}

/** Söktermer som ska skickas till katalogen för en ingrediens. */
export function searchTermsFor(ingredient: Ingredient): string[] {
  const rule = MATCH_RULES[ingredient.id]
  return rule?.searchTerms ?? [ingredient.name]
}
