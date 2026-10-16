# Drafting dimensions and snapping · October 15, 2026

**Edit home** now shows metric wall measurements and previews the point that the wall tool will snap to. These cues use authored geometry and the editor camera; displaying them does not change the scene, history or calculation.

## Wall measurements

Select a wall to see its length on the plan. **Show wall dimensions** adds measurements for other visible walls. Labels show the full endpoint-to-endpoint length in metres, rounded to two decimals, including on diagonal walls. Zooming or panning changes their placement, while the physical length stays the same. A partially visible wall retains its full length; clipping does not create new measurement endpoints.

Labels and ticks keep their screen size while navigating. Draft and selected walls receive priority. Labels avoid one another and the reserved control/readout bands; offscreen or crowded labels can be omitted, with a maximum of 32 at once. Use the selected-wall inspector and numeric coordinates when the view cannot accommodate a label.

## Snapping and the pending wall

Choose **Draw a wall** and move over the plan:

| Cue | Meaning |
|---|---|
| Teal circle and **Grid** readout | The point rounds to the selected grid spacing: 0.10, 0.25, 0.50 or 1.00 m |
| Clay square and **Endpoint** readout | The point joins an existing wall endpoint within 0.25 m; the readout identifies the wall and endpoint |
| Dashed wall and clay measurement | After the first click, the proposed second point and resulting full wall length |

Endpoint snapping takes priority over the grid, including when the endpoint is off-grid. Clicking over an existing wall or zone while the wall tool is active places a drafting point. Geometry commands still validate the proposed wall before accepting it as one undoable edit.

Moving off the canvas hides the hover cue and pending preview. Pan, zoom and Fit clear the old hover cue, while preserving the pending wall's first metric point. Move over the canvas again to preview from the current camera. **Finish drawing** clears the unfinished wall.

The snap kind and endpoint target have a polite screen-reader announcement that does not repeat changing coordinates on every pointer move. The visible readout supplies exact snapped X/Y coordinates. **Enter wall coordinates** remains the keyboard and precise numeric authoring alternative.

## Boundaries and verification

The existing endpoint-first snapping policy is preserved. The subsequent [wall junction](WALL_JUNCTIONS.md) increment adds explicit interior splitting and opted-in T/cross junctions through validated commands. Dimensions and hover state remain local editor UI state and are excluded from project JSON and autosave.

Pure checks cover endpoint precedence and ties, grid rounding, physical lengths under projection, safe label bounds, collisions, clipped walls and invalid projections. Chromium and WebKit checks cover selected/toggled dimensions, history/export preservation, live draft measurements, exact endpoint commits, hover clearing, Pan preservation, and the 320-pixel controls/readout. The phone check also verifies that measurement labels do not overlap the wall-tool readout. Automated accessibility checks do not replace manual screen-reader and real-device testing. See [implementation status](IMPLEMENTATION_STATUS.md) for final suite counts.

[Desktop example](../reports/screenshots/drafting-feedback.png) · [Phone layout](../reports/screenshots/drafting-feedback-mobile.png) · [Navigation controls](PLAN_NAVIGATION.md)
