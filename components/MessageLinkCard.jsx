/**
 * MessageLinkCard — the WhatsApp treatment for a link inside a message.
 *
 * A thumbnail, the page's title, a two-line summary and the hostname, in a
 * pressable block above the message's own text. The point is recognition: a
 * bare `https://…/p/DJx8_2mPq1k/` says nothing a week later, and the card says
 * what the thing IS.
 *
 * Deliberate choices:
 *   - NOTHING is drawn until the preview resolves. A skeleton that later
 *     collapses to nothing — the common case, with login walls and dead links
 *     — would move the conversation under the reader's eyes for no gain.
 *   - It passes `onLongPress` through. A long press does NOT bubble from a
 *     child Pressable to its parent in react-native, so without this, holding
 *     the card is the one spot in a bubble where the actions sheet refuses to
 *     appear.
 *   - Nothing oversets the bubble (STYLE-RULES): the text column shrinks and
 *     every line is `numberOfLines`-capped, because a long og:title is alone
 *     too wide for the row and wrapping cannot save a single item.
 *   - `onLoaded` fires once, when the card first appears, so the thread can
 *     stay pinned to the bottom — a card arriving a second after the message
 *     would otherwise push the newest line out of view.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
// The one implementation of "join a server-relative path to the pond's
// origin". Named for its first caller; the logic is not avatar-specific, and a
// fourth hand-rolled copy of it would be the actual mistake here.
import { resolveAvatarUrl as resolvePondUrl } from '../utils/avatarUrl';
import { inkOn } from '../utils/accentColor';
import { tapHaptic } from '../utils/haptics';
import useLinkPreview from '../utils/useLinkPreview';

export default function MessageLinkCard({
  url,
  mine = false,
  theme,
  serverBase,
  onLongPress,
  onLoaded,
  testID,
}) {
  const c = theme.colors;
  const preview = useLinkPreview(url);
  const [thumbFailed, setThumbFailed] = useState(false);

  // Fire-once, and never from render. `onLoaded` is deliberately NOT a
  // dependency — a parent passing a fresh arrow each render would otherwise
  // re-notify forever.
  const announced = useRef(false);
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;
  useEffect(() => {
    if (preview && !announced.current) {
      announced.current = true;
      onLoadedRef.current?.();
    }
  }, [preview]);

  if (!preview) return null;

  const thumb = !thumbFailed && preview.thumbUrl
    ? resolvePondUrl(preview.thumbUrl, serverBase)
    : null;
  const isVideo = preview.mediaType === 'video';

  // On the sender's own bubble the fill is already the accent colour, so the
  // card has to sit in ink-on-accent rather than borrow the surface palette,
  // which would be invisible against it.
  const ink = inkOn(c.accentInfo);
  const cardBg = mine ? 'rgba(255,255,255,0.16)' : c.surface;
  const cardBorder = mine ? 'rgba(255,255,255,0.28)' : c.border;
  const titleColor = mine ? ink : c.textPrimary;
  const subColor = mine ? ink : c.textSecondary;
  const hostColor = mine ? ink : c.textTertiary;

  return (
    <Pressable
      onPressIn={() => tapHaptic()}
      onPress={() => { Linking.openURL(url).catch(() => {}); }}
      onLongPress={onLongPress}
      accessibilityRole="link"
      accessibilityLabel={`Open ${preview.title}`}
      style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}
      testID={testID}
    >
      {thumb ? (
        <View style={styles.thumbWrap}>
          <Image
            source={{ uri: thumb }}
            style={styles.thumb}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={120}
            recyclingKey={thumb}
            onError={() => setThumbFailed(true)}
            testID={testID ? `${testID}-thumb` : undefined}
          />
          {isVideo && (
            <View style={styles.playBadge}>
              <Icon name="play" size={16} color="#fff" />
            </View>
          )}
        </View>
      ) : (
        <View style={[styles.thumb, styles.thumbFallback, { backgroundColor: mine ? 'rgba(255,255,255,0.14)' : c.surfaceElevated }]}>
          <Icon name={isVideo ? 'play' : 'link-variant'} size={20} color={subColor} />
        </View>
      )}

      <View style={styles.body}>
        <Text numberOfLines={2} style={[styles.title, { color: titleColor }]}>
          {preview.title}
        </Text>
        {!!preview.description && (
          <Text numberOfLines={2} style={[styles.description, { color: subColor, opacity: mine ? 0.82 : 1 }]}>
            {preview.description}
          </Text>
        )}
        {!!preview.host && (
          <Text numberOfLines={1} style={[styles.host, { color: hostColor, opacity: mine ? 0.7 : 1 }]}>
            {preview.host}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    padding: 6,
    marginBottom: 6,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  thumbWrap: { position: 'relative' },
  thumb: { width: 52, height: 52, borderRadius: 8 },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  playBadge: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.34)',
  },
  // flexShrink, so a long title narrows and ellipsizes instead of pushing the
  // card past the bubble's edge — RN's default is 0, which fails silently by
  // laying out past the parent rather than clipping.
  body: { flex: 1, flexShrink: 1, minWidth: 0 },
  title: { fontSize: 12.5, fontWeight: '700', lineHeight: 16 },
  description: { fontSize: 11, lineHeight: 14.5, marginTop: 1 },
  host: { fontSize: 10, marginTop: 2 },
});
