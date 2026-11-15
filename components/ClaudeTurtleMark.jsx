/**
 * ClaudeTurtleMark — the mark that stands for Claude in a "Claude x Turtle"
 * session: a little face peeking over an edge with a hand either side.
 *
 * Traced from the owner's own felt-pen sketch (2026-11-14) and kept as a LINE
 * drawing, the way it was drawn — round caps, round joins, an outline that
 * does not quite close on the right. It replaces the stock robot glyph, which
 * was nobody's drawing.
 *
 * The art is wide (about 2.3 : 1), so `size` is its WIDTH; the height follows.
 * In a round avatar ring that leaves air above and below as well as at the
 * sides, which is what makes it sit as a mark rather than fill the ring like a
 * photo.
 *
 * The pen gets relatively heavier as the mark gets smaller: a stroke that is
 * right at poster size is a hair at 24 points, and the eyes vanish before the
 * outline does. `weight` is the stroke in screen points, held constant, and
 * the eyes are never drawn smaller than the pen that drew them.
 */
import React from 'react';
import Svg, { Circle, G, Path } from 'react-native-svg';

/** The felt pen's orange, sampled from the sketch. */
export const CLAUDE_MARK_COLOR = '#F5821F';

// The drawing's own coordinate space: the sketch's bounding box plus room for
// the pen, so a heavy stroke is not clipped at the edges.
const BOX = { x: 30, y: 54, w: 316, h: 136 };
export const CLAUDE_MARK_ASPECT = BOX.w / BOX.h;

/**
 * Where a LEDGE runs for the mark to hang over, as a fraction of its height:
 * just under the chin, through the middle of the hands. Put that line on an
 * edge and the face sits above it with the fingers draped down over it —
 * which is what the sketch is a drawing of.
 */
const LEDGE_Y = 150;
export const CLAUDE_MARK_LEDGE = (LEDGE_Y - BOX.y) / BOX.h;

/** How far below its own top edge the ledge is, for a mark `size` wide. */
export const ledgeOffset = (size) => (size / CLAUDE_MARK_ASPECT) * CLAUDE_MARK_LEDGE;

/**
 * The turn, in degrees clockwise, that puts the two HANDS LEVEL.
 *
 * The sketch was drawn leaning: the right hand sits about 16 units higher
 * than the left. Floating on a page that is its charm. Hung over a straight
 * rule it reads as a mistake — the left hand droops well below the line and
 * the right one barely reaches it, so he is not holding on to anything.
 *
 * Measured, not chosen: Mark's own mock-up (2026-11-15) has the mark turned
 * so both hands rest on the ridge, and the angle between the two hands there
 * is 2.2–2.35° clockwise of the art as drawn. The face keeps most of its
 * tilt, which is where the character is.
 *
 * The ledge does not move with it: the turn is about the centre of the art,
 * one hand comes up as far as the other goes down, and the line they share
 * stays at LEDGE_Y.
 */
export const CLAUDE_MARK_LEVEL = 2.3;

/** How tall the mark is for a given width
 — the art drives it, not a guess. */
export const markHeight = (size) => size / CLAUDE_MARK_ASPECT;

const HEAD = 'M264 126 C263 101 246 72 214 68 C184 64 149 85 133 112 '
  + 'C124 127 124 141 138 147 C156 154 186 150 198 130';
const LEFT_HAND = 'M44 160 C46 142 62 128 84 126 C97 124 110 128 111 138 '
  + 'C112 146 101 150 92 152 C95 160 85 167 78 158 C79 170 65 175 62 163 '
  + 'C60 178 44 177 44 160 Z';
const RIGHT_HAND = 'M338 128 C331 113 300 111 285 122 C272 131 264 142 268 150 '
  + 'C272 159 284 155 286 146 C290 158 304 155 304 144 C312 153 326 147 322 136 '
  + 'C332 139 339 135 338 128 Z';

// As drawn: the pen was about 7 units wide and the eyes 5.5 and 6.
const DRAWN_PEN = 7;
const EYES = [{ cx: 176, cy: 103, r: 5.5 }, { cx: 215, cy: 92, r: 6 }];

/** Stroke width in drawing units for a pen of `weight` points at this width. */
export function penFor(size, weight) {
  const units = (weight * BOX.w) / (size || 1);
  return units > DRAWN_PEN ? units : DRAWN_PEN;
}

export default function ClaudeTurtleMark({
  size = 24,
  color = CLAUDE_MARK_COLOR,
  weight = 1.3,
  /**
   * What the HANDS are filled with. 'none' by default — the mark is a line
   * drawing and that is how it was drawn.
   *
   * Pass the colour BEHIND the mark when something crosses it: in the session
   * header a rule runs along the ledge, through the middle of the hands, and
   * an unfilled hand lets that line straight through so the fingers look
   * drawn ON the rule rather than resting over it. Filled with the header's
   * own colour, the hands occlude it and sit on top.
   *
   * The HEAD is never filled, whatever this says: its outline deliberately
   * does not close on the right (see the note at the top), so a fill would
   * leak across the gap — and nothing passes behind the head anyway.
   */
  handFill = 'none',
  /**
   * Degrees clockwise to turn the whole drawing about its own centre. 0 — as
   * drawn — everywhere it floats free; CLAUDE_MARK_LEVEL where it hangs over
   * a straight edge and the hands have to sit level on it.
   */
  tilt = 0,
  testID = 'claude-turtle-mark',
}) {
  const pen = penFor(size, weight);
  // An eye is a dot of the same pen: never smaller than the line beside it.
  const eyeFloor = pen * 0.62;
  return (
    <Svg
      testID={testID}
      width={size}
      height={size / CLAUDE_MARK_ASPECT}
      viewBox={`${BOX.x} ${BOX.y} ${BOX.w} ${BOX.h}`}
      accessible={false}
    >
      {/* One group, so a tilt turns the head, hands and eyes together about
          the middle of the art. The box has room for it: at a few degrees
          nothing reaches the edge. */}
      <G
        testID={`${testID}-art`}
        transform={tilt ? `rotate(${tilt} ${BOX.x + BOX.w / 2} ${BOX.y + BOX.h / 2})` : undefined}
      >
        {[HEAD, LEFT_HAND, RIGHT_HAND].map((d) => (
          <Path
            key={d}
            d={d}
            fill={d === HEAD ? 'none' : handFill}
            stroke={color}
            strokeWidth={pen}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {EYES.map((e) => (
          <Circle key={e.cx} cx={e.cx} cy={e.cy} r={e.r > eyeFloor ? e.r : eyeFloor} fill={color} />
        ))}
      </G>
    </Svg>
  );
}
