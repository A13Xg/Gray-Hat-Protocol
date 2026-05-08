import Decimal from 'break_eternity.js'

export function formatResource(value: Decimal): string {
  if (value.abs().gte(1_000_000)) {
    return value.toExponential(2)
  }

  if (value.mod(1).eq(0)) {
    return value.toFixed(0)
  }

  return value.toFixed(2)
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
