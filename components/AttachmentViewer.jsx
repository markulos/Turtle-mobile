/**
 * AttachmentViewer — a full-screen image viewer that owes nothing to the vault.
 *
 * The media vault's own PhotoViewer is built on a gallery item: it wants the
 * grid's row, its compressed layers, its HD marks and its offline copy, and it
 * opens on the Photos tab. A note carries media IDS and nothing else, and a
 * screenshot attached to a note should open IN the note — not bounce you to
 * another tab and leave you to find your way back. So this takes the one thing
 * a note can produce — a list of URLs — and shows them.
 *
 * IN-TREE overlay (absolute + high zIndex), NOT a Modal — the same constraint
 * MediaLightbox documents: it is mounted inside surfaces that are themselves
 * overlays (the note composer is an EdgeSwipePage `overlay`), and on iOS a
 * sibling Modal over an open Modal silently fails to present.
 *
 * Swipe sideways to move between the note's images, pinch to zoom (iOS native
 * zoom; Android fills and closes), tap the picture / the X / Android back to
 * close. Each frame shows its thumbnail immediately as a placeholder while the
 * full-size version loads, and keeps it if the full-size one can't be had.
 *
 * Host it next to the content, not inside a ScrollView: an absolutely
 * positioned child of scrolling content is positioned against that content.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Pressable, TouchableOpacity,
  BackHandler, StatusBar, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const HIT_SLOP_12 = { top: 12, bottom: 12, left: 12, right: 12 };

/**
 * One page.
 *
 * The full-size source is tried first with the thumbnail as its placeholder, so
 * the picture is on screen from the first frame and sharpens when the big one
 * arrives. If the full-size fetch fails (the server generates that tier on
 * demand and can answer 503, or the item isn't an image tier at all), the
 * thumbnail becomes the source instead — a soft picture beats an empty frame.
 */
function ViewerPage({ image, width, height, onClose }) {
  const [failed, setFailed] = useState(false);
  const source = (!failed && image.uri) ? image.uri : image.previewUri;

  // A fresh id is a fresh attempt — the component is keyed by id upstream, but
  // guard anyway so a re-used page never inherits a stale failure.
  useEffect(() => { setFailed(false); }, [image.uri]);

  return (
    <ScrollView
      style={{ width, height }}
      contentContainerStyle={{ width, height, alignItems: 'center', justifyContent: 'center' }}
      maximumZoomScale={4}
      minimumZoomScale={1}
      centerContent
      bounces={false}
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
    >
      {/* Tap-to-close lives on the image itself: the page's ScrollView covers
          the backdrop, so a stationary tap has to be caught here. A two-finger
          pinch is still claimed by the ScrollView's native zoom recogniser. */}
      <Pressable onPress={onClose} style={{ width, height }}>
        <Image
          testID={`attachment-image-${image.key}`}
          source={source ? { uri: source } : null}
          placeholder={image.previewUri ? { uri: image.previewUri } : undefined}
          placeholderContentFit="contain"
          style={{ width, height }}
          contentFit="contain"
          transition={120}
          cachePolicy="memory-disk"
          onError={() => setFailed(true)}
          accessible={false}
        />
      </Pressable>
    </ScrollView>
  );
}

export default function AttachmentViewer({ visible, images, index = 0, onClose }) {
  const insets = useSafeAreaInsets();
  // Reactive — re-reads on rotation / iPad window resize (Dimensions.get is a
  // one-shot snapshot that goes stale where insets don't change).
  const { width, height } = useWindowDimensions();
  const list = Array.isArray(images) ? images : [];
  const start = Math.min(Math.max(index, 0), Math.max(list.length - 1, 0));
  const [current, setCurrent] = useState(start);
  const pagerRef = useRef(null);
  // Cleared on each open so the pager re-seeks to the tapped image; set once
  // the content is wide enough for that seek to land.
  const positioned = useRef(false);

  useEffect(() => {
    if (visible) { setCurrent(start); positioned.current = false; }
  }, [visible, start]);

  // Android hardware back closes the viewer, not the page hosting it. This
  // subscribes AFTER the host's own handler (the viewer mounts later), and
  // BackHandler calls the most recent first, so it wins while it's up.
  useEffect(() => {
    if (!visible) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose?.(); return true; });
    return () => sub.remove();
  }, [visible, onClose]);

  const onContentSizeChange = useCallback((w) => {
    if (positioned.current || start === 0 || width <= 0) return;
    if (w < width * (start + 1)) return; // pages not laid out yet — wait
    pagerRef.current?.scrollTo({ x: start * width, y: 0, animated: false });
    positioned.current = true;
  }, [start, width]);

  const onMomentumScrollEnd = useCallback((e) => {
    const x = e?.nativeEvent?.contentOffset?.x || 0;
    if (width > 0) setCurrent(Math.round(x / width));
  }, [width]);

  if (!visible || list.length === 0) return null;

  const shown = list[Math.min(current, list.length - 1)];

  return (
    <View style={styles.overlay}>
      <StatusBar hidden />
      {/* Backdrop — tap anywhere the pages don't cover to dismiss. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

      <ScrollView
        ref={pagerRef}
        testID="attachment-pager"
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        // iOS honours this directly; Android is seeked by onContentSizeChange.
        contentOffset={{ x: start * width, y: 0 }}
        onContentSizeChange={onContentSizeChange}
        onMomentumScrollEnd={onMomentumScrollEnd}
        style={StyleSheet.absoluteFill}
      >
        {list.map((img) => (
          <ViewerPage
            key={img.key}
            image={img}
            width={width}
            height={height}
            onClose={onClose}
          />
        ))}
      </ScrollView>

      {/* Chrome — which of the note's images this is, and the way out. */}
      <View style={[styles.topBar, { top: insets.top + 8 }]} pointerEvents="box-none">
        <View style={styles.caption} pointerEvents="none">
          {list.length > 1 && (
            <Text style={styles.counter}>{current + 1} of {list.length}</Text>
          )}
          {shown?.name ? (
            <Text style={styles.name} numberOfLines={1}>{shown.name}</Text>
          ) : null}
        </View>
        <TouchableOpacity
          onPress={onClose}
          style={styles.closeBtn}
          hitSlop={HIT_SLOP_12}
          accessibilityRole="button"
          accessibilityLabel="Close image"
        >
          <Icon name="close" size={24} color="#fff" />
        </TouchableOpacity>
      </View>
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
  topBar: {
    position: 'absolute',
    left: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  // flexShrink so a long filename ellipsizes instead of pushing the close
  // button off the screen's right edge.
  caption: { flex: 1, flexShrink: 1, gap: 2 },
  counter: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 4,
  },
  name: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.75)',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 4,
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
