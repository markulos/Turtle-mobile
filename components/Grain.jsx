/**
 * Grain — a fine silver speckle over a flat surface.
 *
 * Mark asked for it on the neumorphic focus page (2026-11-15), off a
 * reference whose panels carry a visible silver tooth. A perfectly flat fill
 * under soft shadows reads as plastic; a little noise reads as a material.
 *
 * ── Why the Image is wrapped, and why that is not tidiness ────────────────
 *
 * The first version was a bare `<Image absoluteFill resizeMode="repeat"
 * borderRadius=…>`, and on the phone it drew ONE 128pt square anchored to the
 * top-left of each panel, square corners and all, hanging off the rounded
 * edges (Mark's screenshot, 2026-11-15). Two separate things went wrong and
 * the wrapper fixes both:
 *
 *   • `borderRadius` on an Image does not reliably clip a repeating fill, so
 *     the texture kept its own square corners over a rounded panel. A parent
 *     View with `overflow: 'hidden'` clips whatever it holds, always.
 *   • an Image whose frame comes only from `absoluteFill` can end up laying
 *     the tile out at its intrinsic size. The wrapper owns the frame and the
 *     Image fills the wrapper, so the area being tiled is never in doubt.
 *
 * ── Why a tiled PNG and not a shader or an SVG filter ─────────────────────
 *
 * `feTurbulence` support in react-native-svg is patchy, and a shader is a
 * dependency for a texture. One decode, one texture, tiled on the GPU —
 * nothing re-renders as the page scrolls.
 *
 * The art is GREY+ALPHA: the grey varies across the whole range so the
 * speckle both lifts and darkens what is under it, and the alpha is constant
 * and low. That is what makes one file work on cream and on charcoal — a
 * white-only noise would only ever lighten, and would vanish on the pale
 * surface it was meant for.
 *
 * Non-interactive and hidden from assistive tech: it is paint.
 */
import React from 'react';
import { Image, StyleSheet, View } from 'react-native';

const GRAIN = require('../assets/grain.png');

/**
 * How much of the speckle lands. The tile's own alpha is already low; this is
 * the second, finer control, and the one to reach for — regenerating the art
 * is not something to do by eye.
 */
export const GRAIN_OPACITY = 0.5;

export default function Grain({ opacity = GRAIN_OPACITY, radius = 0, style, testID = 'grain' }) {
  return (
    <View
      // The clip has its own id: it is the half of this component that
      // actually fixed the bug, so it is the half worth being able to assert.
      testID={`${testID}-clip`}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        StyleSheet.absoluteFillObject,
        // The clip, and the frame the tile is laid out in. Both live here
        // rather than on the Image — see the note above.
        { borderRadius: radius, overflow: 'hidden', opacity },
        style,
      ]}
    >
      <Image
        testID={testID}
        source={GRAIN}
        resizeMode="repeat"
        style={StyleSheet.absoluteFillObject}
      />
    </View>
  );
}
