# Plan navigation · October 15, 2026

The workspace plan and **Edit home** drafting canvas have local pan, zoom and fit controls. These change the view without changing the physical scene or its numerical settings.

| Control | Behavior |
|---|---|
| **+ / −** | Zoom in or out, from 50% to 800% of the fitted home view |
| **Fit** | Center the home and return to 100% fitted zoom |
| **Pan** | Drag the view, including from over a source, probe or wall, without editing that object |
| Mouse wheel | Zoom around the world point under the cursor |

The percentage is relative to the current canvas size, not a physical drawing scale. The metric ruler reflects the current projection. Its labelled length changes when necessary to keep the ruler readable at very small or large scales. Resizing preserves the view's metric center and relative zoom.

## Keyboard and pointer behavior

Focus the plan to use **+ / −** for zoom and **0** for Fit. With Pan selected, arrow keys move the drawing by 40 CSS pixels; Shift increases the step to 80. In the main plan's Select mode, arrows retain the existing 0.1 m and Shift+arrow 0.5 m object edits. Native form controls retain their usual keys. Browser zoom shortcuts are left available.

In the workspace plan, hold Space or use the middle mouse button to pan temporarily. Escape, pointer cancellation or lost capture restores the view at the start of an active pan. Releasing a completed pan keeps its new view. A view change never adds an undo entry, invalidates redo or requests a numerical field calculation.

The main plan and editor use independent camera state. Ordinary scene edits retain the current view. Installing another project resets the workspace plan to Fit. View state is not included in project JSON or autosave.

## Drawing and model coordinates

The plan renderer and pointer hit-testing use a shared metric-to-screen transform. Floor-plan references, sampled fields, walls, sources, probes and exact loss-breakdown highlights move together. Source/probe drags still commit metric coordinates, with the same validation and one-command history behavior after navigation.

In Edit home, zoom and pan preserve a partially drawn wall's first endpoint. Navigating does not add an endpoint or select an assembly. Subsequent drafting clicks map through the current camera before the existing grid/endpoint snapping and geometry validation run.

Subsequent increments add [drafting measurements and snap cues](DRAFTING_FEEDBACK.md) using the same camera, plus validated [interior wall splits and junctions](WALL_JUNCTIONS.md). Pinch gestures and unrestricted topology editing remain follow-ups. Single-pointer Pan and explicit zoom controls provide the phone workflow. Multi-device touch and manual assistive-technology validation remain release follow-ups.

## Verification

Pure transform checks cover inverse mapping, the original fitted scale, nonzero bounds, cursor anchoring, pan direction, zoom bounds, resize behavior and hidden dimensions. Browser checks exercise camera-only navigation, field identity/history preservation, pan cancellation, temporary pan gestures, source/probe edits after navigation, editor drafting, project reset, metric rulers and phone-width controls/accessibility. See [implementation status](IMPLEMENTATION_STATUS.md) for the final counts and verification limits.

[Workspace example](../reports/screenshots/plan-navigation.png) · [Phone layout](../reports/screenshots/plan-navigation-mobile.png) · [Editor](../reports/screenshots/editor-navigation.png) · [Phone editor](../reports/screenshots/editor-navigation-mobile.png)
