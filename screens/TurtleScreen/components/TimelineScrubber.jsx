/**
 * TimelineScrubber — Google-Photos-grade date rail for the photo vault grid.
 *
 * Why this exists as its own component: the previous scrubber lived inside
 * MediaGallery and drove the thumb + month label through React STATE — a
 * setState (i.e. a re-render of a 4,700-line component) per scrub frame.
 * This one runs entirely on the UI thread:
 *
 *   • `scrollY` / `maxScroll` arrive as Reanimated shared values (written by
 *     the grid's onScroll). Thumb position, bubble position, rail opacity and
 *     the month/count labels are all derived in worklets — ZERO React renders
 *     while scrolling or dragging.
 *   • The month label is updated via the ReText pattern (an Animated TextInput
 *     whose `text` prop is driven by useAnimatedProps), so text changes at
 *     scroll speed without touching the React tree.
 *   • Month lookup is a binary search over the timeline's cumulative start
 *     indices — O(log months) per frame, in the worklet.
 *   • Show/hide is a withSequence fade scheduled on the UI thread; only the
 *     0↔1 visibility TRANSITION crosses to JS (to flip pointerEvents so the
 *     idle rail never steals taps from the photos under it).
 *
 * Conventions (the grid is scaleY(-1)-inverted, newest-first):
 *   • dataFrac f: 0 = newest … 1 = oldest  (= scrollY / maxScroll)
 *   • visual frac vf: 0 = rail top (oldest) … 1 = rail bottom (newest);
 *     vf = 1 - f. Year marks come in as vf.
 *
 * Props:
 *   scrollY, maxScroll — shared values from the grid
 *   data  — { starts:number[] (cumulative, ascending), labels:string[],
 *            countLabels:string[], total:number, yearMarks:[{frac, year}] }
 *   onJump(dataFrac) — JS callback: scroll the grid to this fraction
 *   topInset / bottomInset — rail bounds
 *   accent — thumb color;  dark — theme mode for contrast chrome
 */
import React, { memo, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, Vibration, View } from 'react-native';
import Reanimated, {
  useSharedValue,
  useDerivedValue,
  useAnimatedStyle,
  useAnimatedProps,
  useAnimatedReaction,
  withTiming,
  withSpring,
  withDelay,
  withSequence,
  cancelAnimation,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

// Haptics: expo-haptics once the dev app is rebuilt with it; a 4ms vibration
// on Android until then; silent no-op on iOS without the module.
let _Haptics = null;
try { _Haptics = require('expo-haptics'); } catch (e) { _Haptics = null; }
// Per-month tick while scrubbing. A "Rigid" impact is the crisp, percussive
// tap Google Photos uses on each boundary — far more satisfying than the faint
// selectionAsync tick. Fall back down the chain on older expo-haptics / Android.
const tickHaptic = () => {
  try {
    if (_Haptics && _Haptics.impactAsync) {
      const s = _Haptics.ImpactFeedbackStyle || {};
      _Haptics.impactAsync(s.Rigid || s.Light);
      return;
    }
    if (_Haptics && _Haptics.selectionAsync) { _Haptics.selectionAsync(); return; }
    if (Platform.OS === 'android') Vibration.vibrate(8);
  } catch (e) { /* haptics are garnish, never an error */ }
};
// Grab feels firmer than a tick — a Medium impact when you catch the handle.
const grabHaptic = () => {
  try {
    if (_Haptics && _Haptics.impactAsync) {
      const s = _Haptics.ImpactFeedbackStyle || {};
      _Haptics.impactAsync(s.Medium || s.Light);
      return;
    }
    if (Platform.OS === 'android') { Vibration.vibrate(12); return; }
    tickHaptic();
  } catch (e) { /* ignore */ }
};

const AnimatedTextInput = Reanimated.createAnimatedComponent(TextInput);

const THUMB = 24;            // resting thumb diameter (bigger Google-Photos-style grab handle)
const RAIL_W = 36;           // touch strip width
const HIDE_DELAY_MS = 1400;  // idle time before the rail fades

const TimelineScrubber = ({
  scrollY,
  maxScroll,
  data,
  onJump,
  topInset = 0,
  bottomInset = 0,
  accent = '#fff',
  dark = true,
  // Orientation of the list this rail drives.
  //   inverted=true  (default) — the photos grid: scaleY(-1), newest-first, so
  //                  dataFrac 0 = newest sits at the rail BOTTOM (vf = 1 - f).
  //   inverted=false — a normal top-down list (the albums A→Z grid): dataFrac 0
  //                  = first item sits at the rail TOP (vf = f).
  // Only the visual mapping flips; the binary-search over `data.starts` is the
  // same because `starts` is always ordered to match scroll direction (index 0
  // = the item at scrollY 0). `data.yearMarks[].frac` is pre-computed as the
  // VISUAL fraction by the caller, so marks need no flag here.
  inverted = true,
}) => {
  // Rail visibility mirrored to JS ONLY at the 0↔1 transition, to gate
  // pointerEvents. Everything else stays on the UI thread.
  const [railActive, setRailActive] = useState(false);

  const trackH = useSharedValue(1);
  const visible = useSharedValue(0);
  const dragging = useSharedValue(0);
  const dragFrac = useSharedValue(0);   // dataFrac while dragging
  const frac = useSharedValue(0);       // current dataFrac (scroll- or drag-driven)
  const startFrac = useSharedValue(0);  // dataFrac captured at grab — drag is relative to it
  const monthIdx = useSharedValue(-1);
  const labelText = useSharedValue('');
  const countText = useSharedValue('');
  const lastSent = useSharedValue(-1);  // throttle for drag → onJump

  const scheduleHide = () => {
    'worklet';
    visible.value = withSequence(
      withTiming(1, { duration: 90 }),
      withDelay(HIDE_DELAY_MS, withTiming(0, { duration: 420 })),
    );
  };

  // Scroll / drag → current fraction, month label, haptic tick, reveal.
  useAnimatedReaction(
    () => {
      const max = Math.max(1, maxScroll.value);
      return dragging.value === 1
        ? dragFrac.value
        : Math.min(1, Math.max(0, scrollY.value / max));
    },
    (f, prev) => {
      if (f === prev) return;
      frac.value = f;
      const total = data.total;
      if (total > 0 && data.starts.length > 0) {
        const cum = Math.round(f * (total - 1));
        // Greatest month start <= cum (starts ascend, newest-first timeline).
        let lo = 0, hi = data.starts.length - 1, ans = 0;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (data.starts[mid] <= cum) { ans = mid; lo = mid + 1; }
          else hi = mid - 1;
        }
        if (ans !== monthIdx.value) {
          monthIdx.value = ans;
          labelText.value = data.labels[ans] || '';
          countText.value = data.countLabels[ans] || '';
          if (dragging.value === 1) runOnJS(tickHaptic)();
        }
      }
      // Any movement reveals the rail; idle fades it (unless dragging pins it).
      if (dragging.value !== 1) scheduleHide();
    },
    [data],
  );

  // Mirror visibility to pointerEvents at the threshold crossing only.
  useAnimatedReaction(
    () => visible.value > 0.03,
    (on, prev) => { if (on !== prev) runOnJS(setRailActive)(on); },
    [],
  );

  const jumpThrottled = (f) => {
    'worklet';
    // Fire onJump once per single item of travel (was 3 = a full grid row). The
    // tighter gate makes the grid track the finger much more closely — the rail
    // feels responsive rather than stepping a row at a time — while still
    // coalescing sub-item jitter so scrollToOffset isn't called every frame.
    if (lastSent.value < 0 || Math.abs(f - lastSent.value) * Math.max(1, data.total) >= 1 || f <= 0 || f >= 1) {
      lastSent.value = f;
      runOnJS(onJump)(f);
    }
  };

  // The pan is attached to the THUMB only (see JSX), so a grab always starts on
  // the dot — never on empty rail. We therefore track movement RELATIVE to the
  // grab point (translationY) instead of jumping to the raw touch Y: the thumb
  // stays put the instant you grab it, then follows your finger 1:1. This is the
  // Google-Photos handle feel — tapping elsewhere on the rail does nothing.
  const pan = Gesture.Pan()
    // Generous invisible grab zone around the visible handle so it's easy to
    // catch with a thumb (Google-Photos-sized), without making the rest of the
    // rail touchable.
    .hitSlop({ top: 22, bottom: 22, left: 30, right: 12 })
    .onBegin(() => {
      'worklet';
      dragging.value = 1;
      cancelAnimation(visible);
      visible.value = withTiming(1, { duration: 80 });
      startFrac.value = frac.value; // anchor to current thumb position — no jump
      dragFrac.value = frac.value;
      lastSent.value = -1;
      runOnJS(grabHaptic)();
    })
    .onUpdate((e) => {
      'worklet';
      const span = Math.max(1, trackH.value - THUMB);
      const startVf = inverted ? 1 - startFrac.value : startFrac.value;
      const vf = Math.min(1, Math.max(0, startVf + e.translationY / span));
      const f = inverted ? 1 - vf : vf;
      dragFrac.value = f;
      jumpThrottled(f);
    })
    .onFinalize(() => {
      'worklet';
      runOnJS(onJump)(dragFrac.value); // settle exactly where the finger left
      dragging.value = 0;
      scheduleHide();
    });

  // ── Animated styles (all UI thread) ────────────────────────────────────
  const railStyle = useAnimatedStyle(() => ({ opacity: visible.value }));

  const thumbStyle = useAnimatedStyle(() => {
    const vf = inverted ? 1 - frac.value : frac.value;
    const scale = withSpring(dragging.value === 1 ? 1.45 : 1, { damping: 16, stiffness: 260 });
    return {
      transform: [
        { translateY: vf * Math.max(0, trackH.value - THUMB) },
        { scale },
      ],
    };
  });

  const bubbleStyle = useAnimatedStyle(() => {
    const vf = inverted ? 1 - frac.value : frac.value;
    const y = vf * Math.max(0, trackH.value - THUMB) + THUMB / 2;
    const clamped = Math.min(Math.max(y, 26), Math.max(26, trackH.value - 26));
    return {
      opacity: visible.value,
      transform: [
        { translateY: clamped },
        { scale: withSpring(dragging.value === 1 ? 1.12 : 0.94, { damping: 18, stiffness: 240 }) },
      ],
    };
  });

  // Count line grows in only while dragging — the compact pill stays terse.
  const countStyle = useAnimatedStyle(() => ({
    opacity: withTiming(dragging.value === 1 ? 1 : 0, { duration: 140 }),
    height: withTiming(dragging.value === 1 ? 14 : 0, { duration: 140 }),
  }));

  const labelProps = useAnimatedProps(() => ({ text: labelText.value }));
  const countProps = useAnimatedProps(() => ({ text: countText.value }));

  // Year ticks are static per data change — cap density so a 20-year library
  // doesn't shingle the rail.
  const marks = (() => {
    const ms = data.yearMarks || [];
    if (ms.length <= 14) return ms;
    const step = Math.ceil(ms.length / 14);
    return ms.filter((_, i) => i % step === 0);
  })();

  const chrome = dark ? '#000' : '#fff';
  const tickColor = dark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.40)';

  return (
    // box-none: the strip itself is NOT touchable, so taps/drags over empty rail
    // fall through to the photo grid underneath. Only the thumb (below) grabs.
    <Reanimated.View
      pointerEvents="box-none"
      onLayout={(e) => { trackH.value = e.nativeEvent.layout.height; }}
      style={[styles.strip, { top: topInset, bottom: bottomInset }, railStyle]}
    >
      {/* Rail line */}
      <View pointerEvents="none" style={[styles.rail, { backgroundColor: dark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.14)' }]} />

      {/* Year milestones */}
      {marks.map((m) => (
        <View key={m.year} pointerEvents="none" style={[styles.tickRow, { top: `${m.frac * 100}%` }]}>
          <Text style={[styles.tickText, { color: tickColor }]}>{m.year}</Text>
          <View style={[styles.tickDash, { backgroundColor: tickColor }]} />
        </View>
      ))}

      {/* Floating month bubble — GP-style pill left of the thumb. */}
      <Reanimated.View pointerEvents="none" style={[styles.bubble, bubbleStyle]}>
        <AnimatedTextInput
          editable={false}
          defaultValue=""
          animatedProps={labelProps}
          style={styles.bubbleLabel}
          underlineColorAndroid="transparent"
        />
        <Reanimated.View style={countStyle}>
          <AnimatedTextInput
            editable={false}
            defaultValue=""
            animatedProps={countProps}
            style={styles.bubbleCount}
            underlineColorAndroid="transparent"
          />
        </Reanimated.View>
      </Reanimated.View>

      {/* Thumb — the ONLY touch target. Grab the dot to scrub; it's interactive
          only while the rail is revealed (railActive), so the idle rail never
          steals taps from the photos beneath it. */}
      <GestureDetector gesture={pan}>
        <Reanimated.View
          pointerEvents={railActive ? 'auto' : 'none'}
          style={[styles.thumb, { backgroundColor: accent, borderColor: chrome }, thumbStyle]}
        />
      </GestureDetector>
    </Reanimated.View>
  );
};

const styles = StyleSheet.create({
  strip: {
    position: 'absolute',
    right: 0,
    width: RAIL_W,
    zIndex: 60,
  },
  rail: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 8,
    width: 3,
    borderRadius: 2,
  },
  tickRow: {
    position: 'absolute',
    right: 0,
    marginTop: -6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  tickText: {
    fontSize: 9,
    fontWeight: '700',
    marginRight: 4,
    fontVariant: ['tabular-nums'],
  },
  tickDash: {
    width: 7,
    height: 2,
    borderRadius: 1,
  },
  thumb: {
    position: 'absolute',
    right: 1,
    top: 0,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    borderWidth: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  bubble: {
    position: 'absolute',
    right: RAIL_W - 2,
    top: -22,
    alignItems: 'flex-end',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: 'rgba(18,18,18,0.94)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  bubbleLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
    padding: 0,
    margin: 0,
    // Sized to fit the widest month name ("September" at 16px/800 + spacing).
    // A right-aligned single-line TextInput clips its content when it overflows,
    // so the field must always be at least as wide as the longest label.
    minWidth: 112,
    textAlign: 'right',
  },
  bubbleCount: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    fontWeight: '600',
    padding: 0,
    margin: 0,
    minWidth: 112,
    textAlign: 'right',
  },
});

export default memo(TimelineScrubber);
