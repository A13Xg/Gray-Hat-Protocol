import type { DecimalSource, NodeType, ResourceKey } from './types'

export const GAME_VERSION = '0.1.0'

export const RESOURCE_KEYS: ResourceKey[] = ['money', 'crypto', 'compute', 'reputation']
export const NODE_TYPES: NodeType[] = ['clicker', 'passive', 'timed-task', 'other']

export const GAME_CONFIG = {
  tickRateMs: 100,
  offlineCapMs: 24 * 60 * 60 * 1000,
  logMaxEntries: 50,
  saveKey: 'gray-hat-protocol-save',
  initialResources: {
    money: '100',
    crypto: '10',
    compute: '0',
    reputation: '0',
  } as Record<ResourceKey, DecimalSource>,
  nodeUpgrade: {
    baseCost: {
      money: '10',
    } as Partial<Record<ResourceKey, DecimalSource>>,
    costMultiplier: '1.15' as DecimalSource,
    maxLevel: 100,
  },
} as const
