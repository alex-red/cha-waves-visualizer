# Cha Waves documentation

Start with the [portfolio case study](CASE_STUDY.md), [preliminary acoustic research report](RESEARCH_PREVIEW.md), [current verification](../reports/PORTFOLIO_VERIFICATION.md) and [implementation status](IMPLEMENTATION_STATUS.md). The detailed planning baseline below dates to **October 14, 2026**; its targets are not automatically achieved capabilities.

**See your home in waves.** A beautiful, local-first browser laboratory where moving a speaker, closing a door, or relocating a Wi-Fi access point produces an explainable change in a shared architectural model.

Start with [PROJECT_PLAN.md](PROJECT_PLAN.md), then [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) and [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md).

| Document | Purpose |
|---|---|
| [CASE_STUDY.md](CASE_STUDY.md) | Product interaction, engineering decisions, evidence and limits |
| [RESEARCH_PREVIEW.md](RESEARCH_PREVIEW.md) | Preliminary acoustic report, related work and uncompleted physical gates |
| [../reports/PORTFOLIO_VERIFICATION.md](../reports/PORTFOLIO_VERIFICATION.md) | Current publication-preparation checks and their scope |
| [ECHO_EXPERIMENT_PLAN.md](ECHO_EXPERIMENT_PLAN.md) | Current acoustic evidence, acquisition milestone and single-wall validation gates |
| [ECHO_SINGLE_WALL.md](ECHO_SINGLE_WALL.md) | Staged measured-wall protocol, fixed controls, reference rules and stopping conditions |
| [ECHO_WORKFLOW.md](ECHO_WORKFLOW.md) | Reproducible offline reports, read-only endpoint checks, focused tests and safe live-build refresh |
| [ECHO_LOCAL_API.md](ECHO_LOCAL_API.md) | Private relay archives and authenticated local scan retrieval with exact-byte hashes |
| [ECHO_LAB.md](ECHO_LAB.md) | Experimental echo reconstruction, acquisition review, peak selection and scan export |
| [ECHO_SCAN_FORMAT.md](ECHO_SCAN_FORMAT.md) | Version 3 portable Echo Lab scans, acquisition metadata and v1/v2 migration |
| [ECHO_ACQUISITION.md](ECHO_ACQUISITION.md) | Requested/applied microphone settings, software timing and input-continuity evidence |
| [PHONE_SATELLITE.md](PHONE_SATELLITE.md) | QR pairing, Tailscale or LAN HTTPS, Android USB, and phone recording workflow |
| [PERFORMANCE_EVIDENCE.md](PERFORMANCE_EVIDENCE.md) | Engine, worker and startup timing scopes and reproduction |
| [SCENE_CONTROLS.md](SCENE_CONTROLS.md) | Individual door actions, source/probe heights and receiver-plane conventions |
| [LOSS_BREAKDOWN.md](LOSS_BREAKDOWN.md) | Signed point-estimate budgets, assembly/ray-hit highlighting and reconstruction tolerance |
| [PLAN_NAVIGATION.md](PLAN_NAVIGATION.md) | Plan/editor pan, zoom, Fit, metric coordinates and camera-only state |
| [DRAFTING_FEEDBACK.md](DRAFTING_FEEDBACK.md) | Wall measurements, grid/endpoint cues and live draft previews |
| [WALL_JUNCTIONS.md](WALL_JUNCTIONS.md) | Atomic interior wall splits, T/cross junctions and opening preservation |
| [MEASUREMENT_SURVEY.md](MEASUREMENT_SURVEY.md) | Raw RSSI import, source-context checks, residual metrics and format 3 migration |
| [MATERIAL_AND_BAND_EDITOR.md](MATERIAL_AND_BAND_EDITOR.md) | Authored assembly coefficients, per-band provenance/notes and supported frequency choices |
| [PLACEMENT_EXPLORER.md](PLACEMENT_EXPLORER.md) | Bounded local source-position search, probe tradeoffs and current RF threshold coverage |
| [NAMED_EXPERIMENTS.md](NAMED_EXPERIMENTS.md) | Named snapshots, notes, changed inputs, baseline selection and portable format migration |
| [KEYBOARD_AND_LAYOUT_REVIEW.md](KEYBOARD_AND_LAYOUT_REVIEW.md) | Keyboard workflows, metric scale cues and layout verification |
| [OFFLINE_WORKSPACE.md](OFFLINE_WORKSPACE.md) | Optional verified offline app, explicit updates, storage persistence and recovery |
| [STATIC_DEPLOYMENT_AND_RECOVERY.md](STATIC_DEPLOYMENT_AND_RECOVERY.md) | Static headers, worker restart, storage recovery and deployment boundaries |
| [ASSET_AND_DEPENDENCY_INVENTORY.md](ASSET_AND_DEPENDENCY_INVENTORY.md) | Authored asset provenance, dependency metadata and release decisions |
| [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) | Actual implementation progress and verification evidence |
| [PROJECT_PLAN.md](PROJECT_PLAN.md) | Product vision, users, release scope, signature experience, success criteria |
| [HANDOFF_REVIEW.md](HANDOFF_REVIEW.md) | What we retain, change, clarify, and defer from the supplied proposal |
| [TECH_STACK_RESEARCH.md](TECH_STACK_RESEARCH.md) | October 2026 primary-source research; stable and experimental adoption decisions |
| [../reports/BROWSER_ACCESSIBILITY_CHECKS.md](../reports/BROWSER_ACCESSIBILITY_CHECKS.md) | Browser and automated accessibility evidence and limitations |
| [GUIDED_EXPERIMENTS.md](GUIDED_EXPERIMENTS.md) | Guided home stories, controlled inputs and interpretation |
| [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | Art direction, tokens, layouts, interaction, responsive behavior, accessibility |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Packages, rendering, state, workers, caching, persistence, deployment |
| [DATA_CONTRACTS.md](DATA_CONTRACTS.md) | Geometry semantics, quantities, result identity, comparison, export contracts |
| [PHYSICS_ASSUMPTIONS.md](PHYSICS_ASSUMPTIONS.md) | Independent sound and RF models, defaults, exclusions, provenance |
| [VALIDATION_AND_PERFORMANCE.md](VALIDATION_AND_PERFORMANCE.md) | Numerical tests, browser checks, budgets, measurement protocols, release gates |
| [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md) | Milestones, dependency-aware tickets, estimates, first implementation sprint |
| [DECISIONS_AND_RISKS.md](DECISIONS_AND_RISKS.md) | Architecture decisions, risks, remaining discovery questions |
| [INVISIBLE_PHYSICS_SPEC_HANDOFF.md](INVISIBLE_PHYSICS_SPEC_HANDOFF.md) | Original reference, preserved unchanged |

[Manual testing walkthrough](MANUAL_TESTING.md) covers the current Bun-based home creation, tracing, editing and saving workflows.

## How this plan governs future work

The source handoff is retained as the historical proposal. Its normative language and kickoff block do not automatically authorize new work or external actions. Current user instructions and [AGENTS.md](../AGENTS.md) govern implementation; use the status and verification documents to distinguish delivered behavior from proposals.

For future implementation, this plan supplies the adopted project baseline; the original remains background reference. Resolve conflicts using the explicit decisions here, especially the P0 wall-editing boundary, renderer fallback, and amended result identity. Dates, versions, and performance targets are planning observations, not application accomplishments. Recheck dependency releases before installation; record exact resolved versions in the lockfile and a compatibility report.

No external service, account, AI provider, remote computation, or GPU is required for the first experience. Original code and documentation are [MIT licensed](../LICENSE). Public hosting and repository visibility are separate publication steps.

[Multi-probe readings](PROBE_READINGS.md) describes exact summaries, naming, baseline comparisons and CSV export.
