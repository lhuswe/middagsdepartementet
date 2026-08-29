/**
 * Buntar varje Edge Function till en enda fil med esbuild.
 *
 * Deno-runtimen klarar flera filer, men en bunt är enklare att deploya och gör
 * det omöjligt att av misstag skeppa en halv uppsättning moduler. Källkoden är
 * fortfarande `supabase/functions/<namn>/index.ts` plus `src/` - det här är en
 * byggartefakt och inget att redigera.
 *
 *   npm run functions:build
 */

import { build } from 'esbuild'
import { mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const FUNCTIONS = ['citygross-sync', 'citygross-search', 'generate-shopping-list']

for (const fn of FUNCTIONS) {
  const entry = join(root, 'supabase', 'functions', fn, 'index.ts')
  try {
    statSync(entry)
  } catch {
    process.stdout.write(`${fn}: ingen index.ts, hoppar över\n`)
    continue
  }

  const outdir = join(root, 'supabase', 'functions', fn, 'dist')
  mkdirSync(outdir, { recursive: true })

  await build({
    entryPoints: [entry],
    outfile: join(outdir, 'index.js'),
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    // jsr:/npm:/https: löses av Deno vid körning och ska inte buntas in.
    external: ['jsr:*', 'npm:*', 'https://*', 'node:*'],
    minify: true,
    legalComments: 'none',
  })

  const { size } = statSync(join(outdir, 'index.js'))
  process.stdout.write(`${fn}: ${(size / 1024).toFixed(1)} kB\n`)
}
