# Browser and accessibility verification

Verified October 15, 2026 on macOS 27.0.1 (26A434), Node 24.15.0, Playwright 1.64.1 and axe-core Playwright integration 4.13.0 against the generated static site.

| Engine | Evidence |
|---|---|
| Chromium 156.0.8078.4 / Playwright 1248 | All 137 browser cases passed |
| WebKit 27.2 / Playwright 2370 | All 137 browser cases passed |
| Firefox 157.0 / Playwright 1555 | Unverified: browser process exits before navigation with `Could not find profile folder` |

The final combined Chromium/WebKit run passed all **274 cases** against the generated static build with its deployment CSP enforced. The suite covers worker startup/runtime/message-error recovery, storage migration/abort/quota/blocked-upgrade behavior, static routes/headers, keyboard edits and undo, mobile focus-plan, skip-link return from cutaway, metric rulers, 320/640/1280 CSS viewport reflow, individual doors, height edits, draft preservation across redraws, elevated-floor/low-ceiling imports, project/export consistency, named-probe readings, loss explanations and plan/editor navigation.

Offline workspace checks cover explicit registration, complete-cache status, cached response CSP, disconnected edits/reload/export, field and placement workers, initial lazy cutaway loading, active-worker cache repair, failed integrity downloads preserving the previous build, save failure blocking activation/reload, explicit waiting updates, stale old-tab assets and unrelated cache/registration preservation. Persistence grant/decline/unavailable states are exercised with controlled browser API fixtures. The Homes panel fits 320 CSS pixels, passes Axe WCAG 2.1 A/AA scans and restores keyboard focus on Escape. Desktop and phone [screenshots](../docs/OFFLINE_WORKSPACE.md) were visually inspected. Ten extra update/reload checks and ten editor split checks passed; the editor now waits for the measured camera scale before projecting test clicks. The final combined run passed all 274 cases.

The latest drafting checks verify full wall lengths, camera/history/export invariance, grid and exact endpoint snaps, live draft measurements, hover/Pan behavior, and phone label/readout separation. Axe reports no violations for the dimensions control and snap readout at 320 CSS pixels. Desktop and phone [screenshots](../docs/DRAFTING_FEEDBACK.md) were visually inspected.

Interior junction checks cover numeric cross junctions, drawn T junctions, atomic undo/redo, saved reload, opening remapping and rejected cuts. The native join checkbox and split distance input pass focused Axe scans at 320 CSS pixels; split controls stay within that width. Desktop and phone [junction screenshots](../docs/WALL_JUNCTIONS.md) were visually inspected.

Named-experiment checks cover load/undo, source change descriptions, notes and duplication, named baselines, saved reload and fresh-context import, rejected names/snapshots, version 1 migration and capture/export without a worker. Empty and populated native dialogs pass WCAG 2.0/2.1 A/AA Axe scans at 320 CSS pixels; Escape returns focus to the trigger. Desktop and phone [library screenshots](../docs/NAMED_EXPERIMENTS.md) were visually inspected.

Placement checks cover real worker ranking and source-only apply/undo/redo, cancellation with released late replies, selected-probe invalidation, empty-source/probe guards, inclusive RF threshold counts and export invariance. Probe controls and improvement text fit their containers; empty and populated dialogs pass focused Axe scans at 320 CSS pixels. Escape restores trigger focus. Desktop and phone [placement screenshots](../docs/PLACEMENT_EXPLORER.md) were visually inspected. The junction import helper now waits for the new project identity, rather than a zero-probe/saved state already true before import.

Material checks cover exact acoustic/RF coefficient changes, one-edit undo/redo, baseline preservation, saved reload and import/export, authored provenance/notes, rejected drafts, newly complete shared bands, missing current profiles and stale-placement invalidation. Populated and empty-profile dialogs pass focused Axe scans at 320 CSS pixels; Escape restores focus. Desktop and phone [material screenshots](../docs/MATERIAL_AND_BAND_EDITOR.md) were visually inspected.

Survey checks cover CSV import/removal history, exact residuals and excluded locations, source/band incompatibility and restoration, compatible door changes, malformed/mixed-context rejection, raw/template downloads and version 3 persistence with version 2 migration. Empty and populated dialogs pass focused Axe scans at 320 and 1280 CSS pixels; Escape returns focus and the observation table scrolls inside the dialog. Desktop and phone [survey screenshots](../docs/MEASUREMENT_SURVEY.md) were visually inspected. The wall-test coordinate helper now uses the rendered SVG screen transform; the previously intermittent exterior-split check passed five repeats in each engine.

## Accessibility scope

Axe scans with WCAG 2.0/2.1 A and AA tags reported no violations in the tested desktop workspace, open Method dialog, open guided study dialog, and compact workspace with its object picker. Keyboard tests verify dialog autofocus, Escape closure, and focus return. Tests also cover control names, a labeled canvas, and human-readable compact object selection.

Corrections include darker metadata text, page title and language, a labeled file input, native modal dialogs, persistent accessible names for compact tools, visible focus outlines, and a compact scene-object selector. Numeric coordinate editing supplies a keyboard alternative to pointer dragging.

Automated scans do not establish complete WCAG conformance. Screen-reader use, zoom/reflow beyond the tested layouts, touch targets, contrast of arbitrary user content, and assistive-technology/device combinations still need manual review. WebKit tests are engine checks, not a complete Safari or iOS device certification.

## Scene and guided scenario checks

Browser tests load the authored four-room home without replacing the default reference fixture automatically. They verify the 7 dB assumed acoustic door effect, the unchanged off-path control, RF frequency changes, undo/redo across scene/model changes, restoration of a previous baseline, local reload, and numerical invariance when entering the cutaway. The pure scenario package also checks valid probe readings and finite field samples for all authored states. Additional browser flows operate individual doors, edit both source and probe height, restore history and local state, preserve invalid drafts across unrelated redraws, and verify elevated-floor and low-ceiling receiver-plane behavior.

The WebKit storage tests wait for the committed numeric change before checking saved status. Their unavailable-storage simulation overrides `IDBFactory.prototype.open`, which consistently covers factory instances in both engines.

## Reproduction

```sh
bun install --frozen-lockfile
bun x playwright install chromium firefox webkit
bun run build
PLAYWRIGHT_BROWSERS=chromium,webkit bun run test:e2e -- --workers=4
# Optional, once Firefox launches successfully on the host:
PLAYWRIGHT_BROWSERS=firefox bun run test:e2e
```

Chromium remains the default for `bun run test:e2e`. CI configures independent Chromium, Firefox, and WebKit Linux jobs. Remote CI has not yet run. Generated hosting-header verification also runs in CI. A retry using `/private/tmp` for local Firefox profiles produced the same launch error; the report does not count failed launches as application test results.
