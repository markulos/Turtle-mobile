/**
 * viewerMedia — the photo viewer's MEDIA CELL layer.
 *
 * Two self-contained pieces:
 *   • FullScreenVideoPlayer — expo-video cell for the pager
 *   • ImageViewer           — the zoomable photo cell (ZoomableView: pinch,
 *     pan, double-tap; zoom reported up via onZoomScaleChange)
 *
 * ── The architecture, and why it looks like this ─────────────────────────
 * A cell is DUMB ON PURPOSE. It renders exactly one expo-image whose URI is a
 * pure function of two inputs: the media row, and a per-photo "HD is warm"
 * flag it reads from a store. Nothing else. No dwell timers, no commit
 * latches, no drag subscriptions, no cancellation effects — every one of
 * those lived in this file once, and every one of them was React state that
 * could fire on the exact frame a finger landed.
 *
 * All HD orchestration lives in ONE place, MediaGallery's viewer HD manager:
 * it prefetches the ~1600px display variant into expo-image's disk cache in
 * the background (a prefetch touches no view, so it cannot cost a frame), and
 * flips the per-photo flag ONLY while the pager is quiet. So the URI swap a
 * cell renders is always (a) from a warm cache and (b) on an idle frame.
 * "Swipeable at any moment" stops being a timing fix and becomes structural:
 * there is nothing left in a cell that CAN run during a gesture.
 *
 * That is also how iOS Photos does it: derivatives are prepared before you
 * look at them, and the visible surface only ever swaps to something already
 * decoded-adjacent. The fast layer here is the compressed JPEG (thumbnail
 * fallback — never the raw: a 25MB HEIC "fast layer" is how tunnel rows once
 * streamed originals just to fill a screen for half a second).
 *
 * History worth keeping (don't repeat):
 *   • Two stacked <Image>s with a crossfade + fast-layer unmount = a texture
 *     destroy on the UI thread 300ms after every HD arrival. Removed.
 *   • Per-cell subscriptions to the pager drag store = N re-renders on the
 *     frame the finger landed (device-measured: median 150ms JS block).
 *     Removed — cells no longer know drags exist.
 *   • `useStoreValue(activeStore) === mediaId` put the active ID in state, so
 *     every page change re-rendered every mounted cell. useIsActive stores
 *     the derived boolean, so React bails out on unchanged cells.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, Pressable, TouchableOpacity, Dimensions, PixelRatio,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useMusicPlayer } from '../../../context/MusicPlayerContext';
import ZoomableView from './ZoomableView';
import { MAX_SCALE, nativeMaxScale } from '../../../utils/zoomMath';

const { width } = Dimensions.get('window');

// Full-screen video player component.
// Active-page awareness comes from the shared store (see useIsActive), so a
// page change re-renders this cell only when ITS active/inactive state flips.
const FullScreenVideoPlayer = ({ sourceUrl, mediaId, activeStore, styles, insets }) => {
  const isActive = useIsActive(activeStore, mediaId);
  const player = useVideoPlayer(sourceUrl, player => {
    player.loop = true;
    player.muted = true;
    // Opening a photo or a silent video preview must NOT stop whatever is
    // playing in the music player. expo-video's default mixing mode is 'auto',
    // which claims the audio session as soon as the player starts — muted or
    // not — so simply browsing the vault killed the music. Muted playback mixes;
    // taking the session is deferred to the moment the user asks for sound.
    player.audioMixingMode = 'mixWithOthers';
  });
  const [isPlaying, setIsPlaying] = useState(isActive);
  const [isMuted, setIsMuted] = useState(true);
  const { pause: pauseMusic } = useMusicPlayer();

  useEffect(() => {
    if (isActive) { player.play(); setIsPlaying(true); }
    else { player.pause(); player.currentTime = 0; player.muted = true; setIsMuted(true); setIsPlaying(false); }
  }, [isActive, player]);

  const togglePlay = () => { isPlaying ? player.pause() : player.play(); setIsPlaying(!isPlaying); };
  // Unmuting is the ONLY thing that stops the music: the user has explicitly
  // asked to hear this video, so the video takes the audio session and the
  // music player is stopped outright rather than left to be interrupted by the
  // OS (which on Android would leave it "playing" into silence). Re-muting
  // hands the session back so anything started afterwards can mix again.
  const toggleMute = () => {
    const nextMuted = !isMuted;
    player.muted = nextMuted;
    player.audioMixingMode = nextMuted ? 'mixWithOthers' : 'doNotMix';
    if (!nextMuted) pauseMusic();
    setIsMuted(nextMuted);
  };

  return (
    <Pressable onPress={togglePlay} style={styles.viewerVideoContainer}>
      <VideoView style={styles.viewerVideo} player={player} contentFit="contain" nativeControls={false} />
      <TouchableOpacity
        style={[styles.muteButton, { top: insets.top + 16, left: 16, position: 'absolute' }]}
        onPress={toggleMute}
        activeOpacity={0.7}
      >
        <Icon name={isMuted ? 'volume-off' : 'volume-high'} size={24} color="#fff" />
      </TouchableOpacity>
    </Pressable>
  );
};

/**
 * Subscribe to one of MediaGallery's hand-rolled stores ({ get, set,
 * subscribe }). The stores exist precisely so pager-hot values can change
 * WITHOUT re-rendering the 6000-line gallery — only the mounted cells that
 * subscribe re-render.
 */
const useStoreValue = (store) => {
  const [value, setValue] = useState(() => (store ? store.get() : null));
  useEffect(() => {
    if (!store) return undefined;
    setValue(store.get());
    return store.subscribe(setValue);
  }, [store]);
  return value;
};

/**
 * "Is THIS cell the active page?" — subscribes to the derived BOOLEAN rather
 * than to the active id, so a page change re-renders exactly the two cells
 * whose answer changed instead of every mounted cell (React bails out on an
 * identical state value).
 */
const useIsActive = (store, id) => {
  const [active, setActive] = useState(() => (store ? store.get() === id : false));
  useEffect(() => {
    if (!store) { setActive(false); return undefined; }
    setActive(store.get() === id);
    return store.subscribe((value) => setActive(value === id));
  }, [store, id]);
  return active;
};

/**
 * "Is this photo's HD warm?" — same derived-boolean discipline as useIsActive.
 * The store answers per-id; the manager guarantees flips land only on quiet
 * frames, so this is the one re-render a photo cell ever takes after mount,
 * and it never lands during a gesture.
 */
const useHdReady = (store, id) => {
  const [ready, setReady] = useState(() => (store ? store.get(id) : false));
  useEffect(() => {
    if (!store) { setReady(false); return undefined; }
    setReady(store.get(id));
    return store.subscribe((changedId) => {
      // Store broadcasts the id that flipped; anyone else ignores it without
      // touching state (setState to an equal value is a no-op, but skipping
      // the call entirely is cheaper still on a 5-cell fanout).
      if (changedId === id) setReady(true);
    });
  }, [store, id]);
  return ready;
};

// The zoomable photo cell.
//
// The zoom surface is ZoomableView (Reanimated + Gesture Handler), everything
// on the UI thread; its behaviour is device-confirmed and NOT touched by the
// cell rewrite. React.memo + store-driven activity: every prop from
// renderViewerItem is referentially stable, so the parent never re-renders a
// mounted cell — page changes and HD arrivals flow through the two stores.
const ImageViewer = React.memo(({ fullResUrl, mediaId, activeStore, hdStore, item, styles, getFullUrl, onZoomScaleChange, onSingleTap, onPinchDismiss }) => {
  const isActive = useIsActive(activeStore, mediaId);
  const hdReady = useHdReady(hdStore, mediaId);

  // Aspect ratio of the displayed image: the metadata columns when present,
  // otherwise whatever the decoder reports on first paint. Drives the zoom
  // surface's pan bounds, so panning stops at the image edge instead of the
  // black letterbox.
  const [loadedAspect, setLoadedAspect] = useState(null);
  const metaAspect = (item?.width > 0 && item?.height > 0) ? item.width / item.height : null;
  const aspectRatio = metaAspect || loadedAspect;
  // Zoom ceiling from the ORIGINAL pixel width (the DB column — the decoder
  // only ever sees a derivative, which would cap far too low). iOS caps zoom
  // near 1:1 with the source, so a 48MP shot zooms deeper than an old 2MP one.
  const maxScale = useMemo(
    () => (item?.width > 0 ? nativeMaxScale(item.width, width, PixelRatio.get()) : MAX_SCALE),
    [item?.width],
  );

  // Drop a stale decoded aspect when the cell is recycled onto another photo.
  useEffect(() => { setLoadedAspect(null); }, [mediaId]);

  const handleDimensions = useCallback((w, h) => {
    if (w > 0 && h > 0) setLoadedAspect(w / h);
  }, []);

  // Coarse zoom signal from the surface: tells the shell to hide chrome and
  // freeze the pager (and the shell's HD manager treats a zoom as "I want
  // detail NOW" — see reportZoomScale in MediaGallery).
  //
  // Zoom IN is reported only by the ACTIVE cell: that signal LOCKS the pager,
  // so a recycled neighbour must never be able to raise it. Zoom OUT is
  // reported unconditionally, and that asymmetry is the point: it can only
  // UNLOCK the pager, so it is safe from anyone — and gating it was a latch
  // (a cell that went inactive while zoomed reset its own surface but never
  // told the shell, leaving scrollEnabled=false and the pager dead).
  const handleZoomedChange = useCallback((isZoomed) => {
    if (isZoomed) {
      if (isActive) onZoomScaleChange?.(2);
    } else {
      onZoomScaleChange?.(1);
    }
  }, [isActive, onZoomScaleChange]);

  const handlePinchDismiss = useCallback(() => {
    if (isActive) onPinchDismiss?.();
  }, [isActive, onPinchDismiss]);

  // ── The one decision this cell makes ───────────────────────────────────
  // Fast source: compressed > thumbnail > raw. Thumbnail before raw on
  // purpose — on tunnel mode or unmigrated rows the raw can be a 25MB HEIC,
  // and streaming it to fill a screen for half a second is the opposite of
  // fast; the thumbnail is ~60KB and always exists.
  const fastUri = item.compressedUrl
    ? getFullUrl(item.compressedUrl)
    : (item.thumbnailUrl
      ? getFullUrl(item.thumbnailUrl)
      : getFullUrl(item.rawUrl || item.url || fullResUrl));
  // HD source: the ~1600px display variant. By the time hdReady is true the
  // manager has already prefetched these exact bytes into the disk cache, so
  // this swap decodes from disk — never a cold network fetch on a view.
  const displayUri = getFullUrl(`/api/media/display/${mediaId}`);
  const uri = hdReady ? displayUri : fastUri;

  return (
    <View style={{ flex: 1, width: width, justifyContent: 'center', alignItems: 'center' }}>
      <ZoomableView
        // key by mediaId so a reused cell (FlatList recycle, or a quick
        // close-then-open-the-next-photo before this cell unmounts) mounts a
        // fresh surface; `resetKey`/`active` also snap it back to 1× centred,
        // belt and braces, so the next photo can never inherit the previous
        // one's zoom + pan.
        key={mediaId}
        resetKey={mediaId}
        active={isActive}
        aspectRatio={aspectRatio}
        maxScale={maxScale}
        style={styles.viewerImage}
        onZoomedChange={handleZoomedChange}
        onSingleTap={onSingleTap}
        onPinchDismiss={handlePinchDismiss}
      >
        <View style={{ flex: 1, backgroundColor: '#000', overflow: 'hidden' }}>
          <Image
            source={{ uri }}
            style={StyleSheet.absoluteFillObject}
            contentFit="contain"
            // Blur-up on first paint, and the SAME native crossfade carries
            // the fast → HD swap in place. No second view, no unmount, no
            // texture teardown.
            transition={160}
            // The pager recycles cells. Without this the previous photo stays
            // on screen until the new one decodes, which looks like the swipe
            // landed on the wrong picture.
            recyclingKey={mediaId}
            cachePolicy="memory-disk"
            placeholder={item.blurhash ? { blurhash: item.blurhash } : null}
            placeholderContentFit="cover"
            onLoad={(e) => {
              const src = e?.source || e?.nativeEvent?.source || {};
              if (src.width > 0 && src.height > 0) handleDimensions(src.width, src.height);
            }}
            onError={(e) => {
              // Degraded, not broken: the previous texture stays visible, so
              // warn (with enough context to debug) rather than error.
              try {
                const native = e?.nativeEvent || e || {};
                console.warn('[MediaGallery] image load failed:', JSON.stringify({
                  uri,
                  mediaId,
                  hdReady,
                  error: native?.error || native?.message || String(native),
                }));
              } catch { /* logger must never throw */ }
            }}
          />
        </View>
      </ZoomableView>

      {/* STATIC HD HUD */}
      {hdReady && isActive && (
        <View style={{
          position: 'absolute',
          bottom: 24,
          right: 24,
          backgroundColor: 'rgba(0,0,0,0.5)',
          paddingHorizontal: 6,
          paddingVertical: 3,
          borderRadius: 4,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: 'rgba(255,255,255,0.2)',
        }} pointerEvents="none">
          <Text style={{
            color: 'rgba(255,255,255,0.7)',
            fontSize: 9,
            fontWeight: '800',
            letterSpacing: 1,
          }}>HD</Text>
        </View>
      )}
    </View>
  );
});
ImageViewer.displayName = 'ImageViewer';

export { FullScreenVideoPlayer, ImageViewer };
