<script setup lang="ts">
import Decimal from 'break_eternity.js'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'

import { GAME_CONFIG, RESOURCE_KEYS } from './core/config'
import {
  calculatePrestigeGain,
  canUpgradeNode,
  canUnlockTalent,
  canPrestige,
  createInitialGameState,
  executeClickNode,
  getTalentUpgradeCost,
  getNodeUpgradeCost,
  performPrestige,
  replaceResources,
  startTimedNode,
  tick,
  togglePassiveNode,
  unlockTalent,
  upgradeNode,
} from './core/engine'
import { NODE_DEFINITIONS, getScaledOutput } from './core/nodes'
import { getScaledInput } from './core/nodes'
import { clearSave, forceClearBrowserState, loadGame, saveGame } from './core/persistence'
import { getReputationAlignment } from './core/resources'
import { calculateDeltaMs, nowMs } from './core/time'
import blackHatImage from './assets/images/BlackHat.png'
import greyHatImage from './assets/images/GreyHat.png'
import whiteHatImage from './assets/images/WhiteHat.png'
import type { ReputationAlignment, ResourceKey, TalentKey } from './core/types'
import { formatAbbreviatedDecimal } from './utils/formatter'

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
const minigameStatus = ref('')
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
let minigameRewardPollId: number | undefined

const clickerNodes = computed(() =>
  NODE_DEFINITIONS.filter((node) => node.nodeType === 'clicker' && Boolean(state.value.nodes[node.nodeID]?.revealed)),
)
const timedTaskNodes = computed(() =>
  NODE_DEFINITIONS.filter((node) => node.nodeType === 'timed-task' && Boolean(state.value.nodes[node.nodeID]?.revealed)),
)
const passiveNodes = computed(() =>
  NODE_DEFINITIONS.filter((node) => node.nodeType === 'passive' && Boolean(state.value.nodes[node.nodeID]?.revealed)),
)

const talentDefinitions: Array<{ key: TalentKey; name: string; description: string }> = [
  { key: 'whitehatYield', name: 'Whitehat Doctrine', description: '+6% clicker output while whitehat-aligned.' },
  { key: 'blackhatYield', name: 'Blackhat Doctrine', description: '+6% clicker output while blackhat-aligned.' },
  { key: 'passiveEfficiency', name: 'Ghost Threads', description: '+8% passive node efficiency.' },
  { key: 'taskAcceleration', name: 'Pipeline Burst', description: '+5% timed-task output.' },
  { key: 'reputationStability', name: 'Social Camouflage', description: '-5% reputation volatility per level (min 40%).' },
  { key: 'computeSurge', name: 'Quantum Overclock', description: '+4% global output.' },
]

const resourceCards = computed(() => {
  return RESOURCE_KEYS.map((key) => ({
    key,
    icon: resourceIcons[key],
    label: key.charAt(0).toUpperCase() + key.slice(1),
    value: formatWholeDecimal(state.value.resources[key]),
    rate: formatRate(resourceRates[key]),
  }))
})
const prestigeGain = computed(() => calculatePrestigeGain(state.value))
const talentCards = computed(() =>
  talentDefinitions.map((definition) => ({
    ...definition,
    level: state.value.meta.talents[definition.key],
    cost: getTalentUpgradeCost(state.value, definition.key),
    canUpgrade: canUnlockTalent(state.value, definition.key),
  })),
)
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
  playUiTone(640, 0.03)
}

function upgradeSelectedNode(nodeID: number): void {
  state.value = upgradeNode(state.value, nodeID)
  playUiTone(520, 0.04)
}

function startTimedTask(nodeID: number): void {
  state.value = startTimedNode(state.value, nodeID)
  playUiTone(590, 0.04)
}

function togglePassiveSystem(nodeID: number): void {
  const isEnabled = state.value.nodes[nodeID]?.enabled ?? false
  state.value = togglePassiveNode(state.value, nodeID, !isEnabled)
  playUiTone(isEnabled ? 420 : 690, 0.03)
}

function startAllTimedTasks(): void {
  for (const node of timedTaskNodes.value) {
    state.value = startTimedNode(state.value, node.nodeID)
  }
  playUiTone(700, 0.05)
}

function enableAllPassiveSystems(enable: boolean): void {
  for (const node of passiveNodes.value) {
    state.value = togglePassiveNode(state.value, node.nodeID, enable)
  }
  playUiTone(enable ? 760 : 420, 0.05)
}

function triggerPrestige(): void {
  const previousPrestigeCount = state.value.meta.prestigeCount
  state.value = performPrestige(state.value)
  if (state.value.meta.prestigeCount > previousPrestigeCount) {
    playUiTone(880, 0.08)
    playUiTone(1120, 0.1)
  }
}

function upgradeTalent(key: TalentKey): void {
  state.value = unlockTalent(state.value, key)
  playUiTone(720, 0.04)
}

function displayNodeLevel(nodeID: number): number {
  return Math.max(1, state.value.nodes[nodeID]?.upgradeLevel ?? 0)
}

function togglePanel(panel: CollapsiblePanel): void {
  activePanels[panel] = !activePanels[panel]
}

function playUiTone(frequency: number, durationSeconds: number): void {
  if (!state.value.preferences.soundsEnabled || typeof window === 'undefined') {
    return
  }

  const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioCtx) {
    return
  }

  const context = new AudioCtx()
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.type = 'triangle'
  oscillator.frequency.value = frequency
  gain.gain.value = 0.03
  oscillator.connect(gain)
  gain.connect(context.destination)
  oscillator.start()
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + durationSeconds)
  oscillator.stop(context.currentTime + durationSeconds)
  window.setTimeout(() => {
    void context.close()
  }, Math.ceil(durationSeconds * 1000) + 40)
}

function claimMinigameRewards(money: number, compute: number, crypto: number): void {
  state.value = replaceResources(state.value, {
    money: state.value.resources.money.add(money),
    compute: state.value.resources.compute.add(compute),
    crypto: state.value.resources.crypto.add(crypto),
  })
}

function pollMinigameRewards(): void {
  const raw = localStorage.getItem('gray-hat-minigame-reward')
  if (!raw) {
    return
  }

  try {
    const parsed = JSON.parse(raw) as { money?: number; compute?: number; crypto?: number; message?: string }
    const clampReward = (value: unknown): number => {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return 0
      }

      return Math.max(0, Math.min(250_000, Math.floor(value)))
    }

    const money = clampReward(parsed.money)
    const compute = clampReward(parsed.compute)
    const crypto = clampReward(parsed.crypto)
    claimMinigameRewards(money, compute, crypto)
    minigameStatus.value =
      typeof parsed.message === 'string' && parsed.message.trim()
        ? parsed.message.slice(0, 180)
        : 'Minigame rewards received.'
    localStorage.removeItem('gray-hat-minigame-reward')
  } catch {
    localStorage.removeItem('gray-hat-minigame-reward')
  }
}

function launchDefenseWindow(): void {
  const popup = window.open('', 'gray-hat-arcade', 'width=1320,height=860,noopener,noreferrer')
  if (!popup) {
    minigameStatus.value = 'Popup blocked. Allow popups to launch the standalone game window.'
    return
  }
  popup.opener = null

  const gameHtml = `<!doctype html>
<html><head><meta charset="utf-8"/><title>Gray Protocol: Arcade Core</title>
<style>
body{margin:0;background:#040612;color:#dff;font-family:Segoe UI,Arial,sans-serif}
#wrap{display:grid;grid-template-columns:340px 1fr;height:100vh}
#ui{padding:14px;border-right:1px solid #1d5160;background:#06101d;overflow:auto}
h1{margin:0 0 8px;color:#56f6ff;font-size:19px}
h2{margin:10px 0 6px;color:#56f6ff;font-size:14px}
p,li{font-size:12px;color:#8fe}
button{margin:4px 0;min-height:32px;width:100%;background:#091b2b;color:#56f6ff;border:1px solid #327d8f;border-radius:6px;cursor:pointer}
canvas{display:block;background:#000}
.stat{font-size:12px;margin:3px 0}
.tabs{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.tabs button.active{border-color:#ff2a7f;color:#9eff3d}
.mini{padding-left:16px}
</style></head><body><div id="wrap"><div id="ui">
<h1>Gray Protocol Arcade Core</h1>
<div class="tabs">
  <button id="tab-defense" class="active">Virus Pipe Defense</button>
  <button id="tab-topdown">Data Heist Ops</button>
  <button id="tab-code">Code Breaker X</button>
  <button id="tab-runner">Firewall 3D Run</button>
</div>
<div class="stat" id="game-name"></div>
<div class="stat" id="money"></div><div class="stat" id="integrity"></div><div class="stat" id="wave"></div><div class="stat" id="score"></div>
<button id="action-main">Primary Action</button>
<button id="cash">Cash Out Rewards</button>
<h2>Controls</h2>
<ul class="mini" id="controls"></ul>
<p id="status"></p>
</div><canvas id="cv" width="980" height="860"></canvas></div>
<script>
const cv=document.getElementById('cv'); const cx=cv.getContext('2d');
let mode='defense', score=0, integrity=100, wave=0;
const stats={money:120, bonus:0}; const controls=document.getElementById('controls');
const actionBtn=document.getElementById('action-main'); const statusEl=document.getElementById('status');
const grid=40, cols=Math.floor(cv.width/grid), rows=Math.floor(cv.height/grid);
let keys={}; document.addEventListener('keydown',e=>keys[e.code]=true); document.addEventListener('keyup',e=>keys[e.code]=false);
const path=[]; for(let x=0;x<cols;x++){ path.push({x, y:Math.floor(rows/2)+(Math.sin(x/2)>0?1:0)})}
const turrets=[]; const enemies=[]; let spawning=false, spawnLeft=0, spawnTick=0, speed=1;
const player={x:cv.width/2,y:cv.height/2,v:4,ammo:80}; const bots=[]; const shots=[];
let secret=''+Math.floor(Math.random()*10000).toString().padStart(4,'0'); let attempts=[]; let guess='';
let runnerX=0, runnerY=0, runnerV=0.12, gates=[];
for(let i=0;i<40;i++){ gates.push({z:i*90, gap:Math.random()*220+120}); }
function setMode(next){
  mode=next; score=0; integrity=100; wave=0; statusEl.textContent='';
  document.querySelectorAll('.tabs button').forEach(b=>b.classList.remove('active'));
  document.getElementById('tab-'+next).classList.add('active');
  if(next==='defense'){ controls.innerHTML='<li>Mouse: place turret</li><li>Space: start wave</li><li>1/2/3 speed</li>'; actionBtn.textContent='Start Wave'; }
  if(next==='topdown'){ controls.innerHTML='<li>WASD move</li><li>Mouse click shoot pulse</li><li>Collect dropped data shards</li>'; actionBtn.textContent='Spawn Raid'; bots.length=0; shots.length=0; player.x=cv.width/2; player.y=cv.height/2; player.ammo=80; }
  if(next==='code'){ controls.innerHTML='<li>Type 4 digits</li><li>Enter submits</li><li>Crack quickly for higher score</li>'; actionBtn.textContent='Submit Guess'; attempts=[]; guess=''; secret=(''+Math.floor(Math.random()*10000)).padStart(4,'0'); }
  if(next==='runner'){ controls.innerHTML='<li>A/D strafe</li><li>Avoid firewall gates</li><li>Survive distance</li>'; actionBtn.textContent='Boost'; runnerX=cv.width/2; runnerY=cv.height-120; runnerV=0.12; }
}
document.getElementById('tab-defense').onclick=()=>setMode('defense');
document.getElementById('tab-topdown').onclick=()=>setMode('topdown');
document.getElementById('tab-code').onclick=()=>setMode('code');
document.getElementById('tab-runner').onclick=()=>setMode('runner');
function spawnEnemy(){ enemies.push({t:0,hp:34+wave*5,speed:0.013+wave*0.0014});}
function startWave(){ if(spawning||enemies.length) return; wave++; spawnLeft=10+wave*4; spawning=true;}
function addTurret(mx,my){ const gx=Math.floor(mx/grid), gy=Math.floor(my/grid); if(stats.money<40) return;
if(path.some(p=>p.x===gx&&p.y===gy)) return; if(turrets.some(t=>t.x===gx&&t.y===gy)) return;
turrets.push({x:gx,y:gy,cd:0,range:3.2,dmg:7+wave*0.7}); stats.money-=40;}
cv.addEventListener('click',e=>{
const r=cv.getBoundingClientRect(); const x=e.clientX-r.left, y=e.clientY-r.top;
if(mode==='defense') addTurret(x,y);
if(mode==='topdown'&&player.ammo>0){ const a=Math.atan2(y-player.y,x-player.x); shots.push({x:player.x,y:player.y,vx:Math.cos(a)*8,vy:Math.sin(a)*8}); player.ammo--; }
});
actionBtn.onclick=()=>{ if(mode==='defense') startWave(); if(mode==='topdown'){ for(let i=0;i<6;i++) bots.push({x:Math.random()*cv.width,y:Math.random()*cv.height,hp:14}); } if(mode==='code'){submitGuess();} if(mode==='runner'){runnerV+=0.03;} };
document.addEventListener('keydown',e=>{ if(mode==='defense'){ if(e.code==='Space')startWave(); if(e.key==='1')speed=1;if(e.key==='2')speed=2;if(e.key==='3')speed=3; } if(mode==='code'&&/\\d/.test(e.key)&&guess.length<4){guess+=e.key;} if(mode==='code'&&e.code==='Backspace'){guess=guess.slice(0,-1);} if(mode==='code'&&e.code==='Enter'){submitGuess();}});
function submitGuess(){ if(guess.length!==4) return; let exact=0,near=0; const a=secret.split(''); const b=guess.split('');
for(let i=0;i<4;i++){ if(a[i]===b[i]){exact++; a[i]='#'; b[i]='*';}}
for(const d of b){ if(d==='*') continue; const idx=a.indexOf(d); if(idx>=0){near++; a[idx]='#';}}
attempts.unshift(guess+' => '+exact+' exact, '+near+' near'); guess=''; if(exact===4){ score+=Math.max(120,360-attempts.length*24); secret=(''+Math.floor(Math.random()*10000)).padStart(4,'0'); attempts=[]; statusEl.textContent='Code cracked.'; }}
function tickDefense(){ for(let s=0;s<speed;s++){ if(spawning){spawnTick++; if(spawnTick%18===0&&spawnLeft>0){spawnEnemy();spawnLeft--;} if(spawnLeft<=0)spawning=false;}
enemies.forEach(en=>en.t+=en.speed); for(let i=enemies.length-1;i>=0;i--){ if(enemies[i].t>=path.length-1){ enemies.splice(i,1); integrity-=4; } }
turrets.forEach(t=>{ if(t.cd>0){t.cd--; return;} let target=null,best=-1; enemies.forEach(en=>{ const p=path[Math.floor(en.t)]||path[path.length-1]; const d=Math.hypot((p.x+0.5)-(t.x+0.5),(p.y+0.5)-(t.y+0.5)); if(d<=t.range&&en.t>best){best=en.t;target=en;} });
if(target){ target.hp-=t.dmg; t.cd=12; if(target.hp<=0){ stats.money+=8+wave; score+=10+wave; enemies.splice(enemies.indexOf(target),1);} } });
if(!spawning&&enemies.length===0&&wave>0){ stats.money+=15+wave*2; score+=18+wave*3; } } }
function tickTopdown(){ if(keys['KeyW'])player.y-=player.v; if(keys['KeyS'])player.y+=player.v; if(keys['KeyA'])player.x-=player.v; if(keys['KeyD'])player.x+=player.v;
player.x=Math.max(10,Math.min(cv.width-10,player.x)); player.y=Math.max(10,Math.min(cv.height-10,player.y));
shots.forEach(s=>{s.x+=s.vx;s.y+=s.vy}); for(let i=shots.length-1;i>=0;i--){ if(shots[i].x<0||shots[i].x>cv.width||shots[i].y<0||shots[i].y>cv.height) shots.splice(i,1);}
bots.forEach(b=>{const a=Math.atan2(player.y-b.y,player.x-b.x); b.x+=Math.cos(a)*1.3; b.y+=Math.sin(a)*1.3;});
for(let i=bots.length-1;i>=0;i--){ const b=bots[i]; for(let j=shots.length-1;j>=0;j--){ const s=shots[j]; if(Math.hypot(b.x-s.x,b.y-s.y)<11){ b.hp-=7; shots.splice(j,1); if(b.hp<=0){ bots.splice(i,1); score+=28; player.ammo+=2;} break; } } if(Math.hypot(b.x-player.x,b.y-player.y)<14){ integrity-=0.4; } }
if(Math.random()<0.03) bots.push({x:Math.random()*cv.width,y:Math.random()*cv.height,hp:14}); }
function tickRunner(){ if(keys['KeyA']) runnerX-=5; if(keys['KeyD']) runnerX+=5; runnerX=Math.max(30,Math.min(cv.width-30,runnerX)); gates.forEach(g=>g.z-=runnerV*60); if(gates[0].z<20){ gates.shift(); gates.push({z:gates[gates.length-1].z+90,gap:Math.random()*220+120}); score+=3; }
for(const g of gates){ if(g.z<80&&g.z>40){ const left=g.gap, right=g.gap+220; if(runnerX<left||runnerX>right){ integrity-=0.7; } } } }
function drawDefense(){ cx.fillStyle='#020b14'; cx.fillRect(0,0,cv.width,cv.height); cx.fillStyle='#0a1c2e'; for(const p of path){cx.fillRect(p.x*grid,p.y*grid,grid,grid);}
turrets.forEach(t=>{cx.fillStyle='#33f6ff';cx.fillRect(t.x*grid+8,t.y*grid+8,24,24);}); enemies.forEach(e=>{ const p=path[Math.floor(e.t)]||path[path.length-1]; cx.fillStyle='#ff2a7f'; cx.beginPath();cx.arc((p.x+0.5)*grid,(p.y+0.5)*grid,10,0,Math.PI*2);cx.fill(); }); }
function drawTopdown(){ cx.fillStyle='#050914'; cx.fillRect(0,0,cv.width,cv.height); cx.fillStyle='#00f6ff'; cx.beginPath();cx.arc(player.x,player.y,10,0,Math.PI*2);cx.fill();
cx.fillStyle='#9eff3d'; shots.forEach(s=>{cx.fillRect(s.x-2,s.y-2,4,4)}); cx.fillStyle='#ff2a7f'; bots.forEach(b=>{cx.beginPath();cx.arc(b.x,b.y,9,0,Math.PI*2);cx.fill();}); cx.fillStyle='#8fe'; cx.fillText('Ammo: '+player.ammo,12,22);}
function drawCode(){ cx.fillStyle='#070a16'; cx.fillRect(0,0,cv.width,cv.height); cx.fillStyle='#56f6ff'; cx.font='28px monospace'; cx.fillText('Guess: '+guess.padEnd(4,'_'),60,90);
cx.font='18px monospace'; attempts.slice(0,12).forEach((line,i)=>cx.fillText(line,60,140+i*28));}
function drawRunner(){ cx.fillStyle='#040812'; cx.fillRect(0,0,cv.width,cv.height); for(const g of gates){ const scale=Math.max(0.2, g.z/900); const y=cv.height-(g.z*0.7); const w=420*scale; const h=24*scale;
cx.fillStyle='rgba(255,42,127,0.75)'; cx.fillRect(0,y,w*(g.gap/cv.width),h); cx.fillRect(w*((g.gap+220)/cv.width),y,cv.width,h);}
cx.fillStyle='#9eff3d'; cx.fillRect(runnerX-12,cv.height-80,24,24);}
function drawHUD(){ document.getElementById('game-name').textContent='Mode: '+mode;
document.getElementById('money').textContent='Money: '+Math.floor(stats.money); document.getElementById('integrity').textContent='Integrity: '+Math.max(0,Math.floor(integrity));
document.getElementById('wave').textContent='Wave: '+wave; document.getElementById('score').textContent='Score: '+Math.floor(score);}
function loop(){ if(mode==='defense'){tickDefense(); drawDefense();} if(mode==='topdown'){tickTopdown(); drawTopdown();} if(mode==='code'){drawCode();} if(mode==='runner'){tickRunner(); drawRunner();}
drawHUD(); if(integrity>0) requestAnimationFrame(loop); else { statusEl.textContent='Run failed. Cash out or switch mode.'; requestAnimationFrame(loop);} }
setMode('defense'); loop();
document.getElementById('cash').onclick=()=>{ const capped=Math.min(180000, Math.max(0, Math.floor(score*2.6 + wave*40 + integrity*7)));
localStorage.setItem('gray-hat-minigame-reward', JSON.stringify({money:capped,compute:Math.floor(capped*0.36),crypto:Math.floor(capped*0.14),message:'Arcade cashout: +'+capped+' money (capped).'}));
score=0; wave=0; integrity=100; statusEl.textContent='Rewards sent to main window.'; };
<\\/script></body></html>`
  popup.document.write(gameHtml)
  popup.document.close()
  minigameStatus.value = 'Opened standalone Arcade Core window.'
}

function formatWholeDecimal(value: Decimal): string {
  return formatAbbreviatedDecimal(value)
}

function formatSignedWhole(value: Decimal): string {
  return `${value.gte(0) ? '+' : ''}${formatAbbreviatedDecimal(value.abs())}`
}

function formatRate(value: number): string {
  return `${formatAbbreviatedDecimal(new Decimal(value))}/s`
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

function inputCostSummary(nodeID: number, perSecond = false): string {
  const definition = NODE_DEFINITIONS.find((node) => node.nodeID === nodeID)
  const runtimeState = state.value.nodes[nodeID]
  if (!definition || !runtimeState) {
    return 'No cost'
  }

  const costs = Object.entries(getScaledInput(definition, runtimeState))
  if (costs.length === 0) {
    return 'No cost'
  }

  const suffix = perSecond ? '/s' : ''
  return costs.map(([key, value]) => `${formatWholeDecimal(value)} ${key}${suffix}`).join(' / ')
}

function progressPercent(nodeID: number): number {
  const definition = NODE_DEFINITIONS.find((node) => node.nodeID === nodeID)
  const runtimeState = state.value.nodes[nodeID]
  if (!definition?.durationMs || !runtimeState) {
    return 0
  }

  return Math.max(0, Math.min(100, (runtimeState.progressMs / definition.durationMs) * 100))
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

watch(
  () => [clickerNodes.value.length, timedTaskNodes.value.length, passiveNodes.value.length],
  (next, previous) => {
    if (!previous) {
      return
    }

    if (next[0] > previous[0]) {
      activePanels.clickers = true
    }

    if (next[1] > previous[1]) {
      activePanels.operations = true
    }

    if (next[2] > previous[2]) {
      activePanels.systems = true
    }
  },
)

onMounted(() => {
  tickIntervalId = window.setInterval(stepGame, GAME_CONFIG.tickRateMs)
  saveIntervalId = window.setInterval(() => {
    persistStateNow()
  }, 2000)
  frameId = window.setTimeout(animateFrame, 100)
  window.addEventListener('keydown', handleGlobalKeydown)
  window.addEventListener('beforeunload', handleBeforeUnload)
  window.addEventListener('pagehide', handlePageHide)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  minigameRewardPollId = window.setInterval(pollMinigameRewards, 800)
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

  if (minigameRewardPollId !== undefined) {
    window.clearInterval(minigameRewardPollId)
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
      <article class="panel nodes-panel resizable-panel" :class="{ 'is-collapsed': !activePanels.clickers }">
        <button class="panel-toggle" type="button" @click="togglePanel('clickers')">
          <span>Keystrokes</span>
          <span>{{ activePanels.clickers ? 'Collapse' : 'Expand' }}</span>
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
                <div class="node-cost">Cost: {{ inputCostSummary(node.nodeID) }}</div>
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

      <article class="panel nodes-panel resizable-panel placeholder-panel" :class="{ 'is-collapsed': !activePanels.operations }">
        <button class="panel-toggle" type="button" @click="togglePanel('operations')">
          <span>Operations</span>
          <span>{{ activePanels.operations ? 'Collapse' : 'Expand' }}</span>
        </button>
        <div v-if="activePanels.operations" class="section-controls">
          <button class="talent-upgrade" type="button" @click="startAllTimedTasks">Start All Available</button>
        </div>
        <Transition name="panel-reveal">
          <div v-if="activePanels.operations" class="node-grid operation-grid">
            <article
              v-for="node in timedTaskNodes"
              :key="node.nodeID"
              class="node-card operation-card"
              :class="{ 'is-node-locked': !state.nodes[node.nodeID].unlocked }"
            >
              <span class="level-badge">L{{ displayNodeLevel(node.nodeID) }}</span>
              <div class="node-title">{{ node.nodeName }}</div>
              <div class="node-cost">Cost: {{ inputCostSummary(node.nodeID) }}</div>
              <button
                class="primary-node-action"
                type="button"
                :disabled="!state.nodes[node.nodeID].unlocked || state.nodes[node.nodeID].isRunning"
                @click="startTimedTask(node.nodeID)"
              >
                {{ state.nodes[node.nodeID].isRunning ? 'Running...' : 'Start Task' }}
              </button>
              <div class="task-progress-wrap">
                <div class="task-progress-bar" :style="{ width: `${progressPercent(node.nodeID)}%` }"></div>
              </div>
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

      <article class="panel nodes-panel resizable-panel placeholder-panel" :class="{ 'is-collapsed': !activePanels.systems }">
        <button class="panel-toggle" type="button" @click="togglePanel('systems')">
          <span>Systems</span>
          <span>{{ activePanels.systems ? 'Collapse' : 'Expand' }}</span>
        </button>
        <div v-if="activePanels.systems" class="section-controls dual">
          <button class="talent-upgrade" type="button" @click="enableAllPassiveSystems(true)">Enable All</button>
          <button class="talent-upgrade" type="button" @click="enableAllPassiveSystems(false)">Disable All</button>
        </div>
        <Transition name="panel-reveal">
          <div v-if="activePanels.systems" class="node-grid system-grid">
            <article
              v-for="node in passiveNodes"
              :key="node.nodeID"
              class="node-card system-card"
              :class="{ 'is-node-locked': !state.nodes[node.nodeID].unlocked }"
            >
              <span class="level-badge">L{{ displayNodeLevel(node.nodeID) }}</span>
              <div class="node-title">{{ node.nodeName }}</div>
              <div class="node-cost">Cost: {{ inputCostSummary(node.nodeID, true) }}</div>
              <button
                class="primary-node-action"
                type="button"
                :disabled="!state.nodes[node.nodeID].unlocked"
                @click="togglePassiveSystem(node.nodeID)"
              >
                {{ state.nodes[node.nodeID].enabled ? 'Disable' : 'Enable' }}
              </button>
              <div class="system-status">
                <span>{{ state.nodes[node.nodeID].enabled ? 'Active' : 'Idle' }}</span>
              </div>
              <div class="node-footer">
                <div class="node-stat">{{ outputSummary(node.nodeID) }}/s</div>
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
    </section>

    <section class="meta-layout">
      <article class="panel meta-panel">
        <div class="panel-heading">Prestige Protocol</div>
        <div class="meta-stats">
          <div class="meta-stat">
            <span>Cypher Shards</span>
            <strong>{{ state.meta.cypherShards }}</strong>
          </div>
          <div class="meta-stat">
            <span>Lifetime Shards</span>
            <strong>{{ state.meta.lifetimeCypherShards }}</strong>
          </div>
          <div class="meta-stat">
            <span>Prestige Count</span>
            <strong>{{ state.meta.prestigeCount }}</strong>
          </div>
        </div>
        <p class="meta-copy">
          Prestige requires at least 50,000 money and absolute reputation of 250. Estimated shard gain:
          <strong>{{ prestigeGain }}</strong>.
        </p>
        <button class="prestige-button" type="button" :disabled="!canPrestige(state)" @click="triggerPrestige">
          Initiate Prestige Reset
        </button>
      </article>

      <article class="panel meta-panel">
        <div class="panel-heading">Talent Matrix</div>
        <div class="talent-grid">
          <article v-for="talent in talentCards" :key="talent.key" class="talent-card info-panel">
            <strong>{{ talent.name }}</strong>
            <span>{{ talent.description }}</span>
            <div class="talent-meta">
              <em>Level {{ talent.level }}</em>
              <em>{{ Number.isFinite(talent.cost) ? `Cost ${talent.cost}` : 'Maxed' }}</em>
            </div>
            <button
              class="talent-upgrade"
              type="button"
              :disabled="!talent.canUpgrade"
              @click="upgradeTalent(talent.key)"
            >
              Upgrade Talent
            </button>
          </article>
        </div>
      </article>
    </section>

    <section class="meta-layout">
      <article class="panel meta-panel">
        <div class="panel-heading">Minigame Hub</div>
        <p class="meta-copy">
          Launch a dedicated popup game window with keyboard and mouse controls. Survive and cash out rewards back into
          your main progression.
        </p>
        <button class="prestige-button" type="button" @click="launchDefenseWindow">Launch Virus Pipe Defense Window</button>
        <p v-if="minigameStatus" class="meta-copy">{{ minigameStatus }}</p>
      </article>

      <article class="panel meta-panel">
        <div class="minigame-pane">
          <h3>Active Game Loop</h3>
          <p>
            The standalone popup runs a full Virus Pipe Defense session. Clear waves, protect integrity, and cash out for
            money, compute, and crypto rewards.
          </p>
          <ul class="minigame-log">
            <li>Mouse click places turrets on valid tiles.</li>
            <li>Space starts waves, keys 1/2/3 adjust sim speed.</li>
            <li>Cash Out writes rewards back into Gray Protocol automatically.</li>
          </ul>
        </div>
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
.node-layout,
.meta-layout {
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

.meta-layout {
  gap: 1rem;
  margin-top: 1rem;
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
.upgrade-button,
.prestige-button,
.talent-upgrade {
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
  min-height: 10.5rem;
  padding: 0.65rem;
  display: grid;
  grid-template-rows: minmax(1.2rem, auto) minmax(1rem, auto) minmax(2.8rem, auto) minmax(2.5rem, auto);
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

.operation-grid,
.system-grid {
  align-items: start;
}

.operation-card,
.system-card {
  min-height: 12rem;
  grid-template-rows: minmax(1.2rem, auto) minmax(1rem, auto) minmax(2.8rem, auto) minmax(1.3rem, auto) minmax(2.5rem, auto);
}

.task-progress-wrap {
  width: 100%;
  height: 0.6rem;
  border: 1px solid rgba(0, 245, 255, 0.28);
  border-radius: 999px;
  overflow: hidden;
  background: rgba(0, 245, 255, 0.08);
}

.task-progress-bar {
  height: 100%;
  background: linear-gradient(90deg, #39ff14 0%, #00f5ff 100%);
  transition: width 120ms linear;
}

.system-status {
  font-size: 0.68rem;
  color: #39ff14;
  text-transform: uppercase;
  letter-spacing: 0.06em;
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

.node-cost {
  color: rgba(57, 255, 20, 0.96);
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 0.64rem;
  line-height: 1.2;
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

.meta-panel {
  min-height: 10rem;
}

.meta-stats {
  margin-top: 0.7rem;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.45rem;
}

.meta-stat {
  padding: 0.55rem;
  border: 1px solid rgba(0, 245, 255, 0.24);
  border-radius: 6px;
  background: rgba(0, 245, 255, 0.04);
  display: grid;
  gap: 0.2rem;
}

.meta-stat span {
  color: #00f5ff;
  font-size: 0.7rem;
  text-transform: uppercase;
}

.meta-stat strong {
  color: #39ff14;
  font-size: 1rem;
}

.meta-copy {
  margin: 0.75rem 0;
  color: #39ff14;
  font-size: 0.78rem;
}

.prestige-button {
  width: 100%;
  min-height: 2.5rem;
  border-radius: 6px;
  cursor: pointer;
}

.prestige-button:disabled,
.talent-upgrade:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.talent-grid {
  margin-top: 0.7rem;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  gap: 0.55rem;
}

.talent-card {
  padding: 0.65rem;
  border-radius: 6px;
  display: grid;
  gap: 0.35rem;
}

.talent-card strong {
  color: #00f5ff;
  font-size: 0.82rem;
}

.talent-card span {
  color: #39ff14;
  font-size: 0.74rem;
}

.talent-meta {
  display: flex;
  justify-content: space-between;
  gap: 0.4rem;
  color: #f0f7ff;
  font-size: 0.7rem;
}

.talent-upgrade {
  min-height: 2rem;
  border-radius: 6px;
  cursor: pointer;
}

.section-controls {
  margin-top: 0.45rem;
  display: grid;
  gap: 0.4rem;
}

.section-controls.dual {
  grid-template-columns: 1fr 1fr;
}

.minigame-tab-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.minigame-tab {
  min-height: 1.9rem;
  padding: 0 0.55rem;
  border: 1px solid rgba(0, 245, 255, 0.3);
  border-radius: 6px;
  background: rgba(0, 245, 255, 0.05);
  color: #00f5ff;
  text-transform: uppercase;
  font-size: 0.64rem;
  cursor: pointer;
}

.minigame-tab.active {
  border-color: rgba(255, 0, 110, 0.65);
  color: #39ff14;
}

.minigame-pane {
  display: grid;
  gap: 0.55rem;
}

.minigame-pane h3 {
  margin: 0;
  color: #00f5ff;
  font-size: 0.95rem;
}

.minigame-pane p {
  margin: 0;
  color: #39ff14;
  font-size: 0.75rem;
}

.minigame-pane input {
  min-height: 2.2rem;
  padding: 0.4rem;
  border: 1px solid rgba(0, 245, 255, 0.25);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.03);
  color: #00f5ff;
}

.minigame-log {
  margin: 0;
  padding-left: 1.1rem;
  color: #39ff14;
  font-size: 0.72rem;
}

.matrix-board {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.35rem;
}

.matrix-card {
  min-height: 2rem;
  border: 1px solid rgba(0, 245, 255, 0.25);
  border-radius: 6px;
  background: rgba(0, 245, 255, 0.08);
  color: #00f5ff;
  cursor: pointer;
}

.stack-track {
  position: relative;
  height: 2rem;
  border: 1px solid rgba(0, 245, 255, 0.25);
  border-radius: 999px;
  background: rgba(0, 245, 255, 0.06);
}

.stack-target,
.stack-runner {
  position: absolute;
  top: 0.2rem;
  width: 0.8rem;
  height: 1.6rem;
  border-radius: 4px;
  transform: translateX(-50%);
}

.stack-target {
  background: rgba(255, 0, 110, 0.8);
}

.stack-runner {
  background: rgba(57, 255, 20, 0.82);
}

.lane-grid {
  display: grid;
  gap: 0.35rem;
}

.lane-row {
  position: relative;
  min-height: 2.2rem;
  border: 1px solid rgba(0, 245, 255, 0.25);
  border-radius: 6px;
  overflow: hidden;
  background: rgba(0, 245, 255, 0.06);
}

.lane-progress {
  position: absolute;
  inset: 0 auto 0 0;
  background: linear-gradient(90deg, rgba(255, 0, 110, 0.22), rgba(255, 0, 110, 0.78));
}

.lane-row .matrix-card {
  position: absolute;
  right: 0.3rem;
  top: 0.2rem;
  z-index: 1;
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

  .meta-layout {
    grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
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

  .meta-stats {
    grid-template-columns: 1fr;
  }
}
</style>
