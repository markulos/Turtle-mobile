import { useMemo } from 'react';
import { runOnJS, useFrameCallback, useSharedValue } from 'react-native-reanimated';

/**
 * dockMotionProbe — what the chip's last move ACTUALLY did, measured on the
 * thread it happens on.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * The chip has been retimed five times in one afternoon (dockMotion records
 * every number and the reasoning behind it) and it is still not right on the
 * phone. Every one of those changes was judged by eye, and an eye cannot tell
 * the two failures apart:
 *
 *   LATE   the chip is smooth, but it does not leave until well after the
 *          touch. Nothing is dropping frames; the aim arrived late. On a tap
 *          the aim comes from the `tabPress` listener on the JS THREAD, so
 *          anything already queued there — a focus effect, a list settling,
 *          a response landing — pushes the start out.
 *
 *   CHOPPY the chip leaves on the touch frame and then loses frames on the way
 *          across, because something else owns the main thread while it
 *          travels: the arriving screen building native views, the capsule's
 *          blur resampling under a page that is turning, the press swell
 *          scaling that same blur for 200ms after the lift.
 *
 * Both read as "jumpy and laggy" and they have opposite fixes, which is why
 * tuning the curve could not converge. So this measures one number for each.
 *
 * ── What it reports ────────────────────────────────────────────────────────
 *
 *   startLateMs  touch → the frame the travel actually started on. The touch
 *                is stamped in the dock's own gesture worklet (UI thread), so
 *                this interval is NOT itself distorted by a busy JS thread —
 *                it is exactly the delay it is accusing.
 *   worstMs      the longest single frame during the travel. On a 120Hz phone
 *                a clean move is ~8ms a frame; 40 means three frames went
 *                missing in one go, which is what the eye reads as a stumble.
 *   bestMs       the shortest frame — the device's real cadence, so the
 *                numbers below mean the same thing at 60Hz and at 120Hz
 *                without being told which phone this is.
 *   drops        how many frame TIMES went by without the chip being drawn,
 *                worked out from `bestMs` rather than from a threshold — see
 *                framesMissing. A count, not a rate: one visible stumble is
 *                the complaint.
 *   pressBusy    whether the press swell was still animating during the
 *                travel. The swell scales the capsule — and the capsule is a
 *                blur view, which iOS re-renders for every frame of a
 *                transform. If `drops` is high and this is true, that overlap
 *                is the first thing to take away.
 *
 * ── Why it is not __DEV__-only ─────────────────────────────────────────────
 *
 * gestureProbe is, and that is right for it: it instruments the JS thread
 * broadly and reports into a developer panel. This is a handful of shared
 * values and a frame callback that does real work only while the chip is
 * moving — a shared-value read and a branch per frame otherwise. It has to
 * work in the OTA builds, because the phone that is wrong is Mark's, and a
 * development build is not what is on it.
 *
 * ── The clock ──────────────────────────────────────────────────────────────
 *
 * `Date.now()`, not `performance.now()`. The second one is the right tool and
 * it is NOT confirmed present on Reanimated's UI runtime — the only
 * `performance` polyfill in react-native-worklets is in its web initializer,
 * and a worklet calling something undefined is a crash on the first touch of
 * the dock in a release build (this file's neighbours carry scars from exactly
 * that). `Date.now()` is a language builtin, so it is there in any Hermes
 * runtime, and its 1ms resolution is ample for intervals judged against a
 * 60ms threshold. The per-frame DURATIONS do not use it at all: those come
 * from Reanimated's own high-resolution `timeSincePreviousFrame`.
 */

// How long after a travel starts to keep sampling: the move's own duration
// plus a tail, so a frame lost just after the chip lands (the mount arriving,
// typically) is still counted rather than falling outside the window.
const TAIL_MS = 80;

// A stamp that means "nothing has happened yet". Shared values are numbers
// here rather than null so the worklets never branch on a type.
const NONE = 0;

/**
 * The last report, and whoever wants to show it.
 *
 * A module-level store rather than context: this is written from a frame
 * callback at the end of every tab change, and putting it in context would
 * re-render the navigator's whole subtree each time — which would be a
 * profiler that causes the thing it measures.
 */
let lastReport = null;
const listeners = new Set();

export const getDockMotionReport = () => lastReport;

export const onDockMotionReport = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

const publish = (report) => {
  lastReport = report;
  listeners.forEach((fn) => {
    try {
      fn(report);
    } catch {
      // A broken readout must not take the dock down with it.
    }
  });
};

/**
 * In plain words, for the Settings readout.
 *
 * The sentence names the CAUSE, not the numbers — the numbers are there to be
 * quoted back, but the reason for the readout existing is that "started 180ms
 * after your touch" and "lost 4 frames crossing" need different work, and
 * nobody should have to remember which number meant which.
 */
export const describeDockMotion = (r) => {
  if (!r) return 'Switch tabs once and this will say how the move went.';
  const late = Math.round(r.startLateMs);
  const worst = Math.round(r.worstMs);
  // A move with no finger behind it — a deep link, the /command console — has
  // no start to be late. Reporting its -1 as a delay would be the readout
  // lying in the one direction that matters, since a late start and a choppy
  // travel send the next change in opposite directions.
  const touched = r.startLateMs >= 0;

  // LATE BEATS CHOPPY when both are true, because a chip that has not left
  // yet cannot be smoothed: the frames it is dropping are the ones it is
  // waiting through. 60ms is about four frames at 120Hz — under that a start
  // is indistinguishable from immediate, over it there is something to see.
  if (touched && late >= 60) {
    return `Left ${late}ms after your touch — the chip is waiting, not stuttering.`;
  }
  if (r.drops > 0) {
    return `Lost ${r.drops} frame${r.drops === 1 ? '' : 's'} crossing (worst ${worst}ms)`
      + `${r.pressBusy ? ', with the press still scaling the glass' : ''}.`;
  }
  return touched
    ? `Clean: left ${late}ms after the touch, no frames lost.`
    : 'Clean: every frame drawn (no touch behind this one).';
};

/**
 * WHAT THE LAST DOCK TOUCH TURNED OUT TO BE — in plain words, for the readout.
 *
 * The dock decides every touch itself now (DockTabBar): a finger that lifts
 * on the dock without dragging is a tap, a drag chooses on its lift, and a
 * touch that is taken away or let go off the dock changes nothing. This says
 * which of those the last one was, because "I pressed the tab and it did
 * nothing" and "I swiped up to go home" are the same touch until it ends:
 *
 *   A TAP            `tapCompleted`. The dock changed tabs. If `touchSlot` is
 *                    -1 the finger was on the dock but not on a button — the
 *                    floating gap or the home-indicator inset, where
 *                    react-navigation has nothing pressable — and the tab
 *                    change is the dock's alone.
 *   A DRAG           `panActivated`, no tap. The lift chose the tab.
 *   NEITHER          the touch was abandoned: the finger left the dock before
 *                    lifting, or the system took it (a swipe home starts
 *                    here). No tab change, by design.
 */
export const describeDockTouch = (r) => {
  if (!r) return '';
  const where = r.touchY >= 0 ? ` (${Math.round(r.touchY)}pt down the dock)` : '';
  if (r.tapCompleted) {
    return r.touchSlot < 0
      ? `Last touch missed the buttons${where} — the dock made the tab change itself.`
      : `Last touch: a tap on a tab${where} — the dock changed tabs on the lift.`;
  }
  return r.panActivated
    ? 'Last touch: a drag, and the tab change came from the lift.'
    : 'Last touch was let go off the dock, or taken by the system — no tab change.';
};

/**
 * HOW A MISSING FRAME IS COUNTED, without keeping the samples.
 *
 * The obvious way is to collect every frame's duration and compare each to the
 * median at the end — but a worklet has nowhere to keep a growing array
 * between frames, and writing one back into a shared value allocates on every
 * frame of the animation being measured.
 *
 * So it is done by arithmetic instead. The shortest frame in the window IS the
 * device's cadence (8.3ms at 120Hz, 16.7ms at 60Hz — no need to be told which
 * phone this is). A clean move of `elapsed` ms should therefore have delivered
 * `elapsed / best` frames; whatever is missing from that is how many frame
 * times the chip spent not being drawn.
 *
 * That counts a stumble the way it is seen — six frames missing in one hitch
 * and six single missed frames both come out as six — and `worstMs` beside it
 * says which of the two it was.
 *
 * A WORKLET, and that is not optional. This is called from inside the frame
 * callback below — on the UI thread, to build the report at the end of the
 * window — and without the directive it reaches that runtime as a plain
 * function, which throws "[Worklets] Tried to synchronously call a non-worklet
 * function on the UI thread." In a release build that throw is fatal: the app
 * died a fifth of a second after the first tab change, which is to say the
 * probe added to diagnose the dock's lag was what was killing the app. The
 * directive does not take the JS caller away — the tests below still call it
 * directly.
 */
export const framesMissing = (elapsedMs, bestMs, frames) => {
  'worklet';
  if (!(bestMs > 0) || !(elapsedMs > 0)) return 0;
  return Math.max(0, Math.round(elapsedMs / bestMs) - frames);
};

/**
 * The probe's state, and the frame callback that fills it in.
 *
 * Returns shared values rather than functions ON PURPOSE. The two places that
 * have to write them — the dock's gesture (a touch landing) and the chip's
 * reaction (a travel starting) — are ALREADY worklets, so they can write a
 * shared value directly. Handing them a worklet to call instead would mean
 * building worklets out of hooks and hoping the right thing was captured,
 * which is the trap dockMotion and tabBarLayout both carry warnings about.
 * `armTravel` below is therefore a comment, not a function: three lines in
 * TabBarPill's reaction.
 *
 * ── Why the frame callback is always on ────────────────────────────────────
 *
 * It could be switched on per move, but only from the JS thread
 * (`setActive`), which would put a JS hop at the exact instant being measured
 * and make the first frames of every move unobservable. Left running, it costs
 * one shared-value read and a branch per frame — and in exchange the window
 * starts on the travel's own first frame.
 */
export function useDockMotionProbe(slideMs, pressLift) {
  // Stamped by the dock's gesture the moment a finger lands — on the UI
  // thread, which is what makes `startLateMs` an honest measure of a JS-thread
  // delay rather than another victim of one.
  const touchAt = useSharedValue(NONE);
  const startedAt = useSharedValue(NONE);
  const startLate = useSharedValue(0);
  const sampling = useSharedValue(0);
  const frames = useSharedValue(0);
  const worst = useSharedValue(0);
  const best = useSharedValue(0);
  const pressBusy = useSharedValue(0);
  // ── WHAT HAPPENED TO THE LAST DOCK TOUCH ───────────────────────────────
  //
  // Separate from the travel numbers above, and for a separate question: a
  // tap that does not change tabs. There are two ways for a dock touch to
  // produce no `tabPress`, they look identical from the outside, and they
  // want different fixes — so the dock records which one it was instead of
  // anybody inferring it from the code a third time.
  const touchSlot = useSharedValue(-1);
  const touchY = useSharedValue(-1);
  const panActivated = useSharedValue(0);
  const tapCompleted = useSharedValue(0);

  useFrameCallback((info) => {
    'worklet';
    if (!sampling.value) return;

    const dt = info.timeSincePreviousFrame;
    if (dt != null && dt > 0) {
      frames.value += 1;
      if (dt > worst.value) worst.value = dt;
      if (best.value === 0 || dt < best.value) best.value = dt;
    }
    // The press swell and the travel overlap on every tap — the lift releases
    // the swell at the same moment the chip is given its aim. Recorded as a
    // fact about this move rather than assumed, because the swell scales the
    // capsule and the capsule is a blur view.
    if (pressLift && pressLift.value > 0 && pressLift.value < 1) pressBusy.value = 1;

    const elapsed = Date.now() - startedAt.value;
    if (elapsed < slideMs.value + TAIL_MS) return;

    // Window over: report once, from the UI thread, and go quiet until the
    // next travel arms it.
    sampling.value = 0;
    runOnJS(publish)({
      startLateMs: startLate.value,
      worstMs: worst.value,
      bestMs: best.value,
      frames: frames.value,
      drops: framesMissing(elapsed, best.value, frames.value),
      pressBusy: pressBusy.value === 1,
      travelMs: slideMs.value,
      touchSlot: touchSlot.value,
      touchY: touchY.value,
      panActivated: panActivated.value === 1,
      tapCompleted: tapCompleted.value === 1,
    });
  }, true);

  // ONE OBJECT, FOR THE LIFE OF THE DOCK.
  //
  // The shared values inside are stable whatever this returns, so it would be
  // easy to read this memo as tidiness. It is not. DockTabBar lists `probe` in
  // the dependencies of the useMemo that BUILDS ITS PAN GESTURE, so a fresh
  // object here is a fresh Gesture handed to GestureDetector, which drops the
  // native handler and attaches a new one — main-thread work, on a re-render
  // that can land while a thumb is still down on the capsule. The note above
  // `stateRef` in DockTabBar spells out the same hazard for `state`; an object
  // literal in this hook's body had quietly reintroduced it.
  return useMemo(() => ({
    touchAt, startedAt, startLate, sampling, frames, worst, best, pressBusy,
    touchSlot, touchY, panActivated, tapCompleted,
  }), [touchAt, startedAt, startLate, sampling, frames, worst, best, pressBusy,
    touchSlot, touchY, panActivated, tapCompleted]);
}

export default useDockMotionProbe;
