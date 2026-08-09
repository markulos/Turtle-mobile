# Gallery Filter & Arrange Sheet + App-Wide Sheet Drag-Anywhere

Date: 2026-08-09
Status: Approved design, not yet planned or implemented

## Problem

The photos-page header (board detail and All Photos, `MediaGallery.jsx:5265-5311`)
carries a bare icon toggle that flips between `camera-outline` and
`clock-plus-outline`. It switches which date drives the timeline — capture date
versus date added to Turtle — but nothing on screen says so. The icon changes
shape and tint and the grid silently reorders. Users read it as a camera button.

The same header has no way to reach anything else the backend can already do:
date ranges, scene-type facets, tag intersection, media-type scope, sort
direction. Column count is reachable only by pinch, which is undiscoverable.

Separately, bottom sheets across the app only accept a pull-down-to-close drag on
their header block. Users grab the middle of a card, nothing happens, and the
card feels stuck.

## Goals

1. Replace the date-basis toggle and the search icon with one filter control that
   opens a sheet holding every browse option, each of them labelled.
2. Make every bottom sheet in the app draggable to dismiss from anywhere on the
   card, without breaking scrolling inside sheets.

## Non-goals

- Section-header grouping (day/month headers in the grid). Real layout work, its
  own feature.
- Multi-select tag intersection. The server's `tag` param is single-value;
  follow-up.
- Rewriting the sparse/virtual bucket-to-offset math to support ascending order.
  See the direction trade-off below.

## What the backend already supports

`GET /api/media/gallery` (`server/routes/media.js:1433-1452`) accepts `limit`,
`offset`, `order=asc|desc`, `tag`, `sceneType`, `sortBy=upload|original`, `from`,
`to`, `kind=visual|audio`.

`GET /api/media/buckets` (`:2073-2170`) returns `{ buckets: [{monthKey, count}],
sceneCounts: {scene: count} }`, filtered by tag, date range and kind. This is a
ready-made facet engine — the month histogram and the scene chips both come from
one call.

`GET /api/media/search` accepts `q`, `limit`, `offset`, `sortBy`, `tag`.

"Favourites" is an album/tag (`:3838`), not a column, so it needs no dedicated
control — it appears in the tag facets like any other.

### Server additions required

- `mediaType=photo|video` on `gallery`, `search` and `buckets`. Maps to
  `type='image'` / `type='video'`. Distinct from the existing `kind`, which only
  splits visual from audio.
- `tagCounts` in the `buckets` response — same WHERE clause, `GROUP BY tag`.
  Without it there is no honest tag facet: deriving counts from loaded items only
  sees the pages the user has already scrolled.

## Design — header

```
‹  Toronto Architects 🌐        ⋯   ⚙   Select
   42 of 87 items · Aug 2026 · on the web
```

- The `camera-outline`/`clock-plus-outline` toggle and the `magnify` icon are both
  removed. One `tune-variant` icon takes their place.
- Idle tint `textPrimary`. When any filter or sort differs from default, the icon
  goes `primary` and gains a 6pt dot badge at its top-right.
- Tap opens the sheet. Long-press opens the sheet with the search field focused
  and the keyboard up, which recovers the one-tap search that folding search into
  the sheet would otherwise cost.
- The subtitle shows a live filtered count (`42 of 87 items`) whenever a filter is
  active, and the plain count otherwise.
- Both the named-board header and the All Photos header get the control.

## Design — the sheet

Presented as an **in-tree overlay**, not a sibling `<Modal>`. The photos page is
already an `EdgeSwipePage overlay`, and iOS silently refuses to present a second
sibling modal over an open one.

Two detents: **62%** (default — results stay visible updating behind) and **full**
(drag up, for long tag lists). The scrim fades with the drag. Pull-to-close works
from anywhere on the card, per the rules in the second half of this document.

Contents, top to bottom:

1. Grab handle, title "Filter & arrange", live result count "42 of 87", and a
   `Reset` text button that appears only when the filter state is dirty.
2. **Search field.** Live, debounced 180ms, with a clear button. Not autofocused
   on a plain tap — only on the header long-press entry.
3. **Active chips row.** Every applied filter as a removable chip. Hidden when
   clean.
4. **Order by** — segmented: `Capture date` | `Date added`. Keeps the old
   `camera` / `clock-plus` icons, now beside words. This is the fix for the
   original confusion.
5. **Direction** — segmented: `Newest first` | `Oldest first`.
6. **Show** — segmented: `All` | `Photos` | `Videos`.
7. **Time** — preset chips (`All time`, `This year`, `Last 12 months`, `Custom`)
   above a dual-thumb month-range slider with a count histogram drawn from
   `buckets[].count`.
8. **Tags** — facet chips with counts from `tagCounts`, sorted count-descending,
   with a "Show all" expander. Single-select in v1; the chips behave as radio
   buttons.
9. **Kind of shot** — scene facet chips with counts from `sceneCounts`. The whole
   section is hidden when the current scope has no scene data.
10. **Layout** — density stepper `2 | 3 | 4 | 5`, two-way synced with the existing
    pinch-to-zoom column state (`gridCols`).
11. **Sticky footer** — `Show 42 items`, which only dismisses (everything is
    already applied live), plus `Reset all`.

### Persistence

`sortBy`, `direction` and `cols` persist across sessions in AsyncStorage, per
user. Search, tag, scene and date range clear when the user leaves the board.
Sort and density are opinions about how you browse; queries are about this visit.

## Design — data flow

`MediaGallery.jsx` is 6,734 lines and already spreads this state across roughly
eight `useState`s. Two new files, rather than a ninth:

**`hooks/useGalleryFilters.js`** — one reducer owning

```js
{ sortBy, direction, mediaType, tag, sceneType, from, to, q, cols }
```

plus `isDirty`, `reset()`, and `buildGalleryUrl(filters, { limit, offset })`. The
persisted keys hydrate from AsyncStorage on mount.

**`components/GalleryFilterSheet.jsx`** — presentation only. Props: `visible`,
`filters`, `onChange`, `facets`, `resultCount`, `onClose`. It fetches nothing.

`MediaGallery` keeps ownership of fetching. All five existing call sites —
`:624` (search), `:1363` (sparse), `:2223` (page), `:2273` (buckets), `:2318`
(window) — switch to `buildGalleryUrl`. They hand-concatenate query params today
and have already drifted apart.

**Stale-response guard.** The `sortAtRequest` check at `:2317` generalises to a
`filterEpoch` ref, bumped on any filter change; every response drops itself if the
epoch has moved since it was issued. This kills the flicker where a slow page from
the previous filter lands after a new one.

**Facets.** One debounced (250ms) `/media/buckets` call per filter change feeds
both the month histogram and the scene chips.

**Direction.** Ships as the server's existing `order=asc`. No client-side flip or
reverse logic is touched — the grid's `scaleX(-1) scaleY(-1)` double flip and
`viewerSourceItems`' `.reverse()` are device-confirmed invariants and stay exactly
as they are. But sparse/virtual mode maps month buckets onto row offsets assuming
DESC, so `direction === 'asc'` disables virtual mode and falls back to plain
pagination. Slower on a very large library, correct everywhere. Rewriting the
bucket math to be direction-aware is a separate job.

## Design — app-wide sheet drag-anywhere

`utils/useSheetDismiss.js` today documents "attach `panHandlers` to the sheet's
HEADER — never the scrollable body, so lists inside the sheet don't fight the
pan". That constraint is what this change removes.

New shape:

```js
const { panHandlers, scrollProps, sheetDragStyle } = useSheetDismiss(onClose, visible);
```

- `panHandlers` goes on the **whole card**.
- `scrollProps` is spread onto every ScrollView/FlatList inside the sheet. It
  reports `contentOffset.y` back to the hook.
- The responder moves to the **capture phase**
  (`onMoveShouldSetPanResponderCapture`). A JS PanResponder parent cannot outrank
  a native ScrollView child any other way.
- It claims the gesture only when `dy > 6`, the drag is vertical-dominant, and
  every registered scrollable is at offset ≤ 0. Otherwise the list scrolls,
  untouched. This is the iOS-standard coupling: pull-down closes a sheet only
  from the top of its content.
- **`<SheetNoDrag>`** is exported for surfaces that own vertical gestures.
  `WheelTimePicker`'s wheels need it, as will any future wheel or vertical slider.

The commit thresholds (`COMMIT_DY = 90`, `COMMIT_VY = 0.6`), the rubber-band, the
re-zero-on-open behaviour and the park-off-screen-through-exit behaviour all stay
as they are.

### Migration

Current hook consumers move `panHandlers` from header to card:
`TasksScreen/components/FilterMenu.jsx`, `ProjectManager.jsx`,
`WheelTimePicker.jsx` (the last also needs `SheetNoDrag` around its wheels).

Bespoke `PanResponder.create` sheets convert to the hook and delete their local
copies: `TurtleScreen/components/AlbumActionsSheet.jsx`, `TrackActionsSheet.jsx`,
`TasksScreen/components/TaskQuickInspector.jsx`, `TaskDetail.jsx`, and the sheets
inside `MediaGallery.jsx`.

Planning starts with a **full census of every bottom sheet in the app**, including
sheets that have no drag-dismiss at all today. Those get wired up too. The census
is what makes this app-wide rather than "the five files that were easy to grep".

## Constraints this work is bound by

- **Vault invariants** — the grid double-flip and the viewer's reversed source
  list are untouched. Direction is server-side only.
- **iOS nested modals** — the filter sheet is an in-tree overlay. A sibling
  `<Modal>` over the open photos page renders nothing.
- **Chrome underlay** — the sticky footer clears `insets.bottom + tabBarH`; the
  scrollable sheet body may pass beneath floating chrome.
- `scrollIndicatorInsets={{ right: 1 }}` plus an explicit `indicatorStyle` on the
  sheet body.
- The search input uses an explicit height with `paddingVertical: 0` and
  `textAlignVertical: 'center'`.
- Selection haptic on every segment and chip change.
- Filter changes update the UI immediately and fetch in the background.

## Verification

- Unit: the filter reducer, `buildGalleryUrl`, and the hook's at-top gate.
- Server: `mediaType` scoping and `tagCounts` correctness.
- The `turtle-mobile-verify` gate.
- On-device pass. The drag-anywhere change is a gesture change; no jest run
  proves it. Scrolling a long sheet, then pulling from mid-card at the top of
  that list, is the specific case to check.

## Order of work

1. Sheet drag-anywhere. Self-contained, and the filter sheet consumes it.
2. Server params (`mediaType`, `tagCounts`).
3. Filter sheet and header change.
