/**
 * Genererar PWA-ikoner utan externa beroenden.
 *
 * Ritar en enkel bild i minnet och skriver den som PNG med Nodes egen zlib.
 * Motivet är en tallrik sedd uppifrån med en gaffel över — igenkännbart i
 * 48 pixlar, vilket är hela kravet på en hemskärmsikon.
 *
 *   node scripts/generate-icons.ts
 */

import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Djup blågrön, samma ton som appens accentfärg. */
const BAKGRUND: [number, number, number] = [31, 78, 95]
const FORGRUND: [number, number, number] = [250, 249, 246]

function crc32(data: Buffer): number {
  let c: number
  const tabell: number[] = []
  for (let n = 0; n < 256; n += 1) {
    c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    tabell[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const byte of data) crc = tabell[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(typ: string, data: Buffer): Buffer {
  const langd = Buffer.alloc(4)
  langd.writeUInt32BE(data.length)
  const kropp = Buffer.concat([Buffer.from(typ, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(kropp))
  return Buffer.concat([langd, kropp, crc])
}

function skrivPng(bredd: number, hojd: number, pixlar: Buffer): Buffer {
  const signatur = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(bredd, 0)
  ihdr.writeUInt32BE(hojd, 4)
  ihdr[8] = 8 // bitdjup
  ihdr[9] = 6 // RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  // Varje rad föregås av en filterbyte. 0 = ingen filtrering.
  const rader: Buffer[] = []
  for (let y = 0; y < hojd; y += 1) {
    rader.push(Buffer.from([0]), pixlar.subarray(y * bredd * 4, (y + 1) * bredd * 4))
  }

  return Buffer.concat([
    signatur,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rader), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * Ritar ikonen.
 *
 * `padding` gör motivet mindre för maskable-varianten, där yttre 10 % av
 * ytan kan beskäras bort av operativsystemet.
 */
function ritaIkon(storlek: number, options: { rundad: boolean; padding: number }): Buffer {
  const pixlar = Buffer.alloc(storlek * storlek * 4)
  const mitt = storlek / 2
  const radie = mitt * (1 - options.padding)

  const satt = (x: number, y: number, farg: [number, number, number], alfa: number) => {
    const index = (y * storlek + x) * 4
    pixlar[index] = farg[0]
    pixlar[index + 1] = farg[1]
    pixlar[index + 2] = farg[2]
    pixlar[index + 3] = Math.round(alfa * 255)
  }

  const hornradie = storlek * 0.22

  for (let y = 0; y < storlek; y += 1) {
    for (let x = 0; x < storlek; x += 1) {
      // Bakgrund: rundad kvadrat, eller full yta för maskable.
      let inneBakgrund = true
      if (options.rundad) {
        const dx = Math.max(hornradie - x, 0, x - (storlek - hornradie))
        const dy = Math.max(hornradie - y, 0, y - (storlek - hornradie))
        inneBakgrund = Math.hypot(dx, dy) <= hornradie
      }
      if (!inneBakgrund) {
        satt(x, y, BAKGRUND, 0)
        continue
      }
      satt(x, y, BAKGRUND, 1)

      const avstand = Math.hypot(x - mitt + 0.5, y - mitt + 0.5)

      // Tallriksring.
      const yttre = radie * 0.62
      const inre = radie * 0.5
      if (avstand <= yttre && avstand >= inre) {
        satt(x, y, FORGRUND, 1)
        continue
      }

      // Gaffelskaft: en lodrät stapel genom mitten.
      const skaftbredd = radie * 0.075
      if (Math.abs(x - mitt + 0.5) <= skaftbredd && y > mitt - radie * 0.42 && y < mitt + radie * 0.42) {
        satt(x, y, FORGRUND, 1)
        continue
      }

      // Gaffelpiggar: två korta streck ovanför skaftet.
      const piggTopp = mitt - radie * 0.42
      const piggBotten = mitt - radie * 0.12
      if (y >= piggTopp && y <= piggBotten) {
        for (const offset of [-radie * 0.2, radie * 0.2]) {
          if (Math.abs(x - (mitt + offset) + 0.5) <= skaftbredd) {
            satt(x, y, FORGRUND, 1)
          }
        }
      }
    }
  }

  return skrivPng(storlek, storlek, pixlar)
}

const publicDir = join(root, 'public')
mkdirSync(publicDir, { recursive: true })

const filer: [string, number, { rundad: boolean; padding: number }][] = [
  ['icon-192.png', 192, { rundad: true, padding: 0.28 }],
  ['icon-512.png', 512, { rundad: true, padding: 0.28 }],
  // Maskable: motivet krymps så att inget viktigt hamnar i beskärningszonen.
  ['icon-512-maskable.png', 512, { rundad: false, padding: 0.42 }],
  ['apple-touch-icon.png', 180, { rundad: true, padding: 0.28 }],
]

for (const [namn, storlek, options] of filer) {
  writeFileSync(join(publicDir, namn), ritaIkon(storlek, options))
  process.stdout.write(`${namn} (${storlek}×${storlek})\n`)
}

// Favicon som SVG — skarp i alla storlekar och en bråkdel av vikten.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="rgb(${BAKGRUND.join(',')})"/>
  <circle cx="32" cy="32" r="18" fill="none" stroke="rgb(${FORGRUND.join(',')})" stroke-width="4"/>
  <rect x="30" y="14" width="4" height="36" fill="rgb(${FORGRUND.join(',')})"/>
  <rect x="22" y="14" width="4" height="14" fill="rgb(${FORGRUND.join(',')})"/>
  <rect x="38" y="14" width="4" height="14" fill="rgb(${FORGRUND.join(',')})"/>
</svg>
`
writeFileSync(join(publicDir, 'favicon.svg'), svg, 'utf8')
process.stdout.write('favicon.svg\n')
