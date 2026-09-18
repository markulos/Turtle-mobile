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

- DEPTH, light mode only — `utils/surfaceDepth`. The light theme is a white page carrying near-white
  surfaces (#F5F5F5 / #EEEEEE) split by a 10 %-black hairline: flat, a card and the page on one plane
  with a line between them. Every surface that paints a fill spreads `...depth(theme, LEVEL)` after it.
  Four levels — `control` (chips, pills, keys, inputs: one point of lift, barely there), `card` (the
  default: cards, panels, rows, tiles, sections), `raised` (menus, autocompletes, banners, floating
  keys), `overlay` (sheets and modals). The shadow is used as a GRADIENT: low opacity over a wide
  radius, so it reads as a soft falloff rather than a drawn edge — if you can point at the shadow it is
  too strong. Colour is a blue-black (#0B1220), because a neutral black greys the pixels under it on a
  white page and reads as dirt.
  DARK MODE GETS NOTHING: `depth()` returns `{}` there, so the spread is safe to write unconditionally.
  A black shadow behind a near-black card on a black page is invisible, costs a layer per element, and
  Android's `elevation` draws a muddy halo instead. Dark mode takes its depth from TONE — surfaces
  stepping up the elevation ladder, inset cards lit along the top edge.
  EXCEPT the INSET TASK CARDS (`cardPalette`, anything drawn from `pal.*`): they keep no drop shadow in
  either mode, per the rule above — they are recesses lit from the top edge, and a drop shadow turns
  them back into slabs. A shadow also needs an opaque background to cast from, so never put one on a
  transparent view. Values pinned by `utils/__tests__/surfaceDepth.test.js`.

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

- A TASK LIST NEVER DRAWS ON THE PAGE. Every task row is an inset card, in both modes — the palette's
  `text` is WHITE, so a row that takes `insetCardPalette` colours while sitting on the page background is
  invisible on the light page (the Overview's board lists shipped that way: red icons and red dates
  visible, every title white on white). If a row reads from that palette it must also wear `pal.card`.
  Stacked task cards sit 8 pt apart, radius 14, title 15 / 600.
- SCHEDULE CARDS (the calendar's day panel, `TasksScreen/components/ScheduleCard`) are the one exception to
  the charcoal card: a planner page. EVERY card is `CARD_H`, a FIXED height —
  a one-line title leaves slack rather than making a shorter card — and a missing fact is drawn as a
  PLACEHOLDER ("No board", muted and italic: a stand-in, not a fact), never dropped. Fixing the CARD is
  what fixes the KEYS: they are cut from it (`KEY` = (CARD_H − `KEY_GAP`) / 2, so two keys and the gap
  ARE the card), which means every key in the app is the same size as every other one. They used to be
  measured per card, so a shorter card made smaller keys and a column had keys of three sizes —
  measuring could only ever chase the inconsistency.
  The keys are a THIN OUTLINE over LIGHT GREY with WHITE off the edges (`keySurface`): #E7E9ED under a
  1 pt `rgba(15,23,42,0.13)` border — 1, not a hairline, because at 0.33 pt the edge of a 56 pt key
  vanishes on a white page and the outline is the whole point — and two CROSSED linear gradients, white
  at both ends and transparent through the middle, one down the key and one across it, so the light
  comes in from all four sides and the grey only holds the centre. There is no radial mode in
  `expo-linear-gradient`; crossed linears are what read as one, and they compound at the corners, which
  is where an edge light is brightest anyway. `overflow: 'hidden'` keeps the sheen on the corner. The
  grey is deep enough that the gloss is visible — at #F5F6F7 the wash and the fill were the same colour
  and the key was an empty outline. On the DARK page the same shape is frosted rather than white
  (`rgba(255,255,255,0.09)` under a `0.20` rim, sheen at 0.26/0.16): a light grey key is fine on a white
  page and a headlight on a black one. The GLYPHS follow the surface — #0E9F6E / #E02424 on the pale
  key, #34D399 / #F87171 on the frosted one, since the lighter pair is tuned for near-black and goes
  washy on grey. DONE is the one key that is not quiet: it fills with the mint #34D399, takes a white
  check, drops the outline and drops the gloss (on the green the sheen only washes out the one colour
  on the row that is meant to carry). Both keys also take a FAINT wash of the card's own board colour
  over the grey (`tintOf(color, 0.16)` light / `0.24` dark, under the sheen), so a row reads as one
  object — a card with two keys — rather than a coloured card with neutral furniture parked beside it.
  Faint is the point: at the card's own 18 % they stopped being controls. A row with no board stays grey,
  and the two states already speaking in colour (a done key, a live one) take no tint. The keys have also
  been a charcoal slab — the loudest thing on the row — and the card's own wash, which was too quiet to
  read as a button at all.
  A RUNNING focus block stops being a start button and becomes the BLOCK: the circle turns the timer's
  red (`liveFill`), carries the minutes left with its unit ("15" + a quiet "m" — a bare number in a
  circle could be the block COUNT, which is the other number the card shows), and a press OPENS the
  running timer (`onOpenPomodoro`) instead of starting a second block on a task already being worked on.
  Its OUTLINE is the countdown: the static 1 pt edge goes transparent and a RADIAL arc takes its place
  (`KeyRing`), a full ring at the start and a sliver at the end, shortening clockwise from 12 o'clock
  over a faint `liveTrack` of the same red. Two rotating half-rings, NOT SVG — there is no
  `react-native-svg` in this project and a native module cannot ship over the air. A circular border
  paints each side over a 90° arc, so top + right coloured and the other two transparent is a half-ring;
  clipped to its own half of the circle it can be rotated out of view entirely. Clockwise from 12, an
  unrotated half spans −45°→135° and the right window shows 0°→180°, so `D − 135` leaves exactly D
  degrees on screen and `S + 45` does the same for the left (`KeyRingRotations`, exported because an arc
  anchored 90° out still grows and shrinks correctly and would pass any test that only watched it move).
  Everything is sized in points off `RING` = `KEY` − 2, the key's padding box: `borderRadius` takes no
  percentage, and a half sized any other way is a hair off the track it is eating. The countdown is
  `minutesLeft` — rounded up and never 0 while live, since a timer reading "0" for the last 59 seconds
  looks finished and invites that second start — re-read at whichever comes first of the next minute
  BOUNDARY (where the number changes, so it cannot drift) and `RING_STEP` (10 s, so the arc does not
  move in 14° jumps). Six renders a minute on ONE card is the whole cost: the pond keeps a single block
  in flight. The last of those timeouts is also what retires the live key, with no refetch involved.
  A task that has had focus before carries a small tally in its bottom row; one that has not says
  nothing. STARTING one writes BOTH stores — see `startPomodoroFor`: the chat command starts the pond's
  in-memory timer (what the Turtle tab draws) and `POST /pomodoro/start-task` writes the `task_pomodoros`
  row, which is the only one of the two that knows which task a timer belongs to and the only one
  `/pomodoros/active` and the tally can see. Writing just the first is why a running block showed a
  plain start key and the tally never moved. The TIME sits in a clear column on the LEFT ("08 AM" / "08:30 AM", 14 pt, medium,
  secondary ink, `TIME_COL_W` = 64 wide, RIGHT-aligned into the rule with a 10 pt inset, on the card's
  first line — ONE column with the hour rules drawn between the cards, which interleave with it in the
  timeline view, so `HOUR_LABEL_WIDTH` reads from the same constant and both are 11 / 500 / 0.2 tabular;
  the card's used to be 14 pt and left-aligned, which put it outside the hour labels in a bigger face); the card is a soft wash of the board colour (26 % — the
  panel is a dark surface in both app themes, see below; 18 % is the light-page wash the card still carries for
  any other caller, radius 18,
  no border, no shadow) with the title (16 / 600), the board name (13) and the range bottom-right —
  nothing else; the inspector holds the details. The DONE toggle is NOT in the card: it is a SQUARE key
  (`DONE_KEY` = 52, one number for width and height, radius 16) sitting to the RIGHT of the card, and
  the card — flex: 1 — simply takes what is left, which is what narrows it. It used to be a 22 pt ring
  in the card's top corner: under §3's 44 pt minimum, and near enough the title that a thumb aimed at
  one hit the other. UNDER it sits the second key, START POMODORO — the same 52 pt box taken all the way
  round to a CIRCLE (`POMODORO_KEY`). Same footprint so the column has one straight edge; only the
  corner radius says they are different kinds of thing — done is a state you set, a pomodoro is
  something you begin. A row draws only the keys it is given a handler for, and keeps the width of any
  it is not. The key column is sized from the card's MEASURED height (`keyFit`) so it ends exactly
  where the card ends — two fixed 52s plus their gap came to 112 and overhung a 100 pt card at both
  ends; under 44 the glyph shrinks but `hitSlop` keeps the target. TIMED rows use this same card: they were the Tasks tab's inset CHARCOAL panel, which made
  one list read as two — dark slabs above, planner cards below, for rows differing only in whether a
  time is set. The board colour that ran down the left edge is the card's wash now. Untimed rows keep the shape with "any time"
  in the time column. The compact schedule is a CONDENSED HOUR TIMELINE (`buildCondensedRows`): every hour
  from the first task to the last task's end has a row — the card on the hour a task starts (it stands for the
  hours it covers), a dashed rule with the hour label for a free hour, one "Nh free" row for a stretch longer
  than three free hours. An OPEN gap is a slice of the real timeline at the real scale (`GAP_HOUR_H` =
  `HOUR_HEIGHT`), and each hour in it is a SLOT: the BAND under that hour's rule, down to the
  next one. Tapping it opens the finder with that hour already pending (`minutesToTimeString` →
  `onOpenAddTaskAt`), so "nothing at 4" and "put something at 4" are one gesture, and the band lights
  under the finger — inset past the time gutter, so the times keep a clean edge. The rule sits at the
  TOP of the slot it names (`GAP_RULE_H` keeps that row a fixed height), and the highlight runs from THIS hour's
  line to the next one, so what lights is the hour itself. Offset by `GAP_LINE_Y` (half the rule row),
  not 0: the row centres its hairline, so anything placed against the row's top edge sits half a row
  above the line it means — which is what left the band hanging 9 pt high of its own hour. The + is the hour's hint, not the line's: right-aligned, vertically centred on the
  slot's own height, and `pointerEvents="none"` so it never eats the tap it is advertising. The press is
  `useTapOnly` (§3): a swipe that begins on a slot must neither light it nor create anything. At the old 26 pt the hours were a readout you could read but not aim at.
  The DAY'S ENDS are gaps too (`edge: 'start' | 'end'`, midnight → the first task and the last task →
  midnight), collapsed like any other, so every hour of the 24 is reachable — without them the only
  hours you could create into were the ones inside the span you already had something in. An empty day
  stays empty: two gaps around nothing is not an empty state. The panel header is the DESTINATION LINE (`utils/finderDestination`) in both states — at rest it says
  which day the list is showing, and while the finder is open it says where a new task will land:
  `TO-DO | Today · Thu, Sep 17`, with the kind in tertiary small caps. ONE composition, so opening the
  finder only changes the words. At REST the line is 18 / 600 / 0.2 secondary — the biggest type on the
  panel, a clear step up from the 15 it carried while it was also holding a board name, and DOWN from a
  22 that was loud enough to compete with the day it was naming. Under it sits a SECOND line at
  15 / 200 / 0.3 — thin, so it cannot read as a second header, but not the 13 it started at, which was
  fine print under an 18 pt line. That line carries the BOARD (the scope the list was filtered to) and
  then the shape of the day (`dayFacts`): `All · 5 tasks · 2 done`, or `all done` once nothing is left,
  or `nothing planned` on an empty day — a row of zeroes reads as a broken count rather than a clear
  day. NOT the timed count, the hours or the backlog: the strip under the week row already says
  "3 timed · 3h" and the Pending section carries its own count, and a subtitle repeating what is two rows
  below it is noise dressed as detail. What it adds is the day's TOTAL, which includes untimed tasks, and
  how much of it is behind you. A real board takes secondary ink; "All" and the figures take tertiary,
  because "all" is the absence of a destination rather than one worth pointing at and the counts sit
  behind the scope that produced them. The block keeps ONE accessibility label across both lines, facts
  included. The board used to sit INLINE and drop below only when it truncated — measured with
  `wasTruncated` against `onTextLayout`, latched once per line so it could not oscillate. Above 15 the
  line cannot hold three facts either way, so the measuring is gone. The finder's own line keeps all
  three inline at 15 (`finderDestinationCompact`): one line carrying three facts over a keyboard is all
  the room there is.
  Otherwise:
  it used to be a 26 / 700 title over a subtitle that swapped for a small-caps caption, which re-set the
  header in another typeface every time. No hint text, no count; its right column stacks
  the + key and, under it, a round search key. ADD + SEARCH are ONE FINDER field, hidden until the search key
  opens it: typing searches every task (tap opens, + re-adds a copy on this day) and a dashed "Create …" row
  heads the list when nothing carries that exact title (Return creates too). Tapping a task opens the
  TASK INSPECTOR SHEET (`TaskInspectorSheet` on ViewerSheet, dark): title + Done ring on top, then priority,
  When (date / time chips + quick keys), board keys, notes, subtasks, tags, Full editor · Delete — every
  field commits on its own.
  The panel FOLLOWS THE APP THEME — white on a light theme, the sheet's dark grey (#1C1C1E) on a dark one.
  It used to be its own white-on-black room in both, which was defensible while it covered the whole
  screen; it is a CARD now (it stops `SHEET_RAISED_GAP` = 12 pt below the screen header, which stays up),
  and a black card on a white page is a hole, not a card. Its SURFACE is the chat composer's FROST
  (`utils/frostedChat`, a top hairline only) at `SHEET_BLUR` = 100 — the composer's 85 is tuned for a bar
  over chat, and this is a full pane over a grid of SMALL TYPE, which is exactly what a blur has to
  destroy for a frost to read as a surface rather than a dirty window. Under it a translucent tint,
  `sheetFrost` — rgba(255,255,255,.90) light / rgba(28,28,30,.72) dark. Far higher alpha than the
  composer's because this pane carries paragraphs over a month grid, not one input line over settled
  chat: at .74 the grid's own type read straight through and competed with the list. Over the tint a
  SHEEN (`sheetSheen`): a three-stop vertical gradient, mid stop at 0.35, so the falloff stays inside
  the top third — glass catches light along its top edge and falls off fast; a two-stop ramp over a tall
  pane spreads it into a grey cast and is where banding shows. Light mode settles into the faintest cool
  shade rather than white-to-white, which is what stops a big pale pane looking like paper. The calendar
  behind also dims to 42 % rather than disappearing; the three together are what buy the glass. Nothing inside
  the panel paints a flat surface over it. Everything INSIDE is drawn with `sheetThemeFrom(theme)`
  (`CalendarView`) — the live theme with the pane and its cards set ONE RUNG APART on the platform
  elevation ladder (#FFFFFF/#F2F2F7 light, #1C1C1E/#2C2C2E dark, so a card always has an edge) and the ink
  pushed to the ends (pure black / pure white, not the app's softened #E0E0E0) because a translucent pane
  needs the extra contrast. The muted rung is 52 %, not the app's 30 %: it carries real words here. The
  user's accent and the accent-washed rules carry over untouched. Pass that palette down as the `theme` /
  `styles` props of everything in the panel (the day panes, the week strip); the calendar BEHIND the sheet
  keeps the app theme. NEVER give a full-width
  sheet side borders: the day pager pages are SCREEN_W wide and pagingEnabled snaps to the VIEWPORT width,
  so 1 px of side border drifts 2 px per page (hundreds of pages in = a visible offset). A pinned bar lifted
  onto the keyboard keeps 12 pt of air above it.
  The panel NEVER takes the screen header down with it. The view pill and the Boards key are how you leave
  the day you are planning; winning a header's height by unmounting them trades navigation for space, and
  the unmount also made the sheet hop at the end of an otherwise smooth travel. Stop the card short instead.
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
- A TAP IS NOT A GESTURE — `utils/pressBehavior`, app-wide. RN enters the pressed state on finger-DOWN,
  so every scroll, swipe and drag begins by lighting (and, with a press-in haptic, buzzing) whatever is
  under it. Three things have to be true before a touch counts as a press, and the module carries all
  three:
  1. `delayPressIn` / `unstable_pressDelay` 60 ms — a scroll has taken the responder by then, a real tap
     has not moved. Spread `TAP_ONLY` (Touchables) or `TAP_ONLY_PRESSABLE` (Pressable).
  2. A tight `pressRetentionOffset` (8) — a finger that wanders off the control is a drag, not a tap.
     RN's default keeps a press live ~20–30 pt outside the element.
  3. DISTANCE, for the case the first two miss: a drag that starts AND ends inside one large target
     (a 48 pt timeline slot, a tall row, a full-width card) when no parent claimed the responder.
     `useTapOnly(onPress)` remembers where the finger went down and swallows the press if it travelled
     more than `TAP_SLOP` (10 pt, measured on the diagonal). Drive any highlight from the `settled` it
     returns rather than Pressable's own `pressed`, so the light leaves mid-gesture instead of sitting
     lit under a scroll that already took over.
  Use it on anything inside a scrolling or paging surface. NOT on stationary controls — a composer's
  send key, a dialog button — where the press cannot be the start of a scroll and the delay only adds
  lag. Pinned by `utils/__tests__/pressBehavior.test.jsx`.
- Icon-only buttons carry `accessibilityRole="button"` and an `accessibilityLabel` that names the
  action AND its state ("Remove from favourites", "Pause").
- Overlays that must not eat swipes are `pointerEvents="box-none"` while shown and `"none"` while
  hidden; only their buttons are targets.
- A toggle that does ASYNC work (the viewer's Save-for-offline key) keeps ONE 44 × 44 footprint across
  all three of its states — idle icon, spinner, done icon — so the row it sits in cannot reflow
  mid-action and move the next button under a second tap. Saved state reads as a colour + a changed
  glyph (`cloud-download-outline` → `cloud-check` in #34d399), the way a favourite goes red.
- SAVED-OFFLINE pictures (`services/offlineMedia`, `context/OfflineMediaContext`) are NOT cache. They
  live under `documentDirectory`, which `utils/cacheManager` never walks, so no sweep and no "Clear
  photo cache" can take them; only the user can, from the viewer's key or Settings → Storage. The
  index stores the file NAME and rebuilds the absolute uri per read — an iOS container path moves
  between installs, and a persisted `file:///` uri would rot. What is saved is the DISPLAY tier, the
  same ~1600 px JPEG the viewer paints at HD, so the offline picture is the online one.

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
- WHERE a sheet is mounted decides what it can cover. In-tree at the screen root, mounted last with a
  zIndex, it beats the page, the headers and every other overlay on that screen, but NOT the floating tab
  bar — those sheets take `bottomInset={tabBarHeight}` so their footer clears it. A sheet that must cover
  the TAB BAR TOO (the day panel's task inspector) is mounted at the screen root inside a TRANSPARENT
  `Modal` and takes `bottomInset={insets.bottom}` instead; its own pickers are then Modals NESTED in its
  tree, which iOS presents fine (a SIBLING Modal over an open one is what disappears). Never leave such a
  sheet inside the page component that raised it — a parent's zIndex or `overflow: hidden` outranks and
  clips it no matter what the sheet itself carries.
- A sheet's FOOTER is a PINNED BAR and the SHELL owns the space under it: `ViewerSheet` pads it by
  `max(insets.bottom, bottomInset)` + 12 pt, so the keys clear the home indicator — or whatever the
  caller says is under the sheet (a floating tab bar) — instead of resting flush on the bottom of the
  screen. A footer declares NO bottom padding of its own. The trap: the body's bottom padding lives on
  the ScrollView's contentContainer, which is INSIDE the scroll and never reaches a footer, so a sheet
  can pass the right `bottomInset` and still look flush. Lifted onto the keyboard the inset drops (there
  is no home indicator under it any more) and only the 12 pt of air remains. Pinned by
  `PhotoViewer/__tests__/ViewerSheetFooter.test.jsx`.
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
- AVATARS: a person's PICTURE where they have set one, the generated/initial disc as the FALLBACK —
  never the other way round. The server stores `avatarUrl` as a path relative to its own origin (the
  pond answers on a LAN ip, a Tailscale name and app.t3d.ca, so baking one in would rot), and
  `utils/avatarUrl` `resolveAvatarUrl(url, baseUrl)` is the ONE place that joins them. It leaves
  anything carrying a URI scheme alone — matched by shape, not by an enumerated list, because
  `file://`, `ph://`, `content://`, `data:` and `blob:` are all real cases and missing one prepends an
  origin to a local pick. It returns null rather than an empty string: an `<Image>` given `""` logs a
  load failure every render. Draw the photo OVER the fallback disc rather than instead of it, so a
  picture that is still loading or fails shows the disc, not a hole.
  MORE THAN ONE person on a thing = a STACK (`ScheduleCard`: `PERSON` 22, `PERSON_OVERLAP` a THIRD, so
  each extra face costs two thirds of a disc and the faces stay readable), owner FIRST and on top by
  `zIndex` — paint order would bury them under whoever was added last, which reads backwards. The stack
  is ONE target opening a list (`PeoplePopover`: avatar, name, role · phone · sign-in state, into the
  full profile), not a row of targets — overlapped discs are not something you can aim at, and the
  basic facts belong in the list anyway. It anchors on the TOUCH, never on `measureInWindow`: that is
  async and, when it cannot resolve a node, never calls back — a tap that silently does nothing. De-duplicate: an owner is routinely in
  their own `involvedUsers` and two of the same face reads as a bug. Cap at `MAX_FACES` = 4 and make the
  tail a "+n" — a card is not wide enough to be a team list. The owner badge only appears on a SHARED
  pond (every task is yours on a solo one), but INVOLVED people always do, and the owner joins the line
  whenever the line exists at all: "who else" only means something next to "whose".
- EVERY field with a placeholder is `components/AppTextInput`, never a bare `TextInput`. iOS builds the
  `placeholder` prop as its own attributed string OUTSIDE the app's text pipeline, so the face
  `installGlobalFont` puts on every Text and TextInput never reaches it: the placeholder renders in the
  SYSTEM font while the field's own text is Figtree. One field, two typefaces —
  "S e a r c h  o r  a d d  a  t a s k …" next to a correctly spaced page. There is no
  `placeholderStyle` prop, so the fix is to draw it ourselves.
  AppTextInput is a DROP-IN: keep `placeholder` / `placeholderTextColor` and change the tag. It keeps
  the native placeholder but TRANSPARENT — VoiceOver still announces it and `getByPlaceholderText`
  still finds it — and draws a real `<Text>` over the empty field, `pointerEvents="none"` +
  `accessible={false}`, carrying the field's own `fontSize` / `fontWeight` / `textAlign`. It splits the
  style itself: sizing is SHARED with its wrapper (a percentage then resolves one level up on each
  box), offsets (margins, `position`, `alignSelf`) MOVE to the wrapper so nothing counts twice. The
  placeholder sits in the field's CONTENT box — inside border and padding — centred for one line,
  top-aligned when `multiline`. Enforced by `components/__tests__/placeholderSweep.test.js`, which
  fails if any TextInput in `screens/` or `components/` carries a `placeholder` again.
- SEARCH FIELDS all wear the same pill: hairline rim, fully rounded (`radius` = height / 2), the
  `surface` fill, 14 pt side padding, an 8 pt gap, a `magnify` glyph at 21 in `textMuted`, 15 pt type.
  38 pt in a row of keys (the vault's board search), 46 pt when it is a panel's one input with the
  keyboard already up (the task finder, the Overview's board finder).

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
