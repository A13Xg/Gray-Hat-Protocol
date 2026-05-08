<script setup lang="ts">
import Decimal from 'break_eternity.js'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

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
import type { ResourceKey } from './core/types'
import { NODE_DEFINITIONS, getScaledInput, getScaledOutput } from './core/nodes'
import { clearSave, exportSave, forceClearBrowserState, importSave, loadGame, saveGame } from './core/persistence'
import { getReputationAlignment } from './core/resources'
import { calculateDeltaMs, nowMs } from './core/time'
import { formatDuration, formatReputation, formatResource } from './utils/formatter'

const state = ref(loadGame())
const savePayload = ref('')
const isForceClearing = ref(false)
const debugStatusMessage = ref('')
const debugResourceKeys = RESOURCE_KEYS
const debugResources = ref<Record<ResourceKey, string>>({
  money: state.value.resources.money.toString(),
  crypto: state.value.resources.crypto.toString(),
  compute: state.value.resources.compute.toString(),
  reputation: state.value.resources.reputation.toString(),
})

function syncDebugResourcesFromState(): void {
  debugResources.value = {
    money: state.value.resources.money.toString(),
    crypto: state.value.resources.crypto.toString(),
    compute: state.value.resources.compute.toString(),
    reputation: state.value.resources.reputation.toString(),
  }
}

function stepGame(): void {
  const timestamp = nowMs()
  const deltaMs = calculateDeltaMs(state.value.time, timestamp)
  state.value = tick(state.value, deltaMs)
}

let intervalId: number | undefined

onMounted(() => {
  intervalId = window.setInterval(stepGame, GAME_CONFIG.tickRateMs)
})

onBeforeUnmount(() => {
  if (intervalId !== undefined) {
    window.clearInterval(intervalId)
  }
})

const groupedNodes = computed(() => {
  return {
    clicker: NODE_DEFINITIONS.filter((node) => node.nodeType === 'clicker'),
    passive: NODE_DEFINITIONS.filter((node) => node.nodeType === 'passive'),
    'timed-task': NODE_DEFINITIONS.filter((node) => node.nodeType === 'timed-task'),
    other: NODE_DEFINITIONS.filter((node) => node.nodeType === 'other'),
  }
})

const reputationAlignment = computed(() => getReputationAlignment(state.value.resources))

function executeNode(nodeID: number): void {
  state.value = executeClickNode(state.value, nodeID)
}

function toggleNode(nodeID: number, enabled: boolean): void {
  state.value = togglePassiveNode(state.value, nodeID, enabled)
}

function startNode(nodeID: number): void {
  state.value = startTimedNode(state.value, nodeID)
}

function upgradeSelectedNode(nodeID: number): void {
  state.value = upgradeNode(state.value, nodeID)
}

function saveCurrentGame(): void {
  state.value = saveGame(state.value)
}

function loadCurrentGame(): void {
  state.value = loadGame()
  syncDebugResourcesFromState()
}

function exportCurrentGame(): void {
  savePayload.value = exportSave(state.value)
}

function importCurrentGame(): void {
  state.value = importSave(savePayload.value)
  syncDebugResourcesFromState()
}

function clearCurrentSave(): void {
  clearSave()
  state.value = createInitialGameState()
  savePayload.value = ''
  syncDebugResourcesFromState()
}

function applyDebugResources(): void {
  for (const [resourceKey, value] of Object.entries(debugResources.value)) {
    try {
      const normalized = new Decimal(value)
      if (!normalized.isFinite()) {
        throw new Error('non-finite')
      }
    } catch {
      debugStatusMessage.value = `Invalid ${resourceKey} value. Enter a finite number.`
      return
    }
  }

  state.value = replaceResources(state.value, debugResources.value)
  syncDebugResourcesFromState()
  debugStatusMessage.value = 'Applied debug resource values.'
}

function simulateDebugTick(deltaMs: number): void {
  state.value = tick(state.value, deltaMs)
  syncDebugResourcesFromState()
  debugStatusMessage.value = `Simulated ${deltaMs}ms of game time.`
}

async function forceClearCurrentBrowserState(): Promise<void> {
  isForceClearing.value = true

  try {
    await forceClearBrowserState()
    state.value = createInitialGameState()
    state.value.log = [...state.value.log, 'Force-cleared browser save data and scoped cache state.'].slice(
      -GAME_CONFIG.logMaxEntries,
    )
    savePayload.value = ''
    syncDebugResourcesFromState()
    debugStatusMessage.value = 'Force-cleared Gray Protocol save data and scoped browser cache state.'
  } finally {
    isForceClearing.value = false
  }
}

function formatScaledResourceMap(nodeID: number, mode: 'input' | 'output'): string {
  const definition = NODE_DEFINITIONS.find((node) => node.nodeID === nodeID)
  if (!definition) {
    return 'None'
  }

  const runtimeState = state.value.nodes[nodeID]
  const resourceMap = mode === 'input' ? getScaledInput(definition, runtimeState) : getScaledOutput(definition, runtimeState)
  const entries = Object.entries(resourceMap)

  if (entries.length === 0) {
    return 'None'
  }

  return entries.map(([key, value]) => `${key}: ${key === 'reputation' ? formatReputation(value) : formatResource(value)}`).join(', ')
}

function formatUpgradeCost(nodeID: number): string {
  const entries = Object.entries(getNodeUpgradeCost(state.value, nodeID))

  if (entries.length === 0) {
    return 'maxed'
  }

  return entries.map(([key, value]) => `${key}: ${formatResource(value)}`).join(', ')
}
</script>

<template>
  <main class="app-shell">
    <section class="panel">
      <h1>Gray Protocol</h1>
      <p>Clean rebuild test UI for the headless core engine.</p>
    </section>

    <section class="panel">
      <h2>Resources</h2>
      <div class="resource-grid">
        <div><strong>Money</strong><span>{{ formatResource(state.resources.money) }}</span></div>
        <div><strong>Crypto</strong><span>{{ formatResource(state.resources.crypto) }}</span></div>
        <div><strong>Compute</strong><span>{{ formatResource(state.resources.compute) }}</span></div>
        <div><strong>Reputation</strong><span>{{ formatReputation(state.resources.reputation) }}</span></div>
        <div><strong>Alignment</strong><span>{{ reputationAlignment }}</span></div>
      </div>
    </section>

    <section class="panel">
      <h2>Time</h2>
      <div class="resource-grid">
        <div><strong>Total active</strong><span>{{ formatDuration(state.time.totalActiveMs) }}</span></div>
        <div><strong>Total offline</strong><span>{{ formatDuration(state.time.totalOfflineMs) }}</span></div>
        <div><strong>Last saved</strong><span>{{ new Date(state.time.lastSavedAt).toLocaleString() }}</span></div>
      </div>
    </section>

    <section class="panel">
      <h2>Nodes</h2>
      <div v-for="(nodes, type) in groupedNodes" :key="type" class="node-group">
        <h3>{{ type }}</h3>
        <article v-for="node in nodes" :key="node.nodeID" class="node-card">
          <div class="node-header">
            <div>
              <strong>#{{ node.nodeID }} {{ node.nodeName }}</strong>
              <div>{{ node.nodeType }}</div>
            </div>
            <div>Unlocked: {{ state.nodes[node.nodeID].unlocked ? 'Yes' : 'No' }}</div>
          </div>
          <div class="node-details">
            <div><strong>Upgrade level:</strong> {{ state.nodes[node.nodeID].upgradeLevel }}</div>
            <div><strong>Scaled input:</strong> {{ formatScaledResourceMap(node.nodeID, 'input') }}</div>
            <div><strong>Scaled output:</strong> {{ formatScaledResourceMap(node.nodeID, 'output') }}</div>
            <div v-if="node.nodeType === 'timed-task'"><strong>Progress:</strong> {{ formatDuration(state.nodes[node.nodeID].progressMs) }} / {{ formatDuration(node.durationMs ?? 0) }}</div>
            <div v-if="node.nodeType === 'timed-task'"><strong>Completions:</strong> {{ state.nodes[node.nodeID].completions }}</div>
          </div>
          <div class="actions">
            <button v-if="node.nodeType === 'clicker'" :disabled="!state.nodes[node.nodeID].unlocked" @click="executeNode(node.nodeID)">
              Execute
            </button>
            <button
              v-if="node.nodeType === 'passive'"
              @click="toggleNode(node.nodeID, !state.nodes[node.nodeID].enabled)"
              :disabled="!state.nodes[node.nodeID].unlocked"
            >
              {{ state.nodes[node.nodeID].enabled ? 'Disable' : 'Enable' }}
            </button>
            <button
              v-if="node.nodeType === 'timed-task'"
              @click="startNode(node.nodeID)"
              :disabled="!state.nodes[node.nodeID].unlocked || state.nodes[node.nodeID].isRunning"
            >
              {{ state.nodes[node.nodeID].isRunning ? 'Running' : 'Start' }}
            </button>
            <button
              @click="upgradeSelectedNode(node.nodeID)"
              :disabled="!canUpgradeNode(state, node.nodeID)"
            >
              Upgrade ({{ formatUpgradeCost(node.nodeID) }})
            </button>
          </div>
        </article>
      </div>
    </section>

    <section class="panel">
      <h2>Save Controls</h2>
      <p>Everything runs client-side so GitHub Pages only needs static hosting and browser storage APIs.</p>
      <div class="actions save-actions">
        <button @click="saveCurrentGame">Save</button>
        <button @click="loadCurrentGame">Load</button>
        <button @click="exportCurrentGame">Export</button>
        <button @click="importCurrentGame">Import</button>
        <button @click="clearCurrentSave">Clear Save</button>
      </div>
      <textarea v-model="savePayload" rows="10" placeholder="Exported save data appears here."></textarea>
    </section>

    <section class="panel">
      <h2>Debug Menu</h2>
      <p>Testing helpers for the static GitHub Pages build.</p>

      <div class="resource-grid">
        <label v-for="resourceKey in debugResourceKeys" :key="resourceKey" class="debug-field">
          <strong>{{ resourceKey }}</strong>
          <input v-model="debugResources[resourceKey as ResourceKey]" type="text" :placeholder="resourceKey" />
        </label>
      </div>

      <div class="actions save-actions">
        <button @click="syncDebugResourcesFromState">Sync Current Resources</button>
        <button @click="applyDebugResources">Apply Resource Values</button>
        <button @click="simulateDebugTick(1_000)">Tick +1s</button>
        <button @click="simulateDebugTick(60_000)">Tick +60s</button>
        <button @click="forceClearCurrentBrowserState" :disabled="isForceClearing">
          {{ isForceClearing ? 'Clearing…' : 'Force Clear Save/Cache' }}
        </button>
      </div>
      <p v-if="debugStatusMessage" class="debug-status">{{ debugStatusMessage }}</p>
    </section>

    <section class="panel">
      <h2>Log</h2>
      <ul class="log-list">
        <li v-for="(entry, index) in [...state.log].reverse()" :key="`${index}-${entry}`">{{ entry }}</li>
      </ul>
    </section>
  </main>
</template>

<style scoped>
:global(body) {
  margin: 0;
  font-family: Arial, Helvetica, sans-serif;
  background: #111827;
  color: #f9fafb;
}

:global(*) {
  box-sizing: border-box;
}

.app-shell {
  display: grid;
  gap: 1rem;
  padding: 1rem;
  max-width: 1200px;
  margin: 0 auto;
}

.panel {
  background: #1f2937;
  border: 1px solid #374151;
  border-radius: 0.75rem;
  padding: 1rem;
}

.resource-grid,
.node-details {
  display: grid;
  gap: 0.5rem;
}

.resource-grid > div,
.node-details > div {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
}

.node-group {
  display: grid;
  gap: 0.75rem;
  margin-top: 1rem;
}

.node-card {
  border: 1px solid #4b5563;
  border-radius: 0.75rem;
  padding: 0.75rem;
  display: grid;
  gap: 0.75rem;
}

.node-header,
.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.5rem;
}

button,
textarea,
input {
  width: 100%;
  border-radius: 0.5rem;
  border: 1px solid #6b7280;
  background: #0f172a;
  color: inherit;
  padding: 0.75rem;
}

button {
  cursor: pointer;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.save-actions {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  margin-bottom: 0.75rem;
}

.debug-field {
  display: grid;
  gap: 0.4rem;
}

.debug-status {
  margin: 0;
  color: #93c5fd;
}

.log-list {
  padding-left: 1rem;
  margin: 0;
}

@media (min-width: 720px) {
  .resource-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .actions button {
    width: auto;
  }
}
</style>
