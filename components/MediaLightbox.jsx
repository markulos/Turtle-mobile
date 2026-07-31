import React, { useEffect, useMemo } from 'react';
import {
  View, TouchableOpacity, ScrollView, StyleSheet, useWindowDimensions, BackHandler, Pressable, StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';

/**
 * MediaLightbox — a lightweight full-screen image/video viewer for chat.
 *
 * IN-TREE overlay (absolute + high zIndex), NOT a Modal: it's mounted inside
 * surfaces that are themselves overlays (BoardTimeline is an EdgeSwipePage
 * `overlay`), and on iOS a sibling Modal over an open Modal silently fails to
 * present. An absolute child that covers the screen sits above its host cleanly.
 *
 * Image: pinch-to-zoom via a ScrollView (native on iOS; still fills + closes on
 * Android). Video: expo-video with native controls. Tap the backdrop / the X /
 * Android back to close.
 */
const HIT_SLOP_12 = { top: 12, bottom: 12, left: 12, right: 12 };

function LightboxVideo({ uri }) {
  const player = useVideoPlayer(uri || null, (p) => { p.loop = false; p.play(); });
  return <VideoView player={player} style={styles.media} contentFit="contain" nativeControls />;
}

export default function MediaLightbox({ visible, uri, isVideo = false, onClose }) {
  const insets = useSafeAreaInsets();
  // Reactive — re-reads on rotation / iPad window resize (Dimensions.get is a
  // one-shot snapshot that goes stale where insets don't change, e.g. iPad).
  const { width, height } = useWindowDimensions();

  // Android hardware back closes the lightbox (not the whole board).
  useEffect(() => {
    if (!visible) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose?.(); return true; });
    return () => sub.remove();
  }, [visible, onClose]);

  // Viewport-sized styles memoized per dimension change (rotation/resize) —
  // the render otherwise allocated three fresh objects per render. Declared
  // before the early return (hooks rule).
  const fullSize = useMemo(() => ({ width, height }), [width, height]);
  const contentCenter = useMemo(
    () => ({ width, height, alignItems: 'center', justifyContent: 'center' }),
    [width, height],
  );

  if (!visible || !uri) return null;

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <StatusBar hidden />
      {/* Backdrop — tap to dismiss. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

      {isVideo ? (
        <LightboxVideo uri={uri} />
      ) : (
        <ScrollView
          style={StyleSheet.absoluteFill}
          contentContainerStyle={contentCenter}
          maximumZoomScale={4}
          minimumZoomScale={1}
          centerContent
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
        >
          {/* Tap-to-close lives on the image itself: the full-screen ScrollView
              covers the backdrop Pressable, so a stationary tap must be caught
              here. A two-finger pinch is still handled by the parent
              ScrollView's native zoom recogniser, so zoom is preserved. */}
          <Pressable onPress={onClose} style={fullSize}>
            <Image
              source={{ uri }}
              style={fullSize}
              contentFit="contain"
              transition={120}
              cachePolicy="memory-disk"
            />
          </Pressable>
        </ScrollView>
      )}

      {/* Close button — top-right, in the safe area. */}
      <TouchableOpacity
        onPress={onClose}
        style={[styles.closeBtn, { top: insets.top + 8 }]}
        hitSlop={HIT_SLOP_12}
        accessibilityRole="button"
        accessibilityLabel="Close image"
      >
        <Icon name="close" size={24} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000F2',
    zIndex: 1000,
    elevation: 1000,
  },
  media: { ...StyleSheet.absoluteFillObject },
  closeBtn: {
    position: 'absolute',
    right: 14,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
