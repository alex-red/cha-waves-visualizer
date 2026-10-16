# Wall splitting and junctions · October 15, 2026

**Edit home** can split an interior wall at a measured distance and create interior T or cross junctions while adding a wall. Each accepted operation is one undoable scene edit, including every resulting segment and opening reference.

## Join intersecting walls

Enable **Join intersecting walls**, then draw a wall or use **Enter wall coordinates**. When the new segment crosses an interior wall's centerline, the intersecting walls are divided at the shared point. An endpoint placed on the middle of an interior wall creates a T junction; a segment passing through it creates a cross junction. Multiple intersections are handled in the same edit.

The checkbox starts off. Ordinary additions retain the existing intersection rejection. Endpoint/grid snapping still determines drafting points; this feature does not snap a nearby point onto a wall's body. Use numeric coordinates when precise centerline contact is needed.

After creation, each segment is selectable and has its own dimensions, material and openings. The original wall ID remains on the segment beginning at its original start point. Additional segments receive unique part IDs. Moving a shared endpoint updates all connected segments through the existing **Move connected endpoint** action.

## Split an existing wall

1. Select an interior wall.
2. Enter **Split distance from start** in metres, measured along the wall from its authored start point. The initial value is halfway along the wall.
3. Choose **Split wall**. Inspect the two segments, then use Undo/Redo to restore or reapply the whole change.

This preserves the original geometry and physical wall properties. Door, passage and window IDs, state, materials, height and world positions remain intact; their wall-relative spans are remapped to the child segment that contains them. A split counts as a geometry edit, so calculations refresh and the changed scene autosaves. Wait for **Saved on this device** before reloading.

## Supported boundaries

- Exterior envelope walls remain fixed and cannot be subdivided by these tools.
- Cuts through an opening, on an opening edge or within the 1e-6 m geometry tolerance of an edge are rejected. Move the cut away from the opening.
- Every resulting segment must be at least 0.10 m long, within the same geometry tolerance. The expanded scene must fit the 256-wall limit.
- Collinear overlaps are rejected; walls are not automatically merged. Existing boundary, solid-collision, source/probe placement and schema validation still run before acceptance.
- Rejected edits preserve the existing scene and history. Project JSON keeps its current format: the resulting segments and remapped openings are ordinary scene objects.

The quick solver retains its existing deterministic rule that a ray hitting a shared junction counts one assembly. Splitting an unchanged wall preserves tested sound/RF estimates, including a ray through the split point and rays through an unchanged opening. This does not introduce a new junction propagation model or improve physical accuracy.

## Verification

Pure tests cover ordinary versus opted-in additions, reversed/diagonal/multiple intersections, opening remapping, scene-wide ID collisions, the expanded wall cap, immutable rejection, minimum segment boundaries and acoustic/RF crossing consistency. Browser checks cover numeric cross junctions, pointer-created T junctions, atomic undo/redo, export/reload, opening-preserving splits, rejected opening cuts, exterior protection and 320-pixel controls/accessibility. See [implementation status](IMPLEMENTATION_STATUS.md) for the final verification counts and limits.

[Desktop junction](../reports/screenshots/wall-junctions.png) · [Phone controls](../reports/screenshots/wall-junctions-mobile.png) · [Drafting feedback](DRAFTING_FEEDBACK.md)
