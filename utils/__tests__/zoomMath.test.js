/**
 * zoomMath — geometry the photo viewer's zoom surface depends on.
 * The regression these lock down: pinching back out used to leave the photo
 * off-centre, because the old ScrollView-based zoom settled on whatever
 * contentOffset the pinch centroid produced.
 */
const {
  MIN_SCALE,
  MAX_SCALE,
  containSize,
  panBound,
  clamp,
  rubberClamp,
  rubberScale,
  clampScale,
  focalTranslate,
  fillScale,
  nativeMaxScale,
  settle,
} = require('../zoomMath');

// A 390 x 700 viewer box, close to the real one on a modern iPhone.
const CW = 390;
const CH = 700;

describe('containSize', () => {
  it('pillarboxes a landscape image (full width, short height)', () => {
    const { width, height } = containSize(CW, CH, 3 / 2);
    expect(width).toBe(CW);
    expect(height).toBeCloseTo(260, 5);
  });

  it('letterboxes a very tall image (full height, narrow width)', () => {
    // Taller than the 390:700 box (0.557) → height-bound.
    const { width, height } = containSize(CW, CH, 1 / 2);
    expect(height).toBe(CH);
    expect(width).toBeCloseTo(350, 5);
  });

  it('is width-bound for a portrait image that is still wider than the box', () => {
    const { width, height } = containSize(CW, CH, 2 / 3);
    expect(width).toBe(CW);
    expect(height).toBeCloseTo(585, 5);
  });

  it('falls back to the container when the aspect is unknown', () => {
    expect(containSize(CW, CH, 0)).toEqual({ width: CW, height: CH });
    expect(containSize(CW, CH, NaN)).toEqual({ width: CW, height: CH });
    expect(containSize(CW, CH, undefined)).toEqual({ width: CW, height: CH });
  });

  it('is zero-safe before layout has measured', () => {
    expect(containSize(0, 0, 1.5)).toEqual({ width: 0, height: 0 });
  });
});

describe('panBound', () => {
  it('is 0 while the scaled content still fits — the axis stays pinned centred', () => {
    expect(panBound(260, CH, 1)).toBe(0);
    expect(panBound(260, CH, 2)).toBe(0); // 520 < 700, still fits
  });

  it('is half the overflow once the content is bigger than the box', () => {
    expect(panBound(CW, CW, 3)).toBe(CW); // (390*3 - 390) / 2
  });
});

describe('rubberClamp', () => {
  it('passes values inside the bound straight through', () => {
    expect(rubberClamp(40, 100)).toBe(40);
    expect(rubberClamp(-40, 100)).toBe(-40);
  });

  it('resists past the bound instead of hard-stopping', () => {
    expect(rubberClamp(200, 100, 0.35)).toBeCloseTo(135, 5);
    expect(rubberClamp(-200, 100, 0.35)).toBeCloseTo(-135, 5);
  });

  it('collapses to the bound itself when there is no travel', () => {
    expect(rubberClamp(80, 0, 0.35)).toBeCloseTo(28, 5);
  });
});

describe('scale clamping', () => {
  it('resists below the floor and above the ceiling', () => {
    expect(rubberScale(0.5, 1, 6, 0.5)).toBeCloseTo(0.75, 5);
    expect(rubberScale(8, 1, 6, 0.5)).toBeCloseTo(7, 5);
    expect(rubberScale(3, 1, 6)).toBe(3);
  });

  it('hard-clamps on release', () => {
    expect(clampScale(0.4)).toBe(MIN_SCALE);
    expect(clampScale(99)).toBe(MAX_SCALE);
    expect(clampScale(2.5)).toBe(2.5);
    expect(clampScale(NaN)).toBe(MIN_SCALE);
    expect(clampScale(0)).toBe(MIN_SCALE);
  });
});

describe('fillScale (iOS double-tap target)', () => {
  it('fills the box on the short axis for a landscape photo', () => {
    // 3:2 in 390x700 → contained at 390x260, so filling needs 700/260.
    expect(fillScale(CW, CH, 3 / 2)).toBeCloseTo(CH / 260, 4);
  });

  it('fills on the width for a very tall photo', () => {
    // 1:2 in 390x700 → contained at 350x700, so filling needs 390/350.
    expect(fillScale(CW, CH, 1 / 2)).toBeCloseTo(CW / 350, 4);
  });

  it('is 1 when the aspect is unknown (caller falls back to a fixed scale)', () => {
    expect(fillScale(CW, CH, 0)).toBe(1);
  });
});

describe('nativeMaxScale', () => {
  it('caps around 1:1 source pixels, with Apple-ish overshoot', () => {
    // 4000px source shown 390pt wide on a 3x screen → 1:1 at ~3.42, ×1.4.
    expect(nativeMaxScale(4000, 390, 3)).toBeCloseTo((4000 / 1170) * 1.4, 4);
  });

  it('never drops below the floor for small sources', () => {
    expect(nativeMaxScale(600, 390, 3)).toBe(2.5);
  });

  it('never exceeds MAX_SCALE for huge sources', () => {
    expect(nativeMaxScale(20000, 390, 3)).toBe(MAX_SCALE);
  });

  it('falls back to the ceiling when the source size is unknown', () => {
    expect(nativeMaxScale(0, 390, 3)).toBe(MAX_SCALE);
    expect(nativeMaxScale(undefined, 390, 3)).toBe(MAX_SCALE);
  });
});

describe('focalTranslate', () => {
  it('keeps the content point under the focal point as scale changes', () => {
    const scaleStart = 1;
    const translateStart = 0;
    const focal = 60; // 60px right of centre
    const origin = (focal - translateStart) / scaleStart;

    const next = focalTranslate(focal, origin, 3);
    // The anchored point maps back onto the same focal position.
    expect(focal - (origin * 3 + next)).toBeCloseTo(0, 5);
  });
});

describe('settle', () => {
  it('re-centres exactly on zoom-out — the offset regression', () => {
    // Zoomed in to 4x, panned into the bottom-right, then pinched back to 1.
    const rest = settle(-120, -260, CW, CH, 3 / 4, 1);
    expect(rest).toMatchObject({ scale: 1, x: 0, y: 0 });
  });

  it('clamps a pan to the image rect, not the container', () => {
    // Landscape 3:2 in a tall box: at 2x the height (520) still fits inside 700,
    // so vertical travel is 0 even though the container is much taller.
    const rest = settle(999, 999, CW, CH, 3 / 2, 2);
    expect(rest.scale).toBe(2);
    expect(rest.x).toBeCloseTo(195, 5); // (390*2 - 390) / 2
    expect(rest.y).toBe(0);
    expect(rest.boundY).toBe(0);
  });

  it('caps an over-pinch at MAX_SCALE and keeps the pan legal', () => {
    const rest = settle(5000, 5000, CW, CH, 1, 50);
    expect(rest.scale).toBe(MAX_SCALE);
    expect(Math.abs(rest.x)).toBeLessThanOrEqual(rest.boundX);
    expect(Math.abs(rest.y)).toBeLessThanOrEqual(rest.boundY);
  });

  it('degrades to container bounds when the aspect is unknown', () => {
    const rest = settle(0, 0, CW, CH, 0, 2);
    expect(rest.boundX).toBeCloseTo(CW / 2, 5);
    expect(rest.boundY).toBeCloseTo(CH / 2, 5);
  });
});

describe('clamp', () => {
  it('hard-stops at ±limit', () => {
    expect(clamp(10, 5)).toBe(5);
    expect(clamp(-10, 5)).toBe(-5);
    expect(clamp(3, 5)).toBe(3);
  });
});
