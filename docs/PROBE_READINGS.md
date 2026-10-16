# Multi-probe readings · October 15, 2026

All probes are now drawn on the main plan. The selected point keeps its name; other points have compact P-number labels. Click a point, use the scene-object picker, or open **All readings** in the measurement inspector to locate a point and focus the keyboard-editable plan. Selection alone does not move a probe or add history.

The readings panel evaluates every canonical probe directly with `evaluatePoint`. It does not interpolate the field map, wait for the raster worker, or reuse stale sampled values. The panel is mounted only while open, so closed-panel summaries add no point-evaluation work during drags. Preview drag positions are not exported.

Each row includes the probe name and ID, floor, world X/Y/Z in metres, height above its floor, exact value and unit. Sound uses relative direct level in dB; radio uses received power in dBm. These are model estimates using the configured assumptions, not measurements collected from the building.

## Baseline interpretation

When a baseline exists, both scenes are evaluated at each **current** probe's absolute XYZ coordinate. Delta is current minus baseline, in dB for both modes. All solver settings must match, including domain, frequency and reference parameters. A mismatch or invalid point produces an explanation and no fabricated zero. The baseline's original probe placement does not substitute for the current coordinate.

## Naming and history

Select a probe in **Edit home** to apply a name of 1–80 trimmed characters. Empty or overlong names are rejected before changing the scene. Accepted names participate in undo/redo and project autosave/import/export. Renaming does not change the physical position or solver parameters.

## CSV export

**Export CSV** downloads the current exact readings locally. Columns include probe and level IDs, names, absolute XYZ in metres, physical domain, frequency in Hz, quantity, value/unit, validity and reason, source distance and travel time when available, crossing/assumption JSON, baseline value/unit/reason and `delta_current_minus_baseline_db`.

Unavailable numerical values are empty cells. Negative numerical estimates remain numeric. Every CSV cell is quoted and embedded quotes are escaped; formula-like user-controlled labels receive an apostrophe prefix for spreadsheet safety. No file is uploaded.

## Manual checks

1. Add two probes in different rooms. Close Edit home and verify both are visible and selectable on the plan.
2. Open All readings. Locate the second point and confirm the plan receives focus and numeric XY stays unchanged.
3. Rename a probe, then Undo/Redo and refresh; its name and position should survive the appropriate state changes.
4. Save a baseline and open a door crossed by only one probe's direct path. That point should show the configured door loss as a delta; an off-path point should remain unchanged.
5. Switch physical domains or frequency. Expect an explicit baseline mismatch rather than a delta across incompatible quantities.
6. Export CSV and check the band, units, negative numeric values, coordinates and assumptions. The numbers should agree with the exact inspector.
7. Check the dialog at phone width, navigate with the keyboard, use Escape to return to its trigger, and use Locate to return to the plan.
