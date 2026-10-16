# Measurement survey · October 15, 2026

Open **Measurement survey** in the inspector to import manually collected RSSI and compare it with the current RF model. A project holds one survey with up to **500 observations**. Measurements remain separate from predictions, and importing a survey does not move a source, create probes or change solver settings.

## Collect and import observations

Switch to **Wi-Fi** with an active source and choose **Download CSV template**. The template copies the current frequency, modeled source ID, source position and EIRP, plus existing probe positions. Its RSSI cells are blank: enter actual measurements rather than copying model predictions. With no probes, the template leaves receiver coordinates blank too.

The source ID names an emitter in the project; match it to the transmitter used for collection. Use notes for receiver/device details, collection conditions and relevant limitations. All source coordinates and receiver Z values are **absolute scene coordinates in meters**, rather than height above floor. A receiver 1.5 m above a floor at Z=10 has `z_m=11.5`.

Fill the template, then choose a local CSV file or paste its contents. Enter a survey name and optional notes, review the CSV, and press **Import survey**. Selecting a file only loads a draft. A successful import replaces the previous survey as one undoable action. Invalid files preserve the existing survey and draft; closing the dialog discards unapplied form edits.

The required columns, in order, are:

```csv
id,label,x_m,y_m,z_m,rssi_dbm,frequency_hz,scene_id,level_id,source_id,source_x_m,source_y_m,source_z_m,eirp_dbm
```

Every row must have 14 cells. Numeric cells accept finite decimal/scientific notation; blank values, nonfinite values and JavaScript radix notation are rejected. Frequencies must be positive. Observation IDs must be unique and contain 1–80 characters; labels allow 80 characters. Names allow 1–80 trimmed characters and survey notes 2,000 characters. CSV input is limited to **1 MiB**. Quoted commas, quotes and newlines, UTF-8 BOM and CRLF/LF line endings are supported.

All rows must carry the same scene, level, frequency and source context. Split observations from different bands or transmitter states into separate files. Source/scene/level IDs allow 128 characters. Receiver points outside the modeled floor or inside a solid can be retained as measurements, with their predictions explicitly excluded.

## Read the comparison

The table evaluates the existing RF solver at each observation's exact X/Y/Z. It shows measured dBm, predicted dBm and **residual = predicted − measured**, in dB. A positive residual means the model predicts more received power than was measured. The location map marks observations by residual sign or exclusion; it is not a predicted heatmap.

The summary uses only finite, valid residuals:

| Metric | Meaning |
|---|---|
| Bias | Signed mean residual; positive and negative errors can cancel |
| MAE | Mean absolute residual |
| RMSE | Square root of the mean squared residual |
| Valid / excluded | Observations included in or excluded from those metrics |

Invalid estimates and nonfinite residuals never become zero. The table explains exclusions such as points inside walls, missing material data or distances below the model minimum. If all observations are excluded, metrics are unavailable. Metric calculations scale residuals before accumulation to avoid numerical overflow.

Comparison requires the current **radio mode, scene ID, level ID, frequency, active source ID, source XYZ and EIRP** to match the recorded context exactly. A mismatch pauses predictions and residuals without discarding observations. Restore the matching state to resume. Template values retain full numeric precision; display rounding does not change the context.

Changing current geometry, door states or material coefficients intentionally recomputes predictions against the same observations. Current receiver gain, other loss and minimum-distance assumptions are shown with the summary. Changing assumptions can improve agreement on these observations; that alone does not establish independent accuracy.

## Save, undo and export

Importing/replacing or removing a survey participates in workspace **Undo/Redo**. Close the dialog to use history controls. Wait for **Saved on this device** before reloading. New homes start without a survey; loading a named model experiment retains the attached observations and checks their context against the loaded inputs.

**Export observations** downloads raw measurements and their recorded source context. Numeric RSSI stays numeric; formula-like text is escaped reversibly for spreadsheet use. Survey name, notes and import timestamp are retained in the project backup rather than the 14-column CSV. Predictions, residuals and metrics are derived and are not stored as observations.

Portable **project format 3** adds the optional survey. Version 1 files migrate with an empty experiment library; version 2 files retain their library, named baseline and other inputs. Both migrate without inventing observations. Scene/settings, metadata, baselines and guides are preserved. New exports use version 3 and require a build that understands it. The existing 5 MiB project and JSON depth/node limits cover the survey together with all snapshots and images.

## Scope and verification

This increment provides descriptive comparison, CSV input/output and persistent raw observations. It does **not** fit parameters, introduce a new propagation model or claim calibration. Bounded fitting remains deferred until a spatial training/holdout design is defined. Reflections, diffraction, multipath and throughput remain outside the existing direct-path models.

Pure tests cover CSV grammar/limits and reversible escaping, exact predictions, hand-computed error metrics, invalid-point exclusions, context changes, numerical overflow, immutable history, strict migration and payload guards. Browser tests cover import/undo, persistence, source/band mismatch, changed-model predictions, rejected drafts, template blanks, raw exports and dialog accessibility. Test observations are synthetic fixtures, not a collected site-validation dataset. See [implementation status](IMPLEMENTATION_STATUS.md) for final evidence and remaining manual/device checks.

[Desktop survey](../reports/screenshots/measurement-survey-desktop.png) · [Phone survey](../reports/screenshots/measurement-survey-phone.png)
