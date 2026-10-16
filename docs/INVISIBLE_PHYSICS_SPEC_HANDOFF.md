# Invisible Physics

**Product, numerical-methods, UX, and engineering specification / implementation handoff**  
**Version:** 1.0 — implementation proposal  
**Prepared:** 2026-10-14  
**Status:** Ready for planning; all proposed performance and accuracy targets require measurement  
**Project type:** Open-source, local-first interactive building-physics laboratory  
**Working tagline:** *See what walls hide.*  
**Alternate names:** Fieldhouse, The Invisible Building, Inside the Field  
**Signature experience:** *Move a speaker or Wi-Fi access point inside a cutaway building and watch an evidence-linked physical field change—then compare the result against a controlled alternative.*

> **One-sentence brief:** Build an exceptionally polished browser application that turns a small, editable building into an instrument for exploring invisible physical phenomena, initially sound and Wi-Fi propagation, with explainable approximations, reproducible A/B scenarios, measurements, and a clear distinction between computed predictions and visual illustration.

---

## 0. How to use this handoff

This is intended to be directly actionable by an engineering team or autonomous coding agent. It provides:

1. Product strategy, differentiation, and first-impression experience.
2. Explicit scope, feature priorities, interaction flows, and UI states.
3. Canonical geometry, materials, units, and solver contracts.
4. Acoustic and RF mathematical models, accuracy boundaries, and validation cases.
5. Rendering, worker, audio, persistence, security, and deployment architecture.
6. Typed schemas, representative fixtures, APIs, test plans, tickets, and release gates.
7. A copying-ready implementation kickoff instruction.

**Normative terms:** **MUST** = required; **SHOULD** = preferred; **MAY** = optional. `P0` = impressive, honest, self-contained portfolio release; `P1` = useful experimental tool with calibration; `P2` = advanced numerical/research extensions.

**Physical-truth rule:** A convincing animated heatmap is not evidence of a physically accurate simulation. Each result MUST identify its solver, parameter provenance, supported dimensionality, units, omitted phenomena, and uncertainty level. Never call an artistic field animation “measured,” “physically exact,” or “full-wave” unless it genuinely is.

**Product rule:** The first meaningful interaction must work without an account, AI provider, server-side compute, GPU requirement, or uploaded floor plan.

**Implementation rule:** A shared geometry model is a foundational requirement. Acoustic mode and RF mode are **separate physics solvers** consuming one scene, not a single fictional universal force formula.

**Research rule:** Claims of higher accuracy, novelty, or superior performance require published test configurations, baselines, evidence, and reproducible analysis. This document proposes experiments, not experimental results.

---

## 1. Executive summary

### 1.1 The problem

A building's most consequential behavior is difficult to see. A person can see a wall, a door, and a speaker, but cannot directly see why one chair receives little direct sound, why a hallway changes the route of sound, or why a Wi-Fi access point performs badly behind a heavy wall.

Existing tools tend to specialize in one domain, demand domain expertise, or present attractive coverage maps without explaining the mechanisms and assumptions behind them. There is also a gap between a visually impressive ray/heatmap demo and an instrument that supports defensible comparison, calibration, and validation.

### 1.2 The product promise

Open the site and immediately see a compact, isometric apartment with a living room, corridor, study, two doors, a speaker, and a Wi-Fi access point. A glowing overlay makes a selected phenomenon visible. Drag the speaker; the acoustic map recomputes. Close a doorway; the route and attenuation change. Switch to Wi-Fi; place the access point on the other side of a masonry wall, then see the change in predicted received power.

One click switches into **Compare**: baseline on the left, edited branch on the right. An honest difference map and an inspector explain what changed, the dominant factors, and whether the model has empirical calibration.

The user should learn something about space and physics **in under a minute** while a specialist can inspect the equations, unit tests, fixtures, and assumptions.

### 1.3 Positioning

**Not:** generic 3D floor-plan editor; Wi-Fi enterprise site-survey replacement; architectural acoustic certification; room-tuning substitute; another WebGPU particle effect; AI-generated photorealistic building.

**Is:** an **explainable, multi-physics scenario sandbox** built around one editable, metric-scale environment, transparent solver abstractions, measurement comparison, and delightful direct manipulation.

### 1.4 Why this belongs in a standout software portfolio

A finished project demonstrates much more than component assembly:

- Computational geometry, topology, segment intersection, polygon constraints, and metric coordinate transforms.
- Numerical modeling, algorithm selection, error analysis, and measurement validation.
- Responsive client-side computation with workers, caching, adaptive sampling, and GPU acceleration when justified.
- Real-time audio and signal processing, plus realistic limitations of browser hardware.
- Strong interactive information design: fields, uncertainty, A/B comparison, reproducibility, accessibility.
- Testing that focuses on numerical invariants as well as click paths.

**The differentiation is not “I made a heatmap.” It is “I built a falsifiable, inspectable experiment where changing physical geometry produces a measured or predicted consequence.”**

### 1.5 North-star outcomes

**P0 north star:** An unregistered visitor can manipulate three structural variables, observe two *different* phenomenon-specific results, compare two snapshots, and inspect an explanation of at least one receiver's predicted signal path.

**P1 north star:** A user can collect independent measurements, calibrate a small subset of parameters using a training set, and see whether model performance improves on held-out measurements without conflating fit quality with predictive accuracy.

**P2 north star:** At least one advanced numerical solver is validated against trusted reference implementations on explicitly defined benchmark geometries; the UI shows solver disagreements instead of concealing them.

---

## 2. Prior art, competitive reality, and differentiated contribution

Research reference date: **2026-10-14**. These are examples of relevant existing capabilities, not an exhaustive patent or competitive search.

| Existing tool / approach | What it already does | Implication for Invisible Physics |
|---|---|---|
| [Resona](https://github.com/LeeeeT/resona) | Browser acoustic experiment, 2D WebGPU FDTD plus geometric ray methods, binaural audio, live scene edits | An animated sound field or hybrid acoustics solver alone is not novel. Do not claim to be first. |
| [SignalPlan](https://github.com/NC4321/SignalPlan) | Browser-based Wi-Fi planner with scaled floor plans, material walls, multiband heatmaps, optimizers, multiple floors, and calibration | Basic RF floorplan heatmaps already have strong implementations; don't overclaim the RF tool. |
| [pyroomacoustics](https://pyroomacoustics.readthedocs.io/en/stable/) | Established C++/Python image-source and ray-tracing room acoustics tools | Use as a reference implementation for acoustic benchmark cases. |
| [Room EQ Wizard](https://roomeqwizard.com/) | Real acoustic measurement and room analysis | Measurements are a separate layer from visualization; support validation rather than pretending to replace instrumentation. |
| [ITU-R P.1238-13 (2025)](https://www.itu.int/rec/R-REC-P.1238-13-202509-I/en) | Indoor radio propagation recommendation | Use published propagation context and clearly document chosen model and applicable environment. |
| [ITU-R P.2040-4 (2025)](https://www.itu.int/rec/R-REC-P.2040) | Effects of building materials and structures on radiowave propagation | Avoid unsupported universal “brick = N dB” claims; materials and frequency matter. |

### 2.1 Novelty claim we may responsibly pursue

The project's claim is **an integrated experimental experience**, not a novel physical law:

1. A single semantically rich, geometrically valid building representation powers acoustic and radio models without copying walls or coordinates between engines.
2. The interface supports controlled **before/after experiments** with fixed baselines, consistent units, and interpretable contributions.
3. Both models expose mechanism-level information: paths, interactions with surfaces, frequency band, distance, and parameter assumptions.
4. User measurements can calibrate particular model parameters, while held-out points provide an independent check.
5. Results, code, fixtures, and input assumptions can be shared as a reproducible experiment.

Whether this *specific integrated product* is unique cannot be proven by a finite search. Before publishing marketing language, compare against major acoustic, RF, and general building simulation platforms again.

### 2.2 Important competitive constraints

- Do **not** implement a clone of SignalPlan's RF features and describe it as groundbreaking.
- Do **not** implement a Resona-style 2D FDTD visualization in P0 merely to advertise WebGPU. Such a solver is far harder to validate than a scoped geometry-plus-analytical model.
- Do **not** claim a 2D floorplan solves three-dimensional propagation, diffraction, scattering, multipath interference, or actual Wi-Fi throughput.
- Do **not** call the acoustic mode a full architectural acoustic design package, or the RF mode a certified Wi-Fi site survey.
- Do differentiate through excellent interaction design, shared semantics, measurement honesty, and shareable scientific comparisons.

---

## 3. Intended users and prioritized user stories

### 3.1 Personas

**Curious visitor / recruiter:** Wants immediate, beautiful, explanatory interaction and a fast route to the engineering case study. No interest in installing anything.

**Software engineer / graphics engineer:** Wants to inspect the solver architecture, spatial indexing, worker orchestration, benchmarks, and numerical tests.

**Homeowner / maker / home-automation enthusiast:** Wants to explore relative outcomes when moving speakers/access points or modifying doors and materials; needs strong caveats for safety-critical decisions.

**Acoustics / RF technical reviewer:** Wants to know exact units, parameter sources, boundary conditions, validation errors, and the difference between approximation and measurement.

### 3.2 User stories

| Priority | Story | Acceptance evidence |
|---|---|---|
| P0 | As a visitor, I open a compelling building immediately | A functional scene is ready without authentication or upload |
| P0 | I move a speaker and see the sound field react | New compute result uses updated source coordinates |
| P0 | I close a door and observe attenuation / pathway changes | Door state affects collision/portal or material crossings explicitly |
| P0 | I switch to radio and relocate an AP | Radio result is independently recomputed in dBm |
| P0 | I click a receiver location and understand the result | Inspector shows solver, units, distance, crossings, limitations |
| P0 | I save baseline, edit, and see an A/B difference | Stable snapshot hashes and compatible compare domains |
| P0 | I edit a wall and undo it | Geometry remains valid; engines share the edit |
| P0 | I cannot use WebGPU | Application still works via Canvas/WebGL/CPU worker |
| P1 | I upload an image and trace my house accurately | Calibration line, snap/edit, explicit scale, local image storage |
| P1 | I enter Wi-Fi survey observations | Data validation, calibration, held-out residual chart |
| P1 | I import a measured impulse response | Measurement is labeled separately from prediction |
| P1 | I export a report and reproducible manifest | Machine-readable settings and downloadable artifacts |
| P2 | I compare approximate and higher-fidelity solvers | Differences, error/uncertainty, and runtime tradeoffs visible |
| P2 | I explore multi-floor or 3D effects | Proper volume/height geometry and validated new solver |

### 3.3 Jobs to be done

- **Understand:** What invisible behavior does this physical object cause?
- **Explore:** If I move or change it, what should happen and why?
- **Compare:** Is design A meaningfully different from design B under the same model?
- **Verify:** Where does simulation disagree with measurements or stronger reference solvers?
- **Share:** Can someone else reproduce my exact setup without a screen recording?

---

## 4. Scope and release boundaries

### 4.1 P0 — compelling, scientifically honest portfolio release

**Must ship:**

1. A preloaded single-level demonstration apartment, rendered immediately in a beautiful pseudo-isometric view, with a 2D plan toggle.
2. One canonical editable scene: two-dimensional polygonal floor areas, metric-scale walls with thickness, bounded openings/doors, material IDs, listener/receiver marker, speaker, AP.
3. Selection, dragging, keyboard nudge, undo/redo, saved baselines, and constraints preventing invalid object placement.
4. **Acoustic Quick Model:** relative direct-path attenuation, door/wall occlusion as an explicit approximation, optional bounded first-order specular reflection visualization, frequency selection; *not* full-wave acoustic propagation.
5. **Radio Quick Model:** free-space baseline plus wall/intersection attenuation, selectable 2.4/5/6 GHz bands, user-defined source EIRP and material attenuation assumptions, predicted received power field in dBm; *not* throughput or guaranteed coverage.
6. One grid-based scalar field view per model with correct independent scales, legend, units, masked invalid areas, and continuous pointer inspection.
7. One consistent A/B workflow with heatmap difference, comparable settings, changed-geometry highlights, and a readable explanation.
8. Solver info panel containing assumptions, solver version, effective parameters, and result type.
9. An accessible narrative walkthrough with three distinct interactions and an optional sound preview clearly labeled perceptual illustration.
10. Local-first project persistence (IndexedDB), import/export of versioned JSON, static/deployable single-user experience.
11. Deterministic fixtures and tests: geometry properties, physical trend tests, stale-computation cancellation, and browser E2E tests.

### 4.2 P1 — serious experimental tool

1. Local floorplan image upload with interactive metric calibration and tracing; no mandatory AI.
2. More faithful direct/early-reflection acoustics in a documented 2.5D or extruded-room model and RIR generation at receiver points.
3. Acoustic measurements (IR, RT60 if appropriate) with provenance and comparison to supported predicted quantities.
4. Wi-Fi RSSI survey import and parameter calibration with train/holdout separation.
5. Wall/material per-frequency presets with explicit source and confidence categories.
6. Adaptive grid, spatial acceleration, optimized solver cache invalidation, automated objective-driven placement *as an optional comparison tool*.
7. Shareable compact projects, privacy-aware export, analysis reports, and interactive error/uncertainty overlays.
8. Benchmark harness with selected reference implementations and fixed versioned test cases.

### 4.3 P2 — research and advanced numerical extensions

Potentially: WebGPU wave propagation for **low-frequency 2D acoustic demonstration** with a valid CFL condition; acoustics ray tracing and diffraction approximations; full 3D rooms; multi-floor RF; directional antennas; indoor RF multipath and site-specific models; thermal radiation/heat transfer; daylight analysis; ventilation/CFD (a separate major research undertaking); automatic semantic plan extraction.

None of these are promised in P0 or P1. Each new domain requires its own governing equations, input measurements, solver, validation protocol, and UX legend.

### 4.4 Explicit non-goals

- Measuring actual RF propagation using a browser alone. Browser web applications cannot assume access to low-level Wi-Fi scan/PHY data or universal platform APIs.
- Inferring actual acoustic absorption or RF loss from a material's name with laboratory accuracy.
- Certified acoustical treatment, fire, structural, electrical, HVAC, building code, or RF compliance design.
- Live microphone-based room calibration without a controlled capture workflow.
- Physically realistic 3D diffraction, detailed scattering, antenna patterns, or wave interference in P0.
- Photorealism, BIM authoring, arbitrary CAD import, AI hallucination of geometry, multiplayer editing, or monetization in P0.
- A single numerical score called “realism” or an unqualified “accuracy percentage.”

### 4.5 Minimum coherent release

If resources are constrained, ship one complete acoustic experience first, but architect the RF adapter and shared geometry contracts before polishing. The published project must be clear that RF is planned, not completed. **The intended P0 acceptance gate, however, requires both functioning quick models.**

---

## 5. Product narrative and signature demo

### 5.1 Visual metaphor

A **cutaway scientific dollhouse**, not a control-room dashboard. Walls are architectural, surfaces are warm and restrained, and invisible fields appear like translucent light or ink. The building remains legible even with the overlay active.

The visual hierarchy is:

1. The changed physical object (speaker, AP, door, wall).
2. The affected physical field.
3. Receiver point and predicted quantity.
4. One or two meaningful explanatory annotations.
5. Optional technical panels and data provenance.

Avoid glowing neon grids everywhere, random particle swarms with no mathematical mapping, slow camera theatrics, and the default gradient-heavy “AI dashboard” aesthetic.

### 5.2 Hero scene — “Why can't I hear from the study?”

**Room plan:** ~14 m × 10 m rectangular apartment; living room, L-shaped hallway, study, bedroom, bathroom. Include drywall partitions, one masonry feature wall, one opening, and two interactive doors. Use an authored layout with exact coordinates and validated topology.

**Initial camera:** gentle 2.5D isometric orbit, walls low enough to show floor; a speaker in living room and a receiver in study. Heatmap indicates modeled relative attenuation. A button reads **Move the speaker**.

**Demonstration sequence:**

1. Drag speaker close to hallway opening. Preview updates, then settles into full-resolution prediction on pointer release.
2. Toggle hallway door from open to closed. Observe attenuation change in study and inspect an explanatory segment.
3. Click the receiver. See *“Direct path 8.2 m; crosses closed door; includes an assumed transmission loss. This result excludes diffraction and full-wave interference.”* These example numbers MUST be computed from the fixture at runtime, not hardcoded.
4. Select **Save baseline**, move speaker, select **Compare**. See identical colormap domains for A and B and an explicit difference map.
5. Toggle **Wi-Fi**. Change AP position relative to feature wall and inspect predicted dBm. The user sees the same building, different physics.

### 5.3 Secondary hero scenario — “The invisible wall”

- A Wi-Fi AP appears in a living area, behind masonry separating the study.
- At 2.4 GHz, inspect the predicted power and wall-crossing contribution.
- Change to 6 GHz. Show the change from *frequency-dependent model inputs*, and surface the source/settings of attenuation rather than asserting a universal 6 GHz disadvantage.
- Drag the AP next to the doorway; use A/B to compare, and display any area-above-threshold metric as a **scenario-dependent planning indicator**, not actual measured coverage.
- Include a `Why?` panel with the model's path-loss terms.

### 5.4 Negative-control demos

Use at least two tests where user edits **should not** affect a selected field:

- Move a purely decorative piece of furniture when furniture is intentionally excluded from the solver: checksum and displayed values stay equal.
- Change visual theme or camera angle: solver input hash, values, and legend remain identical.

One additional test should show *solver sensitivity* to a meaningful configuration variable: changing AP EIRP by +3 dB increases modeled dBm everywhere by +3 dB for an otherwise fixed linear-dB path-loss model. Do not silently rescale the heatmap and conceal this.

### 5.5 Required explanatory language

- Use **“predicted received power (dBm)”**, not “Wi-Fi speed.”
- Use **“modeled relative acoustic level / path attenuation (dB)”**, not absolute sound pressure level, unless source calibration supports absolute SPL.
- Use **“illustrative listening preview”** for any acoustic render that has not been validated as a room impulse response.
- Use **“2D plan with fixed-height assumptions”** for 2.5D calculations; do not say “full 3D simulation.”
- Distinguish **relative model effect**, **measured value**, and **reference comparison** in legends and export metadata.

---

## 6. UX, visual design, and information architecture

### 6.1 Proposed routes

| Route | Purpose | Release |
|---|---|---|
| `/` | Immediate interactive hero scene and guided discovery | P0 |
| `/lab` | Full editable building laboratory | P0 |
| `/lab?example=hallway` | Deterministic deep-link example | P0 |
| `/compare` or modal panel | Baseline vs branch/delta | P0 |
| `/method` | Model assumptions, formulas, measured limitations | P0 |
| `/examples` | Curated test scenarios | P1 |
| `/benchmarks` | Validation error and runtime benchmark explorer | P1 |
| `/about` | Architecture, repository, project narrative | P0 |

Do not force navigation to a separate experience when entering the lab; the initial scene state should carry over.

### 6.2 Desktop layout (recommended)

- **Header (~56 px):** wordmark, scene title, undo/redo, import/export, `How it works`, repo link.
- **Left rail (~260 px):** phenomenon switch (`Sound | Wi-Fi`), edit tools (`Select`, `Wall`, `Door`, `Source`, `Receiver`), material and scenario control.
- **Center (~55–70% available width):** physically legible building viewport; adjustable 2D/2.5D perspective; overlay/paths/inspect toggles; responsive scene controls.
- **Right inspector (~300–360 px):** selected object properties, model assumptions, field value, path breakdown, computed timestamp/solver hash.
- **Bottom scrub/compare area:** baseline and proposed change, A/B slider, difference legend, optional derived metrics.

The canvas should dominate the viewport. A nontechnical visitor should never have to read a long sidebar to know what to do first.

### 6.3 The first 15 seconds

- Scene appears immediately, not a logo loading spinner.
- Subtle localized motion indicates that a speaker can be dragged; motion is optional and disabled under reduced-motion preferences.
- One short line explains what is shown: *“Drag the speaker. Watch the sound change.”*
- An unobtrusive **Why did it change?** affordance appears after the first successful interaction.
- Advanced controls remain collapsed until needed.

### 6.4 Components

| Component | Responsibilities |
|---|---|
| `BuildingViewport` | Scene rendering, hover hit tests, interaction layers |
| `PhysicsOverlay` | Unit-aware scalar mapping, masks, legends, loading/quality state |
| `FieldInspector` | Result at point, relevant paths, solver assumptions |
| `PhenomenonSwitcher` | Keep geometry but select solver and band |
| `MaterialEditor` | Per-domain properties and provenance; nonapplicable fields hidden |
| `ScenarioComparator` | Baseline/branch snapshot, diff and absolute legends |
| `GeometryToolbar` | walls, openings, room edges, grid, snapping, constraints |
| `SolverStatus` | worker busy/stale/ready, solver ID, quality setting |
| `MeasurementPanel` | (P1) import, calibration, residuals, train/test split |
| `MethodDrawer` | Physical model and assumptions in plain and technical forms |
| `AccessibleSceneTree` | Noncanvas tree describing objects and editable properties |

### 6.5 Interaction rules

1. Use **drag preview quality** while pointer is held; recompute full field when pointer released.
2. The source follows pointer continuously; the field may update in asynchronous steps, with a `refining…` indicator rather than fake synchronous animation.
3. A stale compute result MUST NOT overwrite more recent scene state.
4. Numeric inspectors represent the **last completed result** and display its scene revision; if out of date, label it stale or wait for current revision.
5. All editable objects have a 2D accessible alternate interaction via object list and numeric coordinate fields.
6. Snapping thresholds work in screen-space while stored coordinates remain in meters.
7. Selecting a wall shows both acoustic and RF properties in contextual tabs; changing a property invalidates only relevant solver caches.
8. Undo/redo preserve stable IDs and deterministic object order; camera movement is normally excluded from physics history.
9. If the user moves a receiver, the inspector follows it without necessarily recomputing the full field.
10. All state changes with material effects must be visible in a history action or diff list.

### 6.6 Comparison modes

- **Split A/B:** synchronize cameras and use a common min/max field scale.
- **Reveal slider:** spatial swipe between two aligned absolute fields.
- **Delta:** `B - A` displayed with a signed diverging scale centered at zero, with units dB for differences of logarithmic level quantities. Subtraction of two dBm values yields a dB difference—not dBm.
- **Path comparison:** show baseline and edited path contributions independently; avoid implying identical ray topology where wall edits change it.
- **Receiver chart:** show numeric A, B, difference, calculation assumptions and uncertainty warning.
- **Area metric:** optional threshold-based fraction of eligible sample points; disclose threshold, resolution, domain mask, and correlation/independence limitations.

If results were computed using different solvers, band, scene extent, receiver plane, or incompatible parameters, prevent silent comparison and require explicit normalization or matched recalculation.

### 6.7 Visual design guidance

**Palette:** natural slate/graphite, muted cream, warm wood, dark navy outlines, restrained amber/cyan for physics data. Reserve saturated colors for meaningful extrema or warnings.

**Rendering:** bevel-free architectural silhouette, accurate room proportions, gentle orthographic perspective, measured texture rather than realism. Prioritize readability at 13-inch laptop viewport.

**Typography:** sturdy neo-grotesk for controls plus mono numerals for measurements. Always display units next to values and in legends.

**Color mapping:** monotonic perceptual scale for absolute values; neutral midpoint diverging scale for signed difference; colorblind-safe and high-contrast alternatives. Never use independently autoscaled A/B screenshots for conclusions.

**Motion:** compute-driven transitions may interpolate between the last and next scalar grids; label them as visual transitions rather than instantaneous physics. Separate stylized ripples from results and never let decoration conflict with field magnitude.

### 6.8 Accessibility and responsive behavior

- Keyboard editing and focus order, obvious focus rings, descriptive controls, semantic headings, ARIA labels, and an object-property list equivalent to canvas drag.
- Text alternative summarizing selected receiver value and scene changes.
- Contrast targets conform to WCAG AA for ordinary interface text; charts require patterns/labels in addition to colors.
- `prefers-reduced-motion` removes ambient pulses and excessive animated transitions.
- Mobile defaults to top-down plan with a slide-up inspector; disable expensive 2.5D layers on low-power devices.
- Screen reader users can use numeric movement, snapshots, and comparison without depending on hearing audio or seeing rays.
- Audio playback starts only after a deliberate user gesture, with a conspicuous stop/mute control.

---

## 7. Canonical building, scene, and geometry model

### 7.1 The central design decision

Geometry MUST exist once. Domain solvers read a normalized snapshot instead of owning walls, doors, and points separately. Scene data is immutable at the solver boundary; UI editing is mutable only through validated commands that yield a new scene revision.

**Coordinate conventions:** right-handed Cartesian world; `x,y` are floor-plan coordinates in **meters**, `z` is elevation in **meters**; `+z` is up. Rendering transforms this into pixels/isometric projection and never changes stored scene coordinates. Room/door quantities are in SI units internally. UI may present feet/inches as a formatting preference.

### 7.2 Geometric entities

- **Level:** elevation, default ceiling height, boundary polygon, floor/ceiling materials.
- **Room/zone:** valid planar polygon, semantic label, optional acoustic zone properties; the authoritative material boundary remains the walls.
- **Wall:** stable ID, centerline endpoints, physical thickness, base/height, acoustic and RF material reference. Rendered wall solid is a thickened segment.
- **Opening:** wall-relative span `(tStart,tEnd)`, sill, height, kind (`door`, `passage`, `window`); a door has state and optional leaf material.
- **Source:** acoustic speaker or RF AP with position `(x,y,z)`, orientation, domain configuration.
- **Receiver:** listening point or RSSI probe with position and selected measurement quantity.
- **Visual-only entity:** never affects solver unless explicitly promoted to a physical obstacle with a tested domain adapter.
- **Material:** identity and separately versioned domain profiles. `displayColor` is not physical evidence.

### 7.3 Geometry invariants

- All numeric coordinates are finite; no `NaN`/infinity or negative wall thickness.
- Every polygon must be simple and non-self-intersecting; rooms cannot have zero signed area.
- Openings cannot extend past their parent wall; overlapping openings require validation or explicit segmentation.
- All doors are attached to an existing wall with stable local coordinates, so moving a wall updates door placement deterministically.
- Source and receiver height must be bounded by their containing level; special handling required if point resides in a wall solid.
- Walls are represented as thick solids for display and collision; intersection computations must use a documented centerline/solid convention rather than double-counting both surfaces.
- Grid samples outside target floor polygon or inside impassable wall solids are masked, not drawn with plausible values.
- Scene imports are schema-validated, migrated, bounded by maximum size, and rejected with actionable errors.

### 7.4 Topology and doors

The editor SHOULD derive a connectivity/portal graph for room adjacency, but the physics solvers MUST use actual geometry for visibility and wall crossing. A topological room graph alone is not a physical path length or attenuation model.

When a door is open, ray/path intersection with its opening region may allow passage (subject to vertical extent). Closed doors expose an effective transmission material rather than magically disconnecting all energy. The system must not assume a closed door is completely silent or RF-opaque.

### 7.5 Spatial acceleration

P0: brute-force segment intersection can work for the tiny fixture; use an `AABB` broad phase or uniform spatial grid once performance measurements justify it. P1: build an R-tree/BVH or spatial hash that can be incrementally updated as geometry changes.

Cache keys MUST include scene geometry version, material revision, emitter location and height, solver and settings, grid bounds/resolution, and applicable band/frequency. Source-independent caches (e.g., wall segment arrays) SHOULD reuse geometry snapshots.

### 7.6 Supported building dimensions

P0 is **single-level 2.5D**: 2D editable plan, metric wall and receiver heights, ray intersection logic that respects door/window vertical openings when explicitly implemented. It is **not** a 3D volumetric solver. Any top-down-only acoustic or RF shortcut is labeled **plan-view approximation**.

Do not attempt multiple floors in P0; floors/stairs/shafts are not minor patches to a 2D propagation solver.

---
## 8. Physics model I — acoustics

### 8.1 What the acoustic model is expected to compute

**P0 primary quantity:** modeled **relative sound level / path attenuation**, in dB referenced to a defined location or scenario. The UI may show `relativeLevelDb` or `attenuationFrom1mDb`. A source with arbitrary volume setting has no defensible absolute sound pressure level unless source-output calibration is provided.

Optional P0 output: **direct-path travel time** in milliseconds and a small number of early specular reflection paths on supported surfaces. P1 output: room impulse responses (RIRs) and derived frequency-dependent features for rooms the solver can model.

Different acoustics quantities must remain distinct:

| Quantity | Unit | Interpretation | P0 status |
|---|---|---|---|
| Source-to-receiver distance | m | Geometric distance between points | Required |
| Direct travel time | ms | Distance / assumed speed of sound | Required |
| Relative pressure level | dB | Change relative to a stated reference | Required |
| Early reflected paths | length, time, relative gain | Bounded set of specular bounces | Optional but desirable |
| Room impulse response | amplitude vs time | Receiver response to ideal impulse | P1 validated implementation |
| Reverberation time (RT60) | s | Decay measure estimated from valid method/data | P1; not computed from P0 heatmap |
| Absolute SPL | dB SPL re 20 µPa | Physically calibrated sound pressure | Only with defensible source calibration |

### 8.2 P0 direct-path model

For emitter position `s` and receiver position `r` (both 3D), let `d = ||r-s||` and `d0 = 1 m` be the reference distance. For a far-field point-source free-field approximation, relative sound pressure level falls with distance according to:

```text
DeltaLevel_dB(d relative to d0) = -20 * log10(d / d0)

c ~= 343 m/s for a typical approximate room-temperature assumption
travelTime_s = d / c
```

These are **approximations**, not complete room acoustics. Clamp distance only for numerical near-source display stability using a documented minimum radius, and label values inside that radius invalid/near-field rather than claiming accurate far-field output. If a frequency-dependent source emits different levels, those are source-model parameters.

Apply additional **assumed** losses when a geometric line crosses an obstacle with a supported transmission heuristic. Sound through a door/wall is complex; a fixed loss is a crude educational assumption, not a validated frequency-specific sound transmission loss. P0 should expose this as a *heuristic transmission penalty*, allow turning it off, and avoid presenting it as a precise interior sound-level prediction.

**Recommended default P0 presentation:** relative direct-path loss and a simple view of blocked/attenuated segments, not claims about full perceived loudness. The room can show geometrically occluded regions, but an “acoustic shadow” without diffraction may overstate real attenuation—flag this.

### 8.3 Early reflection option

Implement only **bounded first-order specular reflections** after the base direct-path model passes validation:

1. Treat a wall face as an acoustic reflecting line/plane.
2. Mirror the source across that plane to obtain an image source.
3. Intersect the image-source-to-receiver line with the finite reflecting segment/face.
4. Reject reflections where the intersection lies outside the segment, crosses forbidden solids, or violates sidedness/boundary conditions.
5. Compute path length and arrival time using the physical source → bounce → receiver polyline.
6. Apply reflection amplitude dependent on the material's **energy absorption coefficient** `alpha(f)` via approximately `sqrt(1 - alpha(f))` for a simplified specular amplitude term. This does not model scattering or complex phase response.
7. Limit total path order and number for interactivity. Mark rendered paths as geometric approximations.

**Important physical distinction:** Summing received acoustic levels from individual paths in the dB domain is incorrect. Power-like independent contributions may be combined as `10 log10(sum(10^(Li/10)))` **only under assumptions that justify incoherent energy addition**. Coherent sound pressure requires complex amplitude/phase summation and can exhibit cancellation. P0 MUST NOT simulate a realistic interference pattern using naive energy summation.

If reflected paths are included in the displayed heatmap, choose a stated aggregation rule and label the quantity accordingly. The safest P0 product path is to keep the primary map *direct-path model only*, while visualizing reflected paths on demand as a distinct explanation layer.

### 8.4 Materials for acoustics

A material can provide octave-band or third-octave-band absorption coefficients `alpha` in `[0,1]`, reflection/scattering assumptions, and a separate **transmission-related** parameter if applicable. Do **not** equate absorption with transmission loss: a surface that absorbs internal sound is not necessarily a good isolator between rooms.

P0 illustrative material presets MAY be authored as scenarios only if clearly marked `illustrative`, not `measured`. P1 presets SHOULD cite standards/manufacturer measurements for particular constructions and bands, with explicit uncertainty and assembly context (drywall with studs vs single board, door sealed vs unsealed, etc.).

### 8.5 Listening preview

The experience can include *Listen from here*:

- **P0:** Web Audio `PannerNode` or a conservative short delay/filter/reverb preset for a perceptual sketch. Label `Illustrative audio — not a validated room reproduction`.
- **P1:** Construct a receiver-specific RIR using a documented ISM/ray-tracing approach; convolve an allowed audio sample with a `ConvolverNode`; explain that binaural perception depends on HRTFs, headphones/speakers, calibration, and model limits.
- Crossfade when RIR changes. Do not replace live audio convolvers every pointer frame; worker debouncing and sensible rate limits are required.
- Use gain limits to avoid loud surprises. Muted by default, user gesture to start, no autoplay.

### 8.6 Acoustic validation cases

**A-01: travel time.** For a 3.43 m unobstructed ray at assumed `c=343 m/s`, expected travel time ≈10 ms (within floating-point tolerance).

**A-02: distance trend.** In a free-field model, doubling distance reduces relative pressure level by approximately `20 log10(2) ≈ 6.0206 dB`.

**A-03: wall irrelevance.** Changing a wall outside the direct ray in a direct-path-only model cannot change the receiver estimate. The test MUST specify the model to avoid assuming absent physical effects.

**A-04: openness.** A physically open doorway should remove the corresponding blocker contribution for a ray that goes through it at a valid height.

**A-05: reciprocal geometry.** In a passive reciprocal geometry with compatible directional assumptions, path length is the same under source/receiver exchange. Do not assert full gain reciprocity when source/receiver directivity configurations differ.

**A-06: reflections.** First-order reflection on an infinite reference plane matches image-source geometric path length; finite segment clipping and wrong-side rejection must pass.

**A-07: truth in audio.** No absolute SPL number is shown for an uncalibrated source.

### 8.7 Acoustic solver honesty rules

- Acoustic maps must never pretend a simple ray shadow captures diffraction around doors.
- A visualization of “waves” is decorative unless generated from pressure samples of a wave equation solver.
- RT60 is not derived from a direct-path loss grid.
- Wall acoustic isolation needs a separate source/receiver room and transmission model.
- Room modes and low-frequency standing waves are omitted by P0.
- A 2D pressure solver has different distance scaling than real three-dimensional radiation; do not mix normalization rules without explanation.

---

## 9. Physics model II — Wi-Fi radio propagation

### 9.1 What the RF model is expected to compute

**P0 primary quantity:** predicted **received power** in dBm at a specified receiver height, under a simple large-scale indoor path-loss model. It is not packet throughput, channel capacity, a measured site survey, noise floor, or a statement that a device will connect.

Provide 2.4, 5, and 6 GHz as selectable representative **center frequencies**. Expose the actual MHz/GHz value used by the solver so users do not confuse an entire Wi-Fi band with one propagation frequency.

### 9.2 Free-space reference model

For distance `d_m > 0` in meters and frequency `f_Hz` in hertz, the classic far-field free-space path loss is:

```text
FSPL_dB = 20 log10(d_m) + 20 log10(f_Hz) - 147.55  [approx.]

Pr_dBm = EIRP_dBm + Gr_dBi - FSPL_dB - Lwalls_dB - Lother_dB
```

Here, `EIRP` includes transmit power, transmit antenna gain, and feeder losses by definition; **do not add transmit antenna gain again**. `Gr` is receive-antenna gain; P0 may set it to 0 dBi as a documented simplification.

This free-space baseline is not itself a complete indoor model and is not reliable arbitrarily close to antennas. Apply a minimum model-validity distance (e.g. default 1 m) with a `near-field / clamped` indication, not a bogus physical guarantee. The exact validity boundary is frequency/antenna-dependent; expose it as a configurable assumption.

### 9.3 Wall and door attenuation

P0 wall-augmented model:

```text
Lwalls_dB = sum over each distinct encountered physical assembly
             of effectiveWallLossDb(material, band, incidence, construction)
```

For the MVP, `effectiveWallLossDb` can be a **user-editable, frequency-indexed planning parameter**, with simple incidence assumptions. Each physical wall crossing MUST be counted once per appropriate traversed assembly, not once per centerline edge and again for front/back render surfaces.

Open doors should remove the door-leaf material intersection where the straight 3D ray passes through the opening, although surrounding wall remains. Closed doors add their assumed loss rather than making a binary occlusion.

P0 deliberately omits reflected/scattered RF multipath, diffraction, human-body effects, neighboring AP interference, bandwidth, client MIMO, and radio hardware behavior. Propagation routes around obstacles, especially non-line-of-sight indoor routes, can invalidate a straight-line-plus-loss prediction; explain this in the inspector.

### 9.4 Why 2.4 GHz and 6 GHz should not be reduced to slogans

At a fixed distance, free-space path loss increases with carrier frequency. Material and structure losses may also vary with frequency, angle, moisture, thickness, and construction. These effects must be separate inputs: do not automatically hardcode a universal frequency penalty and then also embed it in material loss, which would double-count.

Where physics-based material presets are absent, the app should say **“illustrative material settings”**, not imply every concrete wall has a universally known attenuation.

### 9.5 Practical RF planning indicators (optional P0)

- Receiver power estimate at selected points, dBm.
- Difference between scenario A and B, dB.
- Fraction of eligible floor cells above a user-adjustable received-power threshold, with explicit threshold and resolution.
- Dominant line-intersected assemblies and assumed loss per assembly.

Do not label dBm thresholds `excellent / good / bad` by default unless the thresholds are explicitly defined and tied to an assumed device/modulation/use case. Avoid throughput estimates until there is a separate link-budget/interference model with validation.

### 9.6 RF calibration (P1)

Provide an ingestion format for independently collected RSSI observations, each with position, level, band, device identifier, timestamp, floor, antenna/height context, survey conditions, and method. The browser cannot assume it can collect scan values directly; the user may import a survey CSV/JSON.

P1 calibration MAY fit a small set of model parameters—for example constant offset, per-material loss multipliers, or an effective path-loss exponent—using only the training subset. The app must show:

- Raw model error on the held-out set.
- Calibrated model error on held-out points.
- Fit residuals, spatial distribution, and uncertainty caveats.
- Estimated parameters and ranges, optimizer settings, seed, train/test IDs.
- A conspicuous warning against claiming empirical improvement using only training residuals.

Unidentifiable parameters should be reported as such. A scene with only measurements on one side of one wall generally does not identify all material coefficients and AP parameters independently.

### 9.7 RF validation cases

**R-01: free-space trend.** Doubling distance increases FSPL by about 6.0206 dB; predicted received power decreases by that amount with all else constant.

**R-02: frequency trend.** Doubling frequency increases FSPL by about 6.0206 dB at fixed distance/antenna assumptions and unchanged material losses.

**R-03: EIRP linearity in dB.** Increase source EIRP by 3 dB: all valid predictions increase by 3 dB exactly in the P0 additive model.

**R-04: clear ray.** No geometric obstacle crossings yield `Lwalls = 0`.

**R-05: count once.** Crossing a thick wall assembly represented by a centerline and a rendered solid counts one effective assembly, not 2–4 accidental intersections.

**R-06: door.** A ray through a valid open door excludes its leaf loss; closing it restores effective door loss.

**R-07: invariance.** Camera orbit, renderer theme, or unrelated annotation cannot alter dBm results.

**R-08: receiver height.** Changing receiver elevation changes true 3D distance/path intersection if the model uses height-aware geometry.

**R-09: invalid point.** Receiver inside an opaque wall solid returns a masked/invalid status, not invented connectivity.

### 9.8 RF honesty rules

Never claim that a dBm heatmap alone gives download speed, latency, Wi-Fi 7/8 performance, roaming behavior, or guaranteed coverage. RSSI observations can have client-specific offsets and large variance. Calibration is contextual; a model calibrated for one building and device does not automatically generalize to another.

---

## 10. Field sampling, solver architecture, and explainability

### 10.1 Why field computation is not a pixel shader trick

The field is a numerical function of a scene and query positions. Colorization is a **separate** deterministic transform of computed quantities. The first working engine should produce a typed `Float32Array` or `Float64Array` grid and optional validity mask, independent of the canvas and visualization library.

```text
Canonical Scene
     │
     ├── geometry index + material profiles ──> Acoustic Solver
     │                                               │
     └── geometry index + RF material parameters ───> RF Solver
                                                     │
        Result: numeric grid + units + settings + provenance + diagnostics
                                                     │
                      ├── color mapping + 2D overlay
                      ├── isometric projected surface
                      ├── point inspector / ray traces
                      ├── A/B differencing
                      └── serializable experiment manifest
```

No renderer should invent solver values by reverse-engineering visual colors.

### 10.2 Sampling domain and grid

Use an axis-aligned metric grid over the included floor polygon, sampled at cell centers. Example for 15 × 10 m with `0.25 m` spacing: `60 × 40 = 2,400` cells. Mask invalid cells, including wall interiors if domain configuration excludes them.

Sample receiver plane height defaults to a documented value (e.g. 1.2 m for an illustrative handheld device or 1.5 m for a listener). Source heights are independently configured. **For each phenomenon**, set context-specific defaults and show the values in advanced settings.

Provide adaptive profiles:

| Profile | Example grid step | Intended use |
|---|---:|---|
| Preview | 0.5–0.75 m | Active source drag, rapid viewport change |
| Balanced | 0.25 m | Standard desktop P0 |
| Detail | 0.10–0.15 m | Post-release or user-requested compute |

Values are engineering defaults, not claims of physical spatial resolution. A 0.1 m raster cannot rescue a crude propagation model.

### 10.3 Compute lifecycle

1. UI command updates validated canonical scene and `revision`.
2. Derive solver input hash from geometry, physical parameters, selected model/band/grid settings, *not* visual UI styling.
3. Request worker computation with monotonic `requestId` and revision.
4. If an identical result is cached, reuse numeric data.
5. Otherwise compute with cancellation/coalescing; during active drag, use preview grid.
6. Worker reports progress where meaningful and returns `FieldResult` with metadata.
7. Controller accepts the result only when it matches current revision and query settings.
8. Rendering maps numbers to colors with a user-visible, unit-aware legend.
9. On pointer release or idle, a higher-resolution field replaces preview and is labeled ready.

### 10.4 Worker and GPU boundaries

- P0 calculations run in a Web Worker; transfer typed arrays where possible to avoid copying.
- UI and render controls remain responsive even if computation is expensive.
- GPU compute is **not a P0 dependency**; on supported browsers it may accelerate field evaluation in P1/P2.
- WebGPU support remains nonuniversal as of October 2026, so runtime capability detection and CPU/WebGL fallback are mandatory.
- GPU device loss should trigger recovery and return to a CPU solver, with a visible notice only if needed.
- Avoid `SharedArrayBuffer` until profiling justifies its complexity and cross-origin isolation constraints.
- Use `AudioWorklet` only for real-time custom DSP when Web Audio nodes are insufficient; never block the audio callback with the main simulation.

### 10.5 Scalar field renderer

Recommended P0: 2D Canvas or a small WebGL layer for fields; ordinary SVG/Canvas for static walls, and Three.js or custom projected meshes for 2.5D presentation. Avoid maintaining three inconsistent independent copies of geometry. Data textures should be rendered with nearest/interpolated sampling as a selectable display choice.

**Rendering contract:** physical values → specified transfer function (`scaleId`, `min`, `max`, palette, gamma policy) → RGBA; invalid cells get a separate mask/pattern. The legend is generated from the same function. Make the palette deterministic under screenshots and E2E tests.

### 10.6 Path explanation

Clicking a receiver requests `explainPoint(scene, solverParams, point)`, returning:

- Geometric source and receiver positions, actual 3D distance, height assumptions.
- Direct line and intersected assembly IDs in order (plus door state and effective material).
- RF: EIRP, free-space term, wall-loss contributions, gain/loss terms, final dBm.
- Acoustic: modeled free-field attenuation, heuristically assumed transmission penalties, direct travel time; optional reflected candidate path list.
- Solver ID/version, input hash, material source quality, limitations.

The explanation MUST be recomputed by the same solver logic used for the grid, not generated independently or written by a language model. Sampled grid cell value may differ slightly from an exact point evaluation; distinguish sampled coordinate from requested coordinate.

### 10.7 Model-aware uncertainty

P0 should avoid pseudo-precise confidence intervals. Use simple qualitative metadata:

- **Geometry:** exact authored / traced and calibrated / inferred / unknown.
- **Material:** measured source / literature-derived / assumed illustration / user-entered.
- **Solver:** analytical approximation / geometric early-reflection / validated wave solver.
- **Calibration:** none / in-sample only / held-out validated.

P1 may estimate empirical residual bands using held-out data, but only when enough suitably collected observations exist and the statistical method is stated. Never turn a subjective confidence label into a pretend 95% probabilistic guarantee.

---

## 11. Domain types and implementation contracts

The following is a **proposed contract**, intended to be adapted to a validated TypeScript schema using Zod or a comparable runtime validator. The contract deliberately separates normalized physical scene state, UI state, solver inputs, and result provenance.

```ts
export type Id = string;
export type Vec2 = readonly [xMeters: number, yMeters: number];
export type Vec3 = readonly [xMeters: number, yMeters: number, zMeters: number];
export type Phenomenon = 'acoustics' | 'radio';
export type Quality = 'preview' | 'balanced' | 'detail';
export type ProvenanceKind =
  | 'fixture-assumed'
  | 'user-entered'
  | 'literature-derived'
  | 'manufacturer-measured'
  | 'site-measured';

export interface ParameterProvenance {
  kind: ProvenanceKind;
  sourceUrl?: string;
  sourceTitle?: string;
  measuredAt?: string;
  notes?: string;
}

export interface AcousticProfile {
  // Center frequencies; keep these aligned with absorption values.
  bandsHz: number[];
  absorptionEnergy: number[]; // each 0..1
  // Optional *separate* assumed transmission penalties, not absorption.
  illustrativeTransmissionLossDb?: number[];
  provenance: ParameterProvenance;
}

export interface RadioProfile {
  bandsHz: number[];
  effectiveWallLossDb: number[]; // each >= 0
  provenance: ParameterProvenance;
}

export interface PhysicalMaterial {
  id: Id;
  name: string;
  display: { color: string };
  acoustics?: AcousticProfile;
  radio?: RadioProfile;
}

export interface Wall {
  id: Id;
  start: Vec2;
  end: Vec2;
  thicknessM: number;
  baseZ: number;
  heightM: number;
  materialId: Id;
}

export interface Opening {
  id: Id;
  wallId: Id;
  fromT: number; // inclusive wall-local 0..1
  toT: number;   // exclusive wall-local 0..1
  sillZ: number;
  heightM: number;
  kind: 'passage' | 'door' | 'window';
  state: 'open' | 'closed' | 'fixed';
  leafMaterialId?: Id;
}

export interface Level {
  id: Id;
  elevationM: number;
  ceilingHeightM: number;
  boundary: Vec2[]; // validated simple polygon
  wallIds: Id[];
  floorMaterialId?: Id;
  ceilingMaterialId?: Id;
}

export interface Speaker {
  id: Id;
  kind: 'speaker';
  position: Vec3;
  orientationRad: number;
  // No default claim of absolute SPL.
  referenceLevelDbAt1m?: number;
  calibratedAbsoluteSpl: boolean;
}

export interface AccessPoint {
  id: Id;
  kind: 'access-point';
  position: Vec3;
  eirpDbm: number;
  orientationRad: number;
}

export type Emitter = Speaker | AccessPoint;

export interface Probe {
  id: Id;
  position: Vec3;
  label: string;
  phenomenon: Phenomenon;
}

export interface BuildingScene {
  schemaVersion: 1;
  id: Id;
  title: string;
  revision: number;
  levels: Level[];
  walls: Wall[];
  openings: Opening[];
  materials: PhysicalMaterial[];
  emitters: Emitter[];
  probes: Probe[];
  // Render camera/settings intentionally NOT here.
}

export type SolverSpec =
  | {
      phenomenon: 'acoustics';
      solverId: 'acoustic-direct-v1';
      sourceId: Id;
      output: 'relative-pressure-level-db';
      frequencyHz: number;
      cMetersPerSecond: number;
      includeIllustrativeTransmission: boolean;
    }
  | {
      phenomenon: 'radio';
      solverId: 'rf-fspl-multiwall-v1';
      sourceId: Id;
      output: 'received-power-dbm';
      frequencyHz: number;
      receiverGainDbi: number;
      minValidDistanceM: number;
    };

export interface FieldGridSpec {
  levelId: Id;
  originXY: Vec2;
  cols: number;
  rows: number;
  cellSizeM: number;
  receiverZM: number;
  quality: Quality;
}

export interface FieldQuery {
  requestId: number;
  sceneRevision: number;
  sceneHash: string;
  scene: BuildingScene;
  solver: SolverSpec;
  grid: FieldGridSpec;
}

export interface FieldResult {
  requestId: number;
  sceneRevision: number;
  sceneHash: string;
  solverId: SolverSpec['solverId'];
  solverVersion: string;
  quantity: 'relative-pressure-level-db' | 'received-power-dbm';
  units: 'dB' | 'dBm';
  grid: FieldGridSpec;
  values: Float32Array; // row-major cols*rows
  mask: Uint8Array; // 0 invalid, 1 valid
  computeMs: number;
  assumptions: string[];
  provenanceSummary: ParameterProvenance[];
  generatedAtIso: string;
}

export interface ReceiverExplanation {
  sceneHash: string;
  solverId: string;
  receiver: Vec3;
  quantity: FieldResult['quantity'];
  value: number | null;
  units: FieldResult['units'];
  directDistanceM: number;
  pathPolyline: Vec3[];
  intersections: Array<{
    wallId: Id;
    openingId?: Id;
    materialId: Id;
    assumedLossDb: number;
  }>;
  terms: Array<{
    key: string;
    label: string;
    value: number;
    unit: 'dB' | 'dBm' | 'ms' | 'm';
  }>;
  warnings: string[];
}

export interface SnapshotManifest {
  schemaVersion: 1;
  id: Id;
  parentId?: Id;
  label: string;
  scene: BuildingScene;
  solver: SolverSpec;
  grid: FieldGridSpec;
  sceneHash: string;
  solverVersion: string;
  createdAtIso: string;
  // Numeric arrays can be regenerated or stored as separate binary assets.
}
```

### 11.1 Contract notes

- The discriminated union disallows applying a speaker model to an AP or vice versa.
- Frequencies must be finite positive values, arrays must match in length, material coefficients and loss values must be validated.
- Provenance applies to profiles **and, in production, ideally each individual parameter** where sources differ.
- Treat `sourceId` as an emitter ID and validate type compatibility at runtime.
- The scene hash is a cryptographic or stable content hash of normalized physical inputs, not `JSON.stringify` of arbitrary object order.
- `FieldResult.values` is a transferable typed array in worker messaging. Persisting it requires explicit binary encoding or recomputation.
- Do not silently “upgrade” a solver under an existing solver ID; version semantics are reproducibility requirements.
- Opening `toT` boundary and line-segment intersection rules must be specified consistently, with epsilon handling and tests.
- `relative-pressure-level-db` requires a documented reference condition; implementation SHOULD store `referenceDistanceM` in solver metadata before external release.
- A source-level SPL field is only meaningful with calibration, microphone/location context, and reference pressure convention; default fixtures must not opt into calibrated output.

---

## 12. Project persistence, experiments, and reproducibility

### 12.1 Persistence model

P0 uses a validated IndexedDB-backed local project store with optional JSON import/export. No account, database, server action, or cloud sync is necessary.

Artifacts:

- **Project:** mutable user workspace, references current scene and local settings.
- **Snapshot:** immutable scene + solver + grid + parameter provenance manifest.
- **Comparison:** references baseline snapshot and branch snapshot, stores solver compatibility result and optional cached delta grid.
- **Measurement set (P1):** immutable raw records with survey provenance, train/holdout split, and dataset content hash.
- **Calibration run (P1):** base model and tuned parameters, optimizer settings, data partition, errors, and source lineage.

### 12.2 Snapshot semantics

- `Save baseline` copies a normalized immutable snapshot; subsequent edits never mutate it.
- Branch records `parentId`, changed input IDs, and a stable physical scene hash.
- Compare mode MUST recompute with **same solver version and compatible grid/band/reference semantics** when necessary.
- If the baseline is different physically by design (changed wall/door/source), those differences are listed explicitly.
- Support importing exported projects in a different browser without relying on hidden backend state.
- JSON exports include code-readable version metadata but not enormous binary grids by default.

### 12.3 Shareable experiments

P0: `Download .invisible-physics.json`. Optional URL fragment sharing may compress tiny illustrative scenes but must enforce practical URL size and security constraints. Do not put sensitive floor plans into server-visible query strings; warn users when links expose details.

P1: static exported report with visual summary, numeric table, parameters, source provenance, calculation timestamp, and caveats. Consider a hosted share service only with explicit access controls, retention/deletion policy, and privacy review.

### 12.4 Reproducibility contract

An exported manifest MUST allow reconstructing:

- Exact scene geometry and physical units.
- Source / receiver coordinates and heights.
- Door states, material parameters, and source provenance.
- Solver ID, revision, frequency, grid bounds, receiver plane, and numerical settings.
- Baseline/branch lineage, result quantity, and comparability rules.
- Model code commit or release tag for publication-grade benchmarks.

For deterministic P0 solvers, identical validated manifests should reproduce outputs within documented floating-point tolerance. Pixel-identical rendering across GPUs is **not** the numerical reproducibility criterion.

---
## 13. Engineering architecture and recommended stack

### 13.1 Technology choices

| Concern | Recommended starting point | Rationale |
|---|---|---|
| Web app | Nuxt 4 + Vue 3 + strict TypeScript | Product framework, excellent component model, static/hybrid deployment |
| Schemas | Zod (or equivalent runtime validation) | Validate imported and persisted scenes at boundaries |
| 2D editing | Canvas 2D or PixiJS; choose ONE authoritative interaction layer | Predictable hit testing and smooth field overlays |
| Isometric/3D visualization | Three.js, orthographic camera | Attractive cutaway without demanding full 3D geometry authoring |
| Computation | Pure TypeScript solver package in Web Workers | Testable headlessly, no GPU requirement |
| Expensive numerical routines | Rust/WASM only after profiling | Avoid premature additional toolchain / debugging burden |
| GPU acceleration | WebGPU optional feature-gated backend | Experimental higher fidelity and accelerating grids |
| Audio | Web Audio nodes, `ConvolverNode` for P1 | Good browser support; no need for bespoke DSP at first |
| Store | Vue state + IndexedDB persistence | Local-first, zero-auth P0 |
| Charts | Lightweight SVG/Canvas + accessible tables | Explain data, avoid generic dashboard UI |
| Testing | Vitest or Bun test for pure engine; Playwright for browser | Fast regression plus real interaction coverage |
| Benchmarks | Node/Bun harness + browser performance tracing | Reproducible numerical and user-experience budgets |
| Observability | Small local diagnostics + opt-in aggregated telemetry | Measure performance without collecting private plans |
| Hosting | Static CDN/edge host with correct cache/security headers | P0 needs no dedicated compute server |

**Framework selection rule:** Do not introduce a renderer, worker framework, database, mesh engine, WASM build chain, AI SDK, and WebGPU simultaneously. A genuinely finished vertical slice matters more than frontier stack novelty.

### 13.2 Logical system diagram

```text
                      Nuxt / Vue Application
                    ┌──────────────────────────┐
                    │  Commands, inspector, UX │
                    │  Scene editor + history  │
                    │  A/B branch controller   │
                    └────────────┬─────────────┘
                                 │ validated commands
                   ┌─────────────▼──────────────┐
                   │ Canonical building model   │
                   │ normalizer / geometry index│
                   │ scene revisions + hashing  │
                   └───────┬───────────┬────────┘
                           │           │
             ┌─────────────▼─┐     ┌───▼──────────────┐
             │ Acoustic worker│     │ RF worker        │
             │ direct / ISM   │     │ FSPL + multiwall │
             └────────────┬───┘     └───┬──────────────┘
                          └───────┬─────┘
                                  │ numeric grid + metadata
                   ┌──────────────▼───────────────┐
                   │ Field cache + result arbiter │
                   │ masks, scales, stale guards  │
                   └───────┬──────────┬───────────┘
                           │          │
                 ┌─────────▼────┐ ┌───▼──────────────┐
                 │ 2D / 2.5D    │ │ Inspect / Compare│
                 │ field display│ │ metrics + traces │
                 └──────────────┘ └───┬──────────────┘
                                       │
                                  JSON/CSV export

             IndexedDB ◄── immutable snapshots + project state
             Web Audio ◄── optional RIR/preview (not field renderer)
```

### 13.3 Repository layout

```text
invisible-physics/
├── apps/
│   └── web/
│       ├── app/
│       │   ├── components/
│       │   │   ├── building/
│       │   │   ├── controls/
│       │   │   ├── fields/
│       │   │   ├── compare/
│       │   │   └── inspector/
│       │   ├── composables/
│       │   ├── pages/
│       │   ├── stores/
│       │   └── assets/
│       ├── public/
│       └── tests/e2e/
├── packages/
│   ├── scene/             # types, schemas, normalization, mutations
│   ├── geometry/          # segment/polygon math, intersections, BVH/grid
│   ├── physics-acoustic/  # P0 direct, P1 ISM / RIR
│   ├── physics-radio/     # P0 multiwall, P1 calibration
│   ├── field-engine/      # grids, result contracts, caching, hashing
│   ├── visualization/     # legend scales and coordinate projection
│   ├── experiments/       # snapshots, comparison, scoring, reports
│   ├── fixtures/          # benchmark geometry and example scenes
│   └── test-helpers/
├── scripts/
│   ├── benchmark-engine.ts
│   ├── verify-fixtures.ts
│   └── render-demo-previews.ts
├── docs/
│   ├── INVISIBLE_PHYSICS_SPEC_HANDOFF.md
│   ├── PHYSICS_ASSUMPTIONS.md
│   ├── VALIDATION.md
│   ├── DESIGN_SYSTEM.md
│   └── ARCHITECTURE_DECISIONS.md
└── README.md
```

Prefer packages with zero knowledge of Vue/Nuxt. Unit tests should import and run solvers in Node without DOM, WebGL, or network access.

### 13.4 State ownership boundaries

**Canonical project state:** geometry, physical materials, emitters, receiver coordinates, selected physical solver settings.

**Ephemeral UI state:** panel size, hover state, camera orbit, visualization palette, animation progress, open modals.

**Derived numerical state:** cached computation results keyed by normalized physical input hash.

**Immutable historical state:** named scenario snapshots and comparisons.

Do not serialize a React/Vue object graph as the physical model or accidentally include palette changes in solver hashes.

### 13.5 P1 optional server

A server is only justified by real needs: multi-device project sync, hosted comparisons, expensive batch reference solvers, published measurements, and voluntary benchmarking. At that point use a small API/worker service, object storage for large measurement data, and PostgreSQL for indexed manifests. Keep the numerical models usable locally and do not turn every drag action into a cloud inference call.

---

## 14. Local APIs, worker messages, and optional network API

### 14.1 Pure domain API

```ts
export interface PhysicsEngine {
  readonly id: string;
  readonly version: string;
  supports(scene: BuildingScene, spec: SolverSpec): {
    ok: boolean;
    reasons: string[];
  };
  evaluatePoint(
    scene: BuildingScene,
    spec: SolverSpec,
    point: Vec3
  ): ReceiverExplanation;
  evaluateField(
    query: FieldQuery,
    signal?: AbortSignal
  ): Promise<FieldResult>;
}

export interface SceneCommand {
  id: string;
  type:
    | 'move-emitter'
    | 'move-probe'
    | 'set-door-state'
    | 'change-wall-material'
    | 'replace-wall-geometry'
    | 'set-physical-parameter';
  payload: unknown; // refine into discriminated typed command union
}

export interface FieldComparison {
  baselineSnapshotId: Id;
  candidateSnapshotId: Id;
  compatible: boolean;
  reasonIfIncompatible?: string;
  // If compatible, grid data lives in derived binary result storage.
  deltaQuantity?: 'relative-pressure-level-db' | 'received-power-dbm';
  deltaUnit?: 'dB';
  commonRange?: [min: number, max: number];
}
```

Production implementation MUST replace `payload: unknown` with a fully discriminated union; it is used here to keep the example concise while making the boundary explicit.

### 14.2 Worker request protocol

```ts
type WorkerRequest =
  | { type: 'compute-field'; request: FieldQuery }
  | { type: 'explain-point'; requestId: number; scene: BuildingScene;
      solver: SolverSpec; receiver: Vec3 }
  | { type: 'cancel'; requestId: number }
  | { type: 'warm-geometry-index'; sceneHash: string;
      scene: BuildingScene };

type WorkerResponse =
  | { type: 'field-result'; result: FieldResult }
  | { type: 'point-explanation'; requestId: number;
      explanation: ReceiverExplanation }
  | { type: 'progress'; requestId: number; fraction: number }
  | { type: 'cancelled'; requestId: number }
  | { type: 'error'; requestId: number; code: string;
      message: string; recoverable: boolean };
```

When a cancellation message arrives during synchronous CPU computation, the worker can only observe it at yield/checkpoints. The UI may instead terminate/replace a worker for expensive uninterruptible work. **In all cases, reject stale result IDs.**

### 14.3 Optional P1 REST design

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/projects` | Store a new project, explicit opt-in only |
| `GET` | `/api/v1/projects/:id` | Fetch authorized project |
| `POST` | `/api/v1/experiments` | Persist snapshot + calculation manifest |
| `POST` | `/api/v1/surveys/import` | Validate uploaded measurement file |
| `POST` | `/api/v1/calibrations` | Start queued calibration request |
| `GET` | `/api/v1/calibrations/:id` | Get fit summary and metrics |
| `GET` | `/api/v1/experiments/:id/export` | Retrieve reproducible report |

This API is **not required for P0**. Do not build endpoints that merely wrap local deterministic JavaScript before a persistent remote use case exists.

### 14.4 Error taxonomy

- `SCENE_INVALID`: e.g., nonfinite coordinate, self-intersecting polygon, unsupported opening.
- `SOLVER_UNSUPPORTED_GEOMETRY`: supported only in plan-view approximation or first-order reflections.
- `GRID_TOO_LARGE`: cap cells and propose coarser resolution.
- `MATERIAL_PROFILE_MISSING`: substitute only with explicit opt-in assumed profile, not silent zero.
- `SOURCE_OUTSIDE_DOMAIN` / `RECEIVER_INSIDE_WALL`.
- `RESULT_STALE`: discard silently as UI operation, but record in local diagnostics.
- `GPU_UNAVAILABLE` / `GPU_DEVICE_LOST`: fall back where possible.
- `SURVEY_BAD_UNITS`, `SURVEY_BAND_MISMATCH`, `CALIBRATION_UNIDENTIFIABLE`.

User-facing errors should explain what can be fixed, not expose raw stack traces.

---

## 15. Performance, adaptive quality, and operational budgets

These are **engineering targets**, not benchmark measurements. Validate on actual browsers and devices before publishing performance claims.

### 15.1 Suggested P0 budgets

| User-visible event | Proposed target | Test setup |
|---|---|---|
| Initial meaningful visual | < 1.5 s on a representative modern desktop, warm load | No network-dependent engine initialization |
| Drag pointer response | Perceived ≥ 50–60 fps | Render and hit-testing remain responsive |
| Preview field after drag event | P95 < 150 ms for preloaded demo on midrange laptop | Coarse grid, CPU worker |
| Full field after release | P95 < 500 ms for preloaded demo on midrange laptop | ~2,400 cells and authored walls |
| Undo + scene update | P95 < 100 ms excluding solver refresh | Validated scene command |
| Tab switch acoustic ↔ RF | < 200 ms if cached; recompute otherwise | Cached view remains consistent |
| P0 production core JS bundle | Set a measured budget after baseline | Split optional Three/WebGPU modules |
| Persist project | < 250 ms for sample scene | IndexedDB locally |

If these targets prove unrealistic, reduce geometry complexity or grid resolution; don't fabricate interactive animation as a substitute for computation. Benchmarks must report device, browser, solver settings, wall count, grid cells, and sample counts.

### 15.2 Budgeting algorithmic complexity

A naive evaluation across `N` grid cells and `W` walls has approximately `O(N * W)` intersection work for each direct ray. For 2,400 cells and tens of walls this is tractable in a worker, but repeated full-grid recomputation each pointer frame can be expensive.

Optimization sequence:

1. Profile first and preserve a pure reference implementation.
2. Pre-normalize geometries and material lookup arrays.
3. Use coarse grid during drag and debounce exact grid.
4. Cache unchanged scene and physical parameters.
5. Broad-phase intersection culling with uniform grid or BVH.
6. Incrementally invalidate only impacted domain caches.
7. Consider SIMD/WASM or GPU after numerical parity tests.

### 15.3 GPU acceleration criteria

Do not migrate a solver to WebGPU unless profiling shows a meaningful improvement in user experience after including device startup, allocation, buffer upload, compute, readback, and fallback costs. GPU readback every frame can erase the benefit of parallel field evaluation.

Maintain:

- A reference CPU path and identical scene/material inputs.
- Numerical tolerance tests between CPU and GPU on fixed fixtures.
- Browser/driver capability logging locally, without exposing identifying GPU details by default.
- Graceful `GPUDevice.lost` recovery and destruction of old resources.
- Reduced-quality mode for power-constrained devices.

### 15.4 Performance profiling report

At minimum capture:

- `scene_walls`, `doors`, `grid_cells`, `receiver_plane_m`, `band_hz`.
- Solver version, path model and material configuration.
- `compute_ms` (median, P95, P99 over warm and cold runs).
- UI main-thread long tasks and pointer-to-display latency.
- Worker memory growth and retained buffers on repeated edits.
- CPU vs optional GPU parity and total end-to-end latency.

Reject an optimization if it silently changes the numerical model or model precision beyond documented tolerance.

---

## 16. Benchmarks, calibration, and scientific evaluation

### 16.1 Three evaluation layers

1. **Mathematical correctness:** Exact identities, invariants, geometry, reference analytical cases.
2. **Numerical/model agreement:** Agreement with stronger simulation libraries or published simplified models for carefully matched geometry/materials.
3. **Real-world predictiveness:** Comparison with independently gathered physical measurements under recorded conditions.

Do not conflate them. A fast, mathematically self-consistent approximate solver can still make inaccurate site predictions.

### 16.2 P0 analytical benchmarks

Implement the A- and R-series tests from §§8–9 using deterministic authored scenes. Include tolerances, solver commit, and machine-independent reference numbers. Every formula has an executable test; every reference test documents its physical assumptions.

Suggested cases:

| ID | Scene | Expected behavior |
|---|---|---|
| G-01 | Polygon with crossing edges | Reject invalid geometry |
| G-02 | Rotated wall + opening | Intersection through open portion ignored |
| G-03 | Wall moved off direct ray | Direct-path field changes only where path set changes |
| G-04 | Arbitrary camera orbit | Numeric field hash unchanged |
| A-01 | Open field 1 m vs 2 m | Approximately −6.02 dB relative change |
| A-02 | 3.43 m travel | ≈10 ms under assumed speed |
| A-03 | Finite reflecting segment | Reflection only if physically viable |
| R-01 | Free-space 2 m vs 4 m | ≈−6.02 dB received-power difference |
| R-02 | +3 dB AP EIRP | +3 dB prediction at all valid points |
| R-03 | One wall crossed | Exactly one assumed wall-loss contribution |
| R-04 | 5 GHz vs 2.5 GHz at fixed geometry | FSPL difference ≈+6.02 dB if material assumptions held constant |
| S-01 | Same physical scene in two render styles | Identical result arrays |
| S-02 | Two concurrent compute revisions | Only latest result reaches viewport |
| C-01 | A/B with incompatible units | Comparison disabled with explanation |

### 16.3 P1 reference comparison

Use `pyroomacoustics` for selected acoustics cases—especially shoebox rooms with known image-source behavior. A benchmark fixture MUST align dimensionality, boundary assumptions, frequencies, source and receiver positions, reflection order, and material coefficients before comparing results. Don't treat the library as ground truth where its own approximations differ.

For radio, compare the simplified model's algebra against hand-computed reference cases and published propagation formulations. For calibrated prediction, test against independently measured field observations instead of judging by a visually pleasing heatmap.

### 16.4 Proposed research questions

**RQ1 — Explainability:** Can viewers correctly identify the main modeled cause of a field change after interacting with a path inspector, compared with heatmap-only UI?

**RQ2 — Decision consistency:** Do A/B fields with a common legend reduce erroneous conclusions compared with separately normalized maps?

**RQ3 — Calibration generalization:** Does fitting limited material/path-loss parameters on one subset of measurements improve held-out radio RSSI prediction compared with an uncalibrated baseline?

**RQ4 — Computational value:** Does spatial acceleration/adaptive sampling improve perceived update latency without meaningful accuracy loss at receiver checkpoints?

These are proposals. Do not publish positive findings without collecting data, establishing a protocol, and reporting null/negative results as well.

### 16.5 Measurement protocols (P1)

**Radio survey:** Fix AP state, record band/channel, EIRP setting if known, device model, antenna orientation, approximate receiver height, multiple readings per point, scene occupancy, timestamp, and nearby-network conditions. Randomize or spatially balance train/test splits. Avoid placing nearly identical neighboring measurements in both splits when evaluating generalization; such leakage can dramatically flatter error metrics.

**Acoustic measurements:** Prefer a repeatable source and calibrated microphone procedure, controlled room conditions, speaker/microphone positions, temperature, sample rate, sweep/impulse acquisition method, and source loudness. Import an actual measured RIR as observational data. A casual smartphone microphone reading is not equivalent to laboratory-calibrated SPL or a validated RIR.

### 16.6 Metrics

- **Radio:** MAE in dB, median absolute error, RMSE in dB, bias in dB, held-out distribution by room/material count, confidence of measurement procedure.
- **Acoustics:** path travel-time error (ms), RIR arrival-time/energy comparisons, validated frequency-band error (dB) if quantities match, and possibly RT60 error only for a solver that supports reliable RT60.
- **Compute:** time to first result, P95 update latency, peak memory, energy/battery proxies only if measured responsibly.
- **UX:** time to first intervention, ability to correctly interpret A/B delta, and completion of an experimental scenario.

Do not define a universal “physics accuracy” from a mixture of these metrics.

### 16.7 Calibration protocol

1. Freeze the building model, measurement set, and parameter family.
2. Choose a split based on study design; document spatial leakage controls.
3. Fit using training observations only. Bound parameters to plausible ranges.
4. Compute held-out errors for baseline and calibrated models.
5. Show a residual map and cases where calibration becomes worse.
6. Bootstrap by appropriate survey group/block if estimating uncertainty; do not bootstrap spatially correlated points as if independent.
7. Export the exact procedure, random seed, fitted parameters, and hold-out IDs.

Prefer modest, interpretable parameters over a flexible nonlinear model that simply interpolates survey points.

### 16.8 Ablations

- No wall loss vs material-aware wall loss.
- Fixed global material loss vs band-specific values.
- Direct-only vs first-order reflection visualization (acoustic solver permitting).
- Geometry fully known vs deliberately perturbed wall location.
- Coarse grid vs fine grid with fixed receiver checkpoint evaluation.
- No calibration vs fit offset only vs fit material loss.
- Source-only relocation vs wall/door intervention at fixed source.

### 16.9 What not to conclude

A calibrated model that predicts a particular apartment's Wi-Fi RSSI well does not prove it predicts every house well. A WebGPU FDTD simulation with plausible waves does not prove accurate speech intelligibility. The A/B effect in a simplified model reflects that **model**, and may differ in reality. Publish limitations next to every result.

---

## 17. Content, fixtures, model provenance, and demo integrity

### 17.1 Fixture strategy

Seed the application with at least **four versioned authored scenes**:

1. `hallway-door`: opening/closing one doorway in a simple apartment; acoustic direct path.
2. `masonry-ap`: one high-loss assembly, AP relocation, 2.4/5/6 GHz; RF.
3. `open-field`: no internal obstacles; analytical acoustic and RF scaling checks.
4. `reflection-box`: rectangular room with a source/receiver and first-order reflection reference, if reflections ship.

No fake live solve is allowed. Numeric results can be precomputed as immutable fixtures **only if marked “recorded computation”**, with a manifest identifying solver version and the source data that produced them.

### 17.2 Scenario quality bar

- Every scene has an authored title, synopsis, dimension legend, visible interactivity prompt, and physical parameter table.
- Doors and sources are positioned so the change is visually obvious on a modest screen.
- Scenario outcomes must work from deterministic algorithms, not specially authored CSS or hardcoded after-states.
- At least one edit should produce little or no modeled change; not every interactive action is engineered to look dramatic.
- A reviewer can export and rerun the numeric configuration.

### 17.3 Ethical model provenance

Material names alone must not imply factual coefficients. A “brick” template with guessed 12 dB loss, for example, needs a provenance mark `fixture-assumed`, adjustable parameter, and a caveat that construction-specific measured losses vary. Do not reproduce large proprietary standards tables without license review. Prefer self-authored measurements, openly licensed datasets, or user-entered coefficients with attribution.

### 17.4 AI assistance policy

AI may assist plan segmentation or user guidance in P2, but it MUST NOT fabricate numeric physics measurements, measured material performance, or a solver validation result. If an AI-inferred wall has low confidence, the model shows editable proposed geometry and keeps its uncertain provenance. There is no reason to add an LLM to P0.

---

## 18. Privacy, security, trust, and safety

### 18.1 Privacy by architecture

A home floor plan may reveal sensitive details about a person's residence. P0 MUST run locally without automatically uploading scenes or usage traces. Project persistence in IndexedDB must be explained and clearable; exports should warn that geometry and source locations will be included.

No advertising SDKs, third-party embedded analytics, tracking pixels, or hidden room geometry transmission. If telemetry is introduced, require explicit opt-in and prohibit sending raw floorplans/measurements by default.

### 18.2 Upload/import attack surface

- P1 image import: limit decoded dimensions, file size, MIME types, and memory allocation. Reject malformed files with an actionable message.
- JSON import: runtime schema validation, nesting/array size caps, finite-number checks, ID restrictions, prototype-pollution resistance, and no arbitrary code execution.
- SVG import: if supported later, sanitize or rasterize in an isolated context; do not execute embedded script, external references, or arbitrary foreign objects.
- Audio upload (P1): cap duration/size, decode using supported APIs, and do not send it to unknown services.
- URL shares: minimize leakage through referrers and logs; prefer local exports for identifiable buildings.

### 18.3 Safety and claims

- Include an in-product note: **“Illustrative and planning-oriented models. Not a substitute for site measurements or professional design.”**
- Do not give precise guarantees about Wi-Fi reliability, human hearing protection, noise compliance, health, RF exposure, building code, or construction material performance.
- Calibration/validation evidence should raise trust when merited, but never remove context.
- Audio volume management prevents unexpectedly loud bursts.
- Treat source code, fixtures, and uploaded plans as untrusted content at import boundaries.

### 18.4 Secure deployment

Use HTTPS, a conservative Content Security Policy, strict allowed origins, no unnecessary remote script loading, pinned dependencies where possible, automated dependency scanning, and safeguards against oversized assets. When implementing optional `SharedArrayBuffer`/WebGPU audio modes, plan cross-origin isolation headers deliberately rather than relying on fragile deployment-specific hacks.

---

## 19. Observability and diagnostics

### 19.1 Debug panel (P0, developer toggle)

Display:

- Scene revision/hash and solver version.
- Current grid resolution, total/valid cell count, receiver plane height.
- Last accepted request ID; stale responses dropped.
- Worker compute time, total request-to-paint time, cache hit rate.
- Renderer mode, GPU support state, degraded-mode flags.
- Material profile provenance and missing-parameter warnings.

### 19.2 Local structured events

```ts
export type DiagnosticEvent = {
  kind:
    | 'scene-command-applied'
    | 'field-requested'
    | 'field-completed'
    | 'field-result-discarded'
    | 'field-rendered'
    | 'solver-fallback'
    | 'comparison-rejected'
    | 'fixture-validation-failed';
  atMs: number; // performance clock where available
  sceneRevision?: number;
  sceneHash?: string;
  solverId?: string;
  requestId?: number;
  durationMs?: number;
  metadata?: Record<string, string | number | boolean>;
};
```

Never log full floorplan geometry or home-identifying data by default. If diagnostics are exported by the user, require an explicit review screen to inspect payloads.

### 19.3 Error-recovery behavior

- On worker crash: show a nonblocking error, recreate the worker once, and recompute current revision.
- On GPU failure: switch to CPU/Canvas fallback; keep scene and history.
- On invalid imported scene: preserve existing scene, show errors by object/field, and allow a safe preview.
- On storage quota failure: keep the current in-memory project and offer a manual JSON export.
- On audio permission/autoplay restriction: leave simulation fully functional; label audio unavailable.

---

## 20. Quality assurance and test strategy

### 20.1 Unit tests

- Geometry: segment intersection (including collinear/tangent cases), thick-wall and doorway rules, polygon validity, point-in-polygon, coordinate transforms, reflection intersections.
- Unit conversion: meters/feet, hertz/GHz, dB and dBm display, independent log/linear transforms.
- Domain solvers: all cases in §§8–9 and analytical benchmark table.
- Model validation: invalid frequencies, mismatched material band arrays, missing material IDs, negative thickness, bad doors.
- Cache: stable hash under object key reorder; hash changes only for relevant physical changes.
- Compare: cannot subtract `dBm` field from acoustic `dB` field; valid RF A/B difference returns dB.

### 20.2 Property-based tests

Use randomized, valid simple polygons and line segments for:

- Symmetry and endpoint handling of geometric distances.
- Conservation of source/receiver separation under translation and rotation.
- Deterministic scene normalization after serialize/deserialize.
- No `NaN` or unmasked infinities in returned valid result values.
- Editing a display-only field never changes physical solver hash.
- Every opening remains within its parent wall after supported transformations.

Keep a seed in every failing randomized test report for replay.

### 20.3 Golden fixtures

Store versioned reference arrays for a small grid of analytically tractable scenes. To update, a reviewer must approve a physical/numerical change and accompanying changelog, not simply regenerate snapshots whenever CI breaks.

Prefer comparing floating-point arrays with meaningful tolerances. For image regression, use tolerances or pixel-difference thresholds rather than requiring exact GPU-rendered pixels across platforms.

### 20.4 End-to-end browser tests

Minimum flows:

1. Open home without account → sample scene visible and interactive.
2. Drag speaker → displayed field becomes current revision, not initial fixture.
3. Close door → receiver inspector shows changed assumptions/intersection if applicable.
4. Switch Sound → Wi-Fi → results/units/legends switch independently.
5. Save baseline → move AP → compare → actual dB difference shown.
6. Change only camera → field hash and grid values unchanged.
7. Undo edit → physical scene restored, repeatable result.
8. Export JSON → import in fresh browser context → numerical result same within tolerance.
9. Force stale worker responses → latest input always wins.
10. Simulate missing WebGPU → CPU-backed experience works.
11. Keyboard-only use → edit source numerically and compare.
12. Reduced-motion mode → no excessive field animation and all controls functional.

### 20.5 Accessibility checks

Automated axe-style scans plus manual keyboard and screen-reader workflows. Use numeric control alternatives and object lists to avoid making canvas drag a prerequisite. Verify charts have textual numeric summaries and palette meaning is communicated without relying only on color.

### 20.6 Validation gate

A P0 release cannot ship until analytical acoustic and RF tests pass and the public UI states its approximate model boundaries clearly. A P1 scientific release additionally requires reference comparisons and held-out measurement reporting. Quality screenshots are irrelevant to this gate.

---
## 21. Milestones and execution roadmap

Estimated timelines assume one experienced full-stack engineer familiar with TypeScript and browser graphics, part-time specialist review for physics, and no external calibration campaign. **These are planning estimates, not commitments.** Work may extend substantially if custom geometry editing, real-time DSP, or cross-browser support is harder than expected.

### M0 — Scope and design freeze (3–5 focused days)

Deliver:

- Read this handoff and create `docs/PHYSICS_ASSUMPTIONS.md` that separates both solvers.
- Select one rendering approach for P0 based on quick prototypes: Canvas + isometric projection vs Three.js.
- Draw apartment in metric coordinates and write initial fixture schema.
- Decide source height, receiver plane height, reference-distance convention, default frequency, and illustrative material values.
- Implement and test first analytical identities in headless TypeScript.
- Build one static visual mock to prove that the building, controls, and data legends are legible at 1280 × 800.

**Exit:** Every numerical claim intended for P0 has an explicit model/assumption owner and a test strategy. No WebGPU implementation yet.

### M1 — Deterministic physics vertical slice (1–2 weeks)

Deliver:

- Validated metric building scene and stable IDs.
- Source movement command, undo/redo, scene hash, opening state.
- Direct-path acoustics and RF FSPL + assumed multiwall loss.
- Pure grid evaluators in workers with revision guards.
- Basic top-down canvas viewport, legend, receiver inspector.
- Golden fixtures and math regression tests.

**Exit:** Move speaker or AP, change door, and see genuinely recomputed values. No fake data animation. Tests A-01, A-02, R-01, R-03, and R-05 pass.

### M2 — Portfolio-grade interaction and presentation (1–2 weeks)

Deliver:

- Polished 2.5D cutaway, scene selections and pointer affordances.
- Guided sound and RF scenarios, responsive controls and keyboard alternatives.
- Snapshot A/B/Delta, shared scales, independent source/receiver inspector.
- IndexedDB storage, versioned JSON export/import.
- CPU graceful fallback, dynamic quality, basic performance panel.
- Accessibility and representative-browser E2E smoke tests.

**Exit:** A reviewer understands the product in 15 seconds and completes a comparison in under two minutes; the result can be exported and re-imported with stable numeric outputs.

### M3 — Advanced interaction and physical credibility (2–4 weeks)

Deliver:

- Stronger geometry editing: wall manipulation, door snapping, accurate local heights.
- Optional bounded acoustic specular reflection explorer with explicit path list.
- Acoustic preview audio with safe default volume and honesty labels.
- Performance profiling, spatial acceleration, deterministic engine reports.
- More curated benchmarks, published solver documentation.

**Exit:** Edited geometry does not break model invariants; the app distinguishes direct, heuristic, and reflected mechanisms clearly.

### M4 — Measurement and calibration (3–5 weeks, dependent on data collection)

Deliver:

- Floorplan image calibration/tracing; per-domain material provenance editor.
- CSV survey import, data visualization, controlled calibration/held-out evaluation.
- Validated reference comparisons against external acoustic tools.
- Exportable reproducibility bundle and documented negative results.

**Exit:** Calibration is measured on holdout data, provenance is available at every relevant parameter, and reference benchmark limitations are published.

### M5 — Selective research extensions (ongoing)

Choose one based on measured bottlenecks and genuine scientific motivation: low-frequency GPU wave acoustics, richer 3D geometry, frequency-dependent construction profiles, real RF site surveys, or a new physics domain. Do **not** attempt all simultaneously.

---

## 22. Prioritized engineering tickets

Ticket IDs are intended to become GitHub issues. Dependencies are explicit, and each item has a deliverable verifiable in code or UI. A small team may split parallel, independent tasks after stable schemas are in place.

| Ticket | Pri. | Depends | Deliverable and acceptance |
|---|---|---|---|
| IP-001 | P0 | — | Monorepo, strict TS, CI, formatting, test runner; reproducible setup |
| IP-002 | P0 | 001 | Runtime scene and material schemas; reject invalid documents |
| IP-003 | P0 | 002 | `hallway-door` fixture with exact metric geometry and IDs |
| IP-004 | P0 | 002 | Geometry intersections, point-in-polygon, opening detection and tests |
| IP-005 | P0 | 002,004 | Scene command reducer, revision, history, stable deterministic hash |
| IP-006 | P0 | 003,004 | Pure acoustic direct solver with A-series analytical tests |
| IP-007 | P0 | 003,004 | Pure RF FSPL + multiwall solver with R-series tests |
| IP-008 | P0 | 006,007 | Shared `FieldQuery` / `FieldResult` and unit-aware grid sampler |
| IP-009 | P0 | 008 | Worker orchestration, stale response guard, preview/full quality |
| IP-010 | P0 | 005,008 | 2D editor viewport and hit testing, select/move emitter/receiver |
| IP-011 | P0 | 008,010 | Numeric heatmap and mask, accurate legends and controls |
| IP-012 | P0 | 006,007,010 | Inspector with computed path contributions, material IDs, warnings |
| IP-013 | P0 | 005,008 | Immutable baseline/branch snapshots with compatibility validator |
| IP-014 | P0 | 011,013 | A/B split, reveal, delta; shared scale and signed dB legend |
| IP-015 | P0 | 010,011 | Architectural visual design and isometric viewport |
| IP-016 | P0 | 005 | Local persistence; validated import/export, schema migration policy |
| IP-017 | P0 | 009,015 | Capability fallback and responsive adaptive quality |
| IP-018 | P0 | 012,014 | Three-step guided story with meaningful computed outcomes |
| IP-019 | P0 | 010,014 | Keyboard editing, reduced motion, screen reader numeric summaries |
| IP-020 | P0 | 016–019 | Playwright release scenarios, cross-browser compatibility check |
| IP-021 | P0 | 006–008 | Numerical verification README, model limitations, provenance flags |
| IP-022 | P1 | 004,005 | Editable wall/door tools, topology validation and snapping |
| IP-023 | P1 | 006,022 | Bounded image-source early reflection paths + tests |
| IP-024 | P1 | 023 | Optional RIR playback prototype, volume/crossfade/audio safeguards |
| IP-025 | P1 | 004,016 | Floorplan image calibration and manual tracing |
| IP-026 | P1 | 007,016 | RSSI survey ingestion with schema and spatial sample visualization |
| IP-027 | P1 | 026 | Calibrator with train/test discipline and parameter identifiability checks |
| IP-028 | P1 | 023 | External acoustics benchmark comparison harness |
| IP-029 | P1 | 016,027,028 | Export report + manifest, error charts, uncertainty notes |
| IP-030 | P1 | 009,011 | Profiling, incremental geometry index, cache improvements |
| IP-031 | P2 | 006,030 | WebGPU FDTD acoustic prototype with stability and analytical tests |
| IP-032 | P2 | 007,026 | Richer RF model and calibration trials, with validation gate |
| IP-033 | P2 | 022 | True 3D volumetric scene/solver feasibility study |
| IP-034 | P2 | 029 | New physical domain design proposal with governing equations/tests |

**Critical path for P0:** IP-001 → IP-002 → IP-004 → IP-006/IP-007 → IP-008 → IP-009/IP-011 → IP-013/IP-014 → IP-018/IP-020. Graphics polish can progress in parallel once rendering contracts are stable.

**Implementation prioritization:** If a release milestone slips, cut advanced wall editing, RIR playback, GPU simulation, advanced calibration, and ornamental motion before cutting numerical correctness, provenance, comparison, or keyboard access.

---

## 23. Definition of done and release checklists

### 23.1 P0 launch gate

- [ ] A functional, authored building displays without authentication, backend, AI API, or WebGPU.
- [ ] Sound and Wi-Fi are separate functioning solvers consuming identical canonical geometry.
- [ ] Dragging a speaker/AP genuinely recomputes numeric fields with scene revision protection.
- [ ] Open/closed doors and material changes produce solver-consistent results.
- [ ] Renderer shows correct units, color scale, valid-domain mask, and stale/preview states.
- [ ] Absolute SPL is not shown for uncalibrated speaker, and Wi-Fi heatmap is not mislabeled throughput.
- [ ] Receiver inspector cites all included direct/wall terms and explicitly lists major omissions.
- [ ] Baseline/branch are immutable; comparison uses compatible solver settings and a common color scale.
- [ ] Camera and theme changes do not alter field results.
- [ ] At least two negative-control or invariant demonstrations are included.
- [ ] Export/re-import reproduces the original modeled values within documented tolerances.
- [ ] Supports keyboard editing, low-motion mode, numeric summaries, and mobile plan view.
- [ ] No floorplan or receiver coordinates automatically sent to an external service.
- [ ] Analytical geometry, acoustic, and RF tests pass in CI.
- [ ] Browser E2E flows cover first experience, model switching, comparison, and fallback.
- [ ] Real performance measurement is recorded on at least two representative devices.
- [ ] README states original contribution and existing comparable projects, without novelty inflation.
- [ ] Screenshots and public claims are generated from actual working functionality.

### 23.2 P1 credibility gate

- [ ] All imported measurements have units, collection context, and source/provenance fields.
- [ ] Calibration and held-out evaluation are distinguished at storage, API, and UI levels.
- [ ] No validation figure comes exclusively from training measurements.
- [ ] Reference comparisons align units, dimensions, model assumptions, and boundary cases.
- [ ] Material parameter data sources and licenses are documented.
- [ ] RIR/RT60 claims are backed by the advanced model and appropriate checks, if implemented.
- [ ] A full exported experiment can be replayed at a documented code version.
- [ ] Null or negative calibration outcomes are reportable, not hidden.
- [ ] User-entered and inferred geometry uncertainties appear in resulting conclusions.

---

## 24. Risks, failure modes, and mitigations

| Risk | Severity | Early warning | Mitigation |
|---|---|---|---|
| “Beautiful fake physics” | Critical | Field movement disconnected from numeric data | Numeric result contract first; fixtures/test paths drive visualization |
| Overclaiming 3D simulation | High | 2D heatmap presented as room-accurate field | Solver badge, dimensionality tooltip, limitations visible |
| Confusing dB with dBm | High | Same legend/color range reused for different domains | Discriminated quantity types and tested formatter/comparator |
| Incorrect sound multipath sums | High | dB path gains simply added | Restrict P0 to direct model; validate energy/complex algorithms before use |
| Misleading wall material defaults | High | Presets presented as authoritative | Explicit assumed provenance and user-editable coefficients |
| WebGPU or browser compatibility | Medium | Blank viewport on unsupported browser | CPU worker model and Canvas fallback as canonical release path |
| Race conditions on drag | High | Old field appears after new emitter position | Revision/abort mechanism and E2E forced-out-of-order tests |
| Geometry complexity creep | High | Room topology bugs consume entire schedule | Authored scene first; constrain editor operations for P0 |
| RF predictive inaccuracy | High | “Coverage guarantee” implied by planner UI | Strict wording, measurement import, held-out residuals |
| Privacy of floor plans | High | Auto-upload or URL leak | Default local-first, explicit sharing, private exports |
| Solver/render coupling | High | Engine imports Three/Vue and cannot be tested headlessly | Pure domain packages; typed result boundary |
| Premature WASM/WebGPU | Medium | Extensive GPU code, no usable experiment | Performance evidence before acceleration |
| Too many physics domains | High | Airflow, heat, lighting, sound, RF all half-complete | Two complete P0 quick models; one P1 validation priority |
| Calibration overfitting | High | Great “accuracy” on fit points only | Spatially separated holdout and parameter bounds |
| Audio suggests certified realism | Medium | Users hear stylized preview presented as measured | Explicit preview label, published audio-chain limitations |

### 24.1 Immediate escalation rules

If the engine cannot pass basic analytical tests, do not continue UI polish. If two model interpretations disagree on what the heatmap measures, freeze the UX and fix the quantity contract. If a P0 drag causes long main-thread blocking, move computation into a worker before making the scene prettier. If visual spectacle conflicts with model truth, model truth wins.

---

## 25. Open decisions with proposed defaults

These decisions should be recorded as ADRs before or during M0. Defaults are supplied to avoid blocking implementation.

| Decision | Default | Reason / alternative |
|---|---|---|
| Product name | Invisible Physics | Clear portfolio hook; trademark/domain check before public branding |
| First domain | Acoustics | Strong visible/acoustic interaction and explainable travel time |
| Second domain | RF | Immediately useful second phenomenon on same floor plan |
| Initial geometry | Authored single-level apartment | Ensures quality and avoids early image recognition scope |
| Acoustic P0 solver | Free-field direct loss + explicit heuristic wall term | Honest bounded computation, easy to test |
| Acoustic wave simulation | No in P0 | Already nontrivial prior art; validation/performance risks |
| Acoustic listening preview | Optional, muted, illustrative | Do not let DSP delay core product |
| Radio P0 solver | FSPL + frequency-specific assumed assembly losses | Simple and auditable baseline |
| Unit system | SI internally, localized UI | Physics clarity |
| Receiver plane | Explicit per-mode setting | Prevent hidden geometry assumptions |
| View mode | Default 2.5D / toggle plan view | Visual differentiation and geometric editing clarity |
| Computation | Pure TypeScript Worker | Portable, testable, deployable |
| Persistent storage | IndexedDB | Privacy, cost, simplicity |
| Rendering field | CPU numeric grid + Canvas texture | Fallback and reproducibility first |
| Isometric rendering | Orthographic Three.js only if measured bundle/perf acceptable | A clean Canvas projection may suffice |
| Material values | Labeled illustrative by default | Prevent unjustified claims |
| Comparison | Immutable snapshot and difference grid | Stronger technical narrative than unbounded freeform editor |
| Calibration | P1 user-supplied measurements | Do not build ungrounded “AI calibration” |
| Source licence | Evaluate MIT or Apache-2.0 for original code | Check bundled asset and dependency licenses separately |
| Hosting | Static/edge | No service costs, private projects never need upload |

**Decisions requiring specialist review:** validity of acoustic wall-transmission shortcut; receiver and source height convention; role of first-order reflections in P1; applicability of RF material assumptions; choice of survey protocol; any statements intended to be interpreted as physical measurement guidance.

---

## 26. Public README, portfolio case study, and presentation

### 26.1 Proposed README opening

> **Invisible Physics** makes the hidden behavior of a building explorable. Move a speaker, close a door, or relocate a Wi-Fi access point inside a small, editable architectural model. The browser recomputes predicted acoustic and radio fields, explains the assumptions behind each result, and lets you compare physical changes using reproducible scenarios. It is an educational and experimental tool—not a replacement for instrumented acoustic or RF surveys.

> **Try the instant demo:** no sign-in, API key, upload, or dedicated GPU required. Numerical solvers and example scenes are open source and tested against analytical reference cases.

### 26.2 Portfolio card composition

**Hero image:** an architectural apartment cutaway, one room warm/bright and another attenuated, visible speaker/AP source point, sparse physical-field overlay. This image MUST be captured from the running application.

**Headline:** *See what walls hide.*

**Subheadline:** *An interactive building laboratory for sound and wireless signals.*

**Primary action:** `Move the speaker`.

**Secondary action:** `Explore the physics`.

**Engineer-facing detail:** click `How it works` to see the canonical scene schema, field solver interfaces, benchmark table, performance report, and limitations.

### 26.3 Suggested case study outline

1. The problem with invisible building behavior.
2. Why existing acoustic and RF tools were not simply reimplemented.
3. One building representation for independent numerical solvers.
4. Numerical truth vs beautiful visualization.
5. Browser worker orchestration and latency optimizations.
6. How paired comparisons avoid misleading colormap interpretation.
7. Where assumptions fail, including measured disagreement.
8. What performance and validation actually showed.
9. Next research question and what was deliberately left out.

**Case study integrity:** Replace all illustrative values and targets with measured data before release. A screenshot of a colorful heatmap is not itself evidence of accuracy.

---

## 27. Candidate future physical domains

The original concept can ultimately extend beyond sound and Wi-Fi, but domains should be selected by how demonstrable, physically valid, and independently testable they are—not because they offer attractive animations.

| Domain | First comprehensible demo | Major blocker | Priority |
|---|---|---|---|
| Daylight/shadow | Move window/time; see sunlight patches | Geolocation, solar ephemeris, glazing and 3D occlusion | Plausible P2 |
| Thermal conduction | Add insulation; see temperature evolution | True boundary conditions, materials, heat capacities, HVAC | P2 research |
| Indoor airflow | Open a window; see circulation | CFD/turbulence, pressure boundary conditions, ventilation | Long-term only |
| Vibrational transmission | Move machine; see structure-borne vibration | Structural dynamics, detailed material/connection model | Specialist research |
| RF multipath | Move AP; see fading/interference patterns | Phase, dielectric constants, antenna characteristics, 3D geometry | Specialist P2 |
| Low-frequency sound waves | Move source; observe modal patterns | FDTD spatial/temporal resolution, boundaries, validation | Best candidate for GPU research |
| Indoor visibility/privacy | Stand at window; inspect lines of sight | Mostly geometry; limited physical complexity | Useful utility, not a flagship solver |

Recommended next physics research extension: **one validated acoustic wave equation example** that clearly reveals phenomena the geometric P0 model misses—diffraction and interference—accompanied by side-by-side disagreement visualization. Avoid claiming the 2D wavefield numerically predicts real 3D sound levels.

---

## 28. References and technical reading

The following sources were checked as background for this **October 2026 planning document**. They support the existence of tools, standards, APIs, and model families; they do not validate the proposed implementation or its output. Verify current releases and licensing before copying algorithms, tables, or code.

1. **Resona — real-time browser acoustics (2D FDTD and ray tracing)**. Relevant prior art for GPU acoustics, geometric early reflections, and Web Audio integration. https://github.com/LeeeeT/resona
2. **SignalPlan — browser-based Wi-Fi coverage planner**. Relevant prior art for floorplan editing, model materials, RF maps, calibration, and multilevel planning. https://github.com/NC4321/SignalPlan
3. **pyroomacoustics**. C++/Python room image-source modeling, ray tracing, impulse responses, and simulation references. https://pyroomacoustics.readthedocs.io/en/stable/
4. **ITU-R P.1238-13 (September 2025)**. Propagation data and prediction methods for indoor radio systems. https://www.itu.int/rec/R-REC-P.1238-13-202509-I/en
5. **ITU-R P.2040-4 (September 2025)**. Effects of building materials and structures on radiowave propagation. https://www.itu.int/rec/R-REC-P.2040
6. **Room EQ Wizard (REW)**. Measurement and analysis workflows; useful reference for how acoustic measurements are presented and compared. https://roomeqwizard.com/
7. **REW help / Room Simulation and Impulse Response**. https://www.roomeqwizard.com/help.html
8. **MDN: WebGPU API**. Browser capability restrictions and core GPU architecture. https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API
9. **MDN: GPUDevice.lost**. Handling WebGPU device-loss cases. https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/lost
10. **MDN: WorkerNavigator.gpu**. Availability of WebGPU from workers on supported browsers. https://developer.mozilla.org/en-US/docs/Web/API/WorkerNavigator/gpu
11. **MDN: AudioWorklet**. Low-latency custom audio processing and secure-context constraints. https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet
12. **MDN: ConvolverNode**. Browser convolution with an impulse-response buffer. https://developer.mozilla.org/en-US/docs/Web/API/ConvolverNode/ConvolverNode
13. **Web Audio API specification**. Audio node processing and playback behavior. https://webaudio.github.io/web-audio-api/
14. **WebGPU specification**. Buffer, device, shader, and compute semantics. https://gpuweb.github.io/gpuweb/
15. **Three.js docs**. Orthographic camera and renderer technology; choose production APIs after checking current version. https://threejs.org/docs/
16. **ITU Recommendations index**. Confirm whether later revisions supersede P.1238 or P.2040 before shipping a technical reference. https://www.itu.int/rec/R-REC-P/en

**Caution:** The reference links establish general model families and capability availability, not permission to reproduce proprietary standard tables or evidence of benchmark superiority. For documentation involving acoustic ISO standards or ITU numerical parameter tables, check the exact scope and publication rights.

---

## 29. Coding-agent kickoff instructions

Copy this prompt after adding the specification to the repository as `docs/INVISIBLE_PHYSICS_SPEC_HANDOFF.md`:

```text
Implement Invisible Physics P0 following docs/INVISIBLE_PHYSICS_SPEC_HANDOFF.md.

Start with milestone M0 and tickets IP-001 through IP-012. Build one real,
completely functional vertical slice before adding advanced rendering.

Use Nuxt 4 + Vue 3 + strict TypeScript, with pure testable packages for
canonical building geometry, acoustic quick model, radio quick model, and
field sampling. The initial app must run without authentication, any
remote solver, AI API keys, or WebGPU support.

Physical units and numerical correctness are requirements. Geometry is
stored in meters. Sound P0 outputs a clearly labeled modeled relative
direct-path level/attenuation in dB; it is NOT calibrated absolute SPL.
Radio P0 outputs approximate received power in dBm from documented FSPL
and distinct, assumed wall-loss parameters; it is NOT Wi-Fi throughput.

Keep both solvers separate and give them the same validated canonical scene.
Implement computational fields as transferable numeric arrays from Web
Workers; render them with honest quantity-specific legends and validity
masks. Do not hardcode heatmap after-states or let render animations pretend
to be physical computation.

Start with the authored hallway/door demo, then add AP and masonry examples.
The first visitor interaction must be immediately understandable: drag a
speaker, observe genuinely updated numeric field, click a receiver to read
its source-to-point model explanation. Build immutable baseline/branch
comparisons only after this core computation works. Never silently compare
dB and dBm, or independently rescale two A/B maps.

Write analytical geometry/acoustic/RF tests first. Validate 6.0206 dB
inverse-distance behavior, +3 dB EIRP linearity, single-count wall
intersections, doorway behavior, invalid geometry rejection, and stale
worker message handling. Support keyboard numeric editing and reduced
motion from the first usable scene.

Do not implement a WebGPU FDTD simulator, AI floorplan recognition,
calibration fitting, full 3D propagation, multi-floor planning, or complex
DSP in this initial sprint. Treat all unmeasured material profiles as
illustrative assumptions with visible provenance labels.

After the vertical slice passes tests, continue IP-013 through IP-021,
then document which claims are demonstrably supported and what remains.
Never fabricate solver benchmarks, measurement accuracy, research results,
or implementation status.
```

---

## Appendix A. Minimal deterministic P0 fixture

This fixture is schematic. A complete production fixture should include multiple rooms with a topology validated by the scene schema and all necessary domain profiles.

```json
{
  "schemaVersion": 1,
  "id": "example-open-field",
  "title": "Open-field reference",
  "revision": 1,
  "levels": [
    {
      "id": "level-1",
      "elevationM": 0,
      "ceilingHeightM": 2.7,
      "boundary": [[0, 0], [10, 0], [10, 8], [0, 8]],
      "wallIds": [],
      "floorMaterialId": "illustrative-floor",
      "ceilingMaterialId": "illustrative-ceiling"
    }
  ],
  "walls": [],
  "openings": [],
  "materials": [
    {
      "id": "illustrative-floor",
      "name": "Reference floor (not modeled in P0)",
      "display": { "color": "#c5bdb0" }
    },
    {
      "id": "illustrative-ceiling",
      "name": "Reference ceiling (not modeled in P0)",
      "display": { "color": "#f0ede7" }
    }
  ],
  "emitters": [
    {
      "id": "speaker-1",
      "kind": "speaker",
      "position": [2, 2, 1.2],
      "orientationRad": 0,
      "calibratedAbsoluteSpl": false
    },
    {
      "id": "ap-1",
      "kind": "access-point",
      "position": [2, 2, 1.2],
      "eirpDbm": 18,
      "orientationRad": 0
    }
  ],
  "probes": [
    {
      "id": "probe-sound",
      "position": [4, 2, 1.2],
      "label": "Open-field receiver",
      "phenomenon": "acoustics"
    },
    {
      "id": "probe-rf",
      "position": [4, 2, 1.2],
      "label": "Open-field radio probe",
      "phenomenon": "radio"
    }
  ]
}
```

Expected **relative acoustic** change, using a one-meter far-field reference: `-20 log10(2) ≈ -6.0206 dB` at a 2 m receiver. This is *not* `-6.0206 dB SPL`.

For the RF fixture, at `f = 2.4e9 Hz`, `d = 2 m`, `EIRP = 18 dBm`, `Gr = 0 dBi`, and no wall/other losses:

```text
FSPL = 20 log10(2) + 20 log10(2.4e9) - 147.55
     ≈ 46.06 dB
Predicted received power ≈ 18 - 46.06 = -28.06 dBm
```

This is an analytical test under the idealized free-space baseline, **not** a realistic typical apartment measurement. The example assumes both source and receiver are outside model near-field restrictions.

---

## Appendix B. Given/When/Then acceptance scenarios

### B1 — Speaker drag updates actual field

**Given** the `hallway-door` scene loads with speaker position S0 and a completed acoustic grid, **when** the visitor drags the speaker to S1, **then** a new physical input hash and computation request are produced, the field eventually displays the new revision, and the result values derive from the acoustic solver rather than preauthored animation.

### B2 — Closed-door attenuation is labeled as an assumption

**Given** a ray goes through a doorway and the P0 acoustic shortcut enables illustrative transmission penalties, **when** the door closes, **then** the inspector lists a new assumed door-related attenuation contribution and explicitly states the model excludes diffraction and full-wave transmission.

### B3 — Wi-Fi is not speed

**Given** the user switches to Wi-Fi mode, **when** the field appears, **then** the legend says `Predicted received power (dBm)` and the inspector shows the selected frequency, source EIRP, path-loss formula, and effective wall assumptions. It does not promise connection reliability, throughput, or latency.

### B4 — Branch comparability

**Given** baseline A uses radio at 2.4 GHz and branch B is currently set to acoustic at 1 kHz, **when** compare is selected, **then** it is rejected or requires harmonized recomputation. There is no mixed-domain subtraction.

### B5 — Concurrency correctness

**Given** a worker receives scene revisions 9 and 10, **when** revision 10 completes before revision 9, **then** revision 9's late response cannot overwrite revision 10 in the visible field.

### B6 — Camera-only change

**Given** fixed scene and solver inputs, **when** the user orbits the isometric camera, **then** the engine input hash and numeric result remain unchanged; only projected rendering changes.

### B7 — Copyable experiment

**Given** a scenario with baseline and edited door state, **when** the user exports and imports the project in a clean browser profile, **then** normalized scene IDs, solver parameters, physical inputs, and numeric output agree within published tolerance.

### B8 — Unsupported browser

**Given** `navigator.gpu` is unavailable, **when** a visitor enters the demo, **then** the CPU/Canvas-backed acoustic and RF modes remain functional. An optional enhancement may be unavailable, not the app itself.

---

## Appendix C. Suggested numerical implementation outline

```ts
// Example only. Not a complete, production-grade ray/wall implementation.
// Run in the pure engine package and test against reference fixtures.

function fsplDb(distanceM: number, frequencyHz: number): number {
  if (!Number.isFinite(distanceM) || distanceM <= 0 ||
      !Number.isFinite(frequencyHz) || frequencyHz <= 0) {
    throw new Error('Invalid physical inputs');
  }
  return 20 * Math.log10(distanceM) +
    20 * Math.log10(frequencyHz) - 147.55;
}

function rfPoint(
  source: AccessPoint,
  receiver: Vec3,
  frequencyHz: number,
  receiverGainDbi: number,
  wallLossesDb: readonly number[],
  minValidDistanceM: number
) {
  const [dx, dy, dz] = receiver.map(
    (value, i) => value - source.position[i]
  ) as Vec3;
  const distanceM = Math.hypot(dx, dy, dz);
  if (distanceM < minValidDistanceM) {
    return { valid: false, reason: 'Near-field / model-distance limit' };
  }
  const wallLossDb = wallLossesDb.reduce((sum, loss) => sum + loss, 0);
  const receivedDbm = source.eirpDbm + receiverGainDbi -
    fsplDb(distanceM, frequencyHz) - wallLossDb;
  return { valid: true, distanceM, receivedDbm, wallLossDb };
}

function acousticDirectRelativeDb(distanceM: number, referenceM = 1): number {
  if (distanceM <= 0 || referenceM <= 0 ||
      !Number.isFinite(distanceM) || !Number.isFinite(referenceM)) {
    throw new Error('Invalid distance');
  }
  return -20 * Math.log10(distanceM / referenceM);
}
```

Geometry raycasting MUST be a separately tested function that produces distinct wall assembly crossing records. **Do not** substitute the prototype's `wallLossesDb` parameter with losses derived from rendered polygon pixels; instead, calculate intersections in world coordinates and resolve wall opening/material semantics.

---

## Appendix D. Model and feature release labels

Use consistent tags so visitors don't confuse marketing with measurements:

| Label | Meaning | Acceptable example |
|---|---|---|
| `Computed approximation` | Deterministic simplified solver, not validated on-site | Acoustic direct-path attenuation |
| `Assumed material values` | Authored parameters without validated source | Demo door transmission penalty |
| `Literature-based inputs` | Parameters derived from explicitly cited references | Specific RF construction data at a stated band |
| `Recorded computation` | Numeric result computed earlier from a named solver/version | Static guided-demo baseline snapshot |
| `Measured at site` | Actual observation with acquisition details | Survey RSSI observation point |
| `Calibrated to survey` | Parameters estimated on fitting observations | Radio wall loss calibrated on training set |
| `Validated on holdout` | Error measured on independent observations | Held-out MAE, with survey context |
| `Illustrative audio` | Perceptual rendering without validated physical reproduction | Simple PannerNode/reverb preview |
| `Validated numerical solver` | Passes documented analytical/reference tests | Tested image-source reflection module |

No result should receive the `Validated on holdout` label solely from synthetic scenarios or reference-library comparisons; those are distinct forms of validation.

---

## Appendix E. Design review prompt for technical advisors

Before public release, ask an acoustics reviewer and an RF reviewer to inspect:

1. Which assumptions are tolerable for an interactive educational demo and which descriptions remain misleading?
2. Are the chosen source heights, wall intersection semantics, and receiver planes physically interpretable?
3. Is any material property mislabeled (especially absorption vs transmission, attenuation vs propagation)?
4. Are the numerical self-tests sufficient to catch implementation bugs without implying real-world prediction accuracy?
5. Does the documentation distinguish 2D illustration, 2.5D geometric modeling, and genuinely 3D/volumetric methods?
6. Are wall, opening, and effective-material parameters presented as specific construction assumptions rather than universal physical constants?
7. What minimum measurement protocol would make calibration and held-out reporting meaningful?
8. What one additional benchmark would most likely reveal a failure that the current tests miss?

**Final implementation principle:** Ship a small, mesmerizing, inspectable physics experiment that is mathematically honest and genuinely interactive. Prefer a restrained but correct model whose behavior can be demonstrated and challenged over a more spectacular simulation that cannot be explained or reproduced.
