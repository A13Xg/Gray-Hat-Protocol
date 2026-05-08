import Decimal from 'break_eternity.js'

import { GAME_CONFIG, GAME_VERSION } from './config'
import {
  NODE_DEFINITIONS,
  NODE_DEFINITIONS_BY_ID,
  createInitialNodeStateMap,
  getNodeUpgradeCost as getUpgradeCostForLevel,
  getScaledInput,
  getScaledOutput,
  isNodeUnlocked,
} from './nodes'
import {
  applyResourceCost,
  applyResourceGain,
  canAffordResources,
  createInitialResourceMap,
  multiplyResourceMap,
  repairResourceMap,
} from './resources'
import { applyActiveTime, createInitialTimeState } from './time'
import { STARTER_NODE_DEFINITION_ERRORS, repairGameState, validateGameState } from './validation'
import type { GameState, NodeDefinition, NodeRuntimeState, PartialResourceMap } from './types'

function cloneNodeStateMap(nodes: Record<number, NodeRuntimeState>): Record<number, NodeRuntimeState> {
  return Object.fromEntries(Object.values(nodes).map((runtimeState) => [runtimeState.nodeID, { ...runtimeState }]))
}

function cloneGameState(state: GameState): GameState {
  return {
    version: state.version,
    resources: { ...state.resources },
    time: { ...state.time },
    nodes: cloneNodeStateMap(state.nodes),
    log: [...state.log],
  }
}

function appendLog(state: GameState, message: string): GameState {
  state.log = [...state.log, message].slice(-GAME_CONFIG.logMaxEntries)
  return state
}

function updateUnlockStates(state: GameState): GameState {
  const nextNodes = cloneNodeStateMap(state.nodes)
  let changed = true

  while (changed) {
    changed = false

    for (const definition of NODE_DEFINITIONS) {
      const nextUnlocked = isNodeUnlocked(definition, nextNodes, state.resources)
      if (nextNodes[definition.nodeID].unlocked !== nextUnlocked) {
        nextNodes[definition.nodeID].unlocked = nextUnlocked
        changed = true
      }
    }
  }

  for (const definition of NODE_DEFINITIONS) {
    const runtimeState = state.nodes[definition.nodeID]
    runtimeState.unlocked = nextNodes[definition.nodeID].unlocked

    if (!runtimeState.unlocked && definition.nodeType === 'passive') {
      runtimeState.enabled = false
    }
  }

  return state
}

function applyTickProgress(state: GameState, deltaMs: number): GameState {
  if (deltaMs <= 0) {
    return updateUnlockStates(state)
  }

  const seconds = new Decimal(deltaMs).div(1000)

  for (const definition of NODE_DEFINITIONS) {
    const runtimeState = state.nodes[definition.nodeID]
    if (definition.nodeType !== 'passive' || !runtimeState.enabled || !runtimeState.unlocked) {
      continue
    }

    const scaledInput = multiplyResourceMap(getScaledInput(definition, runtimeState), seconds)
    const scaledOutput = multiplyResourceMap(getScaledOutput(definition, runtimeState), seconds)

    if (!canAffordResources(state.resources, scaledInput)) {
      runtimeState.enabled = false
      appendLog(state, `${definition.nodeName} disabled because it can no longer afford its inputs.`)
      continue
    }

    state.resources = applyResourceGain(applyResourceCost(state.resources, scaledInput), scaledOutput)
  }

  for (const definition of NODE_DEFINITIONS) {
    const runtimeState = state.nodes[definition.nodeID]
    if (definition.nodeType !== 'timed-task' || !runtimeState.isRunning || !definition.durationMs) {
      continue
    }

    runtimeState.progressMs += deltaMs

    if (runtimeState.progressMs < definition.durationMs) {
      continue
    }

    runtimeState.progressMs = 0
    runtimeState.isRunning = false
    runtimeState.completions += 1
    state.resources = applyResourceGain(state.resources, getScaledOutput(definition, runtimeState))
    appendLog(state, `${definition.nodeName} completed.`)
  }

  state.resources = repairResourceMap(state.resources)
  return updateUnlockStates(state)
}

function validateDefinitionsOrThrow(): void {
  if (STARTER_NODE_DEFINITION_ERRORS.length > 0) {
    throw new Error(`Invalid node definitions: ${STARTER_NODE_DEFINITION_ERRORS.join(' ')}`)
  }
}

function finalizeState(state: GameState): GameState {
  const repaired = repairGameState(state)
  const errors = validateGameState(repaired)

  if (errors.length > 0) {
    throw new Error(`Invalid game state: ${errors.join(' ')}`)
  }

  return repaired
}

function getNodeDefinition(nodeID: number): NodeDefinition | undefined {
  return NODE_DEFINITIONS_BY_ID[nodeID]
}

export function getNodeUpgradeCost(state: GameState, nodeID: number): PartialResourceMap {
  const runtimeState = state.nodes[nodeID]
  if (!runtimeState) {
    return {}
  }

  return getUpgradeCostForLevel(runtimeState.upgradeLevel)
}

export function canUpgradeNode(state: GameState, nodeID: number): boolean {
  const runtimeState = state.nodes[nodeID]
  if (!runtimeState || runtimeState.upgradeLevel >= GAME_CONFIG.nodeUpgrade.maxLevel) {
    return false
  }

  return canAffordResources(state.resources, getNodeUpgradeCost(state, nodeID))
}

export function createInitialGameState(): GameState {
  validateDefinitionsOrThrow()

  const initialState = {
    version: GAME_VERSION,
    resources: createInitialResourceMap(),
    time: createInitialTimeState(),
    nodes: createInitialNodeStateMap(),
    log: ['Initialized clean Gray Protocol foundation.'],
  }

  return finalizeState(updateUnlockStates(initialState))
}

export function tick(state: GameState, deltaMs: number): GameState {
  const nextState = cloneGameState(state)
  nextState.time = applyActiveTime(nextState.time, deltaMs)
  return finalizeState(applyTickProgress(nextState, deltaMs))
}

export function executeClickNode(state: GameState, nodeID: number): GameState {
  const definition = getNodeDefinition(nodeID)
  if (!definition || definition.nodeType !== 'clicker') {
    return state
  }

  const nextState = updateUnlockStates(cloneGameState(state))
  const runtimeState = nextState.nodes[nodeID]
  if (!runtimeState.unlocked) {
    return appendLog(nextState, `${definition.nodeName} is locked.`)
  }

  const scaledInput = getScaledInput(definition, runtimeState)
  if (!canAffordResources(nextState.resources, scaledInput)) {
    return appendLog(nextState, `${definition.nodeName} cannot afford its inputs.`)
  }

  nextState.resources = applyResourceGain(applyResourceCost(nextState.resources, scaledInput), getScaledOutput(definition, runtimeState))
  appendLog(nextState, `${definition.nodeName} executed.`)
  return finalizeState(nextState)
}

export function togglePassiveNode(state: GameState, nodeID: number, enabled: boolean): GameState {
  const definition = getNodeDefinition(nodeID)
  if (!definition || definition.nodeType !== 'passive') {
    return state
  }

  const nextState = updateUnlockStates(cloneGameState(state))
  const runtimeState = nextState.nodes[nodeID]
  runtimeState.enabled = runtimeState.unlocked ? enabled : false
  appendLog(nextState, `${definition.nodeName} ${runtimeState.enabled ? 'enabled' : 'disabled'}.`)
  return finalizeState(nextState)
}

export function startTimedNode(state: GameState, nodeID: number): GameState {
  const definition = getNodeDefinition(nodeID)
  if (!definition || definition.nodeType !== 'timed-task' || !definition.durationMs) {
    return state
  }

  const nextState = updateUnlockStates(cloneGameState(state))
  const runtimeState = nextState.nodes[nodeID]
  if (!runtimeState.unlocked || runtimeState.isRunning) {
    return nextState
  }

  const scaledInput = getScaledInput(definition, runtimeState)
  if (!canAffordResources(nextState.resources, scaledInput)) {
    return appendLog(nextState, `${definition.nodeName} cannot afford its startup cost.`)
  }

  nextState.resources = applyResourceCost(nextState.resources, scaledInput)
  runtimeState.isRunning = true
  runtimeState.progressMs = 0
  appendLog(nextState, `${definition.nodeName} started.`)
  return finalizeState(nextState)
}

export function upgradeNode(state: GameState, nodeID: number): GameState {
  const definition = getNodeDefinition(nodeID)
  if (!definition) {
    return state
  }

  const nextState = cloneGameState(state)
  const runtimeState = nextState.nodes[nodeID]

  if (!canUpgradeNode(nextState, nodeID)) {
    return appendLog(nextState, `${definition.nodeName} cannot be upgraded.`)
  }

  nextState.resources = applyResourceCost(nextState.resources, getNodeUpgradeCost(nextState, nodeID))
  runtimeState.upgradeLevel += 1
  appendLog(nextState, `${definition.nodeName} upgraded to level ${runtimeState.upgradeLevel}.`)
  return finalizeState(nextState)
}

export function applyOfflineProgress(state: GameState, offlineMs: number): GameState {
  const nextState = cloneGameState(state)
  nextState.time.totalOfflineMs += Math.max(0, offlineMs)
  nextState.time.lastTickAt += Math.max(0, offlineMs)

  const progressedState = applyTickProgress(nextState, Math.max(0, offlineMs))
  if (offlineMs > 0) {
    appendLog(progressedState, `Applied ${offlineMs}ms of offline progress.`)
  }

  return finalizeState(progressedState)
}
