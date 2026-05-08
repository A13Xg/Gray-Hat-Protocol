# Gray Protocol

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Live-2ea44f?logo=githubpages)](https://a13xg.github.io/Gray-Hat-Protocol/)
[![Vue 3](https://img.shields.io/badge/Vue-3-42b883?logo=vuedotjs&logoColor=white)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-Static%20Build-646cff?logo=vite&logoColor=white)](https://vite.dev/)

Gray Protocol is a browser-based incremental idle game foundation rebuilt around a small, deterministic, UI-independent core engine.

## GitHub Pages

- Live site: https://a13xg.github.io/Gray-Hat-Protocol/
- Repository: https://github.com/A13Xg/Gray-Hat-Protocol
- Deployment model: fully static client-side app with no server runtime required

## Tech Stack

- Vue 3
- TypeScript
- Vite
- break_eternity.js
- GitHub Pages static deployment

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
- Open the basic test UI locally and verify node actions, ticking, save controls, and debug menu actions

## Architecture Overview

- `src/core/` contains the headless game engine modules for time, resources, nodes, validation, persistence, and state updates
- `src/App.vue` is a thin test UI that reads state and calls core functions
- `src/utils/formatter.ts` contains plain-text display formatting helpers

## Resource System Summary

Resources use `Decimal` from `break_eternity.js` and include:

- `money`
- `crypto`
- `compute`
- `reputation`

Reputation is signed and determines whitehat, greyhat, or blackhat alignment.

## Node System Summary

Starter nodes are JSON-driven and normalized at runtime into Decimal-safe node definitions.

Supported node types:

- `clicker`
- `passive`
- `timed-task`
- `other`

Required node dependencies are treated as “must already be unlocked”.

## Save / Load Summary

- Browser saves use `localStorage`
- Decimal resources serialize to strings
- Saves include version, time state, log entries, and node runtime state
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
