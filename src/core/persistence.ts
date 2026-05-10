import type { GameState, SerializedGameState, SerializedNodeRuntimeState } from './types'
import { GAME_CONFIG } from './config'
import { createInitialGameState, applyOfflineProgress } from './engine'
import { calculateOfflineMs, nowMs } from './time'
import { logger } from './logger'
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

function safelyExecute<T>(fallbackValue: T, operationName: string, fn: () => T): T {
  try {
    return fn()
  } catch (error) {
    logger.error(operationName, error)
    return fallbackValue
  }
}

function readStoredState(): string | null {
  if (!canUseLocalStorage()) {
    return null
  }

  return safelyExecute(null, 'Failed to read save data from localStorage.', () =>
    localStorage.getItem(GAME_CONFIG.saveKey),
  )
}

function writeStoredState(rawState: string): boolean {
  if (!canUseLocalStorage()) {
    return false
  }

  return safelyExecute(false, 'Failed to write save data to localStorage.', () => {
    localStorage.setItem(GAME_CONFIG.saveKey, rawState)
    return true
  })
}

function removeStoredState(): void {
  if (!canUseLocalStorage()) {
    return
  }

  safelyExecute(undefined, 'Failed to clear save data from localStorage.', () => {
    localStorage.removeItem(GAME_CONFIG.saveKey)
  })
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
    preferences: { ...state.preferences },
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
    logger.error('Failed to import save data.', error)
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
    safelyExecute(undefined, 'Failed to clear save data from sessionStorage.', () => {
      const matchingKeys: string[] = []
      for (let index = 0; index < sessionStorage.length; index += 1) {
        const key = sessionStorage.key(index)
        if (key && matchesGrayProtocolScope(key)) {
          matchingKeys.push(key)
        }
      }

      for (const key of matchingKeys) {
        sessionStorage.removeItem(key)
      }
    })
  }

  if (typeof caches !== 'undefined') {
    await safelyExecute(undefined, 'Failed to clear cache storage.', async () => {
      const cacheKeys = await caches.keys()
      await Promise.all(
        cacheKeys
          .filter((cacheKey) => matchesGrayProtocolScope(cacheKey))
          .map((cacheKey) => caches.delete(cacheKey)),
      )
    })
  }

  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    await safelyExecute(undefined, 'Failed to unregister service workers.', async () => {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(
        registrations
          .filter((registration) => matchesGrayProtocolScope(registration.scope))
          .map((registration) => registration.unregister()),
      )
    })
  }
}
