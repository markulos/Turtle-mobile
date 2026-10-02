/**
 * The photos on one message, inside its bubble.
 *
 * A message holds ids; the SCREEN resolves them in one pass (useThreadPhotos) and
 * this draws whatever came back. Three outcomes, all ordinary:
 *
 *   - resolved and viewable → a picture. One photo gets reading size, because a
 *     photo sent on its own IS the message; several share a tile grid, the way
 *     every other thread app does it.
 *   - resolved but not a picture → nothing is drawn here. The composer only ever
 *     attaches images, so this is a photo someone sent from the web with a video
 *     among them; the bubble's words still arrive, which is the point.
 *   - gone from the vault → a quiet placeholder rather than a silent gap. A
 *     message outlives the photo it points at, and a bubble that showed nothing
 *     would read as a bug in the message rather than as a deleted file.
 *
 * Still unresolved is the fourth state, and it is deliberately a reserved tile:
 * the thread is pinned to its newest line, so a photo that appeared with no space
 * held for it would shove that line out of view as it loaded.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { isImage, stripThumbUrl, viewerImages } from '../../../utils/mediaAttachments';
import { tapHaptic } from '../../../utils/haptics';

/** Tile side for a message carrying more than one photo. */
const TILE = 96;
/** Reading size for a message carrying exactly one. */
const SOLO_W = 220;
const SOLO_H = 165;

/** Can this row be drawn at all? Same rule the note strip uses. */
const viewable = (m) => !!m && isImage(m) && !!(m.thumbnailLgUrl || m.thumbnailUrl);

export default function MessagePhotos({
  ids,
  /** Map(id → media row), from useThreadPhotos. */
  photos,
  origin,
  /** True on the sender's own bubble — its fill is the accent, so the frame
   *  hairline has to be light rather than the theme border. */
  mine,
  theme,
  /** Open the viewer on this message's pictures, starting at `index`. */
  onOpen,
}) {
  if (!ids || ids.length === 0) return null;
  const c = theme.colors;

  // The viewer's list is the PICTURES of this message, in message order, so the
  // index a tile reports lines up with what the arrows then step through.
  const rows = ids.map((id) => photos?.get?.(String(id))).filter(viewable);
  const openable = viewerImages(origin, rows);

  const solo = ids.length === 1;
  const frameColor = mine ? 'rgba(255,255,255,0.3)' : c.border;
  const wellColor = mine ? 'rgba(255,255,255,0.16)' : c.surfaceHighlight || c.surfaceElevated;
  const quietFg = mine ? 'rgba(255,255,255,0.75)' : c.textTertiary;

  const box = solo
    ? { width: SOLO_W, height: SOLO_H }
    : { width: TILE, height: TILE };

  return (
    <View style={styles.wrap}>
      {ids.map((id) => {
        const m = photos?.get?.(String(id));

        if (!m) {
          // Two different unknowns, and the bubble treats them the same: nothing
          // has resolved yet, and nothing ever will. Both hold the space.
          return (
            <View
              key={id}
              style={[styles.well, box, { borderColor: frameColor, backgroundColor: wellColor }]}
              accessibilityLabel="Photo"
            >
              <Icon name="image-outline" size={18} color={quietFg} />
            </View>
          );
        }
        if (!viewable(m)) return null;

        const index = Math.max(0, openable.findIndex((img) => img.key === String(id)));
        return (
          <Pressable
            key={id}
            onPressIn={() => tapHaptic()}
            onPress={() => onOpen?.(openable, index)}
            accessibilityRole="imagebutton"
            accessibilityLabel={m.name || 'Photo'}
            testID={`message-photo-${id}`}
            style={[styles.frame, box, { borderColor: frameColor, backgroundColor: wellColor }]}
          >
            <ExpoImage
              source={{ uri: stripThumbUrl(origin, m) }}
              style={StyleSheet.absoluteFillObject}
              // `cover` on a tile, so a grid stays a grid; a lone photo is also
              // cropped to its frame rather than letterboxed, because a bubble
              // with bands of empty well around a picture reads as a mistake.
              contentFit="cover"
              transition={120}
              recyclingKey={`msg-photo:${id}`}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // Sits ABOVE the words, the way a photo with a caption reads. Wraps, so three
  // tiles never run past the bubble's own max width.
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 6 },
  frame: { borderRadius: 12, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  well: {
    borderRadius: 12, borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center', justifyContent: 'center',
  },
});
