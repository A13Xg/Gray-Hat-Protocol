# Gray Protocol

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Live-2ea44f?logo=githubpages)](https://a13xg.github.io/Gray-Hat-Protocol/)
[![Vue 3](https://img.shields.io/badge/Vue-3-42b883?logo=vuedotjs&logoColor=white)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-Static%20Build-646cff?logo=vite&logoColor=white)](https://vite.dev/)

Gray Protocol is a browser-based cyber incremental game with deterministic simulation, browser-only persistence, reputation-aligned progression, prestige resets, and a talent matrix.

## GitHub Pages

- Live site: https://a13xg.github.io/Gray-Hat-Protocol/
- Repository: https://github.com/A13Xg/Gray-Hat-Protocol
- Deployment model: fully static client-side app with no server runtime required
- Required Pages setting: **Settings → Pages → Source = GitHub Actions**
- Deployment workflow: `.github/workflows/deploy-pages.yml` builds Vite output and deploys `/dist`

## Tech Stack

- Vue 3
- TypeScript
- Vite
- break_eternity.js
- GitHub Pages static deployment
- Web Audio API for lightweight UI SFX

## Setup

```bash
npm install
```

## Development

```bash
npm run dev
```

## Build

```bash
npm run build
```

## Health Check

- Run `npm run build`
- Open the UI locally and verify:
  - node actions, ticking, save controls, and debug menu actions
  - unlock-and-reveal behavior for alignment gated clickers
  - prestige requirements, reset behavior, and shard gain
  - talent upgrades consuming shards and affecting output
- Confirm the Pages workflow succeeds and publishes the built static artifact

## Architecture Overview

- `src/core/` contains the headless game engine modules for time, resources, nodes, validation, persistence, prestige, talents, and state updates
- `src/App.vue` contains the game UI, advanced panel controls, control/admin overlays, clicker reveal animations, and meta progression panels
- `src/utils/formatter.ts` contains plain-text display formatting helpers

## Resource System Summary

Resources use `Decimal` from `break_eternity.js` and include:

- `money`
- `crypto`
- `compute`
- `reputation`

Reputation is signed and determines whitehat, greyhat, or blackhat alignment.

Display notation uses compact incremental suffixes:

- `1k`, `10k`, `100k`
- `1M`, `100M`, `1B`, `1T`, `1Q`
- then alphabetical tiers such as `1aaa`, `999aaa`, `1aab`...

## Node System Summary

Starter nodes are JSON-driven and normalized at runtime into Decimal-safe node definitions.

Supported node types:

- `clicker`
- `passive`
- `timed-task`
- `other`

Required node dependencies are treated as “must already be unlocked”.

Second-tier alignment clickers:

- `Lockdown Firewall` (whitehat path, unlocks at reputation `>= 300`)
- `Port-Scan` (blackhat path, unlocks at reputation `<= -300`)

These nodes are hidden until first unlock. After reveal, they remain visible and become disabled/greyed if the player falls out of the required alignment.

The node catalog now includes 30 modules across:

- Keystrokes (clickers)
- Operations (timed tasks)
- Systems (passive automation)

Each node card now displays its current scaled input cost directly in the UI.

## Prestige + Talent Summary

- Prestige becomes available once money and reputation thresholds are met.
- Prestige resets run resources and node runtime while preserving meta progression.
- Prestige rewards `Cypher Shards`, which are used in the Talent Matrix.
- Talents provide permanent meta modifiers across future runs:
  - whitehat clicker amplification
  - blackhat clicker amplification
  - passive efficiency
  - timed-task amplification
  - reputation volatility dampening
  - global output scaling

## Minigame Hub

The UI launches a standalone popup Arcade window with multiple modes that convert performance into core resources:

- `Virus Pipe Defense` (tower-defense lane/path control)
- `Data Heist Ops` (top-down combat control)
- `Code Breaker X` (logic puzzle decoding)
- `Firewall 3D Run` (pseudo-3D dodge runner)

Rewards are cashout-capped and fed back into money, compute, and crypto progression loops.

## Save / Load Summary

- Browser saves use `localStorage`
- Decimal resources serialize to strings
- Saves include version, time state, log entries, node runtime state, preferences, and meta progression state
- Loading applies capped offline progress through the same engine logic used for active play
- Export/import works entirely in-browser, making it compatible with GitHub Pages hosting constraints

## Debug Menu

The test UI includes a debug menu intended for browser-only and GitHub Pages validation:

- manually set `money`, `crypto`, `compute`, and `reputation`
- run forced short/long ticks
- sync the debug form from the current state
- force-clear Gray Protocol save data and scoped browser cache/service-worker state

## GitHub Pages Deployment Note

`vite.config.ts` is configured with the repository base path so the static build is compatible with GitHub Pages deployments from this repository.
