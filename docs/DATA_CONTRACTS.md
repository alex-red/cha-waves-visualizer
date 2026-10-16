# Data and computation contracts

This amends the source handoff's proposed schema before implementation. The initial project and scene schema is v1; exported fields and solver versions are independent. Type declarations alone are insufficient: every external boundary needs runtime validation.

## Canonical geometry

World coordinates use meters: plan x/y, absolute elevation z, +z up. Renderers perform an explicit transform to their own axes. Wall baseZ and point z are absolute; an opening sill is explicitly wall-base-relative (`sillAboveBaseM`) to remove the source schema's ambiguity. Source and receiver heights must lie within their level. Units are formatted into feet only at the UI boundary.

Scene includes levels (boundary and ceiling height), zones (names and simple polygons), walls (centerline, thickness, base/height, material), wall-local openings, material profiles, emitter/probe objects with explicit levelId, and optional visual entities. IDs are stable and unique. Zones are descriptive; walls/openings remain authoritative physical boundaries. P0 supports one level and one active emitter of each domain.

Wall assemblies are straight finite segments extruded to height. Reject zero-length walls, illegal overlaps, invalid boundary polygons, unsupported crossing wall junctions, overlapping opening spans, broken references, and nonfinite coordinates. Connected endpoints may share a node; shared edges are not duplicated walls. Editing a connected endpoint updates all incident walls or rejects the edit—never silently disconnects the structure. Reject thickness/position combinations whose solids collide invalidly; offer an actionable edit error.

Current interior junction commands subdivide transverse contacts into shared-endpoint segments before scene validation. The operation is atomic and preserves opening world spans by remapping them onto one child. Cuts at/inside opening spans, exterior subdivisions, resulting segments below 0.10 m (within 1e-6 m tolerance) and expanded scenes above 256 walls reject. Original wall IDs stay on their first oriented segment; generated part IDs use the entire scene namespace. See [wall junctions](WALL_JUNCTIONS.md).

Openings use half-open `[fromT, toT)` wall-relative spans. For crossing detection, intersect the ray with the wall center plane, determine its segment parameter and interpolated absolute height, then resolve the opening there. Open valid spans remove that assembly's leaf loss; closed spans use leaf material instead of also charging the parent wall. Outside an opening's vertical extent, use the parent wall. A window marked fixed uses its specified material, not an assumed air gap.

Thick solids govern placement and grid masks; center-plane crossings govern the quick attenuation model. This convention deliberately ignores grazing finite-thickness edge transmission. Collinear/tangent contacts do not create ordinary through-wall crossings; return a diagnostic if numerically ambiguous. Adopt an initial world-space epsilon of 1e-6 m, convert it to local parameters relative to segment length, and test endpoint/near-parallel cases. A shared junction receives a deterministic assembly rule, with no duplicate front/back-face loss. Geometry cases unsupported by this rule must be rejected or marked unsupported, not silently invented.

## Quantity and input identity

```ts
type Quantity = 'relative-direct-level-db' | 'received-power-dbm';
type ResultIdentity = {
  workspaceGeneration: number;
  requestId: number;
  queryHash: string;
  solverId: 'acoustic-direct-v1' | 'rf-fspl-multiwall-v1';
  solverVersion: string;
};
type FieldResult = {
  identity: ResultIdentity;
  sceneRevision: number;
  quantity: Quantity;
  unit: 'dB' | 'dBm';
  grid: GridSpec;
  values: Float32Array;
  validity: Uint8Array;
  assumptions: ParameterRecord[];
  computeMs: number;
};
```

These are planning sketches; GridSpec and ParameterRecord become fully defined runtime schemas in CW-002/CW-008. Add discriminated solver configs, typed command payloads, explicit source type validation, and error codes. Acoustic config includes frequencyHz, referenceDistanceM, minValidDistanceM, speedOfSoundMps, and whether illustrative transmission is enabled. RF includes frequencyHz, receiverGainDbi, minimum distance, and other-loss setting. EIRP belongs to the AP; never add transmit gain twice.

Normalize object ordering and numeric serialization before a SHA-256 content hash. Distinguish the whole-project audit hash, geometry hash, and domain query hash. The latter includes only relevant physical content and sampling/solver settings. Exclude camera, colors, timestamps, title, selections, and passive probe labels. Normalize equivalent -0 values; do not round meaningful coordinates solely to make hashes match. Store full content for export; hash a stable versioned representation.

A scene revision orders UI changes; a content hash identifies computation. Opening another workspace increments generation. Changing band without editing geometry still yields a new query. Cached arrays can be rebound to a new request only when full query identity matches. Explain-point responses obey the same guards. Unknown worker messages or malformed arrays are rejected.

## Grid and explanations

Grid records levelId, originXY, cols, rows, cellSizeM, receiverZM, and quality. Cell `(i,j)` samples `(originX+(i+0.5)*step, originY+(j+0.5)*step, receiverZM)`. Store row-major arrays. An invalid mask carries reasons: outside floor, inside solid, below model-distance limit, missing parameter, or unsupported geometry. No valid value is NaN/infinite. Internal calculations use JS double precision; grid output uses Float32 with published tolerances.

Exact-point explanations return the same model's distance, ordered crossing IDs, individual terms, final quantity/unit, parameter provenance, and query identity. The displayed probe value is exact at the selected coordinate; grid inspection identifies the sampled cell coordinate. Hover interpolation is a display approximation and cannot replace an exact point query in a numerical comparison.

Material records separate display, acoustic absorption, acoustic illustrative transmission, and radio effective losses. Each parameter has band/unit/value, provenance kind, optional source/construction context, revision, and notes. Band arrays must align and be monotonic. Unknown bands are errors; no implicit extrapolation or zero-loss fallback. P0 only offers configured representative frequencies unless the user supplies a matching profile.

## Comparison contract

A baseline stores a deep immutable scene plus solver, grid, reference convention, parameters/provenance, solver version, and code release/commit when available. A candidate records baseline parent and explicit changed IDs. Baselines may be recomputed with their original inputs; they cannot mutate when the working scene changes.

For ordinary A/B comparisons require matched phenomenon, quantity, reference, solver/version, frequency, sampling bounds/step/receiver plane, gain/reference conventions, and relevant non-intervention settings. Geometry, source position, and declared material/door changes are legitimate interventions. Changing frequency or EIRP for an intentional experiment is an explicit comparison mode with a visible changed-settings list; default compare offers harmonized recomputation instead of silently normalizing.

Absolute A/B maps share a fixed range. Delta `B − A` is dB for both sound dB and radio dBm; it has a symmetric zero-centered range. Only cells valid in both grids contribute; differing masks are hatched and counts reported. Do not interpolate different grids silently. Domain extents changed by boundary edits require a chosen common sampling domain and recomputation. No subtraction of sound and RF fields.

## Portable project contract

Document includes format `cha-waves-project`, formatVersion, project metadata, scenes, immutable snapshots, comparison definitions, domain configuration, and optional UI preferences in a distinct field. Manifests carry reference convention, exact frequencies/heights, effective materials, solver ID/version, normalized hash, grid, and export timestamp. Binary results are optional future assets; normal P0 JSON recomputes.

Current portable format 3 retains the active scene/settings and optional baseline/reference image, and includes up to 20 named experiment records plus an optional raw measurement survey. Records contain ID, unique trimmed name (80 characters), notes (2,000 characters), timestamps, scene, settings, solver version and optional reference image. `baselineExperimentId`, when present, must identify an existing record whose scene/settings/solver version match the copied baseline. Format 1 migrates with an empty library and no named link. Full-library geometry/placement/provenance, payload, depth and node guards apply before import or library mutations. See [named experiments](NAMED_EXPERIMENTS.md).

Current resource guards include 5 MiB JSON, one level per scene, 256 walls, 256 openings, 64 materials, 64 probes, depth 32, 100,000 JSON values, 100,000 grid cells and 20 named experiments per project. The original planning estimate of 100 snapshots is superseded by the implemented 20-record cap. These limits do not guarantee that every capped scene meets demo latency targets, and the total payload/node limits may apply first. Prototype keys and unexpected executable/HTML payloads are rejected or safely treated as text; no imported scripts, remote asset URLs, or automatic fetches.

Round trips preserve numerical identity within tolerance, not pixel-identical graphics. Timestamps and request IDs can differ. If a solver release changes its behavior, old manifests keep their original version and require compatible recomputation or an explicit migration; do not rewrite provenance to look unchanged.

## Optional local raster reference (October 15 increment)

Project format v1 accepts optional `referenceImage`: `{ dataUrl, pixelWidth, pixelHeight, widthM, heightM, originXY, opacity }`. Existing v1 projects without it remain valid. Only bounded inline PNG/JPEG base64 is allowed; remote URLs and SVG are rejected. Raster header type and dimensions must match the declared metadata. `originXY` is the image's bottom-left world coordinate; screen/image pixels run top-left downwards. The image is re-encoded locally before persistence and is never an input to the physics worker.

Project names and IDs are separate from scene IDs. Creating a home saves the previous project and allocates a fresh project identity. The local library lists at most 50 recent metadata entries, newest first. Concurrent home switches are guarded. Geometry commands remain immutable and validated before canonical state, history, autosave or field computation changes.

`update-wall` also accepts optional `materialId` alongside thickness/endpoints. Applying thickness and material together validates the complete next scene and advances its revision once. Unknown materials or invalid geometry reject the whole command; the original scene remains unchanged.

## Material editing contract

`update-material` accepts an existing material ID, name, overall provenance and complete acoustic transmission/RF loss arrays. It preserves display, absorption and geometry, sorts exact frequencies, rejects duplicates/nonfinite values and advances the scene revision once. Names allow 1–80 trimmed characters and band notes 2,000 characters. Signed dB coefficients retain their existing meaning. Full-project serialization validates payload and snapshot limits before the UI commits. No project/schema/solver version changes are introduced. Supported UI frequencies conservatively intersect referenced wall, door (including open) and window profiles; actual point validity remains path-specific with no frequency interpolation. See [material editor](MATERIAL_AND_BAND_EDITOR.md).

## RF survey contract

Format 3 optionally stores a strict raw survey: ID/name/notes/creation time, common scene/level/frequency/source ID/XYZ/EIRP context, and 1–500 unique observation IDs with labels, absolute receiver XYZ and measured dBm. Source context is observation metadata, never silently rewritten from current settings. Version 1/2 migration preserves earlier records without inventing a survey. Predicted values, residuals, metrics and fitting outputs are excluded from the survey schema. Receiver positions outside valid model geometry remain admissible raw observations; predictions explain their exclusion. Residuals are predicted minus measured in dB, with null metrics when no finite valid residuals exist. See [measurement survey](MEASUREMENT_SURVEY.md).
