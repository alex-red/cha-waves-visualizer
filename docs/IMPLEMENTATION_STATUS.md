# Implementation status

Status date: **October 15, 2026**. This records the current implementation against the [roadmap](IMPLEMENTATION_ROADMAP.md). It is not a complete P0 release claim.

## Current manual-test increment

The [offline workspace](OFFLINE_WORKSPACE.md) adds explicit verified app downloads, offline reload/edit/export, staged updates with save-before-reload, old-tab asset retention and optional storage persistence. App caches remain separate from saved projects; removal preserves IndexedDB data. Actual-host deployment and real-device eviction behavior remain outstanding.

The [measurement survey](MEASUREMENT_SURVEY.md) increment imports up to 500 raw RSSI observations with exact receiver positions and recorded source context. It compares compatible current RF predictions, reports predicted-minus-measured residuals, valid/excluded counts, bias, MAE and RMSE, and preserves raw observations through undo/autosave/export. Format 3 adds the optional survey; strict version 1/2 migrations preserve earlier inputs and libraries without fabricating observations. Fitting and independent site-accuracy claims remain deferred.

The [material and band editor](MATERIAL_AND_BAND_EDITOR.md) increment edits existing shared material names, provenance and exact acoustic/RF coefficient rows with notes. One validated Apply enters history; full-project payload validation precedes acceptance. Baseline and experiment profiles stay isolated. The frequency selector offers complete shared profiles and explains an incomplete current band without silently changing it. Geometry, absorption, solver formulas and project format remain unchanged.

The [placement explorer](PLACEMENT_EXPLORER.md) increment searches bounded positions in a dedicated cancellable worker, ranks valid estimates across all selected probes, shows tradeoffs and a numbered plan, and applies a chosen position as one undoable move. It keeps source height and other inputs fixed. Current balanced RF fields also provide a custom-threshold summary of valid sampled area and explicit exclusions; search and threshold state remain outside project data.

The [named experiments](NAMED_EXPERIMENTS.md) increment adds a per-home library of immutable scene/settings/guide snapshots with names and notes, duplication, metadata edits, complete changed-input descriptions, loading and named baseline selection. Operations join workspace history and validate the full project before acceptance. Project format 3 carries the library and optional survey; strict format 1 migration preserves existing inputs and starts with an empty library. Capture/export use committed inputs independently of field availability.

The [wall junction](WALL_JUNCTIONS.md) increment adds explicit interior splits and opted-in T/cross junctions for both drawn and numeric walls. Each operation expands all intersecting segments and remaps openings as one command/history edit. It preserves opening positions and existing count-once ray semantics; exterior cuts, cuts through openings, short segments and expanded wall counts above 256 are rejected before acceptance.

The [drafting feedback](DRAFTING_FEEDBACK.md) increment adds selected-wall lengths, optional visible-wall dimensions, grid/endpoint markers and a live pending-wall measurement in Edit home. Measurements retain full metric lengths through navigation and clipping; display changes remain outside history and project data. Drawing over an existing wall/zone places a drafting point, allowing exact endpoint joins through the validator. Label placement prioritizes draft/selected walls and culls crowded/offscreen labels.

The [plan navigation](PLAN_NAVIGATION.md) increment adds bounded zoom, cursor-anchored wheel zoom, Pan and Fit in both the workspace and Edit home. Drawing, selection, source/probe drags and metric rulers use the current camera transform. View state stays outside project inputs, autosave and history. Editor navigation preserves the first point of a pending wall; two-click wall creation now copies that endpoint before passing it to the command layer.

The [interactive loss breakdown](LOSS_BREAKDOWN.md) explains the selected probe with signed acoustic or RF terms and an exact reconstructed total. Selecting an assembly highlights its wall/opening and ray hit on the plan without changing scene inputs or history. Highlights clear on edits, probe/project changes and disclosure close; unavailable readings have no fabricated total. Open doors, disabled sound transmission and signed authored coefficients remain explicit.

Source/probe X/Y inputs now keep editable drafts through background redraws and save-status updates. Valid changes commit on change/blur; rejected or blank entries restore the last accepted coordinate. Regression checks force redraws while valid and blank drafts are active.

The four [implementation-review findings](../reports/REVIEW_2026-10-15.md) are resolved: input-only export works during calculation/worker failures, large homes choose a supported shared sampling step, empty-probe imports clear the inspector, and source controls use the solver's active emitter. Regression checks cover pending exports, preview exclusion, 80 m homes, 200 m imports with baseline/reload, both emitter orders, missing sources and domain switches.

Project persistence/import/restore, atomic undo/redo and worker coordination now live in focused composables. All accepted documents share one installation route, with regression coverage for startup restore/import ordering and teardown. Plan, cutaway and A/B rendering share palette, scale and unit definitions through a pure display module. Plan drawing and pointer interaction remain in the main component. See [current architecture](ARCHITECTURE.md#current-implementation--october-15-2026).

The authoring follow-up adds explicit wall defaults, atomic wall-property edits, keyboard calibration, strict blank-coordinate handling, distinct generated-door labels and correct nonrectangular outlines.

Bun 1.4.3 now manages the workspace with a frozen lockfile and CI commands. New home creation supports metric rectangles and local calibrated PNG/JPEG floor-plan tracing. A drafting editor adds validated walls, doors, zones and probes, numeric fallbacks, connected endpoint moves and command history. The local Homes library preserves separate project identities and names; optional reference images round-trip through autosave and JSON. See [manual testing](MANUAL_TESTING.md) for the full walkthrough and current limits.

## Working capabilities

- All canonical probes are visible and selectable on the plan. An exact [multi-probe readings panel](PROBE_READINGS.md) provides named point summaries, compatible same-coordinate baseline deltas and local CSV export. Probe renames are validated, undoable and persisted.

- Nuxt application with a shared metric building and separate pure TypeScript sound and RF quick models. Material coefficients remain explicitly illustrative assumptions.
- User-triggered calculation restart after worker startup/runtime/message failures. Retired request identities and preview state are invalidated; current scene, model settings, baseline inputs and history are preserved.
- Generated static CSP/hosting headers, same-origin request restrictions and preview route guards. Browser tests exercise worker and cutaway startup under that policy.
- Cancellable worker fields, exact probe estimates, actual doorway attenuation, frequency switching, source/probe movement, numeric and keyboard edits, undo/redo, and baseline difference maps. Valid source/probe drags request coalesced preview fields, starting at 0.5 m; release accepts one undoable edit and requests balanced sampling starting at 0.25 m. Large bounding boxes coarsen by doubling the cell size to fit the 100,000-cell limit, with a shared step for working/baseline fields and the actual step shown on screen. Preview state is kept out of project autosave and history; Escape and pointer cancellation restore the original scene and preserve redo. Both current modes sample the field at 1.5 m above the level floor, with absolute receiver Z retained in result metadata. The exact probe uses its independently editable height.
- Optional guided four-room home with live controlled door, RF placement/band, and off-path control experiments. Loading and applying examples are undoable workspace changes, preserving model settings and the prior baseline. Native Method/Explore dialogs, a focusable plan with instructions and fine/coarse arrow edits, skip-link return to plan, visible focus, and a compact scene-object selector provide keyboard workflows. The mobile picker retains native navigation and has an explicit focus-plan action. Phone headers wrap Method and project actions across rows; the plan ruler uses its actual fitted metric scale.
- Desktop split A/B maps and mobile A/B tabs share fixed absolute scales. Both snapshots are evaluated at the same selected probe coordinate, with dB deltas for acoustic and RF level differences. Physical object/setting changes are listed, and incompatible comparisons explain the mismatch rather than silently rescale.
- Existing doors can be selected and operated individually, including through the compact scene picker. Source and probe Z inputs edit meters above their level floor, with stable draft entries, validation, undo and persistence. Plan rendering includes every door/passage on each wall. Low-ceiling imports explain when the fixed map plane lies outside the modeled level. See [scene controls](SCENE_CONTROLS.md).
- Constrained interior-wall endpoint/thickness/material editing, measured splits and opted-in T/cross junctions. Split/junction commands preserve physical opening positions while remapping their wall-local spans; other edits retain existing relative-span semantics. Unsupported intersections and solid collisions reject, exterior envelope geometry remains protected, and shared endpoints cannot be disconnected individually. Closing an occupied doorway is rejected. Wall geometry is edited through numeric controls, not by dragging wall handles.
- IndexedDB autosave and restore, with saved/failed state and recovery notices. Version 3 `.cha-waves.json` export/import preserves scene, settings, material provenance, solver version, baseline inputs, up to 20 named experiments and an optional raw measurement survey; version 1/2 inputs migrate. Imported baselines regenerate arrays locally; invalid imports preserve the current workspace. Arrays are not embedded in ordinary project JSON.
- Optional, lazy-loaded architectural cutaway using Three.js WebGPURenderer. It uses the same field samples, masks, transfer bounds, and palettes as the plan. Runtime backend labels distinguish WebGPU from WebGL2 fallback. Initialization/context/device failures return to the plan when reported; the numerical CPU worker remains independent.
- The cutaway draws low walls for visibility (0.78 m displayed height), while physical scene wall heights remain unchanged. Markers can be selected in 3D; direct source/probe dragging is a plan interaction. Numeric controls remain available in both views.

The two-zone reference apartment remains the default regression and benchmark fixture. An optional four-room authored home adds guided sound and RF experiments; see [guided experiments](GUIDED_EXPERIMENTS.md). There is no unrestricted topology editor, RIR/reflection solver, calibration, multi-floor model, or wave-equation solver. Autosave is device-local. Offline reload is available after explicit installation; browser data can still be cleared or evicted.

## Stack and runtime

Bun 1.4.3 is pinned as the package manager and workspace script runner. Node 24.22.0 is pinned in `.nvmrc` and CI; local verification uses Node 24.15.0, accepted by the package engine range. Node remains the runtime for scripts that explicitly invoke `node`, including typechecks, fixture verification and benchmarks. Tooling: Nuxt 4.6.1, Vue 3.5.44, Vite 8.3.4, TypeScript 6.0.3 for Vue/compiler API consumers, TypeScript 7.0.2 for additional native package checks, Zod 4.6.7, Vitest 5.0.4, Playwright 1.64.1, and vue-tsc 3.3.13. `bun run test` invokes Vitest 5.0.4. Cutaway dependencies are Three.js 0.186.1 and declarations 0.186.0.

The build separates the Three renderer into an approximately **294.5 kB gzip** chunk, loaded for cutaway use. This is a build-size observation, not a runtime performance claim. The minified renderer exceeds Vite's default 500 kB warning threshold; it remains isolated rather than suppressing the warning.

## Milestone progress

| Milestone | Status | Remaining gates |
|---|---|---|
| M0 | Substantial implementation | Broader real-device renderer compatibility and documented reference-device budgets |
| M1 | Core numerical slice works | Invalid-placement affordance review and manual assistive-technology review |
| M2 | Core editing/persistence implemented | Broader migration variants and real-device storage behavior |
| M3 | Plan and cutaway available | Complete responsive and manual accessibility design review |
| M4 | Initial tests/CI configured | Broader browser/device matrix, real-network and pointer-to-display evidence, actual-host deployment verification, final notices/license decision and release review |

Selected P1 home authoring is now implemented; remaining P1/P2 work is deferred. No site accuracy, calibration improvement, or full P0 completion is claimed.

## Commands

```sh
bun run dev             # Local Nuxt development server
bun run typecheck       # TS6 + TS7 package checks and Vue SFC checks
bun run test            # Vitest: pure packages and frontend composable tests
bun run build           # Static output: apps/web/.output/public
bun run preview         # Dependency-free local static server on port 4173
bun run test:e2e        # Chromium against the generated output (build first)
PLAYWRIGHT_BROWSERS=chromium,webkit bun run test:e2e # Optional engine matrix
bun run verify:static-security # Verify generated hosting header hashes
bun run verify:offline # Verify versioned worker, asset digests and build metadata
bun run inventory:licenses # Refresh installed-dependency metadata
bun run verify:fixtures # Independent algebra and project round-trip checks
bun run benchmark       # Direct Node engine timing, writes reports
bun run benchmark:browser # Worker-to-Canvas timing; run bun run preview first
bun run benchmark:startup # Fresh-context navigation-to-first-draw timing; preview required
```

CI is configured for checks, static generation, and independent Chromium, Firefox, and WebKit integration jobs. It has not yet been run remotely. Fixture verification runs in CI. Benchmark scripts run separately so parallel tests do not distort the measurements.

## Verification evidence

- **236 unit tests passed**, including acoustic/RF identities, opening/height semantics, hashing, cancellation, immutable commands, material changes, concave floor boundaries, occupied-door rejection, project limits, baseline round trips, atomic history, shared display transfers, project installation races, additive loss reconstruction, metric viewport transforms, drafting geometry, atomic wall subdivision, format migration, experiment input differences, library/history operations, multi-probe placement objectives, valid-cell RF coverage, area overflow, stale-search apply guards, immutable material profiles, exact band coverage and full-project material rejection, strict survey CSV/escaping, source-context compatibility, residual metrics/exclusions and format 3 migration/history.
- **Strict typechecks and static generation passed.**
- **137 browser tests passed in each of Chromium and WebKit against the static build (274 total, October 15)**: existing interaction flows, wall edit/undo, local reload, fresh-context export/import with baseline regeneration, rejected import preservation, unavailable-storage recovery, cutaway view invariance, no-context plan fallback, bounded compact canvas sizing, desktop/mobile shared-scale A/B, RF dB differences, held-drag preview/refinement, invalid-to-valid placement recovery, cancellation preserving redo, guided home controls and history, local scenario reload, dialog keyboard behavior, named controls, compact object selection, automated accessibility scans, worker constructor/runtime/message-error recovery, storage v1 migration, blocked-upgrade cleanup, abort/quota preservation with export, static CSP/route checks, fine/coarse keyboard edits with undo, mobile focus-to-plan, skip-link return from cutaway, metric ruler resizing, 320/640/1280 CSS viewport reflow/dialog behavior, independent doors, height edits/undo/reload, invalid draft recovery across redraw, and elevated-floor/low-ceiling imports.
- Loss-breakdown browser checks verify sound/RF totals, door contributions, exact wall/opening/hit metadata, highlight clearing across inputs/probe/project changes, unchanged history, unavailable empty-probe states, and keyboard/selected-state automated accessibility at 320 CSS pixels.
- Navigation checks verify zoom limits, cursor anchoring, metric rulers, camera-only history/query/export preservation, pan cancellation and temporary gestures, physical drags after navigation, resize/project reset, two-click wall drafting after editor navigation, pending endpoint preservation and 320-pixel controls/accessibility.
- Drafting checks verify full metric wall lengths through zoom, optional dimensions without history/export changes, grid/endpoint cues, live draft lengths, exact off-grid endpoint commits, hover clearing with pending-start preservation and 320-pixel label/readout separation and automated accessibility.
- Junction checks verify numeric cross junctions, drawn T junctions, atomic undo/redo, saved export/reload, opening-preserving splits, rejected opening cuts and exterior splits, plus phone controls/accessibility. Pure checks also cover reversed/diagonal multiple intersections, global ID collisions, expanded wall limits, minimum-length rounding and unchanged sound/RF crossing results after subdivision.
- Experiment checks verify captured inputs and load/undo, duplication/notes/renaming, named baseline persistence, reload and fresh-context import, rejected duplicate-name drafts and invalid snapshots, version 1 migration, capture/export without a worker, and empty/populated dialog accessibility and focus at 320 pixels. Numerical fixture values and query hashes are unchanged; the canonical project round-trip digest now reflects format 3.
- Placement checks verify real-worker ranking, exact source-only apply with one history edit and undo/redo, cancellation with late replies, probe-selection invalidation, missing source/probe guards, inclusive RF thresholds, export invariance, visible probe choices and phone improvement text, Escape focus restoration and empty/populated dialog accessibility. Desktop and phone result screenshots were visually inspected.
- Material checks verify exact acoustic/RF coefficient deltas, one-edit apply/undo/redo, baseline and experiment isolation, note/provenance persistence, frozen inputs, invalid/oversized project rejection, conservative opening profiles, newly shared acoustic bands, explicit missing current data, rejected form drafts and phone accessibility/focus. Numerical fixtures and solver version remain unchanged; current project format 3 also carries the optional survey.
- Survey checks verify exact predictions and signed residuals, invalid/nonfinite exclusions, stable bias/MAE/RMSE, strict CSV grammar/limits and reversible spreadsheet escaping, matching source/band context, raw-data history and persistence, legacy migration, rejected drafts and phone/desktop dialog accessibility. Survey test values are authored fixtures, not a site-accuracy dataset. Numerical fixture values and field hashes remain unchanged; the format 3 round-trip digest is `e80b1cf12b5633ea96dd05db5b69e93fd42160c15a9f62b61966c86079e047be`.
- Offline checks verify explicit opt-in, full-cache readiness and response CSP, disconnected reload/edit/autosave/JSON export, field and placement workers, first lazy cutaway loading, verified repair, failed-update preservation, save-before-update failure recovery, waiting activation, old-tab asset fallback, and selective cache/registration removal with project preservation. Persistence grant/decline/unavailable outcomes and the 320-pixel Homes panel pass browser checks and Axe scans. Ten extra update/reload repetitions and ten editor split repetitions passed across the two engines. Desktop/phone controls were visually inspected. Build, security-header and offline-artifact verification passed; solver/project identities remain unchanged.
- The new home flows additionally verify rectangle dimensions, PNG calibration/reference export, separate project identities, rename/reopen/reload persistence, validated wall/door/probe creation, rejected intersections, geometry undo, and responsive dialog bounds/focus/automated contrast at 320 and 1280 CSS pixels.
- Native WebGPU was inspected in the desktop app, and WebGL2 fallback was exercised in Chromium tests. Firefox 157 fails before navigation on this host with `Could not find profile folder`, including after retrying a separate temporary directory. This is not the complete Safari/Firefox/Edge/device matrix.
- Native inspection found and corrected a narrow-layout canvas sizing feedback loop. Canvas layout is independent from drawing-buffer size, allocations are capped, and the model is framed from projected bounds. Renderer resources are reused across field changes and disposed on teardown.

[Keyboard/layout review](KEYBOARD_AND_LAYOUT_REVIEW.md) records focus workflows, ruler corrections, viewport sizes and the limits of the zoom proxy.

[Static deployment and recovery](STATIC_DEPLOYMENT_AND_RECOVERY.md) describes generated security headers and failure recovery. [Asset/dependency inventory](ASSET_AND_DEPENDENCY_INVENTORY.md) records provenance and outstanding release decisions. No host has been deployed.

[Browser and accessibility verification](../reports/BROWSER_ACCESSIBILITY_CHECKS.md) records engine versions, scan states, reproduction, and limitations. Axe WCAG 2.1 A/AA scans report no violations in the tested workspace and dialogs; manual accessibility review remains outstanding.

[Performance evidence](PERFORMANCE_EVIDENCE.md) separates direct engine, worker-to-Canvas, and fresh-context startup scopes. The recorded local startup run (identified by its build hash) used 20 fresh browser contexts: median 108.3 ms and p95 125.9 ms from navigation to the first accepted balanced Canvas draw, with no startup JavaScript errors. This does not establish cold-network or physical-display latency. Local field diagnostics are visible in DOM attributes and emit an in-page event for the optional benchmark harness; nothing is uploaded.

[Screenshot: plan](../reports/screenshots/workspace.png), [difference](../reports/screenshots/difference.png), [cutaway](../reports/screenshots/cutaway.png), [A/B comparison](../reports/screenshots/comparison.png), [guided home](../reports/screenshots/guided-home.png), [guided cutaway](../reports/screenshots/guided-cutaway.png).

There is no complete cold-network/compositor/pointer-to-display latency study, site validation, full accessibility audit, or P0 release-gate verification yet. The recorded browser timing is explicitly narrower than those goals.
