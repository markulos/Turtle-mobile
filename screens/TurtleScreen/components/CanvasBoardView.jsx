/**
 * One canvas board, in your hand.
 *
 * The desktop's canvas is a freeform wall — photos, notes, tasks and text
 * sitting where you put them. This draws the same wall from the same data
 * (utils/canvasDoc reads it out of `users.settings.canvasBoards`), and lets
 * you move AROUND it: drag to pan, pinch to zoom, double-tap to fit it back
 * on the screen.
 *
 * ─── It does not move anything ON the wall ─────────────────────────────────
 *
 * Reading is the whole of this version, deliberately. The desktop saves a
 * canvas by rewriting the whole boards array — last writer wins — which is
 * fine between two browser tabs and is not fine with a phone in your pocket
 * beside a desktop you left open. So the phone shows you the board and keeps
 * its hands off it until that is answered. Nothing here can write; there is
 * no code that could.
 *
 * ─── Why this is a plain view tree and not a drawing surface ───────────────
 *
 * Because the desktop's is too: it positions ordinary elements inside one
 * transformed container rather than painting into a canvas. So the same board
 * is the same handful of views here — an image, a card, a line of text — and
 * the zoom is one transform on their parent. No new dependency, nothing
 * native, and the phone gets it over the air.
 *
 * ─── What a phone cannot show ──────────────────────────────────────────────
 *
 * A PDF item on the desktop renders its live page through a web PDF engine.
 * There is no such engine here without a native dependency, so a PDF shows as
 * its own card with the page number — honest about being a document you
 * placed rather than pretending to be a blank sheet.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { DOUBLE_TAP, TAP_SLOP } from '../../../utils/pressBehavior';
import { impactHaptic, tapHaptic } from '../../../utils/haptics';
import {
  MAX_ZOOM, MIN_ZOOM, boardBounds, fitView, itemAtPoint, stacked, toWorld,
} from '../../../utils/canvasDoc';

/** The dot grid the desktop frets its canvas with, at canvas scale. */
const DOT_PITCH = 40;

/**
 * One item.
 *
 * Sized and placed in WORLD units — the parent's transform is what turns those
 * into screen points, so nothing here has to know the zoom. That is the whole
 * reason the wall can be dragged about for free: one transform moves
 * everything, and no item re-lays-out while it does.
 */
function CanvasItemView({ item, origin, theme }) {
  const c = theme.colors;
  const box = {
    position: 'absolute',
    left: item.x,
    top: item.y,
    width: item.w,
    height: item.h,
  };

  if (item.kind === 'media') {
    return (
      <View
        testID={`canvas-item-${item.id}`}
        style={[box, styles.mediaFrame, { borderColor: c.border, backgroundColor: c.surfaceElevated }]}
      >
        <ExpoImage
          // The display tier, by id — a capability URL that resolves media
          // someone else shared with you too, which the by-ids listing does
          // not. Exactly what the desktop's <img> loads.
          source={{ uri: `${origin}/api/media/display/${encodeURIComponent(item.ref)}` }}
          style={StyleSheet.absoluteFill}
          // The board's author chose this frame's shape; filling it is what
          // the desktop does and what makes a moodboard read as one.
          contentFit="cover"
          transition={120}
          cachePolicy="memory-disk"
          accessible={!!item.label}
          accessibilityLabel={item.label || undefined}
        />
        {item.page ? (
          <View style={[styles.pageChip, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Icon name="file-document-outline" size={11} color={c.textSecondary} />
            <Text style={[styles.pageChipText, { color: c.textSecondary }]}>p{item.page}</Text>
          </View>
        ) : null}
      </View>
    );
  }

  if (item.kind === 'text') {
    return (
      <View style={[box, styles.textItem]} testID={`canvas-item-${item.id}`}>
        <Text style={[styles.textBody, { color: c.textPrimary }]}>{item.text || ''}</Text>
      </View>
    );
  }

  // A note or a task: the card, with the caption the board cached when it was
  // placed. The phone draws the LABEL and does not fetch the note — a board
  // has to paint before any request returns, which is the same reason the
  // label is stored at all.
  const isTask = item.kind === 'task';
  return (
    <View
      testID={`canvas-item-${item.id}`}
      style={[box, styles.card, { backgroundColor: c.surfaceElevated, borderColor: c.border }]}
    >
      <Icon
        name={isTask ? 'checkbox-marked-circle-outline' : 'text'}
        size={18}
        color={isTask ? (c.accentSuccess || c.accentInfo) : c.textMuted}
      />
      <Text style={[styles.cardLabel, { color: c.textPrimary }]} numberOfLines={6}>
        {item.label || (isTask ? 'Task' : 'Note')}
      </Text>
    </View>
  );
}

export default function CanvasBoardView({ board, origin, theme, onOpenMedia }) {
  const c = theme.colors;
  const [viewport, setViewport] = useState({ w: 0, h: 0 });

  const items = useMemo(() => stacked(board), [board]);
  const bounds = useMemo(() => boardBounds(board), [board]);

  // The live view. Shared values, so a drag is a UI-thread transform and the
  // JS thread is never in the loop — a board of two hundred items pans at the
  // same speed as an empty one.
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  // What they were when the current gesture began.
  const startScale = useSharedValue(1);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const [settled, setSettled] = useState(false);

  /** Put the whole board on the screen. The first thing that happens, and
   *  what a double-tap goes back to. */
  const fit = useCallback((size, animated) => {
    const view = fitView(bounds, size);
    if (animated) {
      scale.value = withTiming(view.scale, { duration: 220 });
      tx.value = withTiming(view.x, { duration: 220 });
      ty.value = withTiming(view.y, { duration: 220 });
    } else {
      scale.value = view.scale;
      tx.value = view.x;
      ty.value = view.y;
    }
  }, [bounds, scale, tx, ty]);

  const onLayout = useCallback((e) => {
    const { width, height } = e.nativeEvent.layout;
    setViewport((prev) => {
      if (prev.w === width && prev.h === height) return prev;
      // Fit on the first real measurement, and again if the window changes
      // shape (a rotation) — a board framed for portrait is off-screen in
      // landscape.
      fit({ w: width, h: height }, false);
      return { w: width, h: height };
    });
    setSettled(true);
  }, [fit]);

  const pan = useMemo(() => Gesture.Pan()
    .averageTouches(true)
    .onStart(() => { startX.value = tx.value; startY.value = ty.value; })
    .onUpdate((e) => {
      tx.value = startX.value + e.translationX;
      ty.value = startY.value + e.translationY;
    }), [startX, startY, tx, ty]);

  const pinch = useMemo(() => Gesture.Pinch()
    .onStart(() => { startScale.value = scale.value; startX.value = tx.value; startY.value = ty.value; })
    .onUpdate((e) => {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, startScale.value * e.scale));
      // Zoom about the FOCAL point, so the board grows under the fingers
      // rather than away from them: the world point beneath the focus has to
      // stay beneath it.
      const k = next / startScale.value;
      tx.value = e.focalX - (e.focalX - startX.value) * k;
      ty.value = e.focalY - (e.focalY - startY.value) * k;
      scale.value = next;
    }), [scale, startScale, startX, startY, tx, ty]);

  const refit = useCallback(() => {
    impactHaptic('light');
    fit(viewport, true);
  }, [fit, viewport]);

  /**
   * A tap landed at this point on the SCREEN — open whatever is under it.
   *
   * Hit-testing at the stage rather than hanging a handler on every item:
   * a touch handler on an image fires at the end of a DRAG as readily as a
   * tap, which is the app's "a tap is not a gesture" rule broken once per
   * item. The gesture below has already decided the finger held still; this
   * only has to answer WHICH item, and that is arithmetic (utils/canvasDoc,
   * under test).
   */
  const openAt = useCallback((px, py) => {
    if (!onOpenMedia) return;
    const world = toWorld({ x: px, y: py }, { scale: scale.value, x: tx.value, y: ty.value });
    const hit = itemAtPoint(board, world);
    // Only a picture opens. A note or a task would want its own screen, and
    // this version does not pretend to be a way into them.
    if (hit?.kind !== 'media') return;
    tapHaptic();
    onOpenMedia(hit);
  }, [board, onOpenMedia, scale, tx, ty]);

  const singleTap = useMemo(() => Gesture.Tap()
    .numberOfTaps(1)
    .maxDuration(260)
    // Tighter than the double-tap, as the photo viewer's is: a tap that
    // travelled is a pan that failed, and must not open a picture.
    .maxDistance(TAP_SLOP)
    .onEnd((e, success) => {
      'worklet';
      if (!success) return;
      runOnJS(openAt)(e.x, e.y);
    }), [openAt]);

  const doubleTap = useMemo(() => Gesture.Tap()
    .numberOfTaps(2)
    // The house rule — two touches, quick and STILL. Without the distance
    // limit a two-flick pan would re-fit the board out from under the hand
    // that was moving it (utils/pressBehavior says why these numbers).
    .maxDuration(DOUBLE_TAP.maxDuration)
    .maxDelay(DOUBLE_TAP.maxDelay)
    .maxDistance(DOUBLE_TAP.maxDistance)
    .onEnd(() => { 'worklet'; runOnJS(refit)(); }), [refit]);

  /**
   * Pan and pinch together, the taps racing them.
   *
   * The same composition the photo viewer uses: Exclusive puts the single tap
   * BEHIND the double tap, so fitting the board does not also open whatever
   * was under your second touch. Both taps fail the moment a finger travels,
   * which is what leaves the pan free.
   */
  const gesture = useMemo(
    () => Gesture.Race(
      Gesture.Simultaneous(pinch, pan),
      Gesture.Exclusive(doubleTap, singleTap),
    ),
    [doubleTap, singleTap, pan, pinch],
  );

  const worldStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <View style={[styles.stage, { backgroundColor: c.background }]} onLayout={onLayout} testID="canvas-stage">
        {/* The world. One transform, every item inside it — the items never
            re-lay-out for a pan or a zoom. */}
        <Reanimated.View style={[styles.world, worldStyle]} pointerEvents="box-none">
          {bounds ? (
            <View
              pointerEvents="none"
              style={[styles.fret, {
                left: bounds.x - DOT_PITCH,
                top: bounds.y - DOT_PITCH,
                width: bounds.w + DOT_PITCH * 2,
                height: bounds.h + DOT_PITCH * 2,
                borderColor: c.border,
              }]}
            />
          ) : null}
          {items.map((item) => (
            <CanvasItemView
              key={item.id}
              item={item}
              origin={origin}
              theme={theme}
            />
          ))}
        </Reanimated.View>

        {/* Only while there is something to FRAME. An empty board has nothing
            to measure and nothing to wait for, so showing it a spinner would
            be a lie it never stops telling. */}
        {!settled && items.length > 0 ? (
          <View style={styles.centre} pointerEvents="none">
            <ActivityIndicator size="small" color={c.textMuted} />
          </View>
        ) : null}

        {items.length === 0 ? (
          <View style={styles.centre} pointerEvents="none">
            <Icon name="shape-outline" size={38} color={c.textMuted} />
            <Text style={[styles.emptyText, { color: c.textSecondary }]}>
              Nothing on this canvas yet. Arrange one on the desktop and it will be here.
            </Text>
          </View>
        ) : null}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, overflow: 'hidden' },
  // Zero-sized on purpose: it is an ORIGIN, not a box. Every item is
  // absolutely placed against it in world units, so the world has no extent of
  // its own to keep in step with the board's.
  world: { position: 'absolute', left: 0, top: 0, width: 0, height: 0 },
  // The faint frame the desktop's fretted background reads as, at this scale:
  // one rule around the whole arrangement, so a pan that leaves the items
  // behind still says which way home is.
  fret: { position: 'absolute', borderWidth: 1, borderRadius: 8, opacity: 0.5 },
  mediaFrame: { borderRadius: 6, overflow: 'hidden', borderWidth: 1 },
  card: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    gap: 8,
  },
  cardLabel: { fontSize: 15, fontWeight: '500', lineHeight: 20 },
  textItem: { justifyContent: 'center' },
  textBody: { fontSize: 16, lineHeight: 22 },
  pageChip: {
    position: 'absolute', left: 6, bottom: 6,
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 999, borderWidth: StyleSheet.hairlineWidth,
  },
  pageChipText: { fontSize: 10, fontWeight: '700' },
  centre: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 40,
  },
  emptyText: { fontSize: 13, textAlign: 'center', lineHeight: 19 },
});
