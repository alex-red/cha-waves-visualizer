# Design direction — the living atlas

A finely made architectural study model resting on an editorial drafting surface. Warm plaster walls, pale timber details, precise graphite annotations, and luminous fields create an instrument someone wants to touch. The building occupies the composition; controls feel like small tools arranged around it.

The signature image is a cutaway apartment crossed by a translucent field, with one source and one probe connected by a clean explanatory path. Door and wall changes stay visually readable. Furniture is sparse, visual-only, and absent from physical interpretation unless explicitly modeled.

## Visual tokens

These are proposed starting tokens, to be refined against actual contrast and field legibility.

| Token | Value | Role |
|---|---|---|
| paper | `#F3EFE7` | Warm drafting surface |
| surface | `#FFFCF6` | Tool surfaces |
| ink | `#18292B` | Main text, structural outlines |
| secondary ink | `#526261` | Supporting text |
| plaster | `#D9D1C3` | Wall bodies |
| timber | `#B89570` | Sparse architectural detail |
| sound accent | `#AE4C23` | Sound selection and source marker |
| radio accent | `#096C77` | Wi-Fi selection and source marker |
| focus | `#174FB6` | Independent keyboard focus, never a data value |

Use a 4 px spacing unit with 8/12/16/24/32/48/64 px steps. Control height 36–40 px desktop, at least 44 px touch. Panel radius 12 px, control radius 6 px; avoid rounding everything into pills. Panels use faint borders and one soft elevation, not layered glass blur. Distinguish selection by border, label, and shape, not color alone.

Typography candidates: **Fraunces** for short editorial headings, **Public Sans** for controls/body, **IBM Plex Mono** for values and units. Self-host licensed subsets after license/weight review. Use 28–44 px hero headings, 15–16 px body, 13–14 px controls, and tabular 13–16 px measurements. Keep mobile inputs at 16 px where needed to prevent viewport zoom. Avoid a decorative typeface for technical labels.

## Fields and architectural rendering

Use perceptually ordered, colorblind-tested absolute palettes: a warm sequential family for sound and a blue/teal sequential family for radio, each with documented luminance progression. Proposed brand accents are not the palette specification; validate the actual sampled transfer functions. Signed differences use a blue–neutral–orange diverging scale centered on zero. High-contrast alternatives include contours, labels, and hatched invalid areas.

The floor receives field color; wall tops retain structural legibility. Keep measurement textures independent from lighting/tone mapping that would distort the legend. A 2D legend and data layer must correspond to the same transfer function; compare values by numbers rather than lit wall colors. Invalid cells are visibly masked, never colorized as low values. Display smoothing cannot bridge a wall or make an invalid sample look valid.

Use an orthographic camera with restrained elevation, ambient fill, one soft shadow, and understated edge lines. Render demand-driven; cap device pixel ratio and quality based on measured load. Low wall cutaway height is a display setting only: a 0.7 m rendered wall can still represent a 2.7 m physical wall. Show this distinction in the method panel. No bloom is necessary for P0.

Never draw phase fronts, waves bending around corners, or interference patterns from the direct solver. Optional source pulses are labeled illustrative and disabled by reduced motion; prefer computed contours and the selected path as the default field animation.

## Workspace composition

```text
┌ Cha Waves   Apartment study    Undo / Redo        Save / Export ┐
│                                                              │
│ Sound | Wi-Fi       Architectural cutaway       Selected probe│
│                     fills the working area     relative dB   │
│ Select              (sparse room labels)        distance / ms │
│ Source                                         wall terms    │
│ Probe                source ───────── probe     assumptions  │
│ Wall                                                         │
│ Door                 Plan / Cutaway / Paths                   │
│                                                              │
│ Computed approximation      quantity + legend     Refining…  │
│ Baseline A      Working B      Split / Difference              │
└──────────────────────────────────────────────────────────────┘
```

At ≥1200 px: 56 px header, 220 px left tools, flexible viewport, 300 px inspector. The first demo begins with compact controls, not both expanded sidebars. At 800–1199 px: one 280 px contextual panel at a time. Below 800 px: plan view, compact toolbar, single bottom inspector; A/B toggles keep the same scale, with a dedicated delta view instead of tiny split canvases. Test narrow landscape and browser zoom as well as device widths.

## Interaction specification

| Action | Behavior and feedback |
|---|---|
| Select | Distinct outline and scene-tree selection; inspector names object |
| Drag source/probe | Pointer capture; metric projection; invalid positions show ghost and reason; commit one undoable command on release |
| Escape during drag | Restore pre-drag position; discard preview; field request returns to matching input |
| Numeric edit | Units next to fields; bounds and inline validation; enter commits, escape cancels |
| Keyboard move | Arrows nudge in plan coordinates; Shift increases step; editable numeric fields remain available |
| Door toggle | Physical open/closed command; visual leaf swings briefly if motion allowed; no intermediate physics claim |
| Wall edit | Plan mode handles; preserve wall-local openings; reject invalid topology before committing |
| Probe inspection | Exact selected-point calculation; distinguish it from nearest grid cell |
| Save baseline | Name immutable A; continue editing B; show changed object list |
| Compare | Lock common absolute legend; synchronize camera; delta reads “B − A, dB” |
| Mode switch | Preserve home and history; switch active emitter, units, receiver plane, and result identity |

Snapping uses screen-space thresholds with metric output. On touch, one finger selects/drags an object and two fingers pan/zoom; no hover-only actions. A scene tree provides every canvas action in ordinary controls. Wall editing defaults to plan view but preserves the same canonical scene.

## Essential states and copy

- Initializing: visible architecture and tools, with “Calculating sound field…”; recorded previews explicitly say “Recorded computation.”
- Preview: “Preview · refining after release”; stale values say “Previous result” and are visually subdued.
- Ready: quantity, unit, computation model, and provenance summary remain near the legend.
- Invalid location: “This point is inside a wall. Move it into the room.”
- Missing material: “No radio loss is set for this assembly at 5 GHz. Choose or enter an assumption.”
- Storage unavailable: “Changes are in this tab. Export a project to keep them.”
- Compare mismatch: list mismatched settings and offer matching recomputation; never silently subtract.
- Recovery: preserve editing and history, return to plan view when cutaway cannot initialize.

The probe explanation is computed from terms, not authored after-state copy. Suggested pattern: “The direct path crosses one closed door. The model applies your assumed door penalty.” Show numbers from the result, with full parameter precision available separately. Approximate outputs display restrained decimal precision, not false confidence.

## Motion, accessibility, and review

Use 120–180 ms control transitions and 200–300 ms intentional panel changes. Do not animate the camera constantly. Optional field crossfades are visual transitions between accepted numeric results; the inspector reports only the accepted result. Disable them and decorative pulses under reduced motion. Audio is muted until a deliberate gesture, with persistent stop control.

Target WCAG 2.2 AA; verify text/control contrast, visible focus, keyboard order, zoom/reflow, and usable alternatives for drag. Maintain a polite, throttled live summary after committed edits, not every pointer event. Ensure charts have numeric tables and that the method panel can be understood without hearing audio.

Design review includes 1440 × 900, 1280 × 800, 390 × 844, 200% zoom, high contrast, color-vision simulation, reduced motion, keyboard-only, and actual screen-reader use. Review both absolute and delta palettes against the rendered home. The initial plan-view implementation is available; see [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md). The cutaway and full design-review matrix remain future work.
