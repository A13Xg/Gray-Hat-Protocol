<script setup lang="ts">
import Decimal from 'break_eternity.js'
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'

import { GAME_CONFIG, RESOURCE_KEYS } from './core/config'
import {
  canUpgradeNode,
  createInitialGameState,
  executeClickNode,
  getNodeUpgradeCost,
  replaceResources,
  tick,
  upgradeNode,
} from './core/engine'
import { NODE_DEFINITIONS, getScaledOutput } from './core/nodes'
import { clearSave, forceClearBrowserState, loadGame } from './core/persistence'
import { getReputationAlignment } from './core/resources'
import { calculateDeltaMs, nowMs } from './core/time'
import blackHatImage from './assets/images/BlackHat.png'
import greyHatImage from './assets/images/GreyHat.png'
import whiteHatImage from './assets/images/WhiteHat.png'
import type { ReputationAlignment, ResourceKey } from './core/types'

type RateMap = Record<ResourceKey, number>
type CollapsiblePanel = 'resources' | 'clock' | 'clickers' | 'operations' | 'systems'

const resourceIcons: Record<ResourceKey, string> = {
  money: 'paid',
  crypto: 'currency_bitcoin',
  compute: 'memory',
  reputation: 'workspace_premium',
}
const hatImages: Record<ReputationAlignment, string> = {
  blackhat: blackHatImage,
  greyhat: greyHatImage,
  whitehat: whiteHatImage,
}

const state = ref(loadGame())
const activePanels = reactive<Record<CollapsiblePanel, boolean>>({
  resources: true,
  clock: true,
  clickers: true,
  operations: true,
  systems: true,
})
const visibleTimeMs = ref(state.value.time.totalActiveMs)
const isDebugMenuOpen = ref(false)
const isForceClearing = ref(false)
const debugStatusMessage = ref('')
const debugResourceKey = ref<ResourceKey>('money')
const debugResourceAmount = ref('100')
const resourceRates = reactive<RateMap>({
  money: 0,
  crypto: 0,
  compute: 0,
  reputation: 0,
})

const previousResources: Record<ResourceKey, Decimal> = {
  money: state.value.resources.money,
  crypto: state.value.resources.crypto,
  compute: state.value.resources.compute,
  reputation: state.value.resources.reputation,
}

let tickIntervalId: number | undefined
let frameId: number | undefined
let previousRateSampleAt = nowMs()
let previousFrameAt = nowMs()

const clickerNodes = computed(() => {
  const allowedNames = new Set(['Hack Computer', 'Harden Computer'])
  return NODE_DEFINITIONS.filter((node) => node.nodeType === 'clicker' && allowedNames.has(node.nodeName))
})

const resourceCards = computed(() => {
  return RESOURCE_KEYS.map((key) => ({
    key,
    icon: resourceIcons[key],
    label: key.charAt(0).toUpperCase() + key.slice(1),
    value: formatWholeDecimal(state.value.resources[key]),
    rate: formatRate(resourceRates[key]),
  }))
})
const reputationAlignment = computed(() => getReputationAlignment(state.value.resources))
const hatImageSrc = computed(() => hatImages[reputationAlignment.value])
const hatWord = computed(() => {
  if (reputationAlignment.value === 'whitehat') {
    return 'White'
  }

  if (reputationAlignment.value === 'blackhat') {
    return 'Black'
  }

  return 'Grey'
})
const clockSegments = computed(() => {
  const totalTenths = Math.max(0, Math.floor(visibleTimeMs.value / 100))
  const tenths = totalTenths % 10
  const totalSeconds = Math.floor(totalTenths / 10)
  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const minutes = totalMinutes % 60
  const hours = Math.min(Math.floor(totalMinutes / 60), 9999)

  return [
    { label: 'Hour', value: hours.toString().padStart(4, '0') },
    { label: 'Minute', value: minutes.toString().padStart(2, '0') },
    { label: 'Second', value: seconds.toString().padStart(2, '0') },
    { label: 'Ms', value: tenths.toString() },
  ]
})

function stepGame(): void {
  const timestamp = nowMs()
  const deltaMs = calculateDeltaMs(state.value.time, timestamp)
  state.value = tick(state.value, deltaMs)
}

function updateResourceRates(timestamp: number): void {
  const deltaSeconds = Math.max((timestamp - previousRateSampleAt) / 1000, 0.001)
  previousRateSampleAt = timestamp

  for (const key of RESOURCE_KEYS) {
    const currentValue = state.value.resources[key]
    const delta = currentValue.sub(previousResources[key]).toNumber()
    const instantRate = Number.isFinite(delta) ? delta / deltaSeconds : 0
    const smoothing = instantRate === 0 ? 0.82 : 0.36
    resourceRates[key] = resourceRates[key] * smoothing + instantRate * (1 - smoothing)

    if (Math.abs(resourceRates[key]) < 0.04) {
      resourceRates[key] = 0
    }

    previousResources[key] = currentValue
  }
}

function animateFrame(): void {
  const timestamp = nowMs()
  const deltaMs = Math.max(timestamp - previousFrameAt, 0)
  previousFrameAt = timestamp

  updateResourceRates(timestamp)
  visibleTimeMs.value += (state.value.time.totalActiveMs - visibleTimeMs.value) * Math.min(deltaMs / 120, 1)
  frameId = window.setTimeout(animateFrame, 100)
}

function executeNode(nodeID: number): void {
  state.value = executeClickNode(state.value, nodeID)
}

function upgradeSelectedNode(nodeID: number): void {
  state.value = upgradeNode(state.value, nodeID)
}

function displayNodeLevel(nodeID: number): number {
  return Math.max(1, state.value.nodes[nodeID]?.upgradeLevel ?? 0)
}

function togglePanel(panel: CollapsiblePanel): void {
  activePanels[panel] = !activePanels[panel]
}

function formatWholeDecimal(value: Decimal): string {
  const numberValue = value.toNumber()
  if (!Number.isFinite(numberValue)) {
    return value.toString()
  }

  return Math.round(numberValue).toLocaleString()
}

function formatSignedWhole(value: Decimal): string {
  const rounded = Math.round(value.toNumber())
  return `${rounded >= 0 ? '+' : ''}${rounded.toLocaleString()}`
}

function formatRate(value: number): string {
  const rounded = Math.round(value)
  return `${rounded.toLocaleString()}/s`
}

function outputSummary(nodeID: number): string {
  const definition = NODE_DEFINITIONS.find((node) => node.nodeID === nodeID)
  const runtimeState = state.value.nodes[nodeID]
  if (!definition || !runtimeState) {
    return 'No output'
  }

  return Object.entries(getScaledOutput(definition, runtimeState))
    .map(([key, value]) => `${formatSignedWhole(value)} ${key === 'reputation' ? 'Rep' : key}`)
    .join(' / ')
}

function upgradeCostSummary(nodeID: number): string {
  const entries = Object.entries(getNodeUpgradeCost(state.value, nodeID))
  if (entries.length === 0) {
    return 'Max'
  }

  return entries.map(([key, value]) => `${formatWholeDecimal(value)} ${key}`).join(' / ')
}

function syncPreviousResourcesFromState(): void {
  for (const key of RESOURCE_KEYS) {
    previousResources[key] = state.value.resources[key]
  }
}

function parseDebugAmount(): Decimal | undefined {
  try {
    const amount = new Decimal(debugResourceAmount.value)
    return amount.isFinite() ? amount : undefined
  } catch {
    return undefined
  }
}

function adjustDebugResource(direction: 1 | -1): void {
  const amount = parseDebugAmount()
  if (!amount) {
    debugStatusMessage.value = 'Enter a finite resource amount.'
    return
  }

  const resourceKey = debugResourceKey.value
  const nextValue = state.value.resources[resourceKey].add(amount.mul(direction))
  state.value = replaceResources(state.value, { [resourceKey]: nextValue })
  syncPreviousResourcesFromState()
  debugStatusMessage.value = `${direction > 0 ? 'Added' : 'Removed'} ${amount.toString()} ${resourceKey}.`
}

function resetCurrentGame(): void {
  state.value = createInitialGameState()
  syncPreviousResourcesFromState()
  debugStatusMessage.value = 'Reset current game state.'
}

function deleteSaveData(): void {
  clearSave()
  debugStatusMessage.value = 'Deleted browser save data.'
}

async function forceDeleteAllBrowserSaveData(): Promise<void> {
  isForceClearing.value = true

  try {
    await forceClearBrowserState()
    state.value = createInitialGameState()
    syncPreviousResourcesFromState()
    debugStatusMessage.value = 'Deleted all scoped browser save/cache data and reset state.'
  } finally {
    isForceClearing.value = false
  }
}

function handleGlobalKeydown(event: KeyboardEvent): void {
  if (event.key === '?' || (event.shiftKey && event.code === 'Slash')) {
    event.preventDefault()
    isDebugMenuOpen.value = !isDebugMenuOpen.value
    return
  }

  if (event.key === 'Escape' && isDebugMenuOpen.value) {
    isDebugMenuOpen.value = false
  }
}

onMounted(() => {
  tickIntervalId = window.setInterval(stepGame, GAME_CONFIG.tickRateMs)
  frameId = window.setTimeout(animateFrame, 100)
  window.addEventListener('keydown', handleGlobalKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleGlobalKeydown)

  if (tickIntervalId !== undefined) {
    window.clearInterval(tickIntervalId)
  }

  if (frameId !== undefined) {
    window.clearTimeout(frameId)
  }
})
</script>

<template>
  <main class="game-shell">
    <section class="top-row">
      <article class="hero-panel cyber">
        <div class="hero-title-wrap">
          <div class="title-line">
            <img class="title-hat" :src="hatImageSrc" :alt="`${hatWord} hat`" />
            <h1 class="title-copy" :class="reputationAlignment">
              <span>
                <span class="hat-word" :data-text="hatWord">{{ hatWord }}</span>
                <span class="hat-label"> Hat</span>
              </span>
              <span>Protocol</span>
            </h1>
          </div>
        </div>
      </article>

      <article class="panel resource-panel">
        <div class="panel-heading">Total Resources</div>
        <div class="resource-stack">
          <div v-for="resource in resourceCards" :key="resource.key" class="resource-row info-panel">
            <span class="resource-icon" aria-hidden="true">{{ resource.icon }}</span>
            <span class="resource-label">{{ resource.label }}</span>
            <strong>{{ resource.value }}</strong>
            <em>{{ resource.rate }}</em>
          </div>
        </div>
      </article>

      <article class="panel clock-panel">
        <div class="panel-heading">Elapsed Time</div>
        <div class="clock-face">
          <div class="clock-readout" aria-label="Session runtime">
            <template v-for="(segment, index) in clockSegments" :key="segment.label">
              <div class="clock-segment">
                <strong>{{ segment.value }}</strong>
                <small>{{ segment.label }}</small>
              </div>
              <span v-if="index < clockSegments.length - 1" class="clock-separator">:</span>
            </template>
          </div>
        </div>
      </article>
    </section>

    <div class="top-divider" aria-hidden="true"></div>

    <section class="node-layout">
      <article class="panel nodes-panel resizable-panel">
        <button class="panel-toggle" type="button" @click="togglePanel('clickers')">
          <span>Keystrokes</span>
          <span>{{ activePanels.clickers ? 'Collapse' : 'Expand' }}</span>
        </button>
        <Transition name="panel-reveal">
          <!-- clickersSection: first active node subsection for manual clicker actions. -->
          <div v-if="activePanels.clickers" class="node-grid">
            <article v-for="node in clickerNodes" :key="node.nodeID" class="node-card">
              <span class="level-badge">L{{ displayNodeLevel(node.nodeID) }}</span>
              <div class="node-title">{{ node.nodeName }}</div>
              <button
                class="primary-node-action"
                type="button"
                :disabled="!state.nodes[node.nodeID].unlocked"
                @click="executeNode(node.nodeID)"
              >
                {{ node.nodeName }}
              </button>
              <div class="node-footer">
                <div class="node-stat">{{ outputSummary(node.nodeID) }}</div>
                <button
                  class="upgrade-button"
                  type="button"
                  :disabled="!canUpgradeNode(state, node.nodeID)"
                  @click="upgradeSelectedNode(node.nodeID)"
                >
                  Upgrade
                  <small>{{ upgradeCostSummary(node.nodeID) }}</small>
                </button>
              </div>
            </article>
          </div>
        </Transition>
      </article>

      <article class="panel nodes-panel resizable-panel placeholder-panel">
        <button class="panel-toggle" type="button" @click="togglePanel('operations')">
          <span>Operations</span>
          <span>{{ activePanels.operations ? 'Collapse' : 'Expand' }}</span>
        </button>
        <Transition name="panel-reveal">
          <div v-if="activePanels.operations" class="placeholder-node info-panel">
            <strong>Placeholder Node</strong>
            <span>Queued for future timed tasks.</span>
          </div>
        </Transition>
      </article>

      <article class="panel nodes-panel resizable-panel placeholder-panel">
        <button class="panel-toggle" type="button" @click="togglePanel('systems')">
          <span>Systems</span>
          <span>{{ activePanels.systems ? 'Collapse' : 'Expand' }}</span>
        </button>
        <Transition name="panel-reveal">
          <div v-if="activePanels.systems" class="placeholder-node info-panel">
            <strong>Placeholder Node</strong>
            <span>Queued for future passive systems.</span>
          </div>
        </Transition>
      </article>
    </section>

    <Teleport to="body">
      <div v-if="isDebugMenuOpen" class="debug-overlay" role="dialog" aria-modal="true" aria-label="Debug menu">
        <section class="debug-menu">
          <header class="debug-header">
            <div>
              <span>Debug Console</span>
              <strong>Shift + /</strong>
            </div>
            <button type="button" @click="isDebugMenuOpen = false">Close</button>
          </header>

          <div class="debug-grid">
            <section class="debug-section">
              <h2>Resources</h2>
              <label>
                Resource
                <select v-model="debugResourceKey">
                  <option v-for="resourceKey in RESOURCE_KEYS" :key="resourceKey" :value="resourceKey">
                    {{ resourceKey }}
                  </option>
                </select>
              </label>
              <label>
                Amount
                <input v-model="debugResourceAmount" type="number" inputmode="decimal" />
              </label>
              <div class="debug-actions">
                <button type="button" @click="adjustDebugResource(1)">Add</button>
                <button type="button" @click="adjustDebugResource(-1)">Remove</button>
              </div>
            </section>

            <section class="debug-section">
              <h2>Save Data</h2>
              <div class="debug-actions stacked">
                <button type="button" @click="resetCurrentGame">Reset Current State</button>
                <button type="button" @click="deleteSaveData">Delete Save Data</button>
                <button type="button" :disabled="isForceClearing" @click="forceDeleteAllBrowserSaveData">
                  {{ isForceClearing ? 'Clearing...' : 'Delete All Browser Data' }}
                </button>
              </div>
              <p v-if="debugStatusMessage" class="debug-status">{{ debugStatusMessage }}</p>
            </section>

            <section class="debug-section debug-log-section">
              <h2>Live Log</h2>
              <ol class="debug-log">
                <li v-for="(entry, index) in [...state.log].reverse()" :key="`${index}-${entry}`">{{ entry }}</li>
              </ol>
            </section>
          </div>
        </section>
      </div>
    </Teleport>
  </main>
</template>

<style scoped>
@import url("https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24..48,400..700,0..1,0");

:global(*) {
  box-sizing: border-box;
}

:global(body) {
  margin: 0;
  min-width: 320px;
  color: #444466;
  background:
    radial-gradient(circle at top left, rgba(0, 245, 255, 0.08), transparent 34rem),
    radial-gradient(circle at bottom right, rgba(255, 0, 110, 0.07), transparent 30rem),
    #0a0a0f;
  font-family: "Space Grotesk", "Inter", "Segoe UI", sans-serif;
}

:global(button) {
  font: inherit;
}

.game-shell {
  width: min(1440px, 100%);
  min-height: 100vh;
  margin: 0 auto;
  padding: clamp(1rem, 2vw, 2rem);
  display: grid;
  align-content: start;
  grid-auto-rows: max-content;
  gap: 0;
}

.cyber {
  background: #0a0a0f;
  border: 1px solid #00f5ff;
  color: #00f5ff;
  text-shadow: 0 0 10px #00f5ff;
  box-shadow: 0 0 20px rgba(0, 245, 255, 0.2);
}

.hero-panel,
.panel {
  position: relative;
  overflow: hidden;
  border-radius: 8px;
}

.hero-panel::before,
.panel::before {
  content: "";
  position: absolute;
  inset: 0 0 auto;
  height: 1px;
  background: linear-gradient(90deg, transparent, #00f5ff, transparent);
  opacity: 0.9;
}

.hero-panel {
  min-height: 0;
  padding: 0.06rem 0.16rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.hero-title-wrap {
  min-width: 0;
}

.eyebrow {
  margin: 0 0 0.09rem;
  color: #39ff14;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 0.6rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  text-shadow: 0 0 6px rgba(57, 255, 20, 0.4);
}

.title-line {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.34rem;
  min-width: 0;
}

.title-hat {
  flex: 0 0 auto;
  width: clamp(3.8rem, 6.2vw, 5.7rem);
  margin: -0.55rem;
  aspect-ratio: 1;
  object-fit: contain;
  filter: drop-shadow(0 0 8px rgba(156, 163, 175, 0.45));
}

h1 {
  margin: 0;
  color: #9ca3af;
  font-family: "Space Grotesk", sans-serif;
  font-size: 2rem;
  font-weight: 700;
  letter-spacing: 0;
  line-height: 0.86;
  white-space: nowrap;
  text-shadow: 0 0 12px rgba(156, 163, 175, 0.4);
}

.title-copy {
  display: grid;
  place-items: center;
  text-align: center;
}

.title-copy.whitehat {
  color: #f8fafc;
  text-shadow: 0 0 7px rgba(255, 255, 255, 0.65), 0 0 14px rgba(0, 245, 255, 0.3);
  animation: white-title-shine 2.4s ease-in-out infinite;
}

.title-copy.blackhat {
  color: #ff3b6f;
  text-shadow:
    0 0 2px rgba(255, 190, 205, 0.95),
    0 0 8px rgba(255, 0, 64, 0.85),
    0 0 18px rgba(255, 0, 64, 0.5);
}

.hat-word {
  display: inline-block;
  position: relative;
  isolation: isolate;
  vertical-align: baseline;
}

.title-copy.greyhat .hat-word::before,
.title-copy.greyhat .hat-word::after {
  content: attr(data-text);
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  opacity: 0.72;
  mix-blend-mode: screen;
  text-align: inherit;
}

.title-copy.greyhat .hat-word::before {
  color: #00f5ff;
  transform: translate3d(1px, 0, 0);
  clip-path: inset(0 0 54% 0);
  animation: title-glitch-cyan 1.45s linear infinite;
  will-change: transform, clip-path, opacity;
}

.title-copy.greyhat .hat-word::after {
  color: #ff006e;
  transform: translate3d(-1px, 0, 0);
  clip-path: inset(48% 0 0 0);
  animation: title-glitch-magenta 1.75s linear infinite;
  will-change: transform, clip-path, opacity;
}

.title-copy.blackhat .hat-word {
  color: #ff2f63;
  background-color: #ff003c;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='96' viewBox='0 0 80 96'%3E%3Ctext x='0' y='12' fill='%23ff003c' font-family='monospace' font-size='12'%3E01010110%3C/text%3E%3Ctext x='0' y='28' fill='%23ff003c' font-family='monospace' font-size='12'%3E10110001%3C/text%3E%3Ctext x='0' y='44' fill='%23ff003c' font-family='monospace' font-size='12'%3E00101101%3C/text%3E%3Ctext x='0' y='60' fill='%23ff003c' font-family='monospace' font-size='12'%3E11001010%3C/text%3E%3Ctext x='0' y='76' fill='%23ff003c' font-family='monospace' font-size='12'%3E01110100%3C/text%3E%3Ctext x='0' y='92' fill='%23ff003c' font-family='monospace' font-size='12'%3E10010111%3C/text%3E%3C/svg%3E");
  background-position: 0 0;
  background-size: 4.5rem 5.5rem;
  -webkit-background-clip: text;
  background-clip: text;
  animation: black-binary-rain 1.1s linear infinite;
}

.top-row,
.node-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}

.top-row {
  align-items: stretch;
  gap: 0.75rem;
  height: 6.75rem;
  grid-auto-rows: 6.75rem;
}

.top-divider {
  position: relative;
  height: 1px;
  margin: 10px 0;
  background: #ffffff;
  box-shadow: 0 0 7px rgba(255, 255, 255, 0.56), 0 0 16px rgba(255, 255, 255, 0.22);
  animation: top-divider-pulse 1.8s ease-in-out infinite;
}

.node-layout {
  gap: 1rem;
}

.panel {
  min-height: 8rem;
  padding: 1rem;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid rgba(0, 245, 255, 0.18);
  box-shadow: 0 18px 45px rgba(0, 0, 0, 0.3), inset 0 0 28px rgba(0, 245, 255, 0.025);
  backdrop-filter: blur(14px);
}

.resizable-panel {
  resize: both;
  min-width: min(100%, 18rem);
  max-width: 100%;
  overflow: auto;
}

.top-row .resizable-panel {
  min-width: 0;
}

.top-row > .hero-panel,
.top-row > .panel {
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.top-row > .panel {
  padding: 0.45rem;
}

.top-row .panel-toggle {
  min-height: 1.25rem;
  padding: 0.18rem 0.42rem;
}

.top-row .panel-toggle span:first-child {
  font-size: clamp(0.66rem, 1.05vw, 0.86rem);
}

.top-row .panel-toggle span:last-child {
  font-size: 0.48rem;
}

.resource-panel,
.clock-panel {
  display: grid;
  align-content: start;
  grid-template-rows: auto auto;
}

.panel-heading {
  min-height: 0;
  padding: 0.21rem 0.51rem;
  display: flex;
  align-items: center;
  border: 1px solid rgba(255, 0, 110, 0.58);
  border-radius: 6px;
  color: #00f5ff;
  font-weight: 700;
  font-size: clamp(0.87rem, 1.42vw, 1.11rem);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  box-shadow: 0 0 10px rgba(255, 0, 110, 0.25);
  text-shadow: 0 0 10px rgba(0, 245, 255, 0.6);
}

.panel-toggle,
.primary-node-action,
.upgrade-button {
  background: transparent;
  border: 1px solid #ff006e;
  color: #ff006e;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  box-shadow: 0 0 10px rgba(255, 0, 110, 0.25);
  text-shadow: 0 0 8px rgba(255, 0, 110, 0.7);
}

.panel-toggle {
  width: 100%;
  min-height: 2.65rem;
  padding: 0.65rem 0.8rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  border-color: rgba(255, 0, 110, 0.58);
  border-radius: 6px;
  cursor: pointer;
}

.panel-toggle span:first-child {
  color: #00f5ff;
  font-weight: 700;
  text-shadow: 0 0 10px rgba(0, 245, 255, 0.6);
}

.panel-toggle span:last-child {
  color: #39ff14;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 0.72rem;
  text-shadow: 0 0 6px rgba(57, 255, 20, 0.4);
}

.resource-stack {
  display: grid;
  align-content: start;
  align-items: start;
  height: auto;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  grid-template-rows: auto;
  gap: 0.42rem;
  margin-top: 0.38rem;
}

.info-panel {
  background: rgba(0, 245, 255, 0.04);
  border: 1px solid rgba(0, 245, 255, 0.2);
  color: #39ff14;
  font-family: "SFMono-Regular", Consolas, monospace;
  text-shadow: 0 0 6px rgba(57, 255, 20, 0.4);
}

.resource-row {
  min-height: 3.68rem;
  padding: 0.36rem 0.51rem;
  display: grid;
  grid-template-columns: clamp(2.17rem, 3.3vw, 2.62rem) minmax(0, 1fr);
  grid-template-rows: auto auto auto;
  align-items: center;
  gap: 0.04rem 0.45rem;
  border-radius: 4px;
}

.resource-icon {
  grid-column: 1;
  grid-row: 1 / span 3;
  width: clamp(1.95rem, 3vw, 2.32rem);
  aspect-ratio: 1;
  display: grid;
  place-items: center;
  border: 1px solid rgba(255, 0, 110, 0.55);
  border-radius: 4px;
  color: #ff006e;
  font-family: "Material Symbols Rounded";
  font-size: clamp(1.35rem, 2.1vw, 1.65rem);
  font-weight: normal;
  letter-spacing: 0;
  line-height: 1;
  font-variation-settings: "FILL" 0, "wght" 600, "GRAD" 0, "opsz" 40;
  box-shadow: 0 0 12px rgba(255, 0, 110, 0.22);
  text-shadow: 0 0 8px rgba(255, 0, 110, 0.7);
}

.resource-label {
  grid-column: 2;
  grid-row: 1;
  color: #00f5ff;
  font-size: clamp(0.58rem, 0.94vw, 0.74rem);
  line-height: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.resource-row strong {
  grid-column: 2;
  grid-row: 2;
  color: #f0f7ff;
  font-size: clamp(0.86rem, 1.41vw, 1.11rem);
  line-height: 1;
  white-space: nowrap;
}

.resource-row em {
  grid-column: 2;
  grid-row: 3;
  min-width: 0;
  color: #39ff14;
  font-size: clamp(0.69rem, 1.02vw, 0.87rem);
  line-height: 1;
  font-style: normal;
  text-align: left;
  white-space: nowrap;
}

.clock-face {
  min-height: 0;
  height: 100%;
  margin-top: 0.25rem;
  padding: 0.2rem 0.1rem 0;
  border-radius: 4px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 0.16rem;
  min-width: 0;
  text-align: center;
}

.clock-readout {
  display: grid;
  grid-template-columns: auto auto auto auto auto auto auto;
  align-items: start;
  justify-content: center;
  gap: 0.1rem;
  width: 100%;
  min-width: 0;
  font-variant-numeric: tabular-nums;
}

.clock-segment {
  display: grid;
  justify-items: center;
  gap: 0.08rem;
  min-width: 0;
}

.clock-segment strong,
.clock-separator {
  color: #39ff14;
  font-size: clamp(1.3rem, 2.75vw, 2.5rem);
  line-height: 1;
  letter-spacing: 0;
  white-space: nowrap;
}

.clock-segment small {
  color: rgba(0, 245, 255, 0.85);
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 0.5rem;
  line-height: 1;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  text-shadow: 0 0 5px rgba(0, 245, 255, 0.4);
}

.clock-separator {
  padding-top: 0.1rem;
}

.nodes-panel {
  min-height: 13rem;
}

.node-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
  gap: 0.9rem;
  margin-top: 0.9rem;
}

.node-card {
  position: relative;
  min-height: 15rem;
  padding: 1rem;
  display: grid;
  grid-template-rows: minmax(1.7rem, auto) minmax(5rem, 1fr) minmax(4.25rem, auto);
  gap: 0.75rem;
  background: rgba(10, 10, 15, 0.86);
  border: 1px solid rgba(0, 245, 255, 0.24);
  border-radius: 8px;
  box-shadow: inset 0 0 28px rgba(0, 245, 255, 0.035), 0 14px 28px rgba(0, 0, 0, 0.24);
  transition: transform 180ms ease, border-color 180ms ease, box-shadow 180ms ease;
}

.node-card:hover {
  transform: translateY(-2px);
  border-color: rgba(0, 245, 255, 0.6);
  box-shadow: inset 0 0 28px rgba(0, 245, 255, 0.055), 0 0 24px rgba(0, 245, 255, 0.12);
}

.level-badge {
  position: absolute;
  top: 0.55rem;
  left: 0.55rem;
  color: #39ff14;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 0.76rem;
  text-shadow: 0 0 6px rgba(57, 255, 20, 0.4);
}

.node-title {
  padding-left: 2.1rem;
  color: #00f5ff;
  font-size: 0.94rem;
  font-weight: 700;
  text-shadow: 0 0 10px rgba(0, 245, 255, 0.6);
}

.primary-node-action {
  width: 100%;
  min-height: 5rem;
  align-self: stretch;
  border-radius: 8px;
  font-size: clamp(1.15rem, 4vw, 1.85rem);
  font-weight: 800;
  cursor: pointer;
  transition: transform 140ms ease, color 140ms ease, border-color 140ms ease, box-shadow 140ms ease;
}

.primary-node-action:hover:not(:disabled),
.upgrade-button:hover:not(:disabled),
.panel-toggle:hover {
  color: #ffffff;
  border-color: #ff5aa2;
  box-shadow: 0 0 18px rgba(255, 0, 110, 0.42);
}

.primary-node-action:active:not(:disabled) {
  transform: scale(0.98);
}

.primary-node-action:disabled,
.upgrade-button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.node-footer {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(7.75rem, 0.72fr);
  gap: 0.75rem;
  align-items: stretch;
}

.node-stat {
  min-height: 4rem;
  padding: 0.75rem;
  display: grid;
  place-items: center;
  border-right: 1px solid rgba(0, 245, 255, 0.45);
  color: #39ff14;
  font-family: "SFMono-Regular", Consolas, monospace;
  text-align: center;
  text-shadow: 0 0 6px rgba(57, 255, 20, 0.4);
}

.upgrade-button {
  min-height: 4rem;
  padding: 0.55rem;
  display: grid;
  place-items: center;
  border-radius: 6px;
  font-size: 0.72rem;
  cursor: pointer;
}

.upgrade-button small {
  max-width: 100%;
  overflow-wrap: anywhere;
  color: #39ff14;
  font-size: 0.66rem;
  text-transform: none;
  text-shadow: 0 0 6px rgba(57, 255, 20, 0.4);
}

.placeholder-node {
  min-height: 8rem;
  margin-top: 0.9rem;
  padding: 1rem;
  display: grid;
  place-items: center;
  gap: 0.45rem;
  border-radius: 6px;
  text-align: center;
}

.placeholder-node strong {
  color: #00f5ff;
}

.placeholder-node span {
  color: #39ff14;
}

.debug-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  padding: min(4vw, 2rem);
  display: grid;
  place-items: center;
  background: rgba(5, 5, 10, 0.72);
  backdrop-filter: blur(10px);
}

.debug-menu {
  width: min(58rem, 100%);
  max-height: min(44rem, 90vh);
  padding: 1rem;
  overflow: auto;
  border: 1px solid rgba(0, 245, 255, 0.34);
  border-radius: 8px;
  background: rgba(10, 10, 15, 0.96);
  box-shadow: 0 0 28px rgba(0, 245, 255, 0.16), 0 18px 60px rgba(0, 0, 0, 0.55);
}

.debug-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}

.debug-header div,
.debug-section h2 {
  display: grid;
  gap: 0.2rem;
  color: #00f5ff;
  font-size: 0.95rem;
  text-transform: uppercase;
  text-shadow: 0 0 10px rgba(0, 245, 255, 0.6);
}

.debug-header strong {
  color: #39ff14;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 0.72rem;
  text-shadow: 0 0 6px rgba(57, 255, 20, 0.4);
}

.debug-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  gap: 0.9rem;
}

.debug-section {
  padding: 0.8rem;
  border: 1px solid rgba(0, 245, 255, 0.18);
  border-radius: 6px;
  background: rgba(0, 245, 255, 0.035);
}

.debug-section label {
  display: grid;
  gap: 0.35rem;
  margin-top: 0.65rem;
  color: #39ff14;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 0.78rem;
}

.debug-section input,
.debug-section select {
  min-height: 2.4rem;
  padding: 0.5rem;
  border: 1px solid rgba(0, 245, 255, 0.24);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.03);
  color: #00f5ff;
}

.debug-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.debug-actions.stacked {
  grid-template-columns: 1fr;
}

.debug-header button,
.debug-actions button {
  min-height: 2.4rem;
  border-radius: 6px;
  cursor: pointer;
}

.debug-header button:disabled,
.debug-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.debug-status {
  margin: 0.75rem 0 0;
  color: #39ff14;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 0.78rem;
}

.debug-log-section {
  grid-column: 1 / -1;
}

.debug-log {
  max-height: 14rem;
  margin: 0.75rem 0 0;
  padding-left: 1.25rem;
  overflow: auto;
  color: #39ff14;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 0.78rem;
  text-shadow: 0 0 6px rgba(57, 255, 20, 0.32);
}

.debug-log li + li {
  margin-top: 0.35rem;
}

.panel-reveal-enter-active,
.panel-reveal-leave-active {
  transition: opacity 180ms ease, transform 180ms ease, max-height 220ms ease;
  max-height: 48rem;
  overflow: hidden;
}

.panel-reveal-enter-from,
.panel-reveal-leave-to {
  opacity: 0;
  transform: translateY(-0.35rem);
  max-height: 0;
}

@keyframes title-glitch-cyan {
  0% {
    opacity: 0.45;
    transform: translate3d(1px, 0, 0);
    clip-path: inset(0 0 54% 0);
  }

  16% {
    opacity: 0.7;
    transform: translate3d(2px, -0.5px, 0);
    clip-path: inset(10% 0 64% 0);
  }

  32% {
    opacity: 0.48;
    transform: translate3d(-1px, 0.5px, 0);
    clip-path: inset(62% 0 12% 0);
  }

  48% {
    opacity: 0.75;
    transform: translate3d(3px, 0, 0);
    clip-path: inset(28% 0 42% 0);
  }

  64% {
    opacity: 0.42;
    transform: translate3d(-2px, -0.5px, 0);
    clip-path: inset(74% 0 4% 0);
  }

  80% {
    opacity: 0.68;
    transform: translate3d(1.5px, 0.5px, 0);
    clip-path: inset(4% 0 72% 0);
  }

  100% {
    opacity: 0.45;
    transform: translate3d(1px, 0, 0);
    clip-path: inset(0 0 54% 0);
  }
}

@keyframes title-glitch-magenta {
  0% {
    opacity: 0.55;
    transform: translate3d(-1px, 0, 0);
    clip-path: inset(48% 0 0 0);
  }

  14% {
    opacity: 0.74;
    transform: translate3d(-2px, 0.5px, 0);
    clip-path: inset(16% 0 58% 0);
  }

  30% {
    opacity: 0.44;
    transform: translate3d(1px, -0.5px, 0);
    clip-path: inset(70% 0 8% 0);
  }

  46% {
    opacity: 0.7;
    transform: translate3d(-3px, 0, 0);
    clip-path: inset(34% 0 36% 0);
  }

  62% {
    opacity: 0.5;
    transform: translate3d(2px, 0.5px, 0);
    clip-path: inset(6% 0 76% 0);
  }

  78% {
    opacity: 0.76;
    transform: translate3d(-1.5px, -0.5px, 0);
    clip-path: inset(58% 0 18% 0);
  }

  100% {
    opacity: 0.55;
    transform: translate3d(-1px, 0, 0);
    clip-path: inset(48% 0 0 0);
  }
}

@keyframes white-title-shine {
  0%,
  100% {
    filter: brightness(1);
  }

  50% {
    filter: brightness(1.35);
  }
}

@keyframes black-binary-rain {
  from {
    background-position: 0 -5.5rem;
  }

  to {
    background-position: 0 0;
  }
}

@keyframes top-divider-pulse {
  0%,
  100% {
    box-shadow: 0 0 5px rgba(255, 255, 255, 0.45), 0 0 10px rgba(255, 255, 255, 0.16);
  }

  50% {
    box-shadow: 0 0 11px rgba(255, 255, 255, 0.9), 0 0 28px rgba(255, 255, 255, 0.42);
  }
}

@media (prefers-reduced-motion: reduce) {
  .title-copy,
  .title-copy.greyhat .hat-word::before,
  .title-copy.greyhat .hat-word::after,
  .title-copy.blackhat .hat-word,
  .top-divider {
    animation: none;
  }
}

@media (min-width: 860px) {
  .top-row {
    grid-template-columns: minmax(0, 1.55fr) minmax(0, 4.9fr) minmax(0, 1.55fr);
  }

  .node-layout {
    grid-template-columns: minmax(28rem, 1fr) minmax(18rem, 0.48fr) minmax(18rem, 0.48fr);
    align-items: start;
  }
}

@media (max-width: 620px) {
  .hero-panel {
    align-items: flex-start;
  }

  .signal-strip {
    grid-template-columns: repeat(3, 0.38rem);
  }

  .resource-row,
  .node-footer {
    grid-template-columns: 1fr;
  }

  .resource-row em {
    text-align: left;
  }

  .node-stat {
    border-right: 0;
    border-bottom: 1px solid rgba(0, 245, 255, 0.45);
  }
}
</style>
