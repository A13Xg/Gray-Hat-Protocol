import type { DecimalSource, NodeType, ResourceKey, TalentKey } from './types'

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
      money: '14',
    } as Partial<Record<ResourceKey, DecimalSource>>,
    costMultiplier: '1.22' as DecimalSource,
    maxLevel: 100,
  },
  prestige: {
    minMoneyForPrestige: '120000' as DecimalSource,
    minAbsReputationForPrestige: '320' as DecimalSource,
    moneyShardDivisor: 180000,
    reputationShardDivisor: 420,
    baseShardBonus: 1,
  },
  talentTree: {
    maxTalentLevel: 12,
    costs: [1, 1, 2, 2, 3, 3, 4, 5, 6, 8, 10, 12],
    keys: [
      'whitehatYield',
      'blackhatYield',
      'passiveEfficiency',
      'taskAcceleration',
      'reputationStability',
      'computeSurge',
    ] as TalentKey[],
  },
} as const
