import Decimal from 'break_eternity.js'

const LONG_SUFFIXES = ['k', 'M', 'B', 'T', 'Q']

function alphaSuffix(index: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz'
  const first = Math.floor(index / alphabet.length)
  const second = index % alphabet.length
  return `a${alphabet[first]}${alphabet[second]}`
}

export function formatAbbreviatedDecimal(value: Decimal): string {
  if (!value.isFinite()) {
    return value.toString()
  }

  const sign = value.lt(0) ? '-' : ''
  const absolute = value.abs()
  if (absolute.lt(1000)) {
    const rounded = absolute.lt(100) ? absolute.toFixed(2) : absolute.toFixed(0)
    return `${sign}${rounded}`
  }

  let tier = 0
  let scaled = absolute
  while (scaled.gte(1000)) {
    scaled = scaled.div(1000)
    tier += 1
  }

  const suffix =
    tier <= LONG_SUFFIXES.length
      ? LONG_SUFFIXES[tier - 1]
      : alphaSuffix(tier - LONG_SUFFIXES.length - 1)

  const display =
    scaled.gte(100)
      ? scaled.toFixed(0)
      : scaled.gte(10)
        ? scaled.toFixed(1)
        : scaled.toFixed(2)

  return `${sign}${display}${suffix}`
}

export function formatResource(value: Decimal): string {
  return formatAbbreviatedDecimal(value)
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  return [hours, minutes, seconds].map((value) => value.toString().padStart(2, '0')).join(':')
}

export function formatReputation(value: Decimal): string {
  return `${value.gte(0) ? '+' : ''}${formatResource(value)}`
}
