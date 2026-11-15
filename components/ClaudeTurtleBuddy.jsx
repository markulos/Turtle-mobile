/**
 * ClaudeTurtleBuddy — Claude's mark, ALIVE. The same drawing as
 * ClaudeTurtleMark, taken apart into the pieces that move:
 *
 *   • he JUMPS UP from behind the ledge when a session starts — the face rises
 *     past its resting place and settles, then the hands come down on the edge;
 *   • he BLINKS, at random, sometimes twice;
 *   • he THINKS while Claude is working — the head tips up and one finger
 *     goes up beside it — and comes back to rest when the answer starts.
 *
 * HOW IT IS BUILT, and why:
 *
 * Everything that moves is a plain View moved by React Native's own Animated
 * on the NATIVE DRIVER — transforms and opacity only. There is no Reanimated
 * worklet in here on purpose: a worklet that calls an ordinary function passes
 * every test and crashes a release build (see the dock work), and nothing here
 * needs a gesture or a shared value to justify the risk. No SVG attribute is
 * animated either; the drawing is static inside each moving layer.
 *
 * Three layers, back to front:
 *   1. the FACE, inside a box that is CLIPPED AT THE LEDGE. He is behind the
 *      edge he is looking over, so whatever part of the face is below that line
 *      is not seen — which is all the "jump up from behind it" needs. The eyes
 *      are two round Views on the face (not SVG circles), so each can close
 *      about its own middle without the pair sliding down the face;
 *   2. the FINGER, behind the hands, so its base is hidden by the hand it
 *      belongs to and it can simply slide up into view;
 *   3. the HANDS, in front of the ledge — they are what is over it.
 *
 * Reduce Motion: he is simply there, at rest. No jump, no blink, and thinking
 * shows as the pose without the travel.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import {
  AccessibilityInfo, Animated, Easing, StyleSheet, View,
} from 'react-native';
import ClaudeTurtleMark, {
  CLAUDE_MARK_COLOR, eyeDots, ledgeOffset, markHeight,
} from './ClaudeTurtleMark';

/** Blink timing, in ms. A blink is fast to shut and a touch slower to open. */
export const BLINK = {
  minGap: 2200,
  maxGap: 6200,
  shut: 70,
  open: 120,
  doubleChance: 0.2,
  doubleGap: 110,
};

/** How long until the next blink. `rand` is injectable so a test can pin it. */
export function nextBlinkGap(rand = Math.random) {
  return BLINK.minGap + rand() * (BLINK.maxGap - BLINK.minGap);
}

// How far the head tips back while he thinks, and how far he overshoots the
// ledge on the way up (as a fraction of the distance he travels).
export const THINK_TILT_DEG = -8;
const JUMP_OVERSHOOT = 0.16;
// Room above the mark, inside the clip, for the overshoot and the tipped head.
const HEADROOM = 12;
// LINE DRAWING: the clip ends a hair BELOW the ledge, so the chin's outline
// still meets the rule the way it does in the still drawing.
// FILLED FACE: it ends at the TOP of the rule instead, so the rule shows under
// him — and the face shape is carried well below the ledge (FACE_DROP), so
// there is always shape to clip: when the head tips back to think, a face that
// ended at the ledge would lift one corner off it and show a wedge of page.
const CLIP_PAST_LEDGE = 0.75;
const CLIP_FILLED = -0.5;
const FACE_DROP = 40;

const FACE = ['face'];
const FINGER = ['finger'];
const HANDS = ['hands'];

export default function ClaudeTurtleBuddy({
  size = 80,
  color = CLAUDE_MARK_COLOR,
  handFill = 'none',
  faceFill = 'none',
  tilt = 0,
  thinking = false,
  testID = 'claude-turtle-buddy',
}) {
  const height = markHeight(size);
  const ledge = ledgeOffset(size);
  // From fully below the ledge (1) to his resting place (0).
  const travel = ledge + 3;
  const clipPast = faceFill !== 'none' ? CLIP_FILLED : CLIP_PAST_LEDGE;

  const rise = useRef(new Animated.Value(1)).current;
  const grab = useRef(new Animated.Value(0)).current;
  const lid = useRef(new Animated.Value(1)).current;
  const think = useRef(new Animated.Value(0)).current;
  const calm = useRef(false);      // Reduce Motion
  const thinkingRef = useRef(thinking);
  thinkingRef.current = thinking;

  const eyes = useMemo(() => eyeDots(size, tilt), [size, tilt]);

  // ── the jump, then a life of blinking ─────────────────────────────────
  useEffect(() => {
    let alive = true;
    let timer = null;
    let running = null;

    const blinkOnce = () => Animated.sequence([
      Animated.timing(lid, { toValue: 0.1, duration: BLINK.shut, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(lid, { toValue: 1, duration: BLINK.open, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]);
    const scheduleBlink = () => {
      if (!alive || calm.current) return;
      timer = setTimeout(() => {
        if (!alive) return;
        const twice = Math.random() < BLINK.doubleChance;
        running = Animated.sequence(
          twice ? [blinkOnce(), Animated.delay(BLINK.doubleGap), blinkOnce()] : [blinkOnce()],
        );
        running.start(({ finished }) => { if (finished) scheduleBlink(); });
      }, nextBlinkGap());
    };

    const jump = Animated.parallel([
      Animated.sequence([
        Animated.timing(rise, { toValue: -JUMP_OVERSHOOT, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(rise, { toValue: 0, duration: 200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
      Animated.sequence([
        Animated.delay(240),
        Animated.spring(grab, { toValue: 1, friction: 5, tension: 170, useNativeDriver: true }),
      ]),
    ]);
    jump.start(({ finished }) => { if (finished) scheduleBlink(); });

    // Reduce Motion: stop where he would have ended up, and stay still.
    const settle = (reduce) => {
      if (!alive || !reduce) return;
      calm.current = true;
      jump.stop();
      if (running) running.stop();
      if (timer) clearTimeout(timer);
      rise.setValue(0);
      grab.setValue(1);
      lid.setValue(1);
      think.setValue(thinkingRef.current ? 1 : 0);
    };
    let asked = null;
    try { asked = AccessibilityInfo.isReduceMotionEnabled && AccessibilityInfo.isReduceMotionEnabled(); } catch { asked = null; }
    if (asked && typeof asked.then === 'function') asked.then(settle, () => {});

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      jump.stop();
      if (running) running.stop();
    };
  }, [rise, grab, lid, think]);

  // ── thinking: head back, one finger up ────────────────────────────────
  useEffect(() => {
    if (calm.current) { think.setValue(thinking ? 1 : 0); return undefined; }
    const move = Animated.timing(think, {
      toValue: thinking ? 1 : 0,
      duration: thinking ? 280 : 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    move.start();
    return () => move.stop();
  }, [thinking, think]);

  const faceStyle = {
    transform: [
      { translateY: Animated.add(
        Animated.multiply(rise, travel),
        think.interpolate({ inputRange: [0, 1], outputRange: [0, -1.5] }),
      ) },
      { rotate: think.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${THINK_TILT_DEG}deg`] }) },
    ],
  };
  const handsStyle = {
    opacity: grab.interpolate({ inputRange: [0, 0.35], outputRange: [0, 1], extrapolate: 'clamp' }),
    transform: [{ translateY: grab.interpolate({ inputRange: [0, 1], outputRange: [-7, 0] }) }],
  };
  const fingerStyle = {
    opacity: think.interpolate({ inputRange: [0, 0.3], outputRange: [0, 1], extrapolate: 'clamp' }),
    transform: [{ translateY: think.interpolate({ inputRange: [0, 1], outputRange: [height * 0.3, 0] }) }],
  };

  const layer = { position: 'absolute', left: 0, top: 0, width: size, height };
  const art = { size, color, tilt };

  return (
    <View pointerEvents="none" style={{ width: size, height }} testID={testID}>
      {/* 1 — behind the ledge: nothing of the face shows below the line. */}
      <View
        testID={`${testID}-clip`}
        style={[styles.clip, { top: -HEADROOM, width: size, height: HEADROOM + ledge + clipPast }]}
      >
        <Animated.View testID={`${testID}-face`} style={[layer, { top: HEADROOM }, faceStyle]}>
          <ClaudeTurtleMark {...art} parts={FACE} faceFill={faceFill} faceDrop={FACE_DROP} testID={`${testID}-face-art`} />
          {eyes.map((e, i) => (
            <Animated.View
              // eslint-disable-next-line react/no-array-index-key
              key={i}
              testID={`${testID}-eye`}
              style={{
                position: 'absolute',
                left: e.x - e.r,
                top: e.y - e.r,
                width: e.r * 2,
                height: e.r * 2,
                borderRadius: e.r,
                backgroundColor: color,
                transform: [{ scaleY: lid }],
              }}
            />
          ))}
        </Animated.View>
      </View>
      {/* 2 — the finger, behind the hand it belongs to. */}
      <Animated.View testID={`${testID}-finger`} style={[layer, fingerStyle]}>
        <ClaudeTurtleMark {...art} parts={FINGER} handFill={handFill} testID={`${testID}-finger-art`} />
      </Animated.View>
      {/* 3 — the hands, over the ledge. */}
      <Animated.View testID={`${testID}-hands`} style={[layer, handsStyle]}>
        <ClaudeTurtleMark {...art} parts={HANDS} handFill={handFill} testID={`${testID}-hands-art`} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { position: 'absolute', left: 0, overflow: 'hidden' },
});
