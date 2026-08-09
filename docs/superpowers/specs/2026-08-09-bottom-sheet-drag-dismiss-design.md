# Bottom-sheet drag-to-dismiss — app-wide standard

Date: 2026-08-09
Scope: `mobile-app` only. No server or web-app changes.

## Problem

Bottom cards across the app dismiss inconsistently. Three sheets use the shared
`utils/useSheetDismiss` hook, three rolled their own near-duplicate
PanResponders with different thresholds, and one has no drag at all. Even where
drag works, the motion is unfinished: the backdrop stays fully dark through the
pull and then blinks off, and one sheet snaps back up at the moment it commits.
The grab area is a narrow grabber strip, so the obvious target — the title — does
nothing.

The reference feel the user pointed at is the calendar day-planner sheet
(`screens/TasksScreen/components/CalendarView.jsx:1891`): header pan, tracks the
finger, spring-snaps on release with velocity projection.

## Goal

One dismissal behaviour everywhere:

1. Dragging anywhere on the sheet's top header block — grabber, title, subtitle,
   cover thumb — pulls the card down.
2. The dimmed backdrop fades out progressively as the card is pulled.
3. On commit the card continues smoothly all the way off the bottom of the
   screen before the sheet unmounts. No pop, no snap-back, no double-close.

And a standing rule: every future bottom sheet uses the same primitive.

## Current state

| File | Today |
| --- | --- |
| `utils/useSheetDismiss.js` | The primitive. PanResponder + RN Animated. Tracks 1:1 down, rubber-bands up ×0.25, commits past `dy > 90` or `vy > 0.6`, slides to `SCREEN_H`, then fires `onClose`; parks off-screen until the next open (deliberate — resetting at close time made every dismissal visibly close twice). Returns `dragY`, `panHandlers`, `sheetDragStyle`. |
| `TasksScreen/components/FilterMenu.jsx` | Uses the hook. Grabber-only grab zone (`styles.handleZone`). |
| `TasksScreen/components/ProjectManager.jsx` | Uses the hook. Grab zone wraps only the handle view. |
| `TasksScreen/components/WheelTimePicker.jsx` | Uses the hook. Out of scope for edits, but inherits the motion changes. |
| `TurtleScreen/components/AlbumActionsSheet.jsx` | Bespoke responder. Commits at `cardHeight/3` or `vy > 0.7` and calls `onClose()` immediately — the card springs back to rest while the host's fade-out plays, which is the visible pop. Composes drag with its entry animation via `Animated.add`. |
| `TurtleScreen/components/TrackActionsSheet.jsx` | Bespoke near-copy of the same. |
| `TasksScreen/components/TaskQuickInspector.jsx` | Bespoke capture-responder (its header sits inside a scroll parent), own thresholds, Modal-local keyboard lift via `Animated.Value`. |
| `TasksScreen/components/TaskDetail.jsx` | No sheet drag. Full-height card inside a ScrollView with a left-edge back swipe. |
| `TurtleScreen/components/AlbumShareSheet.jsx` | No drag at all. In-tree overlay with a `useAnimatedKeyboard` lift. |

## Design decisions

Settled during brainstorming:

- **Rollout scope**: the vault sheets plus the task sheets. Seven files.
  Command console, Notes, Profile, MediaGallery's own inline sheets and the
  pickers are out of scope for this pass.
- **Grab region**: header only. Not scroll-aware body dragging — inner
  ScrollViews never drive the dismissal.
- **Detents**: one. Open, or dismissed. No peek/half state.
- **Primitive ownership**: drag-close only. Each sheet keeps its own
  Modal/overlay, entry animation, backdrop element and keyboard lift. Seven
  sheets already have device-tuned presentation code (nested-Modal gotcha,
  chrome underlay, keyboard sync); this change must not disturb it.

## Architecture

`utils/useSheetDismiss.js` remains the single source of truth and gains a small
motion contract. Nothing else is created.

### Hook API

```js
const {
  panHandlers,     // spread on the header BLOCK
  dragY,           // Animated.Value — raw offset, for Animated.add composition
  sheetDragStyle,  // { transform: [{ translateY: dragY }] }
  progress,        // Animated 0..1 — dragY / measured card height, clamped
  onCardLayout,    // put on the card so travel uses its real height
} = useSheetDismiss(onClose, visible, { capture: false, bottomInset: 0 });
```

- `progress` is a derived `Animated` node (`dragY.interpolate`), never React
  state, so scrim opacity stays on the native driver.
- `capture: true` attaches `onMoveShouldSetPanResponderCapture` instead of the
  bubbling variant, for headers rendered inside a ScrollView.
- `bottomInset` is added to the off-screen target so the card clears the home
  indicator area, not just the card's own height.
- If `onCardLayout` never fires, travel falls back to `SCREEN_H` — current
  behaviour, so an unmeasured sheet still works.

### Gesture claim

Unchanged and now uniform: `dy > 6 && |dy| > 1.2 * |dx|`. Taps and horizontal
swipes fall through, which is what lets a close button live inside the drag
block.

### Motion

During drag:
- Card follows the finger 1:1 downward; upward is rubber-banded ×0.25.
- Scrim opacity = `progress` interpolated `[0,1] → [1,0]`.
- `Keyboard.dismiss()` on drag start so a keyboard lift can't fight the pull.

Commit (`dy > 90` or `vy > 0.6` px/ms):
- `Animated.spring(dragY → cardH + bottomInset)`, `velocity: g.vy`,
  `overshootClamping: true`, `useNativeDriver: true`. Seeding the fling's
  velocity is what makes the release continuous rather than a restart.
- Scrim fades over the same value, so card and backdrop leave together.
- `tapHaptic()` at the commit instant.
- `onClose()` fires on spring completion. The card stays parked off-screen; the
  existing `visible` effect re-zeroes it on the next open.

Cancel:
- `Animated.spring(dragY → 0)`, `velocity: g.vy`, `damping 22 / stiffness 220 /
  mass 0.7` — AlbumActionsSheet's tuning, the best-feeling of the three current
  variants. Scrim rises on the same value.

Terminate (responder stolen): same spring as cancel.

### Grab-region rule

`panHandlers` go on a `View` wrapping the entire top header block: grabber,
cover thumbnail, title, subtitle. A header row that *is itself* a button stays
outside that wrapper. Buttons *inside* it (the close X) need no change — the
claim threshold leaves taps alone.

## Per-sheet changes

| Sheet | Change |
| --- | --- |
| `AlbumShareSheet` | Add the hook. Header block = grabber + title + subtitle; the close X stays inside and tappable. Scrim opacity ← `progress`. Drag rides the inner card; the existing `useAnimatedKeyboard` lift stays on the outer anchor (an RN Animated value and a Reanimated style cannot drive the same node). |
| `AlbumActionsSheet` | Delete the bespoke responder; use the hook's `dragY` in the existing `Animated.add(entry, dragY)`. Grab region grows from `styles.grabArea` to the whole header. Scrim ← `progress`. Fixes the commit-time pop. |
| `TrackActionsSheet` | Same treatment as AlbumActionsSheet. |
| `TaskQuickInspector` | Replace the bespoke capture-responder with `useSheetDismiss(..., { capture: true })`. Keep its Modal-local `kbLift`. Widen the grab region past `styles.header`. |
| `TaskDetail` | Add the hook with `capture: true` on `styles.header`. The edge-back responder is untouched: it claims horizontal (`dx > 8 && |dx| > 1.5|dy|`), the hook claims vertical — disjoint. |
| `FilterMenu` | Widen the grab region from `styles.handleZone` to the full header; scrim ← `progress`. Inherits new motion. |
| `ProjectManager` | Same as FilterMenu. |

`WheelTimePicker` gets no edit but inherits the motion; it must be re-verified.

## Risks

- **TaskDetail capture-responder vs its ScrollView.** A header drag must not
  steal list scrolls. The claim threshold should hold, but this is the one that
  needs deliberate on-device testing.
- **Native-driver purity.** Scrim opacity must derive from `dragY`. Any React
  state in that path silently moves the fade to the JS thread.
- **Vault overlays.** `AlbumActionsSheet` and `AlbumShareSheet` are in-tree
  overlays under the vault's Modal. Presentation is unchanged, so the
  nested-Modal and chrome-underlay constraints should hold, but both need a
  device check.
- **Keyboard-open drag.** AlbumShareSheet (Reanimated lift) and
  TaskQuickInspector (Animated lift) are the two sheets where a drag can start
  with the keyboard up.

## Testing

Unit (jest, existing `__tests__` idiom):
- `useSheetDismiss` commits past the distance threshold, commits on a fast flick
  below it, cancels below both, and re-zeroes on reopen.
- `progress` maps `0 → 1` opacity and `cardH → 0`.
- `capture: true` exposes the capture handler.

On-device (the gate — nothing here is provable headlessly), for all seven sheets
plus WheelTimePicker:
- Short drag springs back, backdrop returns to full dim.
- Long drag dismisses; card fully clears the screen; backdrop fades in step; no
  pop or double-close.
- Fast flick from a short distance dismisses.
- Tapping the title does nothing; tapping a button in the header block fires it.
- Vertical drag from the header never scrolls the body; body scroll never drags.
- With the keyboard up: drag dismisses the keyboard and the card follows
  cleanly (AlbumShareSheet, TaskQuickInspector).

## Standard going forward

Every new bottom sheet in `mobile-app` wires `useSheetDismiss`, spreads
`panHandlers` on its whole header block, and drives its scrim from `progress`.
No new bespoke pan responders for sheet dismissal.
