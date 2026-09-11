# Turtle mobile — styling rules

These are the rules every new or changed screen, sheet, bar and button follows. They exist because the
same handful of mistakes kept coming back: dark-on-dark chips, labels running past the edge of a card,
tap targets too small to hit, sheets that fight the keyboard. Enforced by the `turtle-style-rules`
repo skill (loaded before any UI work) and by review.

## 1. Contrast: a surface is either white-on-black or black-on-white

- Every surface declares which it is. On a **white-on-black** surface (the photo viewer, its chrome
  and sheets, anything over media) text is `#fff` at 100 / 70 / 45 % opacity for primary / secondary /
  muted, and interactive pills INVERT: white fill, black text. On a **black-on-white / themed** surface
  use the theme tokens (`textPrimary`, `textSecondary`, `textMuted`, `surface`, `border`, `primary`);
  pills are `primary` fill with `background` text.
- Never a "slightly different dark on dark" element. A chip, badge or button must contrast with its
  card: minimum 4.5:1 for body text, 3:1 for ≥18pt text and for icon-only controls.
- Text over a photo or video always sits on a scrim (gradient band, blurred card, or `rgba(0,0,0,.55)`)
  and carries a text shadow. Never bare white on an unknown picture.
- The mobile theme has no `accentPrimary`; use `primary`, `accentInfo`, `accentSuccess`. An undefined
  token renders black on black.
- Frosted surfaces over media: `expo-blur` `BlurView` (`tint="dark"`, `intensity` 45–60,
  `experimentalBlurMethod="dimezisBlurView"` for Android) under an `rgba(10,10,12,.5–.6)` tint so
  white text stays legible whatever is behind it.

- TASK CARDS are INSET DARK panels (`screens/TasksScreen/utils/cardPalette.js`) in BOTH modes: charcoal, never
  pitch black (light page: #1F2024; dark page: #17171A, a step above the black), white title, lighter captions,
  radius 16, a hairline rim a touch lighter than the panel with the TOP edge lit a little more (`edge` /
  `edgeTop`) — the light catching a recess. No drop shadow. Inside:
  bold value, muted caption, small icon TILE (`tile`) — the Teenage-Engineering / Scandinavian read of the
  reference tile. Everything drawn inside the card (badges, sub-lines, progress tracks, inline inputs) takes
  its colour from that palette, never from the theme's page tokens. Every task row's LEFT EDGE is a TIME column
  (14 / 500, secondary ink, 62 pt + 12 pt gap: "07:00 PM", a dash when untimed) — no rail, no dot, no connector;
  the COMPLETION RING sits INSIDE the card, overlaid on its right edge and vertically centred (22 pt; done =
  filled with the card's text colour + a check in the card colour, not done = a 1.5 pt ring in the text colour);
  the card reserves 46 pt on the right for it.

- SCHEDULE CARDS (the calendar's day panel, `TasksScreen/components/ScheduleCard`) are the one exception to
  the charcoal card: a planner page. The TIME sits in a clear column on the LEFT ("08 AM" / "08:30 AM", 14 pt, medium,
  secondary ink, 74 pt wide, on the card's first line); the card is a soft wash of the board colour (18 % on the light page, 26 % on the dark, radius 18,
  no border, no shadow) with the title (16 / 600), the board name (13), a completion ring and the range
  bottom-right — nothing else; the inspector holds the details. Untimed rows keep the shape with "any time"
  in the time column. The compact schedule is a CONDENSED HOUR TIMELINE (`buildCondensedRows`): every hour
  from the first task to the last task's end has a row — the card on the hour a task starts (it stands for the
  hours it covers), a dashed rule with the hour label for a free hour, one "Nh free" row for a stretch longer
  than three free hours. The panel header is "Task Schedule" (30 / 700) with the day
  beneath it as a clear subtitle (15 / 500, secondary ink) — no hint text, no count; its right column stacks
  the + key and, under it, a round search key. ADD + SEARCH are ONE FINDER field, hidden until the search key
  opens it: typing searches every task (tap opens, + re-adds a copy on this day) and a dashed "Create …" row
  heads the list when nothing carries that exact title (Return creates too). Tapping a task opens the
  TASK INSPECTOR SHEET (`TaskInspectorSheet` on ViewerSheet, dark): title + Done ring on top, then priority,
  When (date / time chips + quick keys), board keys, notes, subtasks, tags, Full editor · Delete — every
  field commits on its own.
  The panel's SURFACE is the chat composer's FROST (`utils/frostedChat`: BlurView intensity 85 + the
  frost tint rgba(250,250,252,.5) light / rgba(20,20,22,.4) dark, a top hairline only) — transparent, the
  calendar reads through it; nothing inside the panel paints a flat surface over it. NEVER give a full-width
  sheet side borders: the day pager pages are SCREEN_W wide and pagingEnabled snaps to the VIEWPORT width,
  so 1 px of side border drifts 2 px per page (hundreds of pages in = a visible offset). A pinned bar lifted
  onto the keyboard keeps 12 pt of air above it.
- TYPEFACE: Figtree, app-wide, installed once at startup (`utils/installFont` → `utils/fonts.js`
  `installGlobalFont`): every Text / TextInput gets the Figtree face for its `fontWeight` — write weights
  as usual, never a `fontFamily` (an explicit family is left alone: icon glyphs, monospace consoles).
  Artifakt Element is the reference; Figtree is the licensed stand-in. Prefer 400–600; 700 only for figures
  and one title per screen.
  The install swaps the GETTERS on react-native's index object; never assign a Metro module's `default`
  (it is a read-only getter in the release bundle — a strict-mode throw at launch, which expo-updates
  answers by falling back to the factory bundle). Anything that runs at module load in App.js must be
  wrapped so it cannot throw.

## 2. Text never overflows its container

- A `Text` inside a row gets `flexShrink: 1`. Single-line labels also get `numberOfLines={1}`;
  values that may be long get `numberOfLines={2}`.
- A row of buttons gets `flexWrap: 'wrap'`; each button `flexShrink: 1, maxWidth: '100%'`. A
  fixed-height container never holds wrapping text — if the text can wrap, the height comes from it.
- Button labels are short: ≤ 22 characters, verb first ("Promote to production", not
  "Promote preview → production"). Long explanations go in the caption under the button.
- Check every new layout at 375 pt width (iPhone SE / mini) with the largest label and the longest
  real value (a 40-character album name, a 1:02:05 duration, a 2,150,000-byte size).
- Chips: `maxWidth: '100%'`, `flexShrink: 1`, `numberOfLines={1}`.

## 3. Touch targets and feedback

- Every tappable is ≥ 44 × 44 pt, using `hitSlop` when the glyph is smaller. Pressed state:
  opacity 0.6 (`Pressable` style function). Action buttons fire the press-in haptic from
  `utils/haptics`.
- Icon-only buttons carry `accessibilityRole="button"` and an `accessibilityLabel` that names the
  action AND its state ("Remove from favourites", "Pause").
- Overlays that must not eat swipes are `pointerEvents="box-none"` while shown and `"none"` while
  hidden; only their buttons are targets.

## 4. Sheets and overlays

- A sheet over an open Modal is an in-tree overlay, never a sibling `Modal` (iOS drops it silently).
  Sheets render LAST in their tree and carry `zIndex` so they draw over chrome and cards.
- Every card that pops up from below whose CONTENT CAN EXCEED its collapsed height (tags, details, filters
  with long lists) has TWO DETENTS through `utils/useSheetDetents`: it opens at
  COLLAPSED (60 % of the screen), a drag up takes it to EXPANDED (the full screen: corners square off, content clears the status bar), a drag down past collapsed
  closes it; a flick decides faster than distance. Grab region = the whole card; the scrim fades with a
  closing pull; an inner list scrolls only once the sheet is expanded and hands back a downward drag at its
  top. (`utils/useSheetDismiss` is the legacy single-detent hook — migrate, do not add new users.)
  A COMPACT menu that sizes to its content (album / track actions, a time wheel, a short filter list) has
  nothing to expand into: it stays single-detent (pull down to close) — `useSheetDismiss` is fine there.
- The HEADER (handle + title row) is a grab bar in its own right: a drag there moves the sheet from ANY
  scroll position (down closes, up expands), and a TAP on it flips between the two detents. Use
  `headerPanHandlers` + `toggle` from useSheetDetents; `PhotoViewer/ViewerSheet` has it built in, so
  reuse it for any dark sheet. The Done button keeps its own press (claim on move, never on start).
- Dark sheets are FROSTED: rgba(10,10,12,.55) over a dark BlurView so what is underneath shows through,
  softened; white text, pills invert to white / black text.
- The TAGS sheet, whenever it is open, sits above EVERY other overlay on the screen (selection bar,
  filter sheet, headers, chrome): mount it LAST in the screen root with its own zIndex (ViewerSheet
  carries 1000), never inside a page or bar that another overlay can outrank.
- Keyboard-aware sheets: no KeyboardAvoidingView. The sheet listens to the keyboard and — ONLY IF the
  keyboard would COVER the field it opened for (measure the field, compare with the keyboard's top) —
  jumps to EXPANDED, lifts by the keyboard height on a native-driver transform and caps its height below
  the status bar. If the field is already clear of the keyboard, the card does NOT lift and its height is
  not capped — it only rises to its expanded detent (so the content under the field gets the room above
  the keyboard) and the body gains bottom padding so what sits under the keyboard stays reachable. Drops back when
  the keyboard goes. Search / add fields go at the TOP of a sheet (`PhotoViewer/ViewerSheet` does all this).
- Keyboard + a scrolling list (the chat): the list keeps scrolling with the keyboard up
  (`keyboardDismissMode="none"`); the keyboard closes on a SWIFT pull DOWN (≥ 48 pt at ≥ 1.2 pt/ms) or a
  tap on the background — never on an ordinary scroll, never proportionally ("interactive").
- Keyboard + a PAGE or a plain list (forms, settings, search results, profile): the same rule, no
  KeyboardAvoidingView anywhere. The scroll body pads its bottom by the keyboard height
  (`utils/useKeyboardHeight`; an iOS ScrollView may also set `automaticallyAdjustKeyboardInsets`, which scrolls
  the focused field into view ONLY if the keyboard covers it). Anything pinned at the bottom (a Save bar, a
  composer) lifts on a native-driver transform matched to the keyboard's own `e.duration` (RN Animated
  in a Modal, `useAnimatedKeyboard` in-tree). Never fire a global `LayoutAnimation.configureNext` on a
  keyboard event — it captures every unrelated layout change in flight and drags sheets and chips behind the
  keyboard. `keyboardDismissMode` is `"on-drag"` on both platforms (or `"none"` + swift pull for chat
  lists); never `"interactive"`.
- Assistant text renders MARKDOWN (`components/MarkdownText` over `utils/markdownLite`): headings, lists,
  code, bold / italic / strike, links, quotes. Never show raw markers in a bubble.
- Every sheet/page `ScrollView` sets `scrollIndicatorInsets={{ right: 1 }}` and `indicatorStyle`,
  or iOS parks the indicator mid-page.

## 4b. Screen headers

- A screen header is TWO rows of keys and nothing else: row 1 the view toggle and the status keys
  (To do · Done · All — ONE lit pill that glides between them on the UI thread); row 2 the Boards key and
  the Overview key. No dropdowns, no stats chips, no filter key, no header + (the day panel and the list's
  inline field add tasks; the tag / owner filters live on the Overview page). The Boards key is a hairline
  pill that reads the selected board (dot + name, or "Boards") and lights (text colour as fill) while a
  board is selected or the rail is open. What the list is scoped to lives in an inset-card RAIL the key
  toggles (`TasksScreen/components/BoardRail`), HIDDEN by default and closing on a pick: "All" first, one
  card per board carrying its own progress (done / total, a hairline track, the overdue count), a dashed +
  key last. The selected card inverts like a lit key; tap scopes, long-press opens the board manager
  (`BoardManagerSheet`) on that board. The rail REVEALS the way the old board dropdown did: absolute at
  the top of the content host, the page below slides down by its height on one Reanimated progress
  (280 / 240 ms, bezier 0.4 0 0.2 1) — never a mount that relayouts the calendar. Any horizontal rail
  ScrollView sets `flexGrow: 0` — RN's default flexGrow 1 makes it swallow the column.
- The numbers live on the OVERVIEW page (`TasksScreen/components/OverviewPage`, an in-tree EdgeSwipePage
  overlay over the calendar): four inset stat tiles (To do · Done · Late · Today — icon tile, big bold
  figure, muted caption, exactly the reference tile), then one inset row per board with its progress, then
  tags; a row drills into the board's lists with a Show key that scopes the calendar. Stats come from
  `utils/overviewStats.js` (pure, tested).
- Header type is two sizes only: small caps 10.5 pt / letter-spacing 0.9 for labels, bold tabular 18 pt
  for the figure. One accent per card (the board dot). Nothing else is coloured.

## 5. Inputs

- An inline `TextInput` in an icon row: explicit `height`, `paddingVertical: 0`,
  `textAlignVertical: 'center'` — never vertical padding (glyphs ride high).
- Placeholders describe the action ("Search or add a tag…"), in `textMuted`.

## 6. Motion

- Shared-element moves (a photo growing out of / flying back into its tile) use the swift curve
  `Easing.bezier(0.2, 0.9, 0.25, 1)`, 300–340 ms: fast out of the gate, soft landing. On the way out
  the picture does NOT fade in flight: it stays opaque and switches off the instant it is on its target.
- Timelines and progress: drive a shared value and glide it between reports on the UI thread; while
  the finger owns a control it IS the value (no React state per frame); throttle the work you send
  (seeks) and ignore stale reports until the target is confirmed.
- Gesture-thrown surfaces settle with `R_TIMING.settle` (`utils/motionReanimated`). Reduced motion is
  Reanimated's job; never gate it by hand.
- Never animate a layout prop (`height`, `width`, `padding`) on the JS thread; use a transform, or
  a Reanimated shared value if the layout genuinely has to move.
- Sheets enter in 240 ms ease-out-cubic and leave in 200 ms ease-in-quad.

## 7. State and data

- Every mutation is optimistic: update local state now, persist in the background, revert on
  failure, always with functional updaters.
- Loading never blanks a screen: the resting tile / row IS the placeholder; content fades in over it.

## Checklist before shipping any UI change

1. Which surface is it — white-on-black or black-on-white — and does every element on it contrast?
2. Longest label, longest value, 375 pt width: nothing clipped, nothing past the edge.
3. Every tappable ≥ 44 pt with a label; pressed state; haptic on action buttons.
4. Sheets: in-tree, two detents (opens at 60 %, drag up to full screen, drag down closes), top search, keyboard lift, scroll-indicator inset.
   Keyboard anywhere: no KeyboardAvoidingView, no LayoutAnimation on the event, body pads / pinned bar lifts on a native transform.
5. Motion on the UI thread only; swift curve for shared-element moves.
6. Ran `turtle-mobile-verify` (parse, jest, undef-audit, bundle) and listed the on-device checks.
