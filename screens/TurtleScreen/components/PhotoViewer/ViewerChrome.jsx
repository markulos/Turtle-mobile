/**
 * ViewerChrome — the two bands over the photo, and nothing else.
 *
 * Top: a gradient wash with Back on the left and Edit (images only) + Tags on
 * the right. Bottom: the timestamp and resolution on the left, a pill with
 * Save-offline (images only), Share and Favourite on the right (plus
 * play/pause and mute for a video), and — for a video — a scrubber above
 * them: elapsed / duration and a track you can drag to seek.
 *
 * Deliberately flat. Both bands are `box-none` while shown, so only the
 * buttons (and the scrubber track) are touch targets and every other touch
 * falls straight through to the stage; `none` while hidden, so an invisible
 * button can never eat a swipe. Opacity is ONE animated style — open
 * progress × chrome target × the pull-to-dismiss fade — with no per-element
 * products and no measurements. The old chrome multiplied four Animated
 * values per element and toggled pointerEvents from three different pieces of
 * state; that complexity sat on the exact path a swipe had to cross.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { dismissChrome } from '../../../../utils/viewerGestureMath';
import { formatViewerResolution, formatViewerTimestamp, isFavourite } from '../../../../utils/viewerFormat';

const HIT = { top: 12, bottom: 12, left: 12, right: 12 };
const SHADOW = { textShadowColor: 'rgba(0,0,0,0.45)', textShadowRadius: 4 };

function ChromeButton({ icon, label, onPress, color = '#fff', size = 26, testID }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={HIT}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Icon name={icon} size={size} color={color} style={SHADOW} />
    </Pressable>
  );
}

/** Saved pictures are marked in the pond's green, the way a favourite is red. */
const OFFLINE_ON = '#34d399';

/**
 * Keep-offline: one button, three states. While the bytes are coming down it
 * is a spinner in the icon's place — same 44 pt target, so the pill never
 * reflows mid-download and the next tap can't land on a moved neighbour.
 */
function OfflineButton({ state, onPress }) {
  if (state === 'saving') {
    return (
      <View style={styles.button} testID="viewer-offline-busy" accessibilityLabel="Saving for offline">
        <ActivityIndicator size="small" color="#fff" />
      </View>
    );
  }
  const saved = state === 'saved';
  return (
    <ChromeButton
      icon={saved ? 'cloud-check' : 'cloud-download-outline'}
      label={saved ? 'Remove offline copy' : 'Save for offline'}
      onPress={onPress}
      color={saved ? OFFLINE_ON : '#fff'}
      size={28}
      testID="viewer-offline"
    />
  );
}

export function formatClock(seconds) {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const m = Math.floor(s / 60);
  const r = s % 60;
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}:${String(m % 60).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return `${m}:${String(r).padStart(2, '0')}`;
}

/**
 * The video timeline. The track owns its own touches through the RN
 * responder system (it sits in the chrome band, above the stage, so the
 * stage's gesture tree never sees them): touch anywhere on it to jump, drag to
 * scrub. While the finger is down the thumb follows the finger, not the
 * player, so a laggy seek can't make it stutter backwards.
 */
/** Seeks while the finger moves are rate-limited to this. */
const SEEK_THROTTLE_MS = 90;
/** The player reports time this often; the bar glides between reports. */
const TIME_REPORT_MS = 250;
/** After a seek, reports older than the seek target are ignored this long. */
const SEEK_SETTLE_MS = 900;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * The video timeline, the way a native player does it:
 *   • progress is a SHARED VALUE. Between the player's reports (4 Hz) the bar
 *     glides linearly on the UI thread, so it moves smoothly instead of in
 *     quarter-second steps; the fill scales and the thumb translates — no
 *     React render per frame.
 *   • while the finger is down the thumb is the finger (the shared value is
 *     written straight from the touch), the player is paused, and seeks go
 *     out rate-limited with the latest position.
 *   • after a seek the player may still report the OLD time once or twice;
 *     those stale reports are ignored until it confirms the new position, so
 *     the thumb stays where you left it and simply resumes from there.
 * The track owns its touches through the RN responder system (it sits in the
 * chrome band, above the stage, so the stage's gesture tree never sees them).
 */
function VideoScrubber({ currentTime, duration, playing, onSeek, onScrubStart, onScrubEnd }) {
  const progress = useSharedValue(0);
  const trackW = useSharedValue(0);
  const scrubbing = useSharedValue(0);
  const trackWRef = useRef(0);
  const throttleRef = useRef({ timer: null, pending: null, last: 0 });
  const seekSettleRef = useRef(null); // { target, until }
  const [scrubLabel, setScrubLabel] = useState(null); // seconds, while the finger is down

  // Pause = the bar stops NOW. The glide toward the last report is cancelled
  // the instant `playing` flips (the shell flips it optimistically on the tap,
  // before the player confirms), and the thumb pins to the last known time.
  useEffect(() => {
    if (playing) return;
    cancelAnimation(progress);
    if (scrubbing.value) return;
    progress.value = duration > 0 ? clamp01(currentTime / duration) : 0;
    // The one-time pin is the point; later reports while paused go through
    // the effect below (without gliding).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  // Follow the player's reports — unless the finger owns the bar, or the
  // report is a stale pre-seek time. Glide only while playing; paused
  // reports (a seek landing, the end) snap.
  useEffect(() => {
    if (scrubbing.value) return;
    const pending = seekSettleRef.current;
    if (pending) {
      if (Date.now() < pending.until && Math.abs(currentTime - pending.target) > 0.75) return;
      seekSettleRef.current = null;
    }
    const ratio = duration > 0 ? clamp01(currentTime / duration) : 0;
    if (playing) {
      progress.value = withTiming(ratio, { duration: TIME_REPORT_MS, easing: Easing.linear });
    } else {
      cancelAnimation(progress);
      progress.value = ratio;
    }
  }, [currentTime, duration, playing, progress, scrubbing]);

  // Positions are taken from pageX against the track's window x, measured at
  // touch-down. `locationX` is relative to whichever view the finger is OVER
  // — crossing the thumb or the fill moved the origin to that child and the
  // ratio jumped around ("tripping out"). pageX never changes frame.
  const trackRef = useRef(null);
  const trackXRef = useRef(0);
  const ratioAt = useCallback((pageX) => {
    const w = trackWRef.current;
    return w > 0 ? clamp01((pageX - trackXRef.current) / w) : 0;
  }, []);
  const measureTrack = useCallback((then) => {
    const node = trackRef.current;
    if (node && typeof node.measureInWindow === 'function') {
      node.measureInWindow((x, _y, w) => { trackXRef.current = x; if (w > 0) { trackWRef.current = w; trackW.value = w; } then(); });
    } else {
      then();
    }
  }, [trackW]);

  const seekNow = useCallback((ratio) => {
    if (duration > 0) onSeek?.(ratio * duration);
  }, [duration, onSeek]);

  const seekThrottled = useCallback((ratio) => {
    const t = throttleRef.current;
    t.pending = ratio;
    if (t.timer) return;
    const wait = Math.max(0, SEEK_THROTTLE_MS - (Date.now() - t.last));
    t.timer = setTimeout(() => {
      t.timer = null;
      t.last = Date.now();
      if (t.pending != null) { seekNow(t.pending); setScrubLabel(t.pending * duration); t.pending = null; }
    }, wait);
  }, [seekNow, duration]);

  const grab = useCallback((locationX) => {
    onScrubStart?.();
    scrubbing.value = 1;
    cancelAnimation(progress);
    const r = ratioAt(locationX);
    progress.value = r;
    setScrubLabel(r * duration);
    seekThrottled(r);
  }, [onScrubStart, scrubbing, progress, ratioAt, duration, seekThrottled]);

  const move = useCallback((locationX) => {
    const r = ratioAt(locationX);
    progress.value = r;
    seekThrottled(r);
  }, [ratioAt, progress, seekThrottled]);

  const release = useCallback((locationX) => {
    const t = throttleRef.current;
    if (t.timer) { clearTimeout(t.timer); t.timer = null; }
    t.pending = null;
    if (locationX != null) {
      const r = ratioAt(locationX);
      progress.value = r;
      seekNow(r);
      seekSettleRef.current = { target: r * duration, until: Date.now() + SEEK_SETTLE_MS };
    }
    scrubbing.value = 0;
    setScrubLabel(null);
    onScrubEnd?.();
  }, [ratioAt, progress, seekNow, duration, scrubbing, onScrubEnd]);

  const fillStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: progress.value }] }), [progress]);
  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: progress.value * trackW.value }] }), [progress, trackW]);

  return (
    <View style={styles.scrubber} pointerEvents="box-none" testID="viewer-scrubber">
      <Text style={styles.clock}>{formatClock(scrubLabel == null ? currentTime : scrubLabel)}</Text>
      <View
        ref={trackRef}
        style={styles.trackHit}
        onLayout={(e) => { const w = e.nativeEvent.layout.width; trackWRef.current = w; trackW.value = w; }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={(e) => { const px = e.nativeEvent.pageX; measureTrack(() => grab(px)); }}
        onResponderMove={(e) => move(e.nativeEvent.pageX)}
        onResponderRelease={(e) => release(e.nativeEvent.pageX)}
        onResponderTerminate={() => release(null)}
        accessibilityRole="adjustable"
        accessibilityLabel="Video position"
        testID="viewer-scrubber-track"
      >
        {/* Children are never touch targets: the track view owns every event. */}
        <View style={styles.track} pointerEvents="none">
          <Animated.View style={[styles.trackFill, fillStyle]} />
        </View>
        <Animated.View style={[styles.thumb, thumbStyle]} pointerEvents="none" />
      </View>
      <Text style={styles.clock}>{formatClock(duration)}</Text>
    </View>
  );
}

function ViewerChrome({
  sv,
  item,
  shown,
  insets,
  bottomInset,
  onBack,
  onEdit,
  onTags,
  onShare,
  onToggleFavourite,
  /** 'none' | 'saving' | 'saved' — images only; videos never show the button. */
  offlineState = 'none',
  onToggleOffline,
  video,
  onTogglePlay,
  onToggleMute,
  onSeek,
  onScrubStart,
  onScrubEnd,
}) {
  const fade = useAnimatedStyle(() => ({
    opacity: sv.openProgress.value * sv.chrome.value * dismissChrome(sv.dragY.value),
  }), [sv]);

  const events = shown ? 'box-none' : 'none';
  const isVideo = item?.type === 'video';
  const favourite = isFavourite(item);
  const timestamp = formatViewerTimestamp(item);
  const resolution = formatViewerResolution(item);

  return (
    <>
      <Animated.View
        pointerEvents={events}
        style={[styles.top, { height: insets.top + 68 }, fade]}
        testID="viewer-chrome-top"
      >
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(0,0,0,0.62)', 'rgba(0,0,0,0.26)', 'transparent']}
          locations={[0, 0.55, 1]}
          style={StyleSheet.absoluteFillObject}
        />
        <View style={[styles.topRow, { top: insets.top + 6 }]} pointerEvents="box-none">
          <ChromeButton icon="chevron-left" label="Back" onPress={onBack} size={32} testID="viewer-back" />
          <View style={styles.topRight} pointerEvents="box-none">
            {!isVideo && <ChromeButton icon="pencil" label="Edit image" onPress={onEdit} testID="viewer-edit" />}
            <ChromeButton icon="tag-multiple" label="Edit tags" onPress={onTags} testID="viewer-tags" />
          </View>
        </View>
      </Animated.View>

      <Animated.View
        pointerEvents={events}
        style={[styles.bottom, { bottom: bottomInset }, fade]}
        testID="viewer-chrome-bottom"
      >
        {isVideo && !!video && (
          <VideoScrubber
            currentTime={video.currentTime || 0}
            duration={video.duration || 0}
            playing={!!video.playing}
            onSeek={onSeek}
            onScrubStart={onScrubStart}
            onScrubEnd={onScrubEnd}
          />
        )}
        <View style={styles.bottomRow} pointerEvents="box-none">
          <View style={styles.meta} pointerEvents="none">
            {!!timestamp && <Text style={styles.timestamp} numberOfLines={1}>{timestamp}</Text>}
            {!!resolution && <Text style={styles.resolution} numberOfLines={1}>{resolution}</Text>}
          </View>
          <View style={styles.pill} pointerEvents="box-none">
            {isVideo && !!video && (
              <>
                <ChromeButton
                  icon={video.playing ? 'pause' : 'play'}
                  label={video.playing ? 'Pause' : 'Play'}
                  onPress={onTogglePlay}
                  testID="viewer-play"
                />
                <ChromeButton
                  icon={video.muted ? 'volume-off' : 'volume-high'}
                  label={video.muted ? 'Unmute' : 'Mute'}
                  onPress={onToggleMute}
                  testID="viewer-mute"
                />
              </>
            )}
            {/* Images only: a video's original is tens to hundreds of MB and
                keeping one is a different decision from keeping a photo. */}
            {!isVideo && !!onToggleOffline && (
              <OfflineButton state={offlineState} onPress={onToggleOffline} />
            )}
            <ChromeButton icon="share-variant" label="Share" onPress={onShare} size={28} testID="viewer-share" />
            <ChromeButton
              icon={favourite ? 'heart' : 'heart-outline'}
              label={favourite ? 'Remove from favourites' : 'Add to favourites'}
              onPress={onToggleFavourite}
              color={favourite ? '#ef4444' : '#fff'}
              size={28}
              testID="viewer-favourite"
            />
          </View>
        </View>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  top: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 5,
  },
  topRow: {
    position: 'absolute',
    left: 8,
    right: 16,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 22,
  },
  bottom: {
    position: 'absolute',
    left: 24,
    right: 24,
    zIndex: 5,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  meta: {
    flex: 1,
    marginRight: 12,
  },
  timestamp: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 14,
    fontWeight: '300',
    letterSpacing: 0.5,
    marginBottom: 4,
    ...SHADOW,
  },
  resolution: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    fontWeight: '300',
    letterSpacing: 0.5,
    ...SHADOW,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
    borderRadius: 30,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: 'rgba(30, 30, 32, 0.85)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  button: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
  scrubber: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  clock: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    minWidth: 36,
    textAlign: 'center',
    ...SHADOW,
  },
  trackHit: {
    flex: 1,
    height: 32,
    justifyContent: 'center',
  },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.3)',
    overflow: 'hidden',
  },
  trackFill: {
    height: 4,
    width: '100%',
    backgroundColor: '#fff',
    transformOrigin: 'left',
  },
  thumb: {
    position: 'absolute',
    top: 8,
    left: -8,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
});

export default React.memo(ViewerChrome);
