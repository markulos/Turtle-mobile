import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

// ── Diagonal hatch backdrop (no SVG) ──────────────────────────
//
// A single Text node paints a deterministic grid of diagonal box-drawing
// glyphs. This keeps the hatch treatment without mounting a native View for
// every stripe (the original implementation created about 167 per card).
// The wrapper clips to the caller's card radius without clipping the card's
// own shadow.
//
// Used to tint calendar task cards with a low-opacity wash in their board's
// colour. Extra rows/columns are clipped, so the same texture covers compact
// cards and tall calendar blocks with two native nodes total.
const HATCH_ROW = '╱  '.repeat(12);
const HATCH_GLYPHS = Array.from(
  { length: 20 },
  (_, row) => `${' '.repeat(row % 3)}${HATCH_ROW}`,
).join('\n');

export function HatchBackdrop({ color, opacity = 0.16, style }) {
  if (!color) return null;
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { overflow: 'hidden', opacity }, style]}
    >
      <Text
        selectable={false}
        allowFontScaling={false}
        accessible={false}
        style={{
          position: 'absolute',
          top: -12,
          left: -18,
          width: '180%',
          color,
          fontSize: 14,
          lineHeight: 26,
          letterSpacing: 7,
          includeFontPadding: false,
        }}
      >
        {HATCH_GLYPHS}
      </Text>
    </View>
  );
}
