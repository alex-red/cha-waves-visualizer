# Cha Waves Visualizer

An interactive, local-first home laboratory for sound and wireless propagation. Change a physical input and inspect the computed consequence.

The current implementation includes a metric apartment, independent acoustic and radio quick models, plan and architectural cutaway views, constrained wall editing, individual door controls and source/probe heights, worker-backed fields, shared-scale A/B comparison, baseline differences, adaptive drag previews, and local project save/import/export. Optional guided home experiments demonstrate controlled door, placement, and frequency changes with computed readings. Keyboard plan editing, an accurate metric ruler, and compact phone layouts are covered by browser checks. Calculation restart preserves edits after worker failures; generated security headers and storage recovery are covered by browser tests. This is an educational approximation: material values are authored assumptions, acoustic output is relative direct-path level rather than calibrated SPL, and radio output is predicted received power rather than throughput.

## Development

```sh
bun install
bun run dev
```

Use Bun 1.4.3 for package installation and workspace scripts. Node 24 remains the supported runtime for scripts that invoke Node directly and for the package engine requirement. `bun run test` runs Vitest for pure packages and frontend composables; it does not use Bun's built-in test runner. Verification commands and exact installed versions are recorded in [implementation status](docs/IMPLEMENTATION_STATUS.md). The numerical engine runs independently of Vue and browser graphics.

## Planning

The [documentation index](docs/README.md) links the product plan, architectural decisions, design system, data contracts, physics assumptions, validation targets, and implementation backlog. The original handoff is preserved as reference material.

Home geometry and numerical computation stay in the browser. No account or AI provider is required. The inspector's [interactive loss breakdown](docs/LOSS_BREAKDOWN.md) explains each exact probe estimate and highlights crossed assemblies on the plan.

For the current home creation, floor-plan tracing, geometry editing and local project workflow, follow the [manual testing guide](docs/MANUAL_TESTING.md).

The workspace and Edit home canvas support [pan, zoom and Fit](docs/PLAN_NAVIGATION.md) with metric rulers and camera-aware editing.

Edit home also provides [wall dimensions and snapping feedback](docs/DRAFTING_FEEDBACK.md), including exact endpoint cues and a live measurement while drawing a wall.

[Interior wall splits and junctions](docs/WALL_JUNCTIONS.md) preserve openings and apply as one undoable edit. Enable **Join intersecting walls** when adding a connected T or cross junction.

[Named experiments](docs/NAMED_EXPERIMENTS.md) save scene/settings snapshots with notes, show changed inputs, and supply comparison baselines. Project JSON version 3 carries the library and optional measurement survey; version 1/2 imports migrate automatically.

[Placement explorer](docs/PLACEMENT_EXPLORER.md) compares sampled source positions at selected probes, applies a chosen move with undo, and summarizes current RF coverage against a custom threshold.

[Materials and bands](docs/MATERIAL_AND_BAND_EDITOR.md) edits shared acoustic/RF profiles with provenance, notes and undo. Frequency choices require complete authored coefficients across referenced assemblies.

[Measurement surveys](docs/MEASUREMENT_SURVEY.md) import raw RSSI with receiver/source context, compare exact predictions and residuals, and report excluded points, bias, MAE and RMSE.

The optional [offline workspace](docs/OFFLINE_WORKSPACE.md) downloads a verified app copy from **Homes**, preserves local projects through offline reloads, and stages updates for an explicit save and reload.
