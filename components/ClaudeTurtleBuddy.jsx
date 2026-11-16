/**
 * ClaudeTurtleBuddy — Claude's mark, ALIVE. The same drawing as
 * ClaudeTurtleMark, taken apart into the pieces that move.
 *
 * WHAT HE DOES
 *   • JUMPS UP from behind the ledge when he is wanted — the face rises past
 *     its resting place and settles, then the hands come down on the edge. In
 *     a Claude session that is the moment it starts and he stays up for the
 *     whole of it. On the NOTES TO SELF header he is down until you type, and
 *     pops up over the ledge to see what you are writing (Mark, 2026-11-16).
 *     Same jump either way: `up`.
 *   • BREATHES: a slow half-point rise and fall, always.
 *   • BLINKS at random, sometimes twice.
 *   • LOOKS AROUND: every few seconds his eyes go somewhere — left, right, up
 *     — rest there a moment and come back. Now and then he tips his head a
 *     little instead, or drums a hand on the ledge.
 *   • THINKS while Claude is working: one hand comes up beside his mouth with
 *     index finger resting at the corner of it and thumb out under his chin, his head leans toward the
 *     hand, and his eyes roll up and away — the cartoon "hmm". While he holds
 *     it the finger taps and the eyes wander about up there.
 *   • READS WHAT YOU ARE WRITING: the moment you type in the composer his eyes
 *     drop to it and his head dips after them, and he holds it — no glancing
 *     about — until you stop. He is in the top corner and the line you are
 *     typing is below him, so down is where it is. (Mark, 2026-11-16: "make
 *     the svg of turtle look down slightly and tilt his head down when I start
 *     typing".)
 *
 * (The thinking pose took three goes. A lone raised finger read "like a tail";
 * a flat hand to the chin was not it either. Mark sent a reference drawing,
 * 2026-11-15: hand up, ONE FINGER TOUCHING BELOW THE MOUTH, eyes rolled up and
 * off to the side. That gesture is what this is — on our turtle, drawn our
 * way; nothing of the reference's character is in it.)
 *
 * HOW IT IS BUILT, and why
 *
 * Everything that moves is a plain View moved by React Native's own Animated
 * on the NATIVE DRIVER — transforms and opacity only. There is no Reanimated
 * worklet in here on purpose: a worklet that calls an ordinary function passes
 * every test and crashes a release build (see the dock work), and nothing here
 * needs a gesture or a shared value to justify the risk. No SVG attribute is
 * animated either; the drawing is static inside each moving layer.
 *
 * Layers, back to front:
 *   1. the FACE, inside a box CLIPPED AT THE LEDGE — he is behind the edge he
 *      is looking over, so whatever of the face is below that line is not
 *      seen, which is all "jumps up from behind it" needs. The eyes are two
 *      round Views on the face (not SVG circles), so each can close about its
 *      own middle and both can slide to look somewhere;
 *   2. the LEFT hand, which stays on the ledge;
 *   3. the RIGHT hand at rest — and, in the same place in the stack,
 *   4. the right hand POINTING. A hand cannot change shape under a transform,
 *      so the two cross-fade while both travel between the ledge and the
 *      mouth: it reads as one hand lifting and closing to a point.
 *
 * Reduce Motion: he is simply there. No jump, no blink, no looking about;
 * thinking shows as the pose, without the travel.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo, Animated, Easing, StyleSheet, View,
} from 'react-native';
import ClaudeTurtleMark, {
  CLAUDE_MARK_COLOR, CLAUDE_POINT_AT, artPoint, artUnit, eyeDots, ledgeOffset, markHeight,
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

/**
 * Where the eyes may go, in the drawing's own units (the eyes are about 6
 * across, so these are small: a glance, not a stare). Idle glances go level or
 * a little up; nobody looks at their own hands for long.
 */
export const GLANCES = [[-6, 0], [6, 0], [-5, -3], [5, -3], [0, -4], [-4, 2], [4, 2]];
/** While thinking: up and AWAY from the hand at his mouth, and near there. */
export const THINK_GAZE = [-5, -5];
export const THINK_DRIFT = [[-2, -6], [-6, -3], [-6, -5], [-3, -4]];

/** Gaps between the small things he does, in ms. */
export const IDLE_GAP = { min: 1700, max: 4600 };
export const THINK_GAP = { min: 1300, max: 3000 };
export function nextActGap(gap, rand = Math.random) {
  return gap.min + rand() * (gap.max - gap.min);
}

// The head leans TOWARD the hand while he thinks (the hand is on his right).
export const THINK_TILT_DEG = 4;

/**
 * READING WHAT YOU TYPE. Three small things at once, because any one of them
 * alone is ambiguous:
 *
 *  · the eyes go DOWN — the composer is below him, so that is where to look;
 *  · the head DIPS, which also sinks the chin a little further behind the
 *    ledge. On a flat drawing that dip is what "lowered his head" looks like;
 *    the eyes alone read as a glance, not as attention.
 *  · and it leans the OTHER WAY from the thinking tilt, so the two poses can
 *    never be mistaken for one another at a glance.
 *
 * Small numbers on purpose: Mark asked for "slightly", the mark is about 34pt
 * tall, and the breath beside it is half a point. A 5° lean on a head this
 * size is a bird listening to something, not a person reading.
 */
export const TYPE_TILT_DEG = -2.6;
/** How far the head sinks, in points. Twice the breath, so it reads over it. */
export const TYPE_DIP = 1.1;
/** Where the eyes go, in the drawing's units: down, and a touch toward it. */
export const TYPE_GAZE = [-1, 5];
/**
 * How long he keeps reading after the last keystroke.
 *
 * Longer than any gap inside a typed sentence and shorter than a pause for
 * thought — so he stays down while you write and looks back up when you stop,
 * rather than bobbing between words.
 */
export const TYPING_LINGER_MS = 2200;
// An idle head tilt, either way.
const NOD_DEG = 3;
// The middle of the right hand at rest, in the drawing's units — where the
// pointing hand's trip starts from.
const RIGHT_HAND_AT = { x: 301, y: 135 };

// How far he overshoots the ledge on the way up, as a fraction of the trip.
const JUMP_OVERSHOOT = 0.16;
// Room above the mark, inside the clip, for the overshoot and a tipped head.
const HEADROOM = 12;
// LINE DRAWING: the clip ends a hair BELOW the ledge, so the chin's outline
// still meets the rule the way it does in the still drawing.
// FILLED FACE: it ends at the TOP of the rule instead, so the rule shows under
// him — and the face shape is carried well below the ledge (FACE_DROP), so
// there is always shape to clip: when the head tips, a face that ended at the
// ledge would lift one corner off it and show a wedge of page.
const CLIP_PAST_LEDGE = 0.75;
const CLIP_FILLED = -0.5;
const FACE_DROP = 40;

const FACE = ['face'];
const LEFT = ['leftHand'];
const RIGHT = ['rightHand'];
const POINT = ['pointHand'];

const SOFT = Easing.inOut(Easing.sin);
const OUT = Easing.out(Easing.cubic);

export default function ClaudeTurtleBuddy({
  size = 80,
  color = CLAUDE_MARK_COLOR,
  handFill = 'none',
  faceFill = 'none',
  tilt = 0,
  // IS HE UP? Down, he is behind the ledge and out of sight — the clip does
  // the hiding, so this costs a transform and not a mount. The notes header
  // leaves him down until somebody types; a Claude session has him up for
  // the whole of it.
  up = true,
  thinking = false,
  // Somebody is typing into the composer right now. THINKING WINS: a turn in
  // flight is the bigger thing, and he cannot hold both poses — his head
  // would have to lean two ways at once.
  typing = false,
  testID = 'claude-turtle-buddy',
}) {
  const reading = typing && !thinking;
  const height = markHeight(size);
  const ledge = ledgeOffset(size);
  // From fully below the ledge (1) to his resting place (0).
  const travel = ledge + 3;
  const clipPast = faceFill !== 'none' ? CLIP_FILLED : CLIP_PAST_LEDGE;
  // One unit of the drawing, in points on this mark.
  const unit = artUnit(size);

  const rise = useRef(new Animated.Value(1)).current;    // 1 below the ledge → 0 up
  const grab = useRef(new Animated.Value(0)).current;    // hands: 0 away → 1 on the ledge
  const lid = useRef(new Animated.Value(1)).current;     // eyes' scaleY
  const think = useRef(new Animated.Value(0)).current;   // 0 rest → 1 thinking
  const gazeX = useRef(new Animated.Value(0)).current;   // eyes, in points
  const gazeY = useRef(new Animated.Value(0)).current;
  const breath = useRef(new Animated.Value(0)).current;  // 0 → 1 → 0, for ever
  const nod = useRef(new Animated.Value(0)).current;     // −1 … 1, an idle head tilt
  const read = useRef(new Animated.Value(0)).current;    // 0 rest → 1 head down, reading
  const tap = useRef(new Animated.Value(0)).current;     // the pointing finger, tapping
  const drum = useRef(new Animated.Value(0)).current;    // the left hand, drumming
  // Reduce Motion. State, not a ref: every loop below has to stand down when
  // the answer comes back, and it comes back after they have started.
  const [still, setStill] = useState(false);

  const eyes = useMemo(() => eyeDots(size, tilt), [size, tilt]);

  // The right hand's trip to the mouth, in points: from where it rests to
  // where the pointing hand's fist sits. Follows `tilt` — the hands are drawn
  // turned.
  const reach = useMemo(() => {
    const from = artPoint(size, tilt, RIGHT_HAND_AT.x, RIGHT_HAND_AT.y);
    const to = artPoint(size, tilt, CLAUDE_POINT_AT.x, CLAUDE_POINT_AT.y);
    return { x: to.x - from.x, y: to.y - from.y };
  }, [size, tilt]);

  // ── Reduce Motion ─────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    let asked = null;
    try { asked = AccessibilityInfo.isReduceMotionEnabled && AccessibilityInfo.isReduceMotionEnabled(); } catch { asked = null; }
    if (asked && typeof asked.then === 'function') {
      asked.then((reduce) => { if (alive && reduce) setStill(true); }, () => {});
    }
    return () => { alive = false; };
  }, []);

  // ── the jump, and the drop back down ─────────────────────────────────
  useEffect(() => {
    if (still) { rise.setValue(up ? 0 : 1); grab.setValue(up ? 1 : 0); return undefined; }
    // DOWN: he sinks out of sight, hands first. No overshoot — an object
    // dropping behind a ledge does not bounce on the way out.
    if (!up) {
      const sink = Animated.parallel([
        Animated.timing(grab, { toValue: 0, duration: 140, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        Animated.timing(rise, { toValue: 1, duration: 260, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      ]);
      sink.start();
      return () => sink.stop();
    }
    const jump = Animated.parallel([
      Animated.sequence([
        Animated.timing(rise, { toValue: -JUMP_OVERSHOOT, duration: 300, easing: OUT, useNativeDriver: true }),
        Animated.timing(rise, { toValue: 0, duration: 200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
      Animated.sequence([
        Animated.delay(240),
        Animated.spring(grab, { toValue: 1, friction: 5, tension: 170, useNativeDriver: true }),
      ]),
    ]);
    jump.start();
    return () => jump.stop();
  }, [up, still, rise, grab]);

  // ── breathing, and blinking ───────────────────────────────────────────
  useEffect(() => {
    if (still) { breath.setValue(0); lid.setValue(1); return undefined; }
    let alive = true;
    let timer = null;
    let running = null;

    const breathing = Animated.loop(Animated.sequence([
      Animated.timing(breath, { toValue: 1, duration: 1900, easing: SOFT, useNativeDriver: true }),
      Animated.timing(breath, { toValue: 0, duration: 1900, easing: SOFT, useNativeDriver: true }),
    ]));
    breathing.start();

    const blinkOnce = () => Animated.sequence([
      Animated.timing(lid, { toValue: 0.1, duration: BLINK.shut, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(lid, { toValue: 1, duration: BLINK.open, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]);
    const scheduleBlink = () => {
      if (!alive) return;
      timer = setTimeout(() => {
        if (!alive) return;
        const twice = Math.random() < BLINK.doubleChance;
        running = Animated.sequence(
          twice ? [blinkOnce(), Animated.delay(BLINK.doubleGap), blinkOnce()] : [blinkOnce()],
        );
        running.start(({ finished }) => { if (finished) scheduleBlink(); });
      }, nextBlinkGap());
    };
    scheduleBlink();

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      breathing.stop();
      if (running) running.stop();
    };
  }, [still, breath, lid]);

  // ── the pose: hand to mouth, head toward it ───────────────────────────
  useEffect(() => {
    if (still) { think.setValue(thinking ? 1 : 0); return undefined; }
    const move = Animated.timing(think, {
      toValue: thinking ? 1 : 0,
      duration: thinking ? 340 : 260,
      easing: OUT,
      useNativeDriver: true,
    });
    move.start();
    return () => move.stop();
  }, [thinking, still, think]);

  // ── the head goes down to read, and comes back up ─────────────────────
  useEffect(() => {
    if (still) { read.setValue(reading ? 1 : 0); return undefined; }
    const move = Animated.timing(read, {
      toValue: reading ? 1 : 0,
      // Down a little quicker than up: dropping your eyes to something is a
      // reflex and lifting them is a decision.
      duration: reading ? 220 : 300,
      easing: OUT,
      useNativeDriver: true,
    });
    move.start();
    return () => move.stop();
  }, [reading, still, read]);

  // ── the small things he does, one at a time ───────────────────────────
  useEffect(() => {
    const home = thinking ? THINK_GAZE : reading ? TYPE_GAZE : [0, 0];
    if (still) {
      gazeX.setValue(home[0] * unit);
      gazeY.setValue(home[1] * unit);
      nod.setValue(0); tap.setValue(0); drum.setValue(0);
      return undefined;
    }
    let alive = true;
    let timer = null;
    const pick = (list) => list[Math.floor(Math.random() * list.length)];
    const to = (value, toValue, duration, easing = OUT) => Animated.timing(value, {
      toValue, duration, easing, useNativeDriver: true,
    });
    const look = ([x, y], ms) => Animated.parallel([to(gazeX, x * unit, ms), to(gazeY, y * unit, ms)]);
    const beat = (value, up, down) => Animated.sequence([to(value, 1, up), to(value, 0, down)]);

    const idleAct = () => {
      const r = Math.random();
      if (r < 0.55) {
        // A glance: there, a moment, back.
        return Animated.sequence([look(pick(GLANCES), 170), Animated.delay(450 + Math.random() * 900), look(home, 220)]);
      }
      if (r < 0.8) {
        // A small tilt of the head, either way.
        const way = Math.random() < 0.5 ? -1 : 1;
        return Animated.sequence([to(nod, way, 380, SOFT), Animated.delay(650 + Math.random() * 600), to(nod, 0, 420, SOFT)]);
      }
      // Drumming on the ledge.
      return Animated.sequence([beat(drum, 80, 100), beat(drum, 80, 110)]);
    };
    const thinkingAct = () => {
      if (Math.random() < 0.55) {
        // The finger taps at the corner of his mouth, once or twice.
        const once = beat(tap, 110, 170);
        return Math.random() < 0.4 ? Animated.sequence([once, Animated.delay(90), beat(tap, 110, 170)]) : once;
      }
      // The eyes wander about up there, and come back.
      return Animated.sequence([look(pick(THINK_DRIFT), 320), Animated.delay(500 + Math.random() * 900), look(home, 320)]);
    };

    // Whatever he was in the middle of, he comes home from first.
    let running = Animated.parallel([look(home, 260), to(nod, 0, 260, SOFT), to(tap, 0, 120), to(drum, 0, 120)]);
    const next = () => {
      if (!alive) return;
      // READING: he holds it. Glancing round the room while you write is the
      // opposite of the thing this pose says. He still breathes and blinks —
      // those are their own loop.
      if (reading) return;
      timer = setTimeout(() => {
        if (!alive) return;
        running = thinking ? thinkingAct() : idleAct();
        running.start(({ finished }) => { if (finished) next(); });
      }, nextActGap(thinking ? THINK_GAP : IDLE_GAP));
    };
    running.start(({ finished }) => { if (finished) next(); });

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      if (running) running.stop();
    };
  }, [thinking, reading, still, unit, gazeX, gazeY, nod, tap, drum]);

  // ── what each layer does with all that ────────────────────────────────
  const faceStyle = {
    transform: [
      { translateY: Animated.add(
        Animated.multiply(rise, travel),
        Animated.add(
          read.interpolate({ inputRange: [0, 1], outputRange: [0, TYPE_DIP] }),
          Animated.add(
            think.interpolate({ inputRange: [0, 1], outputRange: [0, -0.8] }),
            breath.interpolate({ inputRange: [0, 1], outputRange: [0, -0.5] }),
          ),
        ),
      ) },
      { rotate: think.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${THINK_TILT_DEG}deg`] }) },
      { rotate: read.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${TYPE_TILT_DEG}deg`] }) },
      { rotate: nod.interpolate({ inputRange: [-1, 1], outputRange: [`${-NOD_DEG}deg`, `${NOD_DEG}deg`] }) },
    ],
  };
  // Both hands arrive the same way: down onto the ledge, just after the face.
  const grabOpacity = grab.interpolate({ inputRange: [0, 0.35], outputRange: [0, 1], extrapolate: 'clamp' });
  const grabY = grab.interpolate({ inputRange: [0, 1], outputRange: [-7, 0] });
  const leftStyle = {
    opacity: grabOpacity,
    transform: [{ translateY: Animated.add(grabY, drum.interpolate({ inputRange: [0, 1], outputRange: [0, -1.6] })) }],
  };
  // The right hand at rest: it sets off toward the mouth and fades on the way…
  const rightStyle = {
    opacity: Animated.multiply(
      grabOpacity,
      think.interpolate({ inputRange: [0, 0.55], outputRange: [1, 0], extrapolate: 'clamp' }),
    ),
    transform: [
      { translateX: think.interpolate({ inputRange: [0, 1], outputRange: [0, reach.x * 0.6] }) },
      { translateY: Animated.add(grabY, think.interpolate({ inputRange: [0, 1], outputRange: [0, reach.y * 0.6] })) },
    ],
  };
  // …and the pointing hand arrives from that side as it does, then taps.
  const pointStyle = {
    opacity: think.interpolate({ inputRange: [0.3, 0.8], outputRange: [0, 1], extrapolate: 'clamp' }),
    transform: [
      { translateX: Animated.add(
        think.interpolate({ inputRange: [0, 1], outputRange: [-reach.x * 0.4, 0] }),
        tap.interpolate({ inputRange: [0, 1], outputRange: [0, 0.5] }),
      ) },
      { translateY: Animated.add(
        think.interpolate({ inputRange: [0, 1], outputRange: [-reach.y * 0.4, 0] }),
        tap.interpolate({ inputRange: [0, 1], outputRange: [0, 1.4] }),
      ) },
    ],
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
                // Slide to look, then close about its own middle to blink.
                transform: [{ translateX: gazeX }, { translateY: gazeY }, { scaleY: lid }],
              }}
            />
          ))}
        </Animated.View>
      </View>
      {/* 2 — the hand that stays on the ledge (and drums on it). */}
      <Animated.View testID={`${testID}-hand-left`} style={[layer, leftStyle]}>
        <ClaudeTurtleMark {...art} parts={LEFT} handFill={handFill} testID={`${testID}-hand-left-art`} />
      </Animated.View>
      {/* 3 — the right hand at rest… */}
      <Animated.View testID={`${testID}-hand-right`} style={[layer, rightStyle]}>
        <ClaudeTurtleMark {...art} parts={RIGHT} handFill={handFill} testID={`${testID}-hand-right-art`} />
      </Animated.View>
      {/* 4 — …and thinking: index at the corner of his mouth, thumb under his chin. */}
      <Animated.View testID={`${testID}-hand-point`} style={[layer, pointStyle]}>
        <ClaudeTurtleMark {...art} parts={POINT} handFill={handFill} testID={`${testID}-hand-point-art`} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { position: 'absolute', left: 0, overflow: 'hidden' },
});
