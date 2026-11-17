/**
 * Grain — a fine silver speckle over a flat surface.
 *
 * Mark asked for it on the neumorphic focus page (2026-11-15), off a
 * reference whose panels carry a visible silver tooth. A perfectly flat fill
 * under soft shadows reads as plastic; a little noise reads as a material.
 *
 * ── Why this tiles by hand instead of using resizeMode="repeat" ───────────
 *
 * Because `repeat` does not tile on this build. Twice now it has drawn the
 * texture ONCE, at the image's own size, anchored to the top-left of the
 * surface — first spilling square corners over the rounded panels, then
 * (once clipped) covering only the top-left corner of each one. The native
 * path reads as though it should work (RCTImageComponentView makes the image
 * resizable with UIImageResizingModeTile and maps Repeat to ScaleToFill), so
 * the reason it does not is somewhere below that, and chasing it is not worth
 * a texture.
 *
 * So the tiling is explicit: measure the surface, lay down exactly the tiles
 * it takes to cover it, let the wrapper clip the overhang. It is the same one
 * cached bitmap every time — a dozen Images sharing a source cost a dozen
 * quads, not a dozen decodes — and it cannot silently half-cover anything,
 * because the count comes from the measurement.
 *
 * ── Why the Image is wrapped ──────────────────────────────────────────────
 *
 * `borderRadius` on an Image does not reliably clip a fill, so the texture
 * kept its square corners over a rounded panel. A parent View with
 * `overflow: 'hidden'` clips whatever it holds, always — and it is also what
 * gives `onLayout` something to measure.
 *
 * ── The art ───────────────────────────────────────────────────────────────
 *
 * GREY+ALPHA: the grey varies across the whole range so the speckle both
 * lifts and darkens what is under it, and the alpha is constant and low.
 * That is what makes one file work on cream and on charcoal — a white-only
 * noise would only ever lighten, and would vanish on the pale surface it was
 * meant for.
 *
 * Non-interactive and hidden from assistive tech: it is paint.
 */
import React, { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

const GRAIN = require('../assets/grain.png');

/**
 * The art's own size IN POINTS. Tiles are laid at exactly this, so they meet
 * edge to edge with no gap and no overlap — which is what makes the repeat
 * seamless. Change it here and the asset has to change with it.
 *
 * The art ships at three densities (grain.png / @2x / @3x), all of them this
 * many points. On a modern phone that means @3x, where one speckle is ONE
 * DEVICE PIXEL — the fine tooth Mark asked for, rather than the 1pt blocks
 * the single-density asset was drawing.
 */
export const GRAIN_TILE = 128;

/**
 * How much of the speckle lands. The tile's own alpha is already low; this is
 * the second, finer control, and the one to reach for — regenerating the art
 * is not something to do by eye.
 */
export const GRAIN_OPACITY = 0.5;

/**
 * How many tiles a surface of this size needs, as [columns, rows].
 *
 * Exported for the test: "it covers the whole surface" is the one claim worth
 * pinning and the one nothing on screen will tell you, since a half-covered
 * panel still renders perfectly happily.
 */
/**
 * THE PANEL'S DUSTING, as a fraction of the page's.
 *
 * Mark, 2026-11-16: the tiles should be "a lighter colour and finer grain"
 * than the ground. The speckle is already one device pixel at @3x, so it
 * cannot be drawn smaller — what makes a surface read as finer-grained is
 * LESS of it, the same tooth more lightly dusted. Half.
 *
 * A multiplier rather than a second opacity, so the person's setting still
 * moves both surfaces together and Off is still off everywhere.
 */
export const FINE_GRAIN = 0.5;

export function grainTiles(width, height, tile = GRAIN_TILE) {
  const cols = width > 0 ? Math.ceil(width / tile) : 0;
  const rows = height > 0 ? Math.ceil(height / tile) : 0;
  return [cols, rows];
}

/**
 * `tint` recolours the speckle — see the note on the Image below. Without
 * one the tooth is the art's own grey, which is the silver every other
 * surface in the app wears.
 *
 * `level` is the person's setting (Settings → Appearance), passed DOWN rather
 * than read from the theme here. Reaching into ThemeContext from a leaf like
 * this pulls AsyncStorage into every consumer's tests — utils/inputField.js
 * carries the note about what that cost last time. It multiplies the designed
 * opacity, so a surface keeps its relative weights and the setting moves all
 * of them together.
 */
export default function Grain({
  level = 1, fine = false, tint, opacity = GRAIN_OPACITY, radius = 0, style, testID = 'grain',
}) {
  const strength = opacity
    * (Number.isFinite(level) ? Math.max(0, level) : 1)
    * (fine ? FINE_GRAIN : 1);
  // Measured rather than assumed: a fixed grid big enough for the largest
  // surface would lay dozens of tiles inside a small one and throw them away.
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [cols, rows] = grainTiles(size.width, size.height);
  // Off is off: no measurement to honour, no tiles to lay.
  if (strength <= 0) return null;

  return (
    <View
      testID={`${testID}-clip`}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setSize((prev) => (prev.width === width && prev.height === height
          ? prev
          : { width, height }));
      }}
      style={[
        StyleSheet.absoluteFillObject,
        { borderRadius: radius, overflow: 'hidden', opacity: strength },
        style,
      ]}
    >
      {Array.from({ length: cols * rows }, (_, i) => (
        <Image
          key={i}
          testID={i === 0 ? testID : undefined}
          source={GRAIN}
          /**
           * ANODIZED, when a surface asks for it.
           *
           * The art is grey noise with an alpha channel, so by default the
           * speckle is silver — a neutral tooth that suits a cream or a
           * charcoal page. `tint` recolours every speckle without touching
           * the alpha, which is what turns brushed aluminium into aluminium
           * ANODIZED in a colour: the same grain, catching light in the
           * surface's own hue rather than in grey (Mark, 2026-11-16).
           */
          tintColor={tint}
          style={{
            position: 'absolute',
            left: (i % cols) * GRAIN_TILE,
            top: Math.floor(i / cols) * GRAIN_TILE,
            width: GRAIN_TILE,
            height: GRAIN_TILE,
          }}
        />
      ))}
    </View>
  );
}
