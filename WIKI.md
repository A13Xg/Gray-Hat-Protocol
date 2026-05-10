# Gray Protocol Wiki

This repository is prepared to run entirely as a static GitHub Pages application with browser-local compute and storage.

## Running Model

- Frontend: Vue + Vite static bundle
- Runtime: browser only
- Persistence: `localStorage` save payloads
- Deterministic simulation: tick-based core engine in `src/core/engine.ts`
- Meta progression: prestige + talent matrix stored in save state
- No backend services, server code, or database dependencies

## Deployment

- Pages source setting: **GitHub Actions**
- Workflow: `.github/workflows/deploy-pages.yml`
- Build artifact: `dist/` produced by `npm run build`
- Public URL base: `/Gray-Hat-Protocol/` (configured in `vite.config.ts`)

## Debug/Test UI Checklist

The UI in `src/App.vue` includes:

- Resource readouts and alignment display
- Node actions (clicker/passive/timed-task)
- Alignment-gated reveal-once clickers (hidden until first unlock, then greyed when locked)
- Expanded Operations and Systems panes with live timed-task and passive controls
- Node cards include live scaled input-cost display for decision clarity
- Prestige panel with shard gain and reset trigger
- Talent matrix with per-talent levels, costs, and upgrades
- Minigame hub with five modular reward loops
- Standalone popup arcade window with multiple game modes and capped reward handoff via localStorage
- Save/Load/Export/Import/Clear controls
- Debug controls for resource editing, forced ticks, and browser-state cleanup
- In-app log output for behavior verification
- Control overlay with sound toggle, sleep prevention toggle, and admin menu

## Quality Control Snapshot

- README exists and documents static deployment and health checks
- CHANGELOG exists and tracks current release history
- This wiki document exists for quick project orientation
- Build command validated: `npm run build`

## Progression Notes

- Core resources: money, crypto, compute, reputation.
- Reputation drives alignment: whitehat, greyhat, blackhat.
- Prestige currency: Cypher Shards.
- Talents are persistent upgrades purchased with shards and retained across prestige resets.
- Number formatting uses compact suffix notation (k, M, B, T, Q, then alphabetical tiers).
