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
import React, { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { ActivityIndicator, PixelRatio, StyleSheet, Text, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDecay,
  withTiming,
} from 'react-native-reanimated';
import { DOUBLE_TAP, TAP_SLOP } from '../../../utils/pressBehavior';
import { impactHaptic, tapHaptic } from '../../../utils/haptics';
import { boardBounds, itemAtPoint, stacked } from '../../../utils/canvasDoc';
import {
  MAX_SCALE, doubleTapScale, fitScale, itemsInRect, mediaUrlFor, panLimits,
  screenToWorld, tierFor, visibleWorldRect,
} from '../../../utils/canvasView';
import { clamp, focalTranslate, rubberClamp, rubberScale } from '../../../utils/zoomMath';

/** Deceleration for a flung board. The photo viewer's number — a canvas that
 *  coasts differently from the picture viewer in the same app is a canvas
 *  that feels like a different app. */
const DECAY = 0.993;
/** How long a spring back from a rubber-banded edge takes. */
const SETTLE_MS = 220;

/** The dot grid the desktop frets its canvas with, at canvas scale. */
const DOT_PITCH = 40;

/** The device's pixel density, read once: it is a property of the screen, not
 *  of a render, and it decides which size of each picture is worth fetching. */
const DPR = PixelRatio.get();

/**
 * One item.
 *
 * Sized and placed in WORLD units — the parent's transform is what turns those
 * into screen points, so nothing here has to know the zoom. That is the whole
 * reason the wall can be dragged about for free: one transform moves
 * everything, and no item re-lays-out while it does.
 */
function CanvasItemViewImpl({ item, centre, origin, theme, tier }) {
  const c = theme.colors;
  // Placed against the board's CENTRE, not its origin: the stage's transform
  // puts that centre at the middle of the screen, which is what makes an
  // offset of zero mean "centred" (utils/canvasView has the model).
  const box = {
    position: 'absolute',
    left: item.x - centre.x,
    top: item.y - centre.y,
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
          // Addressed by id, at the size this item is actually drawn — see
          // tierFor. A capability URL, which is also what resolves media
          // someone else shared with you (the by-ids listing would not).
          source={{ uri: mediaUrlFor(origin, item.ref, tier) }}
          // Keeps the view (and the picture already in it) when the tier
          // changes, so zooming in swaps to the bigger file without blinking
          // through an empty frame first.
          recyclingKey={`canvas:${item.id}`}
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

/**
 * Memoised, and that is load-bearing: the stage re-renders when a gesture
 * SETTLES (to re-pick tiers and re-cull), and without this every item on the
 * board would re-render with it. The props are all stable identities bar the
 * tier, so in practice only the items whose picture should change do.
 */
const CanvasItemView = React.memo(CanvasItemViewImpl);

export default function CanvasBoardView({ board, origin, theme, onOpenMedia }) {
  const c = theme.colors;
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const [settled, setSettled] = useState(false);

  const items = useMemo(() => stacked(board), [board]);
  /**
   * The view as it was when the last gesture SETTLED.
   *
   * Not the live one: the live scale and offset are shared values on the UI
   * thread precisely so panning costs the JS thread nothing, and reading them
   * per frame to re-pick a picture would hand all of that back. Settled is
   * also the right moment — nobody needs a sharper photo in the middle of a
   * fling, and swapping tiers mid-pinch is just thrash.
   */
  const [rest, setRest] = useState({ scale: 1, x: 0, y: 0 });
  const bounds = useMemo(() => boardBounds(board), [board]);
  /** What the view is measured from — see the model in utils/canvasView. */
  const centre = useMemo(() => (bounds
    ? { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 }
    : { x: 0, y: 0 }), [bounds]);

  /**
   * The live view: an offset from CENTRED, and a scale about the centre.
   *
   * Shared values, so a drag is a transform on the UI thread and the JS
   * thread is never in the loop — a board of two hundred items pans at the
   * same speed as an empty one. Zero means "the board is centred", which is
   * what makes zooming out land it in the middle every time (utils/canvasView
   * writes the model out).
   */
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);

  // Geometry the worklets need, mirrored where the UI thread can read it.
  const minScale = useSharedValue(1);
  const vw = useSharedValue(0);
  const vh = useSharedValue(0);
  const boardW = useSharedValue(0);
  const boardH = useSharedValue(0);

  // Per-gesture bookkeeping. The pan and the pinch keep SEPARATE baselines:
  // sharing them is the classic jump — the pinch rewrites the pan's origin
  // mid-gesture and the board leaps the moment a second finger lands.
  const panFromX = useSharedValue(0);
  const panFromY = useSharedValue(0);
  const panTransX = useSharedValue(0);
  const panTransY = useSharedValue(0);
  const rebase = useSharedValue(0);
  const pinchFromScale = useSharedValue(1);
  const pinchOriginX = useSharedValue(0);
  const pinchOriginY = useSharedValue(0);

  /**
   * The settle hands the view back to React, once, when the hand stops.
   *
   * DECLARED HERE, above everything that lists it as a dependency. A `const`
   * read from a dependency array before its own declaration is a temporal
   * dead zone — a ReferenceError thrown while rendering, which is a blank
   * screen and not a warning. It was below the gestures once and that is
   * exactly what it did.
   */
  const publishRest = useCallback((s, px, py) => {
    setRest((prev) => (
      // A gesture that changed nothing (a tap on bare canvas, a settle that
      // was already at rest) must not re-render the board.
      Math.abs(prev.scale - s) < 1e-4 && Math.abs(prev.x - px) < 0.5 && Math.abs(prev.y - py) < 0.5
        ? prev
        : { scale: s, x: px, y: py }
    ));
  }, []);

  /**
   * Where a flick ENDS is not where it was released, and the culling and the
   * picture sizes are chosen from where it ends — so this rides the decay's
   * COMPLETION rather than the release. Named and hoisted rather than written
   * inside the gesture: a worklet declared inside another worklet is a thing
   * to avoid asking of the toolchain when one named callback will do.
   * publishRest ignores a repeat, so both axes reporting costs nothing.
   */
  const landed = useCallback((finished) => {
    'worklet';
    if (finished) runOnJS(publishRest)(scale.value, tx.value, ty.value);
  }, [publishRest, scale, tx, ty]);

  /** The pan limits at a given scale, on the UI thread. Half the overflow,
   *  and zero on an axis that still fits — which pins that axis centred
   *  rather than letting the board drift in empty space. */
  const limitsFor = useCallback((s) => {
    'worklet';
    // The same function the tests measure and the fit uses — worklet-safe on
    // purpose, so the UI thread is not reimplementing it in a second place.
    return panLimits(
      { w: boardW.value, h: boardH.value },
      { w: vw.value, h: vh.value },
      s,
    );
  }, [boardH, boardW, vh, vw]);

  /** Bring the view back inside its bounds and its zoom range. Every gesture
   *  ends here: one place that guarantees a board cannot be left off-screen
   *  or inside-out. */
  const settle = useCallback(() => {
    'worklet';
    const next = Math.min(Math.max(scale.value, minScale.value), MAX_SCALE);
    if (next !== scale.value) scale.value = withTiming(next, { duration: SETTLE_MS });
    const lim = limitsFor(next);
    const restX = clamp(tx.value, lim.x);
    const restY = clamp(ty.value, lim.y);
    if (restX !== tx.value) tx.value = withTiming(restX, { duration: SETTLE_MS });
    if (restY !== ty.value) ty.value = withTiming(restY, { duration: SETTLE_MS });
    // Where the board came to rest, for the tier and the culling. One hop to
    // JS per gesture, not per frame.
    runOnJS(publishRest)(next, restX, restY);
  }, [limitsFor, minScale, publishRest, scale, tx, ty]);

  /** Put the whole board on the screen: centred, at the fit. */
  const fit = useCallback((size, animated) => {
    const s = fitScale(bounds, size);
    minScale.value = s;
    if (animated) {
      scale.value = withTiming(s, { duration: SETTLE_MS });
      tx.value = withTiming(0, { duration: SETTLE_MS });
      ty.value = withTiming(0, { duration: SETTLE_MS });
    } else {
      scale.value = s;
      tx.value = 0;
      ty.value = 0;
    }
    publishRest(s, 0, 0);
  }, [bounds, minScale, publishRest, scale, tx, ty]);

  /**
   * Measuring is ALL this does.
   *
   * It used to fit the board from inside the state updater below, which was
   * survivable while fitting only wrote shared values — and stopped being so
   * the moment the fit also published the resting view for the tiers and the
   * culling. A state updater must be PURE: React is free to call it more than
   * once for a single update, and a setState from inside one is an update
   * during a render, which is a crash rather than a warning. That is what took
   * the app down a beat after a canvas opened.
   */
  const onLayout = useCallback((e) => {
    const { width, height } = e.nativeEvent.layout;
    setViewport((prev) => (prev.w === width && prev.h === height ? prev : { w: width, h: height }));
  }, []);

  /**
   * Everything that FOLLOWS a measurement: the numbers the gesture worklets
   * read, and the fit itself.
   *
   * A layout effect, not an ordinary one, so the board is framed before the
   * frame is shown — an ordinary effect runs after paint and you would see a
   * frame of unfitted wall. It re-runs when the viewport changes shape (a
   * rotation: a board framed for portrait is off-screen in landscape) and when
   * the BOARD changes, which is what frames the next one you open.
   */
  useLayoutEffect(() => {
    vw.value = viewport.w;
    vh.value = viewport.h;
    boardW.value = bounds ? bounds.w : 0;
    boardH.value = bounds ? bounds.h : 0;
    if (!(viewport.w > 0) || !(viewport.h > 0)) return;
    fit(viewport, false);
    setSettled(true);
  }, [bounds, boardH, boardW, fit, vh, viewport, vw]);

  /**
   * Drag the board, with momentum and an edge that gives.
   *
   * Three things make this a surface rather than a slider, and all three are
   * what the photo viewer already does:
   *   - past the edge the drag only partly applies (rubberClamp) and springs
   *     back on release, so the end of the board announces itself;
   *   - a flick keeps going (withDecay), clamped to the same bounds, so a big
   *     wall can be crossed in one throw;
   *   - the baseline is RE-TAKEN whenever the number of fingers changes, so
   *     landing or lifting a second finger mid-drag does not jump.
   */
  const pan = useMemo(() => Gesture.Pan()
    .averageTouches(true)
    .onStart(() => {
      panFromX.value = tx.value;
      panFromY.value = ty.value;
      panTransX.value = 0;
      panTransY.value = 0;
      rebase.value = 0;
    })
    .onTouchesDown(() => { rebase.value = 1; })
    .onTouchesUp(() => { rebase.value = 1; })
    .onUpdate((e) => {
      if (rebase.value) {
        // A finger arrived or left: measure again from here, or the board
        // jumps by however far the centroid moved when it did.
        panFromX.value = tx.value;
        panFromY.value = ty.value;
        panTransX.value = e.translationX;
        panTransY.value = e.translationY;
        rebase.value = 0;
      }
      // While two fingers are down the PINCH owns the translation — it has
      // to, because the point under the fingers must stay under them. Letting
      // the pan write as well is the double-count that makes a two-finger
      // zoom slide away from the hand.
      if (e.numberOfPointers > 1) return;
      const lim = limitsFor(scale.value);
      tx.value = rubberClamp(panFromX.value + (e.translationX - panTransX.value), lim.x);
      ty.value = rubberClamp(panFromY.value + (e.translationY - panTransY.value), lim.y);
    })
    .onEnd((e) => {
      const lim = limitsFor(scale.value);
      // Inside the bounds a flick coasts; outside them there is nothing to
      // coast to and the settle below springs it back. `landed` publishes
      // where it actually comes to rest — see its declaration above.
      if (Math.abs(tx.value) <= lim.x) {
        tx.value = withDecay({ velocity: e.velocityX, clamp: [-lim.x, lim.x], deceleration: DECAY }, landed);
      }
      if (Math.abs(ty.value) <= lim.y) {
        ty.value = withDecay({ velocity: e.velocityY, clamp: [-lim.y, lim.y], deceleration: DECAY }, landed);
      }
      settle();
    }), [landed, limitsFor, panFromX, panFromY, panTransX, panTransY, rebase, scale, settle, tx, ty]);

  /**
   * Pinch: the point under your fingers stays under your fingers.
   *
   * It owns the translation for the duration, which is what keeps that true
   * when the fingers also MOVE — a two-finger drag-and-zoom is one gesture,
   * not two. Past either zoom limit the pinch gives rather than stopping
   * dead, and the end springs it back (rubberScale, as the photo viewer).
   */
  const pinch = useMemo(() => Gesture.Pinch()
    .onStart((e) => {
      pinchFromScale.value = scale.value;
      const fx = e.focalX - vw.value / 2;
      const fy = e.focalY - vh.value / 2;
      // The world point under the focus, in centre-relative units — the thing
      // that has to stay put.
      pinchOriginX.value = (fx - tx.value) / scale.value;
      pinchOriginY.value = (fy - ty.value) / scale.value;
    })
    .onUpdate((e) => {
      const next = rubberScale(pinchFromScale.value * e.scale, minScale.value, MAX_SCALE);
      const fx = e.focalX - vw.value / 2;
      const fy = e.focalY - vh.value / 2;
      scale.value = next;
      tx.value = focalTranslate(fx, pinchOriginX.value, next);
      ty.value = focalTranslate(fy, pinchOriginY.value, next);
    })
    .onEnd(() => {
      settle();
      // A finger may still be down with the pan mid-gesture; re-baselining
      // here means it picks up from where the pinch left the board.
      rebase.value = 1;
    }), [minScale, pinchFromScale, pinchOriginX, pinchOriginY, rebase, scale, settle, tx, ty, vh, vw]);

  /**
   * Double-tap: in on what you tapped, out to the whole board.
   *
   * Toggling, the way every photo viewer does — and zooming IN about the tap
   * rather than the centre, so the thing you tapped is the thing you get.
   */
  const zoomAbout = useCallback((px, py) => {
    'worklet';
    const target = doubleTapScale(scale.value, minScale.value, MAX_SCALE);
    const fx = px - vw.value / 2;
    const fy = py - vh.value / 2;
    const originX = (fx - tx.value) / scale.value;
    const originY = (fy - ty.value) / scale.value;
    const lim = limitsFor(target);
    const nextX = clamp(focalTranslate(fx, originX, target), lim.x);
    const nextY = clamp(focalTranslate(fy, originY, target), lim.y);
    scale.value = withTiming(target, { duration: SETTLE_MS });
    tx.value = withTiming(nextX, { duration: SETTLE_MS });
    ty.value = withTiming(nextY, { duration: SETTLE_MS });
    runOnJS(publishRest)(target, nextX, nextY);
  }, [limitsFor, minScale, publishRest, scale, tx, ty, vh, vw]);

  const thud = useCallback(() => impactHaptic('light'), []);

  /**
   * A tap landed at this point on the SCREEN — open whatever is under it.
   *
   * Hit-testing at the stage rather than hanging a handler on every item: a
   * touch handler on an image fires at the end of a DRAG as readily as a tap,
   * which is the app's "a tap is not a gesture" rule broken once per item.
   * The gesture has already decided the finger held still; this only has to
   * answer WHICH item, and that is arithmetic (utils/canvasDoc, under test).
   */
  const openAt = useCallback((px, py) => {
    if (!onOpenMedia) return;
    const world = screenToWorld({ x: px, y: py }, {
      viewport,
      bounds,
      scale: scale.value,
      x: tx.value,
      y: ty.value,
    });
    const hit = itemAtPoint(board, world);
    // Only a picture opens. A note or a task would want its own screen, and
    // this version does not pretend to be a way into them.
    if (hit?.kind !== 'media') return;
    tapHaptic();
    onOpenMedia(hit);
  }, [board, bounds, onOpenMedia, scale, tx, ty, viewport]);

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
    // limit a two-flick pan would zoom the board out from under the hand that
    // was moving it (utils/pressBehavior says why these numbers).
    .maxDuration(DOUBLE_TAP.maxDuration)
    .maxDelay(DOUBLE_TAP.maxDelay)
    .maxDistance(DOUBLE_TAP.maxDistance)
    .onEnd((e, success) => {
      'worklet';
      if (!success) return;
      zoomAbout(e.x, e.y);
      runOnJS(thud)();
    }), [thud, zoomAbout]);

  /**
   * Pan and pinch together, the taps racing them.
   *
   * The composition the photo viewer uses, for the same reasons: Simultaneous
   * lets one two-finger gesture scale AND move, and Exclusive puts the single
   * tap behind the double tap so a zoom does not also open whatever was under
   * the second touch.
   */
  const gesture = useMemo(
    () => Gesture.Race(
      Gesture.Simultaneous(pinch, pan),
      Gesture.Exclusive(doubleTap, singleTap),
    ),
    [doubleTap, singleTap, pan, pinch],
  );

  /**
   * What is worth mounting: the items in view, plus most of a screen in every
   * direction so the next pan finds them already there.
   *
   * At the fit this is the whole board, which is correct — at the fit every
   * item IS on screen. Zoomed into a corner of a two-hundred-item wall it is
   * the difference between decoding four pictures and decoding two hundred.
   */
  const drawn = useMemo(() => itemsInRect(items, visibleWorldRect({
    viewport,
    centre,
    scale: rest.scale,
    x: rest.x,
    y: rest.y,
  })), [centre, items, rest, viewport]);

  /**
   * The transform, in the order the model names: to the viewport's centre,
   * then the view's offset, then scale about that point. The items inside are
   * placed relative to the BOARD's centre (the world layer below), which is
   * what makes "no offset" mean "centred".
   */
  const worldStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: vw.value / 2 + tx.value },
      { translateY: vh.value / 2 + ty.value },
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
                left: bounds.x - centre.x - DOT_PITCH,
                top: bounds.y - centre.y - DOT_PITCH,
                width: bounds.w + DOT_PITCH * 2,
                height: bounds.h + DOT_PITCH * 2,
                borderColor: c.border,
              }]}
            />
          ) : null}
          {drawn.map((item) => (
            <CanvasItemView
              key={item.id}
              item={item}
              centre={centre}
              origin={origin}
              theme={theme}
              tier={tierFor(item.w, rest.scale, DPR)}
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
