# Named experiments · October 15, 2026

Open **Experiments** to keep named states of the current project, inspect changes and revisit a controlled comparison. The library stays with its home in local storage and portable JSON.

## Save and revisit a state

Enter a **Name**, add optional **Notes**, then choose **Save current state**. A saved experiment contains a separate copy of the committed scene, current domain's solver settings and optional calibrated floor-plan guide. Later edits do not change that snapshot. Capture remains available while a calculation is pending or its worker is unavailable; unfinished drag previews must be completed or cancelled first.

Select a **Saved experiment** to inspect its name, notes and changed inputs. **Duplicate experiment** makes a separately named copy of the saved inputs. **Update details** changes only its name and notes. Names are trimmed, limited to 80 characters and unique ignoring case; notes allow 2,000 characters.

**Load experiment** restores its scene, settings, domain and guide in the current project, then closes the dialog. The project identity, experiment library and current comparison baseline are retained. Loading is one history entry. Saving, duplication, metadata edits, removal and baseline selection also join workspace history; close the dialog to use **Undo/Redo**.

The library supports up to 20 experiments. The existing 5 MiB total project, depth and JSON-node limits apply to the entire library, so large scenes or repeated guide images may reach a payload limit earlier. Rejected operations preserve the workspace, library and history. Rejected saves keep the entered name and notes available for correction.

## Inspect changed inputs

The **Current workspace changes** table compares the selected saved state with the working scene. It identifies changed fields on levels, walls, openings, materials, emitters, probes and zones, plus solver settings and guide properties. Added and removed objects are identified by ID. Revision-only changes and entity ordering are ignored.

Saved and current values appear side by side. Guide image replacement is identified without printing embedded image bytes; scale, origin, opacity and other guide fields have their own rows. Notes and labels display as text. An empty table states that the current inputs match the saved experiment; it does not claim measured physical agreement.

## Choose a comparison baseline

**Use as baseline** copies the selected experiment into the existing A baseline and regenerates its field locally. The working scene stays in place. The selector and record show which named experiment supplies the baseline. Renaming it preserves the link.

Existing comparison rules still apply: A/B and difference views require compatible domains, frequencies, settings and sampling grids. A differently configured experiment can be retained as a baseline while those views explain the incompatibility. No cross-domain dB comparison is fabricated.

Removing the named record retains the copied baseline inputs and clears its name link. Undo restores the record and link together. The inspector's **Save as baseline / Replace saved baseline** uses the current workspace, clears the named link and is also undoable.

## Storage and migration

Project format **version 2** introduced `experiments` and an optional `baselineExperimentId`, alongside the existing working scene, settings, baseline and guide. Snapshot inputs are validated on import, including geometry, placement, solver provenance, unique IDs/names and payload limits. Field arrays remain excluded and regenerate locally.

Version 1 files and stored projects migrate to version 3 with an empty experiment library, preserving their original working inputs, baseline, metadata and guide. They are not automatically given invented experiment records. Version 2 projects also migrate while retaining their saved library. New exports use version 3, which also supports an optional [measurement survey](MEASUREMENT_SURVEY.md); earlier builds cannot read those exports. Loading a model experiment retains the project’s attached survey and checks its source context for comparison.

Wait for **Saved on this device** before reloading. Export a JSON backup for portability; browser storage remains local to the device and may be cleared.

## Verification

Pure checks cover immutable captures, collision-free duplicate names/IDs, all authored input groups, guide changes without base64 disclosure, format migration, invalid snapshots, library limits and undo/redo of state and baseline links. Browser checks cover loading/undo, changed source inputs, notes/duplication, named baselines, reload, fresh-context import, rejected saves/imports, legacy migration, capture without a worker and 320-pixel keyboard/accessibility behavior. See [implementation status](IMPLEMENTATION_STATUS.md) for final counts and remaining release gates.

[Desktop changes](../reports/screenshots/experiments.png) · [Phone library](../reports/screenshots/experiments-mobile.png) · [Phone actions](../reports/screenshots/experiments-mobile-details.png) · [Comparison assumptions](DATA_CONTRACTS.md#comparison-contract)
