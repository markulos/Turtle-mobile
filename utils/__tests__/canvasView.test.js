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
  PREVIEW_PX,
  doubleTapScale,
  fitScale,
  focalFromCentre,
  itemsInRect,
  mediaUrlFor,
  openPlanFor,
  panLimits,
  rawFileUrl,
  screenToWorld,
  tierFor,
  visibleWorldRect,
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

/**
 * ─── Loading the right amount ──────────────────────────────────────────────
 *
 * The two things that decide how much work opening a canvas is: which SIZE of
 * each picture gets fetched, and how many of them get mounted at all. Both are
 * arithmetic, and both are invisible when wrong — the board still appears, it
 * just took a third of a megabyte and a full-size decode per thumbnail to do
 * it.
 */
describe('which size of a picture to fetch', () => {
  const PHOTO = 220; // the default world width of a placed photo

  it('is the small tier for a board that is fitted on a phone', () => {
    // A wall-sized board fits at about a tenth, so a photo is ~20 points.
    expect(tierFor(PHOTO, 0.1, 3)).toBe('preview');
  });

  it('is still the small tier at life size on a retina screen', () => {
    // 220pt × 3 = 660 device pixels, inside the 768 the preview tier carries.
    expect(tierFor(PHOTO, 1, 3)).toBe('preview');
  });

  it('steps up only once the item really is bigger than that', () => {
    expect(tierFor(PHOTO, 2, 3)).toBe('display');
    // A big item needs it sooner than a small one — it is the drawn size that
    // decides, not the zoom.
    expect(tierFor(1200, 0.5, 2)).toBe('display');
    expect(tierFor(60, 4, 3)).toBe('preview');
  });

  it('does not flip back and forth right at the boundary', () => {
    const atEdge = PREVIEW_PX / 3; // exactly 768 device pixels at 3×
    expect(tierFor(atEdge, 1, 3)).toBe('preview');
    // A hair over is still the small tier — the slack is what stops a pinch
    // hovering at the line from re-fetching every frame.
    expect(tierFor(atEdge * 1.1, 1, 3)).toBe('preview');
    expect(tierFor(atEdge * 1.3, 1, 3)).toBe('display');
  });

  it('builds a capability URL for whichever tier', () => {
    expect(mediaUrlFor('http://pond', 'm1', 'preview')).toBe('http://pond/api/media/preview/m1');
    expect(mediaUrlFor('http://pond', 'm1', 'display')).toBe('http://pond/api/media/display/m1');
    // Anything unknown falls back to the cheap one rather than the expensive.
    expect(mediaUrlFor('http://pond', 'm 1', 'nonsense')).toBe('http://pond/api/media/preview/m%201');
  });
});

/**
 * The FILE's own bytes — what a PDF page is drawn from, and what the share
 * sheet is handed. Neither can come from the tiers above: those endpoints
 * serve resized variants of IMAGES and answer 400 for a document, which is
 * exactly how a PDF on a board came to be a blank frame.
 */
describe('where a file itself lives', () => {
  it('addresses the stored file by id and its own extension', () => {
    expect(rawFileUrl('http://pond', 'media_1', 'Lease.pdf'))
      .toBe('http://pond/api/media/raw/media_1.pdf');
    // Lower-cased, because the stored name is: the extension is the server's,
    // not the one the person happened to type.
    expect(rawFileUrl('http://pond', 'media_1', 'DRAFT_GF.PDF'))
      .toBe('http://pond/api/media/raw/media_1.pdf');
    // Not only PDFs — the share path wants a .docx to arrive as a .docx.
    expect(rawFileUrl('http://pond', 'media_2', 'notes.docx'))
      .toBe('http://pond/api/media/raw/media_2.docx');
  });

  it('is a pond-relative path when there is no origin, which is what a vault row carries', () => {
    expect(rawFileUrl('', 'media_1', 'Lease.pdf')).toBe('/api/media/raw/media_1.pdf');
  });

  it('survives a name with nothing to take an extension from', () => {
    expect(rawFileUrl('http://pond', 'media_3', 'Scan')).toBe('http://pond/api/media/raw/media_3');
    expect(rawFileUrl('http://pond', 'media_3', '')).toBe('http://pond/api/media/raw/media_3');
    // A query string is not an extension (a URL-ish label).
    expect(rawFileUrl('http://pond', 'media_4', 'plan.pdf?v=2'))
      .toBe('http://pond/api/media/raw/media_4.pdf');
    // The id is escaped, as the tiers above escape theirs.
    expect(rawFileUrl('http://pond', 'm 5', 'a.pdf')).toBe('http://pond/api/media/raw/m%205.pdf');
  });
});

/**
 * Where a tap goes. All three used to go to the picture viewer, pointed at an
 * endpoint that answers 400 for a document — so tapping a PDF opened a viewer
 * that could never paint anything.
 */
describe('what a tap on an item opens', () => {
  const WITH = { canRender: true };
  const WITHOUT = { canRender: false };

  it('sends a PDF to the reader when there is one', () => {
    expect(openPlanFor('Lease.pdf', WITH)).toBe('read');
  });

  /**
   * And to the share sheet when there is NOT — Quick Look can read a PDF even
   * when this binary cannot, so the document still opens. Falling through to
   * the picture viewer is what used to happen and it showed nothing.
   */
  it('sends a PDF to the share sheet when the binary cannot draw one', () => {
    expect(openPlanFor('Lease.pdf', WITHOUT)).toBe('share');
  });

  it('sends any other document out to the system sheet, renderer or not', () => {
    expect(openPlanFor('notes.docx', WITH)).toBe('share');
    expect(openPlanFor('budget.xlsx', WITHOUT)).toBe('share');
    expect(openPlanFor('assets.zip', WITH)).toBe('share');
    expect(openPlanFor('walkthrough.mp4', WITH)).toBe('share');
  });

  it('opens a picture full screen', () => {
    expect(openPlanFor('render.jpg', WITH)).toBe('view');
    expect(openPlanFor('IMG_0042.HEIC', WITH)).toBe('view');
  });

  it('treats an item it cannot judge as a picture, which is what it almost always is', () => {
    expect(openPlanFor('', WITH)).toBe('view');
    expect(openPlanFor('Pasted 2026-10-09', WITH)).toBe('view');
    expect(openPlanFor(null, WITH)).toBe('view');
  });

  it('needs no options at all — a board that never asked about the renderer', () => {
    expect(openPlanFor('Lease.pdf')).toBe('share');
    expect(openPlanFor('render.png')).toBe('view');
  });
});

describe('how much of the board to mount', () => {
  const VIEWPORT = { w: 400, h: 400 };
  const CENTRE = { x: 0, y: 0 };
  const grid = [
    { id: 'middle', x: -50, y: -50, w: 100, h: 100 },
    { id: 'near', x: 300, y: 0, w: 100, h: 100 },
    { id: 'far', x: 5000, y: 5000, w: 100, h: 100 },
  ];

  it('sees the whole board when it is fitted — nothing is saved, and should not be', () => {
    // Everything is on screen at the fit, so culling must be a no-op there.
    const rect = visibleWorldRect({ viewport: VIEWPORT, centre: CENTRE, scale: 0.02, x: 0, y: 0 });
    expect(itemsInRect(grid, rect).map((i) => i.id)).toEqual(['middle', 'near', 'far']);
  });

  it('leaves the far side of a wall unmounted when you are zoomed into a corner', () => {
    const rect = visibleWorldRect({ viewport: VIEWPORT, centre: CENTRE, scale: 2, x: 0, y: 0 });
    const ids = itemsInRect(grid, rect).map((i) => i.id);
    expect(ids).toContain('middle');
    expect(ids).not.toContain('far');
  });

  it('keeps what is just off the edge, so a pan does not reveal holes', () => {
    // 'near' is outside the viewport at this zoom but inside the margin.
    const rect = visibleWorldRect({ viewport: VIEWPORT, centre: CENTRE, scale: 1, x: 0, y: 0 });
    expect(itemsInRect(grid, rect).map((i) => i.id)).toContain('near');
  });

  it('follows the offset, not just the zoom', () => {
    // Pan a long way right: the middle leaves, and nothing else is near.
    const rect = visibleWorldRect({ viewport: VIEWPORT, centre: CENTRE, scale: 2, x: -4000, y: 0 });
    expect(itemsInRect(grid, rect).map((i) => i.id)).not.toContain('middle');
  });

  it('mounts everything when it has not been measured yet', () => {
    // No viewport, no opinion — an empty board is the one thing this must
    // never produce.
    expect(visibleWorldRect({ viewport: { w: 0, h: 0 }, centre: CENTRE, scale: 1, x: 0, y: 0 })).toBeNull();
    expect(itemsInRect(grid, null)).toHaveLength(3);
  });
});
