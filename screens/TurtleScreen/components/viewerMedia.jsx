/**
 * viewerMedia — the photo viewer's MEDIA CELL layer, extracted verbatim from
 * MediaGallery.jsx (vault UX plan Phase 6: split along the viewer seam).
 * Three self-contained pieces:
 *   • FullScreenVideoPlayer — expo-video cell for the pager
 *   • ProgressiveImage      — blurhash → compressed → RAW layered image with
 *     the HD dwell/zoom gate (HD_DWELL_MS)
 *   • ImageViewer           — the zoomable cell (ZoomableView: pinch, pan,
 *     double-tap; zoom reported up via onZoomScaleChange)
 * Pure presentational leaves: everything arrives via props; no gallery state.
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, Pressable, TouchableOpacity, Animated, Dimensions, Easing, PixelRatio,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useMusicPlayer } from '../../../context/MusicPlayerContext';
import ZoomableView from './ZoomableView';
import { MAX_SCALE, nativeMaxScale } from '../../../utils/zoomMath';

const { width } = Dimensions.get('window');

// Full-screen video player component (extracted from main component).
// Active-page awareness comes from the shared store (see useStoreValue), so a
// page change re-renders this cell only when ITS active/inactive state flips.
const FullScreenVideoPlayer = ({ sourceUrl, mediaId, activeStore, styles, insets }) => {
  const isActive = useStoreValue(activeStore) === mediaId;
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

// Progressive image component with blurhash → compressed → RAW layers
//
// History of this component (don't repeat past mistakes):
//
//   1. Previously this fired a `POST /media/${id}/compress` from the
//      render path when `compressedUrl` was null — a fire-and-forget
//      JIT trigger. That was the wrong design: the user who first
//      opened the image PAID to download the full raw AND nudged the
//      server's Sharp pool, while subsequent viewers got the benefit.
//      A background loop (`services/tunnelCompressBackfill.js`) already
//      pre-generates the compressed copy whenever the frontend is idle,
//      so the client doesn't need to nudge anything. JIT call removed.
//
//   2. Previously the raw (Layer 2) load was delayed 1 second behind
//      a setTimeout to avoid wasting bandwidth on quick swipe-bys.
//      But isActive cancellation already covers that case — the raw
//      Image unmounts the instant the user swipes off — so the delay
//      was net-negative: it caused a visible 1-second wait on the
//      ACTIVE photo for no payoff. Delay removed; raw loads at once
//      when isActive turns true.
//
//   3. Previously the Layer 1 fallback when compressedUrl was null
//      went STRAIGHT to rawUrl — which on tunnel mode or unmigrated
//      rows means streaming a 25MB HEIC just to fill the screen for
//      the half-second before Layer 2 loads the same bytes. Layer 1
//      now falls back to thumbnailUrl first (which is ~60KB webp and
//      ALWAYS exists). The user sees an instantly-rendered low-res
//      version, then the raw fades in.
// Dwell before the viewer upgrades from the regular compressed JPEG to the
// full-resolution HD layer. The viewer only ever loads the regular image up
// front; the HD bytes are requested only if the user lingers on a photo this
// long — so quick swipe-bys never pull the heavy original. (Re-introduces a
// dwell delay that was previously removed; now an explicit product choice to
// save bandwidth, at the documented 1.5s.)
const HD_DWELL_MS = 1500;

/**
 * Subscribe to one of MediaGallery's hand-rolled stores ({ get, set,
 * subscribe }). The stores exist precisely so pager-hot values (drag in
 * flight, which page is active) can change WITHOUT re-rendering the
 * 6000-line gallery — only the mounted cells that subscribe re-render.
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

/** "A pager swipe is in flight" — see useStoreValue. */
const usePagerDragging = (store) => useStoreValue(store) === true;

const ProgressiveImage = ({ media, style, contentFit, onError, isActive, onRawLoad, onLoadProgress, getFullUrl, forceHd = false, onDimensions, pagerDragStore }) => {
  const [highResLoaded, setHighResLoaded] = useState(false);
  // Gate for the HD (Layer 2) load: false until the user has dwelled on this
  // image for HD_DWELL_MS. Reset whenever the image deactivates/changes.
  const [hdRequested, setHdRequested] = useState(false);
  // Once the high-res layer has fully crossfaded in, we UNMOUNT the fast
  // (thumbnail/compressed) Layer 1 so it doesn't linger behind the full-res
  // image — matching the web viewer, which shows a single full image with no
  // thumbnail persisting underneath (visible through transparent PNGs or as a
  // low-res ghost otherwise). Stays mounted during the crossfade so there's no
  // black flash mid-transition.
  const [fastHidden, setFastHidden] = useState(false);
  // When true, Layer 2 retries with the raw original instead of the display
  // variant (older server / moved source / transient sharp failure).
  const [hiResFallback, setHiResFallback] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  // A swipe is in flight → an UNLOADED HD layer stands down (see render note).
  const pagerDragging = usePagerDragging(pagerDragStore);

  // Effect-readable mirror of highResLoaded — the deactivation effect must
  // know it without taking it as a dep (which would re-run the effect on load).
  const highResLoadedRef = useRef(false);

  // Deactivation: ONLY an unloaded cell resets. Unmounting there is the
  // request-cancel for the in-flight HD fetch, and re-arming the dwell gate is
  // what keeps quick pass-bys cheap. A cell whose HD already LANDED keeps it —
  // there is nothing to cancel, and tearing the loaded layer down used to be
  // the swipe-away hitch: the texture destroy + Layer-1 remount landed in the
  // exact settle frame of the pager. Kept HD also means swiping BACK to a
  // photo shows full HD instantly (visible mid-swipe, like iOS Photos) instead
  // of paying the dwell + fetch again. Memory is bounded by the pager's
  // windowSize: eviction happens by unmount, which drops the whole cell.
  useEffect(() => {
    if (isActive) return;
    if (highResLoadedRef.current) return;
    setHighResLoaded(false);
    setFastHidden(false); // bring the fast layer back for the next open
    setHiResFallback(false);
    setHdRequested(false); // re-arm the dwell gate for the next open
    fadeAnim.setValue(0);
  }, [isActive, media.id, fadeAnim]);

  // Dwell gate: once the image is active, wait HD_DWELL_MS before allowing the
  // HD layer to load. Swiping away (isActive=false) or changing image clears
  // the timer via cleanup, so a quick pass-by never requests the heavy bytes.
  useEffect(() => {
    if (!isActive) return undefined;
    const t = setTimeout(() => setHdRequested(true), HD_DWELL_MS);
    return () => clearTimeout(t);
  }, [isActive, media.id]);

  // Crossfade once the raw is decoded and ready; when the fade completes, drop
  // the fast layer so only the full-res image remains.
  useEffect(() => {
    if (isActive && highResLoaded) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setFastHidden(true);
      });
    }
  }, [highResLoaded, isActive, fadeAnim]);

  // Layer 1 source priority — compressed > thumbnail > raw.
  // See history note (3) above for why thumbnail comes before raw.
  const fastSource = media.compressedUrl
    ? getFullUrl(media.compressedUrl)
    : (media.thumbnailUrl
      ? getFullUrl(media.thumbnailUrl)
      : getFullUrl(media.rawUrl || media.url));

  // Layer 2 source — the high-resolution layer.
  //
  // DISPLAY VARIANT (1600px progressive JPEG, ~250-600KB) instead of the raw
  // original (which can be a 25MB HEIC). Measured 2026-06-11: 68,214 display
  // variants pre-warmed on disk for a 24,487-image library — full coverage —
  // so this serves from the server's disk cache with immutable headers, no
  // Sharp work in the request path. At fullscreen phone size the variant is
  // visually identical to raw; the win is 5-10× less bandwidth, decode time,
  // and battery per open. If the variant fetch errors, onError below flips
  // hiResFallback and Layer 2 retries with the raw bytes — the old behavior,
  // automatically.
  const rawUri = getFullUrl(media.rawUrl || media.url);
  const displayUri = (media.id && media.type !== 'video')
    ? getFullUrl(`/api/media/display/${media.id}`)
    : rawUri;
  const hiResUri = hiResFallback ? rawUri : displayUri;

  // Failure logger — surfaces which layer + URI + native event so
  // image-load regressions are debuggable. Uses console.warn (not
  // .error) because a Layer-2 failure is recoverable: Layer 1 stays
  // visible, so the UX is degraded-not-broken. .error would imply a
  // crash. Successful loads do NOT log — that was diagnostic-era
  // chatter that has long since served its purpose.
  const logLoadFailure = (layer, uri) => (e) => {
    try {
      const native = e?.nativeEvent || e || {};
      const summary = {
        layer,
        uri,
        mediaId: media?.id,
        compressedUrl: media?.compressedUrl,
        thumbnailUrl: media?.thumbnailUrl,
        rawUrl: media?.rawUrl,
        error: native?.error || native?.message || String(native),
      };
      console.warn('[MediaGallery] image load failed:', JSON.stringify(summary));
    } catch {
      // Logger should never throw — silent swallow protects callers.
    }
    if (typeof onError === 'function') onError(e);
  };

  return (
    <View style={[style, { backgroundColor: '#000', overflow: 'hidden' }]}>
      {/* LAYER 1: Fast source (compressed > thumbnail > raw fallback).
          Mounted while the high-res Layer 2 is in-flight, then UNMOUNTED
          once Layer 2 has fully faded in (fastHidden) so the thumbnail
          never persists behind the full-res image. */}
      {!fastHidden && (
        <Image
          source={{ uri: fastSource }}
          style={StyleSheet.absoluteFillObject}
          contentFit={contentFit}
          // Blur-up: the full-bleed blurhash renders on the first frame and the
          // compressed image CROSSFADES over it instead of popping in. This
          // never delays paging — pager cells pre-mount ±2 pages out
          // (windowSize), so the fade plays offscreen before the user arrives;
          // the only on-screen fades are the viewer's opening frame and cells
          // entering the window during a fast run, which is exactly where the
          // blurred-then-sharp reveal is wanted.
          transition={140}
          cachePolicy="memory-disk"
          placeholder={media.blurhash ? { blurhash: media.blurhash } : null}
          placeholderContentFit="cover"
          // Decoded pixel dimensions — the zoom surface needs the real aspect
          // ratio to bound panning to the letterboxed image rect. Reported off
          // the FAST layer so the bounds are right from the first frame, not
          // only once the HD layer lands (and for rows whose width/height
          // columns are null).
          onLoad={(e) => {
            const src = e?.source || e?.nativeEvent?.source || {};
            if (onDimensions && src.width > 0 && src.height > 0) {
              onDimensions(src.width, src.height);
            }
          }}
          onError={logLoadFailure('fast', fastSource)}
        />
      )}

      {/* LAYER 2: High-res. Loads after the user dwells on the image for
          HD_DWELL_MS (hdRequested) OR the moment they zoom in (forceHd) —
          zooming means they want detail now, so we don't make them wait. The
          regular compressed JPEG carries the view until then.

          Mount rule, term by term:
          • `highResLoaded` — a LANDED HD layer stays mounted unconditionally:
            through pager drags (unmounting it mid-swipe was the black flash —
            after the crossfade the fast layer is gone, so the photo under the
            finger blanked), and through deactivation (tearing it down at
            settle was the swipe-away hitch; keeping it makes swipe-BACK show
            HD instantly). Eviction is the pager unmounting the whole cell.
          • `isActive && !pagerDragging` — an UNLOADED layer exists only on
            the active, stationary page. Deactivating or starting a swipe
            unmounts it, which is the request-cancel: a multi-megabyte fetch +
            decode landing mid-swipe stalls the frames the gesture needs
            ("can't swipe while it's loading HD" on device). */}
      {(highResLoaded || (isActive && !pagerDragging)) && (hdRequested || forceHd) && (
        <Animated.View style={[StyleSheet.absoluteFillObject, { opacity: fadeAnim, zIndex: 2 }]} pointerEvents="none">
          <Image
            source={{ uri: hiResUri }}
            style={StyleSheet.absoluteFillObject}
            contentFit={contentFit}
            transition={0}
            cachePolicy="disk"
            priority="high"
            // expo-image's onProgress fires periodically during the
            // network fetch with { loaded, total } in bytes. We
            // forward the ratio up to the MediaGallery viewer so the
            // 3px progress bar at the top of the screen can animate.
            // Cached loads don't fire onProgress at all — that case is
            // handled in MediaGallery via the 150ms show-delay timer.
            onProgress={(e) => {
              if (!isActive || !onLoadProgress) return;
              const data = (e && e.nativeEvent) || e || {};
              const total = Number(data.total);
              const loaded = Number(data.loaded);
              if (total > 0 && Number.isFinite(loaded)) {
                onLoadProgress(loaded / total);
              }
            }}
            onLoad={() => {
              highResLoadedRef.current = true;
              setHighResLoaded(true);
              if (onRawLoad) onRawLoad();
              // Ensure the progress bar reaches 100% even if the
              // final onProgress event didn't quite reach 1.0 (some
              // platforms cap progress events at ~98%).
              if (onLoadProgress) onLoadProgress(1);
            }}
            onError={(e) => {
              if (!hiResFallback) {
                // Display variant unavailable — retry Layer 2 with the raw
                // original. One silent retry, then the failure logger.
                setHiResFallback(true);
                return;
              }
              logLoadFailure('raw', hiResUri)(e);
            }}
          />
        </Animated.View>
      )}
    </View>
  );
};

// Image viewer component with pinch-to-zoom.
//
// The zoom surface is ZoomableView (Reanimated + Gesture Handler). It replaced
// the original iOS-only `ScrollView maximumZoomScale` cell, whose zoom-out
// always settled off-centre: UIScrollView owns contentOffset during a zoom and
// never re-centres content that has shrunk back inside the viewport, so a pinch
// out left the photo parked wherever the pinch centroid was. The transform
// model has no such state — 1× IS translate(0, 0) — and it works on Android,
// which never had pinch zoom here at all.
// React.memo + store-driven activity: every prop from renderViewerItem is
// referentially stable, so the PARENT never re-renders a mounted cell at all —
// on a page change the active-id store flips exactly the two cells whose
// active/inactive state changed, and the gallery's own render storms (chrome
// updates, tag edits, upload progress…) stop touching the pager entirely.
// That is the JS-thread relief the settle frame needs.
const ImageViewer = React.memo(({ fullResUrl, mediaId, activeStore, item, styles, getFullUrl, api, onLoadProgress, onLoadComplete, onZoomScaleChange, onSingleTap, onPinchDismiss, pagerDragStore }) => {
  const isActive = useStoreValue(activeStore) === mediaId;
  // 1. Track HD State
  const [rawLoaded, setRawLoaded] = useState(false);
  // True once the user zooms into this image — forces the HD layer to load
  // immediately (no dwell wait), since a zoomed compressed JPEG looks soft.
  const [zoomed, setZoomed] = useState(false);
  // Aspect ratio of the displayed image: the metadata columns when present,
  // otherwise whatever the decoder reports on first paint. Drives the zoom
  // surface's pan bounds, so panning stops at the image edge instead of the
  // black letterbox.
  const [loadedAspect, setLoadedAspect] = useState(null);
  const metaAspect = (item?.width > 0 && item?.height > 0) ? item.width / item.height : null;
  const aspectRatio = metaAspect || loadedAspect;
  // Zoom ceiling from the ORIGINAL pixel width (the DB column — the decoder
  // only ever sees the compressed variant, which would cap far too low). iOS
  // caps zoom near 1:1 with the source, so a 48MP shot zooms deeper than an
  // old 2MP one; unknown dimensions fall back to the library default.
  const maxScale = useMemo(
    () => (item?.width > 0 ? nativeMaxScale(item.width, width, PixelRatio.get()) : MAX_SCALE),
    [item?.width],
  );

  // Zoom forces the HD layer in, but only once the gesture has settled. Mounting
  // a 1600px JPEG mid-pinch puts a decode on the main thread at exactly the
  // moment the gesture needs every frame — that read as pinch jitter on device.
  const [hdZoom, setHdZoom] = useState(false);

  // Swiping away resets the zoom signal only. `rawLoaded` deliberately
  // survives deactivation — it mirrors ProgressiveImage's persistent HD layer
  // (the cell is keyed by mediaId, so the flag can never describe another
  // photo), which keeps the HD badge truthful when the user swipes back onto
  // a photo whose HD is still mounted.
  useEffect(() => {
    if (!isActive) setZoomed(false);
  }, [isActive]);

  useEffect(() => {
    if (!zoomed) { setHdZoom(false); return undefined; }
    const t = setTimeout(() => setHdZoom(true), 260);
    return () => clearTimeout(t);
  }, [zoomed]);

  // Drop a stale decoded aspect when the cell is recycled onto another photo.
  useEffect(() => { setLoadedAspect(null); }, [mediaId]);

  const handleDimensions = useCallback((w, h) => {
    if (w > 0 && h > 0) setLoadedAspect(w / h);
  }, []);

  // Coarse zoom signal from the surface: forces the HD layer in (zooming means
  // "I want detail now", so we skip the dwell wait) and tells the viewer shell
  // to hide chrome / stop the pager. Only the active cell speaks, so a recycled
  // neighbour can't clobber the shell's state.
  const handleZoomedChange = useCallback((isZoomed) => {
    setZoomed(isZoomed);
    if (isActive) onZoomScaleChange?.(isZoomed ? 2 : 1);
  }, [isActive, onZoomScaleChange]);

  const handlePinchDismiss = useCallback(() => {
    if (isActive) onPinchDismiss?.();
  }, [isActive, onPinchDismiss]);

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
        <ProgressiveImage
          media={item}
          style={{ flex: 1 }}
          contentFit="contain"
          isActive={isActive}
          forceHd={hdZoom}
          onDimensions={handleDimensions}
          pagerDragStore={pagerDragStore}
          onRawLoad={() => {
            setRawLoaded(true);
            if (typeof onLoadComplete === 'function') onLoadComplete();
          }}
          onLoadProgress={onLoadProgress}
          onError={(error) => console.error('[MediaGallery] Full-res load error:', error)}
          getFullUrl={getFullUrl}
          // No `api` prop — JIT compress trigger removed.
          // tunnelCompressBackfill on the server handles missing
          // compressed copies during idle time.
        />
      </ZoomableView>

      {/* STATIC HD HUD */}
      {rawLoaded && isActive && (
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

export { FullScreenVideoPlayer, ProgressiveImage, ImageViewer };
