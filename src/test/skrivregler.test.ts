/**
 * Skrivregler som går att kontrollera automatiskt.
 *
 * Tankstreck smyger tillbaka. De kommer med i klippt text, de skrivs av
 * autokorrigering, och de ser nästan ut som bindestreck. Ett test är det enda
 * som håller dem borta över tid.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { globSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const rot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const EN_DASH = '\u2013'
const EM_DASH = '\u2014'

/** Filer som ska följa skrivreglerna. Genererat innehåll undantas. */
const MONSTER = [
  'src/**/*.ts',
  'src/**/*.tsx',
  'scripts/*.ts',
  'supabase/functions/*/index.ts',
  'supabase/migrations/*.sql',
  'docs/*.md',
  'README.md',
  'index.html',
  'public/404.html',
]

const UNDANTAG = ['_lib/', 'dist/', 'node_modules/']

function filerAttGranska(): string[] {
  const funna = MONSTER.flatMap((monster) => globSync(monster, { cwd: rot }))
  return [...new Set(funna)]
    .map((fil) => fil.split('\\').join('/'))
    .filter((fil) => !UNDANTAG.some((undantag) => fil.includes(undantag)))
    .sort()
}

describe('skrivregler', () => {
  it('hittar filer att granska', () => {
    expect(filerAttGranska().length).toBeGreaterThan(30)
  })

  it('använder vanligt bindestreck, aldrig tankstreck', () => {
    const traffar: string[] = []

    for (const fil of filerAttGranska()) {
      const innehall = readFileSync(join(rot, fil), 'utf8')
      innehall.split('\n').forEach((rad, index) => {
        if (rad.includes(EN_DASH) || rad.includes(EM_DASH)) {
          traffar.push(`${relative('.', fil)}:${index + 1}  ${rad.trim().slice(0, 80)}`)
        }
      })
    }

    expect(traffar, `Tankstreck hittade. Använd vanligt bindestreck:\n${traffar.join('\n')}`).toEqual(
      [],
    )
  })
})
