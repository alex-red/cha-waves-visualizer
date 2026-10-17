# Decisions, risks, and remaining discovery

These decisions form the planning baseline. The long-term research direction was clarified October 17, 2026 in [SPATIAL_RESEARCH_PLAN.md](SPATIAL_RESEARCH_PLAN.md); visualizer decisions below retain their product scope. No implementation spike or validation is implied by an accepted planning decision.

## Architecture decisions

| ADR | Decision/status | Rationale and tradeoff |
|---|---|---|
| 001 | Accepted: Cha Waves Visualizer | User-specified identity; reserve domains/public branding later |
| 002 | Accepted: sound + RF P0 | Rich integrated experience with separate quantity contracts; more work than one domain |
| 003 | Accepted: canonical SI single-level 2.5D scene | Shared heights/openings without promising volumetric wave propagation |
| 004 | Accepted: pure TypeScript kernels in workers | Portable CPU reference and local-first interaction; advanced parallel work deferred |
| 005 | Accepted: Nuxt 4.6, supported Vite 8, stable Vue | Current stable foundations; RC Vapor optional, not a launch requirement |
| 006 | Conditional: TS7 native package checks | Latest native tooling; confirm Vue/compiler-API tooling and documented TS6 bridge |
| 007 | Conditional: Three WebGPURenderer/TSL cutaway | Modern portable material path; current experimental status requires spike and fallback |
| 008 | Accepted: Canvas plan always available | Keeps editing/numerical result usable without accelerated 3D rendering |
| 009 | Accepted: local IndexedDB + portable JSON | Home geometry remains private; no default cross-device sync and no assumed permanent storage |
| 010 | Accepted: immutable A/B and dB delta | Makes physical edits reviewable and prevents visual rescaling errors |
| 011 | Accepted: constrained wall edits P0 | Resolves handoff conflict; arbitrary topology editing remains P1 |
| 012 | Accepted: no P0 GPU physics or AI | Numerical credibility and first interaction do not require providers or hardware |
| 013 | Proposed: MIT for original code | Straightforward reuse; owner/license inventory review before public release |
| 014 | Accepted: static deployment architecture | No server compute cost or per-drag networking; host choice remains operational |
| 015 | Accepted direction: wave-based 3D mapping augmented by AI | General spatial mapping is the ambition; acoustic evidence, registration, 3D structure/fusion, splats and completion need separate gates. Keep observed, estimated and generated content traceable; P0's no-AI boundary applies to the visualizer release |

Record implementation outcomes and changes beneath the relevant ADR, including failed experiments. If a conditional choice fails, use its stated fallback without weakening validation.

## Risks and responses

| Risk | Early evidence | Response and release consequence |
|---|---|---|
| Attractive heatmap interpreted as a measurement | Users describe predicted field as measured signal/sound | Change labels and onboarding; usability review before launch |
| Direct model contradicts hallway narrative | Demo implies energy bending around corners | Use a doorway crossed by the direct ray; advanced routes deferred |
| Geometry/junction ambiguity | Duplicate crossings, orphan doors, NaN fields | Reject unsupported edits; add fixtures; block release on failures |
| Stale results after settings/workspace changes | Old band/probe/preview overwrites current state | Full query/generation guards and E2E adversarial scheduling |
| WebGPU/TS tooling compatibility | Renderer init, fallback shader, or SFC typecheck fails | Adapter fallback or TS6 bridge; never disable checks |
| GPU visual layer overwhelms mobile | Long tasks, low fps, high memory | Demand-driven plan view, cap DPR, lower quality; preserve compute semantics |
| Benchmark targets exceed realistic scene scope | Cold build or drag latency fails | Publish actual conditions, reduce preview work, revise measured budgets |
| Personal-home import feels postponed | Early testers need their own plan immediately | Prioritize P1 calibrated tracing after coherent P0; optionally accelerate it after core gates |
| Browser storage loss | Quota/private mode/eviction | Export affordance, unsaved state, recoverable memory workflow |
| Material presets sound authoritative | Users assume “masonry” always has the shown loss | Explicit fixture assumption and editable construction context |
| Calibration flatters a weak model | Great fit, poor holdout or unidentifiable parameters | Freeze splits and parameter family; publish negative findings |
| Research and product acceptance become conflated | A polished field map or splat scene is presented as recovered physical geometry | Keep separate release/research exits; prioritize the spatial evidence gates without requiring every visualizer feature first |
| AI completion obscures missing evidence | Generated surfaces appear measured or silently affect physical calculations | Preserve raw observations, support/derivation metadata and independently inspectable structure/appearance; allow unknown regions and hideable/rejectable completions |
| Fusion hides whether wave sensing helps | A strong visual reconstruction is attributed to acoustic measurements | Compare acoustic-only, visual/depth-only and fused baselines on frozen held-out data; report failures and revise the sensing role if gains are absent |

## Questions to resolve during implementation discovery

These do not block this plan. Defaults are chosen so development can begin.

- **Hero geometry:** author and validate exact apartment coordinates in M0; 14 × 10 m is a target envelope, not an existing fixture.
- **Renderer capability:** prove current TSL mask/color/interaction parity on real backends; Canvas remains definitive fallback.
- **Dependency patches:** resolve exact compatible versions and compiler bridge rather than estimating newest patches.
- **Physical terminology:** seek acoustic/RF technical review before public precision claims; no outreach has been authorized or performed by this planning task.
- **Deployment/domain/license:** choose when a release candidate exists. No purchase, publication, account setup, or license file is part of this task.
- **Next research priority:** ECHO-04/05 for physical wall evidence; independent offline work can define registration/provenance and test observed visual reconstruction under the spatial plan. Further visualizer P1 work responds to demonstrated product needs.

## Decision discipline

If analytical tests fail, fix the model/kernel before adding spectacle. If a renderer cannot preserve masks/legend meaning, simplify it. If a performance optimization changes the physical model, version and validate it explicitly. If real measurements disagree, surface disagreement rather than hide it through palette changes or unreported parameter fitting.
