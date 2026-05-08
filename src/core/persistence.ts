import type { GameState, SerializedGameState, SerializedNodeRuntimeState } from './types'
import { GAME_CONFIG } from './config'
import { createInitialGameState, applyOfflineProgress } from './engine'
import { calculateOfflineMs, nowMs } from './time'
import { repairGameState } from './validation'

function canUseLocalStorage(): boolean {
  return typeof localStorage !== 'undefined'
}

function canUseSessionStorage(): boolean {
  return typeof sessionStorage !== 'undefined'
}

function getGrayProtocolScopePatterns(): string[] {
  const normalizedSaveKey = GAME_CONFIG.saveKey.toLowerCase()
  return Array.from(new Set([normalizedSaveKey, normalizedSaveKey.replace(/-save$/, '')]))
}

function matchesGrayProtocolScope(value: string): boolean {
  const normalized = value.toLowerCase()
  return getGrayProtocolScopePatterns().some((pattern) => normalized.includes(pattern))
}

function readStoredState(): string | null {
  if (!canUseLocalStorage()) {
    return null
  }

  try {
    return localStorage.getItem(GAME_CONFIG.saveKey)
  } catch (error) {
    console.error('Failed to read save data from localStorage.', error)
    return null
  }
}

function writeStoredState(rawState: string): boolean {
  if (!canUseLocalStorage()) {
    return false
  }

  try {
    localStorage.setItem(GAME_CONFIG.saveKey, rawState)
    return true
  } catch (error) {
    console.error('Failed to write save data to localStorage.', error)
    return false
  }
}

function removeStoredState(): void {
  if (!canUseLocalStorage()) {
    return
  }

  try {
    localStorage.removeItem(GAME_CONFIG.saveKey)
  } catch (error) {
    console.error('Failed to clear save data from localStorage.', error)
  }
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

export function saveGame(state: GameState): GameState {
  const stateToSave = repairGameState({
    ...state,
    time: {
      ...state.time,
      lastSavedAt: nowMs(),
    },
  })

  if (!writeStoredState(JSON.stringify(serializeState(stateToSave)))) {
    return repairGameState(state)
  }

  return stateToSave
}

export function loadGame(): GameState {
  const rawState = readStoredState()
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
    return saveGame(importedState)
  } catch (error) {
    console.error('Failed to import save data.', error)
    const fallbackState = createImportFallbackState()
    return saveGame(fallbackState)
  }
}

export function clearSave(): void {
  removeStoredState()
}

export async function forceClearBrowserState(): Promise<void> {
  clearSave()

  if (canUseSessionStorage()) {
    try {
      for (let index = 0; index < sessionStorage.length; index += 1) {
        const key = sessionStorage.key(index)
        if (key && matchesGrayProtocolScope(key)) {
          sessionStorage.removeItem(key)
          index -= 1
        }
      }
    } catch (error) {
      console.error('Failed to clear save data from sessionStorage.', error)
    }
  }

  if (typeof caches !== 'undefined') {
    try {
      const cacheKeys = await caches.keys()
      await Promise.all(
        cacheKeys
          .filter((cacheKey) => matchesGrayProtocolScope(cacheKey))
          .map((cacheKey) => caches.delete(cacheKey)),
      )
    } catch (error) {
      console.error('Failed to clear cache storage.', error)
    }
  }

  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(
        registrations
          .filter((registration) => matchesGrayProtocolScope(registration.scope))
          .map((registration) => registration.unregister()),
      )
    } catch (error) {
      console.error('Failed to unregister service workers.', error)
    }
  }
}
