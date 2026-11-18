/**
 * NowPlayingPanel — the transport bar, opened out.
 *
 * Mark, 2026-11-18: "on click of the currently playing element to allow it to
 * open as a panel with the album and proper slider element and navigation
 * buttons".
 *
 * The bar at the bottom of the music vault has always been a STRIP: a 44pt
 * tile, a title, three small keys and a 4pt line you could tap to jump. It is
 * the right thing while you are doing something else, and the wrong thing
 * when the track IS what you are doing — the artwork is a thumbnail, and the
 * line has no handle, so moving to a known point in an hour-long recording is
 * a tap you have to guess at and then correct.
 *
 * So this is the same transport, given the screen: the cover at the size it
 * was made, a slider you can take hold of, and keys you can hit without
 * looking. Nothing new is playing — it is a second view of exactly the state
 * the bar draws, and every control goes to the same handler.
 *
 * ── The slider ───────────────────────────────────────────────────────────
 *
 * On the UI thread, and deliberately: a drag that re-rendered this screen for
 * every finger position would fight the half-second progress poll underneath
 * it, and the thumb would stutter against its own track. The shared values
 * carry the drag; React only hears about it once, at the end, as a seek.
 *
 * While the finger is down the elapsed time has to follow the THUMB rather
 * than the player — otherwise the number says where the music still is and
 * the handle says where you are putting it, which is the one thing a scrubber
 * must never do. `AnimatedText` is how that number is written without a
 * render (the same trick TimelineScrubber uses for its month label).
 */
import React, { useCallback, useEffect } from 'react';
import {
  Animated as RNAnimated, Dimensions, Easing, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Image } from 'expo-image';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Reanimated, {
  runOnJS, useAnimatedProps, useAnimatedStyle, useSharedValue,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { impactHaptic, tapHaptic } from '../../../utils/haptics';

// The ReText pattern, exactly as TimelineScrubber uses it: a TextInput is the
// only text node whose contents can be written from the UI thread.
const AnimatedText = Reanimated.createAnimatedComponent(TextInput);

/** The cover, as big as the narrow side allows without crowding the keys. */
export function coverSize(width, height) {
  const byWidth = Math.max(0, width - 64);
  // …and never more than a third of a short screen, or the slider and the
  // keys get pushed under the home bar on an SE.
  const byHeight = Math.max(0, height * 0.42);
  return Math.round(Math.max(120, Math.min(byWidth, byHeight, 340)));
}

/**
 * mm:ss, and h:mm:ss once there is an hour to show.
 *
 * A WORKLET, because the slider's pan callbacks call it: while the finger is
 * down the elapsed label follows the thumb, and that write happens on the UI
 * thread. A plain function called from there takes the app down on the first
 * touch of a release build — which is what components/__tests__/
 * workletSafety.scan exists to catch, and did. It is still an ordinary
 * function from JS, which is how the duration end of the row uses it.
 */
export function clock(seconds) {
  'worklet';

  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Where a drag has got to, as a fraction, clamped. Worklet-safe and pure. */
export function fractionAt(x, width) {
  'worklet';
  if (!(width > 0)) return 0;
  const f = x / width;
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

const THUMB = 16;

function Slider({ position, duration, onSeek, colors, tint, disabled }) {
  const c = colors;
  const width = useSharedValue(1);
  const frac = useSharedValue(0);
  const dragging = useSharedValue(0);
  const label = useSharedValue(clock(0));
  const total = useSharedValue(0);

  // The player's own position, while nothing is being dragged. Written from
  // an effect rather than read in a worklet: `position` is React state and a
  // worklet cannot see it change.
  useEffect(() => {
    total.value = Number(duration) || 0;
    if (dragging.value) return;
    const d = Number(duration) || 0;
    frac.value = d > 0 ? Math.min(1, Math.max(0, (Number(position) || 0) / d)) : 0;
    label.value = clock(position);
  }, [position, duration, frac, label, dragging, total]);

  const commit = useCallback((f) => {
    const d = Number(duration) || 0;
    if (d > 0) onSeek?.(f * d);
  }, [duration, onSeek]);

  const grab = useCallback(() => { impactHaptic('light'); }, []);

  const pan = Gesture.Pan()
    .enabled(!disabled)
    // The whole point of a handle: it answers the finger where it lands, and
    // the first movement must not have to clear a slop threshold to count.
    .minDistance(0)
    .onBegin((e) => {
      dragging.value = 1;
      frac.value = fractionAt(e.x, width.value);
      label.value = clock(frac.value * total.value);
      runOnJS(grab)();
    })
    .onUpdate((e) => {
      frac.value = fractionAt(e.x, width.value);
      label.value = clock(frac.value * total.value);
    })
    .onFinalize(() => {
      const f = frac.value;
      dragging.value = 0;
      runOnJS(commit)(f);
    });

  const fillStyle = useAnimatedStyle(() => ({ width: `${frac.value * 100}%` }));
  const thumbStyle = useAnimatedStyle(() => ({
    left: `${frac.value * 100}%`,
    transform: [{ scale: dragging.value ? 1.25 : 1 }],
  }));
  const elapsedProps = useAnimatedProps(() => ({ text: label.value }));

  return (
    <View style={styles.sliderBlock}>
      <GestureDetector gesture={pan}>
        {/* The hit area is the row, not the 4pt track: a 4pt target is a
            target you miss, and missing a scrubber moves the music. */}
        <View
          style={styles.sliderHit}
          onLayout={(e) => { width.value = e.nativeEvent.layout.width || 1; }}
          testID="now-playing-slider"
        >
          <View style={[styles.sliderTrack, { backgroundColor: c.border }]}>
            <Reanimated.View style={[styles.sliderFill, { backgroundColor: tint }, fillStyle]} />
          </View>
          <Reanimated.View
            pointerEvents="none"
            style={[
              styles.thumb,
              { backgroundColor: tint, borderColor: c.surfaceElevated || c.surface },
              thumbStyle,
            ]}
          />
        </View>
      </GestureDetector>
      <View style={styles.times}>
        {/* Not a field: a label that can be written from the UI thread,
            which a <Text> cannot. */}
        <AnimatedText
          editable={false}
          defaultValue=""
          underlineColorAndroid="transparent"
          style={[styles.time, { color: c.textTertiary }]}
          animatedProps={elapsedProps}
          testID="now-playing-elapsed"
        />
        <Text style={[styles.time, { color: c.textTertiary }]}>{clock(duration)}</Text>
      </View>
    </View>
  );
}

export default function NowPlayingPanel({
  visible,
  title,
  subtitle,
  artworkUri,
  isPlaying,
  preparing = false,
  position = 0,
  duration = 0,
  canPrev = false,
  canNext = false,
  onPrev,
  onNext,
  onToggle,
  onSeek,
  onClose,
  colors,
  tint,
  bottomInset = 0,
  topInset = 0,
  testID = 'now-playing-panel',
}) {
  const c = colors;
  const slide = React.useRef(new RNAnimated.Value(1)).current;
  const { width, height } = Dimensions.get('window');
  const cover = coverSize(width, height);

  // Up from the bar it was opened from, down onto it again — on the native
  // driver, so the slide never competes with the slider above.
  useEffect(() => {
    const move = RNAnimated.timing(slide, {
      toValue: visible ? 0 : 1,
      duration: visible ? 260 : 200,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.quad),
      useNativeDriver: true,
    });
    move.start();
    return () => move.stop();
  }, [visible, slide]);

  if (!visible) return null;

  const key = (name, size, enabled, onPress, label) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
      onPress={() => { tapHaptic(); onPress?.(); }}
      style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
      testID={`now-playing-${label.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <Icon name={name} size={size} color={enabled ? c.textPrimary : c.textMuted} />
    </Pressable>
  );

  return (
    <View style={[StyleSheet.absoluteFill, styles.layer]} testID={testID}>
      <Pressable
        style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)' }]}
        accessibilityLabel="Close now playing"
        testID="now-playing-scrim"
        onPress={onClose}
      />
      <RNAnimated.View
        style={[
          styles.sheet,
          {
            backgroundColor: c.background,
            // The sheet is as tall as its contents and no taller — the hood
            // inset BOUNDS it rather than padding it. Padding by the inset
            // put 53pt of nothing between the sheet's own top edge and the
            // chevron, which reads as a mistake rather than as room.
            maxHeight: height - topInset,
            paddingBottom: bottomInset + 18,
            transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [0, height] }) }],
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close now playing"
          onPress={() => { tapHaptic(); onClose?.(); }}
          hitSlop={{ top: 10, bottom: 10, left: 20, right: 20 }}
          style={styles.handleRow}
          testID="now-playing-close"
        >
          <Icon name="chevron-down" size={26} color={c.textTertiary} />
        </Pressable>

        <View style={styles.coverWrap}>
          {artworkUri ? (
            <Image
              source={{ uri: artworkUri }}
              style={[styles.cover, { width: cover, height: cover, backgroundColor: c.surfaceElevated }]}
              contentFit="cover"
              transition={160}
              testID="now-playing-art"
            />
          ) : (
            // No cover is the COMMON case in this vault — a recording, a file
            // off a phone, a download with no embedded art. A big empty frame
            // with the music glyph in it is honest and is still the anchor
            // the eye needs; a stretched placeholder photo would not be.
            <View
              style={[styles.cover, styles.coverEmpty, { width: cover, height: cover, backgroundColor: `${tint}22` }]}
              testID="now-playing-art-empty"
            >
              <Icon name="music-note" size={Math.round(cover * 0.3)} color={tint} />
            </View>
          )}
        </View>

        <View style={styles.titles}>
          <Text style={[styles.title, { color: c.textPrimary }]} numberOfLines={2}>{title}</Text>
          {!!subtitle && (
            <Text style={[styles.subtitle, { color: c.textTertiary }]} numberOfLines={1}>{subtitle}</Text>
          )}
        </View>

        <Slider
          position={position}
          duration={duration}
          onSeek={onSeek}
          colors={c}
          tint={tint}
          // Nothing to scrub through until the player knows how long it is.
          disabled={!(duration > 0)}
        />

        <View style={styles.keys}>
          {key('skip-previous', 40, canPrev, onPrev, 'Previous track')}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={preparing ? 'Loading' : isPlaying ? 'Pause' : 'Play'}
            hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
            onPress={() => { impactHaptic('medium'); onToggle?.(); }}
            style={({ pressed }) => [
              styles.playKey,
              { backgroundColor: tint, opacity: pressed ? 0.75 : 1 },
            ]}
            testID="now-playing-toggle"
          >
            <Icon
              name={preparing || !isPlaying ? 'play' : 'pause'}
              size={34}
              color={c.background}
            />
          </Pressable>
          {key('skip-next', 40, canNext, onNext, 'Next track')}
        </View>
      </RNAnimated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Over the ⋯ card (400) as well as everything else: this is the surface you
  // opened on purpose, and nothing in the vault belongs on top of it.
  layer: { zIndex: 500, elevation: 500 },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderCurve: 'continuous',
    alignItems: 'center',
  },
  handleRow: { alignItems: 'center', paddingVertical: 4, alignSelf: 'stretch' },
  coverWrap: { paddingTop: 10, paddingBottom: 22 },
  cover: { borderRadius: 18, borderCurve: 'continuous' },
  coverEmpty: { alignItems: 'center', justifyContent: 'center' },
  titles: { alignSelf: 'stretch', paddingHorizontal: 28, alignItems: 'center', gap: 4 },
  title: { fontSize: 20, fontWeight: '800', textAlign: 'center', letterSpacing: -0.3 },
  subtitle: { fontSize: 13.5, textAlign: 'center' },
  sliderBlock: { alignSelf: 'stretch', paddingHorizontal: 28, paddingTop: 26 },
  // 44 tall and the full width: the TARGET, not the line inside it.
  sliderHit: { height: 44, justifyContent: 'center' },
  sliderTrack: { height: 5, borderRadius: 3, overflow: 'hidden' },
  sliderFill: { height: '100%', borderRadius: 3 },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    borderWidth: 2,
    marginLeft: -THUMB / 2,
  },
  times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  time: { fontSize: 12, fontVariant: ['tabular-nums'], padding: 0 },
  keys: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 34,
    paddingTop: 24,
  },
  playKey: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
