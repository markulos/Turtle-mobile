import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, PixelRatio, StyleSheet, Animated, Easing } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import { TAP_ONLY } from '../../../utils/pressBehavior';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../context/ThemeContext';
import { itemTypeOf, formatDueDate } from '../utils/taskHelpers';
import { tapHaptic } from '../../../utils/haptics';
import TaskCountdownBadge from './TaskCountdownBadge';
import { HatchBackdrop } from './HatchBackdrop';
import { boardCardPalette } from '../utils/cardPalette';
import { clockLabel } from './ScheduleCard';

// ── Quick time helpers (self-contained so this row works in any list) ──────────
// Format "HH:MM" honoring the user's 12/24h preference.
const fmtTime = (hhmm, use24h) => {
  if (!hhmm || typeof hhmm !== 'string') return '';
  const [hs, ms] = hhmm.split(':');
  let h = Number(hs);
  const m = Number(ms);
  if (Number.isNaN(h) || Number.isNaN(m)) return '';
  if (use24h) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
};

// Add `mins` to "HH:MM" → "HH:MM", clamped to the same day.
const addMinutes = (hhmm, mins) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  let total = h * 60 + m + (Number(mins) || 0);
  total = Math.min(total, 24 * 60 - 1);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

// Diameter of the activity icon on the rail + where its centre sits, so the
// connecting line segments line up with it exactly.
const ICON = 40;
const ICON_CENTRE = ICON / 2;
const ROW_GAP = 12; // vertical gap below each row; the rail bridges it
const DOT = 22; // diameter of the completion ring overlaid on the card's right edge
// The time column on the left of every row. Wider than it was: the time is
// now held INSIDE its bubble rather than sitting beside one, so the column has
// to fit "08:30 PM" and its padding — at 62 the label truncated to "08:30…".
const TIME_COL = 74;
export const ROW_PAD = 14;
// Gap between the time column and the card — the channel the thread runs down.
const CARD_GAP = 12;
// Where the CARD column begins — the left edge every card in the agenda shares.
// Exported because the agenda's own chrome (the band headers, the dashed
// add-task template) has to line up with the cards, and hardcoding 100 in
// TasksScreen is exactly how the two sides drift apart. Anything that starts
// here is clear of the gutter by construction.
export const CARD_COL_X = ROW_PAD + TIME_COL + CARD_GAP;

// ── The timeline's thread and its bubbles ───────────────────────────────────
// One continuous line down the agenda, with the times hanging off its LEFT and
// the cards starting immediately to its RIGHT: the line is the boundary
// between the two columns, so it reads as one spine with the clock on one side
// and the content on the other.
//
// It used to run through the MIDDLE of the time column, with each bubble
// threaded onto it — which put the line inside the times rather than between
// the times and the tasks. The bubbles now sit flush against its left side and
// reach it with a short connector stub, so they're still visibly strung on the
// spine without straddling it.
//
// CRITICAL: an absolutely-positioned child's `left` is measured from its
// parent's BORDER box in Yoga — the parent's padding is NOT added. The rows
// carry ROW_PAD of horizontal padding and the date dividers carry none, so an
// earlier version used two different numbers meaning to reach the same x and
// drew two parallel lines 14pt apart. Both sides now use this one absolute
// value verbatim.
export const RAIL_ABS_X = ROW_PAD + TIME_COL + Math.round(CARD_GAP / 2);
// A full point wide — a hairline (one device pixel) read as too faint to be a
// spine at this length.
export const RAIL_W = 1;
// THE thread's colour — one value for every segment that draws it (this row,
// its stub, and the agenda's date dividers in TasksScreen/index.jsx). It used
// to be two: the rows drew the strong ink at 45% opacity while the dividers
// drew it at full strength, so the line visibly darkened at every date. Black
// at 60% here, and its exact counterpart on the dark page — a 60%-black line
// on a black background is no line at all.
export const threadColor = (theme) =>
  (theme?.mode === 'dark' ? 'rgba(255,255,255,0.60)' : 'rgba(0,0,0,0.60)');
// ── The gutter ──────────────────────────────────────────────────────────────
// The times no longer ride in pills. The whole left column is one black band
// instead — from the screen's edge all the way to the thread — and the times
// simply sit on it, left-aligned, like hours printed down the margin of a
// page.
//
// It is drawn ONCE behind the whole list (TimelineGutter, mounted in
// TasksScreen) rather than per row: a per-row band would seam at every row gap
// and every date divider, which is exactly the "column of dashes" the thread
// itself was fixed to stop being.
//
// FLUSH with the thread: the band stops at the line's LEFT edge, so the two
// touch with nothing between them. `RAIL_ABS_X` is the line's CENTRE, so using
// it verbatim would run the band half a point under the line.
export const GUTTER_W = RAIL_ABS_X - RAIL_W / 2;
// The gradient is a SHEEN, not a fade — the band is black edge to edge and
// stays that way at the line. It used to end fully transparent, which left the
// last third of the column washed out and the band visibly short of the
// thread. Three stops so the lift is gradual rather than a visible seam.
export const GUTTER_STOPS = [0, 0.6, 1];
// Black on the light page, lifting a shade toward the line — barely there, the
// band reading as one black column that happens to catch a little light at its
// inner edge. On the dark page the background is ALREADY pure black, so a
// black band is no band at all (the same inversion `threadColor` makes, for
// the same reason): there it's a near-black lift, dark enough to still be
// black, light enough to be a surface.
export const gutterColors = (theme) => (theme?.mode === 'dark'
  ? ['rgba(255,255,255,0.045)', 'rgba(255,255,255,0.075)', 'rgba(255,255,255,0.105)']
  : ['#000000', '#0D0D11', '#1A1A20']);
// The times are white in BOTH modes, because the band is dark in both. This is
// the one ink in the row that is NOT the caller's to set — a row rendered
// without TimelineGutter behind it would print white on the bare page.
export const gutterInk = (completed) => (completed ? 'rgba(255,255,255,0.45)' : '#FFFFFF');
// ONE size for everything printed in the margin — the rows' times and the
// pointer's readout alike. It used to be two numbers (11.5 on the rows, 11 on
// the readout), and the readout additionally shrank ITSELF to fit a single
// line, so the column showed two or three different sizes at once depending on
// how long the label under the mark happened to be.
//
// The readout WRAPS now rather than shrinking, which is the thing that lets
// this stay one number: a long label costs a second line instead of a smaller
// face. Both are bigger than either old value — the margin is the one place on
// the screen you read at a glance, mid-scroll.
export const MARGIN_FONT_SIZE = 13;
// Tight — the readout can run to two lines inside the notch's span, and the
// default (~1.4×) would let them drift apart enough to read as two labels.
export const MARGIN_LINE_H = 15;

// The colour the band is wearing AT its right edge — the last gradient stop.
// The notch protrudes from exactly there, so it has to match it or the seam
// shows.
export const gutterEdgeColor = (theme) => {
  const cols = gutterColors(theme);
  return cols[cols.length - 1];
};

// The band itself: an absolute strip down its parent, the width of the gutter.
// Mount it behind the agenda list (see TasksScreen), not inside a row.
export const TimelineGutter = ({ theme, style }) => (
  <LinearGradient
    pointerEvents="none"
    colors={gutterColors(theme)}
    locations={GUTTER_STOPS}
    start={{ x: 0, y: 0 }}
    end={{ x: 1, y: 0 }}
    style={[{ position: 'absolute', left: 0, top: 0, bottom: 0, width: GUTTER_W }, style]}
  />
);

// ── The pointer ─────────────────────────────────────────────────────────────
// One fixed mark on the band's edge that reads whatever the timeline is
// passing under it. Scrolling the agenda scrubs the timeline past the pointer
// rather than moving a pointer down a timeline, so the mark itself never
// moves: it is the one still thing on the screen.
//
// While the finger is down the margin belongs to the pointer alone — the rows'
// own times fade almost out and the pointer's readout takes over, which is
// what stops the readout and the row it is sitting on from printing white on
// white over each other. The rows read this ONE shared value instead of a prop
// so a scrub costs zero re-renders: only the native animation driver moves.
export const scrubFade = new Animated.Value(1);
let scrubAnim = null;
export const setScrubbing = (on) => {
  scrubAnim?.stop();
  scrubAnim = Animated.timing(scrubFade, {
    toValue: on ? 0.1 : 1,
    duration: on ? 140 : 260,
    easing: Easing.out(Easing.quad),
    useNativeDriver: true,
  });
  scrubAnim.start();
};

// ── The notch ───────────────────────────────────────────────────────────────
// A hill pressed INTO the band's edge — the mirror of the swell that stood out
// of it. The edge runs straight, dips smoothly inward to a pointed tip, and
// eases back out.
//
// One circle cannot do that. A circle's sharpness and its shoulders are the
// same number: make the radius small enough for a point and the arc meets the
// straight edge at a hard angle; make it big enough for smooth shoulders and
// the tip goes blunt. So the profile is built from THREE arcs, the way a
// machinist would cut it:
//
//   · a small TIP circle in the page's colour, cutting the dip. Small radius
//     against the depth is what makes it pointed.
//   · two big FILLET circles in the band's colour, one above and one below,
//     each tangent to the straight edge AND to the tip circle. They round the
//     two corners the tip would otherwise leave.
//
// Tangency at both joins is what makes it read as one smooth curve rather than
// three arcs stuck together, and it's solved exactly below rather than eyeballed.
export const NOTCH_DEPTH = 6.5; // how far the dip cuts into the band
export const NOTCH_TIP_R = 9; // the point — small, so it stays pointed
export const NOTCH_FILLET_R = 30; // the shoulders — big, so they stay smooth

// Where a fillet touches the straight edge, measured from the tip's centre
// line. Its centre sits at x = edge − R_f (that's what "tangent to the edge"
// means), and it must also sit R_tip + R_f from the tip's centre (tangent to
// the tip) — two constraints, one unknown, and this is the solution:
//   y² = (Rt+Rf)² − (Rt+Rf−depth)²  =  depth·(2(Rt+Rf) − depth)
export const NOTCH_SHOULDER_Y = Math.sqrt(
  NOTCH_DEPTH * (2 * (NOTCH_TIP_R + NOTCH_FILLET_R) - NOTCH_DEPTH),
);

// Tall enough to hold the whole profile — the fillets reach a good way past
// their tangent points before the shape closes.
export const NOTCH_SPAN = 96;

// The page showing THROUGH the cut. Not a theme ink — literally whatever is
// behind the band, which is what makes the dip read as material removed.
export const pageColor = (theme) =>
  theme?.colors?.background || (theme?.mode === 'dark' ? '#000000' : '#FFFFFF');
// The light the cut's edge catches. White in both modes — the band is dark in
// both, same as `gutterInk`.
export const NOTCH_RIM = 'rgba(255,255,255,0.92)';

// ── The profile, as one path ────────────────────────────────────────────────
// This used to be three overlapping circular Views inside an 8.5pt clip
// window: a page-coloured tip cutting the dip, and two band-coloured fillets
// painted back OVER it to round the corners. It worked, but it was a
// compositing trick with a real weakness — the fillets were ONE flat colour
// laid over a band that is a gradient, so they were only invisible while the
// window stayed narrow enough that the gradient barely moved across it.
//
// As a path there is nothing to hide: we draw ONLY the material that is
// removed, so the gradient underneath is untouched at any width and no
// band-coloured patch is needed at all. The three arcs and their exact
// tangency carry over unchanged — same shape, honestly drawn.
export const NOTCH_SVG_W = NOTCH_DEPTH + 3;
// The cut's straight side runs PAST the band's edge and is clipped away. That
// overhang is what lets the dip deepen without ever exposing a sliver of band
// between the cut and the edge it is cut into.
const NOTCH_OVER = 6;
const EDGE_X = NOTCH_SVG_W;
const CY = NOTCH_SPAN / 2;
// The circle centres, straight from the tangency conditions stated above.
const TIP_CX = EDGE_X - NOTCH_DEPTH + NOTCH_TIP_R;
const FILLET_CX = EDGE_X - NOTCH_FILLET_R;

// Where the tip circle and one fillet touch: on the line joining their
// centres, NOTCH_TIP_R out from the tip's. `side` is +1 below, −1 above.
const joinPoint = (side) => {
  const dx = FILLET_CX - TIP_CX;
  const dy = side * NOTCH_SHOULDER_Y;
  const d = Math.hypot(dx, dy); // === NOTCH_TIP_R + NOTCH_FILLET_R, by construction
  return { x: TIP_CX + (NOTCH_TIP_R * dx) / d, y: CY + (NOTCH_TIP_R * dy) / d };
};

const r3 = (v) => Math.round(v * 1000) / 1000;

// The edge itself, bottom shoulder → tip → top shoulder. Sweep flags read
// 0/1/0: the fillets turn one way and the tip turns back the other, which is
// exactly what makes a POINT between two smooth shoulders rather than a bump.
export const notchProfileD = () => {
  const b = joinPoint(1);
  const t = joinPoint(-1);
  return [
    `M ${r3(EDGE_X)} ${r3(CY + NOTCH_SHOULDER_Y)}`,
    `A ${NOTCH_FILLET_R} ${NOTCH_FILLET_R} 0 0 0 ${r3(b.x)} ${r3(b.y)}`,
    `A ${NOTCH_TIP_R} ${NOTCH_TIP_R} 0 0 1 ${r3(t.x)} ${r3(t.y)}`,
    `A ${NOTCH_FILLET_R} ${NOTCH_FILLET_R} 0 0 0 ${r3(EDGE_X)} ${r3(CY - NOTCH_SHOULDER_Y)}`,
  ].join(' ');
};

// The removed material: the profile, closed off to the right past the band's
// edge. Filled with the page's colour — the cut, and nothing else.
export const notchCutD = () => [
  notchProfileD(),
  `L ${r3(EDGE_X + NOTCH_OVER)} ${r3(CY - NOTCH_SHOULDER_Y)}`,
  `L ${r3(EDGE_X + NOTCH_OVER)} ${r3(CY + NOTCH_SHOULDER_Y)}`,
  'Z',
].join(' ');

// ── How it breathes ─────────────────────────────────────────────────────────
// The dip does NOT slide sideways any more. It used to, and sliding moved the
// shoulders along with it, so the tangency the profile is solved for was
// traded away a little at every frame and the join went slightly out of true.
//
// It scales horizontally about the band's EDGE instead. Two reasons, and the
// second is the whole point: the shoulders sit on the anchor line, so they
// cannot drift; and an affine map takes tangent curves to tangent curves, so a
// scaled profile is still exactly as smooth as the solved one. The dip can
// breathe as deep as you like and never break its own join.
const NOTCH_OPEN_S = 1.32; // scrubbing: ~6.5 → ~8.6 deep
const NOTCH_BEAT_S = 0.23; // the extra bite as the timeline crosses a day

export const TimelinePointer = ({ theme, label, scrubbing, beat, top, style }) => {
  // 0 = resting (tucked flush into the edge), 1 = open (standing proud).
  const open = useRef(new Animated.Value(0)).current;
  // A one-shot kick each time the timeline crosses into a new day — the same
  // instant the phone ticks, so the mark and the buzz land together.
  const kick = useRef(new Animated.Value(0)).current;

  // Opening is a spring, not a ramp — it arrives with the smallest amount of
  // overshoot, which is what makes it feel like a physical part settling
  // rather than a value being set. Closing is the same spring run backwards,
  // so letting go feels like releasing something, not switching it off.
  useEffect(() => {
    Animated.spring(open, {
      toValue: scrubbing ? 1 : 0,
      useNativeDriver: true,
      friction: 7,
      tension: 90,
    }).start();
  }, [scrubbing, open]);

  useEffect(() => {
    if (!beat) return undefined;
    kick.setValue(0);
    const a = Animated.sequence([
      Animated.timing(kick, { toValue: 1, duration: 110, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.spring(kick, { toValue: 0, friction: 5, tension: 140, useNativeDriver: true }),
    ]);
    a.start();
    return () => a.stop();
  }, [beat, kick]);

  // How deep the dip is cut, as a multiple of its resting depth: a little
  // deeper while you scrub, deeper still for an instant on each day crossing.
  const grow = Animated.add(
    open.interpolate({ inputRange: [0, 1], outputRange: [1, NOTCH_OPEN_S], extrapolate: 'clamp' }),
    kick.interpolate({ inputRange: [0, 1], outputRange: [0, NOTCH_BEAT_S] }),
  );
  // Scale about the band's EDGE rather than the shape's centre, so the
  // shoulders stay pinned on the edge while the tip travels. This is the
  // translate that moves the centre back to where a right-anchored scale would
  // have left it — x_fix = W(1−s)/2, for a transform applied as
  // `translateX then scaleX`.
  const anchor = Animated.multiply(Animated.subtract(1, grow), NOTCH_SVG_W / 2);
  const cut = { transform: [{ translateX: anchor }, { scaleX: grow }] };

  // The edge catches the light as it opens — a hairline along the profile,
  // nothing at rest, and a brief brighter flash on each day crossing. It is a
  // separate layer purely so its opacity can ride the native driver alongside
  // the transform; painting it into the same <Svg> would have put it on the JS
  // thread, which is the one thing a scrub cannot afford.
  const rim = Animated.add(
    open.interpolate({ inputRange: [0, 1], outputRange: [0, 0.45], extrapolate: 'clamp' }),
    kick.interpolate({ inputRange: [0, 1], outputRange: [0, 0.5] }),
  );
  const notchLayer = {
    position: 'absolute',
    left: GUTTER_W - NOTCH_SVG_W,
    top: 0,
    width: NOTCH_SVG_W,
    height: NOTCH_SPAN,
  };

  return (
    <View
      pointerEvents="none"
      style={[{ position: 'absolute', left: 0, right: 0, top: top - NOTCH_SPAN / 2, height: NOTCH_SPAN }, style]}
    >
      {/* The readout — transparent, no chip behind it, right-justified so it
          ends at the notch and reads as hanging off it. */}
      <Animated.View
        style={{
          position: 'absolute',
          left: 0,
          // Ends at the dip's deepest point, so the readout hangs off the
          // notch rather than running under it.
          width: GUTTER_W - NOTCH_DEPTH,
          height: NOTCH_SPAN,
          // NO padding here. The column already ends at the dip's deepest
          // point, so the text's right edge lands ON the notch — flush into
          // it, no channel of empty band between the label and the mark it
          // belongs to. This used to be 8, which read as the readout floating
          // near the notch rather than hanging off it.
          paddingRight: 0,
          alignItems: 'flex-end',
          justifyContent: 'center',
          // The mirror of the rows' fade: the readout takes the margin over as
          // they give it up. Clamped because `open` is a spring and overshoots.
          opacity: open.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
          transform: [{ translateX: open.interpolate({ inputRange: [0, 1], outputRange: [-5, 0] }) }],
        }}
      >
        {/* Wraps rather than shrinks. `adjustsFontSizeToFit` + numberOfLines=1
            meant a long readout ("Wed 8 Oct · 12:30 PM") rendered smaller than
            a short one, so the size moved as you scrubbed — the one thing you
            are actually reading, changing size while you read it. Letting it
            take a second line holds MARGIN_FONT_SIZE constant instead; the
            column is centred on the mark, so two lines straddle it evenly. */}
        <Text
          style={{
            fontSize: MARGIN_FONT_SIZE,
            lineHeight: MARGIN_LINE_H,
            fontWeight: '800',
            color: '#FFFFFF',
            letterSpacing: 0.2,
            textAlign: 'right',
            fontVariant: ['tabular-nums'],
          }}
        >
          {label || ''}
        </Text>
      </Animated.View>

      {/* The cut. The <Svg> is exactly as wide as the band's last few points
          and its right edge IS the band's edge, so — as with the clip window
          this replaces — nothing the notch draws can spill past it into the
          cards' channel. The path's overhang is what gets clipped away. */}
      <Animated.View style={[notchLayer, cut]} pointerEvents="none">
        <Svg width={NOTCH_SVG_W} height={NOTCH_SPAN}>
          <Path d={notchCutD()} fill={pageColor(theme)} />
        </Svg>
      </Animated.View>

      {/* The light along that cut's edge. Same geometry, same transform —
          stroked instead of filled, and faded by its own layer. */}
      <Animated.View style={[notchLayer, cut, { opacity: rim }]} pointerEvents="none">
        <Svg width={NOTCH_SVG_W} height={NOTCH_SPAN}>
          <Path
            d={notchProfileD()}
            fill="none"
            stroke={NOTCH_RIM}
            strokeWidth={1}
            strokeLinecap="round"
          />
        </Svg>
      </Animated.View>
    </View>
  );
};

// The time's line box. Not a pill any more — just the height the label
// occupies, which is still what the thread's endpoints are measured against.
const TIME_H = 22;
// Where that line box's centre sits inside the row — on the card's first line,
// not the middle of the card (a card's height is its layout, not its duration).
const TIME_TOP = 9;
const TIME_CENTRE = TIME_TOP + TIME_H / 2;
const parseHM = (hhmm) => { const [h, m] = String(hhmm || '').split(':').map(Number); return (h || 0) * 60 + (m || 0); };

// Locked card height for `uniform` rows (see below): paddingVertical 9×2 +
// when-line ~18 + one-line title ~20 + subtitle ~18 = 74 at fontScale 1. The
// agenda's PAST zone relies on every row being EXACTLY this + ROW_GAP tall, so
// its lazy-load placeholders occupy identical space and swaps never move the
// layout. Scaled by the device's accessibility font scale (constant for the
// app's lifetime) so large-text users don't get sheared cards — the zone's
// arithmetic stays exact because every consumer shares these constants.
const FONT_SCALE = Math.max(1, PixelRatio.getFontScale());
export const UNIFORM_CARD_H = Math.round(74 * FONT_SCALE);
export const UNIFORM_ROW_H = UNIFORM_CARD_H + ROW_GAP;

// A single task/event rendered as a timeline entry: an activity icon on a
// connecting rail, then a card with the date + time range, a live countdown
// badge (minute precision) to when it happens, the title, and a grey subtitle.
// Keeps every existing action — tap → inspector, long-press → full edit, tap
// the toggle → complete.
// `uniform`: locks the card to UNIFORM_CARD_H with a ONE-line title, making
// the whole row a fixed UNIFORM_ROW_H — required by the agenda's past zone,
// where skeleton placeholders must match real rows to the pixel.
export const TimelineTaskRow = ({ item, onPress, onLongPress, onToggleComplete, onPressTime, isFirst, isLast, hideDate, done, doneDate, hideCountdown, railColor, boardColor, uniform, whenLabelFallback = 'No date', trailing, hatchColor, owner, onOwnerPress }) => {
  const { theme, timeFormat } = useTheme();
  const c = theme.colors || {};
  const use24h = timeFormat === '24h';

  // The card wears its BOARD (utils/cardPalette): the board's colour mixed
  // into the dark panel, and that panel plain — unchanged — when the row has
  // no board. The inks ride along with the fill, so no call site has to think
  // about contrast.
  const inv = boardCardPalette(theme, boardColor);
  const cText = inv.text;
  const cSub = inv.sub;
  const cMuted = inv.muted;
  const cCardBg = inv.card;
  const cBorder = inv.edge;
  // The thread itself is NOT the caller's to colour — it is one line down the
  // whole agenda and every segment of it uses `threadColor`. (`railColor` used
  // to be the time bubble's fill; the times print straight on the gutter now,
  // in `gutterInk`, so the prop survives only for the call sites that still
  // pass it and no longer paints anything.)
  //
  // It used to be drawn ONLY on the date dividers between groups, which is why
  // the agenda's left edge read as a row of disconnected black dashes rather
  // than a timeline: the line existed at the joins and nowhere else. It runs
  // through every row now, bridging the gap below it, so the dividers' own
  // segments are continuations of one line instead of the whole of it.
  const thread = threadColor(theme);

  // The completion ring takes the card's own inks (see the render).

  // `done` (optional) overrides the raw boolean — recurring tasks track
  // per-occurrence completion in meta.completedDates, so the CALLER decides
  // what "checked" means in its context (per-day in the day panel, done-now in
  // the Upcoming agenda). Fall back to the plain boolean for old call sites.
  const completed = done !== undefined ? !!done : !!item.completed;

  // "When" line — the date plus the time range, so each upcoming row states
  // exactly when it happens: "Today · 2:30 PM — 3:00 PM", "Tomorrow", etc. The
  // live countdown to the right (TaskCountdownBadge) carries the minute ticker.
  // In a single-day panel the date is redundant (the panel header already shows
  // it), so `hideDate` drops it and the when-line shows just the time range.
  // When a recurring row is checked, `doneDate` (the ticked occurrence) drives
  // the label — otherwise the row would flash the ALREADY-ADVANCED next dueDate
  // ("Tomorrow") the instant you complete it, which reads as a glitch.
  const whenDate = (completed && doneDate) ? doneDate : item.dueDate;
  const dateLabel = (!hideDate && whenDate) ? formatDueDate(whenDate) : '';
  const start = item.time ? fmtTime(item.time, use24h) : '';
  const end = item.time && Number(item.duration) > 0 ? fmtTime(addMinutes(item.time, item.duration), use24h) : '';
  const timePart = start ? (end ? `${start} — ${end}` : start) : '';
  const whenLabel = dateLabel
    ? (timePart ? `${dateLabel} · ${timePart}` : dateLabel)
    : (timePart || whenLabelFallback);

  // An event says so in the margin instead of showing a clock. It isn't a
  // thing you do AT a time the way a task is — it's a thing that's on that
  // day — and the card's when-line still carries the hour for the ones that
  // have one, so naming the kind here costs nothing and reads at a glance.
  const isEvent = itemTypeOf(item) === 'event';
  // Unpadded hours: "9 PM", not "09 PM". The leading zero was padding to keep
  // hugging pills the same width; the times are flush-left on the band now, so
  // it bought nothing and read as a timestamp rather than a time.
  const timeLabel = isEvent
    ? 'Event'
    : (item.time ? clockLabel(parseHM(item.time), use24h, { pad: false }) : '—');

  // The subtitle names the board, falling back to the item's KIND for the
  // kinds the row doesn't otherwise state. An event's kind is in the margin
  // now, so repeating it here would print "Event" twice on one card.
  const typeLabel = { birthday: 'Birthday' }[itemTypeOf(item)];
  const subtitle = item.project || typeLabel || 'No Board';
  const ownerName = owner?.name?.trim() || null;

  // The card's text column (when-line + title + subtitle). Factored out so an
  // optional `trailing` accessory (e.g. Pending's "add to today" button) can sit
  // beside it in a row without disturbing the plain stacked layout every other
  // caller uses.
  const cardBody = (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
        <Text style={{ fontSize: 12, color: cMuted, flexShrink: 1 }} numberOfLines={1}>{whenLabel}</Text>
        {(ownerName || (!completed && !hideCountdown)) && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 8 }}>
            {ownerName && (
              <TouchableOpacity
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  marginRight: !completed && !hideCountdown ? 8 : 0,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: owner.color || cSub,
                }}
                onPress={() => onOwnerPress?.(item)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={`Owner: ${ownerName}. Open profile`}
              >
                <Text style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '700' }}>
                  {ownerName.charAt(0).toUpperCase()}
                </Text>
              </TouchableOpacity>
            )}
            {!completed && !hideCountdown && <TaskCountdownBadge task={item} palette={inv} />}
          </View>
        )}
      </View>
      <Text
        style={{ fontSize: 15, fontWeight: '600', color: cText, textDecorationLine: completed ? 'line-through' : 'none' }}
        // Uniform rows cap the title to ONE line — a wrapped title is the
        // one thing that made row heights vary.
        numberOfLines={uniform ? 1 : 2}
      >
        {item.title}
      </Text>
      <Text style={{ fontSize: 13, color: cSub, marginTop: 1 }} numberOfLines={1}>{subtitle}</Text>
    </>
  );

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: ROW_GAP, paddingHorizontal: 14 }}>
      {/* The thread. One continuous line down the whole agenda: it runs from
          this row's top (unless the row opens a band, where there is nothing
          above to join) PAST the bottom by the row gap, so the next row's
          segment starts exactly where this one ends and the join is invisible.
          It passes BEHIND the bubble, which is what makes it read as threaded
          through rather than as two stubs meeting a marker. */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: RAIL_ABS_X - RAIL_W / 2,
          top: isFirst ? TIME_CENTRE : 0,
          bottom: isLast ? undefined : -ROW_GAP,
          height: isLast ? TIME_CENTRE : undefined,
          width: RAIL_W,
          backgroundColor: thread,
        }}
      />

      {/* The time — printed on the gutter, not held in a bubble. Flush LEFT,
          so every hour starts on the same x and the column reads as a margin
          of times rather than a string of beads. There is no stub any more:
          the band itself is what reaches the thread.

          A finished row dims its time rather than hollowing a shape — it is
          still in the margin, it has just stopped being a thing that is
          waiting.

          Tapping it reschedules — the time alone when the row already has a
          date, otherwise date-then-time (see onPressTime). */}
      <View style={{ width: TIME_COL, alignItems: 'flex-start', paddingTop: TIME_TOP }}>
        <TouchableOpacity
          onPress={onPressTime ? () => { tapHaptic(); onPressTime(item); } : undefined}
          disabled={!onPressTime}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 14, right: 8 }}
          accessibilityRole={onPressTime ? 'button' : undefined}
          accessibilityLabel={onPressTime
            ? (item.dueDate ? 'Change time' : 'Set date and time')
            : undefined}
          style={{
            width: TIME_COL,
            height: TIME_H,
            alignItems: 'flex-start',
            justifyContent: 'center',
          }}
        >
          <Animated.Text
            style={{
              fontSize: MARGIN_FONT_SIZE,
              fontWeight: '700',
              // NOT the theme's ink and NOT the caller's: the band underneath
              // is dark in both modes, so the time is white in both.
              color: gutterInk(completed),
              fontVariant: ['tabular-nums'],
              letterSpacing: 0.1,
              textAlign: 'left',
              // The margin is the POINTER's while a scrub is in flight — see
              // `scrubFade`. Without this the pointer's readout and the row it
              // happens to be sitting on print over each other, both of them
              // bold white on the same black.
              opacity: scrubFade,
            }}
            numberOfLines={1}
          >
            {timeLabel}
          </Animated.Text>
        </TouchableOpacity>
      </View>

      {/* Card */}
      <TouchableOpacity
        {...TAP_ONLY}
        onPress={() => onPress?.(item)}
        onLongPress={() => onLongPress?.(item)}
        activeOpacity={0.75}
        delayLongPress={300}
        style={{
          flex: 1,
          marginLeft: CARD_GAP,
          backgroundColor: cCardBg,
          borderRadius: 16,
          borderWidth: 1,
          // Board tasks get a hairline border in the board's colour (matches the
          // hatch backdrop); everything else keeps the neutral card border.
          borderColor: hatchColor || cBorder,
          // Inset: the recess catches light along its top edge.
          borderTopColor: hatchColor || inv.edgeTop,
          paddingVertical: 9,
          paddingLeft: 12,
          // Room for the completion ring overlaid on the right edge.
          paddingRight: 12 + DOT + 12,
          opacity: completed ? 0.65 : 1,
          ...inv.shadow,
          // Uniform mode: pixel-exact card height so the row's total height is
          // a constant the agenda's placeholder geometry can rely on.
          ...(uniform ? { height: UNIFORM_CARD_H, justifyContent: 'center' } : {}),
          // With a trailing accessory the card lays out as [text | button].
          ...(trailing ? { flexDirection: 'row', alignItems: 'center' } : {}),
        }}
      >
        {/* Low-opacity diagonal hatch in the board's colour, behind the content
            (callers pass hatchColor when the task belongs to a board). */}
        <HatchBackdrop color={hatchColor} style={{ borderRadius: 12 }} />
        {trailing ? (
          <>
            <View style={{ flex: 1, minWidth: 0 }}>{cardBody}</View>
            {trailing}
          </>
        ) : cardBody}
        {/* Completion ring — INSIDE the card, overlaid on its right edge and
            vertically centred. Done = filled with the card's text colour and a
            check in the card colour; not done = a hairline ring. */}
        <TouchableOpacity
          onPress={() => { tapHaptic(); onToggleComplete?.(item); }}
          activeOpacity={0.7}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: completed }}
          accessibilityLabel={completed ? 'Mark not done' : 'Mark done'}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={{ position: 'absolute', right: 12, top: 0, bottom: 0, justifyContent: 'center', zIndex: 4, elevation: 4 }}
        >
          <View
            style={{
              width: DOT,
              height: DOT,
              borderRadius: DOT / 2,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: completed ? cText : 'transparent',
              borderWidth: completed ? 0 : 1.5,
              borderColor: cText,
            }}
          >
            {completed && <Icon name="check" size={DOT - 8} color={cCardBg} />}
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </View>
  );
};
