# Door and height controls

Existing doors can be selected individually through the desktop door selector, scene list, or compact scene-object picker. The door action applies to the selected leaf. This allows the authored home's study door and bedroom door to be operated independently; the study door is an off-path control for the default bedroom reading. Existing door commands still reject closing a doorway occupied by a source or probe.

This edits authored geometry only. It does not create new doors, walls, windows, rooms, or floors. Window-material semantics remain separate from operable door state.

## Coordinate conventions

| Value | User interface | Stored/solver coordinates |
|---|---|---|
| Source and probe X/Y | Metric coordinates in plan | Scene X/Y in meters |
| Source and probe Z input | Meters above that object's level floor | Absolute Z = floorZ + entered height |
| Exact probe estimate | At the probe's displayed position and height | Full three-dimensional direct segment |
| Field map plane | Fixed at 1.5 m above the level floor | Grid receiverZM = that snapshot's floorZ + 1.5 |

The field plane stays fixed while editing a source or probe height. An exact point reading and a map cell therefore need not describe the same receiver elevation. The inspector states both the probe height and the map plane explicitly. The cutaway places the sampled field on the floor for viewing; its display geometry does not change the sampling plane or physical wall heights.

Imported nonzero floor elevations preserve these conventions. A level whose ceiling is lower than the fixed map plane produces masked map samples and an explicit notice; the app does not silently lower the plane. A valid exact probe below that ceiling can still have a reading.

## Validation and history

Height edits use the same validated immutable commands as X/Y edits. Values below the floor, above the ceiling, non-finite values, and positions inside wall solids are rejected. Uncommitted height drafts survive unrelated redraws. Failed numeric edits reset to the last committed value and leave the scene, reading and history intact. Accepted edits support Undo, autosave and export/import. Guided workspace history also preserves the selected door.

Changing height can alter both distance and which assembly the direct segment crosses. An open doorway is only an aperture below its head: a segment above it crosses the wall. This is geometry-based direct transmission, without diffraction or reflection modeling.

## Evidence

Pure tests cover vertical translation of the building and receiver plane, absolute-height bounds, placement above low walls, and deep history isolation. Raising both direct-path endpoints above the reference open door head preserves distance while adding the assumed partition loss: 8 dB acoustic or 3 dB RF at 2.4 GHz.

Browser flows exercise separate study/bedroom doors, source/probe height changes, undo, persistence, invalid-height recovery, raised-floor imports and the low-ceiling plane notice. The ordinary reference fixture remains unchanged, so its earlier benchmark reports retain their documented numerical scope.

## Home authoring usability · October 15 follow-up

New-wall material and thickness drafts are separate from the selected wall's properties. New walls start with an explicit interior material when the project's library supplies one. Applying an existing wall's thickness and material is a single validated command and one undo step. Changing projects resets editor selections and drafts, including projects sharing the same scene name.

Numeric source/probe XY entries reject empty and outside-floor values, preserve the previous valid scene and restore the committed number. Door IDs such as `door-1` and `door-2` receive distinct labels. Nonrectangular footprints draw their actual boundary without a rectangular shell around the bounding box.

Floor-plan calibration and tracing support image-pixel coordinate entry with keyboard controls; both coordinates are required. Blank coordinate entries never become zero implicitly.
