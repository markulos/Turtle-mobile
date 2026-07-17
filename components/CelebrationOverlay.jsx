/**
 * CelebrationOverlay — a full-screen, touch-through confetti burst plus a
 * floating "+N pts" badge, mirroring the desktop HUD's completion confetti.
 *
 * Driven by the CelebrationContext: each celebrate() call bumps `burst.id`,
 * which regenerates a fresh set of confetti pieces and replays the animation.
 * Pure Reanimated worklets (no native confetti lib → no dev-client rebuild);
 * a single shared value `t` (0→1) drives every piece so the whole burst is one
 * timing curve. Self-clears ~2.5s after each trigger.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import { useTheme } from '../context/ThemeContext';

// Bright, high-contrast palette — same spirit as the desktop confetti.
const COLORS = ['#2eaadc', '#34c759', '#ff6347', '#ffd166', '#a78bfa', '#ff7eb6', '#ffffff'];

const BURST_MS = 2300;

// Build one burst's worth of confetti params in JS (random is fine here — this
// is React Native, not a workflow sandbox). ~40% launch UP from bottom-centre
// like a cannon; the rest rain down from above across the full width.
function makePieces(W, H) {
  const N = 42;
  const pieces = [];
  for (let i = 0; i < N; i++) {
    const cannon = i < N * 0.4;
    const size = 7 + Math.random() * 8;
    const color = COLORS[(Math.random() * COLORS.length) | 0];
    const round = Math.random() < 0.4;
    if (cannon) {
      pieces.push({
        color, size, round,
        ox: W / 2 + (Math.random() - 0.5) * 44,
        oy: H * 0.62,
        vx: (Math.random() - 0.5) * W * (0.5 + Math.random() * 0.5),
        vy: H * (0.25 + Math.random() * 0.25),   // net fall past the origin
        arc: H * (0.35 + Math.random() * 0.25),  // up-then-down launch height
        spin: (Math.random() - 0.5) * 14,
        delay: Math.random() * 0.06,
      });
    } else {
      pieces.push({
        color, size, round,
        ox: Math.random() * W,
        oy: -30 - Math.random() * H * 0.25,
        vx: (Math.random() - 0.5) * W * 0.25,
        vy: H * (1.05 + Math.random() * 0.25),
        arc: 0,
        spin: (Math.random() - 0.5) * 12,
        delay: Math.random() * 0.15,
      });
    }
  }
  return pieces;
}

function ConfettiPiece({ t, p }) {
  const anim = useAnimatedStyle(() => {
    'worklet';
    const raw = p.delay ? (t.value - p.delay) / (1 - p.delay) : t.value;
    const tt = raw < 0 ? 0 : raw > 1 ? 1 : raw;
    const fall = p.vy * (0.35 * tt + 0.65 * tt * tt);   // accelerating fall
    const arc = p.arc ? -p.arc * 4 * tt * (1 - tt) : 0; // parabola peaking mid-flight
    const x = p.ox + p.vx * tt;
    const y = p.oy + fall + arc;
    const rot = p.spin * tt;
    const opacity = tt >= 1 ? 0 : tt < 0.72 ? 1 : 1 - (tt - 0.72) / 0.28;
    return {
      opacity,
      transform: [{ translateX: x }, { translateY: y }, { rotate: `${rot}rad` }],
    };
  });
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: 0,
          top: 0,
          width: p.size,
          height: p.round ? p.size : p.size * 0.6,
          borderRadius: p.round ? p.size : 2,
          backgroundColor: p.color,
        },
        anim,
      ]}
    />
  );
}

export default function CelebrationOverlay({ burst }) {
  const { theme } = useTheme();
  const { width: W, height: H } = useWindowDimensions();
  const [active, setActive] = useState(null); // { id, points, pieces }
  const t = useSharedValue(0);
  const labelScale = useSharedValue(0);
  const labelY = useSharedValue(0);
  const labelOpacity = useSharedValue(0);
  const hideTimer = useRef(null);

  useEffect(() => {
    if (!burst) return undefined;
    setActive({ id: burst.id, points: burst.points || 0, pieces: makePieces(W, H) });

    // Restart the whole burst on this trigger.
    t.value = 0;
    t.value = withTiming(1, { duration: BURST_MS, easing: Easing.out(Easing.quad) });

    // "+N pts" badge: spring-pop in, drift up, hold, fade out. Reset scale to 0
    // first (like t/labelY) so the grow-from-nothing pop plays on EVERY burst,
    // not just the first — withSequence animates from the current value.
    labelScale.value = 0;
    labelScale.value = withSequence(
      withTiming(1.18, { duration: 240, easing: Easing.out(Easing.back(2)) }),
      withTiming(1, { duration: 200 }),
    );
    labelY.value = 0;
    labelY.value = withTiming(-64, { duration: 1900, easing: Easing.out(Easing.quad) });
    labelOpacity.value = withSequence(
      withTiming(1, { duration: 200 }),
      withDelay(1100, withTiming(0, { duration: 520 })),
    );

    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setActive(null), BURST_MS + 250);
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [burst?.id]);

  const labelStyle = useAnimatedStyle(() => ({
    opacity: labelOpacity.value,
    transform: [{ translateY: labelY.value }, { scale: labelScale.value }],
  }));

  if (!active) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {active.pieces.map((p, i) => (
        <ConfettiPiece key={`${active.id}-${i}`} t={t} p={p} />
      ))}
      {active.points > 0 && (
        <View pointerEvents="none" style={styles.labelWrap}>
          <Animated.View style={[styles.badge, { backgroundColor: theme.colors?.accentSuccess || '#22C55E' }, labelStyle]}>
            <Text style={styles.badgeText}>+{active.points} pts</Text>
          </Animated.View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  labelWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: '38%',
  },
  badge: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  badgeText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
});
