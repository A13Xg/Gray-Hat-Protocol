import Decimal from 'break_eternity.js'

import { GAME_CONFIG, GAME_VERSION, NODE_TYPES, RESOURCE_KEYS } from './config'
import { NODE_DEFINITIONS, NODE_DEFINITIONS_BY_ID, createInitialNodeStateMap, isNodeUnlocked } from './nodes'
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

function normalizeNodeRuntimeState(runtimeState: Partial<NodeRuntimeState> | undefined, nodeID: number): NodeRuntimeState {
  const initial = createInitialNodeStateMap()[nodeID]

  return {
    nodeID,
    unlocked: Boolean(runtimeState?.unlocked ?? initial.unlocked),
    enabled: Boolean(runtimeState?.enabled ?? initial.enabled),
    upgradeLevel: Math.min(
      GAME_CONFIG.nodeUpgrade.maxLevel,
      Math.max(0, Math.floor(runtimeState?.upgradeLevel ?? initial.upgradeLevel)),
    ),
    progressMs: Math.max(0, runtimeState?.progressMs ?? initial.progressMs),
    completions: Math.max(0, Math.floor(runtimeState?.completions ?? initial.completions)),
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

    if (definition.unlockRequirement.requiredNodeIDs?.some((nodeID) => !Number.isInteger(nodeID))) {
      errors.push(`Node ${definition.nodeID} has an invalid requiredNodeIDs list.`)
    }

    if (definition.nodeType === 'timed-task' && (!definition.durationMs || definition.durationMs <= 0)) {
      errors.push(`Timed task node ${definition.nodeID} must define a positive durationMs.`)
    }
  }

  return errors
}

export function repairGameState(rawState?: Partial<GameState> | Partial<SerializedGameState>): GameState {
  const now = nowMs()
  const resources = repairResourceMap(
    toDecimalResourceMap((rawState?.resources as SerializedGameState['resources'] | undefined) ?? createInitialResourceMap()),
  )
  const time = normalizeTimeState(rawState?.time, now)
  const nodes = createInitialNodeStateMap()

  for (const definition of NODE_DEFINITIONS) {
    nodes[definition.nodeID] = normalizeNodeRuntimeState(rawState?.nodes?.[definition.nodeID], definition.nodeID)
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
  const errors = [...validateResourceMap(state.resources)]

  for (const definitionErrors of validateNodeDefinitions(NODE_DEFINITIONS)) {
    errors.push(definitionErrors)
  }

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
