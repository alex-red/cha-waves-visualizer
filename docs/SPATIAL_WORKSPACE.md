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

## Source boundaries and verification

`apps/web/app/components/ResearchLab.vue` owns presentation and import lifecycle. `apps/web/app/lib/spatial-browser.ts` owns bounded reads of explicitly selected browser files, strict decoding and Web Crypto hashing. Shared bundle, registration, plane/evaluation and report modules remain outside Vue and rendering.

The UI does not automatically fit the bundle's existing four-arrival rectangle data to the fixed-source plane reference. The two sections retain their separate input contracts. Real mapping still requires [ECHO-04/05](ECHO_SINGLE_WALL.md) evidence and later association/fusion work. Gaussian splats and AI completion remain future stages.

Focused checks:

```sh
bun run test -- apps/web/app/lib/spatial-browser.test.ts
bun run typecheck
bun run build
bun run verify:static-security
bun run verify:offline
bun run test:echo -- apps/web/e2e/spatial-research.spec.ts apps/web/e2e/echo-lab.spec.ts
```

Follow the [live-build preservation workflow](ECHO_WORKFLOW.md#4-replace-a-live-build-without-losing-the-experiment) before replacing a running capture build. The implementation verification used a separate build directory and fresh test server; it did not restart or replace the user's relay.
