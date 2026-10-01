/**
 * imageEditorGeometry — where a finger landed ON THE PHOTO.
 *
 * This arithmetic is the whole correctness of the editor's pen and lasso, and
 * it is the kind that fails silently: a stroke offset by the letterbox still
 * draws, still saves, and only looks wrong next to the thing it was meant to
 * point at. Worse, it is RIGHT by accident whenever the photo happens to fill
 * the stage — so every test here uses a photo whose aspect differs from the
 * stage's, which is the normal case on a phone.
 */
import {
  MAX_POINTS,
  MAX_STROKES,
  appendPoint,
  fitRect,
  isOutsidePhoto,
  isUsableOutline,
  svgPathIn,
  toPhotoPoint,
  widthFraction,
} from '../imageEditorGeometry';

describe('fitRect', () => {
  test('letterboxes a wide photo in a tall stage, centred', () => {
    // 4000x3000 photo (4:3) in a 300x600 stage: width-bound, so 300x225.
    expect(fitRect({ w: 300, h: 600 }, { w: 4000, h: 3000 }))
      .toEqual({ x: 0, y: 187.5, w: 300, h: 225 });
  });

  test('pillarboxes a tall photo in a wide stage, centred', () => {
    // 3000x4000 in 600x300: height-bound, so 225x300.
    expect(fitRect({ w: 600, h: 300 }, { w: 3000, h: 4000 }))
      .toEqual({ x: 187.5, y: 0, w: 225, h: 300 });
  });

  test('a photo of the same aspect fills the stage exactly', () => {
    expect(fitRect({ w: 300, h: 600 }, { w: 1000, h: 2000 }))
      .toEqual({ x: 0, y: 0, w: 300, h: 600 });
  });

  test('an unmeasured stage is a zero rect, not a division by zero', () => {
    expect(fitRect({ w: 0, h: 0 }, { w: 100, h: 100 })).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    expect(fitRect(null, null)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });

  test('a row with no dimensions falls back to the stage', () => {
    // At worst uniformly stretched, never offset — the version a person notices.
    expect(fitRect({ w: 300, h: 600 }, { w: 0, h: 0 }))
      .toEqual({ x: 0, y: 0, w: 300, h: 600 });
    expect(fitRect({ w: 300, h: 600 }, undefined))
      .toEqual({ x: 0, y: 0, w: 300, h: 600 });
  });
});

describe('toPhotoPoint', () => {
  // The rect a 4:3 photo occupies in a 300x600 stage.
  const rect = { x: 0, y: 187.5, w: 300, h: 225 };

  test('subtracts the letterbox — the photo\'s top-left is 0,0', () => {
    expect(toPhotoPoint({ x: 0, y: 187.5 }, rect)).toEqual([0, 0]);
    expect(toPhotoPoint({ x: 300, y: 412.5 }, rect)).toEqual([1, 1]);
  });

  test('the middle of the photo is 0.5, 0.5 — NOT the middle of the stage', () => {
    expect(toPhotoPoint({ x: 150, y: 300 }, rect)).toEqual([0.5, 0.5]);
    // The stage's own middle is y=300 here only because the photo is centred;
    // a top-aligned photo proves the offset is really being applied.
    const top = { x: 0, y: 0, w: 300, h: 225 };
    expect(toPhotoPoint({ x: 150, y: 300 }, top)).toEqual([0.5, 1]);
  });

  test('a finger that slides off the photo CLAMPS to the edge', () => {
    // Ordinary drawing: the honest reading is a stroke that runs to the edge.
    expect(toPhotoPoint({ x: -40, y: 100 }, rect)).toEqual([0, 0]);
    expect(toPhotoPoint({ x: 900, y: 9000 }, rect)).toEqual([1, 1]);
  });

  test('refuses a rect it cannot divide by, and a touch it cannot read', () => {
    expect(toPhotoPoint({ x: 10, y: 10 }, { x: 0, y: 0, w: 0, h: 0 })).toBeNull();
    expect(toPhotoPoint({ x: undefined, y: 10 }, rect)).toBeNull();
    expect(toPhotoPoint(null, rect)).toBeNull();
  });
});

describe('isOutsidePhoto', () => {
  const rect = { x: 0, y: 187.5, w: 300, h: 225 };

  test('a tap in the letterbox is outside; one on the photo is not', () => {
    expect(isOutsidePhoto({ x: 150, y: 20 }, rect)).toBe(true);
    expect(isOutsidePhoto({ x: 150, y: 580 }, rect)).toBe(true);
    expect(isOutsidePhoto({ x: 150, y: 300 }, rect)).toBe(false);
  });

  test('the edges count as on the photo', () => {
    expect(isOutsidePhoto({ x: 0, y: 187.5 }, rect)).toBe(false);
    expect(isOutsidePhoto({ x: 300, y: 412.5 }, rect)).toBe(false);
  });

  test('an unmeasured rect is outside everything, so no stroke starts', () => {
    expect(isOutsidePhoto({ x: 10, y: 10 }, { x: 0, y: 0, w: 0, h: 0 })).toBe(true);
    expect(isOutsidePhoto({ x: NaN, y: 10 }, rect)).toBe(true);
  });
});

describe('appendPoint', () => {
  test('keeps a point that moved far enough, drops one that did not', () => {
    const points = [[0.5, 0.5]];
    expect(appendPoint(points, [0.6, 0.5], 0.01)).toEqual([[0.5, 0.5], [0.6, 0.5]]);
    // Sub-threshold: the SAME array back, so the caller can skip a re-render.
    expect(appendPoint(points, [0.5005, 0.5], 0.01)).toBe(points);
  });

  test('measures distance diagonally, not per axis', () => {
    // 0.008 on each axis is 0.0113 of travel — far enough at a 0.01 threshold,
    // though neither axis alone is.
    expect(appendPoint([[0, 0]], [0.008, 0.008], 0.01)).toHaveLength(2);
  });

  test('the first point is always kept, and a missing one is a no-op', () => {
    expect(appendPoint([], [0.1, 0.1], 0.5)).toEqual([[0.1, 0.1]]);
    const points = [[0.1, 0.1]];
    expect(appendPoint(points, null, 0)).toBe(points);
  });

  test('stops at the pond\'s cap instead of posting a drawing it will refuse', () => {
    const full = Array.from({ length: MAX_POINTS }, (_, i) => [i / MAX_POINTS, 0.5]);
    expect(appendPoint(full, [0.99, 0.99], 0)).toBe(full);
    expect(MAX_STROKES).toBe(60);
  });
});

describe('svgPathIn', () => {
  const rect = { x: 0, y: 187.5, w: 300, h: 200 };

  test('scales back into the rect — the exact inverse of toPhotoPoint', () => {
    // No x/y offset in the `d`: the <Svg> itself is positioned at the rect, so
    // adding it here would double the letterbox.
    expect(svgPathIn([[0, 0], [0.5, 0.5], [1, 1]], rect))
      .toBe('M0.00 0.00 L150.00 100.00 L300.00 200.00');
  });

  test('closes the lasso when asked — the preview shows what will be cut', () => {
    expect(svgPathIn([[0, 0], [1, 0], [1, 1]], rect, { close: true })).toMatch(/ Z$/);
  });

  test('a single point is no path at all (the editor draws a dot instead)', () => {
    expect(svgPathIn([[0.5, 0.5]], rect)).toBe('');
    expect(svgPathIn([], rect)).toBe('');
    expect(svgPathIn([[0, 0], [1, 1]], { x: 0, y: 0, w: 0, h: 0 })).toBe('');
  });
});

describe('widthFraction', () => {
  test('a pen keeps its weight relative to the photo, not to the screen', () => {
    // 6 px on a photo drawn 300 px wide is 2 % of the photo — and 2 % of it at
    // 4000 px too, which is what the pond multiplies out.
    expect(widthFraction(6, { w: 300, h: 225 })).toBeCloseTo(0.02);
    expect(widthFraction(6, { w: 600, h: 450 })).toBeCloseTo(0.01);
  });

  test('falls back to a usable default rather than dividing by zero', () => {
    expect(widthFraction(6, { w: 0, h: 0 })).toBe(0.006);
  });
});

describe('isUsableOutline', () => {
  test('accepts a trace that encloses something', () => {
    expect(isUsableOutline([[0.2, 0.2], [0.8, 0.2], [0.8, 0.8]])).toBe(true);
  });

  test('rejects a mis-tap, which would cut out a few pixels and look broken', () => {
    expect(isUsableOutline([[0.5, 0.5], [0.501, 0.5], [0.5, 0.501]])).toBe(false);
  });

  test('rejects a line: it encloses no area on one axis', () => {
    expect(isUsableOutline([[0.1, 0.5], [0.5, 0.5], [0.9, 0.5]])).toBe(false);
  });

  test('rejects fewer than three points', () => {
    expect(isUsableOutline([[0.1, 0.1], [0.9, 0.9]])).toBe(false);
    expect(isUsableOutline([])).toBe(false);
    expect(isUsableOutline(null)).toBe(false);
  });
});
