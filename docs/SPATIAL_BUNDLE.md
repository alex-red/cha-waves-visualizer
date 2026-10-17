# Spatial bundle v1 and offline replay

The first SPATIAL-02 increment supplements Echo scan v3 and home project format 3. It links immutable scan bytes to explicit supplied/estimated/synthetic registration without claiming recovered geometry. The browser-safe contract, transform helpers, report and local CLI are implemented. Verification and its limits are recorded in [implementation status](IMPLEMENTATION_STATUS.md).

## Try the synthetic example

From the repository root:

```sh
bun run spatial:inspect -- --input packages/test-fixtures/spatial/bundle.json
bun run spatial:inspect -- --input packages/test-fixtures/spatial/bundle.json --format markdown
```

The example links three synthetic captures: `world-observation` (index 0), `rotated-frame-observation` (index 1) and `unknown-frame-observation` (index 2). The first two replay to world positions `[1, 1, 1.2]` and approximately `[2, 1, 1.2]` metres. The third remains unavailable in world coordinates. Their heights and orientations are supplied synthetic inputs, not recovered from echoes. Speaker and microphone coincide to match the existing synthetic rectangle model.

The [source scan](../packages/test-fixtures/spatial/echo-synthetic.json) SHA256 is `23d118e0808c57c324531c67ffa622dadccd72993afed6d64c2322a16df4a768`; the [bundle](../packages/test-fixtures/spatial/bundle.json) SHA256 is `77eb77f9e6154c5f202525c132eadaef30e4c7eaf711b24c79dc8d824896c3d8`. Reports are deterministic for the same bytes and software. Inputs are read without changes; raw PCM and source file paths are excluded from reports.

## Manifest

The top-level fields are exactly `format`, `id`, `worldFrame`, `frames`, `clocks`, `sources` and `observations`.

- `format` is `cha-spatial-bundle-v1`.
- `id` and all reference IDs contain 1–80 ASCII letters, digits, periods, underscores or hyphens; they begin with a letter or digit.
- `worldFrame` is `{ id, units: "m", axes: "right-handed-z-up" }`. The named world frame is an explicitly declared coordinate convention, not a claim of physical calibration.
- `frames` contains `{ id, toWorld }` entries for other right-handed metric frames. Each `toWorld` is a registration state, defined below, and maps that frame directly into the declared world frame. A local frame ID cannot duplicate the world ID. No transform graph or inferred connections are supported in v1.
- `clocks` contains `{ id, units: "ms" }`. A clock ID is a declared time domain. No synchronization or epoch conversion between clocks is inferred.
- `sources` contains `{ id, path, sha256 }` for Echo scan JSON. Paths are 1–1024 printable characters and portable relative POSIX file paths within the bundle directory; absolute paths, traversal, control characters, colons/query/fragment markers, backslashes and empty/dot segments are rejected. Paths and source IDs are unique. SHA256 uses 64 lowercase hexadecimal characters and covers exact file bytes.
- `observations` contains `{ id, sourceId, captureRef, time, speakerPose, microphonePose }`. Each source/capture reference appears at most once. Observation IDs are unique.

`captureRef` is `{ kind: "recorded", captureId }` for a stable recorded capture ID, or `{ kind: "synthetic", index }` for a zero-based synthetic capture index. A synthetic reference is identified by the source hash plus index; no capture ID is invented in the original scan. Recorded capture IDs retain the existing Echo contract's 1–128 printable-character rule. Scan mode, reference kind and capture existence must agree during replay.

All external objects reject unknown fields. Numbers must be finite. Maximum manifest size is 256 KiB, with at most 16 local frames, 32 clocks, 4 sources and 48 observations. Require at least one source and observation. Empty local-frame and clock arrays are valid when unused. Source scans retain the existing 10 MiB limit; combined source bytes are bounded at 40 MiB. Bound JSON nesting and node count before validating. Reject unsupported versions and duplicate IDs.

## Registration and time

`method` is one of `supplied`, `estimated` or `synthetic`. It describes derivation, not accuracy or confidence. A source scan's synthetic/recorded mode is reported independently; a supplied pose associated with synthetic echoes does not make them physical observations.

A rigid transform is `{ translationM: [x,y,z], rotationXyzw: [x,y,z,w] }`. Quaternions must have unit norm within 1e-6; inputs outside that tolerance are rejected. Transform operations normalize a copy of accepted quaternion roundoff before calculation, preserving caller inputs and rigid rotation at large coordinates. Coordinates/translations are bounded to ±1,000,000 m. The transform maps a point as `p_target = R(q) * p_source + translationM`. Composition `composeRigidTransforms(outer, inner)` applies `inner` first, then `outer`.

Registration state:

```ts
type Registration =
  | { status: 'known'; transform: RigidTransform; method: Method }
  | { status: 'unknown'; reason: string }
```

Sensor pose state:

```ts
type Pose =
  | { status: 'known'; frameId: string; positionM: Vector3; orientationXyzw: Quaternion; method: Method }
  | { status: 'unknown'; reason: string }
```

A sensor pose maps sensor-local coordinates into its named frame. Report both sensor origin and orientation in world coordinates only when the pose and its frame registration are known. Resolve world-frame poses using the explicitly declared world identity; never treat an unknown local-frame transform as identity. Speaker and microphone origins/orientations are separate, with missing acoustic-center calibration kept unknown.

Time state:

```ts
type Time =
  | { status: 'known'; clockId: string; timeMs: number; method: Method }
  | { status: 'unknown'; reason: string }
```

Known time is a nonnegative finite offset in the named clock, bounded to Number.MAX_SAFE_INTEGER milliseconds. A time domain and an offset do not establish acoustic emission time. Unknown reasons contain 1–240 printable characters. No pose or time is inferred from legacy X/Y, batch height/heading, capture date or playback schedule. Preserve those original observations in the linked scan.

## Module interface

The pure modules have no Node, Vue, DOM, storage, network or renderer dependency:

- `packages/spatial-registration.ts` exports `Vector3`, `Quaternion`, `RigidTransform`, `applyRigidTransform(point, transform)`, `invertRigidTransform(transform)` and `composeRigidTransforms(outer, inner)`.
- `packages/spatial-bundle.ts` exports `SPATIAL_BUNDLE_FORMAT`, `SPATIAL_BUNDLE_MAX_BYTES`, `SPATIAL_BUNDLE_LIMITS`, `SpatialMethod`, `SpatialRegistration`, `SpatialPose`, `SpatialTime`, `SpatialBundle`, `validateSpatialBundle(value)` and `parseSpatialBundle(json)`. The two validators return a validated bundle or throw a descriptive field-path error without echoing input values.
- `packages/spatial-report.ts` exports `createSpatialInspectionReport(bundle, sources, manifest)` and `renderSpatialInspectionReport(report, format)` for `json` or `markdown`. `sources` are `{ sourceId, sha256, byteLength, document, notices }`, where `document` is an already parsed Echo scan. `manifest` is `{ sha256, byteLength }`. The report verifies metadata hashes and capture links, exposes scan origin and registration availability, and contains no PCM or source paths. It makes no wall-identification or reconstruction claim.

The report format is `cha-spatial-inspection-v1`. Source/observation order follows the manifest for deterministic replay. Counts and IDs, manifest/source hashes, scan versions/notices, original X/Y and explicitly supplied 3D/time states are reportable. Missing registration remains unavailable with a reason. Markdown rendering escapes untrusted labels/reasons. No generated timestamp, machine path, raw samples or cross-clock subtraction belongs in the report.

## CLI boundary

Use `bun run spatial:inspect -- --input path/to/bundle.json [--format json|markdown]`. JSON is the default; `--help` is supported. Unknown/repeated/missing arguments are errors. Standard output is only the report or help; errors go to stderr with a nonzero exit. Importing the module does not launch the CLI.

`scripts/spatial-inspect.ts` owns parsing, bounded reads, exact-byte SHA256 and strict UTF-8 decoding. Resolve declared source paths within the manifest directory and enforce real-path containment; do not follow an escaping symlink or read a directory/FIFO. No network, archive extraction, credentials, relay session, microphone or input writes are involved. Errors identify manifest/source IDs or field paths without printing resolved private paths or filesystem error text. Reuse the existing Echo scan parser; do not reinterpret original bytes or write migrated scans back.

## Evidence and checks

Public examples and tests use synthetic inputs only. A small checked-in synthetic scan and bundle demonstrate identity, rotated/translated and unknown registration. Tests cover invalid versions/fields, bounds, references, hashes, transform direction, missing calibration, scan modes, path/symlink escape, deterministic JSON/Markdown, import safety and unchanged source bytes. Recorded-mode parser regressions generate synthetic PCM in memory; no real recording is committed.

```sh
bun run test -- packages/spatial-registration.test.ts packages/spatial-bundle.test.ts packages/spatial-report.test.ts scripts/spatial-inspect.test.ts
bun run typecheck
bun run verify:repository
```

An application rebuild is unnecessary for this CLI-only increment. The replay reports registration and basic PCM integrity; use `echo:inspect` for matched-filter candidates, capture-specific window checks and threshold sensitivity. The replay does not synchronize clocks, estimate poses, identify walls, fit 3D surfaces, render splats or generate scene content.

The known-wall physical gate remains independent. See the [spatial plan](SPATIAL_RESEARCH_PLAN.md), [acoustic experiment plan](ECHO_EXPERIMENT_PLAN.md) and [workflow](ECHO_WORKFLOW.md).
