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

// The head is two things in one stroke: the DOME (right side, over the top,
// down the left to the chin) and the SMILE, which the same line hooks into.
const DOME = 'M264 126 C263 101 246 72 214 68 C184 64 149 85 133 112 '
  + 'C124 127 124 141 138 147';
const HEAD = `${DOME} C156 154 186 150 198 130`;

// The centre the art turns about, and where a FILLED face ends: just above
// the ledge line, so the face stands behind the ridge rather than over it.
const CX = BOX.x + BOX.w / 2;
const CY = BOX.y + BOX.h / 2;
const FACE_BASE_Y = LEDGE_Y - 1;

/**
 * The face as a closed SHAPE, for a filled mark: the dome, shut along a
 * straight base. The stroke cannot be filled as it is — it is open, and
 * closing it corner to corner cuts a wedge out of the face along the smile.
 *
 * The base is drawn pre-turned against `tilt`, so that after the whole
 * drawing is turned it comes out LEVEL — parallel to the ridge it sits on,
 * not sloping across it.
 */
export function facePath(tilt = 0, drop = 0) {
  const a = (tilt * Math.PI) / 180;
  // `drop` carries the base further DOWN, for a caller that clips the face at
  // the ledge itself and needs shape below the line to clip (the animated mark
  // tips the head back, and a base that ended at the ledge would lift off it).
  const baseAt = (x) => CY + (FACE_BASE_Y + drop - CY - (x - CX) * Math.sin(a)) / Math.cos(a);
  return `${DOME} L146 ${baseAt(146).toFixed(2)} L264 ${baseAt(264).toFixed(2)} Z`;
}

/**
 * The mark at night: a white figure with a black line. On a dark header the
 * black outline disappears into the page and what is left is the shapes —
 * a white face with black eyes and a black smile, a white hand either side.
 */
export const CLAUDE_MARK_NIGHT = { line: '#000000', fill: '#FFFFFF' };
const LEFT_HAND = 'M44 160 C46 142 62 128 84 126 C97 124 110 128 111 138 '
  + 'C112 146 101 150 92 152 C95 160 85 167 78 158 C79 170 65 175 62 163 '
  + 'C60 178 44 177 44 160 Z';
const RIGHT_HAND = 'M338 128 C331 113 300 111 285 122 C272 131 264 142 268 150 '
  + 'C272 159 284 155 286 146 C290 158 304 155 304 144 C312 153 326 147 322 136 '
  + 'C332 139 339 135 338 128 Z';

/**
 * HOW FAR THE RESTING HANDS SIT BELOW WHERE THEY WERE DRAWN — in the drawing's
 * own units, so it scales with the mark rather than with the screen.
 *
 * As drawn, the ledge rule crosses the hands through their MIDDLE, and a hand
 * cut in half by a line reads as drawn on it. Perched, the line wants to cross
 * nearer their tops with the fingers draped over the front of the edge. Mark,
 * 2026-11-16: "bring the hands down like 5 pixels so it looks more like they
 * are perched over the line edge."
 *
 * 5 device pixels at @3x is 1.7pt, and the mark is 80pt wide in the header —
 * so 1.7 × 316/80 ≈ 6.7 units. Rendered against the rule at 0 / 1.2 / 1.7 /
 * 2.4 / 3.4 / 5pt before picking: past about 2.5pt the hands come away from
 * the chin and read as floating under the line rather than holding it.
 *
 * The LEDGE DOES NOT MOVE — only the hands. The rule is the header's centre
 * line and everything else is measured from it.
 */
export const HAND_PERCH = 6.7;

// As drawn: the pen was about 7 units wide and the eyes 5.5 and 6.
const DRAWN_PEN = 7;
const EYES = [{ cx: 176, cy: 103, r: 5.5 }, { cx: 215, cy: 92, r: 6 }];

/** Stroke width in drawing units for a pen of `weight` points at this width. */
export function penFor(size, weight) {
  const units = (weight * BOX.w) / (size || 1);
  return units > DRAWN_PEN ? units : DRAWN_PEN;
}

/**
 * THE THINKING HAND — CHIN IN HAND. The index finger and the thumb are out
 * and apart, making a V; the chin sits in the V, the index lying up along
 * the jaw on one side, the thumb standing up on the other, and the fist
 * hangs below with the knuckle of the curled fingers showing on its side.
 * The tail of the smile shows above the V, between the two.
 *
 * TRACED FROM MARK'S OWN SKETCH of the pose (2026-11-16) — the fourth go at
 * it, and the first drawn by him rather than guessed at: a lone finger, a
 * flat hand, a fist with a finger at the mouth, and that fist with a thumb
 * stuck out sideways all came before it.
 *
 * Drawn about the WEB of the hand — the bottom of the V, where the chin
 * rests — so CLAUDE_POINT_AT is simply where the chin is. The fist hangs
 * below the ledge, as the resting hands do.
 *
 * Not part of the still mark: only the animated one asks for it.
 */
// TRACED A SECOND TIME, from Mark's own correction of the drawing
// (2026-11-16, "make the hand design a little closer to this" — he had
// redrawn the hand over a render of it). What his has that the first tracing
// did not:
//   • an index that WIDENS toward its base, with a round, blunt tip;
//   • a thumb with a round cap and a WAIST where it joins the hand;
//   • a base that SLANTS — low under the knuckles, rising to the thumb side;
//   • TWO round knuckles down the side, each a single arc, about as long
//     as each other and as the fingers of the resting hands.
//
// The index and the thumb-side-and-base runs are smooth curves through his
// points; they meet at corners — the web, and the notches either side of the
// knuckles. Order: index (underside, tip, top) → web → thumb → side → base
// → lower knuckle → upper knuckle.
const POINT_HAND = 'M-19.8 3.8 C-20.8 3 -23.7 0.7 -25.8 -1 C-27.9 -2.6 -30.6 -4.6 -32.1 -6 '
  + 'C-33.6 -7.4 -34.3 -8.1 -34.9 -9.2 C-35.6 -10.4 -35.9 -11.8 -36 -13 '
  + 'C-36 -14.2 -35.9 -15.7 -35.2 -16.7 C-34.5 -17.7 -33.3 -18.8 -32 -19.1 '
  + 'C-30.7 -19.4 -29.5 -19.5 -27.3 -18.5 C-25.1 -17.6 -21.6 -15.2 -18.8 -13.4 '
  + 'C-16 -11.5 -13.4 -9.6 -10.3 -7.4 C-7.1 -5.1 -1.7 -1.2 0 0 '
  + 'C1.1 -0.9 4.1 -3.3 6.4 -5.5 C8.7 -7.7 11.6 -11.3 13.6 -13.3 '
  + 'C15.6 -15.3 17.1 -16.5 18.4 -17.4 C19.8 -18.2 20.6 -18.3 21.8 -18.3 '
  + 'C23 -18.4 24.5 -18.2 25.5 -17.7 C26.5 -17.1 27.4 -16.3 27.9 -15.2 '
  + 'C28.5 -14.2 28.6 -12.9 28.6 -11.4 C28.7 -10 28.6 -8.7 28.3 -6.4 '
  + 'C28 -4.1 26.9 -0.7 27 2.2 C27.1 5.1 28.6 8.5 29 11 '
  + 'C29.4 13.4 30 14.7 29.5 17 C29 19.3 27.6 22.9 26.2 24.6 '
  + 'C24.8 26.4 22.8 26.5 20.9 27.4 C18.9 28.2 17.3 28.6 14.5 29.5 '
  + 'C11.6 30.3 6.7 32.1 3.8 32.5 C0.9 32.9 -0.9 32.8 -2.8 32.1 '
  + 'C-4.8 31.4 -7.1 28.9 -8 28.2 C-13.7 32.3 -21.7 23.4 -17.1 18.1 '
  + 'C-24.4 18.6 -26.7 6 -19.8 3.8 Z';
/** Where one knuckle ends and the next begins, about the web — see the tests. */
export const CLAUDE_POINT_KNUCKLES = [{ x: -8, y: 28.2 }, { x: -17.1, y: 18.1 }, { x: -19.8, y: 3.8 }];
/** The tips of the two fingers that are out, about the web — see the tests. */
export const CLAUDE_POINT_TIPS = { index: { x: -36, y: -13 }, thumb: { x: 21.8, y: -18.3 } };
/** The thumb's waist, and the side of the fist below it — the dent between. */
export const CLAUDE_POINT_WAIST = { waist: 27, above: 28.6, below: 29.3 };
/** How far the fist hangs below the web. */
export const CLAUDE_POINT_DROP = 32.5;
/** Where the web of the thinking hand sits — under the chin — and its turn. */
export const CLAUDE_POINT_AT = { x: 197, y: 153 };
export const CLAUDE_POINT_TURN = 0;

/** One unit of the drawing, in points, on a mark `size` wide. */
export const artUnit = (size) => size / BOX.w;

/** The layers of the still mark. A caller may also ask for one hand alone. */
export const CLAUDE_MARK_PARTS = ['face', 'eyes', 'hands'];

/**
 * A point of the DRAWING — in its own units — as POINTS inside a mark `size`
 * wide turned by `tilt`. For a caller that has to put or move something
 * where a part of the drawing is (the animated mark: its eyes, and the hand
 * it lifts to the chin).
 */
export function artPoint(size, tilt, x, y) {
  const k = size / BOX.w;
  const a = (tilt * Math.PI) / 180;
  const dx = x - CX;
  const dy = y - CY;
  return {
    x: (CX + dx * Math.cos(a) - dy * Math.sin(a) - BOX.x) * k,
    y: (CY + dx * Math.sin(a) + dy * Math.cos(a) - BOX.y) * k,
  };
}

/** Where the two eyes are, in points — centre and radius. See artPoint. */
export function eyeDots(size, tilt = 0, weight = 1.3) {
  const k = size / BOX.w;
  const floor = penFor(size, weight) * 0.62;
  return EYES.map((e) => ({
    ...artPoint(size, tilt, e.cx, e.cy),
    r: (e.r > floor ? e.r : floor) * k,
  }));
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
   * What the FACE is filled with. 'none' by default. A colour draws the face
   * as a solid shape behind the line (see facePath) — the head STROKE itself
   * is still never filled, for the reason above.
   */
  faceFill = 'none',
  /** Units to carry the face shape below the ledge — see facePath. */
  faceDrop = 0,
  /**
   * Degrees clockwise to turn the whole drawing about its own centre. 0 — as
   * drawn — everywhere it floats free; CLAUDE_MARK_LEVEL where it hangs over
   * a straight edge and the hands have to sit level on it.
   */
  tilt = 0,
  /**
   * Which layers to draw: any of 'face' (the head line, and the face shape
   * when `faceFill` is set), 'eyes', 'hands' — or 'leftHand' / 'rightHand'
   * for one of them alone, and 'pointHand' for the thinking pose's hand. The
   * still mark is the first three. The animated mark draws them one layer at
   * a time so each can move on its own.
   */
  parts = CLAUDE_MARK_PARTS,
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
        transform={tilt ? `rotate(${tilt} ${CX} ${CY})` : undefined}
      >
        {parts.includes('face') && faceFill !== 'none' && (
          <Path testID={`${testID}-face`} d={facePath(tilt, faceDrop)} fill={faceFill} stroke="none" />
        )}
        {parts.includes('face') && (
          <Path
            d={HEAD}
            fill="none"
            stroke={color}
            strokeWidth={pen}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {/* THE RESTING HANDS, dropped so the rule crosses them near their tops
            and the fingers hang over the front of the edge (HAND_PERCH). Their
            own group: the head and the pointing hand stay where they were
            drawn — the pointing one is placed at the MOUTH, which has not
            moved. */}
        <G testID={`${testID}-hands`} transform={`translate(0 ${HAND_PERCH})`}>
          {[
            (parts.includes('hands') || parts.includes('leftHand')) && LEFT_HAND,
            (parts.includes('hands') || parts.includes('rightHand')) && RIGHT_HAND,
          ].filter(Boolean).map((d) => (
            <Path
              key={d}
              d={d}
              fill={handFill}
              stroke={color}
              strokeWidth={pen}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </G>
        {parts.includes('pointHand') && (
          <G transform={`translate(${CLAUDE_POINT_AT.x} ${CLAUDE_POINT_AT.y}) rotate(${CLAUDE_POINT_TURN})`}>
            <Path
              testID={`${testID}-point`}
              d={POINT_HAND}
              fill={handFill}
              stroke={color}
              strokeWidth={pen}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </G>
        )}
        {parts.includes('eyes') && EYES.map((e) => (
          <Circle key={e.cx} cx={e.cx} cy={e.cy} r={e.r > eyeFloor ? e.r : eyeFloor} fill={color} />
        ))}
      </G>
    </Svg>
  );
}
