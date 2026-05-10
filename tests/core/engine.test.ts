import Decimal from 'break_eternity.js'
import { describe, expect, it } from 'vitest'

import {
  calculatePrestigeGain,
  canPrestige,
  canUpgradeNode,
  createInitialGameState,
  performPrestige,
  replaceResources,
  unlockTalent,
} from '../../src/core/engine'
import { NODE_DEFINITIONS } from '../../src/core/nodes'

describe('engine core progression', () => {
  it('starts with valid initial state', () => {
    const state = createInitialGameState()
    expect(state.version.length).toBeGreaterThan(0)
    expect(Object.keys(state.nodes)).toHaveLength(NODE_DEFINITIONS.length)
    expect(state.meta.cypherShards).toBe(0)
  })

  it('gates prestige until thresholds are reached', () => {
    const initial = createInitialGameState()
    expect(calculatePrestigeGain(initial)).toBe(0)
    expect(canPrestige(initial)).toBe(false)

    const progressed = replaceResources(initial, {
      money: new Decimal(5_000_000),
      reputation: new Decimal(1_500),
    })
    expect(calculatePrestigeGain(progressed)).toBeGreaterThan(0)
    expect(canPrestige(progressed)).toBe(true)
  })

  it('preserves meta state across prestige reset', () => {
    const initial = createInitialGameState()
    const progressed = replaceResources(initial, {
      money: new Decimal(6_000_000),
      reputation: new Decimal(2_100),
    })
    const gain = calculatePrestigeGain(progressed)
    const prestiged = performPrestige(progressed)

    expect(prestiged.meta.prestigeCount).toBe(1)
    expect(prestiged.meta.cypherShards).toBe(gain)
    expect(prestiged.resources.money.lte(new Decimal(200))).toBe(true)
  })

  it('allows talent unlock when enough shards exist', () => {
    let state = createInitialGameState()
    state = replaceResources(state, {
      money: new Decimal(8_000_000),
      reputation: new Decimal(3_200),
    })
    state = performPrestige(state)
    const shardsBefore = state.meta.cypherShards

    const afterTalent = unlockTalent(state, 'computeSurge')
    expect(afterTalent.meta.talents.computeSurge).toBe(1)
    expect(afterTalent.meta.cypherShards).toBeLessThan(shardsBefore)
  })

  it('does not allow upgrades on locked nodes', () => {
    const state = createInitialGameState()
    const whitehatNode = NODE_DEFINITIONS.find((node) => node.nodeName === 'Lockdown Firewall')
    expect(whitehatNode).toBeDefined()
    expect(canUpgradeNode(state, whitehatNode!.nodeID)).toBe(false)
  })
})

