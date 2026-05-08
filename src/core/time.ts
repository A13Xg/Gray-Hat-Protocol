import type { TimeState } from './types'

export function nowMs(): number {
  return Date.now()
}

export function createInitialTimeState(now = nowMs()): TimeState {
  return {
    createdAt: now,
    lastTickAt: now,
    lastSavedAt: now,
    lastLoadedAt: now,
    totalActiveMs: 0,
    totalOfflineMs: 0,
  }
}

export function calculateDeltaMs(state: TimeState, timestamp: number): number {
  return Math.max(0, timestamp - state.lastTickAt)
}

export function applyActiveTime(state: TimeState, deltaMs: number): TimeState {
  return {
    ...state,
    lastTickAt: state.lastTickAt + Math.max(0, deltaMs),
    totalActiveMs: state.totalActiveMs + Math.max(0, deltaMs),
  }
}

export function calculateOfflineMs(state: TimeState, now: number, capMs: number): number {
  return Math.max(0, Math.min(capMs, now - state.lastSavedAt))
}
