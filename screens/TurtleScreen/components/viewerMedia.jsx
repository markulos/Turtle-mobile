/**
 * viewerMedia — the photo viewer's MEDIA CELL layer, extracted verbatim from
 * MediaGallery.jsx (vault UX plan Phase 6: split along the viewer seam).
 * Three self-contained pieces:
 *   • FullScreenVideoPlayer — expo-video cell for the pager
 *   • ProgressiveImage      — blurhash → compressed → RAW layered image with
 *     the HD dwell/zoom gate (HD_DWELL_MS)
 *   • ImageViewer           — the zoomable ScrollView cell (pinch + double-tap,
 *     zoom reported up via onZoomScaleChange)
 * Pure presentational leaves: everything arrives via props; no gallery state.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, TouchableOpacity, Animated, Dimensions, Easing,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';

const { width, height } = Dimensions.get('window');

// Full-screen video player component (extracted from main component)
const FullScreenVideoPlayer = ({ sourceUrl, isActive, styles, insets }) => {
  const player = useVideoPlayer(sourceUrl, player => {
    player.loop = true;
    player.muted = true;
  });
  const [isPlaying, setIsPlaying] = useState(isActive);
  const [isMuted, setIsMuted] = useState(true);

  useEffect(() => {
    if (isActive) { player.play(); setIsPlaying(true); } 
    else { player.pause(); player.currentTime = 0; player.muted = true; setIsMuted(true); setIsPlaying(false); }
  }, [isActive, player]);

  const togglePlay = () => { isPlaying ? player.pause() : player.play(); setIsPlaying(!isPlaying); };
  const toggleMute = () => { player.muted = !isMuted; setIsMuted(!isMuted); };

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

const ProgressiveImage = ({ media, style, contentFit, onError, isActive, onRawLoad, onLoadProgress, getFullUrl, forceHd = false }) => {
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

  // Reset crossfade state on activation change. isActive=false simply
  // unmounts Layer 2 and cancels the in-flight request.
  useEffect(() => {
    if (!isActive) {
      setHighResLoaded(false);
      setFastHidden(false); // bring the fast layer back for the next open
      setHiResFallback(false);
      setHdRequested(false); // re-arm the dwell gate for the next open
      fadeAnim.setValue(0);
    }
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
          transition={0}
          cachePolicy="memory-disk"
          placeholder={media.blurhash ? { blurhash: media.blurhash } : null}
          placeholderContentFit="cover"
          onError={logLoadFailure('fast', fastSource)}
        />
      )}

      {/* LAYER 2: High-res. Loads after the user dwells on the image for
          HD_DWELL_MS (hdRequested) OR the moment they zoom in (forceHd) —
          zooming means they want detail now, so we don't make them wait. The
          regular compressed JPEG carries the view until then. Unmounts
          (cancelling the in-flight fetch) the moment isActive flips back to
          false; the dwell/zoom gate is the swipe-by guard for the bytes. */}
      {isActive && (hdRequested || forceHd) && (
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

// Image viewer component with pinch-to-zoom (extracted from main component)
const ImageViewer = ({ fullResUrl, mediaId, isActive, item, styles, getFullUrl, api, onLoadProgress, onLoadComplete, onZoomScaleChange }) => {
  const scrollRef = useRef(null);
  const lastTapRef = useRef(0);
  const isZoomedRef = useRef(false);

  // 1. Track HD State
  const [rawLoaded, setRawLoaded] = useState(false);
  // True once the user zooms into this image — forces the HD layer to load
  // immediately (no dwell wait), since a zoomed compressed JPEG looks soft.
  const [zoomed, setZoomed] = useState(false);

  // Reset HD state when user swipes away
  useEffect(() => {
    if (!isActive) { setRawLoaded(false); setZoomed(false); }
  }, [isActive]);
  
  // Reset zoom AND scroll offset when mediaId changes (swipe to a different
  // image, incl. FlatList cell recycle). This must run UNCONDITIONALLY — the
  // old version gated on `isZoomedRef`, which is only set by double-tap zoom,
  // NOT by pinch-zoom/pan. So a pinch-zoomed-and-panned cell (e.g. panned to
  // the image's bottom-right) skipped the reset, and when that cell was reused
  // for the next image it inherited the leftover zoomScale + scroll offset →
  // the intermittent "image loads offset to the bottom-right" bug. Resetting
  // both the zoom and the content offset on every image change clears it.
  useEffect(() => {
    const sv = scrollRef.current;
    if (!sv) return;
    sv.scrollResponderZoomTo?.({ x: 0, y: 0, width, height, animated: false });
    sv.scrollTo?.({ x: 0, y: 0, animated: false });
    isZoomedRef.current = false;
    setZoomed(false);
    // New image starts at zoom 1 — tell the viewer shell so its zoom guards
    // (chrome hide, pull-to-dismiss lockout) track reality.
    onZoomScaleChange?.(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaId]);
  
  const handleDoubleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) { // 300ms double-tap window
      // Toggle zoom
      if (scrollRef.current) {
        if (!isZoomedRef.current) {
          // Zoom in to center
          scrollRef.current.scrollResponderZoomTo({
            x: width * 0.25,
            y: height * 0.25,
            width: width * 0.5,
            height: height * 0.5,
            animated: true,
          });
          setZoomed(true); // want detail → load HD now, skip the dwell wait
          onZoomScaleChange?.(2);
        } else {
          // Zoom out
          scrollRef.current.scrollResponderZoomTo({
            x: 0,
            y: 0,
            width: width,
            height: height,
            animated: true,
          });
          onZoomScaleChange?.(1);
        }
        isZoomedRef.current = !isZoomedRef.current;
      }
    }
    lastTapRef.current = now;
  }, []);
  
  return (
    <View style={{ flex: 1, width: width, justifyContent: 'center', alignItems: 'center' }}>
      <ScrollView
        // key by mediaId so a reused cell (FlatList recycle, or a quick
        // close-then-open-the-next-photo before this cell unmounts) tears
        // down the old, possibly-zoomed native scroll view and mounts a
        // FRESH one at zoom=1 / offset=0. The scrollResponderZoomTo reset
        // below still runs, but it's imperative and can land after layout —
        // remounting via key is what actually guarantees the next photo
        // isn't inheriting the previous one's zoom + pan offset.
        key={mediaId}
        ref={scrollRef}
        contentContainerStyle={styles.viewerScrollContent}
        maximumZoomScale={4}
        minimumZoomScale={1}
        bouncesZoom={true}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        pinchGestureEnabled={true}
        // Catch pinch-zoom (UIScrollView reports zoomScale on scroll events) so
        // any zoom — not just double-tap — forces the HD layer in immediately.
        // setZoomed(true) is idempotent (React bails on same value), so calling
        // it per frame while zooming is cheap.
        scrollEventThrottle={64}
        onScroll={(e) => {
          const z = e?.nativeEvent?.zoomScale ?? 1;
          if (z > 1.01) setZoomed(true);
          // Live zoom report → viewer shell (chrome + gesture guards). Only the
          // active cell speaks, so a recycled neighbour can't clobber it.
          if (isActive) onZoomScaleChange?.(z);
        }}
      >
        <Pressable onPress={handleDoubleTap}>
          <ProgressiveImage
            media={item}
            style={styles.viewerImage}
            contentFit="contain"
            isActive={isActive}
            forceHd={zoomed}
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
        </Pressable>
      </ScrollView>
      
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
};

export { FullScreenVideoPlayer, ProgressiveImage, ImageViewer };
