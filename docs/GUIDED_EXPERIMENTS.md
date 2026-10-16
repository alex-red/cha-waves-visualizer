# Guided home experiments

The reference apartment remains the default fixture for regression tests and timing reports. The optional authored home is a separate example for exploring a more detailed layout. All geometry is in meters; room labels describe spaces and do not add numerical boundaries.

## What an experiment should demonstrate

| Experiment | Controlled change | Interpretation |
|---|---|---|
| Open a door | Open one door crossed by the source-to-probe segment | Removing an assumed door-leaf transmission loss raises the relative direct acoustic level. This says nothing about reflected or diffracted sound. |
| Relocate the access point | Move the active RF emitter while holding the receiver fixed | Distance and crossed assemblies may both change. The resulting dB difference includes both effects. |
| Change the RF band | Hold the scene fixed and change the configured frequency | Free-space loss and the authored frequency-specific material losses change together. This is not a throughput comparison. |
| Off-path control | Change a door outside the selected direct path | The selected direct-path estimate should stay unchanged. Other field cells can still change. Real multipath behavior is outside this model. |

The story text explains a question and the controlled input. The engine supplies the reading; the interface must never substitute a prewritten outcome for the computed number. Exact probe readings use the probe's own height, while plan and cutaway fields display the receiver plane at 1.5 m above the level floor.

## Workspace behavior

Loading a guided example is an explicit action. It must not replace an autosaved project on startup. Loading or applying a story records a workspace history entry so Undo can return to the prior scene, model settings, and baseline. Local project autosave and export follow the normal workspace flow.

Each intervention starts from its authored home state rather than accumulating earlier story changes. This makes the controlled input reproducible. Switching to ordinary editing is still allowed; guidance and displayed results must identify changes to the working state clearly.

## Verification boundaries

Pure-package tests check scene validity, valid source/receiver placement, intervention changes and direct-path control behavior. Browser checks cover entering the example, live reading updates, and restoring the previous workspace. Accessibility checks exercise keyboard dialog behavior, labeled controls, and the compact object selector.

These examples demonstrate solver behavior under assumed coefficients. They are not measured homes or site accuracy validation. The benchmark reports continue to describe the smaller reference fixture and cannot be presented as timings for the richer home.
