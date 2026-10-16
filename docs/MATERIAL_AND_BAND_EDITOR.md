# Materials and bands · October 15, 2026

Open **Materials and bands** in the measurement inspector to edit an existing material's name, provenance and acoustic/RF coefficients. Material IDs, assignments and geometry remain stable. The editor shows which walls and openings share the material; applying a profile changes every assembly that uses it. An opening with its own leaf profile uses that profile at the opening rather than its host wall’s coefficient.

## Edit a profile

Choose a **Material**, then edit its name or provenance. Each acoustic transmission and radio loss row contains an exact **Frequency (Hz)**, **Loss (dB)**, **Provenance** and optional **Notes**. Both profiles are visible together on desktop and stack on phones. **Add acoustic band / Add radio band** creates an empty draft; enter the values before applying. Remove a row to explicitly remove that coefficient.

Frequencies must be positive and finite, with no duplicates in a profile. Values must be finite and may be signed, preserving the existing model contract. A negative loss raises the predicted level; it should reflect a deliberate authored assumption. Rows are sorted by frequency when accepted. Names are trimmed and allow 1–80 characters; each band's notes allow 2,000 characters. Existing per-band provenance is preserved unless changed explicitly.

Press **Apply material** to accept the whole profile as one scene revision and one history entry. Validation covers the full portable project, including its saved experiments, baseline and reference image, before history or autosave changes. Invalid edits keep the current scene and entered drafts. Applying unchanged values leaves history alone. Close the dialog to use **Undo/Redo**; closing without applying discards unfinished drafts.

The editor preserves display properties and acoustic absorption data. Absorption is not a parameter in the direct-path sound model. Wall thickness controls geometry and intersections; the authored coefficient describes the assembly. Changing thickness does not automatically scale the coefficient.

## Choose a frequency

The inspector's **Frequency** selector includes exact frequencies shared across all referenced wall and opening profiles for the current domain. This is deliberately conservative: door leaf data is required even while a door is open, so closing it does not introduce an unsupported band. Window profiles are included; a passage's separate material is ignored. Unreferenced materials do not restrict the selector.

To use a new acoustic band such as 500 Hz, add that exact frequency to every referenced wall and door/window material. Once all are present, it becomes selectable. Radio retains the familiar 2.4, 5 and 6 GHz labels alongside any other complete authored frequencies. Incomplete alternatives cannot be selected. Free-space scenes and disabled acoustic transmission do not require assembly loss data.

Removing a coefficient at the active frequency preserves that current setting and explains which materials lack data. The solver continues to evaluate each path: only paths that actually cross a missing coefficient become unavailable. There is no nearest-band fallback, interpolation or automatic change of frequency. Opening a door or disabling transmission retains the existing numerical behavior.

## Save and compare

Applied profiles autosave and round-trip in **project format 3**. Baselines and saved experiments retain their own material snapshots. Save a new experiment to keep an alternative profile; use the changed-input table and compatible A/B views to inspect it. The material editor itself needs no scene-schema, solver version or formula migration. Format 3 additionally stores optional raw measurement surveys; version 1/2 project imports migrate.

The material editor operates on committed inputs independently of field-worker availability. A rejected oversized project remains editable with its previous scene. Finish or cancel an active drag before opening the editor. Temporary form drafts never enter project JSON, source-placement results or history; accepted material changes invalidate old placement results through the existing scene-input guard.

Coefficients and provenance describe authored inputs, not a calibrated result. The sound model remains a relative direct-path estimate, and RF remains free-space path loss plus assembly losses. Reflections, diffraction, multipath and measured calibration remain outside this increment.

## Verification

Pure checks cover immutable profile updates, exact acoustic/RF loss changes, signed coefficients, missing bands, conservative frequency coverage, project payload rejection and isolated baseline/experiment round trips. Browser checks exercise accepted/rejected drafts, one-edit undo/redo, persistence, newly complete bands, missing current data and phone dialog accessibility. See [implementation status](IMPLEMENTATION_STATUS.md) for final counts and remaining device/manual checks.

[Desktop editor](../reports/screenshots/material-editor-desktop.png) · [Phone editor](../reports/screenshots/material-editor-phone.png)
