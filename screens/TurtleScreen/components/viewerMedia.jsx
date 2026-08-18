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
  View, Text, StyleSheet, Pressable, TouchableOpacity, Dimensions, PixelRatio,
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
  // ONE image view whose SOURCE moves forward: fast -> HD.
  //
  // This used to be two stacked <Image>s: the fast layer, an HD layer mounted
  // on top inside an Animated.View, a crossfade, and finally the fast layer
  // UNMOUNTED. That shape is what made the viewer stutter exactly when HD
  // arrived, and no amount of tuning WHEN to load could remove it:
  //
  //   - two full-screen textures alive per cell, across a 5-cell window
  //   - a texture DESTROY (unmounting the fast layer) 300ms after HD landed,
  //     on the UI thread, right where the next swipe wants its frames
  //   - three React commits per photo (hd loaded -> fade done -> badge)
  //
  // expo-image does this in place: keep the view, change `source`, and it
  // crossfades from the currently-decoded texture to the new one via
  // `transition` without ever showing a gap. One texture, one commit, nothing
  // to tear down. `recyclingKey` covers the pager reusing a cell for another
  // photo - without it the previous picture lingers until the new one decodes.
  // Dwell gate for the HD source: false until the user has stayed on this
  // image for HD_DWELL_MS, so quick swipe-bys never pull the heavy bytes.
  const [hdRequested, setHdRequested] = useState(false);
  // When true the HD source retries with the raw original instead of the
  // display variant (older server / moved source / transient sharp failure).
  const [hiResFallback, setHiResFallback] = useState(false);
  // A swipe is in flight -> do not START an HD load (see the commit latch).
  const pagerDragging = usePagerDragging(pagerDragStore);

  // "This cell is holding a decoded HD texture." A REF, not state, on purpose:
  // nothing in the render output depends on it, so making it state would fire
  // a React commit on the exact frame the HD decode lands - the frame we are
  // trying to keep free. The deactivation effect reads it without taking it as
  // a dep (which would re-run the effect on load).
  const highResLoadedRef = useRef(false);

  // The COMMIT LATCH. Once this cell decides to show HD it never goes back to
  // the fast source: swapping the source backwards would throw away a decoded
  // HD texture to re-decode the small one - a hitch for no gain, and a visible
  // downgrade. It also encodes the old mount rule, that an HD load may only
  // START on the active, stationary page.
  const [hdCommitted, setHdCommitted] = useState(false);
  useEffect(() => {
    if (hdCommitted) return;
    if (!(hdRequested || forceHd)) return;
    if (!isActive || pagerDragging) return;
    setHdCommitted(true);
  }, [hdCommitted, hdRequested, forceHd, isActive, pagerDragging]);

  // THE SWIPE ALWAYS WINS. The moment a pager drag starts, an HD load that has
  // not landed yet is CANCELLED: the source reverts to the fast image and the
  // in-flight fetch is dropped.
  //
  // This is what makes the pager feel like it can be grabbed at any instant.
  // Without it, a fetch committed a fraction of a second before the touch
  // would still land its multi-megabyte decode + texture upload part-way
  // through the gesture, and the swipe would hitch for something the user has
  // already moved on from.
  //
  // Reverting is close to free, which is the whole reason this works: the fast
  // image is still in expo-image's memory cache from moments ago, so the swap
  // back is a cache hit, not a reload. Nothing decodes, nothing downloads.
  //
  // A LANDED HD texture is never cancelled - there is no fetch to drop, and
  // throwing away decoded detail to show a blurrier image mid-swipe would be a
  // visible downgrade for no gain.
  useEffect(() => {
    if (!pagerDragging) return;
    if (highResLoadedRef.current) return;
    setHdCommitted(false);
  }, [pagerDragging]);

  // Deactivation: ONLY a cell whose HD never landed resets. A cell holding a
  // decoded HD texture keeps it, so swiping BACK shows full detail instantly
  // (iOS Photos behaviour) instead of paying the dwell and the fetch again.
  // Memory stays bounded by the pager's windowSize: eviction is the cell
  // unmounting, which drops the texture with it.
  useEffect(() => {
    if (isActive) return;
    if (highResLoadedRef.current) return;
    setHiResFallback(false);
    setHdRequested(false); // re-arm the dwell gate for the next open
    setHdCommitted(false); // and fall back to the fast source
  }, [isActive, media.id]);

  // Dwell gate: once active, wait HD_DWELL_MS before allowing HD. Swiping away
  // or changing image clears the timer via cleanup.
  useEffect(() => {
    if (!isActive) return undefined;
    const t = setTimeout(() => setHdRequested(true), HD_DWELL_MS);
    return () => clearTimeout(t);
  }, [isActive, media.id]);

  // Fast source priority - compressed > thumbnail > raw.
  // Thumbnail before raw on purpose: on tunnel mode or unmigrated rows the raw
  // is a 25MB HEIC, and streaming it just to fill the screen for half a second
  // is the opposite of fast. The thumbnail is ~60KB webp and always exists.
  const fastSource = media.compressedUrl
    ? getFullUrl(media.compressedUrl)
    : (media.thumbnailUrl
      ? getFullUrl(media.thumbnailUrl)
      : getFullUrl(media.rawUrl || media.url));

  // HD source - the DISPLAY VARIANT (1600px progressive JPEG, ~250-600KB)
  // rather than the raw original. At fullscreen phone size it is visually
  // identical to raw, for 5-10x less bandwidth, decode and battery. If the
  // variant is unavailable, onError flips hiResFallback and this becomes the
  // raw bytes.
  const rawUri = getFullUrl(media.rawUrl || media.url);
  const displayUri = (media.id && media.type !== 'video')
    ? getFullUrl('/api/media/display/' + media.id)
    : rawUri;
  const hiResUri = hiResFallback ? rawUri : displayUri;

  const showingHd = hdCommitted;
  const uri = showingHd ? hiResUri : fastSource;

  // Failure logger - surfaces which source + URI + native event so image-load
  // regressions are debuggable. console.warn, not .error: a failed HD swap is
  // recoverable (the fast texture stays on screen), so it is degraded, not
  // broken.
  const logLoadFailure = (layer, failedUri) => (e) => {
    try {
      const native = e?.nativeEvent || e || {};
      console.warn('[MediaGallery] image load failed:', JSON.stringify({
        layer,
        uri: failedUri,
        mediaId: media?.id,
        compressedUrl: media?.compressedUrl,
        thumbnailUrl: media?.thumbnailUrl,
        rawUrl: media?.rawUrl,
        error: native?.error || native?.message || String(native),
      }));
    } catch {
      // Logger must never throw - silent swallow protects callers.
    }
    if (typeof onError === 'function') onError(e);
  };

  return (
    <View style={[style, { backgroundColor: '#000', overflow: 'hidden' }]}>
      <Image
        source={{ uri }}
        style={StyleSheet.absoluteFillObject}
        contentFit={contentFit}
        // Blur-up on first paint, and the SAME crossfade carries the
        // fast -> HD swap. Kept short: this plays while the user is looking,
        // and a long dissolve reads as the image being slow.
        transition={160}
        // The pager recycles cells. Without this the previous photo stays on
        // screen until the new one decodes, which looks like the swipe landed
        // on the wrong picture.
        recyclingKey={media.id}
        cachePolicy="memory-disk"
        placeholder={media.blurhash ? { blurhash: media.blurhash } : null}
        placeholderContentFit="cover"
        priority={showingHd ? 'high' : 'normal'}
        // expo-image reports { loaded, total } during the fetch; the viewer's
        // 3px bar animates off it. Only meaningful for the HD fetch - the fast
        // source is usually already cached.
        onProgress={(e) => {
          if (!isActive || !onLoadProgress || !showingHd) return;
          const data = (e && e.nativeEvent) || e || {};
          const total = Number(data.total);
          const loaded = Number(data.loaded);
          if (total > 0 && Number.isFinite(loaded)) onLoadProgress(loaded / total);
        }}
        onLoad={(e) => {
          // Decoded pixel dimensions feed the zoom surface's pan bounds, so
          // panning stops at the image edge instead of out in the letterbox.
          // Reported from WHICHEVER source decoded first, so the bounds are
          // right from the first frame rather than only once HD lands.
          const src = e?.source || e?.nativeEvent?.source || {};
          if (onDimensions && src.width > 0 && src.height > 0) {
            onDimensions(src.width, src.height);
          }
          if (!showingHd) return;
          highResLoadedRef.current = true;
          if (onRawLoad) onRawLoad();
          // Make sure the bar reaches 100% even when the final onProgress
          // event stopped short (some platforms cap around 98%), and for
          // cached loads which never fire onProgress at all.
          if (onLoadProgress) onLoadProgress(1);
        }}
        onError={(e) => {
          if (showingHd && !hiResFallback) {
            // Display variant unavailable - retry once with the raw original.
            setHiResFallback(true);
            return;
          }
          logLoadFailure(showingHd ? 'raw' : 'fast', uri)(e);
        }}
      />
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
    // Zoom IN is reported only by the ACTIVE cell: that signal LOCKS the pager,
    // so a recycled neighbour must never be able to raise it.
    //
    // Zoom OUT is reported unconditionally, and that asymmetry is the point. It
    // can only UNLOCK the pager, so it is safe from anyone - and gating it was
    // a latch: a cell that went inactive while still zoomed reset its own
    // surface but never told the shell, leaving zoomScale high and the pager
    // with scrollEnabled=false. Swiping was then dead until something else
    // happened to zoom.
    if (isZoomed) {
      if (isActive) onZoomScaleChange?.(2);
    } else {
      onZoomScaleChange?.(1);
    }
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
