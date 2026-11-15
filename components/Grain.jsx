/**
 * Grain — a fine silver speckle over a flat surface.
 *
 * Mark asked for it on the neumorphic focus page (2026-11-15), off a
 * reference whose panels carry a visible silver tooth: "a bit of a silver
 * grain colour like in this screenshot". A perfectly flat fill under soft
 * shadows reads as plastic; a little noise reads as a material.
 *
 * ── Why a tiled PNG and not a shader or an SVG filter ──────────────────────
 *
 * `feTurbulence` is the obvious answer and react-native-svg's support for it
 * is patchy, and a shader is a dependency for a texture. A 128pt tile is one
 * decode, one texture, and `resizeMode="repeat"` is doing the work on the GPU
 * — nothing re-renders as the page scrolls.
 *
 * The art is GREY+ALPHA: the grey varies across the whole range so the
 * speckle both lifts and darkens what is under it, and the alpha is constant
 * and low. That is what makes one file work on cream and on charcoal — a
 * white-only noise would only ever lighten, and would vanish on the pale
 * surface it was meant for.
 *
 * Non-interactive and hidden from assistive tech: it is a texture, and a
 * screen reader announcing it would be announcing the paint.
 */
import React from 'react';
import { Image, StyleSheet } from 'react-native';

const GRAIN = require('../assets/grain.png');

/**
 * How much of the speckle lands. The tile's own alpha is already low; this is
 * the second, finer control, and the one to reach for — regenerating the art
 * is not something to do by eye.
 */
export const GRAIN_OPACITY = 0.55;

export default function Grain({ opacity = GRAIN_OPACITY, radius, style, testID = 'grain' }) {
  return (
    <Image
      testID={testID}
      source={GRAIN}
      resizeMode="repeat"
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        StyleSheet.absoluteFillObject,
        // Clipped to the surface it dresses: a square of speckle hanging off
        // a rounded panel's corners is worse than no texture at all.
        radius != null && { borderRadius: radius },
        { opacity },
        style,
      ]}
    />
  );
}
