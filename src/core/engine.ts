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
  toDecimalResourceMap,
} from './resources'
import { getReputationAlignment } from './resources'
import { applyActiveTime, createInitialTimeState } from './time'
import { STARTER_NODE_DEFINITION_ERRORS, repairGameState, validateGameState } from './validation'
import type {
  DecimalSource,
  GameState,
  NodeDefinition,
  NodeRuntimeState,
  PartialResourceMap,
  ResourceKey,
  TalentKey,
} from './types'

function cloneNodeStateMap(nodes: Record<number, NodeRuntimeState>): Record<number, NodeRuntimeState> {
  return Object.fromEntries(Object.values(nodes).map((runtimeState) => [runtimeState.nodeID, { ...runtimeState }]))
}

function cloneGameState(state: GameState): GameState {
  return {
    version: state.version,
    resources: { ...state.resources },
    time: { ...state.time },
    nodes: cloneNodeStateMap(state.nodes),
    meta: {
      ...state.meta,
      talents: { ...state.meta.talents },
    },
    preferences: { ...state.preferences },
    log: [...state.log],
  }
}

function appendLog(state: GameState, message: string): GameState {
  state.log = [...state.log, message].slice(-GAME_CONFIG.logMaxEntries)
  return state
}

function getTotalTalentLevel(state: GameState): number {
  return Object.values(state.meta.talents).reduce((sum, level) => sum + level, 0)
}

function talentScalar(state: GameState, key: TalentKey, perLevel: number): Decimal {
  return new Decimal(1 + state.meta.talents[key] * perLevel)
}

function getGlobalOutputMultiplier(
  state: GameState,
  definition: NodeDefinition,
  runtimeState: NodeRuntimeState,
): Decimal {
  const alignment = getReputationAlignment(state.resources)
  const prestigeBoost = new Decimal(1 + state.meta.prestigeCount * 0.18)
  let multiplier = prestigeBoost

  if (definition.nodeType === 'passive') {
    multiplier = multiplier.mul(talentScalar(state, 'passiveEfficiency', 0.08))
  }

  if (definition.nodeType === 'timed-task') {
    multiplier = multiplier.mul(talentScalar(state, 'taskAcceleration', 0.05))
  }

  if (definition.nodeType === 'clicker') {
    if (alignment === 'whitehat') {
      multiplier = multiplier.mul(talentScalar(state, 'whitehatYield', 0.06))
    } else if (alignment === 'blackhat') {
      multiplier = multiplier.mul(talentScalar(state, 'blackhatYield', 0.06))
    }

    multiplier = multiplier.mul(new Decimal(1 + runtimeState.upgradeLevel * 0.01))
  }

  multiplier = multiplier.mul(talentScalar(state, 'computeSurge', 0.04))
  return multiplier
}

function getScaledOutputWithMeta(
  state: GameState,
  definition: NodeDefinition,
  runtimeState: NodeRuntimeState,
): PartialResourceMap {
  const scaled = multiplyResourceMap(
    getScaledOutput(definition, runtimeState),
    getGlobalOutputMultiplier(state, definition, runtimeState),
  )

  if (scaled.reputation) {
    const stabilityMultiplier = Math.max(0.4, 1 - state.meta.talents.reputationStability * 0.05)
    scaled.reputation = scaled.reputation.mul(stabilityMultiplier)
  }

  // Softcap runaway growth to keep progression readable and avoid instant inflation spikes.
  for (const key of Object.keys(scaled) as ResourceKey[]) {
    const value = scaled[key]
    if (!value) {
      continue
    }

    const sign = value.lt(0) ? -1 : 1
    const abs = value.abs()
    const softcapStart = new Decimal(2500)
    if (abs.lte(softcapStart)) {
      continue
    }

    const compressed = softcapStart.mul(abs.div(softcapStart).pow(0.58))
    scaled[key] = compressed.mul(sign)
  }

  return scaled
}

function updateUnlockStates(state: GameState): GameState {
  const nextNodes = cloneNodeStateMap(state.nodes)

  for (let iteration = 0; iteration < NODE_DEFINITIONS.length; iteration += 1) {
    let changed = false

    for (const definition of NODE_DEFINITIONS) {
      const nextUnlocked = isNodeUnlocked(definition, nextNodes, state.resources)
      if (nextNodes[definition.nodeID].unlocked !== nextUnlocked) {
        nextNodes[definition.nodeID].unlocked = nextUnlocked
        changed = true
      }

      if (nextUnlocked && !nextNodes[definition.nodeID].revealed) {
        nextNodes[definition.nodeID].revealed = true
        changed = true
      }
    }

    if (!changed) {
      break
    }
  }

  state.nodes = nextNodes

  for (const definition of NODE_DEFINITIONS) {
    if (!state.nodes[definition.nodeID].unlocked && definition.nodeType === 'passive') {
      state.nodes[definition.nodeID].enabled = false
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
    const scaledOutput = multiplyResourceMap(getScaledOutputWithMeta(state, definition, runtimeState), seconds)

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
    state.resources = applyResourceGain(state.resources, getScaledOutputWithMeta(state, definition, runtimeState))
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
  if (!runtimeState || !runtimeState.unlocked || runtimeState.upgradeLevel >= GAME_CONFIG.nodeUpgrade.maxLevel) {
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
    meta: {
      prestigeCount: 0,
      cypherShards: 0,
      lifetimeCypherShards: 0,
      talentPointsSpent: 0,
      talents: {
        whitehatYield: 0,
        blackhatYield: 0,
        passiveEfficiency: 0,
        taskAcceleration: 0,
        reputationStability: 0,
        computeSurge: 0,
      },
    },
    preferences: {
      soundsEnabled: true,
      preventSleep: false,
      adminAccessCode: '1234',
    },
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

  nextState.resources = applyResourceGain(
    applyResourceCost(nextState.resources, scaledInput),
    getScaledOutputWithMeta(nextState, definition, runtimeState),
  )
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

export function replaceResources(
  state: GameState,
  resources: Partial<Record<ResourceKey, DecimalSource>>,
): GameState {
  const nextState = cloneGameState(state)
  nextState.resources = repairResourceMap(
    toDecimalResourceMap({
      ...nextState.resources,
      ...resources,
    }),
  )
  appendLog(nextState, 'Debug resources updated.')
  return finalizeState(updateUnlockStates(nextState))
}

export function calculatePrestigeGain(state: GameState): number {
  const minMoney = new Decimal(GAME_CONFIG.prestige.minMoneyForPrestige)
  const minAbsRep = new Decimal(GAME_CONFIG.prestige.minAbsReputationForPrestige)
  const money = state.resources.money.max(0)
  const absRep = state.resources.reputation.abs()

  if (money.lt(minMoney) || absRep.lt(minAbsRep)) {
    return 0
  }

  const moneyScore = Math.floor(Math.sqrt(money.div(GAME_CONFIG.prestige.moneyShardDivisor).toNumber()))
  const repScore = Math.floor(Math.sqrt(absRep.div(GAME_CONFIG.prestige.reputationShardDivisor).toNumber()))
  return Math.max(0, GAME_CONFIG.prestige.baseShardBonus + moneyScore + repScore)
}

export function canPrestige(state: GameState): boolean {
  return calculatePrestigeGain(state) > 0
}

export function performPrestige(state: GameState): GameState {
  const gain = calculatePrestigeGain(state)
  if (gain <= 0) {
    return appendLog(cloneGameState(state), 'Prestige requirements not met.')
  }

  const nextState = createInitialGameState()
  nextState.meta = {
    ...state.meta,
    prestigeCount: state.meta.prestigeCount + 1,
    cypherShards: state.meta.cypherShards + gain,
    lifetimeCypherShards: state.meta.lifetimeCypherShards + gain,
  }
  nextState.log = [...nextState.log, `Prestiged for ${gain} Cypher Shards.`].slice(-GAME_CONFIG.logMaxEntries)
  return finalizeState(nextState)
}

export function getTalentUpgradeCost(state: GameState, key: TalentKey): number {
  const level = state.meta.talents[key]
  const costs = GAME_CONFIG.talentTree.costs
  if (level >= GAME_CONFIG.talentTree.maxTalentLevel || level >= costs.length) {
    return Number.POSITIVE_INFINITY
  }

  return costs[level]
}

export function canUnlockTalent(state: GameState, key: TalentKey): boolean {
  const level = state.meta.talents[key]
  if (level >= GAME_CONFIG.talentTree.maxTalentLevel) {
    return false
  }

  return state.meta.cypherShards >= getTalentUpgradeCost(state, key)
}

export function unlockTalent(state: GameState, key: TalentKey): GameState {
  const nextState = cloneGameState(state)
  if (!canUnlockTalent(nextState, key)) {
    return appendLog(nextState, `Talent ${key} cannot be upgraded.`)
  }

  const cost = getTalentUpgradeCost(nextState, key)
  nextState.meta.cypherShards -= cost
  nextState.meta.talents[key] += 1
  nextState.meta.talentPointsSpent = getTotalTalentLevel(nextState)
  return appendLog(nextState, `Talent ${key} upgraded to ${nextState.meta.talents[key]}.`)
}
