import Decimal from 'break_eternity.js'

import { GAME_CONFIG, RESOURCE_KEYS } from './config'
import type { DecimalSource, PartialResourceMap, ResourceKey, ResourceMap, ReputationAlignment } from './types'

function toDecimal(value: DecimalSource | undefined): Decimal {
  if (value instanceof Decimal) {
    return value
  }

  try {
    return new Decimal(value ?? 0)
  } catch {
    return new Decimal(0)
  }
}

export function createEmptyResourceMap(): ResourceMap {
  return {
    money: new Decimal(0),
    crypto: new Decimal(0),
    compute: new Decimal(0),
    reputation: new Decimal(0),
  }
}

export function toDecimalResourceMap(resources?: Partial<Record<ResourceKey, DecimalSource>>): ResourceMap {
  const next = createEmptyResourceMap()

  for (const key of RESOURCE_KEYS) {
    next[key] = toDecimal(resources?.[key])
  }

  return next
}

export function createInitialResourceMap(): ResourceMap {
  return toDecimalResourceMap(GAME_CONFIG.initialResources)
}

export function addResources(resources: ResourceMap, delta: PartialResourceMap): ResourceMap {
  const next = createEmptyResourceMap()

  for (const key of RESOURCE_KEYS) {
    next[key] = resources[key].add(delta[key] ?? 0)
  }

  return repairResourceMap(next)
}

export function subtractResources(resources: ResourceMap, delta: PartialResourceMap): ResourceMap {
  const next = createEmptyResourceMap()

  for (const key of RESOURCE_KEYS) {
    next[key] = resources[key].sub(delta[key] ?? 0)
  }

  return repairResourceMap(next)
}

export function multiplyResourceMap(resources: PartialResourceMap, multiplier: DecimalSource): PartialResourceMap {
  const next: PartialResourceMap = {}
  const decimalMultiplier = toDecimal(multiplier)

  for (const key of RESOURCE_KEYS) {
    if (resources[key]) {
      next[key] = resources[key].mul(decimalMultiplier)
    }
  }

  return next
}

export function canAffordResources(resources: ResourceMap, cost: PartialResourceMap): boolean {
  return RESOURCE_KEYS.every((key) => resources[key].gte(cost[key] ?? 0))
}

export function applyResourceCost(resources: ResourceMap, cost: PartialResourceMap): ResourceMap {
  if (!canAffordResources(resources, cost)) {
    return resources
  }

  return subtractResources(resources, cost)
}

export function applyResourceGain(resources: ResourceMap, gain: PartialResourceMap): ResourceMap {
  return addResources(resources, gain)
}

export function repairResourceMap(resources: ResourceMap): ResourceMap {
  const next = createEmptyResourceMap()

  for (const key of RESOURCE_KEYS) {
    const value = toDecimal(resources[key])
    if (key === 'reputation') {
      next[key] = value
      continue
    }

    next[key] = value.lt(0) ? new Decimal(0) : value
  }

  return next
}

export function validateResourceMap(resources: ResourceMap): string[] {
  const errors: string[] = []

  for (const key of RESOURCE_KEYS) {
    if (!(resources[key] instanceof Decimal)) {
      errors.push(`Resource ${key} is not a Decimal value.`)
      continue
    }

    if (!resources[key].isFinite()) {
      errors.push(`Resource ${key} is not finite.`)
    }

    if (key !== 'reputation' && resources[key].lt(0)) {
      errors.push(`Resource ${key} cannot be negative.`)
    }
  }

  return errors
}

export function getReputationValue(resources: ResourceMap): Decimal {
  return resources.reputation
}

export function getReputationAlignment(resources: ResourceMap): ReputationAlignment {
  const reputation = getReputationValue(resources)

  if (reputation.gt(100)) {
    return 'whitehat'
  }

  if (reputation.lt(-100)) {
    return 'blackhat'
  }

  return 'greyhat'
}
