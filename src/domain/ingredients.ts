/**
 * Ingredienskatalogen - appens normaliserade ordlista.
 *
 * Två saker gör den värd sin plats:
 *
 * 1. **Alias.** "köttfärs", "nötfärs" och "blandfärs" ska falla ut på samma
 *    rad i inköpslistan i stället för att bli tre.
 * 2. **Styckvikter och densiteter.** Det är det enda sättet att jämföra
 *    "3 gula lökar" med "Gul lök 1kg", eller "3 dl vetemjöl" med "Vetemjöl 2kg".
 *
 * Styckvikterna är uppskattningar med intervall, inte mätvärden. De är satta
 * för en medelstor vara i svensk dagligvaruhandel och räcker gott för att
 * avgöra hur många förpackningar man behöver - vilket är hela syftet.
 *
 * Den här filen är också sanningskällan för databasens seed. Se
 * `scripts/generate-seed.ts`.
 */

import type { Ingredient, ShoppingCategory } from './types.ts'

type IngredientSeed = Omit<Ingredient, 'id' | 'aliases' | 'staple'> & {
  aliases?: string[]
  staple?: boolean
}

function define(
  entries: Record<string, IngredientSeed>,
): Record<string, Ingredient> {
  const result: Record<string, Ingredient> = {}
  for (const [id, seed] of Object.entries(entries)) {
    result[id] = {
      id,
      aliases: seed.aliases ?? [],
      staple: seed.staple ?? false,
      ...seed,
    }
  }
  return result
}

/** Kortform för de vanligaste fallen, så tabellen nedan går att läsa. */
const g = (category: ShoppingCategory) => ({ canonicalUnit: 'g' as const, category })
const ml = (category: ShoppingCategory) => ({ canonicalUnit: 'ml' as const, category })

export const INGREDIENTS: Record<string, Ingredient> = define({
  // ── Kött & fågel ────────────────────────────────────────────────────────
  blandfars: {
    name: 'blandfärs',
    aliases: ['köttfärs', 'nötfärs', 'färs', 'blandfärs 50/50'],
    ...g('kott-fagel'),
  },
  notkott_gryta: {
    name: 'grytbitar av nöt',
    aliases: ['grytbitar', 'högrev', 'nötkött i bitar'],
    ...g('kott-fagel'),
  },
  flaskkarre: { name: 'fläskkarré', aliases: ['karré'], ...g('kott-fagel') },
  flaskfile: { name: 'fläskfilé', ...g('kott-fagel') },
  kycklingfile: {
    name: 'kycklingfilé',
    aliases: ['kycklingbröstfilé', 'kyckling'],
    ...g('kott-fagel'),
  },
  kycklinglarfile: {
    name: 'kycklinglårfilé',
    aliases: ['kycklinglår', 'lårfilé'],
    ...g('kott-fagel'),
  },
  bacon: { name: 'bacon', ...g('chark') },
  falukorv: {
    name: 'falukorv',
    pieceWeight: { grams: 800, min: 700, max: 900 },
    ...g('chark'),
  },
  prinskorv: { name: 'prinskorv', ...g('chark') },
  skinka_tarnad: {
    name: 'tärnad skinka',
    aliases: ['skinka', 'skinktärningar'],
    ...g('chark'),
  },
  flask_rimmat: { name: 'rimmat fläsk', aliases: ['sidfläsk'], ...g('chark') },

  // ── Fisk ────────────────────────────────────────────────────────────────
  laxfile: { name: 'laxfilé', aliases: ['lax'], ...g('fisk') },
  torskfile: { name: 'torskfilé', aliases: ['torsk', 'vit fisk'], ...g('fisk') },
  rakor: { name: 'räkor', ...g('fisk') },

  // ── Frukt & grönt ───────────────────────────────────────────────────────
  gul_lok: {
    name: 'gul lök',
    aliases: ['lök', 'lökar'],
    pieceWeight: { grams: 110, min: 80, max: 150 },
    ...g('frukt-gront'),
  },
  rodlok: {
    name: 'rödlök',
    pieceWeight: { grams: 100, min: 70, max: 140 },
    ...g('frukt-gront'),
  },
  purjolok: {
    name: 'purjolök',
    aliases: ['purjo'],
    pieceWeight: { grams: 250, min: 180, max: 350 },
    ...g('frukt-gront'),
  },
  vitlok: {
    name: 'vitlöksklyfta',
    aliases: ['vitlök', 'vitlöksklyftor'],
    pieceWeight: { grams: 3, min: 2, max: 5 },
    ...g('frukt-gront'),
  },
  potatis: {
    name: 'potatis',
    aliases: ['fast potatis', 'mjölig potatis'],
    pieceWeight: { grams: 100, min: 70, max: 140 },
    ...g('frukt-gront'),
  },
  morot: {
    name: 'morot',
    aliases: ['morötter'],
    pieceWeight: { grams: 85, min: 60, max: 120 },
    ...g('frukt-gront'),
  },
  palsternacka: {
    name: 'palsternacka',
    pieceWeight: { grams: 130, min: 90, max: 180 },
    ...g('frukt-gront'),
  },
  kalrot: {
    name: 'kålrot',
    pieceWeight: { grams: 700, min: 500, max: 1000 },
    ...g('frukt-gront'),
  },
  vitkal: {
    name: 'vitkål',
    pieceWeight: { grams: 1200, min: 900, max: 1800 },
    ...g('frukt-gront'),
  },
  broccoli: {
    name: 'broccoli',
    pieceWeight: { grams: 350, min: 250, max: 450 },
    ...g('frukt-gront'),
  },
  blomkal: {
    name: 'blomkål',
    pieceWeight: { grams: 600, min: 450, max: 800 },
    ...g('frukt-gront'),
  },
  tomat: {
    name: 'tomat',
    aliases: ['tomater'],
    pieceWeight: { grams: 110, min: 80, max: 150 },
    ...g('frukt-gront'),
  },
  paprika: {
    name: 'paprika',
    pieceWeight: { grams: 150, min: 120, max: 200 },
    ...g('frukt-gront'),
  },
  gurka: {
    name: 'gurka',
    pieceWeight: { grams: 350, min: 280, max: 450 },
    ...g('frukt-gront'),
  },
  salladshuvud: {
    name: 'salladshuvud',
    aliases: ['sallad', 'isbergssallad'],
    pieceWeight: { grams: 300, min: 200, max: 400 },
    ...g('frukt-gront'),
  },
  champinjoner: { name: 'champinjoner', aliases: ['svamp'], ...g('frukt-gront') },
  majs: { name: 'majs', ...g('konserver') },
  rodbetor: {
    name: 'inlagda rödbetor',
    aliases: ['rödbetor'],
    ...g('konserver'),
  },
  citron: {
    name: 'citron',
    pieceWeight: { grams: 100, min: 80, max: 130 },
    ...g('frukt-gront'),
  },
  persilja: { name: 'persilja', ...g('frukt-gront') },
  dill: { name: 'dill', ...g('frukt-gront') },
  graslok: { name: 'gräslök', ...g('frukt-gront') },

  // ── Mejeri & ägg ────────────────────────────────────────────────────────
  mjolk: {
    name: 'mjölk',
    aliases: ['mellanmjölk', 'standardmjölk', 'lättmjölk'],
    gramsPerDl: 103,
    ...ml('mejeri-agg'),
  },
  vispgradde: {
    name: 'vispgrädde',
    aliases: ['grädde'],
    gramsPerDl: 100,
    ...ml('mejeri-agg'),
  },
  matlagningsgradde: {
    name: 'matlagningsgrädde',
    gramsPerDl: 100,
    ...ml('mejeri-agg'),
  },
  creme_fraiche: { name: 'crème fraiche', gramsPerDl: 100, ...ml('mejeri-agg') },
  graddfil: { name: 'gräddfil', gramsPerDl: 100, ...ml('mejeri-agg') },
  smor: { name: 'smör', ...g('mejeri-agg'), staple: true },
  margarin: { name: 'margarin', aliases: ['bordsmargarin'], ...g('mejeri-agg') },
  ost_riven: {
    name: 'riven ost',
    aliases: ['ost', 'riven cheddar'],
    ...g('mejeri-agg'),
  },
  agg: {
    name: 'ägg',
    pieceWeight: { grams: 58, min: 53, max: 63 },
    ...g('mejeri-agg'),
  },

  // ── Skafferi ────────────────────────────────────────────────────────────
  spaghetti: { name: 'spaghetti', ...g('skafferi') },
  pasta: {
    name: 'pasta',
    aliases: ['penne', 'fusilli', 'makaroner'],
    ...g('skafferi'),
  },
  lasagneplattor: { name: 'lasagneplattor', ...g('skafferi') },
  ris: { name: 'ris', aliases: ['långkornigt ris'], gramsPerDl: 85, ...g('skafferi') },
  vetemjol: { name: 'vetemjöl', aliases: ['mjöl'], gramsPerDl: 60, ...g('skafferi'), staple: true },
  potatismjol: { name: 'potatismjöl', gramsPerDl: 70, ...g('skafferi'), staple: true },
  strobrod: { name: 'ströbröd', gramsPerDl: 50, ...g('skafferi'), staple: true },
  havregryn: { name: 'havregryn', gramsPerDl: 35, ...g('skafferi') },
  gula_artor: { name: 'gula ärtor', gramsPerDl: 85, ...g('skafferi') },
  socker: { name: 'socker', aliases: ['strösocker'], gramsPerDl: 85, ...g('skafferi'), staple: true },
  salt: { name: 'salt', gramsPerDl: 120, ...g('skafferi'), staple: true },
  peppar: { name: 'svartpeppar', aliases: ['peppar'], gramsPerDl: 45, ...g('skafferi'), staple: true },
  rapsolja: { name: 'rapsolja', aliases: ['olja', 'matolja'], gramsPerDl: 92, ...ml('skafferi'), staple: true },
  buljongtarning: {
    name: 'buljongtärning',
    aliases: ['buljong', 'köttbuljong', 'grönsaksbuljong', 'hönsbuljong'],
    pieceWeight: { grams: 10, min: 9, max: 12 },
    ...g('skafferi'),
    staple: true,
  },
  soja: { name: 'soja', gramsPerDl: 110, ...ml('skafferi'), staple: true },
  ketchup: { name: 'ketchup', gramsPerDl: 110, ...ml('skafferi'), staple: true },
  senap: { name: 'senap', gramsPerDl: 110, ...ml('skafferi'), staple: true },
  tomatpure: { name: 'tomatpuré', gramsPerDl: 110, ...g('konserver') },
  krossade_tomater: {
    name: 'krossade tomater',
    aliases: ['tomatkross', 'finkrossade tomater'],
    ...g('konserver'),
  },
  kokosmjolk: { name: 'kokosmjölk', ...ml('konserver') },
  kidneybonor: { name: 'kidneybönor', ...g('konserver') },
  lingonsylt: { name: 'lingonsylt', aliases: ['lingon', 'rårörda lingon'], ...g('skafferi') },
  curry: { name: 'curry', gramsPerDl: 40, ...g('skafferi'), staple: true },
  paprikapulver: { name: 'paprikapulver', gramsPerDl: 40, ...g('skafferi'), staple: true },
  timjan: { name: 'timjan', gramsPerDl: 20, ...g('skafferi'), staple: true },
  oregano: { name: 'oregano', gramsPerDl: 20, ...g('skafferi'), staple: true },
  lagerblad: { name: 'lagerblad', pieceWeight: { grams: 0.2, min: 0.1, max: 0.3 }, ...g('skafferi'), staple: true },
  kryddpeppar: { name: 'kryddpeppar', gramsPerDl: 45, ...g('skafferi'), staple: true },
  chilipulver: { name: 'chilipulver', gramsPerDl: 40, ...g('skafferi'), staple: true },
  spiskummin: { name: 'spiskummin', gramsPerDl: 40, ...g('skafferi'), staple: true },
  tacokrydda: { name: 'tacokrydda', gramsPerDl: 40, ...g('skafferi') },
  vinager: { name: 'ättika', aliases: ['vinäger'], gramsPerDl: 100, ...ml('skafferi'), staple: true },

  // ── Bröd ────────────────────────────────────────────────────────────────
  tortilla: {
    name: 'tortillabröd',
    pieceWeight: { grams: 45, min: 35, max: 65 },
    ...g('brod'),
  },
  knackebrod: { name: 'knäckebröd', ...g('brod') },

  // ── Frys ────────────────────────────────────────────────────────────────
  arter_frysta: { name: 'frysta ärter', aliases: ['ärter', 'gröna ärter'], ...g('frys') },
  spenat_fryst: { name: 'fryst spenat', aliases: ['spenat'], ...g('frys') },
})

/**
 * Uppslagstabell från namn och alias till ingrediens-id, för normalisering av
 * fritext. Byggs en gång vid modulladdning.
 */
const LOOKUP: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>()
  for (const ingredient of Object.values(INGREDIENTS)) {
    map.set(normalizeName(ingredient.name), ingredient.id)
    for (const alias of ingredient.aliases) {
      // Ett namn vinner alltid över ett alias. "lök" som alias till gul lök får
      // inte skriva över en framtida ingrediens som faktiskt heter "lök".
      const key = normalizeName(alias)
      if (!map.has(key)) map.set(key, ingredient.id)
    }
  }
  return map
})()

/**
 * Normaliserar ett ingrediensnamn för uppslagning: gemener, trimmat, utan
 * mängdangivelser och tillagningsanvisningar som råkat följa med.
 */
export function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/^(ca|cirka|ungefär)\s+/, '')
    .replace(/\s*,.*$/, '')
    .replace(/\s+/g, ' ')
}

/** Slår upp en ingrediens på namn eller alias. */
export function findIngredient(raw: string): Ingredient | undefined {
  const id = LOOKUP.get(normalizeName(raw))
  return id ? INGREDIENTS[id] : undefined
}

/** Hämtar en ingrediens på id. */
export function getIngredient(id: string): Ingredient | undefined {
  return INGREDIENTS[id]
}
