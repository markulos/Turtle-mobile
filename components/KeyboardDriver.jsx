/**
 * KeyboardDriver — ONE of three ways of knowing where the keyboard is, writing
 * its height (points, positive up) into the shared value the chat is lifted by.
 *
 * Three little components rather than one hook with a switch in it, because a
 * hook cannot be called conditionally and the point of the experiment is that
 * only ONE tracker is running: with all three mounted, "the Reanimated one is
 * late" and "two trackers are fighting" would be the same measurement.
 *
 * Every handler below is a worklet and says so. A function reaching the UI
 * runtime without the directive throws there, and in a release build that
 * throw is fatal (see dockMotionProbe, which did exactly that).
 */
import React from 'react';
import { Platform } from 'react-native';
import { useAnimatedKeyboard, useAnimatedReaction, withSpring } from 'react-native-reanimated';
import { useKeyboardHandler } from 'react-native-keyboard-controller';

const IS_IOS = Platform.OS === 'ios';

/**
 * iOS moves its keyboard on a spring: mass 3, stiffness 1000, damping 500
 * (the same one UIKit hands back as animation curve 7). Started at the same
 * instant with the same spring, the chat arrives with the keyboard without
 * anybody watching the keyboard on the way.
 */
export const IOS_KEYBOARD_SPRING = { mass: 3, stiffness: 1000, damping: 500, overshootClamping: true };

/** A — Reanimated's own tracker. What the chat has always used. */
function ReanimatedDrive({ out }) {
  const keyboard = useAnimatedKeyboard();
  useAnimatedReaction(
    () => {
      'worklet';
      return keyboard.height.value;
    },
    (h) => {
      'worklet';
      out.value = h;
    },
    [out],
  );
  return null;
}

/** B — keyboard-controller's position, frame by frame. */
function ControllerDrive({ out }) {
  useKeyboardHandler(
    {
      onMove: (e) => {
        'worklet';
        out.value = e.height;
      },
      onInteractive: (e) => {
        'worklet';
        out.value = e.height;
      },
      onEnd: (e) => {
        'worklet';
        out.value = e.height;
      },
    },
    [out],
  );
  return null;
}

/** C — one spring, started when the keyboard starts. Nothing tracked per frame. */
function SpringDrive({ out }) {
  useKeyboardHandler(
    {
      onStart: (e) => {
        'worklet';
        if (IS_IOS) out.value = withSpring(e.height, IOS_KEYBOARD_SPRING);
      },
      onMove: (e) => {
        'worklet';
        // Android has no such spring to copy; follow the keyboard there.
        if (!IS_IOS) out.value = e.height;
      },
      onInteractive: (e) => {
        'worklet';
        // A finger is dragging the keyboard: it is wherever the finger put it.
        out.value = e.height;
      },
      onEnd: (e) => {
        'worklet';
        // Land exactly, whatever the spring made of the last half point.
        out.value = e.height;
      },
    },
    [out],
  );
  return null;
}

export default function KeyboardDriver({ drive, out }) {
  if (drive === 'controller') return <ControllerDrive out={out} />;
  if (drive === 'spring') return <SpringDrive out={out} />;
  return <ReanimatedDrive out={out} />;
}
