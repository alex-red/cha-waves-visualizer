# Research inspection workspace

**Research Lab** is a separate inspection workspace alongside the field visualizer and Echo Lab. Open it from the workspace banner, or from **Open Research Lab** inside Echo Lab. Opening it over Echo keeps the current scan/reviews mounted; closing returns focus to the original trigger. The field project remains unchanged.

## Synthetic plane reference

Choose **3D plane reference**, select Tilted wall, Floor plane or Ceiling plane, and choose **Run synthetic reference**. The view shows a fitted plane patch, one fixed speaker and supplied 3D microphone positions. The patch bounds are a display aid; finite wall extents are not recovered.

**Inspect fitted plane** reveals the estimated normal/offset and the supporting training observation IDs/poses. Missing and ambiguous attempts remain listed. Held-out timing and geometric errors describe the synthetic model only. The image-source assumptions, input hashes and independent evaluation boundary are documented in [SPATIAL_PLANE_REFERENCE.md](SPATIAL_PLANE_REFERENCE.md).

This is a read-only isometric SVG projection. It does not estimate a phone trajectory, map an arbitrary room, display measured wall geometry or generate AI content. No microphone, GPU renderer or external service is needed.

## Local observation replay

Choose **Observation replay**, then **Load synthetic example** to inspect the checked-in three-observation bundle. Speaker/microphone positions and derivation are shown separately. An unregistered frame remains unavailable in world coordinates; original X/Y is not promoted to a full 3D pose.

To inspect your own [spatial bundle](SPATIAL_BUNDLE.md):

1. Select its bundle manifest JSON and the Echo scan source files explicitly.
2. Choose **Inspect selected files**. The browser checks exact-byte SHA256 before parsing each scan, then uses the same report core as `spatial:inspect`.
3. Review source origin, hashes, capture links, supplied/estimated registration, original plan positions and clock identity. Unknown calibration remains unavailable.
4. Use **Download JSON report** for the derived inspection report. Retain the original manifest and scan files separately; this report does not include raw PCM or replace their portable export.

The browser matches selected source files to each declared path's unique basename and verifies the full hash. Duplicate basenames are rejected rather than guessed. For a bundle containing identically named files in different directories, use the CLI's directory-relative replay. Maximum sizes/counts and strict UTF-8/schema validation follow the bundle contract. Files are read locally without upload or automatic storage; Web Crypto SHA256 must be available in the browser context.

A failed import preserves the previous report. Changing selected files or closing the workspace invalidates pending import results. Closing/reopening Research Lab preserves its report in the current tab; a page refresh does not persist it. These inspection operations do not change the field project or Echo scan selections.

## Visual splat baseline

**Visual splats** opens a separate precomputed-asset inspector. **Load metric room** supplies an authored Gaussian-splat room with known synthetic scale/rotation/translation and three illustrative camera poses. **Load CC0 violin** opens a reusable mesh conversion with unknown metric/world registration and no capture cameras. Source kind, license, original hashes and camera roles remain visible. Neither example is an image-trained scene or acoustic reconstruction.

**Load stereo reconstruction** opens an actual [synthetic two-image inverse](SPATIAL_IMAGE_REFERENCE.md) with 14,599 stereo-derived Gaussians and two training camera poses. Its exact bundled hashes enable an offline evaluation record: accepted coverage, depth P90, the retained 1.64 m worst error, two held-out view scores and a downloadable report. Unknown pixels remain holes; these heuristic splats were not trained by Gaussian optimization. Supplied synthetic calibration establishes scale, rather than estimated or physically measured registration.

The native Three.js Gaussian renderer uses WebGPU or WebGL2. Orbit/zoom, keyboard controls, independent appearance/frustum visibility and intrinsics-based camera previews affect only the view. Closing the workspace or leaving the section releases renderer resources; the accepted bundle remains in memory for reopening. `?spatial-webgl=1` selects the WebGL2 path for focused checks. A renderer failure preserves file inspection/downloads and offers retry.

To use your own asset, select a [visual manifest](SPATIAL_VISUAL_BASELINE.md) and its named standard `.splat` file. It is a separate contract from the audio bundle. The importer verifies exact bytes before renderer allocation, retains the previous scene on rejection, and never follows manifest URLs. Use **Save manifest** and **Save original splat** together for lossless reopening; a refresh clears current-tab inspection state. Read the [manual walkthrough](MANUAL_TESTING.md#research-lab-walkthrough) for the complete round trip and negative checks.

## Source boundaries and verification

`apps/web/app/components/ResearchLab.vue` owns presentation and import lifecycle. `apps/web/app/lib/spatial-browser.ts` owns bounded reads of explicitly selected browser files, strict decoding and Web Crypto hashing. Shared bundle, registration, plane/evaluation and report modules remain outside Vue and rendering.

The UI does not automatically fit the audio bundle's existing four-arrival rectangle data to the fixed-source plane reference or register it to a visual asset. The three sections retain their separate input contracts. Real mapping still requires [ECHO-04/05](ECHO_SINGLE_WALL.md) evidence and later association/fusion work. Splat viewing, the synthetic stereo reference and a [local photographic cross-check](SPATIAL_REAL_STEREO.md) are implemented. The photographic baseline failed its frozen geometry gates; its exported manifest/splat can use the existing importer, with its geometry report kept separately. Robust reconstruction, independent world registration, fusion and AI completion remain future stages.

Focused checks:

```sh
bun run test -- apps/web/app/lib/spatial-browser.test.ts
bun run typecheck
bun run build
bun run verify:static-security
bun run verify:offline
bun run test:echo -- apps/web/e2e/spatial-research.spec.ts apps/web/e2e/visual-research.spec.ts apps/web/e2e/echo-lab.spec.ts
```

Follow the [live-build preservation workflow](ECHO_WORKFLOW.md#4-replace-a-live-build-without-losing-the-experiment) before replacing a running capture build. The implementation verification used a separate build directory and fresh test server; it did not restart or replace the user's relay.
