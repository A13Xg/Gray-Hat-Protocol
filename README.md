# Gray Protocol

![Vue](https://img.shields.io/badge/Vue-3-42b883)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![Vite](https://img.shields.io/badge/Vite-Build-646CFF)
![GitHub Pages](https://img.shields.io/badge/Deploy-GitHub%20Pages-black)

Gray Protocol is a browser-based incremental idle game foundation rebuilt around a small, deterministic, UI-independent core engine.

## GitHub Pages

https://a13xg.github.io/Gray-Hat-Protocol/

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
- Open the basic test UI locally and verify node actions, ticking, and save controls

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

## GitHub Pages Deployment Note

`vite.config.ts` is configured with the repository base path so the static build is compatible with GitHub Pages deployments from this repository.
