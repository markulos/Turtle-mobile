# Gallery Filter Sheet + Sheet Drag-Anywhere Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the photos-page header's unlabelled capture-vs-upload date toggle (and the search icon) with a "Filter & arrange" sheet holding every browse option, and make every bottom sheet in the app drag-to-dismiss from anywhere on the card.

**Architecture:** Three sequenced phases. Phase 1 upgrades `utils/useSheetDismiss.js` to a capture-phase, whole-card responder gated on scroll position, then migrates every sheet in the app onto it. Phase 2 adds two query capabilities the sheet needs to the server (`mediaType` scoping, `tagCounts` facets). Phase 3 extracts gallery filter state into a reducer hook, builds the sheet component, and rewires the header.

**Tech Stack:** React Native (Expo 54), RN `Animated` + `PanResponder` (not Reanimated — matches the existing sheet idiom), FlashList v2, Express + better-sqlite3 server.

## Global Constraints

- Spec: `mobile-app/docs/superpowers/specs/2026-08-09-gallery-filter-sheet-design.md`.
- The grid's `scaleX(-1) scaleY(-1)` double flip and `viewerSourceItems`' `.reverse()` are device-confirmed invariants. Do not touch them. Sort direction ships as the server's `order=asc` only.
- The filter sheet is an **in-tree overlay**, never a sibling `<Modal>`: the photos page is already an `EdgeSwipePage overlay`, and iOS will not present a second sibling modal over an open one.
- Floating chrome: pinned touch targets clear `insets.bottom + tabBarH`; scrollable content may pass beneath.
- Every sheet ScrollView carries `scrollIndicatorInsets={{ right: 1 }}` and an explicit `indicatorStyle`.
- Inline `TextInput`s use an explicit `height` with `paddingVertical: 0` and `textAlignVertical: 'center'`.
- Mutations and filter changes update UI immediately, fetch in the background.
- Mobile theme has no `accentPrimary`. Use `primary`, `accentInfo`, `accentSuccess`.
- Three separate git repos. Mobile changes commit in `mobile-app/`, server changes in `server/`.

---

## Phase 1 — Sheet drag-anywhere

### Task 1: Upgrade `useSheetDismiss`

**Files:**
- Modify: `mobile-app/utils/useSheetDismiss.js`
- Test: `mobile-app/utils/__tests__/useSheetDismiss.test.js`

**Interfaces:**
- Produces:
  ```js
  useSheetDismiss(onClose, visible = true) => {
    dragY,               // Animated.Value
    panHandlers,         // spread on the WHOLE CARD
    scrollProps,         // spread on the sheet's scrollable ({ onScroll, scrollEventThrottle })
    scrollPropsFor,      // (key: string) => scrollProps, for sheets with 2+ scrollables
    noDragProps,         // spread on a View that owns its own vertical gesture
    sheetDragStyle,      // { transform: [{ translateY: dragY }] }
  }
  ```

- [ ] **Step 1: Write the failing tests** covering: at-top gate opens the responder, a scrolled list blocks it, `noDragProps` blocks it, horizontal drags are ignored, and upward drags rubber-band.
- [ ] **Step 2: Run and watch them fail.**
- [ ] **Step 3: Implement.** Move the gesture to `onMoveShouldSetPanResponderCapture`; keep `onStartShouldSetPanResponderCapture: () => false` so taps reach buttons. Claim only when `g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx) * 1.2 && !blockedRef.current && atTop()`. `atTop()` is true when every entry in the offsets map is `<= 1`. `noDragProps` sets `blockedRef` on `onStartShouldSetResponderCapture` (returning `false`) and clears it on `onTouchEnd`/`onTouchCancel`. Keep `COMMIT_DY = 90`, `COMMIT_VY = 0.6`, the rubber-band, the re-zero-on-open effect and the park-off-screen close.
- [ ] **Step 4: Run tests, confirm pass.**
- [ ] **Step 5: Commit.**

### Task 2: Migrate the three existing consumers

**Files:**
- Modify: `mobile-app/screens/TasksScreen/components/FilterMenu.jsx:39,75,78`
- Modify: `mobile-app/screens/TasksScreen/components/ProjectManager.jsx:110,131,155`
- Modify: `mobile-app/screens/TasksScreen/components/WheelTimePicker.jsx:233,253,90`

Move `panHandlers` off the handle zone and onto the card container. Spread `scrollProps` on each sheet's `ScrollView`. Wrap `WheelTimePicker`'s wheel columns in a `View {...noDragProps}` — they are vertical scrollers and must keep their own gesture.

- [ ] Step 1: FilterMenu. - [ ] Step 2: ProjectManager. - [ ] Step 3: WheelTimePicker.
- [ ] Step 4: Commit.

### Task 3: Convert the bespoke PanResponder sheets

**Files:**
- Modify: `mobile-app/screens/TurtleScreen/components/AlbumActionsSheet.jsx:173-195,250`
- Modify: `mobile-app/screens/TurtleScreen/components/TrackActionsSheet.jsx:136-159,222,396`
- Modify: `mobile-app/screens/TasksScreen/components/TaskQuickInspector.jsx:292-320,334`

Each has a local `PanResponder.create` plus its own `Animated.add` composition with a keyboard lift and an entrance slide. Delete the local responder, keep the composition, and add `dragY` from the hook into the existing `Animated.add` chain. `TrackActionsSheet`'s playlist `ScrollView` gets `scrollProps`.

- [ ] Step 1: AlbumActionsSheet. - [ ] Step 2: TrackActionsSheet. - [ ] Step 3: TaskQuickInspector.
- [ ] Step 4: Commit.

### Task 4: Census the remaining sheets

Grep the app for bottom-sheet-shaped components that have no drag-dismiss at all and wire them to the hook. Report any that are deliberately excluded and why.

- [ ] Step 1: Census. - [ ] Step 2: Wire. - [ ] Step 3: Commit.

---

## Phase 2 — Server query capabilities

### Task 5: `mediaType` scoping

**Files:**
- Modify: `server/routes/media.js` — gallery handler (~`:1433-1560`), buckets handler (~`:2073-2170`), search handler (~`:1676-1700`)

`mediaType=photo` maps to `(type IS NULL OR type = 'image')` — images predate the column, so NULL counts as a photo. `mediaType=video` maps to `type = 'video'`. Anything else is unfiltered. The value joins every cache key alongside `sortBy`/`tag`/`kind`.

- [ ] Step 1: Test. - [ ] Step 2: Implement. - [ ] Step 3: Verify. - [ ] Step 4: Commit.

### Task 6: `tagCounts` facets

**Files:**
- Modify: `server/routes/media.js` — buckets handler, beside the existing `sceneCounts` block (~`:2153-2168`)

Same WHERE as `sceneCounts` but grouped by tag, and — like `sceneCounts` excludes `sceneType` — it excludes the `tag` condition, so every chip shows a meaningful number and the user can switch between tags. Response becomes `{ success, buckets, sceneCounts, tagCounts }`.

- [ ] Step 1: Test. - [ ] Step 2: Implement. - [ ] Step 3: Verify. - [ ] Step 4: Commit.

---

## Phase 3 — Filter state, sheet, header

### Task 7: `useGalleryFilters`

**Files:**
- Create: `mobile-app/hooks/useGalleryFilters.js`
- Test: `mobile-app/hooks/__tests__/useGalleryFilters.test.js`

**Interfaces:**
- Produces:
  ```js
  DEFAULT_FILTERS = { sortBy: 'original', direction: 'desc', mediaType: 'all',
                      tag: null, sceneType: null, from: null, to: null, q: '', cols: 3 }
  useGalleryFilters() => { filters, setFilter(key, value), setFilters(patch), reset(), isDirty, hydrated }
  buildGalleryUrl(filters, { limit, offset, album })   // => '/media/gallery?…' or '/media/search?…'
  buildBucketsUrl(filters)                             // => '/media/buckets?…'
  activeFilterChips(filters)                           // => [{ key, label }]
  ```
  `sortBy`, `direction` and `cols` persist to AsyncStorage under `gallery.filters.v1`; the rest reset per visit.

- [ ] Step 1: Tests for URL building, dirty detection, chip derivation, persistence round-trip.
- [ ] Step 2: Fail. - [ ] Step 3: Implement. - [ ] Step 4: Pass. - [ ] Step 5: Commit.

### Task 8: `GalleryFilterSheet`

**Files:**
- Create: `mobile-app/screens/TurtleScreen/components/GalleryFilterSheet.jsx`

Presentation only, no fetching. Props: `visible`, `filters`, `onChange`, `onReset`, `facets` (`{ buckets, sceneCounts, tagCounts }`), `resultCount`, `totalCount`, `onClose`, `autoFocusSearch`. Sections in the order the spec fixes: handle/title/count/Reset, search field, active chips, Order by, Direction, Show, Time (presets + month histogram range), Tags, Kind of shot, Layout density, sticky footer. Built on `useSheetDismiss` with `panHandlers` on the card and `scrollProps` on the body. Selection haptic on every segment and chip change.

- [ ] Step 1: Shell + drag + scrim. - [ ] Step 2: Controls. - [ ] Step 3: Histogram range. - [ ] Step 4: Commit.

### Task 9: Wire into MediaGallery

**Files:**
- Modify: `mobile-app/screens/TurtleScreen/components/MediaGallery.jsx` — header `:5265-5311`, fetch sites `:624, :1363, :2223, :2273, :2318`

Replace the date-toggle and magnify icons with one `tune-variant` control (dot badge when dirty; long-press opens with search focused). Route every fetch through `buildGalleryUrl`/`buildBucketsUrl`. Add the `filterEpoch` ref, generalising the existing `sortAtRequest` guard so a late response from a superseded filter is dropped. Disable virtual/sparse mode while `direction === 'asc'` — the bucket-to-offset math assumes DESC. Keep `gridCols` two-way synced with `filters.cols` so pinch and the stepper agree. Subtitle shows `42 of 87 items` when filtered.

- [ ] Step 1: Header. - [ ] Step 2: Fetch routing + epoch. - [ ] Step 3: Facet fetching. - [ ] Step 4: Commit.

### Task 10: Verify

- [ ] Step 1: `turtle-web-verify` is not applicable; run the `turtle-mobile-verify` gate.
- [ ] Step 2: On-device pass — drag-anywhere on a long sheet, each filter control, the search loop, direction on a large board.
- [ ] Step 3: Changelog entry.
