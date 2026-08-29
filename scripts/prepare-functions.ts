/**
 * Kopierar de domänmoduler som Edge Functions behöver till en platt `_lib`-mapp
 * under respektive funktion, och skriver om importsökvägarna.
 *
 * Bakgrunden: samma matte måste gälla i webbläsaren och på servern. Att skriva
 * den två gånger är ett löfte om att de glider isär — men Deno-bundlingen vill
 * ha alla filer under funktionskatalogen. Så: en sanningskälla i `src/`, och en
 * genererad kopia som aldrig redigeras för hand.
 *
 *   node scripts/prepare-functions.ts
 *
 * `_lib`-mapparna är gitignorerade och byggs om inför varje deploy.
 */

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Moduler som delas mellan frontend och Edge Functions. */
const SHARED_MODULES = [
  'src/domain/types.ts',
  'src/domain/units.ts',
  'src/domain/ingredients.ts',
  'src/domain/aggregate.ts',
  'src/domain/promotions.ts',
  'src/domain/packaging.ts',
  'src/domain/matching.ts',
  'src/domain/shopping-list.ts',
  'src/services/grocery/provider.ts',
  'src/services/grocery/citygross.ts',
]

/** Funktioner som får en `_lib`-kopia. */
const FUNCTIONS = ['citygross-sync', 'citygross-search', 'generate-shopping-list']

/**
 * Plattar ut relativa importer. `../../domain/types.ts` och `./types.ts` pekar
 * på samma fil när allt ligger i samma mapp.
 */
function flattenImports(source: string): string {
  return source.replace(
    /from '(\.{1,2}\/[^']*\/)?([A-Za-z0-9._-]+\.ts)'/g,
    (_match, _path, file) => `from './${file}'`,
  )
}

for (const fn of FUNCTIONS) {
  const target = join(root, 'supabase', 'functions', fn, '_lib')
  mkdirSync(target, { recursive: true })

  // Rensa gamla moduler men behall katalogen. Att ta bort sjalva mappen
  // faller pa Windows sa fort nagot har den som arbetskatalog.
  for (const stale of readdirSync(target)) {
    if (stale.endsWith('.ts')) rmSync(join(target, stale), { force: true })
  }

  for (const module of SHARED_MODULES) {
    const source = readFileSync(join(root, module), 'utf8')
    const name = module.split('/').pop()!
    writeFileSync(join(target, name), flattenImports(source), 'utf8')
  }

  writeFileSync(
    join(target, 'README.md'),
    '# Genererad kod\n\n' +
      'Kopierad av `scripts/prepare-functions.ts` från `src/`. Redigera aldrig\n' +
      'här — ändringar skrivs över vid nästa körning. Ändra originalet i `src/`.\n',
    'utf8',
  )

  process.stdout.write(`${fn}/_lib: ${SHARED_MODULES.length} moduler\n`)
}
