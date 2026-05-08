import Decimal from 'break_eternity.js'

import starterNodes from './starterNodes.json'
import { GAME_CONFIG } from './config'
import { getReputationValue, multiplyResourceMap, toDecimalResourceMap } from './resources'
import type {
  NodeDefinition,
  NodeRuntimeState,
  PartialResourceMap,
  RawNodeDefinition,
  RawNodeUnlockRequirement,
  ResourceKey,
  ResourceMap,
} from './types'

function toDecimal(value: Decimal | number | string | undefined): Decimal {
  if (value instanceof Decimal) {
    return value
  }

  return new Decimal(value ?? 0)
}

function normalizeUnlockRequirement(unlockRequirement?: RawNodeUnlockRequirement) {
  return {
    reputationMin:
      unlockRequirement?.reputationMin === undefined
        ? undefined
        : toDecimal(unlockRequirement.reputationMin),
    reputationMax:
      unlockRequirement?.reputationMax === undefined
        ? undefined
        : toDecimal(unlockRequirement.reputationMax),
    requiredNodeIDs: unlockRequirement?.requiredNodeIDs ?? [],
  }
}

function normalizeDefinition(definition: RawNodeDefinition): NodeDefinition {
  return {
    nodeID: definition.nodeID,
    nodeName: definition.nodeName,
    nodeType: definition.nodeType,
    baseInput: toPartialDecimalResourceMap(definition.baseInput),
    baseOutput: toPartialDecimalResourceMap(definition.baseOutput),
    baseMultiplier: toDecimal(definition.baseMultiplier),
    modMultiplier: toDecimal(definition.modMultiplier),
    unlockRequirement: normalizeUnlockRequirement(definition.unlockRequirement),
    upgradeLevel: Math.max(0, definition.upgradeLevel ?? 0),
    durationMs: definition.durationMs,
  }
}

function toPartialDecimalResourceMap(
  resourceMap?: Partial<Record<ResourceKey, Decimal | number | string>>,
): PartialResourceMap {
  const normalized = toDecimalResourceMap(resourceMap)
  const partial: PartialResourceMap = {}

  for (const [key, value] of Object.entries(resourceMap ?? {})) {
    partial[key as ResourceKey] = normalized[key as ResourceKey]
    if (value === undefined) {
      delete partial[key as ResourceKey]
    }
  }

  return partial
}

export const NODE_DEFINITIONS: NodeDefinition[] = (starterNodes as RawNodeDefinition[])
  .map(normalizeDefinition)
  .sort((left, right) => left.nodeID - right.nodeID)

export const NODE_DEFINITIONS_BY_ID: Record<number, NodeDefinition> = Object.fromEntries(
  NODE_DEFINITIONS.map((definition) => [definition.nodeID, definition]),
)

export function createInitialNodeRuntimeState(nodeID: number): NodeRuntimeState {
  return {
    nodeID,
    unlocked: false,
    enabled: false,
    upgradeLevel: 0,
    progressMs: 0,
    completions: 0,
    isRunning: false,
    autoRun: false,
  }
}

export function createInitialNodeStateMap(): Record<number, NodeRuntimeState> {
  return Object.fromEntries(
    NODE_DEFINITIONS.map((definition) => [definition.nodeID, createInitialNodeRuntimeState(definition.nodeID)]),
  )
}

export function calculateScaledResourceMap(
  base: PartialResourceMap,
  upgradeLevel: number,
  baseMultiplier: Decimal,
  modMultiplier: Decimal,
): PartialResourceMap {
  const scalingFactor = baseMultiplier.pow(upgradeLevel).mul(modMultiplier)
  return multiplyResourceMap(base, scalingFactor)
}

export function getScaledInput(definition: NodeDefinition, runtimeState: NodeRuntimeState): PartialResourceMap {
  return calculateScaledResourceMap(
    definition.baseInput,
    runtimeState.upgradeLevel,
    definition.baseMultiplier,
    definition.modMultiplier,
  )
}

export function getScaledOutput(definition: NodeDefinition, runtimeState: NodeRuntimeState): PartialResourceMap {
  return calculateScaledResourceMap(
    definition.baseOutput,
    runtimeState.upgradeLevel,
    definition.baseMultiplier,
    definition.modMultiplier,
  )
}

export function getNodeUpgradeCost(currentLevel: number): PartialResourceMap {
  return calculateScaledResourceMap(
    toPartialDecimalResourceMap(GAME_CONFIG.nodeUpgrade.baseCost),
    currentLevel,
    toDecimal(GAME_CONFIG.nodeUpgrade.costMultiplier),
    new Decimal(1),
  )
}

export function isNodeUnlocked(
  definition: NodeDefinition,
  runtimeStates: Record<number, NodeRuntimeState>,
  resources: ResourceMap,
): boolean {
  const reputation = getReputationValue(resources)

  if (
    definition.unlockRequirement.reputationMin !== undefined &&
    reputation.lt(definition.unlockRequirement.reputationMin)
  ) {
    return false
  }

  if (
    definition.unlockRequirement.reputationMax !== undefined &&
    reputation.gt(definition.unlockRequirement.reputationMax)
  ) {
    return false
  }

  return (definition.unlockRequirement.requiredNodeIDs ?? []).every(
    (nodeID) => runtimeStates[nodeID]?.unlocked ?? false,
  )
}
