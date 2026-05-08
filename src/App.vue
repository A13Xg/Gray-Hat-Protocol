<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { GAME_CONFIG } from './core/config'
import {
  canUpgradeNode,
  createInitialGameState,
  executeClickNode,
  getNodeUpgradeCost,
  startTimedNode,
  tick,
  togglePassiveNode,
  upgradeNode,
} from './core/engine'
import { NODE_DEFINITIONS, getScaledInput, getScaledOutput } from './core/nodes'
import { clearSave, exportSave, importSave, loadGame, saveGame } from './core/persistence'
import { getReputationAlignment } from './core/resources'
import { calculateDeltaMs, nowMs } from './core/time'
import { formatDuration, formatReputation, formatResource } from './utils/formatter'

const state = ref(loadGame())
const savePayload = ref('')

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
}

function exportCurrentGame(): void {
  savePayload.value = exportSave(state.value)
}

function importCurrentGame(): void {
  state.value = importSave(savePayload.value)
}

function clearCurrentSave(): void {
  clearSave()
  state.value = createInitialGameState()
  savePayload.value = ''
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
textarea {
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
