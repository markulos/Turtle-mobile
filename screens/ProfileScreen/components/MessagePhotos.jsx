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
 * A photo that cannot be drawn — deleted from the vault since — falls back to a
 * quiet frame rather than a broken image. That is decided by the LOAD FAILING,
 * which is the honest test: it reflects what is true right now rather than what
 * a cached row once said.
 *
 * ── Videos ─────────────────────────────────────────────────────────────────
 *
 * The display tier answers for a video too, with the poster made at import, so
 * a video arrives here as an ordinary still and there is nothing in the picture
 * to say it is one. `video` is what says so, and it comes from a type lookup
 * that runs BESIDE the drawing rather than before it (useMessageMedia) — the
 * frame is never waiting on it. Playing it is the page's job: the bytes live at
 * /api/media/video/:id, which the lightbox is pointed at.
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

function Photo({ frameKey, uri, video, box, frameColor, wellColor, quietFg, onPress }) {
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
      accessibilityLabel={video ? 'Video' : 'Photo'}
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
      {/* A video's still and a photo are the same picture from the display
          tier — this disc is the only thing that says one of them plays. It
          goes in the MIDDLE rather than a corner: the vault's grid uses a
          corner pill because every cell there is the same square and the eye
          scans them as a column, while a bubble is read one at a time. Its
          own ink, not the theme's, because it sits on a photograph. */}
      {video && (
        <View style={styles.playWrap} pointerEvents="none">
          <View style={styles.playDisc}>
            <Icon name="play" size={22} color="#fff" />
          </View>
        </View>
      )}
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
          video={!!frame.video}
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
  playWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  playDisc: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    // The glyph is optically off-centre inside a triangle, so the disc is
    // nudged the other way rather than the picture being left to look wrong.
    paddingLeft: 3,
  },
  well: {
    borderRadius: 12, borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center', justifyContent: 'center',
  },
});
