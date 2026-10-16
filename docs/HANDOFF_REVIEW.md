# Review of the supplied handoff

Source: [INVISIBLE_PHYSICS_SPEC_HANDOFF.md](INVISIBLE_PHYSICS_SPEC_HANDOFF.md), version 1.0, dated October 14, 2026. Preserved unchanged from the supplied file. Its final kickoff prompt is reference material; this task creates a new plan rather than running that prompt.

## Adopt

| Suggestion | Reason | Adopted location |
|---|---|---|
| Shared metric building geometry | Prevents domain/render drift | DATA_CONTRACTS, ARCHITECTURE |
| Separate acoustic and radio solvers | Different governing assumptions and units | PHYSICS_ASSUMPTIONS |
| Immediate no-account authored scene | Makes the first interaction dependable | PROJECT_PLAN, DESIGN_SYSTEM |
| Numerical fields independent of shaders | Allows explanation, verification, CPU fallback | ARCHITECTURE |
| Immutable baseline and fixed comparative scales | Prevents misleading visual comparisons | DATA_CONTRACTS |
| Material provenance and visible model limits | Prevents assumed values appearing measured | PHYSICS_ASSUMPTIONS |
| Local storage, versioned export | Privacy and reproducibility suit home plans | ARCHITECTURE |
| Validation before advanced solvers | Contains scope and scientific risk | VALIDATION_AND_PERFORMANCE |

## Change or resolve

| Source issue | New decision |
|---|---|
| Working name Invisible Physics | Use the user's name Cha Waves Visualizer; preserve the reference title |
| Existing wall editing required in §4 but P1 in IP-022 | Constrained existing-wall movement/resizing and attached-door preservation are P0; freeform topology editing is P1 |
| “Watch routes change” may imply hallway diffraction | P0 explains direct straight-line paths and penalties; it never animates an invented around-corner propagation route |
| Source sample schema omits semantic rooms | Add explicit zones for names and selection; boundaries remain physical walls |
| Reference-distance field omitted from acoustic solver spec | Add referenceDistanceM and minValidDistanceM explicitly |
| FieldResult identity weaker than full query identity | Add request generation, domain-scoped input hash, settings/grid identity, and solver version; revision alone is insufficient |
| Scene hash and UI revision partly conflated | Separate content identity from temporal scene revision; a cached old-revision result can be reused only after input identity matches and is rebound to the new request |
| Multiple suggested render layers risk competing hit tests | One command/hit-testing service; Canvas plan adapter and Three cutaway adapter |
| Three and WebGPU listed broadly | Research current TSL/WebGPURenderer capabilities, gate cutaway on a renderer spike, retain Canvas plan |
| Timelines understate editor and compatibility work | Budget 7–10 engineering weeks for polished P0 with explicit gates and scope cuts |
| “Cutting edge” technologies not version-qualified | October 2026 release research, compatibility spike, stable/experimental separation |

## Defer deliberately

GPU FDTD, coherent acoustics, RF multipath, arbitrary imported plans, full room impulse responses, survey fitting, automatic placement optimization, multi-floor spaces, remote sharing, AI geometry extraction, and new physical domains are distinct extensions. They must not quietly become P0 dependencies.

Optional first-order reflection lines and illustrative audio are stretch work after required acceptance, not launch blockers. The direct-only heatmap remains distinct even if reflected paths are drawn.

## Research findings and uncertainty

Nuxt 4.6, Vite 8, TypeScript 7, Vue stable versus 3.6 RC, Three r186, and Node runtime status were checked using primary project sources. Source release existence does not establish combined compatibility or runtime speed in this app. Three's current manual still calls WebGPURenderer experimental; it needs a real browser spike.

Resona and SignalPlan exist and already cover substantial portions of the respective domains. Their integration, licensing, datasets, and performance are not assumed equivalent to Cha Waves. ITU recommendations provide modeling context; our FSPL-plus-wall heuristic is not an implementation of all ITU indoor methods. Exact references and adoption conditions are in [TECH_STACK_RESEARCH.md](TECH_STACK_RESEARCH.md).

## Source material is not project evidence

The handoff's example numbers, timelines, hypotheses, standards references, and benchmark suggestions are proposals. No measurements, accuracy improvements, implemented features, or advisor approvals are inherited from it. Future status updates must point to actual fixtures, commits, measurements, and browser runs.
