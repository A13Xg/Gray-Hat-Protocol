# Gray Protocol Wiki

This repository is prepared to run entirely as a static GitHub Pages application with browser-local compute and storage.

## Running Model

- Frontend: Vue + Vite static bundle
- Runtime: browser only
- Persistence: `localStorage` save payloads
- No backend services, server code, or database dependencies

## Deployment

- Pages source setting: **GitHub Actions**
- Workflow: `.github/workflows/deploy-pages.yml`
- Build artifact: `dist/` produced by `npm run build`
- Public URL base: `/Gray-Hat-Protocol/` (configured in `vite.config.ts`)

## Debug/Test UI Checklist

The minimal UI in `src/App.vue` includes:

- Resource readouts and alignment display
- Node actions (clicker/passive/timed-task)
- Save/Load/Export/Import/Clear controls
- Debug controls for resource editing, forced ticks, and browser-state cleanup
- In-app log output for behavior verification

## Quality Control Snapshot

- README exists and documents static deployment and health checks
- CHANGELOG exists and tracks current release history
- This wiki document exists for quick project orientation
- Build command validated: `npm run build`
