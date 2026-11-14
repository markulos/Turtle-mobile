/**
 * keyboardMotion — the one way anything in the app moves with the keyboard.
 *
 * WHY THIS EXISTS. Three techniques grew up side by side, and only one of them
 * was actually in step with the keyboard:
 *
 *   1. A timed guess — listen for `keyboardWillShow`, then run an
 *      `Animated.timing` with the reported duration and a bezier that
 *      approximates the keyboard's curve. The iOS keyboard is a spring, not a
 *      bezier, so the bar leads at one end of the trip and trails at the other.
 *   2. A state snap — put the keyboard height in React state and let layout
 *      (`marginBottom`, `paddingBottom`) take it. The bar is at its final
 *      position on the first frame while the keyboard is still on its way.
 *   3. Reanimated's `useAnimatedKeyboard` — per frame, on the UI thread. Right
 *      idea, but it reads where the keyboard WAS (a frame late), cannot see a
 *      keyboard from inside a `<Modal>`, and is deprecated in Reanimated 4 in
 *      favour of the library below.
 *
 * This file reads the keyboard from `react-native-keyboard-controller` (in the
 * native build since build 4; `KeyboardProvider` wraps the app in App.js). Its
 * native side reports the keyboard's position every frame on the UI thread,
 * for every window including modals, and during an interactive drag.
 *
 * THE RULE. Nothing times its own animation against the keyboard and nothing
 * snaps on a keyboard event. A view that should rise takes its transform from
 * here, so it is where the keyboard is on every frame of the trip, both ways.
 *
 *   Reanimated view      useKeyboardLiftStyle({ rest, gap })      → animated style
 *   RN Animated view     useKeyboardLiftAnimated({ rest, gap })   → translateY node
 *   your own worklet     useKeyboardFrame() + keyboardLift(...)   → shared values
 *
 * `rest` is how far the view already sits above the bottom of the screen with
 * the keyboard down (a safe-area pad, the tab dock's clearance). `gap` is the
 * air it should keep above the keyboard once it is up.
 */
import { useLayoutEffect, useMemo } from 'react';
import { Animated } from 'react-native';
import { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import {
  useKeyboardAnimation,
  useKeyboardContext,
  useKeyboardHandler,
} from 'react-native-keyboard-controller';

/** The air a bar keeps above the keyboard unless a surface asks for its own. */
export const KEYBOARD_GAP = 8;

/**
 * How far a bar has risen, given where the keyboard is right now.
 *
 * A GLIDE, not a catch. The bar could stand still until the keyboard's top
 * edge reaches it and then be shoved the rest of the way — but the keyboard is
 * at full speed by then, so the bar starts with a jolt and, on the way down,
 * stops dead while the keyboard carries on beneath it. Instead the bar leaves
 * with the keyboard's first frame and covers its own (shorter) distance on the
 * keyboard's own curve, so the two arrive together and the space between them
 * closes smoothly from `rest` to `gap`. It can never be overlapped on the way:
 * the bar's clearance at progress p is rest·(1−p) + gap·p, which is never
 * negative.
 *
 *   height    the keyboard's current height, 0 when down
 *   progress  0 (down) → 1 (fully up)
 *
 * Worklet-safe: it is called from UI-thread worklets, and a plain function
 * there crashes a release build.
 */
export function keyboardLift(height, progress, rest = 0, gap = 0) {
  'worklet';
  const lift = height + (gap - rest) * progress;
  return lift > 0 ? lift : 0;
}

/**
 * The keyboard's live position as shared values: `height` in points (0 when
 * down, positive when up) and `progress` 0→1. Updated on the UI thread every
 * frame the keyboard moves — opening, closing, changing size, being dragged.
 */
export function useKeyboardFrame() {
  const { reanimated } = useKeyboardContext();
  const height = useSharedValue(0);
  const progress = useSharedValue(0);

  // Mounted with the keyboard already up — a sheet opened over a focused field.
  // The provider's own value is negative-up; ours is positive-up.
  useLayoutEffect(() => {
    const open = -(reanimated?.height?.value || 0);
    height.value = open > 0 ? open : 0;
    progress.value = reanimated?.progress?.value || 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useKeyboardHandler(
    {
      onMove: (e) => {
        'worklet';
        height.value = e.height;
        progress.value = e.progress;
      },
      onInteractive: (e) => {
        'worklet';
        height.value = e.height;
        progress.value = e.progress;
      },
      onEnd: (e) => {
        'worklet';
        height.value = e.height;
        progress.value = e.progress;
      },
    },
    [],
  );

  return useMemo(() => ({ height, progress }), [height, progress]);
}

/**
 * The style that lifts a pinned bar (a composer, a Save bar, a sheet) with the
 * keyboard. Spread it into a `Reanimated.View`'s style array. A transform, so
 * nothing is laid out again while the keyboard moves.
 */
export function useKeyboardLiftStyle({ rest = 0, gap = 0, enabled = true } = {}) {
  const keyboard = useKeyboardFrame();
  return useAnimatedStyle(() => {
    const lift = enabled
      ? keyboardLift(keyboard.height.value, keyboard.progress.value, rest, gap)
      : 0;
    return { transform: [{ translateY: -lift }] };
  }, [rest, gap, enabled]);
}

const STILL = new Animated.Value(0);
const FAR = 4000;

/**
 * The same lift for a view built on React Native's own `Animated` — a
 * `translateY` node, driven natively, never touching JS:
 *
 *   <Animated.View style={{ transform: [{ translateY: lift }] }} />
 *
 * Same glide as `keyboardLift`, written as Animated arithmetic.
 */
export function useKeyboardLiftAnimated({ rest = 0, gap = 0, enabled = true } = {}) {
  const { height, progress } = useKeyboardAnimation();
  return useMemo(() => {
    if (!enabled) return STILL;
    const shortfall = rest - gap;
    // `height` is 0 → −keyboardHeight, which is already a translateY.
    const raw = shortfall
      ? Animated.add(height, Animated.multiply(progress, shortfall))
      : height;
    // Never below rest: a keyboard shorter than the bar's own clearance (a
    // hardware keyboard's shortcut strip) must not push the bar DOWN.
    return raw.interpolate({
      inputRange: [-FAR, 0],
      outputRange: [-FAR, 0],
      extrapolate: 'clamp',
    });
  }, [height, progress, rest, gap, enabled]);
}
