import Decimal from 'break_eternity.js'

import starterNodes from './starterNodes.json'
import { GAME_CONFIG } from './config'
import { getReputationValue, multiplyResourceMap } from './resources'
import type {
  NodeDefinition,
  NodeRuntimeState,
  PartialResourceMap,
  RawNodeDefinition,
  RawNodeUnlockRequirement,
  ResourceKey,
  ResourceMap,
} from './types'

export const NODE_DEFINITION_NORMALIZATION_ERRORS: string[] = []

function toDecimal(
  value: Decimal | number | string | undefined,
  errorMessage?: string,
): Decimal {
  if (value instanceof Decimal) {
    return value
  }

  try {
    return new Decimal(value ?? 0)
  } catch {
    if (errorMessage) {
      NODE_DEFINITION_NORMALIZATION_ERRORS.push(errorMessage)
    }

    return new Decimal(0)
  }
}

function normalizeUpgradeLevel(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0
  }

  return Math.max(0, Math.floor(value))
}

function normalizeUnlockRequirement(nodeID: number, unlockRequirement?: RawNodeUnlockRequirement) {
  return {
    reputationMin:
      unlockRequirement?.reputationMin === undefined
        ? undefined
        : toDecimal(unlockRequirement.reputationMin, `Node ${nodeID} has an invalid reputationMin unlock requirement.`),
    reputationMax:
      unlockRequirement?.reputationMax === undefined
        ? undefined
        : toDecimal(unlockRequirement.reputationMax, `Node ${nodeID} has an invalid reputationMax unlock requirement.`),
    requiredNodeIDs: unlockRequirement?.requiredNodeIDs ?? [],
  }
}

function normalizeDefinition(definition: RawNodeDefinition): NodeDefinition {
  return {
    nodeID: definition.nodeID,
    nodeName: definition.nodeName,
    nodeType: definition.nodeType,
    baseInput: toPartialDecimalResourceMap(definition.nodeID, 'baseInput', definition.baseInput),
    baseOutput: toPartialDecimalResourceMap(definition.nodeID, 'baseOutput', definition.baseOutput),
    baseMultiplier: toDecimal(definition.baseMultiplier, `Node ${definition.nodeID} has an invalid baseMultiplier.`),
    modMultiplier: toDecimal(definition.modMultiplier, `Node ${definition.nodeID} has an invalid modMultiplier.`),
    unlockRequirement: normalizeUnlockRequirement(definition.nodeID, definition.unlockRequirement),
    upgradeLevel: normalizeUpgradeLevel(definition.upgradeLevel),
    durationMs: definition.durationMs,
  }
}

function toPartialDecimalResourceMap(
  nodeID: number,
  fieldName: 'baseInput' | 'baseOutput',
  resourceMap?: Partial<Record<ResourceKey, Decimal | number | string>>,
): PartialResourceMap {
  const partial: PartialResourceMap = {}

  for (const [key, value] of Object.entries(resourceMap ?? {})) {
    if (value === undefined) {
      continue
    }

    partial[key as ResourceKey] = toDecimal(value, `Node ${nodeID} has an invalid ${fieldName}.${key} value.`)
  }

  return partial
}

export const NODE_DEFINITIONS: NodeDefinition[] = (starterNodes as RawNodeDefinition[])
  .map(normalizeDefinition)
  .sort((left, right) => left.nodeID - right.nodeID)

export const NODE_DEFINITIONS_BY_ID: Record<number, NodeDefinition> = Object.fromEntries(
  NODE_DEFINITIONS.map((definition) => [definition.nodeID, definition]),
)

export function createInitialNodeRuntimeState(definition: NodeDefinition): NodeRuntimeState {
  return {
    nodeID: definition.nodeID,
    unlocked: false,
    enabled: false,
    upgradeLevel: definition.upgradeLevel,
    progressMs: 0,
    completions: 0,
    isRunning: false,
    autoRun: false,
  }
}

export function createInitialNodeStateMap(): Record<number, NodeRuntimeState> {
  return Object.fromEntries(
    NODE_DEFINITIONS.map((definition) => [definition.nodeID, createInitialNodeRuntimeState(definition)]),
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
    toPartialDecimalResourceMap(0, 'baseInput', GAME_CONFIG.nodeUpgrade.baseCost),
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
