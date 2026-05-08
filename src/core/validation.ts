import Decimal from 'break_eternity.js'

import { GAME_CONFIG, GAME_VERSION, NODE_TYPES, RESOURCE_KEYS } from './config'
import {
  NODE_DEFINITION_NORMALIZATION_ERRORS,
  NODE_DEFINITIONS,
  NODE_DEFINITIONS_BY_ID,
  createInitialNodeStateMap,
  isNodeUnlocked,
} from './nodes'
import { createInitialResourceMap, repairResourceMap, toDecimalResourceMap, validateResourceMap } from './resources'
import { createInitialTimeState, nowMs } from './time'
import type { GameState, NodeDefinition, NodeRuntimeState, SerializedGameState, TimeState } from './types'

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function normalizeTimeState(value: Partial<TimeState> | undefined, fallbackNow: number): TimeState {
  const initial = createInitialTimeState(fallbackNow)

  return {
    createdAt: isFiniteNumber(value?.createdAt) ? value.createdAt : initial.createdAt,
    lastTickAt: isFiniteNumber(value?.lastTickAt) ? value.lastTickAt : initial.lastTickAt,
    lastSavedAt: isFiniteNumber(value?.lastSavedAt) ? value.lastSavedAt : initial.lastSavedAt,
    lastLoadedAt: isFiniteNumber(value?.lastLoadedAt) ? value.lastLoadedAt : initial.lastLoadedAt,
    totalActiveMs: isFiniteNumber(value?.totalActiveMs) ? Math.max(0, value.totalActiveMs) : 0,
    totalOfflineMs: isFiniteNumber(value?.totalOfflineMs) ? Math.max(0, value.totalOfflineMs) : 0,
  }
}

function normalizeNonNegativeInteger(value: unknown, fallback: number, max?: number): number {
  if (!isFiniteNumber(value)) {
    return fallback
  }

  const normalized = Math.max(0, Math.floor(value))
  return max === undefined ? normalized : Math.min(max, normalized)
}

function normalizeNonNegativeNumber(value: unknown, fallback: number): number {
  return isFiniteNumber(value) ? Math.max(0, value) : fallback
}

function normalizeNodeRuntimeState(
  runtimeState: Partial<NodeRuntimeState> | undefined,
  initial: NodeRuntimeState,
): NodeRuntimeState {
  const fallbackUpgradeLevel = initial.upgradeLevel
  const fallbackProgressMs = initial.progressMs
  const fallbackCompletions = initial.completions

  return {
    nodeID: initial.nodeID,
    unlocked: Boolean(runtimeState?.unlocked ?? initial.unlocked),
    enabled: Boolean(runtimeState?.enabled ?? initial.enabled),
    upgradeLevel: normalizeNonNegativeInteger(
      runtimeState?.upgradeLevel,
      fallbackUpgradeLevel,
      GAME_CONFIG.nodeUpgrade.maxLevel,
    ),
    progressMs: normalizeNonNegativeNumber(runtimeState?.progressMs, fallbackProgressMs),
    completions: normalizeNonNegativeInteger(runtimeState?.completions, fallbackCompletions),
    isRunning: Boolean(runtimeState?.isRunning ?? initial.isRunning),
    autoRun: Boolean(runtimeState?.autoRun ?? initial.autoRun),
  }
}

export function validateNodeDefinitions(definitions: NodeDefinition[]): string[] {
  const errors: string[] = []
  const seenNodeIDs = new Set<number>()

  for (const definition of definitions) {
    if (!Number.isInteger(definition.nodeID)) {
      errors.push(`Node ${definition.nodeName} has an invalid nodeID.`)
    }

    if (seenNodeIDs.has(definition.nodeID)) {
      errors.push(`Duplicate nodeID detected: ${definition.nodeID}.`)
    }
    seenNodeIDs.add(definition.nodeID)

    if (!definition.nodeName.trim()) {
      errors.push(`Node ${definition.nodeID} has an empty name.`)
    }

    if (!NODE_TYPES.includes(definition.nodeType)) {
      errors.push(`Node ${definition.nodeID} has an invalid nodeType.`)
    }

    for (const resourceMap of [definition.baseInput, definition.baseOutput]) {
      for (const [resourceKey, value] of Object.entries(resourceMap)) {
        if (!RESOURCE_KEYS.includes(resourceKey as (typeof RESOURCE_KEYS)[number])) {
          errors.push(`Node ${definition.nodeID} uses an invalid resource key: ${resourceKey}.`)
        }

        if (!(value instanceof Decimal) || !value.isFinite()) {
          errors.push(`Node ${definition.nodeID} has a non-finite resource value.`)
        }
      }
    }

    if (!definition.baseMultiplier.isFinite() || definition.baseMultiplier.lte(0)) {
      errors.push(`Node ${definition.nodeID} must have a positive baseMultiplier.`)
    }

    if (!definition.modMultiplier.isFinite() || definition.modMultiplier.lte(0)) {
      errors.push(`Node ${definition.nodeID} must have a positive modMultiplier.`)
    }

    if (
      !Number.isInteger(definition.upgradeLevel) ||
      definition.upgradeLevel < 0 ||
      definition.upgradeLevel > GAME_CONFIG.nodeUpgrade.maxLevel
    ) {
      errors.push(`Node ${definition.nodeID} has an invalid upgradeLevel.`)
    }

    if (definition.unlockRequirement.requiredNodeIDs?.some((nodeID) => !Number.isInteger(nodeID))) {
      errors.push(`Node ${definition.nodeID} has an invalid requiredNodeIDs list.`)
    }

    if (definition.nodeType === 'timed-task' && (!definition.durationMs || definition.durationMs <= 0)) {
      errors.push(`Timed task node ${definition.nodeID} must define a positive durationMs.`)
    }
  }

  return errors
}

export const STARTER_NODE_DEFINITION_ERRORS = [
  ...NODE_DEFINITION_NORMALIZATION_ERRORS,
  ...validateNodeDefinitions(NODE_DEFINITIONS),
]

export function repairGameState(rawState?: Partial<GameState> | Partial<SerializedGameState>): GameState {
  const now = nowMs()
  const resources = repairResourceMap(
    toDecimalResourceMap((rawState?.resources as SerializedGameState['resources'] | undefined) ?? createInitialResourceMap()),
  )
  const time = normalizeTimeState(rawState?.time, now)
  const initialNodes = createInitialNodeStateMap()
  const nodes = { ...initialNodes }

  for (const definition of NODE_DEFINITIONS) {
    nodes[definition.nodeID] = normalizeNodeRuntimeState(
      rawState?.nodes?.[definition.nodeID],
      initialNodes[definition.nodeID],
    )
  }

  const repaired: GameState = {
    version: typeof rawState?.version === 'string' ? rawState.version : GAME_VERSION,
    resources,
    time,
    nodes,
    log: Array.isArray(rawState?.log)
      ? rawState.log.filter((entry): entry is string => typeof entry === 'string').slice(-GAME_CONFIG.logMaxEntries)
      : [],
  }

  for (const definition of NODE_DEFINITIONS) {
    const runtimeState = repaired.nodes[definition.nodeID]
    runtimeState.unlocked = isNodeUnlocked(definition, repaired.nodes, repaired.resources)

    if (definition.nodeType !== 'passive' && runtimeState.enabled) {
      runtimeState.enabled = false
    }

    if (definition.nodeType !== 'timed-task') {
      runtimeState.isRunning = false
      runtimeState.progressMs = 0
    }
  }

  return repaired
}

export function validateGameState(state: GameState): string[] {
  const errors = [...validateResourceMap(state.resources), ...STARTER_NODE_DEFINITION_ERRORS]

  if (!state.version.trim()) {
    errors.push('Game version is required.')
  }

  if (state.time.totalActiveMs < 0 || state.time.totalOfflineMs < 0) {
    errors.push('Time totals cannot be negative.')
  }

  for (const [nodeID, runtimeState] of Object.entries(state.nodes)) {
    if (!NODE_DEFINITIONS_BY_ID[Number(nodeID)]) {
      errors.push(`Runtime node ${nodeID} does not exist in node definitions.`)
      continue
    }

    if (runtimeState.upgradeLevel < 0 || runtimeState.upgradeLevel > GAME_CONFIG.nodeUpgrade.maxLevel) {
      errors.push(`Node ${nodeID} has an invalid upgradeLevel.`)
    }

    if (runtimeState.progressMs < 0) {
      errors.push(`Node ${nodeID} has a negative progressMs.`)
    }
  }

  return errors
}
