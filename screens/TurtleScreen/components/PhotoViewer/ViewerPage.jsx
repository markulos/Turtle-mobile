/**
 * ViewerPage — one page of the viewer. Dumb on purpose.
 *
 * A page is a full-screen absolutely positioned view whose transform is a pure
 * function of the stage's shared values (useAnimatedStyle → no JS on a gesture
 * frame), and whose content is ONE expo-image (or one expo-video view). The
 * image's URI is a pure function of two inputs: the media row, and a per-photo
 * "HD is warm" flag read from MediaGallery's HD store. No dwell timers, no
 * commit latches, no drag subscriptions — every one of those used to live in a
 * cell and could fire React state on the frame a finger landed. All HD
 * orchestration stays in MediaGallery's viewer HD manager, which prefetches the
 * display variant into the disk cache and flips the flag only on quiet frames.
 *
 * Layout (spec §5):
 *   translateX = pageTranslate(index, active, pagerX) + (isActive ? dragX : 0)
 *   translateY = isActive ? dragY : 0
 *   scale      = isActive ? dismissScale(dragY) × (zoomOwner ? scale : 1) : 1
 *   opacity    = isActive ? fade(openProgress) : (dragY > 0 || openProgress < 1 ? 0 : 1)
 * The zoom transform belongs to `zoomIndex`, which lags `activeIndex` until a
 * page settle finishes, so a zoomed page stays zoomed while it slides out and
 * the incoming page never inherits it. Neighbours vanish during a pull and
 * during the open/close pop, because scaling the active page about its centre
 * would otherwise let the next page peek in from the side.
 *
 * The tile crop: inside the page sits a FRAME that clips the media. At rest
 * (openProgress 1) it is the whole page, so nothing is cropped; as the pop
 * runs toward 0 — opening out of a grid tile, or flying back into one — it
 * closes down to a square the size of the photo's letterboxed short side,
 * centred, while the page fades. Combined with the stage scaling to the tile,
 * the picture ends as a tile-shaped, cover-cropped square exactly where the
 * tile is (iOS Photos' shared-element feel). The frame's aspect comes from
 * the ACTIVE photo; neighbours are hidden whenever the frame is not full.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';

import { useMusicPlayer } from '../../../../context/MusicPlayerContext';
import { useOfflineMedia } from '../../../../context/OfflineMediaContext';
import { dismissScale, pageTranslate } from '../../../../utils/viewerGestureMath';
import { containSize } from '../../../../utils/zoomMath';
import { useHdReady, useIsActive } from './stores';

/**
 * On the way OUT the picture does not fade at all: it stays fully opaque for
 * the whole flight and switches off the instant it is on its tile (the last
 * ~2 % of the curve is sub-pixel motion), handing over to the thumbnail
 * underneath. A gradual fade read as the picture dissolving in mid-air.
 */
const ARRIVAL = 0.02;
/** Seconds between the player's time reports while a video is active. */
const TIME_UPDATE_INTERVAL = 0.25;
/**
 * Fullscreen = landscape, and turning the phone back upright leaves it.
 *
 * `autoExitOnRotate` waits until the phone has actually been ROTATED INTO
 * landscape before it will act on a rotation out of it — otherwise entering
 * fullscreen while holding the phone upright would exit immediately. So a
 * video opened with the fullscreen key, then turned sideways, then turned
 * back, ends where it started. (It also does nothing if rotation lock is on,
 * which is the correct reading of that setting.)
 */
const FULLSCREEN_OPTIONS = { enable: true, orientation: 'landscape', autoExitOnRotate: true };

function usePageStyle(index, sv) {
  return useAnimatedStyle(() => {
    const active = index === sv.activeIndex.value;
    const zoomOwner = index === sv.zoomIndex.value;
    const p = Math.min(1, Math.max(0, sv.openProgress.value));
    const x = pageTranslate(index, sv.activeIndex.value, sv.pagerX.value, sv.pageW) + (active ? sv.dragX.value : 0);
    const y = active ? sv.dragY.value : 0;
    const pull = active ? dismissScale(sv.dragY.value, sv.height) : 1;
    const zoom = zoomOwner ? sv.scale.value : 1;
    const zx = zoomOwner ? sv.tx.value : 0;
    const zy = zoomOwner ? sv.ty.value : 0;
    const hidden = !active && (sv.dragY.value > 0 || p < 1);
    const arrived = sv.closing.value === 1 && p <= ARRIVAL;
    return {
      opacity: hidden || arrived ? 0 : 1,
      transform: [
        { translateX: x + zx },
        { translateY: y + zy },
        { scale: pull * zoom },
      ],
    };
  }, [index, sv]);
}

/** The clipping frame: full page at rest, a centred square at the tile. */
function useFrameStyle(sv) {
  return useAnimatedStyle(() => {
    const p = Math.min(1, Math.max(0, sv.openProgress.value));
    const content = containSize(sv.width, sv.height, sv.aspect.value);
    const side = Math.min(content.width, content.height);
    const fw = side + (sv.width - side) * p;
    const fh = side + (sv.height - side) * p;
    return {
      width: fw,
      height: fh,
      left: (sv.width - fw) / 2,
      top: (sv.height - fh) / 2,
    };
  }, [sv]);
}

/** The media stays page-sized and page-centred inside the moving frame. */
function useMediaStyle(sv) {
  return useAnimatedStyle(() => {
    const p = Math.min(1, Math.max(0, sv.openProgress.value));
    const content = containSize(sv.width, sv.height, sv.aspect.value);
    const side = Math.min(content.width, content.height);
    const fw = side + (sv.width - side) * p;
    const fh = side + (sv.height - side) * p;
    return {
      left: (fw - sv.width) / 2,
      top: (fh - sv.height) / 2,
    };
  }, [sv]);
}

// ── Photo ────────────────────────────────────────────────────────────────────
const PhotoBody = React.memo(({ item, hdStore, getFullUrl, onAspect }) => {
  const hdReady = useHdReady(hdStore, item.id);
  const { uriFor } = useOfflineMedia();
  const hasMetaAspect = item.width > 0 && item.height > 0;
  // A picture the user kept: read the local file and nothing else. These are
  // the display tier's own bytes, so this is the same picture the HD path
  // would have fetched — it just doesn't need the pond to be reachable.
  const offlineUri = uriFor(item.id);

  // Fast source: compressed > thumbnail > raw. Thumbnail before raw on purpose
  // — on tunnel mode or unmigrated rows the raw can be a 25MB HEIC, and
  // streaming it to fill a screen for half a second is the opposite of fast;
  // the thumbnail is ~60KB and always exists.
  const fastUri = item.compressedUrl
    ? getFullUrl(item.compressedUrl)
    : (item.thumbnailUrl
      ? getFullUrl(item.thumbnailUrl)
      : getFullUrl(item.rawUrl || item.url || ''));
  // HD source: the ~1600px display variant. By the time hdReady is true the
  // manager has already prefetched these exact bytes into the disk cache, so
  // this swap decodes from disk — never a cold network fetch on a view.
  const displayUri = getFullUrl(`/api/media/display/${item.id}`);
  const uri = offlineUri || (hdReady ? displayUri : fastUri);

  const handleLoad = useCallback((e) => {
    if (hasMetaAspect || !onAspect) return;
    const src = e?.source || e?.nativeEvent?.source || {};
    if (src.width > 0 && src.height > 0) onAspect(item.id, src.width / src.height);
  }, [hasMetaAspect, onAspect, item.id]);

  const handleError = useCallback((e) => {
    // Degraded, not broken: the previous texture stays visible.
    try {
      const native = e?.nativeEvent || e || {};
      console.warn('[PhotoViewer] image load failed:', JSON.stringify({
        uri, mediaId: item.id, hdReady, error: native?.error || native?.message || String(native),
      }));
    } catch { /* logger must never throw */ }
  }, [uri, item.id, hdReady]);

  return (
    <Image
      source={{ uri }}
      style={StyleSheet.absoluteFillObject}
      contentFit="contain"
      // Blur-up on first paint, and the SAME native crossfade carries the
      // fast → HD swap in place. No second view, no unmount, no texture
      // teardown.
      transition={160}
      recyclingKey={item.id}
      cachePolicy="memory-disk"
      placeholder={item.blurhash ? { blurhash: item.blurhash } : null}
      placeholderContentFit="cover"
      onLoad={handleLoad}
      onError={handleError}
      accessibilityLabel={item.filename || 'Photo'}
    />
  );
});
PhotoBody.displayName = 'PhotoBody';

// ── Video ────────────────────────────────────────────────────────────────────
const VideoBody = React.memo(({ item, isActive, getFullUrl, onVideoControls, onVideoState }) => {
  const sourceUrl = getFullUrl(item.rawUrl || item.url || '');
  const { pause: pauseMusic } = useMusicPlayer();
  // The native player view, for fullscreen. expo-video presents its own
  // AVPlayerViewController, which overrides `supportedInterfaceOrientations`
  // while fullscreen — that is what lets the video turn landscape inside an
  // app whose every other screen is portrait.
  const viewRef = useRef(null);
  const player = useVideoPlayer(sourceUrl, (p) => {
    // No loop: a video plays to its end and PAUSES there, like Photos; play
    // from the end starts it over (see togglePlay).
    p.loop = false;
    p.muted = true;
    p.timeUpdateEventInterval = TIME_UPDATE_INTERVAL;
    // Opening a video preview must NOT stop whatever the music player is
    // playing: 'auto' claims the audio session as soon as playback starts,
    // muted or not. Muted playback mixes; the session is taken only when the
    // user asks to hear this video.
    p.audioMixingMode = 'mixWithOthers';
  });

  // Truth about the player, from its own events — the play/pause and mute
  // icons follow this, never an optimistic guess that the native side may
  // not have honoured yet.
  const [state, setState] = useState({ playing: false, muted: true, currentTime: 0, duration: 0 });
  const stateRef = useRef(state);
  stateRef.current = state;
  // While the scrubber's finger is down: playback paused, the player's own
  // time reports ignored (they would fight the finger), and whether to resume.
  const scrubRef = useRef({ active: false, resume: false });

  useEffect(() => {
    if (isActive) {
      player.play();
    } else {
      player.pause();
      player.currentTime = 0;
      player.muted = true;
      player.audioMixingMode = 'mixWithOthers';
    }
  }, [isActive, player]);

  useEffect(() => {
    if (!isActive || typeof player.addListener !== 'function') return undefined;
    const subs = [
      player.addListener('playingChange', (e) => {
        const playing = typeof e?.isPlaying === 'boolean' ? e.isPlaying : !!player.playing;
        setState((s) => (s.playing === playing ? s : { ...s, playing }));
      }),
      player.addListener('mutedChange', (e) => {
        const muted = typeof e?.muted === 'boolean' ? e.muted : !!player.muted;
        setState((s) => (s.muted === muted ? s : { ...s, muted }));
      }),
      player.addListener('timeUpdate', (e) => {
        if (scrubRef.current.active) return;
        const currentTime = Number.isFinite(e?.currentTime) ? e.currentTime : 0;
        const duration = Number.isFinite(player.duration) ? player.duration : 0;
        setState((s) => ({ ...s, currentTime, duration }));
      }),
      // The end: stay on the last frame, paused, with the bar full.
      player.addListener('playToEnd', () => {
        const duration = Number.isFinite(player.duration) ? player.duration : 0;
        setState((s) => ({ ...s, playing: false, currentTime: duration || s.currentTime, duration: duration || s.duration }));
      }),
    ];
    // Seed from the player: it may already be playing/loaded by now.
    setState({
      playing: !!player.playing,
      muted: player.muted !== false,
      currentTime: Number.isFinite(player.currentTime) ? player.currentTime : 0,
      duration: Number.isFinite(player.duration) ? player.duration : 0,
    });
    return () => subs.forEach((s) => { try { s?.remove?.(); } catch { /* already gone */ } });
  }, [isActive, player]);

  // Hand the shell the live state while active — the chrome draws from it.
  useEffect(() => {
    if (!isActive || !onVideoState) return undefined;
    onVideoState(item.id, state);
    return undefined;
  }, [isActive, onVideoState, item.id, state]);

  // The chrome owns the buttons; the active video page lends it the player.
  useEffect(() => {
    if (!isActive || !onVideoControls) return undefined;
    const controls = {
      togglePlay: () => {
        const next = !player.playing;
        if (next) {
          // Play from the end = start over.
          const { currentTime, duration } = stateRef.current;
          if (duration > 0 && currentTime >= duration - 0.05) {
            player.currentTime = 0;
            setState((s) => ({ ...s, currentTime: 0 }));
          }
          player.play();
        } else {
          player.pause();
        }
        // Reflect immediately; the playingChange event confirms or corrects.
        setState((s) => ({ ...s, playing: next }));
      },
      // Unmuting is the ONLY thing that stops the music: the user explicitly
      // asked to hear this video. Re-muting hands the session back.
      toggleMute: () => {
        const nextMuted = !player.muted;
        player.muted = nextMuted;
        player.audioMixingMode = nextMuted ? 'mixWithOthers' : 'doNotMix';
        if (!nextMuted) pauseMusic?.();
        setState((s) => ({ ...s, muted: nextMuted }));
      },
      seekTo: (seconds) => {
        const duration = stateRef.current.duration || (Number.isFinite(player.duration) ? player.duration : 0);
        const t = Math.min(Math.max(0, seconds), duration > 0 ? duration : seconds);
        player.currentTime = t;
        setState((s) => ({ ...s, currentTime: t }));
      },
      // iOS pauses while you scrub and resumes where you let go. Seeking a
      // playing player dozens of times a second is what made the timeline
      // jump: every seek restarted decoding and reported stale times back.
      beginScrub: () => {
        if (scrubRef.current.active) return;
        scrubRef.current = { active: true, resume: !!player.playing };
        if (player.playing) player.pause();
      },
      endScrub: () => {
        const { active, resume } = scrubRef.current;
        if (!active) return;
        scrubRef.current = { active: false, resume: false };
        if (resume) player.play();
      },
      // Hand the video to the native fullscreen player: landscape, its own
      // controls (the platform enables them in fullscreen regardless), and
      // back out when the phone is turned upright again.
      enterFullscreen: () => {
        try {
          const p = viewRef.current?.enterFullscreen?.();
          // A rejected promise here is a redbox in dev and nothing useful in
          // release — the video simply stays inline.
          if (p && typeof p.catch === 'function') p.catch(() => {});
        } catch { /* no native view yet */ }
      },
    };
    onVideoControls(item.id, controls);
    return () => onVideoControls(item.id, null);
  }, [isActive, player, item.id, onVideoControls, pauseMusic]);

  return (
    <VideoView
      ref={viewRef}
      style={StyleSheet.absoluteFillObject}
      player={player}
      contentFit="contain"
      // Inline, the viewer's own chrome is the controls. Fullscreen always
      // gets the platform's — that is the point of going there.
      nativeControls={false}
      fullscreenOptions={FULLSCREEN_OPTIONS}
    />
  );
});
VideoBody.displayName = 'VideoBody';

// ── The page ─────────────────────────────────────────────────────────────────
export const ViewerPage = React.memo(({
  item, index, sv, activeStore, hdStore, getFullUrl, onAspect, onVideoControls, onVideoState,
}) => {
  const isActive = useIsActive(activeStore, item.id);
  const style = usePageStyle(index, sv);
  const frameStyle = useFrameStyle(sv);
  const mediaStyle = useMediaStyle(sv);
  const frame = useMemo(() => ({ width: sv.width, height: sv.height }), [sv.width, sv.height]);

  return (
    <Animated.View
      style={[styles.page, frame, style]}
      collapsable={false}
      pointerEvents="none"
      testID={`viewer-page-${item.id}`}
    >
      <Animated.View style={[styles.frame, frameStyle]} collapsable={false}>
        <Animated.View style={[styles.media, frame, mediaStyle]} collapsable={false}>
          {item.type === 'video' ? (
            <VideoBody
              item={item}
              isActive={isActive}
              getFullUrl={getFullUrl}
              onVideoControls={onVideoControls}
              onVideoState={onVideoState}
            />
          ) : (
            <PhotoBody item={item} hdStore={hdStore} getFullUrl={getFullUrl} onAspect={onAspect} />
          )}
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
});
ViewerPage.displayName = 'ViewerPage';

const styles = StyleSheet.create({
  page: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  // Transparent, not black: the backdrop behind the stage is the black. A
  // black box would shrink and fly along with the photo on a pull-down, and
  // iOS moves only the picture.
  frame: {
    position: 'absolute',
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  media: {
    position: 'absolute',
  },
});

export default ViewerPage;
