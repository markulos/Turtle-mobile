/**
 * PhotoViewer — the vault's full-screen viewer. The shell.
 *
 * Modal → GestureHandlerRootView (a Modal is its own native tree; the app-root
 * one does not reach it) → backdrop → ViewerStage (the one gesture tree, with
 * the active page ±1 inside) → ViewerChrome → the sheets → whatever overlays
 * the gallery needs inside this Modal (share chooser, "preparing" card).
 *
 * The shell owns exactly the state that changes AT REST: the settled index,
 * whether the chrome is shown, whether the photo is zoomed, which sheet is
 * open, the video buttons' state. Everything a finger moves is a shared value
 * (stageValues.js). JS is entered once at pan begin (dragStore true), once at
 * rest (settled index → stores → onIndexSettled), once per zoom flip, and on
 * committed actions — never per frame.
 *
 * Data contract (spec §3.1): `items` is the same reversed list the old
 * FlatList paged; `initialIndex` indexes it; `origin` is the tap point the
 * pop grows from; the three stores are MediaGallery's (activeStore drives the
 * HD manager and the video pages, hdStore the page URIs, dragStore the HD
 * flush gate); the callbacks are MediaGallery's optimistic actions.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, Dimensions, Modal, PixelRatio, StatusBar, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import {
  CHROME_FADE_MS,
  CLOSE_MS,
  OPEN_MS,
  clampIndex,
  dismissBackdrop,
} from '../../../../utils/viewerGestureMath';
import { MAX_SCALE, nativeMaxScale } from '../../../../utils/zoomMath';
import { useOfflineMedia } from '../../../../context/OfflineMediaContext';
import DetailsSheet from './DetailsSheet';
import TagsSheet from './TagsSheet';
import ViewerChrome from './ViewerChrome';
import ViewerPage from './ViewerPage';
import ViewerStage from './ViewerStage';
import { useStageValues } from './stageValues';

const { width: WIN_W, height: WIN_H } = Dimensions.get('window');
const HOME_SPRING = { damping: 26, stiffness: 260, mass: 1 };
/**
 * iOS Photos' shared-element curve: leaves fast, lands soft — most of the
 * distance is covered in the first half, the last frames settle onto the
 * tile. The same curve opens and flies back.
 */
const SWIFT = Easing.bezier(0.2, 0.9, 0.25, 1);
const OPEN_TIMING = { duration: 300, easing: SWIFT };
const CLOSE_TIMING = { duration: CLOSE_MS, easing: Easing.in(Easing.quad) };
/** The photo flying back into its grid cell. */
const FLY_TIMING = { duration: 340, easing: SWIFT };
/** A cell measurement that hasn't answered by then closes without a target. */
const MEASURE_GRACE_MS = 120;
const FALLBACK_SCALE = 0.85;
const noop = () => {};

/**
 * Where the stage should grow from / retreat to for a grid cell rect
 * ({ x, y } = the cell's centre in window coords, width/height = its size):
 * the offset from screen centre, and the scale that makes the letterboxed
 * photo about the cell's width. Thumbnails are cover-cropped squares, so this
 * is an approximation, but it reads as the picture becoming its own tile.
 * A bare tap point (no size) keeps the old centre pop.
 */
function originFor(rect, item) {
  if (!rect) return { x: 0, y: 0, scale: FALLBACK_SCALE };
  const x = rect.x - WIN_W / 2;
  const y = rect.y - WIN_H / 2;
  if (!(rect.width > 0)) return { x, y, scale: FALLBACK_SCALE };
  const aspect = item && item.width > 0 && item.height > 0 ? item.width / item.height : 0;
  const containW = aspect > 0 ? Math.min(WIN_W, WIN_H * aspect) : WIN_W;
  const containH = aspect > 0 ? Math.min(WIN_H, WIN_W / aspect) : WIN_H;
  // The page crops itself to a square of the photo's SHORT side as the pop
  // closes (ViewerPage's frame), so that square is what has to land on the
  // tile: scale it to the tile's width and the picture ends tile-shaped,
  // cover-cropped, on the tile.
  const side = Math.max(1, Math.min(containW, containH));
  const scale = Math.min(1, Math.max(0.08, rect.width / side));
  return { x, y, scale };
}

export default function PhotoViewer({
  visible,
  items,
  initialIndex = 0,
  origin = null,
  activeStore,
  hdStore,
  dragStore,
  getFullUrl,
  tagSuggestions,
  onIndexSettled,
  onCommitTags,
  onToggleFavourite,
  onShare,
  onEditImage,
  onClosed,
  /** (mediaId) => Promise<{ x, y, width, height } | null> — the grid cell's window rect, for the fly-back. */
  measureCell,
  theme,
  insets,
  bottomInset = 24,
  children,
}) {
  const sv = useStageValues(WIN_W, WIN_H);
  const offline = useOfflineMedia();
  const list = items || [];
  const count = list.length;

  const [activeIndex, setActiveIndex] = useState(() => clampIndex(initialIndex, count));
  const [chromeVisible, setChromeVisible] = useState(true);
  const [zoomed, setZoomed] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [videoState, setVideoState] = useState(null);

  const itemsRef = useRef(list);
  itemsRef.current = list;
  const activeIdRef = useRef(null);
  const closingRef = useRef(false);
  const videoControlsRef = useRef(null);
  const aspectByIdRef = useRef(new Map());

  const safeIndex = clampIndex(activeIndex, count);
  const activeItem = count ? list[safeIndex] : null;
  // The details sheet takes the whole screen for itself: every other overlay
  // (the chrome bands) goes away while it is up and comes back when it closes.
  const chromeShown = chromeVisible && !zoomed && !detailsOpen;

  // ── mirrors into the shared values (all at rest) ─────────────────────────
  useEffect(() => { sv.count.value = count; }, [sv, count]);

  useEffect(() => {
    if (!activeItem) return;
    const hasMeta = activeItem.width > 0 && activeItem.height > 0;
    sv.aspect.value = hasMeta
      ? activeItem.width / activeItem.height
      : (aspectByIdRef.current.get(activeItem.id) || 0);
    sv.maxScale.value = activeItem.width > 0
      ? nativeMaxScale(activeItem.width, WIN_W, PixelRatio.get())
      : MAX_SCALE;
    sv.zoomEnabled.value = activeItem.type === 'video' ? 0 : 1;
  }, [sv, activeItem]);

  useEffect(() => {
    sv.chrome.value = withTiming(chromeShown ? 1 : 0, { duration: CHROME_FADE_MS });
  }, [sv, chromeShown]);

  // ── open ─────────────────────────────────────────────────────────────────
  // Layout effect so the reset state is committed before the first paint of
  // the open Modal — the pages mount around the right index on frame one.
  useLayoutEffect(() => {
    if (!visible) return;
    const start = clampIndex(initialIndex, itemsRef.current.length);
    const first = itemsRef.current[start] || null;
    closingRef.current = false;
    activeIdRef.current = first ? first.id : null;
    videoControlsRef.current = null;

    cancelAnimation(sv.pagerX);
    cancelAnimation(sv.openProgress);
    cancelAnimation(sv.dragX);
    cancelAnimation(sv.dragY);
    sv.pagerX.value = 0;
    sv.activeIndex.value = start;
    sv.zoomIndex.value = start;
    sv.scale.value = 1;
    sv.tx.value = 0;
    sv.ty.value = 0;
    sv.dragX.value = 0;
    sv.dragY.value = 0;
    sv.settling.value = 0;
    sv.chrome.value = 1;
    const from = originFor(origin, first);
    sv.originX.value = from.x;
    sv.originY.value = from.y;
    sv.originScale.value = from.scale;
    sv.closing.value = 0;
    sv.openProgress.value = 0;
    sv.openProgress.value = withTiming(1, OPEN_TIMING);

    setActiveIndex(start);
    setChromeVisible(true);
    setZoomed(false);
    setTagsOpen(false);
    setDetailsOpen(false);
    setVideoState(null);
    if (first) activeStore?.set(first.id);
    // `initialIndex` and `origin` are written by the gallery in the same
    // render that flips `visible`; they must not re-run the open sequence on
    // their own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // ── close ────────────────────────────────────────────────────────────────
  const finishClose = useCallback(() => {
    dragStore?.set(false);
    onClosed?.();
  }, [dragStore, onClosed]);

  // `vx`/`vy` arrive from a committed pull (the stage's release velocity);
  // the back button hands a press event and the pinch nothing — both read as
  // zero, so the retreat starts from rest in those cases.
  const close = useCallback((vx, vy) => {
    if (closingRef.current) return;
    closingRef.current = true;
    setTagsOpen(false);
    setDetailsOpen(false);
    cancelAnimation(sv.pagerX);
    sv.settling.value = 0;
    const velocityX = typeof vx === 'number' && Number.isFinite(vx) ? vx : 0;
    const velocityY = typeof vy === 'number' && Number.isFinite(vy) ? vy : 0;
    const id = activeIdRef.current;
    const item = itemsRef.current.find((it) => it && it.id === id) || null;

    // iOS Photos: the picture flies back INTO its grid cell — the cell of the
    // photo on screen now, not the one that was tapped. The gallery measures
    // it (the cell may be a different one after swiping); with no answer (cell
    // recycled off-screen, or nothing to measure) the photo shrinks in place
    // while the backdrop clears.
    const run = (rect) => {
      sv.closing.value = 1;
      const to = originFor(rect, item);
      sv.originX.value = to.x;
      sv.originY.value = to.y;
      sv.originScale.value = to.scale;
      if (rect) {
        // Unwind the pull on the same clock as the retreat so both arrive
        // in the cell together.
        sv.dragX.value = withTiming(0, FLY_TIMING);
        sv.dragY.value = withTiming(0, FLY_TIMING);
        sv.openProgress.value = withTiming(0, FLY_TIMING, () => {
          'worklet';
          runOnJS(finishClose)();
        });
        return;
      }
      sv.dragX.value = withSpring(0, { ...HOME_SPRING, velocity: velocityX });
      sv.dragY.value = withSpring(0, { ...HOME_SPRING, velocity: velocityY });
      sv.openProgress.value = withTiming(0, CLOSE_TIMING, () => {
        'worklet';
        runOnJS(finishClose)();
      });
    };

    if (!measureCell || !id) { run(null); return; }
    let started = false;
    const start = (rect) => { if (started) return; started = true; run(rect || null); };
    try {
      Promise.resolve(measureCell(id)).then(start, () => start(null));
    } catch { start(null); }
    // Never hang a close on a measurement that doesn't come back.
    setTimeout(() => start(null), MEASURE_GRACE_MS);
  }, [sv, finishClose, measureCell]);

  // The active photo disappeared from the list (deleted underneath us).
  useEffect(() => {
    if (!visible || closingRef.current) return;
    const id = activeIdRef.current;
    if (id && !list.some((it) => it && it.id === id)) close();
  }, [visible, list, close]);

  // ── stage callbacks (stable; the gesture tree is rebuilt if these change) ──
  const handleDragBegin = useCallback(() => {
    dragStore?.set(true);
  }, [dragStore]);

  const handleRest = useCallback((index) => {
    const current = itemsRef.current;
    const i = clampIndex(index, current.length);
    const item = current[i] || null;
    activeIdRef.current = item ? item.id : null;
    setActiveIndex(i);
    if (item) activeStore?.set(item.id);
    // Video controls belong to the page that is active NOW; a photo has none.
    if (!item || item.type !== 'video') { videoControlsRef.current = null; setVideoState(null); }
    dragStore?.set(false);
    if (item) onIndexSettled?.(item, i);
  }, [activeStore, dragStore, onIndexSettled]);

  const handleOpenDetails = useCallback(() => setDetailsOpen(true), []);
  const handleSingleTap = useCallback(() => setChromeVisible((v) => !v), []);
  const handleZoomedChange = useCallback((z) => setZoomed(!!z), []);

  // ── page callbacks ───────────────────────────────────────────────────────
  const handleAspect = useCallback((id, aspect) => {
    aspectByIdRef.current.set(id, aspect);
    if (id === activeIdRef.current) sv.aspect.value = aspect;
  }, [sv]);

  // The active video page lends the shell its player (controls) and streams
  // its truth (state: playing / muted / time / duration, from the player's
  // own events). Only the ACTIVE page's reports are taken.
  const handleVideoControls = useCallback((id, controls) => {
    if (controls) {
      if (id === activeIdRef.current) videoControlsRef.current = controls;
    } else if (id === activeIdRef.current) {
      videoControlsRef.current = null;
      setVideoState(null);
    }
  }, []);
  const handleVideoState = useCallback((id, state) => {
    if (id !== activeIdRef.current) return;
    setVideoState(state);
  }, []);
  const handleSeek = useCallback((seconds) => {
    videoControlsRef.current?.seekTo?.(seconds);
  }, []);
  const handleScrubStart = useCallback(() => { videoControlsRef.current?.beginScrub?.(); }, []);
  const handleScrubEnd = useCallback(() => { videoControlsRef.current?.endScrub?.(); }, []);

  // ── chrome callbacks ─────────────────────────────────────────────────────
  const handleEdit = useCallback(() => { if (activeItem) onEditImage?.(activeItem); }, [activeItem, onEditImage]);
  const handleTags = useCallback(() => { setDetailsOpen(false); setTagsOpen(true); }, []);
  const handleShare = useCallback(() => { if (activeItem) onShare?.(activeItem); }, [activeItem, onShare]);

  /**
   * Keep / unkeep this picture.
   *
   * The DISPLAY tier is what gets saved, not the original: it is the exact
   * ~1600px JPEG this viewer already paints at HD, so the offline copy renders
   * identically to the online one and a 25 MB HEIC original doesn't buy a
   * phone-screen view anything. (Saving originals instead is a one-line change
   * here — `rawUrl || url` — if that's ever the call.)
   */
  const handleToggleOffline = useCallback(async () => {
    const item = activeItem;
    if (!item?.id) return;
    if (offline.isSaved(item.id)) { await offline.remove(item.id); return; }
    const ok = await offline.save(item, getFullUrl(`/api/media/display/${item.id}`));
    if (!ok) Alert.alert('Not saved', 'Could not save this picture for offline. Check the connection to your pond and try again.');
  }, [activeItem, offline, getFullUrl]);
  const handleFavourite = useCallback(() => { if (activeItem) onToggleFavourite?.(activeItem); }, [activeItem, onToggleFavourite]);
  const handleTogglePlay = useCallback(() => { videoControlsRef.current?.togglePlay?.(); }, []);
  const handleToggleMute = useCallback(() => { videoControlsRef.current?.toggleMute?.(); }, []);
  const handleFullscreen = useCallback(() => { videoControlsRef.current?.enterFullscreen?.(); }, []);
  const closeTags = useCallback(() => setTagsOpen(false), []);
  const closeDetails = useCallback(() => setDetailsOpen(false), []);
  const editTagsFromDetails = useCallback(() => { setDetailsOpen(false); setTagsOpen(true); }, []);

  // ── pages: the active one and its two neighbours, keyed by media id ──────
  const pages = useMemo(() => {
    const out = [];
    if (!count) return out;
    const from = Math.max(0, safeIndex - 1);
    const to = Math.min(count - 1, safeIndex + 1);
    for (let i = from; i <= to; i += 1) {
      const item = list[i];
      if (!item || !item.id) continue;
      out.push(
        <ViewerPage
          key={item.id}
          item={item}
          index={i}
          sv={sv}
          activeStore={activeStore}
          hdStore={hdStore}
          getFullUrl={getFullUrl}
          onAspect={handleAspect}
          onVideoControls={handleVideoControls}
          onVideoState={handleVideoState}
        />,
      );
    }
    return out;
  }, [list, count, safeIndex, sv, activeStore, hdStore, getFullUrl, handleAspect, handleVideoControls, handleVideoState]);

  const offlineState = activeItem?.id
    ? (offline.isBusy(activeItem.id) ? 'saving' : (offline.isSaved(activeItem.id) ? 'saved' : 'none'))
    : 'none';

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: sv.openProgress.value * dismissBackdrop(sv.dragY.value, sv.height),
  }), [sv]);

  return (
    <Modal
      visible={!!visible}
      transparent
      animationType="none"
      statusBarTranslucent
      hardwareAccelerated
      onRequestClose={close}
    >
      <GestureHandlerRootView style={styles.root} testID="photo-viewer">
        <StatusBar hidden={!chromeShown} animated />
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]} />

        <ViewerStage
          sv={sv}
          onDragBegin={handleDragBegin}
          onRest={handleRest}
          onDismiss={close}
          onEdgeBack={close}
          onOpenDetails={handleOpenDetails}
          onSingleTap={handleSingleTap}
          onZoomedChange={handleZoomedChange}
          onPinchDismiss={close}
        >
          {pages}
        </ViewerStage>

        <ViewerChrome
          sv={sv}
          item={activeItem}
          shown={chromeShown}
          insets={insets || { top: 0, bottom: 0 }}
          bottomInset={bottomInset}
          onBack={close}
          onEdit={handleEdit}
          onTags={handleTags}
          onShare={handleShare}
          onToggleFavourite={handleFavourite}
          offlineState={offlineState}
          onToggleOffline={offline.enabled ? handleToggleOffline : null}
          video={activeItem?.type === 'video' ? videoState : null}
          onTogglePlay={handleTogglePlay}
          onToggleMute={handleToggleMute}
          onFullscreen={handleFullscreen}
          onSeek={handleSeek}
          onScrubStart={handleScrubStart}
          onScrubEnd={handleScrubEnd}
        />

        {children}

        {/* Sheets go LAST (and carry their own zIndex) so they draw over every
            other overlay in this Modal: the chrome, the share chooser, the
            "preparing" card. Tags is the very top — it can open from Details. */}
        {detailsOpen && !!activeItem && (
          <DetailsSheet
            item={activeItem}
            onEditTags={editTagsFromDetails}
            onClose={closeDetails}
            theme={theme}
          />
        )}
        {tagsOpen && !!activeItem && (
          <TagsSheet
            item={activeItem}
            suggestions={tagSuggestions || []}
            onCommitTags={onCommitTags || noop}
            onClose={closeTags}
            theme={theme}
          />
        )}
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  backdrop: {
    backgroundColor: '#000',
  },
});
