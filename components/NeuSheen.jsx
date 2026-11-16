/**
 * NeuSheen — the light catching the TOP of a raised panel.
 *
 * Mark, 2026-11-16: "in focus, make the top of each panel tile be lighter
 * than the backdrop silver grain of the tab itself."
 *
 * ── Why this is not a contradiction of §9 ─────────────────────────────────
 *
 * The rule is that a neumorphic panel is the SAME COLOUR as its page, and
 * only the light separates them. This is light. The panel's shading already
 * says the source is above-left — a highlight on that side, a shadow on the
 * other — and a real surface lifted toward a light does not only cast; its
 * upper face catches. Flat across the whole tile it read as a printed
 * rectangle, and on a page covered in grain the tiles went missing in it.
 *
 * So the BODY of the panel is still exactly the page's colour. Only the top
 * is lifted, and it falls off to nothing well before the middle — which is
 * what makes it read as light rather than as a two-tone fill.
 *
 * ── The colour is the panel's own ─────────────────────────────────────────
 *
 * `neuTones().lit` — the same tone the panel's own highlight is drawn in, so
 * there is one light in the room and it follows the theme. A hand-picked
 * white would be a second light source, and on the dark page it would be the
 * wrong one entirely.
 *
 * ── Under the grain, over the fill ────────────────────────────────────────
 *
 * The caller lays this first and `<Grain>` second: the tooth belongs to the
 * material, so it sits ON the lit face rather than under it. Grain first
 * would put a film of speckle between the surface and its own light.
 *
 * Takes no touches and announces nothing — it is paint, like Grain.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { neuTones } from '../utils/neumorph';

/**
 * How far down the panel the light reaches, and how strong it starts.
 *
 * Short and faint on purpose. Past about a third it stops being a lit edge
 * and becomes a gradient fill — the thing every neumorphic mock-up on the
 * internet gets wrong — and above about 0.5 alpha the top of the tile reads
 * as a different colour from the bottom rather than as the same colour in
 * better light.
 */
export const SHEEN_REACH = 0.34;
export const SHEEN_ALPHA = 0.9;

/** `lit` as rgba — the tone is a hex, and the fade needs an alpha on it. */
export function sheenColors(surface, mode) {
  const tones = neuTones(surface, mode);
  if (!tones) return null;
  const hex = tones.lit.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  if ([r, g, b].some((n) => Number.isNaN(n))) return null;
  return [`rgba(${r},${g},${b},${SHEEN_ALPHA})`, `rgba(${r},${g},${b},0)`];
}

/**
 * `colors` comes from `sheenColors`, computed ONCE by the page and threaded
 * down beside `neu` — the same arrangement the shading uses, and for the same
 * reason: a sub-panel must not be able to disagree with its page about where
 * the light is, and the sub-panels here take `pal` but not `theme`.
 */
export default function NeuSheen({ colors, radius = 0, testID = 'neu-sheen' }) {
  if (!colors) return null;
  return (
    <LinearGradient
      colors={colors}
      // Straight down. The panel's shading is above-LEFT, but a diagonal
      // sheen on a wide tile lights one corner and leaves the other dark,
      // which reads as a crease rather than as a face.
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: SHEEN_REACH }}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
      style={[StyleSheet.absoluteFillObject, { borderRadius: radius }]}
    />
  );
}
