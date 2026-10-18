# Manual testing · October 17, 2026

The current app is a local-first home field study. Bun 1.4.3 manages the workspace; Node 24 remains required by the explicit Node scripts. Use `bun install --frozen-lockfile`, then `bun run dev` and open http://127.0.0.1:3000. For the static build, use `bun run build` followed by `bun run preview` at http://127.0.0.1:4173. `bun run test` invokes Vitest, not Bun's built-in test runner.

If a live capture build is running, follow the [preservation workflow](ECHO_WORKFLOW.md#4-replace-a-live-build-without-losing-the-experiment) before replacing it. An isolated build/preview can exercise the research interface while keeping the active relay and browser-only scan reviews intact.

## Research Lab walkthrough

This walkthrough needs no phone, microphone, private recording or model service. It tests software inspection and rendering; it does not establish physical mapping or image-reconstruction accuracy.

1. Export the current field project as a comparison record. Open **Research Lab** from the workspace banner.
2. In **3D plane reference**, run Tilted wall, Floor plane and Ceiling plane. Inspect each fitted plane's evidence. Missing and ambiguous attempts must remain visible. Change the case before running again: old results must clear. The patch extents are illustrative, not recovered room bounds.
3. In **Observation replay**, load the synthetic example. Inspect the three observation IDs, separate speaker/microphone world positions, source hashes and explicitly unavailable registration. Download the report; it contains derived observations, not raw PCM.
4. Choose **Visual splats → Load metric room**. Expect a visibly rendered room with floor, walls and furnishings, **WORLD / METRES / Z UP**, synthetic registration and 1,883 Gaussians. Its three cameras must say **illustrative**. The room is authored geometry, not a captured reconstruction.
5. Drag to orbit, use the wheel/pinch to zoom, and focus the canvas for its documented keyboard controls. Choose each camera view, then return to **Free orbit** or **Reset view**. Intrinsics-based previews should preserve the camera aspect ratio using letterboxing. Toggle **Appearance** and **Camera frustums** independently; the corresponding geometry should disappear and return.
6. Inspect provenance, asset/manifest hashes, load timing and decoded-attribute byte counts. The memory figure excludes renderer/GPU overhead. Use **Save manifest** and **Save original splat**. Open the import disclosure, select those two downloads and choose **Inspect selected files**. The asset hash, registration, cameras and appearance must survive.
7. Change one hex digit in a copy of the manifest's asset SHA256 and import it with the same splat. Expect a hash error with the earlier accepted scene still visible and exportable. Try a mismatched filename or invalid JSON as a second rejection case.
8. Load **CC0 violin**. Expect 10,000 Gaussians, explicit **ASSET FRAME / LOCAL UNITS**, unknown world placement and no camera presets. It is a normalized mesh conversion, without photographs or training. The UI must not invent metric scale or capture cameras.
   Then load **stereo reconstruction**. Expect 14,599 Gaussians, two **training** cameras, supplied synthetic metric calibration and the **Offline evaluation** record. Select `stereo-left` and inspect the backdrop, nearer occluder and missing regions. The record must show the 1.64 m maximum error alongside P90 4.25 cm; download the report and check its two held-out views. Switch to the metric room: the stereo evidence panel must disappear. This is synthetic stereo-derived geometry with heuristic splats, without Gaussian training or physical validation. Reproduce it with the [stereo commands](SPATIAL_IMAGE_REFERENCE.md#reproduce-and-inspect).
9. Close/reopen Research Lab and switch between its sections. The accepted report and visual asset should remain in the current tab, while the renderer is released when inactive and recreated on return. After saving both visual files, refresh: inspection state should clear, and the two files should reopen it. There is no automatic visual-file storage.
10. Open Echo Lab's synthetic five-position example, then **Open Research Lab** inside it. Close Research: the scan must still be present and keyboard focus must return to its Research trigger. Close Echo: focus must return to the original Echo trigger. Re-export the field project and compare scene/settings to step 1; research operations must not alter them.
11. Repeat at 390px width and with keyboard-only navigation. Review the actual screen reader, touch orbit/pinch, contrast, reading order and scroll areas. On a real GPU, test the default renderer and the `?spatial-webgl=1` WebGL2 override. If rendering is unavailable, the verified metadata and original-file downloads must remain usable and **Retry renderer** must be available.

For the separate real-data workflow, follow the [Middlebury cross-check](SPATIAL_REAL_STEREO.md), inspect its local geometry report and open its exported manifest/splat through the same importer. The fixed photographic run fails all three screening gates; it is not another bundled example or a held-out camera-view result.

See [visual format/provenance](SPATIAL_VISUAL_BASELINE.md) and [workspace details](SPATIAL_WORKSPACE.md). Physical ECHO-04/05, robust real-image reconstruction/independent registration, acoustic/visual fusion and AI completion remain separate research gates.

## Suggested walkthrough

1. In the original apartment, move the speaker and probe with the plan or numeric controls. Switch Sound / Wi-Fi. Open and close the hall door; confirm the estimate changes and Undo restores it.
2. Choose **New home**, enter a name, width, depth and ceiling height, then create it. The original project should remain under **Homes**. The new project should start with a valid estimate and separated source/probe markers.
3. Choose **Edit home**. Expand numeric wall entry and add an interior segment with endpoints safely inside the footprint. For an 8.5 × 6.5 m home, try `(4, 1)` to `(4, 5)`. Select its material and thickness. Add a door using distance from the wall start, width and height.
4. With **Join intersecting walls** off, try an intersecting wall, a point outside the footprint, or a wall through a source/probe. Expect a clear rejection and preservation of the previous valid scene. Enable the checkbox to create validated interior T/cross junctions. Shared endpoints can move together; exterior envelope edits are protected.
5. Add a room zone with one `x, y` coordinate pair per line, and add a probe at a clear position. Zones name areas but do not attenuate waves. Editor probe Z is absolute; the main inspector's Z is height above the floor.
6. Close the editor, Undo and Redo, wait for **Saved on this device**, then refresh. Accepted edits should persist. Save a baseline, make a controlled change, and use A/B or Compare. Check that RF power is in dBm and differences are in dB.
7. Choose **New home → Trace a floor plan**. Use a local PNG/JPEG, select two points with a known distance and set the scale. Trace and explicitly close the footprint, or explicitly use the whole image extent. Add optional interior segments. The image is a guide; only authored geometry affects the solver.
8. Create the traced home, inspect alignment in Edit home and toggle the floor-plan guide in the main plan. Export JSON, refresh, and import it. The image, scale, geometry and project name should survive.
9. Open **Homes**, rename the current project, close, refresh and reopen another home. Each project should keep its own identity and geometry. Export JSON backups because browser data can be cleared by the browser or OS.
10. Try phone widths, keyboard-only operation, Escape to dismiss dialogs, reduced motion, and an actual screen reader. Test the cutaway on real WebGPU/WebGL devices. The automated suite cannot substitute for those checks.

## Explain a reading

Open **Why this reading** in the inspector, select a crossed assembly and inspect its wall/opening and ray hit on the plan. Open/close the crossed door and confirm its contribution changes between the configured loss and zero. Switch to Wi-Fi to inspect EIRP, receiver gain, free-space path loss and other configured loss. Selection/clearing should not enable Undo; edits, probe changes, imports and closing the disclosure should remove the highlight. See [loss breakdown](LOSS_BREAKDOWN.md).

## Navigate the plan

Use **+ / −**, **Pan** and **Fit** in the workspace and Edit home. Wheel zoom should keep the point under the cursor fixed. Move a source/probe after zooming; its numeric position should agree with the plan. Focus the plan for +/−/0 shortcuts and Pan-mode arrows; native inputs retain their own keys. Workspace Space/middle-button panning is temporary. Cancel an active pan with Escape and confirm its starting view returns without a new history entry.

In Edit home, draw the first wall point, navigate, then choose the second point. The accepted endpoints should use the configured grid/endpoint snapping and join history as one wall edit. Check the ruler after zoom/resize, then Fit to recover the whole home. See [plan navigation](PLAN_NAVIGATION.md) for scope and controls.

## Measure and snap while drafting

Select a diagonal wall and confirm that its metric length stays constant while zooming. Enable **Show wall dimensions** to see other visible walls; crowded/offscreen labels can be omitted. Display changes should leave Undo and exported geometry unchanged.

Choose **Draw a wall**. Hover away from endpoints to see the Grid circle and snapped coordinates, then near an off-grid wall endpoint to see the Endpoint square and target wall. After the first click, inspect the dashed segment and its live length. Click the existing endpoint and confirm the accepted wall uses its exact coordinates. Leave the canvas or enable Pan: the hover preview should disappear while the first point remains available after navigation. At phone width, check that dimensions remain clear of the wall-tool readout. See [drafting feedback](DRAFTING_FEEDBACK.md).

## Split and join walls

For [wall junctions](WALL_JUNCTIONS.md), add a crossing interior wall with the checkbox enabled and verify that every incident segment shares the same endpoint. One Undo/Redo should restore/reapply all segments. Select a wall with an opening and split outside the opening: its position, width and state should survive export and reload after saving. Attempt a cut through the opening or an exterior wall and check that geometry/history remain intact. Inspect the split controls at phone width and with the keyboard.

## Keep named experiments

Open **Experiments**, save a named state with notes, close the dialog and move the source. Reopen the saved experiment and inspect the changed position. Load it, then use Undo/Redo to check that the whole scene/settings state restores together.

Duplicate a saved experiment, rename it and edit notes. Select it as baseline, close the dialog and make a compatible door change: A/B should use the named state. Remove the active named record and verify that the copied baseline remains; Undo should restore its record and link. Check mismatched Sound/Wi-Fi settings remain explicit.

Wait for saved status, reload and export/import into a fresh browser context. The library, notes and named baseline should survive. Import a version 1 file to verify its original baseline survives with an empty experiment library; reject a malformed snapshot without replacing the workspace. Try a duplicate name and ensure entered drafts remain available. See [named experiments](NAMED_EXPERIMENTS.md).

## Compare source placements

Open **Find source placement**, choose probes and an objective, then **Find positions**. Check the numbered candidates and each probe’s tradeoff. Apply one position and verify one Undo/Redo restores/reapplies only that source move. Change the goal or selected probes to clear old results; cancel a run and restart it. Empty probe lists and absent active sources must prevent a search.

In Wi-Fi mode, set the coverage threshold to 100 dBm and then −300 dBm: no valid samples and then all valid samples should qualify. Excluded cells remain excluded at either threshold. A blank input should explain that a finite threshold is needed. Search/threshold changes should leave project exports and history unchanged; an applied move should survive save/reload. Inspect keyboard focus, Escape and results at phone width. See [placement explorer](PLACEMENT_EXPLORER.md).

## Edit materials and bands

Open **Materials and bands** and select the lightweight partition. Increase its 1,000 Hz acoustic loss by 4 dB; Apply, close and check that a probe path crossing that partition drops by 4 dB. One Undo/Redo should restore/reapply the whole profile. Edit provenance and notes, wait for saved status, reload and export/import: the accepted values should survive while a previously saved baseline/experiment retains its own profile.

Add 500 Hz rows to each referenced wall and door material. The frequency should become selectable only when every required profile is present. Remove a current-band coefficient and confirm an explicit missing-data notice and unavailable crossed paths, with no automatic frequency fallback. Try duplicate frequencies, zero/blank frequencies and blank losses: reject the draft without changing scene/history. Close unapplied drafts and inspect native keyboard focus, Escape and 320-pixel layout. See [material editor](MATERIAL_AND_BAND_EDITOR.md).

## Compare measured RSSI

Open **Measurement survey** in Wi-Fi mode and download a CSV template. RSSI cells must be blank; fill them with actual measurements, choose/paste the file and Import. Check exact predictions, signed predicted-minus-measured residuals and bias/MAE/RMSE. Include an out-of-floor point to confirm explicit exclusion; entirely invalid predictions must show unavailable metrics. Source movement, band changes or a different source context should pause comparisons, while a compatible door/material change recomputes predictions.

Close the dialog and Undo/Redo import and removal. Wait for saved status, reload and export/import format 3: raw observations/context/name/notes should survive without computed results becoming measurements. Migrate strict version 1/2 files, retaining earlier baselines and libraries. Reject mixed-source rows, missing numeric cells, duplicate IDs and oversized CSV without replacing accepted observations. Check empty/populated dialogs, focus/Escape and table scrolling at phone width. See [survey guide](MEASUREMENT_SURVEY.md).

## Current boundaries

Sound is a relative direct-path distance/transmission estimate; RF is free-space path loss plus configured assembly losses. Material coefficients are illustrative. Reflections, diffraction, reverberation, measured calibration, multipath, throughput, automatic floor-plan recognition and multi-floor propagation are outside the current implementation. The field map samples 1.5 m above floor; the probe has its own height.

Images remain local, are bounded before browser decoding, downsampled to at most 1600 pixels per side and re-encoded to strip source metadata. PNG/JPEG only; maximum original upload 12 MB / 16 megapixels, encoded reference approximately 1.5 MB, whole project JSON 5 MiB. No upload service is used.

If local storage fails, the current workspace stays editable and exportable. A home switch first saves the current project; if preservation fails, it stays on the current home so you can export it. Geometry commands are undoable within a project; switching projects resets that project's in-memory undo history.

Project JSON export uses committed inputs and remains available while a calculation is pending or its worker has failed. Finish or cancel a drag preview before exporting. Large homes automatically use a coarser field grid within the 100,000-cell budget; the displayed grid size is the actual sample spacing. Working/baseline fields use a common step, and exact probe readings still evaluate the authored coordinates directly.

Firefox needs a separate supported-environment run: the installed local Playwright Firefox binary previously failed to launch. No public deployment or release certification is implied by manual-test readiness.

## Automated handoff checks

October 17 stereo handoff: **459 Vitest checks**, full package/script/Vue typechecks, an isolated production build, security/offline integrity and repository hygiene passed. All **13 focused Chromium/WebGL2 Research Lab checks** passed, including the stereo artifact's appearance pixels, supplied camera previews, frozen evidence/report and clearing evidence on asset replacement. The synthetic inverse also has deterministic original-byte and source-split checks, retained rejection outcomes, negative controls and a nonzero-camera-origin export regression. Default WebGPU stereo rendering was inspected interactively. Real-image robustness, independent registration, physical mapping, touch/screen-reader behavior and the broader device/browser matrix remain outside this evidence.

Earlier October 17 visual import handoff: 426 Vitest checks and full typechecks passed, followed by an isolated production build, security/offline verification and repository hygiene checks. Eight new Chromium/WebGL2 visual checks and four existing Research Lab checks passed. These exercised camera/registration pixels, clipping, original-file round trips, failure/retry, interrupted imports, unknown scale and mobile layout/accessibility; default WebGPU room rendering and close/reopen were inspected interactively.

October 15 follow-up: 236 unit tests; 137 browser scenarios each in Chromium and WebKit (274 total); strict package/script/Vue typechecks; production static generation; fixture identities and round-trip checks; generated security-header and offline-artifact verification. The final combined browser run completed with all 274 passing after project/history/worker extraction, shared display consolidation, the interactive loss breakdown, navigation, drafting, interior junctions, named experiments, placement studies, the material editor, RSSI surveys and offline workspace. Unit regressions also cover an import whose file read overlaps startup restore, a late restore after a home switch and teardown during pending work. Bun frozen installation was verified in an isolated clean copy while preserving dependency versions. These are local results, not a remote CI or complete real-device certification.

## Additional authoring checks

- Open Edit home before and after switching projects: new walls should show a valid interior material, independent of any previously selected wall. Apply both thickness and material to a selected interior wall; one Undo should restore both.
- Clear a source/probe XY value or enter a value outside the floor. The app should reject it, keep the existing estimate and restore the last committed number.
- Use the floor-plan image-coordinate alternative to enter two calibration points with the keyboard. Missing either coordinate should produce guidance rather than adding a point at zero.
- Inspect an L-shaped footprint and multiple new doors: the plan should retain the true outline, and doors should have distinct names in the controls.

## Review-fix checks

- Create an 80 × 80 m home. It should compute a 0.5 m field, allow a saved baseline and retain compatible A/B after a source move. A 200 × 200 m imported home should regenerate a 1 m field and its baseline after reload.
- With the worker unavailable, export should still download the committed scene and baseline inputs. Export during a pending calculation should include the latest accepted edit, while an active drag preview disables export.
- Import a project whose probe list is empty. The measurement should be unavailable, its coordinates blank/disabled, and the inspector should explain how to add a probe. Refreshing and changing domains should preserve that state.
- Import a scene with inactive emitters before and after the active emitter. Source controls should operate on the active emitter in either domain. A domain without an active emitter should show blank source coordinates and no invented distance/loss terms.

## Multi-probe workflow

Add and name several probes, then use **All readings** in the measurement inspector. Every point is visible on the plan and can be located from the panel. Check exact point values, same-coordinate baseline changes, mismatched-band explanations and CSV export. See [probe readings](PROBE_READINGS.md) for detailed checks and column semantics.
## Offline workspace

Generate the static build and open Homes while connected. Confirm no service worker/cache is installed until **Make available offline**. Wait for ready, close Homes, disconnect and reload. Check saved numeric edits, field computation, placement search, the first lazy cutaway load and JSON export. Reconnect, check for an update and use **Save and reload update**; a failed save must prevent reload. Keep another tab open and check its lazy assets after updating. A failed asset digest must leave the previous version complete.

Remove the offline copy and confirm saved homes and unrelated site caches/registrations survive. Clear one app-cache entry and reload online: ready should become false and **Repair offline copy** should restore it. Exercise persistence grant, decline and missing API without changing project inputs. At 320 CSS pixels, inspect reading order, button wrapping, keyboard focus and Escape return. See the [offline guide](OFFLINE_WORKSPACE.md) for host requirements and cache-retention limits.
