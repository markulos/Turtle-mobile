/**
 * Shared haptic feedback — the single source of truth for tactile button
 * response across the app. Extracted from the per-file `tapHaptic` / `hapticTick`
 * copies that had grown up independently in TaskItem, MediaGallery and
 * WheelTimePicker so every action button can fire the SAME instant confirmation.
 *
 * Why this matters for responsiveness: firing a haptic the moment a finger
 * touches an action button (on `onPressIn`, not `onPress`) makes the button feel
 * like it reacted instantly — the action reads as "done" before the optimistic
 * state update and the background save have even started. It's the cheapest,
 * highest-impact way to make every button feel snappy.
 *
 * …BUT ONLY FOR A TOUCH THAT IS JUST A TOUCH. A finger on the screen is doing
 * one of two things, and they want opposite feedback: a TAP wants the instant
 * buzz above, and a GESTURE — a scroll, a swipe, a drag, a pinch — wants
 * nothing at all. A scroll that ticks as it passes each row is a scroll that
 * feels like a hundred mis-taps. This is the haptic half of the app-wide
 * "A TAP IS NOT A GESTURE" rule (docs/STYLE-RULES.md §3, `utils/pressBehavior`),
 * and it is enforced HERE rather than at the call site because there are ~200
 * press-in haptics across the app and a rule that has to be remembered 200
 * times is a rule that is already broken somewhere.
 *
 * See `markGesture` below for how the gate learns that a finger is moving, and
 * note the two feedbacks that are deliberately EXEMPT: `selectionHaptic`, whose
 * whole job is to tick during a movement, and `notifyHaptic`, which reports an
 * OUTCOME (a save landed, a block finished) rather than a touch.
 *
 * Defensive everywhere:
 *   - `expo-haptics` is loaded via require() so a dev build that somehow lacks
 *     the native module degrades to React Native's built-in Vibration instead of
 *     throwing.
 *   - Every call is wrapped — haptics are garnish; they must NEVER break an
 *     actual action. A failed buzz is silently swallowed.
 */
import { Vibration } from 'react-native';

let _Haptics = null;
try { _Haptics = require('expo-haptics'); } catch (e) { _Haptics = null; }

// ── The gesture gate ────────────────────────────────────────────────────────
//
// How long after the last movement a touch stops counting as part of a gesture.
//
// A DECAYING WINDOW rather than a begin/end pair, and that is the important
// choice: paired calls leak. Miss one `endGesture` — a scroll interrupted by a
// navigation, a pan cancelled by the OS, a component unmounted mid-drag — and
// the app is silently haptic-dead until something else happens to close it. A
// window that expires on its own has no such state to strand: the worst a
// missed call can do is keep the gate shut for one more beat.
//
// 150ms is comfortably longer than the ~16ms between scroll frames, so the gate
// stays shut for the whole of a scroll and through its momentum, and short
// enough that a tap made deliberately after one still buzzes. Tapping to ARREST
// a moving list falls inside the window and stays silent, which is right: that
// touch is a gesture — it is doing something to the scroll.
const GESTURE_QUIET_MS = 150;

let movingUntil = 0;

/**
 * Report that the finger is MOVING — a scroll frame, a pan, a drag past the tap
 * slop. Cheap enough to call on every frame of a scroll, which is how it is
 * meant to be used: call it freely, never pair it with anything.
 *
 * `utils/pressBehavior`'s `useTapOnly` calls this for you the moment a touch
 * travels beyond the tap slop, so every control that already spreads it is
 * covered. A scrolling surface should call it from `onScroll`.
 */
export const markGesture = () => { movingUntil = Date.now() + GESTURE_QUIET_MS; };

/** Is a gesture in flight right now? True → touch feedback must stay quiet. */
export const gestureInFlight = () => Date.now() < movingUntil;

/** Test seam: forget that anything was ever moving. */
export const __resetGestureGate = () => { movingUntil = 0; };

// Light tap — the default for taps, toggles, chips, list rows, day cells, the
// tab bar. Uses the SOFT impact: iOS's gentlest, most CUSHIONED haptic, which
// reads as a rounded, gradual "give" rather than the crisp selectionAsync tick
// (that one felt too sharp + short). selectionAsync is the fallback for a build
// whose expo-haptics lacks the Soft style; Vibration is the last resort.
export const tapHaptic = () => {
  // A tap under a moving finger is not a tap. See the gate above.
  if (gestureInFlight()) return;
  try {
    if (_Haptics?.impactAsync && _Haptics?.ImpactFeedbackStyle?.Soft != null) {
      _Haptics.impactAsync(_Haptics.ImpactFeedbackStyle.Soft);
      return;
    }
    if (_Haptics?.selectionAsync) { _Haptics.selectionAsync(); return; }
  } catch (e) { /* native module absent — fall through to Vibration */ }
  // Android's basic Vibration is fixed-amplitude, so "smooth" isn't achievable
  // here — keep it a single very-short buzz (softest the API allows).
  try { Vibration.vibrate(6); } catch (e) { /* no vibrator — ignore */ }
};

// Scrub tick — the crisp, shortest SELECTION click, for crossing a boundary
// while a finger is already moving: the agenda's day markers as the timeline
// scrolls past the pointer. EXEMPT from the gesture gate, and it is the one
// feedback that has to be: it is not feedback for a touch, it is feedback for
// the MOVEMENT itself, so the very condition that silences a tap is the
// condition under which this is supposed to fire.
// Deliberately NOT tapHaptic — a soft cushioned
// impact is tuned to fire once per tap, and repeated every few hundred
// milliseconds during a scroll it smears into a rumble, where the selection
// tick stays legible as separate ticks.
export const selectionHaptic = () => {
  try {
    if (_Haptics?.selectionAsync) { _Haptics.selectionAsync(); return; }
    if (_Haptics?.impactAsync && _Haptics?.ImpactFeedbackStyle?.Light != null) {
      _Haptics.impactAsync(_Haptics.ImpactFeedbackStyle.Light);
      return;
    }
  } catch (e) { /* native module absent — fall through to Vibration */ }
  // Shorter than tapHaptic's 6ms: this one repeats, so it has to stay light.
  try { Vibration.vibrate(4); } catch (e) { /* no vibrator — ignore */ }
};

// Impact thump — for weightier primary actions (save, send, unlock, FAB).
// `style` ∈ 'light' | 'medium' | 'heavy'.
export const impactHaptic = (style = 'light') => {
  // Gated with the tap: this is still feedback for a TOUCH, and a heavier thump
  // fired mid-swipe is a worse mis-tap than a light one, not a better one.
  if (gestureInFlight()) return;
  try {
    const map = {
      light: _Haptics?.ImpactFeedbackStyle?.Light,
      medium: _Haptics?.ImpactFeedbackStyle?.Medium,
      heavy: _Haptics?.ImpactFeedbackStyle?.Heavy,
    };
    if (_Haptics?.impactAsync) { _Haptics.impactAsync(map[style] ?? map.light); return; }
  } catch (e) { /* fall through */ }
  try { Vibration.vibrate(style === 'heavy' ? 20 : style === 'medium' ? 14 : 10); } catch (e) {}
};

// Notification buzz — success / warning / error outcomes (vault unlocked,
// invite sent, delete confirmed). `type` ∈ 'success' | 'warning' | 'error'.
// Also EXEMPT: this reports what HAPPENED, not what a finger did, and an
// outcome that lands while you happen to be scrolling still has to announce
// itself — a focus block finishing mid-scroll is the obvious case.
export const notifyHaptic = (type = 'success') => {
  try {
    const map = {
      success: _Haptics?.NotificationFeedbackType?.Success,
      warning: _Haptics?.NotificationFeedbackType?.Warning,
      error: _Haptics?.NotificationFeedbackType?.Error,
    };
    if (_Haptics?.notificationAsync) { _Haptics.notificationAsync(map[type] ?? map.success); return; }
  } catch (e) { /* fall through */ }
  try { Vibration.vibrate(type === 'error' ? [0, 30, 40, 30] : 16); } catch (e) {}
};
