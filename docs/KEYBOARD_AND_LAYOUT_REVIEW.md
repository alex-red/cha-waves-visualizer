# Keyboard and layout review

The interactive plan is focusable and has a screen-reader description of its movement controls. The skip link returns to the plan from the cutaway or comparison view. Selecting a movable object in the desktop scene list focuses the plan; the mobile object picker retains normal select behavior and provides a separate **Focus plan to move selected item** action.

| Context | Behavior |
|---|---|
| Focused plan, movable object selected | Arrow keys move by 0.1 m; Shift + arrow moves by 0.5 m |
| Focused plan | Command/Control + Z undoes; adding Shift redoes |
| Numeric input or native selector | Native editing and navigation remain available |
| Open dialog | Background scene shortcuts are ignored; Escape closes and focus returns to the trigger |
| Focus outside the plan | Arrow keys do not move scene objects |

Invalid movement still goes through the same placement validation as pointer and numeric edits. Keyboard moves are committed history entries, not an independent mutation path. Wall geometry remains a numeric-inspector action.

The plan's two-meter ruler now uses the actual fitted pixels-per-meter scale, including after resize. Cutaway text describes metric geometry and the 0.78 m display wall height, rather than implying physical screen dimensions. Marker labels switch sides near the right canvas edge to keep their names readable on narrow plans. Secondary room labels are omitted where they would collide with marker annotations.

## Automated layout coverage

The browser suite checks 320 × 800, 640 × 450 and 1280 × 720 CSS viewports. At narrow phone widths the header has two rows so Explore, Import, Export and Method remain available. The suite checks horizontal overflow, access to mode/view controls, numeric inspector focus, bounded dialog geometry and internal scrolling.

The 640 × 450 case is a CSS viewport proxy for a smaller view after zoom, not a native browser zoom or text-scaling test. Native browser chrome may receive Tab focus from a modal; tests ensure background page controls remain inert rather than installing a custom trap that blocks browser controls.

These checks complement the axe scans. They do not replace manual screen-reader, native zoom, text-spacing, touch/device or assistive-technology review.
