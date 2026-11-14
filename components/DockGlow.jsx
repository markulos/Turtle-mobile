import React from 'react';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';

/**
 * DockGlow — a soft pool of light, for the dock's indicator.
 *
 * The underline's spot was drawn first as a coloured shadow (too faint to
 * see: a 3pt line is no source) and then as stacked gradient bands (visible,
 * but a linear gradient only falls off one way, so the bands were a
 * staircase standing in for a curve). This is the curve itself: ONE radial
 * gradient, which falls off in every direction at once, drawn as a vector —
 * so there is no step to find at any strength or any screen density.
 *
 * The gradient is mapped onto the ellipse's own box, so squashing the
 * ellipse squashes the light with it: a wide, low pool under the underline,
 * a round one in the middle of the chip. `cx`/`cy`/`rx`/`ry` are fractions
 * of the box, and an ellipse centred ON an edge (cy = 1) shows only its
 * upper half — light rising from a line.
 *
 * The stops are a gaussian's shape rather than a straight ramp: most of the
 * light near the centre, then a long quiet tail to nothing, which is what
 * reads as glow instead of as a disc with a soft edge.
 *
 * Static. It never animates; whoever moves it moves the view it is in
 * (rasterised, like the indicator), so drawing a vector costs once.
 */
const FALLOFF = [
  [0, 1],
  [0.18, 0.82],
  [0.38, 0.5],
  [0.6, 0.2],
  [0.8, 0.05],
  [1, 0],
];

export default function DockGlow({
  id, width, height, color, peak, cx = 0.5, cy = 0.5, rx = 0.5, ry = 0.5,
}) {
  const strength = Math.max(0, Math.min(1, Number(peak) || 0));
  if (strength === 0 || !(width > 0) || !(height > 0)) return null;
  return (
    <Svg width={width} height={height} pointerEvents="none" testID={id}>
      <Defs>
        <RadialGradient id={id} cx="50%" cy="50%" r="50%">
          {FALLOFF.map(([offset, share]) => (
            <Stop key={offset} offset={offset} stopColor={color} stopOpacity={strength * share} />
          ))}
        </RadialGradient>
      </Defs>
      <Ellipse
        cx={cx * width}
        cy={cy * height}
        rx={rx * width}
        ry={ry * height}
        fill={'url(#' + id + ')'}
      />
    </Svg>
  );
}
