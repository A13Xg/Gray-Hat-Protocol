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
  startTimedNode,
  tick,
  togglePassiveNode,
  upgradeNode,
} from './core/engine'
import { NODE_DEFINITIONS, getScaledInput, getScaledOutput } from './core/nodes'
import { clearSave, exportSave, forceClearBrowserState, importSave, loadGame, saveGame } from './core/persistence'
import { getReputationAlignment } from './core/resources'
import { calculateDeltaMs, nowMs } from './core/time'
import { formatDuration, formatResource } from './utils/formatter'
import blackHatImage from './assets/images/BlackHat.png'
import greyHatImage from './assets/images/GreyHat.png'
import whiteHatImage from './assets/images/WhiteHat.png'
import type { ReputationAlignment, ResourceKey } from './core/types'

type RateMap = Record<ResourceKey, number>
type CollapsiblePanel = 'resources' | 'clock' | 'clickers' | 'operations' | 'systems'
type ResizablePanelKey = 'clickers' | 'operations' | 'systems'

interface Toast {
  id: number
  message: string
  type: 'success' | 'error' | 'info'
}

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
const panelLocks = reactive<Record<ResizablePanelKey, boolean>>({
  clickers: true,
  operations: true,
  systems: true,
})
const lockedPanelSizes = reactive<Record<ResizablePanelKey, { width: string | null; height: string | null }>>({
  clickers: { width: null, height: null },
  operations: { width: null, height: null },
  systems: { width: null, height: null },
})
const panelElements: Record<ResizablePanelKey, HTMLElement | null> = {
  clickers: null,
  operations: null,
  systems: null,
}
const visibleTimeMs = ref(state.value.time.totalActiveMs)
const isDebugMenuOpen = ref(false)
const isControlMenuOpen = ref(false)
const isAdminMenuOpen = ref(false)
const isAdminUnlocked = ref(false)
const adminCodeEntry = ref('')
const adminStatusMessage = ref('')
const adminMoneyValue = ref('0')
const adminCryptoValue = ref('0')
const adminComputeValue = ref('0')
const adminReputationValue = ref('0')
const isForceClearing = ref(false)
const debugStatusMessage = ref('')
const debugResourceKey = ref<ResourceKey>('money')
const debugResourceAmount = ref('100')
const importSaveText = ref('')
const importStatusMessage = ref('')
const toasts = ref<Toast[]>([])
let toastCounter = 0
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
let saveIntervalId: number | undefined
let frameId: number | undefined
let wakeLock: WakeLockSentinel | null = null
let previousRateSampleAt = nowMs()
let previousFrameAt = nowMs()
const layoutStorageKey = 'gray-hat-protocol-layout-v1'

const clickerNodes = computed(() => {
  return NODE_DEFINITIONS.filter((node) => {
    if (node.nodeType !== 'clicker') {
      return false
    }

    return Boolean(state.value.nodes[node.nodeID]?.revealed)
  })
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

const timedTaskNodes = computed(() => {
  return NODE_DEFINITIONS.filter((node) => {
    if (node.nodeType !== 'timed-task') {
      return false
    }

    return Boolean(state.value.nodes[node.nodeID]?.revealed)
  })
})

const passiveNodes = computed(() => {
  return NODE_DEFINITIONS.filter((node) => {
    if (node.nodeType !== 'passive') {
      return false
    }

    return Boolean(state.value.nodes[node.nodeID]?.revealed)
  })
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

  const previousLog = state.value.log
  let nextState = tick(state.value, deltaMs)
  const newEntries = nextState.log.slice(previousLog.length)

  for (const entry of newEntries) {
    if (entry.includes('completed')) {
      showToast(entry, 'success')
    }
  }

  // Auto-run: restart timed tasks that have auto-run enabled and just completed
  for (const [nodeIDStr, runtimeState] of Object.entries(nextState.nodes)) {
    const nodeID = Number(nodeIDStr)
    if (runtimeState.autoRun && runtimeState.unlocked && !runtimeState.isRunning) {
      nextState = startTimedNode(nextState, nodeID)
    }
  }

  state.value = nextState
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

function triggerTimedNode(nodeID: number): void {
  state.value = startTimedNode(state.value, nodeID)
}

function togglePassive(nodeID: number, enabled: boolean): void {
  state.value = togglePassiveNode(state.value, nodeID, enabled)
}

function toggleAutoRun(nodeID: number): void {
  const runtimeState = state.value.nodes[nodeID]
  if (!runtimeState) {
    return
  }

  state.value = {
    ...state.value,
    nodes: {
      ...state.value.nodes,
      [nodeID]: {
        ...runtimeState,
        autoRun: !runtimeState.autoRun,
      },
    },
  }
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

function setPanelElement(panel: ResizablePanelKey, element: unknown): void {
  panelElements[panel] = element instanceof HTMLElement ? element : null
}

function saveLayoutPreferences(): void {
  try {
    localStorage.setItem(
      layoutStorageKey,
      JSON.stringify({
        panelLocks: { ...panelLocks },
        lockedPanelSizes: { ...lockedPanelSizes },
      }),
    )
  } catch {
    // Ignore local storage errors.
  }
}

function loadLayoutPreferences(): void {
  try {
    const raw = localStorage.getItem(layoutStorageKey)
    if (!raw) {
      return
    }

    const parsed = JSON.parse(raw) as {
      panelLocks?: Partial<Record<ResizablePanelKey, boolean>>
      lockedPanelSizes?: Partial<Record<ResizablePanelKey, { width?: string; height?: string }>>
    }

    for (const key of ['clickers', 'operations', 'systems'] as const) {
      panelLocks[key] = parsed.panelLocks?.[key] ?? true
      lockedPanelSizes[key].width = parsed.lockedPanelSizes?.[key]?.width ?? null
      lockedPanelSizes[key].height = parsed.lockedPanelSizes?.[key]?.height ?? null
    }
  } catch {
    // Ignore malformed layout payloads.
  }
}

function panelInlineStyle(panel: ResizablePanelKey): Record<string, string> {
  if (!panelLocks[panel] || !activePanels[panel]) {
    return {}
  }

  const width = lockedPanelSizes[panel].width
  const height = lockedPanelSizes[panel].height
  if (!width || !height) {
    return {}
  }

  return { width, height }
}

function togglePanelLock(panel: ResizablePanelKey): void {
  if (panelLocks[panel]) {
    panelLocks[panel] = false
    return
  }

  const element = panelElements[panel]
  if (element) {
    const rect = element.getBoundingClientRect()
    lockedPanelSizes[panel].width = `${Math.round(rect.width)}px`
    lockedPanelSizes[panel].height = `${Math.round(rect.height)}px`
  }

  panelLocks[panel] = true
  saveLayoutPreferences()
}

function formatWholeDecimal(value: Decimal): string {
  return formatResource(value)
}

function formatSignedWhole(value: Decimal): string {
  const formatted = formatResource(value)
  return value.gte(0) ? `+${formatted}` : formatted
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

function inputSummary(nodeID: number): string {
  const definition = NODE_DEFINITIONS.find((node) => node.nodeID === nodeID)
  const runtimeState = state.value.nodes[nodeID]
  if (!definition || !runtimeState) {
    return ''
  }

  const entries = Object.entries(getScaledInput(definition, runtimeState))
  if (entries.length === 0) {
    return 'Free'
  }

  return entries.map(([key, value]) => `${formatWholeDecimal(value)} ${key}`).join(' / ')
}

function nodeProgress(nodeID: number): number {
  const runtimeState = state.value.nodes[nodeID]
  const definition = NODE_DEFINITIONS.find((node) => node.nodeID === nodeID)
  if (!runtimeState || !definition?.durationMs || !runtimeState.isRunning) {
    return 0
  }

  return Math.min(100, (runtimeState.progressMs / definition.durationMs) * 100)
}

function nodeTimeRemaining(nodeID: number): string {
  const runtimeState = state.value.nodes[nodeID]
  const definition = NODE_DEFINITIONS.find((node) => node.nodeID === nodeID)
  if (!runtimeState || !definition?.durationMs || !runtimeState.isRunning) {
    return ''
  }

  return formatDuration(definition.durationMs - runtimeState.progressMs)
}

function showToast(message: string, type: Toast['type'] = 'info'): void {
  const id = ++toastCounter
  toasts.value.push({ id, message, type })
  window.setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }, 3500)
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

  if (event.key === 'Escape' && isControlMenuOpen.value) {
    isControlMenuOpen.value = false
    isAdminMenuOpen.value = false
  }
}

async function requestWakeLockIfEnabled(): Promise<void> {
  if (!state.value.preferences.preventSleep || typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
    return
  }

  try {
    wakeLock = await navigator.wakeLock.request('screen')
    wakeLock.addEventListener('release', () => {
      wakeLock = null
    })
  } catch {
    state.value.preferences.preventSleep = false
  }
}

async function releaseWakeLock(): Promise<void> {
  if (!wakeLock) {
    return
  }

  try {
    await wakeLock.release()
  } finally {
    wakeLock = null
  }
}

function toggleControlMenu(): void {
  isControlMenuOpen.value = !isControlMenuOpen.value
  if (!isControlMenuOpen.value) {
    isAdminMenuOpen.value = false
  }
}

async function togglePreventSleep(): Promise<void> {
  state.value.preferences.preventSleep = !state.value.preferences.preventSleep
  if (state.value.preferences.preventSleep) {
    await requestWakeLockIfEnabled()
  } else {
    await releaseWakeLock()
  }
}

function toggleSounds(): void {
  state.value.preferences.soundsEnabled = !state.value.preferences.soundsEnabled
}

function openAdminMenu(): void {
  isAdminMenuOpen.value = true
}

function submitAdminCode(): void {
  if (adminCodeEntry.value === state.value.preferences.adminAccessCode) {
    isAdminUnlocked.value = true
    adminMoneyValue.value = state.value.resources.money.toString()
    adminCryptoValue.value = state.value.resources.crypto.toString()
    adminComputeValue.value = state.value.resources.compute.toString()
    adminReputationValue.value = state.value.resources.reputation.toString()
    adminStatusMessage.value = 'Admin unlocked.'
  } else {
    adminStatusMessage.value = 'Incorrect code.'
    isAdminUnlocked.value = false
  }
}

function updateAdminAccessCode(newCode: string): void {
  if (!newCode.trim()) {
    adminStatusMessage.value = 'Access code cannot be empty.'
    return
  }

  state.value.preferences.adminAccessCode = newCode
  adminStatusMessage.value = 'Access code updated.'
}

function applyAdminResourceValues(): void {
  try {
    state.value = replaceResources(state.value, {
      money: new Decimal(adminMoneyValue.value),
      crypto: new Decimal(adminCryptoValue.value),
      compute: new Decimal(adminComputeValue.value),
      reputation: new Decimal(adminReputationValue.value),
    })
    adminStatusMessage.value = 'Resource values updated.'
  } catch {
    adminStatusMessage.value = 'Enter valid numeric resource values.'
  }
}

function persistStateNow(): void {
  state.value = saveGame(state.value)
}

function handleExportSave(): void {
  const data = exportSave(state.value)
  try {
    navigator.clipboard.writeText(data).then(() => {
      showToast('Save data copied to clipboard!', 'success')
    }).catch(() => {
      showToast('Export failed — copy from debug console.', 'error')
      console.info('SAVE DATA:', data)
    })
  } catch {
    showToast('Export failed — copy from debug console.', 'error')
    console.info('SAVE DATA:', data)
  }
}

function handleImportSave(): void {
  const raw = importSaveText.value.trim()
  if (!raw) {
    importStatusMessage.value = 'Paste your save data first.'
    return
  }

  const imported = importSave(raw)
  state.value = imported
  syncPreviousResourcesFromState()
  importStatusMessage.value = 'Save imported successfully!'
  importSaveText.value = ''
}

function handleBeforeUnload(): void {
  persistStateNow()
}

function handlePageHide(): void {
  persistStateNow()
}

function handleVisibilityChange(): void {
  if (document.visibilityState === 'hidden') {
    persistStateNow()
    return
  }

  if (document.visibilityState === 'visible') {
    void requestWakeLockIfEnabled()
  }
}

onMounted(() => {
  loadLayoutPreferences()
  tickIntervalId = window.setInterval(stepGame, GAME_CONFIG.tickRateMs)
  saveIntervalId = window.setInterval(() => {
    persistStateNow()
  }, 2000)
  frameId = window.setTimeout(animateFrame, 100)
  window.addEventListener('keydown', handleGlobalKeydown)
  window.addEventListener('beforeunload', handleBeforeUnload)
  window.addEventListener('pagehide', handlePageHide)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  void requestWakeLockIfEnabled()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleGlobalKeydown)
  window.removeEventListener('beforeunload', handleBeforeUnload)
  window.removeEventListener('pagehide', handlePageHide)
  document.removeEventListener('visibilitychange', handleVisibilityChange)

  if (tickIntervalId !== undefined) {
    window.clearInterval(tickIntervalId)
  }

  if (saveIntervalId !== undefined) {
    window.clearInterval(saveIntervalId)
  }

  if (frameId !== undefined) {
    window.clearTimeout(frameId)
  }

  void releaseWakeLock()
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
        <div class="panel-heading panel-heading-with-menu">
          <span>Elapsed Time</span>
          <button class="title-menu-button" type="button" aria-label="Open control menu" @click="toggleControlMenu">
            ≡
          </button>
        </div>
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
      <article
        class="panel nodes-panel resizable-panel"
        :class="{ 'is-collapsed': !activePanels.clickers, 'is-unlocked': !panelLocks.clickers }"
        :style="panelInlineStyle('clickers')"
        :ref="(element) => setPanelElement('clickers', element)"
      >
        <button class="panel-toggle" type="button" @click="togglePanel('clickers')">
          <span>Keystrokes</span>
          <span class="panel-toggle-right">
            <span
              class="panel-lock-button"
              role="button"
              tabindex="0"
              :aria-label="panelLocks.clickers ? 'Unlock resizing for keystrokes panel' : 'Lock keystrokes panel size'"
              @click.stop="togglePanelLock('clickers')"
              @keydown.enter.prevent="togglePanelLock('clickers')"
              @keydown.space.prevent="togglePanelLock('clickers')"
            >
              {{ panelLocks.clickers ? 'lock' : 'lock_open' }}
            </span>
            <span>{{ activePanels.clickers ? 'Collapse' : 'Expand' }}</span>
          </span>
        </button>
        <Transition name="panel-reveal">
          <!-- clickersSection: first active node subsection for manual clicker actions. -->
          <div v-if="activePanels.clickers" class="node-grid">
            <TransitionGroup name="clicker-entry">
              <article
                v-for="node in clickerNodes"
                :key="node.nodeID"
                class="node-card"
                :class="{ 'is-node-locked': !state.nodes[node.nodeID].unlocked }"
              >
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
            </TransitionGroup>
          </div>
        </Transition>
      </article>

      <article
        class="panel nodes-panel resizable-panel"
        :class="{ 'is-collapsed': !activePanels.operations, 'is-unlocked': !panelLocks.operations }"
        :style="panelInlineStyle('operations')"
        :ref="(element) => setPanelElement('operations', element)"
      >
        <button class="panel-toggle" type="button" @click="togglePanel('operations')">
          <span>Operations</span>
          <span class="panel-toggle-right">
            <span
              class="panel-lock-button"
              role="button"
              tabindex="0"
              :aria-label="panelLocks.operations ? 'Unlock resizing for operations panel' : 'Lock operations panel size'"
              @click.stop="togglePanelLock('operations')"
              @keydown.enter.prevent="togglePanelLock('operations')"
              @keydown.space.prevent="togglePanelLock('operations')"
            >
              {{ panelLocks.operations ? 'lock' : 'lock_open' }}
            </span>
            <span>{{ activePanels.operations ? 'Collapse' : 'Expand' }}</span>
          </span>
        </button>
        <Transition name="panel-reveal">
          <div v-if="activePanels.operations" class="node-grid">
            <TransitionGroup name="clicker-entry">
              <article
                v-for="node in timedTaskNodes"
                :key="node.nodeID"
                class="node-card timed-node-card"
                :class="{ 'is-node-locked': !state.nodes[node.nodeID].unlocked }"
              >
                <span class="level-badge">L{{ displayNodeLevel(node.nodeID) }}</span>
                <div class="node-title">{{ node.nodeName }}</div>
                <div class="timed-node-body">
                  <div class="timed-progress-wrap">
                    <div
                      class="timed-progress-bar"
                      :class="{ 'is-running': state.nodes[node.nodeID].isRunning }"
                      :style="{ width: `${nodeProgress(node.nodeID)}%` }"
                    ></div>
                    <span v-if="state.nodes[node.nodeID].isRunning" class="timed-progress-label">
                      {{ nodeTimeRemaining(node.nodeID) }}
                    </span>
                    <span v-else class="timed-progress-label idle-label">
                      {{ formatDuration(node.durationMs ?? 0) }}
                    </span>
                  </div>
                  <div class="timed-io-row">
                    <span class="timed-io-label">Cost</span>
                    <span class="timed-io-value cost-value">{{ inputSummary(node.nodeID) }}</span>
                  </div>
                  <div class="timed-io-row">
                    <span class="timed-io-label">Reward</span>
                    <span class="timed-io-value">{{ outputSummary(node.nodeID) }}</span>
                  </div>
                </div>
                <div class="node-footer timed-footer">
                  <button
                    class="primary-node-action"
                    type="button"
                    :disabled="!state.nodes[node.nodeID].unlocked || state.nodes[node.nodeID].isRunning"
                    @click="triggerTimedNode(node.nodeID)"
                  >
                    {{ state.nodes[node.nodeID].isRunning ? 'Running…' : 'Start' }}
                  </button>
                  <button
                    class="auto-run-button"
                    type="button"
                    :class="{ 'is-active': state.nodes[node.nodeID].autoRun }"
                    :disabled="!state.nodes[node.nodeID].unlocked"
                    :aria-label="`${state.nodes[node.nodeID].autoRun ? 'Disable' : 'Enable'} auto-run for ${node.nodeName}`"
                    @click="toggleAutoRun(node.nodeID)"
                  >
                    Auto
                  </button>
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
                <div class="completions-badge" v-if="state.nodes[node.nodeID].completions > 0">
                  ✓ {{ state.nodes[node.nodeID].completions }}
                </div>
              </article>
            </TransitionGroup>
            <div v-if="timedTaskNodes.length === 0" class="placeholder-node info-panel">
              <strong>No Operations Unlocked</strong>
              <span>Build reputation to unlock timed operations.</span>
            </div>
          </div>
        </Transition>
      </article>

      <article
        class="panel nodes-panel resizable-panel"
        :class="{ 'is-collapsed': !activePanels.systems, 'is-unlocked': !panelLocks.systems }"
        :style="panelInlineStyle('systems')"
        :ref="(element) => setPanelElement('systems', element)"
      >
        <button class="panel-toggle" type="button" @click="togglePanel('systems')">
          <span>Systems</span>
          <span class="panel-toggle-right">
            <span
              class="panel-lock-button"
              role="button"
              tabindex="0"
              :aria-label="panelLocks.systems ? 'Unlock resizing for systems panel' : 'Lock systems panel size'"
              @click.stop="togglePanelLock('systems')"
              @keydown.enter.prevent="togglePanelLock('systems')"
              @keydown.space.prevent="togglePanelLock('systems')"
            >
              {{ panelLocks.systems ? 'lock' : 'lock_open' }}
            </span>
            <span>{{ activePanels.systems ? 'Collapse' : 'Expand' }}</span>
          </span>
        </button>
        <Transition name="panel-reveal">
          <div v-if="activePanels.systems" class="node-grid">
            <TransitionGroup name="clicker-entry">
              <article
                v-for="node in passiveNodes"
                :key="node.nodeID"
                class="node-card passive-node-card"
                :class="{ 'is-node-locked': !state.nodes[node.nodeID].unlocked, 'is-enabled': state.nodes[node.nodeID].enabled }"
              >
                <span class="level-badge">L{{ displayNodeLevel(node.nodeID) }}</span>
                <div class="node-title">{{ node.nodeName }}</div>
                <div class="passive-io-col">
                  <div class="timed-io-row" v-if="Object.keys(getScaledInput(node, state.nodes[node.nodeID])).length > 0">
                    <span class="timed-io-label">Cost</span>
                    <span class="timed-io-value cost-value">{{ inputSummary(node.nodeID) }}/s</span>
                  </div>
                  <div class="timed-io-row">
                    <span class="timed-io-label">Gain</span>
                    <span class="timed-io-value">{{ outputSummary(node.nodeID) }}/s</span>
                  </div>
                </div>
                <div class="node-footer">
                  <button
                    class="primary-node-action toggle-passive-button"
                    type="button"
                    :class="{ 'is-enabled': state.nodes[node.nodeID].enabled }"
                    :disabled="!state.nodes[node.nodeID].unlocked"
                    @click="togglePassive(node.nodeID, !state.nodes[node.nodeID].enabled)"
                  >
                    {{ state.nodes[node.nodeID].enabled ? 'Disable' : 'Enable' }}
                  </button>
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
            </TransitionGroup>
            <div v-if="passiveNodes.length === 0" class="placeholder-node info-panel">
              <strong>No Systems Online</strong>
              <span>Hack or harden to unlock passive income.</span>
            </div>
          </div>
        </Transition>
      </article>
    </section>

    <Teleport to="body">
      <Transition name="slide-menu">
        <aside v-if="isControlMenuOpen" class="control-menu-root" role="dialog" aria-label="Control menu">
          <header class="control-menu-header">
            <strong>Control Menu</strong>
            <button type="button" class="control-close-button" aria-label="Close control menu" @click="isControlMenuOpen = false">
              X
            </button>
          </header>
          <div class="control-menu-body">
            <button type="button" class="control-toggle" @click="toggleSounds">
              <span>Sounds</span>
              <span>{{ state.preferences.soundsEnabled ? 'Enabled' : 'Disabled' }}</span>
            </button>
            <button type="button" class="control-toggle" @click="togglePreventSleep">
              <span>Prevent Sleep</span>
              <span>{{ state.preferences.preventSleep ? 'Enabled' : 'Disabled' }}</span>
            </button>
            <div class="save-io-section">
              <button type="button" class="control-toggle" @click="handleExportSave">
                <span>Export Save</span>
                <span>Copy to Clipboard</span>
              </button>
              <div class="import-row">
                <textarea
                  v-model="importSaveText"
                  class="import-textarea"
                  placeholder="Paste save data here…"
                  rows="3"
                  aria-label="Paste save data to import"
                ></textarea>
                <button type="button" class="control-toggle import-btn" @click="handleImportSave">
                  <span>Import Save</span>
                </button>
              </div>
              <p v-if="importStatusMessage" class="import-status">{{ importStatusMessage }}</p>
            </div>
            <button type="button" class="admin-entry-button" aria-label="Open admin menu" @click="openAdminMenu">⚙</button>
          </div>

          <Transition name="slide-menu">
            <section v-if="isAdminMenuOpen" class="admin-menu" aria-label="Admin menu">
              <h3>Admin</h3>
              <div v-if="!isAdminUnlocked" class="admin-code-form">
                <label>
                  Access Code
                  <input v-model="adminCodeEntry" type="password" inputmode="numeric" placeholder="1234" />
                </label>
                <button type="button" @click="submitAdminCode">Unlock</button>
              </div>
              <div v-else class="admin-code-form">
                <label>
                  Set Access Code
                  <input
                    :value="state.preferences.adminAccessCode"
                    type="text"
                    @change="updateAdminAccessCode(($event.target as HTMLInputElement).value)"
                  />
                </label>
                <div class="admin-resource-grid">
                  <label>
                    Money
                    <input v-model="adminMoneyValue" type="text" />
                  </label>
                  <label>
                    Crypto
                    <input v-model="adminCryptoValue" type="text" />
                  </label>
                  <label>
                    Compute
                    <input v-model="adminComputeValue" type="text" />
                  </label>
                  <label>
                    Reputation
                    <input v-model="adminReputationValue" type="text" />
                  </label>
                </div>
                <button type="button" @click="applyAdminResourceValues">Apply Resource Values</button>
              </div>
              <p v-if="adminStatusMessage" class="admin-status">{{ adminStatusMessage }}</p>
            </section>
          </Transition>
        </aside>
      </Transition>
    </Teleport>

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
    <Teleport to="body">
      <TransitionGroup name="toast" tag="div" class="toast-container" aria-live="polite">
        <div
          v-for="toast in toasts"
          :key="toast.id"
          class="toast"
          :class="`toast-${toast.type}`"
        >
          {{ toast.message }}
        </div>
      </TransitionGroup>
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
  resize: none;
  min-width: min(100%, 18rem);
  max-width: 100%;
  overflow: auto;
}

.resizable-panel.is-unlocked {
  resize: both;
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

.panel-heading-with-menu {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.title-menu-button {
  margin-left: auto;
  min-width: 1.5rem;
  min-height: 1.5rem;
  border: 1px solid rgba(0, 245, 255, 0.55);
  border-radius: 4px;
  background: rgba(0, 245, 255, 0.06);
  color: #00f5ff;
  font-size: 0.9rem;
  line-height: 1;
  cursor: pointer;
}

.control-menu-root {
  position: fixed;
  top: 50%;
  left: 50%;
  right: auto;
  z-index: 120;
  width: min(34rem, calc(100vw - 2rem));
  max-width: calc(100vw - 2rem);
  max-height: calc(100vh - 2rem);
  padding: 0.7rem;
  display: grid;
  grid-template-rows: auto 1fr;
  border: 1px solid rgba(0, 245, 255, 0.3);
  border-radius: 6px;
  background: rgba(10, 10, 15, 1);
  box-shadow: 0 0 18px rgba(0, 245, 255, 0.18);
  overflow-y: auto;
  overflow-x: hidden;
  transform: translate(-50%, -50%);
  transform-origin: center;
}

.control-menu-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.control-menu-header strong {
  color: #00f5ff;
  font-size: 0.8rem;
  text-transform: uppercase;
}

.control-menu-header button {
  min-height: 1.8rem;
  border: 1px solid rgba(255, 0, 110, 0.58);
  border-radius: 4px;
  background: transparent;
  color: #ff006e;
  cursor: pointer;
}

.control-close-button {
  min-width: 1.8rem;
  font-weight: 700;
  line-height: 1;
}

.control-menu-body {
  margin-top: 0.6rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-height: 0;
}

.control-toggle {
  min-height: 2.2rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border: 1px solid rgba(0, 245, 255, 0.28);
  border-radius: 4px;
  background: rgba(0, 245, 255, 0.04);
  color: #39ff14;
  cursor: pointer;
}

.admin-entry-button {
  margin-top: auto;
  min-height: 2rem;
  border: 1px solid rgba(255, 0, 110, 0.58);
  border-radius: 4px;
  background: transparent;
  color: #ff006e;
  cursor: pointer;
}

.admin-menu {
  margin-top: 0.6rem;
  padding: 0.6rem;
  border: 1px solid rgba(255, 0, 110, 0.4);
  border-radius: 4px;
  background: rgba(255, 0, 110, 0.05);
  overflow-wrap: anywhere;
  min-width: 0;
}

.admin-menu h3 {
  margin: 0 0 0.45rem;
  color: #00f5ff;
  font-size: 0.78rem;
  text-transform: uppercase;
}

.admin-code-form {
  display: grid;
  gap: 0.45rem;
  min-width: 0;
}

.admin-resource-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.4rem;
}

.admin-code-form label {
  display: grid;
  gap: 0.25rem;
  color: #39ff14;
  font-size: 0.75rem;
}

.admin-code-form input {
  width: 100%;
  min-width: 0;
  min-height: 2rem;
  border: 1px solid rgba(0, 245, 255, 0.2);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.03);
  color: #00f5ff;
}

.admin-code-form button {
  width: 100%;
  min-height: 2rem;
  border: 1px solid rgba(255, 0, 110, 0.58);
  border-radius: 4px;
  background: transparent;
  color: #ff006e;
  cursor: pointer;
}

.admin-status {
  margin: 0.5rem 0 0;
  color: #39ff14;
  font-size: 0.72rem;
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

.panel-toggle-right {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.panel-lock-button {
  display: inline-grid;
  place-items: center;
  min-width: 1.2rem;
  min-height: 1.2rem;
  border: 1px solid rgba(0, 245, 255, 0.34);
  border-radius: 4px;
  color: #00f5ff;
  font-family: "Material Symbols Rounded";
  font-size: 0.95rem;
  font-variation-settings: "FILL" 0, "wght" 500, "GRAD" 0, "opsz" 24;
  line-height: 1;
  cursor: pointer;
  user-select: none;
}

.panel-lock-button:focus-visible {
  outline: 1px solid #00f5ff;
  outline-offset: 1px;
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

.nodes-panel.is-collapsed {
  min-height: 0;
  padding: 0.45rem;
  resize: none;
}

.nodes-panel.is-collapsed .panel-toggle {
  min-height: 2.2rem;
}

.node-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr));
  gap: 0.6rem;
  margin-top: 0.6rem;
}

.node-card {
  position: relative;
  min-height: 9.5rem;
  padding: 0.65rem;
  display: grid;
  grid-template-rows: minmax(1.2rem, auto) minmax(2.8rem, auto) minmax(2.5rem, auto);
  gap: 0.5rem;
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

.node-card.is-node-locked {
  opacity: 0.5;
  filter: saturate(0.55);
}

.level-badge {
  position: absolute;
  top: 0.4rem;
  left: 0.45rem;
  color: #39ff14;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 0.65rem;
  text-shadow: 0 0 6px rgba(57, 255, 20, 0.4);
}

.node-title {
  padding-left: 1.75rem;
  color: #00f5ff;
  font-size: 0.8rem;
  font-weight: 700;
  text-shadow: 0 0 10px rgba(0, 245, 255, 0.6);
}

.primary-node-action {
  width: 100%;
  min-height: 2.9rem;
  align-self: stretch;
  border-radius: 8px;
  font-size: clamp(0.82rem, 2.2vw, 1.1rem);
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
  grid-template-columns: minmax(0, 1fr) minmax(6.5rem, 0.8fr);
  gap: 0.5rem;
  align-items: stretch;
}

.node-stat {
  min-height: 2.5rem;
  padding: 0.45rem;
  display: grid;
  place-items: center;
  border-right: 1px solid rgba(0, 245, 255, 0.45);
  color: #39ff14;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 0.74rem;
  text-align: center;
  text-shadow: 0 0 6px rgba(57, 255, 20, 0.4);
}

.upgrade-button {
  min-height: 2.5rem;
  padding: 0.35rem;
  display: grid;
  place-items: center;
  border-radius: 6px;
  font-size: 0.64rem;
  cursor: pointer;
}

.upgrade-button small {
  max-width: 100%;
  overflow-wrap: anywhere;
  color: #39ff14;
  font-size: 0.58rem;
  text-transform: none;
  text-shadow: 0 0 6px rgba(57, 255, 20, 0.4);
}

.clicker-entry-enter-active,
.clicker-entry-leave-active {
  transition: opacity 220ms ease, transform 220ms ease;
}

.clicker-entry-enter-from,
.clicker-entry-leave-to {
  opacity: 0;
  transform: translateY(0.45rem) scale(0.98);
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

.slide-menu-enter-active,
.slide-menu-leave-active {
  transition: transform 220ms ease, opacity 220ms ease;
}

.slide-menu-enter-from,
.slide-menu-leave-to {
  opacity: 0;
}

@media (max-width: 620px) {
  .control-menu-root {
    width: calc(100vw - 1.2rem);
    max-width: calc(100vw - 1.2rem);
    max-height: calc(100vh - 1.2rem);
  }

  .admin-resource-grid {
    grid-template-columns: 1fr;
  }
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
  .top-divider,
  .timed-progress-bar.is-running {
    animation: none;
  }
} 

/* ── Timed-task node card ─────────────────────────────────── */
.timed-node-card {
  grid-template-rows: minmax(1.2rem, auto) auto 1fr auto;
}

.timed-node-body {
  display: grid;
  gap: 0.35rem;
}

.timed-progress-wrap {
  position: relative;
  height: 1.4rem;
  border: 1px solid rgba(0, 245, 255, 0.22);
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.35);
  overflow: hidden;
}

.timed-progress-bar {
  position: absolute;
  inset: 0 auto 0 0;
  width: 0;
  background: linear-gradient(90deg, rgba(57, 255, 20, 0.55), rgba(0, 245, 255, 0.45));
  transition: width 0.1s linear;
}

.timed-progress-bar.is-running {
  animation: progress-pulse 1.4s ease-in-out infinite;
}

.timed-progress-label {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #39ff14;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 0.64rem;
  text-shadow: 0 0 6px rgba(57, 255, 20, 0.55);
  pointer-events: none;
}

.idle-label {
  color: rgba(0, 245, 255, 0.5);
  text-shadow: none;
}

.timed-io-row {
  display: flex;
  gap: 0.4rem;
  align-items: baseline;
}

.timed-io-label {
  flex: 0 0 2.4rem;
  color: rgba(0, 245, 255, 0.55);
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 0.58rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.timed-io-value {
  color: #39ff14;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 0.68rem;
  text-shadow: 0 0 4px rgba(57, 255, 20, 0.4);
  word-break: break-all;
}

.cost-value {
  color: #ff006e;
  text-shadow: 0 0 4px rgba(255, 0, 110, 0.4);
}

.timed-footer {
  grid-template-columns: minmax(0, 1fr) auto minmax(6rem, 0.7fr);
}

.auto-run-button {
  min-height: 2.5rem;
  padding: 0 0.5rem;
  border: 1px solid rgba(0, 245, 255, 0.3);
  border-radius: 6px;
  background: transparent;
  color: rgba(0, 245, 255, 0.55);
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 0.6rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: color 140ms, border-color 140ms, background 140ms, box-shadow 140ms;
}

.auto-run-button.is-active {
  border-color: #39ff14;
  color: #39ff14;
  background: rgba(57, 255, 20, 0.08);
  box-shadow: 0 0 8px rgba(57, 255, 20, 0.3);
}

.auto-run-button:hover:not(:disabled) {
  border-color: rgba(0, 245, 255, 0.7);
  color: #00f5ff;
}

.auto-run-button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.completions-badge {
  position: absolute;
  top: 0.4rem;
  right: 0.45rem;
  color: rgba(0, 245, 255, 0.65);
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 0.58rem;
  text-shadow: 0 0 5px rgba(0, 245, 255, 0.3);
}

/* ── Passive node card ────────────────────────────────────── */
.passive-node-card {
  grid-template-rows: minmax(1.2rem, auto) auto 1fr auto;
}

.passive-io-col {
  display: grid;
  gap: 0.3rem;
  align-content: start;
}

.toggle-passive-button {
  min-height: 2.5rem;
}

.toggle-passive-button.is-enabled {
  border-color: #39ff14;
  color: #39ff14;
  box-shadow: 0 0 12px rgba(57, 255, 20, 0.3);
  text-shadow: 0 0 8px rgba(57, 255, 20, 0.6);
}

.passive-node-card.is-enabled {
  border-color: rgba(57, 255, 20, 0.4);
  box-shadow: inset 0 0 28px rgba(57, 255, 20, 0.035), 0 14px 28px rgba(0, 0, 0, 0.24);
}

/* ── Save I/O section ─────────────────────────────────────── */
.save-io-section {
  display: grid;
  gap: 0.4rem;
}

.import-row {
  display: grid;
  gap: 0.3rem;
}

.import-textarea {
  width: 100%;
  min-height: 4rem;
  padding: 0.4rem;
  border: 1px solid rgba(0, 245, 255, 0.2);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.03);
  color: #00f5ff;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 0.72rem;
  resize: vertical;
}

.import-btn {
  justify-content: center;
}

.import-status {
  margin: 0;
  color: #39ff14;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 0.72rem;
}

/* ── Toast notifications ──────────────────────────────────── */
.toast-container {
  position: fixed;
  bottom: 1.2rem;
  right: 1.2rem;
  z-index: 200;
  display: grid;
  gap: 0.5rem;
  pointer-events: none;
  max-width: min(22rem, calc(100vw - 2.4rem));
}

.toast {
  padding: 0.6rem 0.9rem;
  border-radius: 6px;
  background: rgba(10, 10, 15, 0.95);
  border: 1px solid rgba(0, 245, 255, 0.3);
  color: #00f5ff;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 0.75rem;
  box-shadow: 0 0 16px rgba(0, 245, 255, 0.18);
  backdrop-filter: blur(12px);
}

.toast-success {
  border-color: rgba(57, 255, 20, 0.45);
  color: #39ff14;
  box-shadow: 0 0 16px rgba(57, 255, 20, 0.2);
}

.toast-error {
  border-color: rgba(255, 0, 110, 0.45);
  color: #ff006e;
  box-shadow: 0 0 16px rgba(255, 0, 110, 0.2);
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 240ms ease, transform 240ms ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(1rem);
}

/* ── Keyframes ────────────────────────────────────────────── */
@keyframes progress-pulse {
  0%, 100% { opacity: 0.85; }
  50% { opacity: 1; }
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
