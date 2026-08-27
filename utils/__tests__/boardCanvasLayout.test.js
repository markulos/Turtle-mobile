/**
 * boardCanvasLayout — the shared geometry primitives behind the Boards canvas.
 *
 * The map itself is assembled by `boardMindMap` and tested there; these cover
 * the pieces it is built from, and in particular the PACKING constant, which is
 * the one number the whole no-overlap guarantee rests on.
 */
const {
  MIN_NODE,
  MAX_NODE,
  NODE_GAP,
  LABEL_BAND,
  PACKING,
  boardWeight,
  nodeDiameter,
  spiralPoint,
  rankBoards,
  canvasFitScale,
} = require('../boardCanvasLayout');

const board = (name, total, lastTs = 0) => ({ name, total, lastTs });

describe('boardWeight', () => {
  it('prefers the server total', () => {
    expect(boardWeight({ name: 'a', total: 12, counts: { tasks: 99 } })).toBe(12);
  });

  it('sums the counts block when there is no total', () => {
    expect(boardWeight({ name: 'a', counts: { tasks: 2, notes: 3, media: 4, chat: 1 } })).toBe(10);
  });

  it('treats a names-only row as empty rather than NaN', () => {
    expect(boardWeight({ name: 'a' })).toBe(0);
    expect(boardWeight(null)).toBe(0);
  });

  it('never returns a negative weight', () => {
    expect(boardWeight({ name: 'a', total: -5 })).toBe(0);
  });
});

describe('nodeDiameter', () => {
  it('gives the busiest board the ceiling and an empty one the floor', () => {
    expect(nodeDiameter(40, 40)).toBe(MAX_NODE);
    expect(nodeDiameter(0, 40)).toBe(MIN_NODE);
  });

  it('scales by AREA, so a quarter of the content is halfway up the range', () => {
    // √(10/40) = 0.5 → the midpoint of [MIN, MAX].
    expect(nodeDiameter(10, 40)).toBeCloseTo(MIN_NODE + (MAX_NODE - MIN_NODE) * 0.5, 5);
  });

  it('falls back to the floor when nothing has any content at all', () => {
    expect(nodeDiameter(0, 0)).toBe(MIN_NODE);
  });

  it('clamps a weight above the busiest instead of overshooting', () => {
    expect(nodeDiameter(400, 40)).toBe(MAX_NODE);
  });
});

describe('rankBoards', () => {
  it('ranks busiest first, then by recency, then by name', () => {
    const ranked = rankBoards([
      board('quiet', 1),
      board('busy', 50),
      board('tied-older', 5, 100),
      board('tied-newer', 5, 900),
      board('alpha', 5, 900),
    ]);
    expect(ranked.map((b) => b.name))
      .toEqual(['busy', 'alpha', 'tied-newer', 'tied-older', 'quiet']);
  });

  it('takes a weight function, because the map ranks by whole subtree', () => {
    const ranked = rankBoards(
      [board('small-tree', 100), board('big-tree', 1)],
      (b) => (b.name === 'big-tree' ? 500 : b.total),
    );
    expect(ranked.map((b) => b.name)).toEqual(['big-tree', 'small-tree']);
  });

  it('never mutates the input', () => {
    const input = [board('b', 1), board('a', 9)];
    const snapshot = JSON.parse(JSON.stringify(input));
    rankBoards(input);
    expect(input).toEqual(snapshot);
  });
});

describe('spiralPoint', () => {
  it('is deterministic — the same index and spacing is the same place, always', () => {
    expect(spiralPoint(7, 100)).toEqual(spiralPoint(7, 100));
  });

  it('never puts a point exactly on the origin', () => {
    // Point 0 sitting at the centre would leave it one spacing unit from point
    // 1 while every other pair is ~1.9 apart, and the whole map would have to
    // be spread to that worst case.
    const { x, y } = spiralPoint(0, 100);
    expect(Math.hypot(x, y)).toBeGreaterThan(0);
  });

  it('grows outward with the index', () => {
    const r = (i) => Math.hypot(spiralPoint(i, 100).x, spiralPoint(i, 100).y);
    expect(r(0)).toBeLessThan(r(1));
    expect(r(10)).toBeLessThan(r(40));
  });

  // THE load-bearing property: the map solves `spacing` for the widest thing it
  // is placing and then places nothing else. If PACKING overstates how far
  // apart the spiral keeps its points, discs simply sit on top of each other —
  // there is no relaxation pass anywhere to rescue it.
  it.each([2, 3, 4, 5, 9, 40, 200, 500])('keeps every pair at least PACKING apart at %i points', (n) => {
    const spacing = 100;
    const points = Array.from({ length: n }, (_, i) => spiralPoint(i, spacing));
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const distance = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
        expect(distance).toBeGreaterThanOrEqual(PACKING * spacing);
      }
    }
  });
});

describe('the gap constants', () => {
  it('leaves a stacked pair enough clear height for the label between them', () => {
    // Two discs a spacing apart must still fit a label band between their
    // edges — that is what NODE_GAP >= LABEL_BAND buys.
    expect(NODE_GAP).toBeGreaterThanOrEqual(LABEL_BAND);
  });
});

describe('canvasFitScale', () => {
  it('shrinks a canvas larger than the viewport', () => {
    // 1000 wide into a 390pt screen, less a 24pt inset on each side.
    expect(canvasFitScale(1000, 1000, 390, 800)).toBeCloseTo(342 / 1000, 5);
  });

  it('never blows a small canvas up past 1x', () => {
    expect(canvasFitScale(200, 200, 390, 800)).toBe(1);
  });

  it('falls back to 1x on a canvas or viewport that has not been measured', () => {
    expect(canvasFitScale(0, 0, 390, 800)).toBe(1);
    expect(canvasFitScale(1000, 1000, 0, 0)).toBe(1);
    // A viewport narrower than its own inset must not produce a negative scale.
    expect(canvasFitScale(1000, 1000, 30, 30)).toBe(1);
  });
});
