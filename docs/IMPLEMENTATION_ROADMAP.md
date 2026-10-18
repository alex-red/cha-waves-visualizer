# Implementation roadmap and backlog

Status: implementation underway; see [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for current evidence. Research direction adjusted **October 17, 2026**.

## Research destination and active priority

**Research into using waves to map 3D visual space, augmented by AI.** The ultimate ambition is to map any 3D space and fill out its digital representation using AI reconstruction and completion, including Gaussian splatting. The [spatial research plan](SPATIAL_RESEARCH_PLAN.md) supplies the investigation, primary-source references, data requirements and SPATIAL-01–07 milestones.

The research path is supported wall evidence → registered 3D observations → supported 3D structure and fusion/localization → observed visual reconstruction → constrained AI completion → broader environments. These stages have distinct exits: an uploaded recording, a synthetic rectangle, a rendered cutaway and a splat viewer each demonstrate different things. Current physical room mapping remains unvalidated.

**Next physical gate:** ECHO-04/05's controlled known-wall test. **Independent offline work:** SPATIAL-02's coordinate/timing/provenance contract and SPATIAL-05's bounded visual-data spike can start while that gate remains open. Acoustic gains require held-out evidence and sensor ablations. Unknown, estimated and generated regions remain explicit.

The CW backlog below remains the educational visualizer's release plan. Further UI polish, RF prediction and time-domain wave simulation are optional branches relative to the spatial research goal. They are not prerequisites for the first reconstruction proof. Keep existing product release gates when shipping that product; do not treat its 2.5D scene as an unknown-space 3D reconstruction.

### Next reviewable increments

The [minimal spatial observation/pose bundle and offline replay CLI](SPATIAL_BUNDLE.md) are implemented together as the first SPATIAL-02 software slice. The [synthetic one-plane 3D reference/evaluator](SPATIAL_PLANE_REFERENCE.md) is implemented within a fixed-speaker scope, preparing SPATIAL-03 without passing its physical gate. The [calibrated synthetic-stereo reference/evaluator](SPATIAL_IMAGE_REFERENCE.md) now supplies a bounded image-to-geometry baseline with two held-out views; its inputs are self-authored RGB images and known camera calibration, and its splats use stereo-derived heuristics rather than 3DGS optimization. The [Research Lab inspection workspace](SPATIAL_WORKSPACE.md) exposes these tools and local visual splat viewing, without replacing the field visualizer or active Echo review. Real-image reconstruction, independent registration and physical/independent held-out evaluation remain open visual gates. The [implementation sequence](SPATIAL_RESEARCH_PLAN.md#next-implementation-increments) gives bounded scopes, file ownership, tests and explicit exclusions. Existing scan/project contracts are preserved; new pure modules use the current layout.

The known-wall physical test remains an independent next action; it does not wait for these modules or a viewer. General room fitting and physical fusion claims remain gated by its evidence. AI completion follows an inspectable observed reconstruction and supported structural constraints; research progress must report the acoustic contribution separately from visual quality.

## Visualizer milestones and exits

The original visualizer estimates below assume one experienced engineer, scoped P0 editing and occasional specialist review; they are effort ranges, not remaining-work estimates or calendar commitments. The planning baseline estimated a polished P0 at **7–10 engineering weeks** including integration contingency, data-dependent P1 at another 4–8+ weeks, and research P2 as unbounded. The spatial research milestones have no delivery estimate yet.

| Milestone | Effort | Deliverable | Exit gate |
|---|---|---|---|
| M0: decisions and spikes | 3–5 days | Locked compatible stack, static composition prototype, exact fixture, type/worker/renderer spike | Production shell builds; plan/cutaway fallback documented; quantity and geometry semantics agreed |
| M1: numerical vertical slice | 1–2 weeks | Canonical scene, both point/grid solvers, worker, plan, probe explanation | Speaker/AP/door changes yield tested current numeric results |
| M2: experiment workspace | 1–2 weeks | Constrained wall editing, history, immutable comparison, local persistence/import/export | Geometry stays valid; full reproducible A/B flow works |
| M3: visual and interaction finish | 1–2 weeks | Cutaway, narrative, responsive layouts, complete accessible workflows | Polished meaningful experience at review sizes and fallback modes |
| M4: release hardening | 1–2 weeks | Browser matrix, budgets, recovery, privacy/static deployment verification, docs | P0 release checklist and evidence complete |
| P1: personal-home workflows | 4–8+ weeks | Image tracing, supported reflection/RIR work, survey and holdout evaluation | Actual imported/home data and evidence support each shipped claim |
| P2: one research extension | Research-dependent | Wave solver or richer RF/3D feasibility | Validated new phenomena, performance, boundaries, and disagreement UI |

Accessibility and testing begin in M1; M3 finishes them rather than postponing them. A static M0 prototype demonstrates art direction only and must not claim live physics. Keep a roughly one-week integration contingency within the overall P0 range; reassess after M0.

## P0 tickets

IDs use CW to distinguish this adopted backlog from source IP tickets. Each row is reviewable work, not an external issue already created.

| ID | Milestone | Dependencies | Deliverable and acceptance |
|---|---|---|---|
| CW-001 | M0 | — | Bun 1.4.3/Nuxt workspace, strict checks, CI; production static build and documented exact versions |
| CW-002 | M0 | 001 | Runtime scene/material/solver schemas and limits; invalid inputs fail with paths |
| CW-003 | M0 | 002 | Metric hero/open-field fixtures; direct ray intersects demo doorway |
| CW-004 | M0 | 001 | Canvas/Three and tooling spike; WebGPU/forced-WebGL2/Canvas modes tested |
| CW-005 | M1 | 002,003 | Geometry kernel and opening/height/junction tests; no duplicate assembly loss |
| CW-006 | M1 | 005 | Acoustic point evaluator with reference/travel-time tests and provenance |
| CW-007 | M1 | 005 | RF point evaluator with exact FSPL/EIRP/count-once tests |
| CW-008 | M1 | 006,007 | Grid sampler, masks, query identity; finite valid arrays and explanatory term parity |
| CW-009 | M1 | 008 | Yielding worker coordinator, coalescing, transfer/cancel/stale guards |
| CW-010 | M1 | 003,005,009 | Plan viewport, hit test, source/probe drag and numeric equivalent; accepted field current |
| CW-011 | M1 | 008,010 | Honest legends and exact probe inspector; dB/dBm and missing/near-field states correct |
| CW-012 | M2 | 002,010 | Validated command/history service; drag is one undo step; Escape restores scene |
| CW-013 | M2 | 005,012 | Constrained wall resize/move, joint behavior, attached openings; invalid edits rejected |
| CW-014 | M2 | 008,012 | Immutable snapshots, compatibility validator; baseline cannot alias working scene |
| CW-015 | M2 | 011,014 | Split and delta; common scales, masks, changed inputs, synchronized view |
| CW-016 | M2 | 002,014 | IndexedDB save/migrations, versioned JSON round trip, quota/import recovery |
| CW-017 | M3 | 004,010,011 | Architectural cutaway and shared interaction adapter; rendering changes no solver values |
| CW-018 | M3 | 011,015,017 | Sound/AP guided stories and negative control; computed explanations only |
| CW-019 | M3 | 010,015,017 | Responsive plan, scene tree, keyboard, focus, reduced-motion, numeric summaries |
| CW-020 | M4 | 009,016,017 | Worker/renderer/storage recovery; bounded cache and asset/route deployment tests |
| CW-021 | M4 | 013–020 | E2E/browser/accessibility release scenarios; failures fixed |
| CW-022 | M4 | 006–009,017 | Reproducible benchmark harness and actual budget report |
| CW-023 | M4 | 021,022 | Method/about content, license/asset inventory, release evidence and limitations |

Critical path: CW-001 → CW-002 → CW-005 → CW-006/007 → CW-008 → CW-009/010 → CW-014/015 → CW-021/023. Constrained editing and persistence are additional required branches. Design work can proceed independently after fixture/projection contracts settle; no delegation or separate chats are required by this plan.

## Original visualizer implementation sprint

1. Confirm bootstrap versions against TECH_STACK_RESEARCH and build the minimal compatibility spike.
2. Implement source/receiver/open-field schemas and exact algebra tests.
3. Add hallway-door geometry, crossing semantics, and model kernels.
4. Produce masked grids in a worker with full result identity guards.
5. Make a top-down source/AP/door interaction and probe explanation work end-to-end.
6. Review actual numeric and browser evidence before advancing to cutaway polish and compare.

Success is a functioning vertical slice with both domains, not a full editor, wave solver, or cloud service. The Bun workspace scripts are `bun run dev`, `bun run build`, `bun run typecheck`, `bun run test`, `bun run test:e2e`, `bun run verify:fixtures`, and `bun run benchmark`. `bun run test` invokes Vitest. Core development/build/typecheck/test commands, analytical fixture verification, and both engine/browser benchmark harnesses now exist. See implementation status and performance evidence for their measured scopes.

## Visualizer P1/P2 backlog and acoustic entry point

The acoustic capture research track follows [ECHO_EXPERIMENT_PLAN.md](ECHO_EXPERIMENT_PLAN.md) as the first sensing branch of the [spatial research plan](SPATIAL_RESEARCH_PLAN.md). Its first real-phone session exercised transport and exposed an unverified fixed response; it did not reconstruct a room. Inspection, acquisition telemetry and repeated probes are implemented; a known single-wall delay test remains next, with multi-reflector reconstruction gated on that test. The [workflow guide](ECHO_WORKFLOW.md) describes focused verification and reproducible evidence. This track does not redefine the existing home visualizer's completed capabilities or release gates.

| ID | Scope | Gate/dependencies |
|---|---|---|
| CW-101 | Local raster image calibration and manual tracing | P0 persistence/editor; bounded decode and explicit scale |
| CW-102 | Freeform wall/opening network editing | P0 constraints; topology and junction semantics expanded |
| CW-103 | First-order reflection explorer and reference cases | Supported geometry and analytical validation |
| CW-104 | RIR generation/playback for supported rooms | 103 plus matched reference and safe audio workflow |
| CW-105 | RSSI CSV/JSON observations, spatial map | P0 export; measurement/provenance schema |
| CW-106 | Bounded calibration and spatial holdout evaluation | 105; frozen split, identifiability checks |
| CW-107 | Reproducibility/report bundle, error charts | 103/106 as applicable; actual evidence |
| CW-108 | Offline cache/update design | Static asset inventory and tested stale-version recovery |
| CW-109 | Profile-led spatial index/WASM/compute experiment | Measured bottleneck; CPU reference parity |
| CW-201 | Low-frequency 2D acoustic wave feasibility | Governing equation, CFL/grid/boundary validation and capability fallback |
| CW-202 | Richer RF or true 3D feasibility | Independent inputs and reference/site validation plan |

If delivery slips, cut optional audio, reflection lines, advanced detail profile, ornamental motion, or redundant reveal-slider mode. Preserve both models, constrained edits, split/delta comparison, provenance, keyboard access, and numeric correctness. If those must be cut, call the result an alpha rather than redefining P0 complete.

## October 15 personal-home increment

The user prioritized Bun and a coherent manual-test workflow. Bun migration, metric home creation, local image calibration/tracing, validated geometry creation, door/zone/probe controls, reference-image project persistence and a local home library are implemented. This advances selected authoring work beyond the original P0 boundary. Unrestricted topology editing and advanced physics remain future work. See [manual testing](MANUAL_TESTING.md).
