import { describe, expect, it } from 'vitest'

import { getIngredient } from './ingredients.ts'
import {
  convertBase,
  formatQuantity,
  parseDescriptiveSize,
  toBase,
  weakestConfidence,
} from './units.ts'
import type { Ingredient } from './types.ts'

function ingredient(id: string): Ingredient {
  const found = getIngredient(id)
  if (!found) throw new Error(`Testet refererar en ingrediens som inte finns: ${id}`)
  return found
}

describe('toBase', () => {
  it('räknar om massenheter exakt', () => {
    const potatis = ingredient('potatis')
    expect(toBase({ value: 1.5, unit: 'kg' }, potatis)).toEqual({
      value: 1500,
      unit: 'g',
      confidence: 'exact',
    })
    expect(toBase({ value: 500, unit: 'g' }, potatis)).toEqual({
      value: 500,
      unit: 'g',
      confidence: 'exact',
    })
  })

  it('räknar om volymenheter exakt', () => {
    const gradde = ingredient('vispgradde')
    expect(toBase({ value: 5, unit: 'dl' }, gradde)).toEqual({
      value: 500,
      unit: 'ml',
      confidence: 'exact',
    })
    expect(toBase({ value: 2, unit: 'msk' }, gradde)).toEqual({
      value: 30,
      unit: 'ml',
      confidence: 'exact',
    })
    expect(toBase({ value: 1, unit: 'tsk' }, gradde)).toEqual({
      value: 5,
      unit: 'ml',
      confidence: 'exact',
    })
  })

  // Det här är fallet originalspecen gick bet på: den landade i "0,5 lök".
  it('räknar om styck till gram via styckvikt, med intervall', () => {
    const result = toBase({ value: 3, unit: 'st' }, ingredient('gul_lok'))
    expect(result.unit).toBe('g')
    expect(result.value).toBe(330)
    expect(result.confidence).toBe('estimated')
    expect(result.range).toEqual({ min: 240, max: 450 })
  })

  it('hanterar vitlöksklyftor som styckvara', () => {
    const result = toBase({ value: 2, unit: 'klyfta' }, ingredient('vitlok'))
    expect(result.value).toBe(6)
    expect(result.confidence).toBe('estimated')
  })

  it('räknar om volym till vikt via densitet när ingrediensen mäts i gram', () => {
    const result = toBase({ value: 1, unit: 'dl' }, ingredient('vetemjol'))
    expect(result.unit).toBe('g')
    expect(result.value).toBeCloseTo(60, 5)
    expect(result.confidence).toBe('estimated')
  })

  it('markerar okänt när styckvikt saknas i stället för att gissa', () => {
    const result = toBase({ value: 2, unit: 'st' }, ingredient('blandfars'))
    expect(result.confidence).toBe('unknown')
  })

  it('markerar förpackningsenheter som okända - de hanteras separat', () => {
    for (const unit of ['burk', 'pkt', 'förpackning'] as const) {
      expect(toBase({ value: 1, unit }, ingredient('krossade_tomater')).confidence).toBe(
        'unknown',
      )
    }
  })

  it('avvisar negativa och ogiltiga mängder', () => {
    const potatis = ingredient('potatis')
    expect(toBase({ value: -1, unit: 'kg' }, potatis).confidence).toBe('unknown')
    expect(toBase({ value: Number.NaN, unit: 'kg' }, potatis).confidence).toBe('unknown')
  })
})

describe('convertBase', () => {
  it('konverterar milliliter till gram via densitet', () => {
    const result = convertBase(
      { value: 100, unit: 'ml', confidence: 'exact' },
      'g',
      ingredient('ris'),
    )
    expect(result.value).toBeCloseTo(85, 5)
    expect(result.confidence).toBe('estimated')
  })

  it('konverterar tillbaka symmetriskt', () => {
    const ris = ingredient('ris')
    const toGrams = convertBase({ value: 200, unit: 'ml', confidence: 'exact' }, 'g', ris)
    const back = convertBase(toGrams, 'ml', ris)
    expect(back.value).toBeCloseTo(200, 5)
  })

  it('returnerar oförändrat när enheten redan stämmer', () => {
    const input = { value: 500, unit: 'g' as const, confidence: 'exact' as const }
    expect(convertBase(input, 'g', ingredient('potatis'))).toBe(input)
  })

  it('kan inte konvertera utan densitet', () => {
    const result = convertBase(
      { value: 100, unit: 'ml', confidence: 'exact' },
      'g',
      ingredient('blandfars'),
    )
    expect(result.confidence).toBe('unknown')
  })
})

describe('parseDescriptiveSize', () => {
  // netContent.unitOfMeasure är 0 för både "390G" och "1,5L" i City Gross API.
  // Enumet går inte att lita på - den här funktionen är sanningskällan.
  it.each([
    ['390G', 390, 'g'],
    ['1,17KG', 1170, 'g'],
    ['CA600G', 600, 'g'],
    ['1,5L', 1500, 'ml'],
    ['1L', 1000, 'ml'],
    ['5DL', 500, 'ml'],
    ['33CL', 330, 'ml'],
    ['500 G', 500, 'g'],
  ])('tolkar %s', (input, value, unit) => {
    expect(parseDescriptiveSize(input)).toEqual({ value, unit })
  })

  it('returnerar null för storlekar som inte går att tolka', () => {
    expect(parseDescriptiveSize('')).toBeNull()
    expect(parseDescriptiveSize('KLASS 1')).toBeNull()
    expect(parseDescriptiveSize('3-PACK')).toBeNull()
  })
})

describe('weakestConfidence', () => {
  it('låter den svagaste länken avgöra', () => {
    expect(weakestConfidence('exact', 'exact')).toBe('exact')
    expect(weakestConfidence('exact', 'estimated')).toBe('estimated')
    expect(weakestConfidence('estimated', 'unknown')).toBe('unknown')
  })
})

describe('formatQuantity', () => {
  it('väljer den enhet en människa hade sagt', () => {
    expect(formatQuantity(750, 'g')).toBe('750 g')
    expect(formatQuantity(1500, 'g')).toBe('1,5 kg')
    expect(formatQuantity(500, 'ml')).toBe('5 dl')
    expect(formatQuantity(1500, 'ml')).toBe('1,5 l')
    expect(formatQuantity(30, 'ml')).toBe('30 ml')
    expect(formatQuantity(2, 'st')).toBe('2 st')
  })
})
