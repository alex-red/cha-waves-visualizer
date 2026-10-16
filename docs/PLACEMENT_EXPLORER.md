# Placement explorer · October 15, 2026

Choose **Find source placement** in the measurement inspector to compare local source positions using the current scene and model. The search runs in a separate browser worker and needs no service or account.

## Compare positions

Choose **Improve weakest selected probe** to maximize the lowest reading, or **Reduce loudest selected probe** to minimize the highest reading. Wi-Fi starts with the first goal; Sound starts with the second. Select the probes that matter to this study. Each probe is evaluated at its authored X, Y and height, independently of the field map's receiver plane.

Choose a budget of 64, 144 or 256 positions and press **Find positions**. The budget includes the current source position and an aspect-aware grid across its level's bounding rectangle. The actual count can be lower than the budget. Positions outside a concave floor, inside solid geometry or outside the modeled height are excluded. A position also needs a finite, valid estimate at **every selected probe** to be ranked; an invalid reading never becomes zero or disappears from the objective.

The explorer shows up to five best sampled positions, a numbered plan preview, movement distance and each probe's before/after reading. Scores use dB for relative direct sound and dBm for RF received power; improvements are differences in dB. A delta is shown only when the current-position baseline is valid for all selected probes. The summary separates geometry exclusions from positions with incomplete estimates and reports actual grid spacing.

Only the active source in the current domain moves, in X/Y. Height, power, frequency, materials, other emitters and probes stay fixed during the study. The current position participates when valid, so the best sampled objective is at least as good as that baseline. This is a bounded grid comparison; it does not establish a global optimum or physical accuracy.

## Apply or cancel

**Apply position** validates the chosen position through the existing scene command and creates one undoable move. The dialog closes and the field regenerates. **Undo/Redo** restores the source position; saved baselines and named experiments remain available. Wait for saved status before reloading, or export the project to carry the applied position elsewhere.

Searching, selecting probes, changing the goal or threshold, and inspecting results do not change scene history or project JSON. Search state is temporary. A scene, probe, settings or search-control change invalidates old results. Cancellation, dialog closure during a run, project replacement and teardown terminate the worker; late replies cannot become applicable results. A failed search can be retried with **Find positions**. Empty probe lists and missing active sources have explicit unavailable controls.

## Inspect current RF coverage

In Wi-Fi mode, **RF coverage threshold** summarizes the current balanced field at its map receiver height. Enter any finite dBm threshold; the default is −67 dBm. The summary counts valid cells **at or above** the threshold, valid cells overall, excluded cells and exclusion reasons. Percentages divide by valid sampled cells; an entirely invalid field has an unavailable percentage.

Areas are approximate sampled-grid areas: cell count × cell size². They are not exact floor-polygon areas, especially along boundaries. This summary describes the current scene, rather than each hypothetical candidate; it is unavailable during a missing or pending balanced field. It does not measure throughput, service quality or observed coverage. A blank or invalid threshold requests a finite number instead of showing a fabricated result.

The existing model limits still apply: direct-path sound omits reflections/diffraction, and RF uses free-space path loss plus authored assembly losses without multipath or antenna patterns. Coefficients remain illustrative assumptions.

## Verification

Pure checks compare multi-probe candidate readings with independent point evaluations, test both min/max objectives, deterministic bounded sampling, invalid readings, height/input preservation and cancellation. Worker-state tests cover stale inputs, retries, disposal and apply guards. Browser checks cover real search workers, one-edit apply/undo/redo, coverage thresholds, phone layout and automated dialog accessibility. See [implementation status](IMPLEMENTATION_STATUS.md) for final counts and remaining manual checks.

[Desktop controls](../reports/screenshots/placement-explorer-desktop.png) · [Desktop results](../reports/screenshots/placement-explorer-desktop-results.png) · [Phone results](../reports/screenshots/placement-explorer-phone.png)
