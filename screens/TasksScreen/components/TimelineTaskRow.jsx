import React, { useEffect, useMemo, useRef } from 'react';
import { View, Text, TouchableOpacity, PixelRatio, StyleSheet, Animated, Easing } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import { splitDay, splitTime, dayOffsetLabel } from '../utils/timelinePointer';
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
// Vertical gap below each row; the rail bridges it. Exported because a cell's
// LAYOUT box includes it, so anything measuring where a card's centre actually
// is (the agenda's magnet) has to take it back off.
export const ROW_GAP = 12;
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
// THE thread's colour — one value for every segment that draws it.
//
// WHITE on both pages, which is not the usual inversion and is deliberate.
// The line does not live on the page; it lives on the BAND, and the band is
// dark in both modes (that is `gutterColors`' whole point). So the ink that
// reads against it is the same ink in both — exactly like `gutterInk`, which
// prints the times white on either page for the same reason.
//
// It used to invert: black at 60% on the light page. That worked for the
// straight run only because the line sat just OUTSIDE the band, on white —
// and it fell apart the moment the notch swerved, because the swerve dips
// INTO the band and a dark line on a dark band is no line at all. Light mode
// showed a straight dark line with a hole where the mark should be, while
// dark mode looked right. One white line on one dark band behaves the same on
// both pages.
//
// PURE WHITE on the light page, which is what makes the mark one object. The
// notch's rim has always been solid white; the rail it runs out of was 72%, so
// the line visibly brightened as it reached the swerve and dimmed again
// leaving it — a seam exactly where the eye is looking. At full strength the
// rim and the rail are the same white and the swerve is simply the rail's own
// path, which is what `notchLineD` draws it as.
//
// The dark page keeps its 60%. There the band is barely lighter than the page,
// so a solid white line stops being a rail down a margin and becomes the
// brightest thing on the screen.
export const threadColor = (theme) =>
  (theme?.mode === 'dark' ? 'rgba(255,255,255,0.60)' : 'rgba(255,255,255,1)');
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
// ── The margin's OUTER edge ─────────────────────────────────────────────────
// Where the whole left margin ends and the page begins — band, plus the
// thread's own width, plus a small nudge.
//
// The nudge exists because landing exactly on the thread's far side is not
// enough in practice: the band ends on a half-point (GUTTER_W is 93.5) and the
// cut has to close over a 1pt line at that boundary, so anything that rounds
// differently leaves a hairline of thread showing between the notch and the
// page. Two points past it cannot.
//
// EVERYTHING that borders the margin measures from this one value — the
// notch's cut, the band headers, the rule between the bands. That is the
// point: they were each deriving their own edge from GUTTER_W and landing a
// point or two apart, which is precisely the "not unified" look.
// ── Where the thread runs ───────────────────────────────────────────────────
// INSIDE the band, occupying its last RAIL_W — not just outside it on the
// page, which is where it used to sit.
//
// That old position only ever worked on the dark page, where the page itself
// is black and a white line shows against it. On the light page the line was
// white-on-white the moment it left the band, and dark-on-dark the moment it
// swerved into it. Riding the band's inner edge, it has the same dark surface
// behind it everywhere it goes — along the straight run AND through the whole
// swerve, which is the part that has to stay legible.
export const THREAD_LEFT = GUTTER_W - RAIL_W;
export const THREAD_CX = THREAD_LEFT + RAIL_W / 2;
export const MARGIN_NUDGE = 4;
export const MARGIN_EDGE_X = GUTTER_W + RAIL_W + MARGIN_NUDGE;
// The gradient is a SHEEN, not a fade — the band is black edge to edge and
// stays that way at the line. It used to end fully transparent, which left the
// last third of the column washed out and the band visibly short of the
// thread. Three stops so the lift is gradual rather than a visible seam.
// Every stop OPAQUE, and the edge lands on one flat colour.
//
// A previous build feathered the last few points in alpha, trying to soften
// the edge. It backfired at the notch: the cut is painted in the page's own
// colour — fully opaque, because it is a hole — while the band on either side
// of it was semi-transparent. Two different treatments meeting along the same
// edge, so the notch stopped reading as part of the edge and started reading
// as something stuck on it. The softening is in the COLOUR now instead (see
// `gutterColors`), which costs nothing at the cut.
export const GUTTER_STOPS = [0, 0.55, 1];
// DARK GREY, not black. Pure black against a white page is the harshest edge
// the screen can draw — there is no contrast left above it — and it read as a
// slab cut out of the page rather than a margin belonging to it. A dark grey
// carries the same weight with a fraction of the violence, and it gives the
// times something to sit ON rather than a hole to sit in.
//
// Still a sheen across the width: lifting a shade toward the line, barely
// there, so the band reads as one surface catching a little light at its inner
// edge. On the dark page the background is ALREADY near-black, so a dark grey
// band is no band at all (the same inversion `threadColor` makes, for the same
// reason): there it is a white lift instead, dark enough to stay a shadow,
// light enough to be a surface.
export const gutterColors = (theme) => (theme?.mode === 'dark'
  ? ['rgba(255,255,255,0.05)', 'rgba(255,255,255,0.08)', 'rgba(255,255,255,0.11)']
  : ['#1F1F23', '#26262C', '#2E2E35']);
// ── The ruler ───────────────────────────────────────────────────────────────
// A hairline graduation on the band's left edge at the head of every card, the
// way a rule is marked off.
//
// The band was one undifferentiated dark column with times floating on it, and
// nothing said where one row ended and the next began except the cards on the
// other side of the thread. The ticks give the eye something to measure
// against: the margin reads as ruled rather than as a gap that happens to have
// numbers in it, and a row's time is visibly ON a graduation rather than
// hovering at an arbitrary height.
//
// Short, and from the EDGE inward — a ruler's marks belong to its edge. Long
// enough to read as deliberate, nowhere near the thread, and nowhere near the
// times' own left margin (ROW_PAD), so a tick never underlines a time.
export const RULER_TICK_W = 18;
// White in both modes, for the same reason the times are: what is behind it is
// the band, and the band is dark on either page. Low, but a hairline at a
// lower alpha than this simply is not there on a 3× screen — the brief was
// faint, not invisible.
export const rulerTickColor = () => 'rgba(255,255,255,0.22)';

// The times are white in BOTH modes, because the band is dark in both. This is
// the one ink in the row that is NOT the caller's to set — a row rendered
// without TimelineGutter behind it would print white on the bare page.
export const gutterInk = (completed) => (completed ? 'rgba(255,255,255,0.45)' : '#FFFFFF');
// A breath of light around each time on the band — the tick reading as lit
// rather than printed. Kept under the threshold where it becomes a visible
// halo: no offset, a small radius, and an alpha low enough that you notice the
// times feel brighter without being able to point at why. A finished row's
// tick glows less, in step with its dimmer ink — a done thing stops giving off
// light.
export const gutterGlow = (completed) => ({
  textShadowColor: completed ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.38)',
  textShadowOffset: { width: 0, height: 0 },
  textShadowRadius: completed ? 4 : 7,
});
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
// The breathing room between the end of the readout's column and the notch's
// deepest point. Small — enough that the label and the mark read as two
// things, not so much that they stop belonging to each other.
export const READOUT_GAP = 6;
// The reading is set LARGER than the rows' ticks. It is the one thing you are
// actually reading mid-scrub, and it has the whole margin to itself while the
// ticks fade out under it — so it does not have to live inside their column.
export const READOUT_FONT_SIZE = 15;
export const READOUT_LINE_H = 17;
// The hour sits a shade under the date it belongs to — present, but clearly
// the second thing you read.
export const READOUT_TIME_OPACITY = 0.9;
// ── How far from today ──────────────────────────────────────────────────────
// A one-word annotation on the reading — "in 10d", "yesterday" — set ABOVE it
// for anything still to come and BELOW it for anything past, so the side the
// word sits on already says which way it points before you have read it.
//
// Smaller and quieter than the reading it annotates. It also has to survive
// this column, which is the narrowest text on the screen: at the readout's own
// 15pt "Yesterday" does not fit in the ~64pt available and wraps mid-word,
// which is the whole reason the relative words live down here now (see
// `dayOffsetLabel`, and agendaDateLabelShort in TasksScreen).
export const OFFSET_FONT_SIZE = 11.5;
export const OFFSET_LINE_H = 14;
// The air between the word and the reading it annotates. Generous on purpose:
// at a hair's breadth the two read as one wrapped block, and the word is a
// different KIND of thing from the date — it wants to be clearly its own line
// before you have read either.
export const OFFSET_GAP = 20;
// The two weights each line of the reading is set in. The gap between them has
// to be wide enough to read as deliberate at 13pt — 800 against 300 does; 700
// against 500 just looks like a rendering accident.
export const READOUT_HEAVY = '800';
export const READOUT_LIGHT = '300';

// The colour the band is wearing AT its right edge — the last gradient stop.
// The notch protrudes from exactly there, so it has to match it or the seam
// shows.
export const gutterEdgeColor = (theme) => {
  const cols = gutterColors(theme);
  return cols[cols.length - 1];
};

// The band itself: an absolute strip down its parent, the width of the gutter.
// Mount it behind the agenda list (see TasksScreen), not inside a row.
// The band AND the thread, as one piece behind the list.
//
// The thread used to be drawn by each ROW, from its own top to just past its
// own bottom, so consecutive rows joined invisibly. That works only where
// there are rows: at the band headers, the add-task template and the gap
// between the two bands nothing drew it, so the line broke — and it stopped
// dead at the last row rather than running to the bottom of the screen.
//
// Drawn once here it cannot break, for exactly the reason the band is drawn
// once here. And it must be ONLY here: the thread is a 60%-alpha line, so a
// row segment sitting on top of this one would composite to ~84% and every
// row would wear a visibly darker line than the gaps between them.
export const TimelineGutter = ({ theme, notchTop = null, style }) => {
  // The band's last RAIL_W — the line rides inside its edge, so it always has
  // the band behind it rather than the page.
  const line = {
    position: 'absolute',
    left: THREAD_LEFT,
    width: RAIL_W,
    backgroundColor: threadColor(theme),
  };
  // Where the pointer's swerve takes over. The line is drawn in two pieces
  // around that window and the pointer draws the third — including its own
  // straight run at each end, so the three butt together on the same x rather
  // than needing to meet a curve exactly.
  const gapTop = notchTop == null ? null : notchTop - NOTCH_SPAN / 2;
  return (
    <View
      pointerEvents="none"
      style={[{ position: 'absolute', left: 0, top: 0, bottom: 0, width: GUTTER_W + RAIL_W }, style]}
    >
      <LinearGradient
        colors={gutterColors(theme)}
        locations={GUTTER_STOPS}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: GUTTER_W }}
      />
      {gapTop == null ? (
        <View style={[line, { top: 0, bottom: 0 }]} />
      ) : (
        <>
          <View style={[line, { top: 0, height: Math.max(0, gapTop) }]} />
          <View style={[line, { top: gapTop + NOTCH_SPAN, bottom: 0 }]} />
        </>
      )}
    </View>
  );
};

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
// ── The rows the mark is NOT on ─────────────────────────────────────────────
// A second shared value, for the cards rather than the times. While a scrub is
// in flight every row except the one under the mark settles back — by a
// HAIR — so the one being read comes forward without anything having to
// flash, scale or glow.
//
// 80%: enough separation to see at a glance which card the mark is on, while
// every other card stays perfectly readable — you are still scanning the list
// as it moves, so the ones you are NOT on cannot become hard to read. The
// floor is somewhere around 0.6, where a moving list starts reading as a
// disabled one rather than a receded one.
//
// Shared for the same reason `scrubFade` is — a per-row prop would re-render
// the whole list on every frame of a drag. Only the ACTIVE flag is a prop, and
// that changes once per row you pass, not once per frame.
export const scrubDim = new Animated.Value(1);
export const SCRUB_DIM_TO = 0.8;
// ── Being exempt from it ────────────────────────────────────────────────────
// A row's own opacity, given how far it has LIFTED clear of the shared dim:
//
//     dim·(1 − lift) + lift        lift 0 → the dim, lift 1 → exactly 1
//
// Written as arithmetic over animated nodes rather than as a choice between
// them, which is the whole point and is load-bearing. `scrubDim` runs on the
// native driver, so mid-scrub the animation graph is writing the row's opacity
// straight to the view, out of band from React. A style that switched to a
// literal 1 for the marked row was asking React to commit a value over a prop
// the graph was still holding — two pipes, two arrival times, and the graph's
// 0.8 is what stayed on screen. So the row the mark was on dimmed along with
// all the others: the one card you were pointing at was the one card that
// could not come forward.
//
// Here `lift` is just another input. At lift 1 the expression is exactly 1
// whatever the dim does, evaluated inside the graph that already owns the
// prop — there is nothing left to race. Exported so the arithmetic can be
// pinned by a test without reaching into a row's internals.
export const rowDimNode = (lift) =>
  Animated.add(Animated.multiply(scrubDim, Animated.subtract(1, lift)), lift);
let scrubAnim = null;
let dimAnim = null;
export const setScrubbing = (on) => {
  scrubAnim?.stop();
  scrubAnim = Animated.timing(scrubFade, {
    toValue: on ? 0.1 : 1,
    duration: on ? 140 : 260,
    easing: Easing.out(Easing.quad),
    useNativeDriver: true,
  });
  scrubAnim.start();
  dimAnim?.stop();
  // Slower in than the times' fade and slower still out, so the list settles
  // rather than blinks — the difference between "premium" and "flickery" here
  // is almost entirely in these two durations.
  dimAnim = Animated.timing(scrubDim, {
    toValue: on ? SCRUB_DIM_TO : 1,
    duration: on ? 220 : 320,
    easing: Easing.out(Easing.quad),
    useNativeDriver: true,
  });
  dimAnim.start();
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
// The swerve at full strength, for the moment it opens — the thread's own
// colour with the fade taken off, so the line simply presses harder where it
// turns. White on both pages, for the same reason `threadColor` is: the
// surface behind it is the band, and the band is dark in both.
export const notchRim = () => 'rgba(255,255,255,1)';
// What sits INSIDE the swerve: THE PAGE'S OWN COLOUR, not white.
//
// The bay is material removed from the band, and what you see through a hole is
// whatever is behind it — so the fill has to be the page. It was #FFFFFF, which
// was the same thing back when the page was #FFFFFF; the page is a warm
// off-white now, and a white wedge in it stopped reading as a cut and started
// reading as a white shape parked in the margin. Taken from the theme rather
// than written down again, so it cannot drift from the page a second time.
//
// Nothing on the dark page. There the band is barely lighter than the page
// behind it, so a page-coloured wedge is invisible and a white one reads as a
// lamp. The stroke alone is already legible against it, which is why dark mode
// looked right while light mode did not.
export const notchFill = (theme) =>
  (theme?.mode === 'dark' ? null : (theme?.colors?.background || '#FFFFFF'));

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
// ── The notch IS the line ───────────────────────────────────────────────────
// Not a bite taken out of the band any more: the thread itself runs straight
// down, swerves in to a point, and carries on. Same stroke, same colour, same
// width — the deviation is simply part of the line's own path.
//
// Two things forced this. First, drawn as a page-coloured FILL it could only
// ever work on one page: in light mode a white cut against a dark band reads
// as material removed, but in dark mode the page is near-black and the cut
// vanishes, leaving nothing but whatever stroke sat on top of it. A shape made
// of the LINE works identically in both, because the line already inverts.
// Second, a flat page-coloured fill never matched the page anyway — the screen
// washes the page with a faint gradient the flat colour does not carry — so
// every point the fill ran past the band printed as a pale block standing
// proud of the edge. There is no fill left to mismatch.
//
// The straight run above and below the swerve is drawn HERE too, not just the
// curve, so this one path joins the gutter's two segments into a continuous
// line. TimelineGutter leaves a gap exactly NOTCH_SPAN tall for it.
const NOTCH_PAD = 2; // slack for the stroke's own width at the tip
export const NOTCH_SVG_W = NOTCH_DEPTH + NOTCH_PAD * 2;
// The line's centre inside the surface. EVERYTHING is measured from it: the
// swerve's shoulders sit exactly on it, which is what makes the detour read as
// the line's own rather than as a shape parked beside it.
const LINE_X = NOTCH_PAD + NOTCH_DEPTH;
const EDGE_X = LINE_X;
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

// The swerve alone, top shoulder → tip → bottom shoulder. Sweep flags read
// 1/0/1: the fillets turn one way and the tip turns back the other, which is
// exactly what makes a POINT between two smooth shoulders rather than a bump.
// (They were 0/1/0 when this was traced bottom-to-top; reversing a path flips
// every sweep.)
export const notchProfileD = () => {
  const t = joinPoint(-1);
  const b = joinPoint(1);
  return [
    `M ${r3(EDGE_X)} ${r3(CY - NOTCH_SHOULDER_Y)}`,
    `A ${NOTCH_FILLET_R} ${NOTCH_FILLET_R} 0 0 1 ${r3(t.x)} ${r3(t.y)}`,
    `A ${NOTCH_TIP_R} ${NOTCH_TIP_R} 0 0 0 ${r3(b.x)} ${r3(b.y)}`,
    `A ${NOTCH_FILLET_R} ${NOTCH_FILLET_R} 0 0 1 ${r3(EDGE_X)} ${r3(CY + NOTCH_SHOULDER_Y)}`,
  ].join(' ');
};

// How far the bay's fill runs PAST the band's edge, into the panel beyond it.
// Deliberately oversetting: the fill is the page's own white and the panel it
// laps over is white too, so the two merge and the notch reads as opening
// into the panel rather than stopping at a boundary and starting again.
//
// One point, and it has to stay about that. The fill is flat white while the
// screen lays a faint blue-tinted wash over the page, so a wide overset would
// print as a pale block standing proud of the edge — which is exactly what a
// 5pt overrun did before. At a point it blends; at five it announces itself.
export const NOTCH_BAY_OVERSET = 1;

// The bay the swerve encloses: the curve on one side, and on the other a
// straight edge carried past the band into the panel. The profile begins and
// ends on the line, so the two `L`s below are the only thing that crosses it —
// the curve itself still cannot, however deep the swerve is pushed.
export const notchBayD = () => {
  const right = r3(LINE_X + RAIL_W / 2 + NOTCH_BAY_OVERSET);
  return [
    notchProfileD(),
    `L ${right} ${r3(CY + NOTCH_SHOULDER_Y)}`,
    `L ${right} ${r3(CY - NOTCH_SHOULDER_Y)}`,
    'Z',
  ].join(' ');
};

// The whole line through this window: straight down to the shoulder, the
// swerve, then straight on. Stroked in the thread's own colour and width, so
// it continues the gutter's two segments rather than sitting on top of them.
export const notchLineD = () => [
  `M ${r3(EDGE_X)} 0`,
  `L ${r3(EDGE_X)} ${r3(CY - NOTCH_SHOULDER_Y)}`,
  notchProfileD().replace(/^M [\d.]+ [\d.]+ /, ''),
  `L ${r3(EDGE_X)} ${r3(NOTCH_SPAN)}`,
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
// The furthest the tip ever reaches from the line — scrub and day-beat at
// once. The readout has to clear THIS, not the resting depth, or the swerve
// grows into the text on exactly the frames you are reading it.
export const NOTCH_MAX_REACH = NOTCH_DEPTH * (NOTCH_OPEN_S + NOTCH_BEAT_S);

// ── Where the reading sits in the window ────────────────────────────────────
// THE DAY LINE IS CENTRED ON THE NOTCH — not the reading as a block.
//
// It used to be the block: the column was justify-centre, so a date alone sat
// on the mark but a date WITH an hour under it sat half a line high, and the
// date shifted up and down by 8pt as you scrolled between timed and untimed
// rows. The notch points at one place; the thing it points at has to be at
// that place on every frame, whatever else happens to be printed.
//
// So the day's box is pinned here and the hour simply hangs below it.
export const READOUT_DAY_TOP = NOTCH_SPAN / 2 - READOUT_LINE_H / 2;
// The foot of the reading at its TALLEST — day plus an hour. What sits under
// the reading measures from THIS even when there is no hour, so it holds still
// for the same reason the day does.
export const READOUT_FOOT = READOUT_DAY_TOP + READOUT_LINE_H * 2;

export const TimelinePointer = ({ theme, label, scrubbing, beat, top, style }) => {
  // `label` is {day, time} — or a bare string, which is what every call site
  // passed before the reading split into two lines. Tolerated rather than
  // required so a caller holding a plain string still prints something
  // sensible instead of "[object Object]".
  const day = typeof label === 'string' ? label : label?.day;
  const time = typeof label === 'string' ? null : label?.time;
  const dayParts = splitDay(day);
  const timeParts = splitTime(time);
  const isEventReading = typeof label === 'object' && label?.kind === 'event';
  // How far the reading is from today, and therefore which side of the reading
  // the word belongs on: ahead of today it sits above, past it sits below.
  const offsetDays = typeof label === 'object' ? label?.offsetDays : null;
  const offsetWord = dayOffsetLabel(offsetDays);
  const offsetIsPast = Number.isFinite(offsetDays) && offsetDays < 0;
  // The shared line box for both rows of the reading. The WEIGHT is not set
  // here — each line sets its own per span, which is the whole point.
  const readoutLine = {
    fontSize: READOUT_FONT_SIZE,
    lineHeight: READOUT_LINE_H,
    color: '#FFFFFF',
    // The readout stands in for the rows' times while you scrub, so it is lit
    // the same way they are — the margin keeps one voice.
    ...gutterGlow(false),
    letterSpacing: 0.2,
    textAlign: 'left',
    fontVariant: ['tabular-nums'],
  };
  // The offset word. Quieter than the reading in every dimension — smaller,
  // lighter, dimmer ink, and the dimmer of the two glows — because it
  // annotates the reading rather than competing with it.
  const offsetLine = {
    fontSize: OFFSET_FONT_SIZE,
    lineHeight: OFFSET_LINE_H,
    // THIN, at FULL strength. The separation from the reading is carried by
    // the weight and the air around it, not by dimming the ink — a hairline
    // white word reads as a different voice while still being properly lit,
    // where a dimmed one just read as the reading gone faint. The glow is the
    // quieter of the two: the strong one blurs strokes this fine.
    fontWeight: '200',
    color: '#FFFFFF',
    ...gutterGlow(true),
    letterSpacing: 0.2,
    textAlign: 'left',
    fontVariant: ['tabular-nums'],
  };
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
  // Scale about the LINE, so the straight run above and below the swerve stays
  // exactly on it while only the tip travels. For a transform applied as
  // `translateX then scaleX`, holding x = a fixed needs t = (a − W/2)(1 − s).
  // Anchoring anywhere else would drag the straight segments off the thread
  // and break the join with the gutter's own two pieces.
  const anchor = Animated.multiply(
    Animated.subtract(1, grow),
    LINE_X - NOTCH_SVG_W / 2,
  );
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
    // Positioned so the surface's LINE_X lands on the thread's centre. The
    // stroke is the thread's own width, so it covers exactly the same points
    // the gutter's straight segments do and the three read as one line.
    left: THREAD_CX - LINE_X,
    top: 0,
    width: NOTCH_SVG_W,
    height: NOTCH_SPAN,
  };

  return (
    // The mark NEVER moves: its y is `top` and nothing else. Scrolling scrubs
    // the timeline past it, so it is the one still thing on the screen and the
    // gutter's gap always has exactly the swerve in it. (An attraction that
    // shifted it toward nearby card centres was tried and pulled — see the
    // note at the head of TasksScreen.)
    <View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left: 0,
          right: 0,
          top: top - NOTCH_SPAN / 2,
          height: NOTCH_SPAN,
          // The box is the SWERVE's window; the reading and its offset word are
          // annotations hung off it, and the word below a past reading sits a
          // little proud of the foot. Stated rather than assumed: this must
          // never become a clip, or the word loses its descenders.
          overflow: 'visible',
        },
        style,
      ]}
    >
      {/* How far from today, annotating the reading from the side that says
          which way: above it for anything ahead, below it for anything past.
          Absolute rather than a third line in the column below, so the reading
          itself stays centred on the notch whether or not there is a word —
          the mark points at the same place either way. */}
      {offsetWord ? (
        <Animated.View
          style={{
            position: 'absolute',
            left: 0,
            // Measured off the READING, not off the window's edges, and off
            // the reading at its tallest — so the word holds still whether or
            // not the row under the mark happens to have an hour, exactly as
            // the date above it does.
            top: offsetIsPast
              ? READOUT_FOOT + OFFSET_GAP
              : READOUT_DAY_TOP - OFFSET_GAP - OFFSET_LINE_H,
            // Clears the swerve on the same line the reading does.
            width: RAIL_ABS_X - NOTCH_MAX_REACH - READOUT_GAP,
            paddingLeft: ROW_PAD,
            alignItems: 'flex-start',
            // Rides the reading's own fade in and out — it is part of the
            // reading, not a label on the band.
            opacity: open.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
            transform: [{ translateX: open.interpolate({ inputRange: [0, 1], outputRange: [-5, 0] }) }],
          }}
        >
          {/* One line, always. The column is too narrow to survive a wrap, and
              an ellipsis is a far better failure than a stranded letter. */}
          <Text testID="pointer-offset" numberOfLines={1} style={offsetLine}>
            {offsetWord}
          </Text>
        </Animated.View>
      ) : null}

      {/* The readout — transparent, no chip behind it, and LEFT-aligned on the
          band exactly like the rows' own times. It used to be right-justified
          hard into the notch, which meant its start moved with its length:
          "Today" began in the middle of the margin and "Wed 8 Oct · 12:30 PM"
          began at the edge, so the thing you read while scrubbing never sat
          still. Anchored left, every label starts on the same x and the notch
          is simply what it stops short of. */}
      <Animated.View
        style={{
          position: 'absolute',
          left: 0,
          // Stops clear of the swerve at its FULLEST — measured from the line
          // the swerve belongs to, and against the deepest the tip ever
          // travels, so the curve never grows into the text mid-scrub.
          width: RAIL_ABS_X - NOTCH_MAX_REACH - READOUT_GAP,
          height: NOTCH_SPAN,
          // The rows' own left margin, so the readout and the times it stands
          // in for share one left edge.
          paddingLeft: ROW_PAD,
          // The DAY sits on the notch, and the hour hangs below it — NOT the
          // block centred as a whole. See READOUT_DAY_TOP: centring the block
          // moved the date by half a line every time a timed row passed under
          // the mark, so the one thing the notch points at was the one thing
          // that would not hold still.
          paddingTop: READOUT_DAY_TOP,
          alignItems: 'flex-start',
          justifyContent: 'flex-start',
          // The mirror of the rows' fade: the readout takes the margin over as
          // they give it up. Clamped because `open` is a spring and overshoots.
          opacity: open.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
          transform: [{ translateX: open.interpolate({ inputRange: [0, 1], outputRange: [-5, 0] }) }],
        }}
      >
        {/* TWO lines, by structure rather than by wrapping: the date reads on
            the first, the hour on the second. It used to be one string,
            "Sep 28 · 9 PM", left to wrap wherever it ran out of column — so
            where the break landed depended on how long the date happened to
            be, and the hour sometimes shared a line with it and sometimes did
            not. Two Texts put the break in the same place every time.

            Neither shrinks: `adjustsFontSizeToFit` once made a long readout
            render smaller than a short one, so the one thing you are actually
            reading changed size while you read it. The size is fixed and the
            lines are what give way. */}
        {/* Each line in TWO weights: the part that identifies it heavy, the
            part that qualifies it light. The month and the hour are what you
            steer by; the day-number and the meridiem narrow them. */}
        <Text testID="pointer-day" style={readoutLine}>
          <Text style={{ fontWeight: READOUT_HEAVY }}>{dayParts.lead}</Text>
          {dayParts.tail ? <Text style={{ fontWeight: READOUT_LIGHT }}>{` ${dayParts.tail}`}</Text> : null}
        </Text>
        {/* The hour, a shade quieter than the date above it. The date is what
            you are steering by while you scrub; the hour is the detail you
            read once you have arrived. */}
        {time ? (
          <Text testID="pointer-time" style={[readoutLine, { opacity: READOUT_TIME_OPACITY }]}>
            {/* An event's line is light THROUGHOUT. The two weights exist to
                separate an hour from its meridiem; a kind has no such split,
                and bolding "Ev" would read as a bug rather than a hierarchy. */}
            <Text style={{ fontWeight: isEventReading ? READOUT_LIGHT : READOUT_HEAVY }}>
              {timeParts.lead}
            </Text>
            {timeParts.tail ? <Text style={{ fontWeight: READOUT_LIGHT }}>{` ${timeParts.tail}`}</Text> : null}
          </Text>
        ) : null}
      </Animated.View>

      {/* The line, swerving. One stroke in the thread's own colour and width,
          bridging the gap TimelineGutter leaves for it — so what you see is a
          single continuous line that happens to detour, not a mark laid over
          one. Nothing is filled, so there is no flat colour to mismatch the
          page and nothing that depends on which page you are on. */}
      <Animated.View style={[notchLayer, cut]} pointerEvents="none">
        <Svg width={NOTCH_SVG_W} height={NOTCH_SPAN}>
          {/* The bay first, so the line is drawn ON its edge rather than
              under it — the fill would otherwise eat the stroke's inner half
              and the swerve would render a half-width line. */}
          {notchFill(theme) ? <Path d={notchBayD()} fill={notchFill(theme)} /> : null}
          <Path
            d={notchLineD()}
            fill="none"
            stroke={threadColor(theme)}
            strokeWidth={RAIL_W}
            strokeLinecap="butt"
          />
        </Svg>
      </Animated.View>

      {/* The swerve catching the light as it opens — the same curve again, a
          touch brighter, faded in by its own layer so the highlight rides the
          native driver alongside the transform. Only the curve, never the
          straight run: a brighter straight segment would show as a seam where
          it meets the gutter's. */}
      <Animated.View style={[notchLayer, cut, { opacity: rim }]} pointerEvents="none">
        <Svg width={NOTCH_SVG_W} height={NOTCH_SPAN}>
          <Path
            d={notchProfileD()}
            fill="none"
            stroke={notchRim(theme)}
            strokeWidth={RAIL_W}
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
// `active`: this is the row the pointer's mark is currently sitting on. It
// states itself a little harder while every other row settles back — see
// `scrubDim`. Defaults false, so the call sites that don't track a mark are
// unaffected and never dim.
export const TimelineTaskRow = ({ item, onPress, onLongPress, onToggleComplete, onPressTime, isFirst, isLast, hideDate, done, doneDate, hideCountdown, railColor, boardColor, uniform, whenLabelFallback = 'No date', trailing, hatchColor, owner, onOwnerPress, active = false }) => {
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
  // ── Standing clear of the dim ─────────────────────────────────────────────
  // How far this row has lifted out of the shared settle-back: 0 = riding it
  // with everything else, 1 = the mark is on me, exempt. It is a VALUE, not a
  // branch — see `rowDimNode` for why that distinction is the bug fix.
  const lift = useRef(new Animated.Value(active ? 1 : 0)).current;
  useEffect(() => {
    // Forward faster than back: the row you have just arrived on should be lit
    // by the time your eye lands on it, and the one you have left should fall
    // away behind you rather than snap off. The old form had no transition to
    // tune — it could only jump.
    const a = Animated.timing(lift, {
      toValue: active ? 1 : 0,
      duration: active ? 150 : 240,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    a.start();
    return () => a.stop();
  }, [active, lift]);
  // Memoised on `lift` alone. A fresh node every render would hand the view a
  // different animated node each time, which is the same hazard as swapping
  // for a literal: the driver would be made to let go and take hold again on
  // every frame of the list.
  const rowOpacity = useMemo(() => rowDimNode(lift), [lift]);

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
        style={{
          fontSize: 15,
          // The row under the mark states itself a little harder. Weight only
          // — no size change, because a title that grew would reflow the card
          // and shove the rest of the list as you scrub past it.
          fontWeight: active ? '800' : '600',
          color: cText,
          textDecorationLine: completed ? 'line-through' : 'none',
        }}
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
    // The card settles back while a scrub passes over OTHER rows, and stays
    // full while the mark is on this one. `active` is a prop and the dim is a
    // shared value: the flag changes once per row you pass, the value animates
    // natively, and neither costs a re-render per frame. The two are COMBINED
    // rather than chosen between — see `rowOpacity`.
    <Animated.View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: ROW_GAP,
        paddingHorizontal: 14,
        opacity: rowOpacity,
      }}
    >
      {/* The ruler's graduation for this row — see RULER_TICK_W. At the row's
          TOP, so it lands level with the head of the card beside it.

          `left: 0` is the SCREEN's edge, not the row's padding box: an
          absolutely-positioned child measures from its parent's BORDER box in
          Yoga, and this row carries 14pt of horizontal padding that the tick
          must not inherit (the same rule the thread's x depends on, see
          RAIL_ABS_X). Inside the box at top 0 rather than centred in the gap
          above, which would put it outside the row's bounds and at the mercy
          of a parent's clipping.

          Not faded by `scrubFade` like the times are: the times step aside for
          the pointer's readout because they are CONTENT competing for the same
          margin, and the ruler is not — it is the structure they are printed
          on, and a ruler that disappears while you scrub is a ruler exactly
          when you are measuring. `isFirst` gets none: a graduation above the
          first card would rule off the band header, not a pair of cards. */}
      {!isFirst && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: RULER_TICK_W,
            height: StyleSheet.hairlineWidth,
            backgroundColor: rulerTickColor(),
          }}
        />
      )}

      {/* No thread segment here any more. The row used to draw its own piece
          of the line, from its top to just past its bottom, so consecutive
          rows joined seamlessly — but only rows drew it, so the line broke at
          every header and stopped at the last row instead of running to the
          bottom of the screen. TimelineGutter draws the whole thread in one
          piece now, and it has to be the only thing that draws it: two
          60%-alpha lines stacked composite to ~84%, which would print a
          darker line on every row than in the gaps between them. */}
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
              ...gutterGlow(completed),
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
    </Animated.View>
  );
};
