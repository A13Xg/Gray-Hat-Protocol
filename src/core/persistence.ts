import type { GameState, SerializedGameState, SerializedNodeRuntimeState } from './types'
import { GAME_CONFIG } from './config'
import { createInitialGameState, applyOfflineProgress } from './engine'
import { calculateOfflineMs, nowMs } from './time'
import { repairGameState } from './validation'

function canUseLocalStorage(): boolean {
  return typeof localStorage !== 'undefined'
}

function serializeState(state: GameState): SerializedGameState {
  return {
    version: state.version,
    resources: {
      money: state.resources.money.toString(),
      crypto: state.resources.crypto.toString(),
      compute: state.resources.compute.toString(),
      reputation: state.resources.reputation.toString(),
    },
    time: state.time,
    nodes: Object.fromEntries(
      Object.values(state.nodes).map((runtimeState) => [
        runtimeState.nodeID,
        {
          ...runtimeState,
        } satisfies SerializedNodeRuntimeState,
      ]),
    ),
    log: [...state.log],
  }
}

function deserializeState(raw: string): GameState {
  const parsed = JSON.parse(raw) as SerializedGameState
  return repairGameState(parsed)
}

function createImportFallbackState(): GameState {
  const fallbackState = createInitialGameState()
  fallbackState.log = [...fallbackState.log, 'Import failed. Created a fresh game state.'].slice(
    -GAME_CONFIG.logMaxEntries,
  )
  return fallbackState
}

function applyLoadTime(state: GameState): GameState {
  const currentTime = nowMs()
  const offlineMs = calculateOfflineMs(state.time, currentTime, GAME_CONFIG.offlineCapMs)
  const loadedState = applyOfflineProgress(state, offlineMs)

  loadedState.time.lastLoadedAt = currentTime
  loadedState.time.lastTickAt = currentTime
  loadedState.log = [...loadedState.log, 'Loaded save state.'].slice(-GAME_CONFIG.logMaxEntries)
  return loadedState
}

export function saveGame(state: GameState): void {
  if (!canUseLocalStorage()) {
    return
  }

  const stateToSave = repairGameState({
    ...state,
    time: {
      ...state.time,
      lastSavedAt: nowMs(),
    },
  })

  localStorage.setItem(GAME_CONFIG.saveKey, JSON.stringify(serializeState(stateToSave)))
}

export function loadGame(): GameState {
  if (!canUseLocalStorage()) {
    return createInitialGameState()
  }

  const rawState = localStorage.getItem(GAME_CONFIG.saveKey)
  if (!rawState) {
    return createInitialGameState()
  }

  try {
    return applyLoadTime(deserializeState(rawState))
  } catch {
    return createInitialGameState()
  }
}

export function exportSave(state: GameState): string {
  return JSON.stringify(serializeState(repairGameState(state)), null, 2)
}

export function importSave(raw: string): GameState {
  try {
    const importedState = applyLoadTime(deserializeState(raw))
    saveGame(importedState)
    return importedState
  } catch (error) {
    console.error('Failed to import save data.', error)
    const fallbackState = createImportFallbackState()
    saveGame(fallbackState)
    return fallbackState
  }
}

export function clearSave(): void {
  if (!canUseLocalStorage()) {
    return
  }

  localStorage.removeItem(GAME_CONFIG.saveKey)
}
