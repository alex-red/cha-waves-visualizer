# Interactive loss breakdown · October 15, 2026

Open **Why this reading** in the measurement inspector to see the signed contributions to the selected probe's exact estimate. The total uses the point solver, independently of the field raster. It describes the current source, frequency, geometry and configured material assumptions.

| Mode | Additive budget | Total unit |
|---|---|---|
| Sound | 0 dB reference level, geometric distance term, then each crossed assembly's negative transmission coefficient | dB relative to the configured reference distance |
| Wi-Fi | Transmitter EIRP, receiver antenna gain, negative free-space path loss, each crossed assembly's negative loss, then negative configured other loss | dBm received power |

Distance loss is `-20 log10(distance / reference distance)` for sound. The radio distance term is `-20 log10(4π × distance × frequency / 299792458)`. Crossing terms retain the exact solver hit coordinates and selected assembly material. Open doors and passages remain visible with a zero contribution; sound transmission disabled also produces explicit zero assembly contributions. A negative authored coefficient appears as its algebraic positive contribution, with the configured sign explained.

Rows show one decimal place. Unrounded contributions must reconstruct the exact result within **1e-9 dB**; otherwise the budget is unavailable. This is a software consistency tolerance, not a claim about physical accuracy. There is no balancing term added to force agreement. The helper rejects invalid results, mismatched physical scene/settings identities, missing parameters and malformed crossing details. The point identity excludes receiver coordinates; the app reevaluates the selected point directly whenever it changes.

## Highlighting a crossing

Select a crossed assembly's row to return to the plan and highlight its wall, opening span when present, and exact ray hit. The expanded row reports absolute X/Y/Z in metres. This selection changes only the view; it does not edit the scene, add undo history or enter project JSON.

Select the row again, choose **Clear highlight**, or close the breakdown to remove the highlight. Changing scene inputs, domain/settings, selected probe, drag preview or project also clears it. The breakdown remains an exact point explanation when the map is showing a baseline difference; its total is the current probe estimate, not the map delta.

The native disclosure and crossing buttons support keyboard activation and visible focus. The panel wraps within a 320 CSS-pixel viewport. Invalid or absent probes/sources display an unavailable explanation without a fabricated total.

## Verification and scope

Unit checks cover acoustic reference distance, RF power/gain/other-loss terms, multiple crossings, open/closed doors, signed coefficients, disabled transmission and unavailable results. Browser checks cover totals, door changes, exact highlight metadata, clearing, history preservation, project replacement, keyboard operation and a selected-state accessibility scan at 320 pixels.

The models remain direct-path approximations with configured assumptions. This feature adds no reflections, diffraction, multipath, measured calibration or physical accuracy claims. The [implementation status](IMPLEMENTATION_STATUS.md) records the current verification matrix and remaining release gates.

[Desktop example](../reports/screenshots/loss-breakdown.png) · [Phone-width panel](../reports/screenshots/loss-breakdown-mobile.png)
