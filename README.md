# Cha Waves

**Research into using waves to map 3D visual space, augmented by AI.**

The long-term goal is to map any 3D space and enrich its digital representation with AI reconstruction and completion, including Gaussian splatting. The [spatial research plan](docs/SPATIAL_RESEARCH_PLAN.md) defines the route from controlled acoustic evidence to 3D structure, sensor fusion, visual reconstruction and explicitly generated content. This is a research ambition; general 3D mapping is not implemented or validated.

The current application is a local-first browser laboratory for exploring sound and Wi-Fi propagation in an editable floor plan, with a separate experimental acoustic capture track. Built with Nuxt, Vue, TypeScript, Web Workers and Three.js.

[![CI](https://github.com/alex-red/cha-waves-visualizer/actions/workflows/ci.yml/badge.svg)](https://github.com/alex-red/cha-waves-visualizer/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-315c50.svg)](LICENSE)

![Cha Waves plan view with a modeled sound field, editable geometry and an exact probe reading](docs/images/workspace.png)

Close a door, move a source or switch frequency. The field and selected-point explanation recompute from the current inputs. Save a baseline to compare the change on a shared scale. This visualizer predicts fields from known geometry; the mapping research investigates recovering geometry from observations.

**These are educational approximations.** Sound is relative direct-path level, Wi-Fi is modeled received power, and the demonstration material coefficients are authored assumptions. Neither field has been calibrated against a real home. [Model boundaries](docs/PHYSICS_ASSUMPTIONS.md)

## Try it locally

Use **Bun 1.4.3** and **Node 24** (the pinned version is in [.nvmrc](.nvmrc)).

```sh
bun install --frozen-lockfile
bun run dev
```

Open the local address printed by Nuxt. No account, API key or remote solver is needed. The initial Canvas plan works without WebGPU; the optional cutaway has a WebGL2 fallback.

For a production preview:

```sh
bun run build
bun run preview
```

Open [localhost:4173](http://localhost:4173). There is no public hosted demo configured in this repository yet.

## A two-minute tour

1. Toggle **Hall door** and inspect the changed reading. Open **Why this reading** to see the distance and assembly-loss terms.
2. Save a baseline, move the source, then use **A/B** or **Compare** to inspect both scenes with a common scale.
3. Switch to **Wi-Fi**, change the frequency and explore source placement across selected probes.
4. Open **Edit home** to draw or split interior walls, add doors and inspect dimensions. Changes support undo/redo.
5. Open **Echo Lab → Virtual scan**, run all five positions and reveal the synthetic fixture.

![Architectural cutaway displaying the same computed samples as the plan](docs/images/cutaway.png)

## What is implemented

| Area | Working capability |
|---|---|
| Geometry | Metric plans, calibrated image tracing, constrained wall/door editing, junctions, pan/zoom and numeric controls |
| Numerical models | Separate sound and RF kernels, height-aware crossings, exact probe estimates and signed loss explanations |
| Interaction | Cancellable worker fields, adaptive drag previews, undo/redo and compatible baseline comparisons |
| Local workspace | IndexedDB projects, versioned JSON import/export, named experiments and optional offline app downloads |
| Measurement tools | RSSI survey import and residual metrics; experimental phone audio capture and scan inspection |
| Spatial research | Research Lab with synthetic 3D plane/evidence inspection, local hash-verified bundle replay, report download and matching offline CLIs |

[Portfolio case study](docs/CASE_STUDY.md) · [Architecture](docs/ARCHITECTURE.md) · [Current implementation status](docs/IMPLEMENTATION_STATUS.md)

Try the [synthetic spatial replay](docs/SPATIAL_BUNDLE.md) with `bun run spatial:inspect -- --input packages/test-fixtures/spatial/bundle.json --format markdown`. This registers supplied poses and preserves unknown calibration; it does not recover physical geometry.

Run `bun run spatial:plane-demo -- --format markdown` for the separate [synthetic 3D plane reference](docs/SPATIAL_PLANE_REFERENCE.md). It fits tilted-wall/floor/ceiling fixtures with a fixed speaker and evaluates held-out positions, retaining missing and ambiguous attempts. It is not a validated phone room scan.

Open **Research Lab** in the app to inspect these references visually or select a local bundle and its source files. It can also open over an active Echo Lab review while keeping the scan in place. [Research workspace guide](docs/SPATIAL_WORKSPACE.md)

## Echo Lab: a separate research experiment

The **virtual scan** fits an axis-aligned rectangle from simulated, unlabeled first-order arrivals at known positions. The **phone satellite** records sweeps for explicit peak review using an optional local relay. The static demo does not need a phone or microphone.

![Echo Lab synthetic reconstruction with known positions and a simulated rectangular fixture](docs/images/echo-lab.png)

Real Android recordings have exercised acquisition and transfer. A five-probe batch reported complete observed input, while a first-probe timing shift remains unexplained. **No physical wall identification or room-reconstruction accuracy has been established.** Synthetic fit error is not a physical accuracy result.

[3D mapping and AI research roadmap](docs/SPATIAL_RESEARCH_PLAN.md) · [Preliminary research report](docs/RESEARCH_PREVIEW.md) · [Experiment evidence and next gates](docs/ECHO_EXPERIMENT_PLAN.md) · [Phone setup](docs/PHONE_SATELLITE.md)

## Evidence and verification

The repository separates analytical checks, software integration checks and physical experiments. The recorded browser benchmark measured **32.2 ms p95 from worker request to Canvas draw** for a 2,240-cell acoustic fixture on an M4 Pro. That historical run excludes input handling and display presentation; it is not a phone or general performance guarantee. [Scope, raw data and reproduction](docs/PERFORMANCE_EVIDENCE.md)

```sh
bun run test                 # Vitest: numerical packages and composables
bun run test:satellite       # Relay, owner API and Android helper checks
bun run test:tooling         # Capture workflow commands
bun run test:repository      # Repository verification regressions
bun run verify:repository    # Public-file hygiene and local Markdown targets
bun run typecheck            # Run before build; both generate Nuxt state
bun run verify:fixtures      # Independent algebra and portable-project checks
bun run build
bun run verify:static-security
bun run verify:offline
bunx playwright install chromium
bun run test:echo            # Fresh test server; one browser worker
```

For the full browser suite after building, run `bun run test:e2e -- --workers=1`. CI also defines Firefox and WebKit jobs. See [verification evidence](reports/PORTFOLIO_VERIFICATION.md) for the checks actually performed and their limits.

## Repository guide

```text
apps/web/       Nuxt interface, rendering adapters, workers and browser tests
packages/       Pure TypeScript geometry, models, formats and analysis
scripts/        Static build checks, benchmarks and optional capture tools
docs/          Case study, model boundaries, workflows and research plan
reports/        Scoped benchmarks and software verification evidence
```

Projects and computation stay in the browser. The optional phone relay receives only captures explicitly sent to it; its private owner API binds to loopback. Keep real recordings, floor plans, keys and private reports outside Git. [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Documentation index](docs/README.md)

## License

Original project code and documentation are available under the [MIT License](LICENSE). Dependencies retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md) and the [asset inventory](docs/ASSET_AND_DEPENDENCY_INVENTORY.md).
