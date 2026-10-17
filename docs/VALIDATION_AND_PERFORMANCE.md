# Validation, performance, and release gates

This document defines validation protocols and release targets. The application is implemented, with scoped local measurements in [performance evidence](PERFORMANCE_EVIDENCE.md) and completed software checks in [implementation status](IMPLEMENTATION_STATUS.md). Budgets below remain targets unless linked evidence establishes the same measurement scope. Site prediction accuracy and physical room reconstruction remain unvalidated. Track mathematical tests, reference-model agreement, and real-world predictiveness separately.

## Deterministic fixture suite

| Fixture | Purpose | Required release |
|---|---|---|
| open-field | Distance/frequency identities and ideal free-space checks | P0 |
| hallway-door | Opening/height/closed-leaf behavior in authored apartment | P0 |
| masonry-ap | Single assembly count and relative AP relocation | P0 |
| negative-control | Unrelated wall/display edit leaves direct probe result unchanged | P0 |
| junction-and-opening | Rotated walls, endpoint/tangent/height cases | P0 |
| reflection-box | Finite-face image-source analytical comparison | P1, or before optional reflection feature |

Every fixture stores exact coordinates, parameters, provenance, supported model, expected outputs, and schema/solver version. Hero fixture layout must place its receiver's direct ray through the interactive doorway; otherwise the narrative is invalid. No fixed after-state field can masquerade as a live solve.

## Numerical and orchestration tests

| Group | Checks |
|---|---|
| Geometry | Simple polygons; finite numbers; masks; solid placement; rotated openings; vertical limits; collinear/tangent cases; distinct assemblies; joint edit consistency |
| Acoustics | 6.0206 dB loss on doubled distance; 3.43 m gives 10 ms; assumed door toggle; unrelated wall invariant; minimum-distance invalid mask |
| RF | Exact c0 FSPL reference; doubled frequency/distance; +3 dB EIRP linearity; closed door counted once; height-aware intersections; no double transmit gain |
| Identity | Reordered normalized content same hash; changed band new hash; display-only changes no hash change; domain-local material invalidation |
| Workers | Late result rejected; late explanation rejected; preview cannot replace detail; workspace switch generation guard; cancellation actually yields; transferred buffer ownership |
| Compare | Mixed quantity/version blocked; common scale; radio difference dB; intersection validity mask; changed extents require common grid |
| Persistence | Immutable snapshots; schema rejection; export/import identity; quota recovery; migration rollback |

Proposed pure scalar tolerance: 1e-9 for algebra under matched formulas; geometry position tolerance starts at 1e-6 m; Float32 field comparisons use 1e-4 dB absolute tolerance on bounded demo values. Test known edge cases and document why each tolerance applies; do not use one global epsilon to hide model differences. GPU parity gets a separate measured tolerance if GPU computation is introduced later.

Use Vitest for deterministic tests and fast-check for seeded valid geometric transformations, serialization, and invariants. Failed seeds must be replayable. Golden arrays change only with an explained model correction or solver version change. Exact raster pixels across GPU platforms are not the numerical criterion.

## Browser and accessibility checks

Playwright flows cover load without account, real drag solve, door toggle, mode/legend switch, constrained wall edit, undo, A/B/delta, camera invariance, fresh-profile import, unsupported GPU, storage failure, worker crash recovery, keyboard edit, and reduced motion. Automation can use Chromium/Firefox/WebKit; native Safari and actual GPU/browser combinations still need manual checks because emulation cannot establish device support.

Test current stable Chrome, Edge, Firefox, and Safari on representative systems at the release date; record exact versions. Canvas plan is required everywhere in this matrix; WebGPU cutaway is capability-based. Force WebGL2 in tests and simulate renderer failure. Test an integrated-GPU laptop, a midrange phone, and a lower-powered device where available.

Use axe-core plus manual keyboard and screen-reader workflows. A user must select/move objects numerically, toggle doors, save baseline, and read A/B values without the canvas. Verify zoom, focus restoration after panels, touch targets, contrast, missing-color meaning, and muted audio defaults.

## Performance budgets

Canonical benchmark: 14 × 10 m authored apartment, proposed ≤40 walls and ≤8 openings, one active source, balanced 0.25 m grid (56 × 40 = 2,240 cells), documented receiver height and band. Preview is 0.5 m; detail 0.125 m is user-requested and not assumed to meet the balanced budget.

| Event/resource | Proposed target | Measurement |
|---|---|---|
| Cold usable plan | ≤2.5 s | Production build; agreed midrange device and controlled 10 Mbps/100 ms RTT profile |
| Warm meaningful scene | ≤1.5 s | Warm browser cache; no remote solver initialization |
| Pointer tracking | ~60 fps desktop, ≥30 fps low-power fallback | Frame distribution during continuous interaction; no recurring >50 ms main-thread work |
| Preview command to accepted paint | p95 ≤150 ms | End-to-end, not worker time alone |
| Balanced solve after release | p95 ≤500 ms | Release event to current field paint |
| Undo scene paint | p95 ≤100 ms | Excluding full solver refinement |
| Cached mode switch | ≤200 ms | Matching query cache hit |
| Autosave transaction | p95 ≤250 ms | After debounce, ordinary project |
| Initial shell/plan JS | ≤250 KiB gzip | Actual production chunk report, excluding lazy cutaway/audio |
| Lazy cutaway JS | ≤700 KiB gzip incremental | Report separately; revise after real renderer spike if justified |
| Numeric result cache | ≤32 MiB | Byte accounting and LRU cap |
| Leak test | No monotonic retained growth after GC stabilization | 1,000 edits plus repeated renderer teardown; track buffers/resources |

Budget changes need measured evidence and a written tradeoff, not an unexplained “target achieved.” Browser memory estimates are imperfect; use devtools traces and retained-resource counts where portable APIs are unavailable.

Benchmark 20 warmups then 100 measured runs for each fixed condition, reporting median/p95/p99, cold-start samples separately, device/browser/OS, build commit, power state, backend, cells, walls, frequency, masks, cache state, and end-to-end latency. A throttled test is a controlled proxy, not a substitute for a real phone.

Optimize in order: coalesce requests; reduce preview cells; pre-normalize inputs; reuse geometry index; bound allocations/cache; broad-phase culling; profile advanced WASM/GPU only if needed. Verify exact-point checkpoints when changing sampling. Dense color pixels cannot improve a crude propagation model.

## P0 release gate

- Both independent solvers pass analytical and geometry tests.
- Required editable actions change actual inputs and produce accepted matching results.
- Quantities, reference conditions, assumed materials, masks, and omitted effects are visible.
- A/B uses a common absolute domain; delta and changed-input summary are correct.
- Export/import reproduces numeric outputs within published tolerance.
- Keyboard, reduced-motion, mobile plan, unavailable GPU, storage failure, and worker recovery work.
- Performance evidence covers the canonical fixture and required browser matrix.
- Visual review passes realistic viewport/zoom sizes; no deceptive wave animation.
- Static deploy smoke test verifies direct routes, worker assets, CSP, and absence of geometry uploads.
- Release notes distinguish verified features, targets missed, and deferred work.

## P1 scientific evidence

Pin pyroomacoustics and match dimensionality, reflection order, coordinates, boundary coefficients, and quantities for reference comparisons. Do not compare direct-only heatmaps to a library's total reverberant energy and call the difference implementation error.

RSSI import records device, timestamp, AP/band/channel, receiver coordinates/height/orientation, repeated readings, and survey conditions. Fix the parameter family and spatial split before fitting; constrain coefficients and flag unidentifiable fits. Report baseline and calibrated holdout MAE/RMSE/bias in dB, room-level residuals, sample counts, and cases that worsen. Holdout data cannot tune parameters, choose model variants, or revise the split after observing results. Measurement uncertainty and spatial dependence remain visible.

Acoustic measurement import preserves original files and acquisition context. RT60 or absolute SPL is shown only where the measurement/model supports it. Publishing a validated claim requires the associated actual evidence bundle; no universal physics accuracy percentage.
