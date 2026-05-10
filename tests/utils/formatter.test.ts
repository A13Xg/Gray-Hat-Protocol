import Decimal from 'break_eternity.js'
import { describe, expect, it } from 'vitest'

import { formatAbbreviatedDecimal, formatDuration, formatReputation } from '../../src/utils/formatter'

describe('formatter', () => {
  it('formats known magnitude suffixes', () => {
    expect(formatAbbreviatedDecimal(new Decimal(999))).toBe('999')
    expect(formatAbbreviatedDecimal(new Decimal(1_250))).toBe('1.25k')
    expect(formatAbbreviatedDecimal(new Decimal(1_000_000))).toBe('1.00M')
    expect(formatAbbreviatedDecimal(new Decimal(1_000_000_000))).toBe('1.00B')
  })

  it('formats negative values with sign preservation', () => {
    expect(formatAbbreviatedDecimal(new Decimal(-12_345))).toBe('-12.3k')
    expect(formatReputation(new Decimal(-45))).toBe('-45.00')
    expect(formatReputation(new Decimal(45))).toBe('+45.00')
  })

  it('formats duration as HH:MM:SS', () => {
    expect(formatDuration(0)).toBe('00:00:00')
    expect(formatDuration(61_000)).toBe('00:01:01')
    expect(formatDuration(3_661_000)).toBe('01:01:01')
  })
})

