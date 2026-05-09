# Node JSON Syntax

Node definitions live in `src/core/starterNodes.json`. The file is a JSON array where each item defines one node that the game engine normalizes and loads at startup.

```json
[
  {
    "nodeID": 1,
    "nodeName": "Hack Computer",
    "nodeType": "clicker",
    "baseInput": {},
    "baseOutput": {
      "money": 1,
      "reputation": -1
    },
    "baseMultiplier": 1.15,
    "modMultiplier": 1,
    "unlockRequirement": {},
    "upgradeLevel": 0
  }
]
```

## Required Fields

| Field | Type | Description |
| --- | --- | --- |
| `nodeID` | integer | Unique node identifier. Nodes are sorted by this value after loading. |
| `nodeName` | string | Display name shown in the UI and game log. Cannot be empty. |
| `nodeType` | string | Node behavior type. Must be one of `clicker`, `passive`, `timed-task`, or `other`. |
| `baseMultiplier` | number or string | Positive multiplier used when scaling inputs and outputs by upgrade level. |
| `modMultiplier` | number or string | Positive extra multiplier applied after upgrade scaling. Use `1` for no modifier. |
| `upgradeLevel` | integer | Starting upgrade level. Must be between `0` and the configured max level. |

## Optional Fields

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `baseInput` | resource map | `{}` | Resource costs consumed by the node. |
| `baseOutput` | resource map | `{}` | Resources produced by the node. |
| `unlockRequirement` | object | `{ "requiredNodeIDs": [] }` | Requirements that must be satisfied before the node unlocks. |
| `durationMs` | number | none | Required for `timed-task` nodes. Duration in milliseconds. |

## Resource Maps

`baseInput` and `baseOutput` are objects keyed by resource name. Valid resource keys are:

- `money`
- `crypto`
- `compute`
- `reputation`

Values can be JSON numbers or strings that `break_eternity.js` can parse as decimal values.

```json
"baseInput": {
  "money": 50,
  "compute": "1e6"
},
"baseOutput": {
  "crypto": "0.25",
  "reputation": 5
}
```

`reputation` can be negative. Other resources are repaired back to zero if they would become negative.

## Node Types

### `clicker`

A clicker node executes once when the player presses its action button.

- Consumes its scaled `baseInput` immediately.
- Produces its scaled `baseOutput` immediately.
- Does not need `durationMs`.

### `passive`

A passive node runs continuously while enabled and unlocked.

- Inputs and outputs are applied per second.
- If the player cannot afford the scaled input for a tick, the node disables itself.
- Does not need `durationMs`.

### `timed-task`

A timed task starts manually, waits for `durationMs`, then completes.

- `durationMs` is required and must be positive.
- Consumes its scaled `baseInput` when started.
- Produces its scaled `baseOutput` when completed.
- Completion count is tracked in runtime state.

```json
{
  "nodeID": 10,
  "nodeName": "Security Audit",
  "nodeType": "timed-task",
  "durationMs": 30000,
  "baseInput": {
    "money": 50
  },
  "baseOutput": {
    "money": 100,
    "reputation": 5
  },
  "baseMultiplier": 1.15,
  "modMultiplier": 1,
  "unlockRequirement": {
    "reputationMin": 0
  },
  "upgradeLevel": 0
}
```

### `other`

`other` is a valid node type for future or custom behavior, but the current engine does not execute it through the built-in clicker, passive, or timed-task handlers.

## Unlock Requirements

`unlockRequirement` can contain any combination of:

| Field | Type | Description |
| --- | --- | --- |
| `reputationMin` | number or string | Node unlocks only when reputation is greater than or equal to this value. |
| `reputationMax` | number or string | Node unlocks only when reputation is less than or equal to this value. |
| `requiredNodeIDs` | integer array | Node unlocks only after every listed node is already unlocked. |

Examples:

```json
"unlockRequirement": {
  "reputationMin": 0
}
```

```json
"unlockRequirement": {
  "reputationMax": -25,
  "requiredNodeIDs": [1, 4]
}
```

An empty object means the node has no special unlock requirements.

## Upgrade Scaling

Inputs and outputs use the same scaling formula:

```text
scaled value = base value * (baseMultiplier ^ upgradeLevel) * modMultiplier
```

For example, with `baseOutput.money = 100`, `baseMultiplier = 1.15`, `modMultiplier = 1`, and `upgradeLevel = 2`, the scaled output is:

```text
100 * (1.15 ^ 2) * 1 = 132.25 money
```

Node upgrade costs are configured separately in `src/core/config.ts`; they are not defined inside `starterNodes.json`.

## Validation Rules

The engine validates node definitions on startup. A node definition is invalid when:

- `nodeID` is not an integer.
- `nodeID` is duplicated.
- `nodeName` is empty.
- `nodeType` is not one of the supported node types.
- `baseInput` or `baseOutput` uses an unknown resource key.
- a resource value cannot be parsed as a finite decimal.
- `baseMultiplier` or `modMultiplier` is not positive.
- `upgradeLevel` is outside the configured upgrade range.
- `requiredNodeIDs` contains a non-integer value.
- a `timed-task` node does not define a positive `durationMs`.

## Full Template

```json
{
  "nodeID": 6,
  "nodeName": "Node Name",
  "nodeType": "clicker",
  "baseInput": {
    "money": 10
  },
  "baseOutput": {
    "crypto": "0.5",
    "reputation": 1
  },
  "baseMultiplier": 1.15,
  "modMultiplier": 1,
  "unlockRequirement": {
    "reputationMin": 0,
    "requiredNodeIDs": [1]
  },
  "upgradeLevel": 0
}
```
