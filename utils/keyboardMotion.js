/**
 * keyboardMotion — the one way anything in the app moves with the keyboard.
 *
 * WHY THIS EXISTS. Four techniques grew up side by side:
 *
 *   1. A timed guess — listen for `keyboardWillShow` in JS, then run an
 *      `Animated.timing` with the reported duration and a bezier that
 *      approximates the keyboard's curve. Wrong curve, and it starts whenever
 *      the JS thread gets round to it.
 *   2. A state snap — put the keyboard height in React state and let layout
 *      (`marginBottom`, `paddingBottom`) take it. The bar is at its final
 *      position on the first frame while the keyboard is still on its way.
 *   3. Reanimated's `useAnimatedKeyboard` — per frame, on the UI thread, but
 *      it reads where the keyboard WAS (a frame late), cannot see a keyboard
 *      from inside a `<Modal>`, and is deprecated in Reanimated 4.
 *   4. Following `react-native-keyboard-controller` frame by frame. Closer,
 *      but still a view chasing the keyboard: every frame it is told where the
 *      keyboard got to, and moves there one frame afterwards.
 *
 * WHAT IT DOES NOW (2026-11-19). Nothing chases the keyboard. On iOS the
 * keyboard moves on one known spring; the native side says WHEN it starts and
 * WHERE it is going, and this file starts the SAME spring at the same instant,
 * on the UI thread. Two things on one curve arrive together without either
 * watching the other. The three ways were put side by side on the phone
 * (the keyboard test panel, c3daf1b) and this is the one the owner picked.
 *
 * Android has no such spring to copy, so there the keyboard is followed frame
 * by frame, as before. A finger dragging the keyboard is followed on both.
 *
 * THE RULE. Nothing times its own animation against the keyboard, nothing
 * snaps on a keyboard event, and nothing reads the keyboard any other way.
 *
 *   Reanimated view      useKeyboardLiftStyle({ rest, gap })      → animated style
 *   your own worklet     useKeyboardFrame() + keyboardLift(...)   → shared values
 *
 * `rest` is how far the view already sits above the bottom of the screen with
 * the keyboard down (a safe-area pad, the tab dock's clearance). `gap` is the
 * air it should keep above the keyboard once it is up.
 */
import { useLayoutEffect, useMemo } from 'react';
import { Platform } from 'react-native';
import { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useKeyboardContext, useKeyboardHandler } from 'react-native-keyboard-controller';

const IS_IOS = Platform.OS === 'ios';

/** The air a bar keeps above the keyboard unless a surface asks for its own. */
export const KEYBOARD_GAP = 8;

/**
 * The spring iOS moves its keyboard on: mass 3, stiffness 1000, damping 500
 * (what UIKit hands back as animation curve 7). Critically damped, so it never
 * overshoots; the clamp only stops the last half point from wobbling.
 */
export const IOS_KEYBOARD_SPRING = { mass: 3, stiffness: 1000, damping: 500, overshootClamping: true };

/**
 * How far a bar has risen, given where the keyboard is right now.
 *
 * PUSHED BY THE KEYBOARD'S EDGE. The bar stays where it rests until the
 * keyboard's top edge (plus `gap`) reaches it, and from then on it sits
 * exactly `gap` above that edge on every frame — one object carried by
 * another. This is the main Turtle chat's motion, and the one the owner
 * called right; every surface gets the same one.
 *
 * A proportional glide was tried first (leave on the keyboard's first frame,
 * cover a shorter distance on the same curve, arrive together). On a bar that
 * rests well above the bottom — the friend chat's composer, clear of the tab
 * dock — it read as TWO motions: the composer setting off on its own, then
 * the keyboard arriving under it. Do not bring it back.
 *
 *   height    the keyboard's current height, 0 when down
 *   progress  0 (down) → 1 (fully up)
 *
 * `progress` only matters when `gap` is larger than `rest` (a bar flush with
 * the bottom that wants air above the keyboard): the shortfall is eased in
 * with the keyboard, because it cannot be there while the keyboard is down.
 *
 * Worklet-safe: it is called from UI-thread worklets, and a plain function
 * there crashes a release build.
 */
export function keyboardLift(height, progress, rest = 0, gap = 0) {
  'worklet';
  // How far the keyboard travels before it reaches the bar.
  const reach = rest > gap ? rest - gap : 0;
  const pushed = height > reach ? height - reach : 0;
  const extra = gap > rest ? (gap - rest) * progress : 0;
  return pushed + extra;
}

/**
 * The keyboard's position as shared values: `height` in points (0 when down,
 * positive when up) and `progress` 0→1. On the UI thread, both ways, for every
 * window including a `<Modal>`'s.
 *
 * Returns the shape `useAnimatedKeyboard()` used to (`keyboard.height.value`),
 * so a surface that read the keyboard through Reanimated changes one word.
 *
 * Every handler below is a worklet and says so. A function reaching the UI
 * runtime without the directive throws there, and in a release build that
 * throw is fatal — which jest cannot see.
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
      onStart: (e) => {
        'worklet';
        // The keyboard is about to move, and `e` is where it will END. Set
        // off on its spring now rather than be told about each frame of it.
        if (IS_IOS) {
          height.value = withSpring(e.height, IOS_KEYBOARD_SPRING);
          progress.value = withSpring(e.progress, IOS_KEYBOARD_SPRING);
        }
      },
      onMove: (e) => {
        'worklet';
        // Android has no such spring to copy; follow the keyboard there.
        if (!IS_IOS) {
          height.value = e.height;
          progress.value = e.progress;
        }
      },
      onInteractive: (e) => {
        'worklet';
        // A finger is dragging the keyboard: it is wherever the finger put it.
        height.value = e.height;
        progress.value = e.progress;
      },
      onEnd: (e) => {
        'worklet';
        // Land exactly, whatever the spring made of the last half point.
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
    'worklet';
    const lift = enabled
      ? keyboardLift(keyboard.height.value, keyboard.progress.value, rest, gap)
      : 0;
    return { transform: [{ translateY: -lift }] };
  }, [rest, gap, enabled]);
}
