/**
 * The photos on a message you have not sent yet — the strip above the composer.
 *
 * Rides in ChatComposer's `topSlot`, which exists for exactly this; the attach
 * key rides in its `actions` cluster. Neither needs a change to the shared
 * composer, which is the point of those two props.
 *
 * ── A photo is uploaded on PICK, not on Send ───────────────────────────────
 * The same decision the note composer made (services/vaultAttach says why at
 * length): the message references a vault item, so the upload has to finish
 * before the message can name it. Doing it on Send would mean a send key that
 * hangs for the length of a 40 MB photo over a phone connection. Doing it now
 * means the thumbnail in the strip is proof the photo is safe, and Send stays
 * instant — it only ever posts a few ids.
 *
 * The cost is stated rather than hidden: a photo picked and then removed, or a
 * draft abandoned, stays in the vault. That is where photos live, so it is an
 * upload rather than a leak — and the remove key says exactly that.
 *
 * ── Hold one to look at it before you send it ──────────────────────────────
 * A 56pt tile tells you WHICH photo it is, not whether it is the right one, and
 * the last moment a wrong photo can be taken off the message is before Send.
 * So a tile opens full size on a hold (or a tap) in the same viewer a sent
 * photo opens in. The magnifier badge is the visible half of the gesture.
 *
 * ── A tile is the shape of its photo ───────────────────────────────────────
 * These were 56pt SQUARES drawn with `contentFit: cover`, which cropped every
 * photo to fit — a wide shot lost its sides, a portrait lost its head and feet,
 * which is the one thing a thumbnail must not do (global styling rule). The
 * height is fixed and the WIDTH comes from the photo's own ratio, learned on
 * load, capped so one panorama cannot take the whole row.
 */
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { tapHaptic } from '../../../utils/haptics';
import { attachmentRoom, MAX_MESSAGE_ATTACHMENTS } from '../../../utils/messageAttachments';

const THUMB = 56;
/** The widest a tile may get — twice its height. Beyond that one panorama
 *  would push everything else off the row. */
const THUMB_MAX_W = THUMB * 2;
/** And the narrowest, so a very tall photo still has room for the two keys
 *  that sit on it. */
const THUMB_MIN_W = 38;

/** The tile width that keeps a photo at its own aspect ratio. */
export function thumbWidthFor(width, height) {
  if (!(width > 0) || !(height > 0)) return THUMB;
  return Math.round(Math.min(Math.max((width / height) * THUMB, THUMB_MIN_W), THUMB_MAX_W));
}

/**
 * One picked photo. `uri` is the LOCAL file the picker gave us, kept as the
 * preview for as long as the draft lives: it is already on the device, so it
 * paints instantly and does not depend on the vault having generated a thumbnail
 * for a photo uploaded three seconds ago.
 */
function DraftThumb({ item, theme, onView, onRemove }) {
  const c = theme.colors;
  // Square until the photo reports its own size — the picker gives us no
  // dimensions, and a tile that starts at its final width would need them.
  const [width, setWidth] = useState(THUMB);
  const onLoad = useCallback((e) => {
    const src = e?.source;
    if (src) setWidth(thumbWidthFor(src.width, src.height));
  }, []);

  return (
    <View style={[styles.thumb, { width, borderColor: item.error ? c.accentError : c.border, backgroundColor: c.surfaceElevated }]}>
      {/* The whole tile is the way in. A hold is what Mark asked for; a tap
          does the same thing, since the only other target on a 56pt tile is
          the remove key, which sits on top of this with its own hit slop. */}
      <Pressable
        onPress={onView}
        onLongPress={onView}
        style={StyleSheet.absoluteFillObject}
        accessibilityRole="imagebutton"
        accessibilityLabel="View this photo full size"
        accessibilityHint="Opens it before you send it"
        testID={`draft-photo-view-${item.key}`}
      >
        <ExpoImage
          source={{ uri: item.uri }}
          style={StyleSheet.absoluteFillObject}
          contentFit="contain"
          transition={80}
          onLoad={onLoad}
          accessible={false}
        />
      </Pressable>
      {item.uploading ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, styles.veil]}>
          <ActivityIndicator size="small" color="#fff" />
        </View>
      ) : null}
      {item.error ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, styles.veil]}>
          <Icon name="alert-circle-outline" size={18} color="#fff" />
        </View>
      ) : null}
      {/* The gesture, made visible. Not a target of its own: the tile already
          is one, and a second key on 56pt is mostly a way to miss the first. */}
      <View pointerEvents="none" style={styles.peek}>
        <Icon name="magnify" size={10} color="#fff" />
      </View>
      <Pressable
        onPressIn={() => tapHaptic()}
        onPress={() => onRemove(item.key)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        // A photo that failed is DISMISSED; one that landed is taken off the
        // message but stays in the vault. Two different things, said differently.
        accessibilityLabel={item.error ? 'Dismiss this photo' : 'Take this photo off the message (it stays in the vault)'}
        testID={`draft-photo-remove-${item.key}`}
        style={styles.remove}
      >
        <Icon name="close" size={11} color="#fff" />
      </Pressable>
    </View>
  );
}

export default function MessageDraftPhotos({ items, theme, onView, onRemove }) {
  if (!items || items.length === 0) return null;
  const failed = items.filter((i) => i.error);
  return (
    <View testID="message-draft-photos">
      <View style={styles.row}>
        {items.map((item, i) => (
          <DraftThumb
            key={item.key}
            item={item}
            theme={theme}
            onView={onView ? () => onView(i) : undefined}
            onRemove={onRemove}
          />
        ))}
      </View>
      {failed.length > 0 ? (
        // One line for all of them rather than a message under each 56pt square,
        // which there is no room for.
        <Text numberOfLines={2} style={[styles.error, { color: theme.colors.accentError }]}>
          {failed.length === 1
            ? failed[0].error
            : `${failed.length} photos did not upload — ${failed[0].error}`}
        </Text>
      ) : null}
    </View>
  );
}

/** The attach key, for the composer's left action cluster. */
export function MessageAttachKey({ ids, theme, disabled, onPress }) {
  const c = theme.colors;
  const full = attachmentRoom(ids) <= 0;
  const off = !!disabled || full;
  return (
    <Pressable
      onPressIn={() => { if (!off) tapHaptic(); }}
      onPress={off ? undefined : onPress}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityState={{ disabled: off }}
      accessibilityLabel={full
        ? `A message can carry ${MAX_MESSAGE_ATTACHMENTS} photos`
        : 'Add a photo'}
      testID="message-attach-key"
      style={styles.attachKey}
    >
      <Icon name="image-outline" size={21} color={off ? c.textMuted : c.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingBottom: 2 },
  // Width is set per tile from the photo's ratio — only the height is fixed.
  thumb: {
    height: THUMB, borderRadius: 10, overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  veil: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.42)' },
  peek: {
    position: 'absolute', left: 2, bottom: 2,
    width: 15, height: 15, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  remove: {
    position: 'absolute', top: 2, right: 2,
    width: 17, height: 17, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  error: { fontSize: 11.5, fontWeight: '600', marginTop: 4 },
  attachKey: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
});
