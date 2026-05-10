import Decimal from 'break_eternity.js'

export type DecimalSource = Decimal | number | string

export type ResourceKey = 'money' | 'crypto' | 'compute' | 'reputation'

export type ResourceMap = Record<ResourceKey, Decimal>
export type PartialResourceMap = Partial<Record<ResourceKey, Decimal>>
export type SerializedResourceMap = Record<ResourceKey, string>

export type ReputationAlignment = 'whitehat' | 'greyhat' | 'blackhat'

export interface TimeState {
  createdAt: number
  lastTickAt: number
  lastSavedAt: number
  lastLoadedAt: number
  totalActiveMs: number
  totalOfflineMs: number
}

export type NodeType = 'clicker' | 'passive' | 'timed-task' | 'other'

export interface NodeUnlockRequirement {
  reputationMin?: Decimal
  reputationMax?: Decimal
  requiredNodeIDs?: number[]
}

export interface RawNodeUnlockRequirement {
  reputationMin?: DecimalSource
  reputationMax?: DecimalSource
  requiredNodeIDs?: number[]
}

export interface RawNodeDefinition {
  nodeID: number
  nodeName: string
  nodeType: NodeType
  baseInput?: Partial<Record<ResourceKey, DecimalSource>>
  baseOutput?: Partial<Record<ResourceKey, DecimalSource>>
  modMultiplier: DecimalSource
  baseMultiplier: DecimalSource
  unlockRequirement?: RawNodeUnlockRequirement
  upgradeLevel?: number
  durationMs?: number
}

export interface NodeDefinition {
  nodeID: number
  nodeName: string
  nodeType: NodeType
  baseInput: PartialResourceMap
  baseOutput: PartialResourceMap
  modMultiplier: Decimal
  baseMultiplier: Decimal
  unlockRequirement: NodeUnlockRequirement
  upgradeLevel: number
  durationMs?: number
}

export interface NodeRuntimeState {
  nodeID: number
  unlocked: boolean
  revealed: boolean
  enabled: boolean
  upgradeLevel: number
  progressMs: number
  completions: number
  isRunning: boolean
  autoRun: boolean
}

export interface GameState {
  version: string
  resources: ResourceMap
  time: TimeState
  nodes: Record<number, NodeRuntimeState>
  preferences: UserPreferences
  log: string[]
}

export interface UserPreferences {
  soundsEnabled: boolean
  preventSleep: boolean
  adminAccessCode: string
}

export interface SerializedNodeRuntimeState {
  nodeID: number
  unlocked: boolean
  revealed: boolean
  enabled: boolean
  upgradeLevel: number
  progressMs: number
  completions: number
  isRunning: boolean
  autoRun: boolean
}

export interface SerializedGameState {
  version: string
  resources: SerializedResourceMap
  time: TimeState
  nodes: Record<number, SerializedNodeRuntimeState>
  preferences?: Partial<UserPreferences>
  log: string[]
}
