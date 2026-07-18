import React, { useEffect } from 'react';
import {
  View, TouchableOpacity, ScrollView, StyleSheet, Dimensions, BackHandler, Pressable, StatusBar,
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
function LightboxVideo({ uri }) {
  const player = useVideoPlayer(uri || null, (p) => { p.loop = false; p.play(); });
  return <VideoView player={player} style={styles.media} contentFit="contain" nativeControls />;
}

export default function MediaLightbox({ visible, uri, isVideo = false, onClose }) {
  const insets = useSafeAreaInsets();
  const { width, height } = Dimensions.get('window');

  // Android hardware back closes the lightbox (not the whole board).
  useEffect(() => {
    if (!visible) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose?.(); return true; });
    return () => sub.remove();
  }, [visible, onClose]);

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
          contentContainerStyle={{ width, height, alignItems: 'center', justifyContent: 'center' }}
          maximumZoomScale={4}
          minimumZoomScale={1}
          centerContent
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
        >
          {/* The image itself doesn't intercept the backdrop tap-to-close (a tap
              that isn't a zoom gesture falls through to the Pressable). */}
          <Image
            source={{ uri }}
            style={{ width, height }}
            contentFit="contain"
            transition={120}
            cachePolicy="memory-disk"
            pointerEvents="none"
          />
        </ScrollView>
      )}

      {/* Close button — top-right, in the safe area. */}
      <TouchableOpacity
        onPress={onClose}
        style={[styles.closeBtn, { top: insets.top + 8 }]}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
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
