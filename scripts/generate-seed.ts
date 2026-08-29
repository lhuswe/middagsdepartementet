/**
 * Genererar SQL-seed för ingredienskatalogen ur `src/domain/ingredients.ts`.
 *
 * Katalogen finns på två ställen — i TypeScript för domänlogiken och i Postgres
 * för frågor och främmandenycklar. Att skriva den två gånger för hand är ett
 * löfte om att de glider isär. Den här filen gör TypeScript-versionen till enda
 * sanningskälla och databasen till en avledd kopia.
 *
 *   node scripts/generate-seed.ts > supabase/migrations/<tid>_seed_ingredients.sql
 */

import { INGREDIENTS } from '../src/domain/ingredients.ts'

/** Citerar en sträng för SQL. Enkel, eftersom indata är vår egen katalog. */
function sql(value: string | null | undefined): string {
  if (value === null || value === undefined) return 'null'
  return `'${value.replace(/'/g, "''")}'`
}

function num(value: number | undefined): string {
  return value === undefined ? 'null' : String(value)
}

const lines: string[] = [
  '-- Genererad av scripts/generate-seed.ts. Redigera inte för hand —',
  '-- ändra src/domain/ingredients.ts och kör om skriptet.',
  '',
  'insert into public.ingredients',
  '  (id, name, canonical_unit, category, staple,',
  '   piece_weight_g, piece_weight_min_g, piece_weight_max_g, grams_per_dl)',
  'values',
]

const rows = Object.values(INGREDIENTS).map((ingredient) => {
  const piece = ingredient.pieceWeight
  return (
    `  (${sql(ingredient.id)}, ${sql(ingredient.name)}, ${sql(ingredient.canonicalUnit)}, ` +
    `${sql(ingredient.category)}, ${ingredient.staple}, ` +
    `${num(piece?.grams)}, ${num(piece?.min)}, ${num(piece?.max)}, ` +
    `${num(ingredient.gramsPerDl)})`
  )
})

lines.push(rows.join(',\n'))
lines.push('on conflict (id) do update set')
lines.push('  name = excluded.name,')
lines.push('  canonical_unit = excluded.canonical_unit,')
lines.push('  category = excluded.category,')
lines.push('  staple = excluded.staple,')
lines.push('  piece_weight_g = excluded.piece_weight_g,')
lines.push('  piece_weight_min_g = excluded.piece_weight_min_g,')
lines.push('  piece_weight_max_g = excluded.piece_weight_max_g,')
lines.push('  grams_per_dl = excluded.grams_per_dl;')
lines.push('')

const aliases = Object.values(INGREDIENTS).flatMap((ingredient) =>
  ingredient.aliases.map((alias) => `  (${sql(ingredient.id)}, ${sql(alias)})`),
)

if (aliases.length > 0) {
  lines.push('insert into public.ingredient_aliases (ingredient_id, alias)')
  lines.push('values')
  lines.push(aliases.join(',\n'))
  lines.push('on conflict do nothing;')
  lines.push('')
}

process.stdout.write(lines.join('\n'))
