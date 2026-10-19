# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Browser remake of SimCity (1989), German UI. Plain JavaScript, no dependencies, no build step, no package.json. Simulation rules follow the open-sourced original (Micropolis); see README.md for the feature list. All graphics and sounds are generated procedurally – there are no image or audio assets.

## Running and checking

- Run: open `index.html` directly (file:// works), or serve the folder (`npx serve .`). Inside a sandboxed iframe it only works over http(s).
- In the browser console, `window.SC` exposes `{ city, view, UI }` (e.g. `SC.city.speed = 3`, `SC.view.centerOn(x, y)`, `SC.city.makeMonster()`).
- There is no test suite or lint config in the repo. Useful checks used during development:
  - Syntax/undefined globals: concatenate `js/*.js` in `index.html` order and run `eslint` with `no-undef` and browser globals (files share one global scope, so lint them together).
  - Headless simulation: load `core, mapgen, sim, sprites, scenarios` into a Node `vm` context (supply `btoa`/`atob`) and call `city.simPhase()` in a loop; `buildScenario(city, SCENARIOS[i])` builds a scenario city. These five files have no DOM dependency.
  - Visual/UI: Playwright (globally installed, `require('/opt/node22/lib/node_modules/playwright')`) against `file:///…/index.html`, driving `window.SC` and taking screenshots.

## Architecture

Classic `<script>` tags, not modules (vendored Firebase compat SDK in `js/vendor/` loads first): every top-level `const`/`function` is a global shared across files, and **load order in `index.html` matters** (firebase vendor → firebase-config → core → mapgen → sim → sprites → scenarios → gfx → view → sound → net → ui → cloud → coop → main). Simulation code extends `City.prototype` via `Object.assign` in several files.

- **Model (`core.js`)**: `City` holds a 120×100 map as typed arrays: `tile` (kind from `T`), `vari` (variant/orientation; for crossings `ROADWIRE/ROADRAIL/RAILWIRE` it stores the primary line's orientation, 0 = horizontal), `zid` (zone id per tile), `power`. Buildings are **zone objects** in `city.zones` (Map id → `{type, x, y, size, den, val, houses, special, powered, var, game}`), not per-tile graphics as in the original. Hospitals/churches are residential zones with `special` 1/2. Connections for roads/rails/wires are derived from neighbours (`roadMask`/`railMask`/`wireMask`), not stored. Tool placement (`applyTool`, `layLine`, `placeZone`, `bulldoze`) and `serialize`/`deserialize` also live here.
- **Analysis maps** use the original's resolutions: half (2×2: traffic, pollution, land value, crime, pop density), quarter (terrain density), eighth (rate of growth, police/fire station and effect maps, commercial rate). Index helpers: `HW/HH`, `QW/QH`, `EW/EH`.
- **Simulation (`sim.js`)**: `simPhase()` runs one of 16 phases; a full cycle = one game week (48 per year, `cityTime`). Phases 1–8 scan the map in vertical strips and accumulate into `city.cen`; phase 9 copies it to `city.stats` (finalized census used by UI, valves, tax). Budget/tax/evaluation run yearly. `fullAnalysis()` recomputes everything after load/new map. Keep formulas aligned with Micropolis; deliberate deviations are commented in code (e.g. fire/flood/quake destroy a whole zone object at once).
- **Sprites & disasters (`sprites.js`)**: vehicles/monster/tornado/explosions in `city.sprites`, positions in world pixels (16 per tile), moved by `moveSprites()` at ~30 Hz independent of sim speed.
- **Scenarios (`scenarios.js`)**: the 8 scenario cities are generated procedurally by builder helpers (`scnCity`, `scnFixPower`, …) and then `fullAnalysis` + `fillHistory`; scenario disasters and win/lose checks hook into the sim via `scenarioDisaster`/`scenarioCheck`.
- **Events**: the simulation never touches the DOM. It calls `city.emit(type, data)` (`message`, `milestone`, `budget`, `evaluation`, `census`, `explosion`, `scenarioEnd`, …); `UI.onCityEvent` reacts. The year-end budget pauses the game: UI opens a modal window and calls `city.finishBudget()` on close.
- **Rendering**: `gfx.js` draws every tile and zone image procedurally and caches canvases by key (`GFX.get`, `GFX.zoneKey`); zone images depend on type/den/val/var. `view.js` (`View`) draws visible tiles each frame, overlays (smoke at `IND_STACKS`/`COAL_STACKS`, radar at `RADAR_POS`, unpowered lightning), sprites and cursor; `MapRender` draws the minimap and data overlays.
- **UI (`ui.js`)**: menus, tool palette (`TOOLS`), windows via `UI.win`/`UI.dialog`, in-game `UI.ask`/`UI.confirm`/`UI.alert` (do not use native `prompt/confirm/alert` – blocked in sandboxed iframes), all `localStorage` access guarded via `UI.storageOK()`. `UI.modal > 0` pauses the sim.
- **Loop (`main.js`)**: `requestAnimationFrame` loop runs sim phases according to `city.speed` (0 pause … 3 fast), moves sprites, reruns `powerScan()` when `city.powerDirty`, renders.

- **Online (`net.js`, `cloud.js`, `coop.js`)**: Firebase Auth (Google) + Realtime Database; `FIREBASE_CONFIG` null ⇒ `Net.available` false and everything stays offline. Modules plug into UI only via extension points: `UI.addMenuItems`, `UI.startButtons`, `UI.toolHooks`, `UI.tickHooks`, `UI.actionGuards`/`UI.guard(action)`, `view.afterDraw`. `city.remote = true` stops local simulation (multiplayer client, city visit); `Cloud.suspended` pauses autosave during multiplayer. Co-op is host-authoritative: host simulates, sends diff packets (`rooms/{id}/diffs`) and periodic snapshots; clients send build actions (`rooms/{id}/actions`). Access control lives in `firebase/database.rules.json` – keep it in sync with any new DB paths.
- **Testing online code**: Firebase emulator (`firebase emulators:start --project demo-simcity` in `firebase/`, needs Java) plus a static server; open `index.html?emulator` (or `?emulator=AUTHPORT,DBPORT`). In emulator mode `Net.signInTest(name)` fakes a Google account. The emulator only enforces rules for `ns=demo-simcity` after `PUT http://127.0.0.1:9000/.settings/rules.json?ns=demo-simcity` with header `Authorization: Bearer owner`.

## Conventions

- UI text and code comments are German; keep it that way.
- Saves are JSON (`format: 'simcity1989-nachbau'`); changing `serialize` needs a matching `deserialize` path for old saves.
