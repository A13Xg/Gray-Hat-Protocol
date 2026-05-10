# Changelog

## [Unreleased]

### Added
- Debug menu controls for manual resource editing and forced time advancement
- Force-clear browser state action for Gray Protocol save data and scoped cache cleanup
- GitHub Actions Pages deployment workflow at `.github/workflows/deploy-pages.yml`
- In-repo wiki document at `WIKI.md`
- Pages 404 redirect fallback for repository-base navigation
- Tier-two reputation-gated clickers: `Lockdown Firewall` and `Port-Scan`
- Reveal-once clicker behavior (hidden until first unlock, then persist in UI)
- Prestige system with Cypher Shards meta currency
- Talent Matrix with persistent upgrades across prestige resets
- Panel lock/unlock controls with persisted locked dimensions
- Control overlay improvements and lightweight Web Audio UI cues
- Per-node live cost display in Keystrokes, Operations, and Systems panels
- Standalone popup Arcade Core window with multi-mode gameplay and cashout reward bridge

### Changed
- README badges and GitHub Pages deployment links
- Documentation for static GitHub Pages compatibility and browser-only debugging
- README deployment instructions now specify using Pages source `GitHub Actions`
- Core engine now applies prestige/talent modifiers to clicker, passive, and timed-task output
- Save-state repair and normalization now include persistent meta progression data
- Clicker display now supports animated reveal and lock-state greying
- Removed panel lock system; panels are directly resizable and sections auto-expand on newly unlocked content
- Rebalanced node multipliers and upgrade/prestige pacing to reduce runaway growth

## [0.1.0] - Initial Clean Foundation

### Added
- Central time system
- Decimal resource system
- Reputation alignment helper
- JSON-driven node engine
- Clicker, passive, and timed-task node support
- Offline progress support
- Local save/load/export/import
- Basic test UI
- Starter node definitions
