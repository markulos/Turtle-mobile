import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { Image } from 'expo-image';

/**
 * BoardAvatar — one board's disc, app-wide.
 *
 * Instagram-style collage: a board with photos shows up to 4 of its most recent
 * thumbnails packed into the circle (1 = full, 2 = side-by-side columns, 3 = big
 * left + two stacked right, 4 = 2×2 grid). A board without photos keeps a
 * tinted disc carrying its initial. Thumbs hydrate lazily AFTER the names have
 * rendered, so this only ever upgrades a disc in place.
 *
 * Lives in its own module because two surfaces draw the same disc at different
 * sizes — the conversations inbox (44pt rows) and the boards canvas (62–104pt
 * nodes, scaled by how much is on the board). A board has to read as the SAME
 * board on both, which means one implementation, not two that drift.
 */

/**
 * Stable per-name colour, hashing the name to a hue. Matches the calendar's
 * owner-colour convention (and `utils/avatar`'s people discs), so a board reads
 * the same tint everywhere it appears.
 */
export const boardHue = (name) => {
  const s = String(name || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
};

export const boardColor = (name) => `hsl(${boardHue(name)}, 55%, 55%)`;

/**
 * The same colour at an alpha — the wash behind an initial, a node's ring, a
 * selected row.
 *
 * Note the `hsla()` rather than the `hsl(...) + '2A'` this used to be. React
 * Native's colour matcher for `hsl` is unanchored, so it happily matched the
 * `hsl(...)` prefix and threw the hex-alpha suffix away: the wash rendered
 * FULLY opaque, in exactly the colour of the initial drawn on top of it, which
 * is why a photo-less board looked like a blank coloured circle.
 */
export const boardTint = (name, alpha) => `hsla(${boardHue(name)}, 55%, 55%, ${alpha})`;

/** Default disc size — the conversations inbox's row avatar. */
export const AVATAR_SIZE = 44;

const AvatarCell = ({ uri, style, onError }) => (
  <Image
    source={{ uri }}
    style={style}
    contentFit="cover"
    transition={150}
    recyclingKey={uri}
    cachePolicy="memory-disk"
    onError={onError}
  />
);

const BoardAvatar = React.memo(function BoardAvatar({ name, thumbs, base, size = AVATAR_SIZE }) {
  // Thumbs whose fetch failed (deleted media, missing file) drop out so the
  // collage degrades naturally — 4 cells → 3-cell layout → … → initial disc —
  // instead of rendering blank squares.
  const [failed, setFailed] = useState(() => new Set());
  const markFailed = (u) => setFailed((prev) => (prev.has(u) ? prev : new Set(prev).add(u)));
  const tint = boardColor(name);
  const urls = (thumbs || [])
    .map((t) => (typeof t === 'string' && t ? (t.startsWith('http') ? t : base + t) : null))
    .filter(Boolean)
    .filter((u) => !failed.has(u))
    .slice(0, 4);
  if (!urls.length) {
    return (
      <View style={{
        width: size, height: size, borderRadius: size / 2,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: boardTint(name, 0.16),
      }}>
        <Text style={{ fontSize: Math.round(size * 0.41), fontWeight: '700', color: tint }}>
          {String(name || '?').charAt(0).toUpperCase()}
        </Text>
      </View>
    );
  }
  const cell = (i, style) => (
    <AvatarCell uri={urls[i]} style={style} onError={() => markFailed(urls[i])} />
  );
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      overflow: 'hidden', flexDirection: 'row',
      backgroundColor: boardTint(name, 0.16),
    }}>
      {urls.length === 1 && cell(0, { flex: 1 })}
      {urls.length === 2 && (
        <>
          {cell(0, { flex: 1, marginRight: 0.5 })}
          {cell(1, { flex: 1, marginLeft: 0.5 })}
        </>
      )}
      {urls.length === 3 && (
        <>
          {cell(0, { flex: 1, marginRight: 0.5 })}
          <View style={{ flex: 1, marginLeft: 0.5 }}>
            {cell(1, { flex: 1, marginBottom: 0.5 })}
            {cell(2, { flex: 1, marginTop: 0.5 })}
          </View>
        </>
      )}
      {urls.length === 4 && (
        <>
          <View style={{ flex: 1, marginRight: 0.5 }}>
            {cell(0, { flex: 1, marginBottom: 0.5 })}
            {cell(2, { flex: 1, marginTop: 0.5 })}
          </View>
          <View style={{ flex: 1, marginLeft: 0.5 }}>
            {cell(1, { flex: 1, marginBottom: 0.5 })}
            {cell(3, { flex: 1, marginTop: 0.5 })}
          </View>
        </>
      )}
    </View>
  );
});

export default BoardAvatar;
