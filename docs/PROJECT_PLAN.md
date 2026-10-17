# Product and release plan

**Name:** Cha Waves Visualizer. **Tagline:** See your home in waves. **Demo invitation:** Move a speaker. See what changes.

## Long-term research direction

**Research into using waves to map 3D visual space, augmented by AI.** The ultimate goal is to map any 3D space and enrich its digital representation using AI reconstruction and completion, including Gaussian splatting. The [spatial research plan](SPATIAL_RESEARCH_PLAN.md) defines staged evidence gates for this ambition; it is not a current capability claim.

The existing home visualizer solves a forward problem: supplied geometry → predicted sound/RF fields. The mapping research solves an inverse problem: observations → estimated geometry and poses, followed by observed visual reconstruction and explicitly generated completion. Acoustic probing is the first sensing experiment; complementary camera/IMU/depth inputs are research choices. Maintain the visualizer and mapping research as separate tracks with their own acceptance evidence.

## Current product thesis

Make invisible behavior tangible in an editable home. The memorable experience is a small architectural cutaway whose sound or wireless field changes when the user changes something physical. Inspection reveals the computed path, assumptions, and units; comparison reveals the effect of one controlled intervention.

The first release visualizes simplified propagation fields. Actual time-dependent wave simulation is a later, separately validated mode. The word “waves” describes the product family; every view identifies the quantity it actually computes.

The proposed differentiation is the integration of a shared building, independent models, beautiful direct manipulation, explainable results, and reproducible experiments. It is not a claim to invent browser acoustics or RF planning. See the verified prior art in [TECH_STACK_RESEARCH.md](TECH_STACK_RESEARCH.md).

## Audience and jobs

| Audience | Primary job | Product response |
|---|---|---|
| Curious homeowner or maker | Understand why placement and walls matter | Immediate authored home, clear intervention, plain-language explanation |
| Enthusiast working on their home | Compare alternatives | Metric geometry, saved baseline, material assumptions, eventually tracing and surveys |
| Engineer or technical reviewer | Assess the model and implementation | Equations, input provenance, exported manifests, reproducible tests |
| Visitor discovering Cha | Experience an exceptional interactive product | Beautiful scene in seconds, purposeful motion, no onboarding form |

Prioritize curiosity and relative exploration in P0. Personal-home ingestion is P1: tracing and scale calibration must be reliable before a user's home appears numerically meaningful. No professional prediction claims are made from the quick models.

## Signature experience

1. Open `/`: a 14 × 10 m apartment appears on a drafting surface; the Sound tab is selected. A speaker and study receiver are recognizable. A clearly labeled recorded preview may appear while the first local calculation runs.
2. Drag the speaker. Its marker follows immediately; a coarse numeric field updates asynchronously. Release to refine. Click the study probe to see distance, direct travel time, and any assumed crossing penalties.
3. Close the door intersected by the direct ray. The receiver's computed change is explained using the actual door ID and material parameter. A hallway does not imply the quick solver follows a route around corners.
4. Save a baseline, make one change, compare A/B using a shared scale, then view a signed difference in dB.
5. Switch to Wi-Fi, move the AP relative to the masonry partition, and inspect predicted received power in dBm. The unchanged home geometry is shared; the solver and legend change.
6. Export the scenario, reopen it in another browser profile, and reproduce the numerical experiment.

A secondary negative-control scenario moves an unrelated wall and demonstrates that the direct model may show no change. An exact open-field fixture makes distance scaling inspectable.

## Visualizer release scope

P0/P1/P2 below describe the educational visualizer's release scope. They do not limit the long-term spatial research direction or make completion of every visualizer feature a prerequisite for that research.

| Capability | P0: polished public demo | P1: personal-home laboratory | P2: selected research |
|---|---|---|---|
| Space | Authored single-level apartment; constrained edits | Calibrated image tracing, richer editing | Validated volumetric or multi-floor model |
| Sound | Direct-path relative dB, travel time, assumed transmission | Tested early reflections/RIR in supported rooms | Low-frequency 2D wave demonstration |
| Radio | FSPL plus assumed assembly losses; 2.4/5/6 GHz | Imported RSSI surveys and held-out calibration | Site-specific richer propagation |
| Views | Cutaway, plan, inspection, A/B, delta | Survey residuals and reports | Solver disagreement views |
| Persistence | Local save; versioned JSON import/export | Local image/measurement assets; portable bundle | Hosted sharing only if needed |
| Audio | Optional illustrative preview after core release gate | Supported RIR playback with context | Validated specialized DSP |

**P0 must ship:** one active emitter per domain; probe placement; select/drag/numeric editing; door toggles; move or resize an existing wall under geometry constraints; material editing; undo/redo; sound and RF quick models; masks and honest legends; immutable comparison; IndexedDB persistence; JSON round trip; keyboard equivalent workflows; plan fallback; method explanations; numerical and browser validation.

**P0 excludes:** arbitrary CAD/BIM, image recognition, freeform multi-floor editing, multiple-source mixing, antenna directivity, true diffraction/interference, RT60, RF throughput, live browser Wi-Fi scans, cloud sync, accounts, paid tiers, AI chat, and GPU compute dependency. Adding/removing complex wall networks and automatic room rebuilding are P1. Existing-wall edits remain part of P0, fixing the source handoff's conflicting scope.

## Routes and flows

| Route | Behavior |
|---|---|
| `/` | The working demo itself, with a compact invitation; never a marketing obstacle |
| `/lab` | Same workspace and scene, expanded editing; entering retains state |
| `/lab?example=hallway-door` | Named fixture loads through a validated allowlist |
| `/method` | Models, units, omissions, input provenance, implementation version |
| `/about` | Project narrative and repository link once public |
| `/examples`, `/benchmarks` | P1 galleries and evidence, added when real content exists |

Compare is a workspace mode rather than an independent route that could lose edits. Loading another scene with unsaved changes offers save/export/discard. Preferences may persist, but a first visit never blocks on storage availability.

## Product acceptance and success

P0 completion requires both models, constrained edits, comparison, persistence, accessible interactions, and published limitations. “Beautiful” means a legible, coherent scene at 1280 × 800, polished empty/error/stale states, and meaningful field changes—not a screenshot alone.

Proposed usability evaluation: five exploratory sessions, including keyboard use. Target four of five participants making a first intervention within 30 seconds and correctly explaining one A/B result within two minutes. Record difficulties rather than treating the small study as population evidence. Aggregate analytics are unnecessary for P0; use local diagnostics and voluntary sessions.

Engineering targets and validation gates live in [VALIDATION_AND_PERFORMANCE.md](VALIDATION_AND_PERFORMANCE.md). Actual implementation evidence is recorded in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md); physical acoustic reconstruction remains subject to its separate experiment gates.

## Beyond the first release

The current [acoustic experiment plan](ECHO_EXPERIMENT_PLAN.md) separates phone capture/transport from physical reconstruction. The first three-position Android experiment is complete as a diagnostic run. Further room scanning is gated on instrumented acquisition and a repeatable reflection from one wall at known distances; the rectangle solver remains a synthetic/reference case until measured inputs support it.

P1 earns practical value by importing a user's scaled plan, keeping uncertain construction inputs visible, and comparing against independently collected measurements. Radio calibration and a validated acoustic wave experiment remain optional extensions of that product. A wave simulation can reveal diffraction or interference missing from P0, but is not a prerequisite for inverse mapping; avoid equating 2D pressure with real 3D room SPL.

The research priority is the [spatial milestone sequence](SPATIAL_RESEARCH_PLAN.md): supported wall evidence, registered 3D observations, supported structure, fusion/localization, image-supported visual reconstruction and constrained AI completion, then broader environments. Some offline registration and visual work can proceed while acoustic validation remains open. Evaluate the added value of waves against visual-only baselines, and keep measured constraints, estimated surfaces and generated details distinguishable.
