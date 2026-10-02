/**
 * The photos on one message, inside its bubble.
 *
 * ── Given ready-made urls, not ids ─────────────────────────────────────────
 *
 * The page decides where a picture comes from, and there are two answers. A
 * message still in flight draws the LOCAL file it was sent with, so the photo is
 * on screen the instant Send is pressed. A settled one is addressed by vault id
 * through `/api/media/display/:id` — a standalone tier the pond generates on
 * demand FROM THE ID ALONE, so there is no lookup before the first pixel.
 *
 * This is not only faster, it is the only thing that WORKS for a photo someone
 * sent YOU. `GET /media/by-ids` is owner-scoped — it answers with the caller's
 * own media and silently omits the rest — so a recipient asking about the photo
 * in their inbox got an empty list and a placeholder that never resolved. That
 * was the bug: sending was always fine, and the picture simply never loaded on
 * the other side. The display tier has no such scoping (it is how a note's
 * viewer has always worked), so the id is enough.
 *
 * A photo that cannot be drawn — deleted from the vault since, or a video, which
 * the display tier refuses — falls back to a quiet frame rather than a broken
 * image. That is decided by the LOAD FAILING, which is the honest test: it
 * reflects what is true right now rather than what a cached row once said.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { tapHaptic } from '../../../utils/haptics';

/** Tile side for a message carrying more than one photo. */
const TILE = 96;
/** Reading size for a message carrying exactly one. */
const SOLO_W = 220;
const SOLO_H = 165;

function Photo({ frameKey, uri, box, frameColor, wellColor, quietFg, onPress }) {
  const [broken, setBroken] = useState(false);

  if (broken) {
    return (
      <View
        style={[styles.well, box, { borderColor: frameColor, backgroundColor: wellColor }]}
        accessibilityLabel="This photo is no longer available"
      >
        <Icon name="image-off-outline" size={18} color={quietFg} />
      </View>
    );
  }

  return (
    <Pressable
      onPressIn={() => tapHaptic()}
      onPress={onPress}
      accessibilityRole="imagebutton"
      accessibilityLabel="Photo"
      testID={`message-photo-${frameKey}`}
      style={[styles.frame, box, { borderColor: frameColor, backgroundColor: wellColor }]}
    >
      <ExpoImage
        source={{ uri }}
        style={StyleSheet.absoluteFillObject}
        // `cover` on a tile, so a grid stays a grid; a lone photo is cropped to
        // its frame too, because a bubble with bands of empty well around a
        // picture reads as a mistake.
        contentFit="cover"
        transition={120}
        recyclingKey={`msg-photo:${frameKey}`}
        onError={() => setBroken(true)}
      />
    </Pressable>
  );
}

export default function MessagePhotos({ photos, mine, theme, onOpen }) {
  if (!photos || photos.length === 0) return null;
  const c = theme.colors;

  const solo = photos.length === 1;
  // On the sender's own bubble the fill is the accent, so the hairline has to be
  // light — the theme border would vanish into it.
  const frameColor = mine ? 'rgba(255,255,255,0.3)' : c.border;
  const wellColor = mine ? 'rgba(255,255,255,0.16)' : c.surfaceHighlight || c.surfaceElevated;
  const quietFg = mine ? 'rgba(255,255,255,0.75)' : c.textTertiary;
  const box = solo ? { width: SOLO_W, height: SOLO_H } : { width: TILE, height: TILE };

  return (
    <View style={styles.wrap}>
      {photos.map((frame, index) => (
        <Photo
          key={frame.key}
          frameKey={frame.key}
          uri={frame.uri}
          box={box}
          frameColor={frameColor}
          wellColor={wellColor}
          quietFg={quietFg}
          onPress={() => onOpen?.(index)}
        />
      ))}
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
