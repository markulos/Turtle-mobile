/**
 * The geometry of looking at a canvas.
 *
 * Every one of these is a thing you can FEEL when it is wrong, which is why
 * they are arithmetic under test rather than numbers inside a gesture
 * handler: a board that opens at the wrong zoom, an edge you can pan straight
 * through into empty space, a pinch that slides the board away from your
 * fingers, a double-tap that zooms somewhere other than where you tapped.
 *
 * The model is in utils/canvasView's header: translation is measured from
 * "the board is centred", and zero means centred.
 */
import {
  DOUBLE_TAP_FACTOR,
  FIT_MARGIN,
  MAX_SCALE,
  doubleTapScale,
  fitScale,
  focalFromCentre,
  panLimits,
  screenToWorld,
} from '../canvasView';

const PHONE = { w: 390, h: 700 };
const WALL = { x: 0, y: 0, w: 4000, h: 3000 };

describe('the scale a board opens at', () => {
  it('puts the whole wall on the screen, with air around it', () => {
    // Width-limited here: 4000 wide into 390 − two margins.
    expect(fitScale(WALL, PHONE)).toBeCloseTo((390 - FIT_MARGIN * 2) / 4000, 6);
  });

  it('is limited by whichever axis runs out first', () => {
    const tall = { x: 0, y: 0, w: 100, h: 4000 };
    expect(fitScale(tall, PHONE)).toBeCloseTo((700 - FIT_MARGIN * 2) / 4000, 6);
  });

  it('never zooms a tiny board past the ceiling', () => {
    expect(fitScale({ x: 0, y: 0, w: 10, h: 10 }, PHONE)).toBe(MAX_SCALE);
  });

  it('is 1 when there is nothing to fit, or nothing to fit it into', () => {
    // Not 0, and not a guess: an empty board has no size, and inventing a
    // zoom would make whatever is added first appear at some arbitrary scale.
    expect(fitScale(null, PHONE)).toBe(1);
    expect(fitScale(WALL, { w: 0, h: 0 })).toBe(1);
  });
});

describe('how far the board may be dragged', () => {
  it('is half the overflow, so an edge stops at the edge', () => {
    // At 1:1 a 4000-wide board overflows a 390 screen by 3610.
    expect(panLimits(WALL, PHONE, 1)).toEqual({ x: (4000 - 390) / 2, y: (3000 - 700) / 2 });
  });

  it('is ZERO on an axis that still fits, which pins it centred', () => {
    // Fitted, nothing overflows: the board cannot be dragged off at all.
    const fit = fitScale(WALL, PHONE);
    const lim = panLimits(WALL, PHONE, fit);
    expect(lim.x).toBe(0);
    expect(lim.y).toBe(0);
  });

  it('grows as you zoom in', () => {
    const near = panLimits(WALL, PHONE, 0.2);
    const far = panLimits(WALL, PHONE, 1);
    expect(far.x).toBeGreaterThan(near.x);
    expect(far.y).toBeGreaterThan(near.y);
  });

  it('is nothing at all for a board with no bounds', () => {
    expect(panLimits(null, PHONE, 1)).toEqual({ x: 0, y: 0 });
  });
});

describe('turning a touch into a place on the board', () => {
  const view = { viewport: PHONE, bounds: WALL, scale: 1, x: 0, y: 0 };

  it('reads the middle of the screen as the middle of the board', () => {
    expect(screenToWorld({ x: 195, y: 350 }, view)).toEqual({ x: 2000, y: 1500 });
  });

  it('accounts for the offset and the zoom together', () => {
    const zoomed = { ...view, scale: 2, x: 40, y: -20 };
    // 40 points right of centre, at 2×, with the board itself shifted 40
    // right: (235 − 195 − 40) / 2 = 0 world units from the centre.
    expect(screenToWorld({ x: 235, y: 330 }, zoomed)).toEqual({ x: 2000, y: 1500 });
  });

  it('is the inverse of what the stage draws', () => {
    // The round trip: a world point → where it lands → back again.
    const v = { viewport: PHONE, bounds: WALL, scale: 0.33, x: 17, y: -9 };
    const world = { x: 1234, y: 2345 };
    const screen = {
      x: PHONE.w / 2 + v.x + (world.x - (WALL.x + WALL.w / 2)) * v.scale,
      y: PHONE.h / 2 + v.y + (world.y - (WALL.y + WALL.h / 2)) * v.scale,
    };
    const back = screenToWorld(screen, v);
    expect(back.x).toBeCloseTo(world.x, 6);
    expect(back.y).toBeCloseTo(world.y, 6);
  });

  it('measures a pinch focus from the centre, which is what the maths wants', () => {
    expect(focalFromCentre({ x: 195, y: 350 }, PHONE)).toEqual({ x: 0, y: 0 });
    expect(focalFromCentre({ x: 215, y: 300 }, PHONE)).toEqual({ x: 20, y: -50 });
  });
});

describe('where a double-tap goes', () => {
  const fit = 0.1;

  it('zooms IN when the whole board is showing', () => {
    expect(doubleTapScale(fit, fit)).toBeCloseTo(fit * DOUBLE_TAP_FACTOR, 6);
  });

  it('comes back out to the fit from anywhere else', () => {
    expect(doubleTapScale(fit * 2, fit)).toBe(fit);
    expect(doubleTapScale(MAX_SCALE, fit)).toBe(fit);
  });

  it('treats a hair above the fit as the fit', () => {
    // A pinch that ended at 1.02× fit is someone who meant the fit, and would
    // be baffled to be sent further out.
    expect(doubleTapScale(fit * 1.02, fit)).toBeCloseTo(fit * DOUBLE_TAP_FACTOR, 6);
  });

  it('never goes past the ceiling, even from a board that fits big', () => {
    expect(doubleTapScale(2, 2, MAX_SCALE)).toBe(MAX_SCALE);
    // And a board whose fit IS the ceiling has nowhere to go but back.
    expect(doubleTapScale(MAX_SCALE, MAX_SCALE)).toBe(MAX_SCALE);
  });
});
