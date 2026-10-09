/**
 * Reading a canvas board the desktop wrote.
 *
 * This is a CONTRACT between two apps sharing one JSON column: the web app
 * writes `users.settings.canvasBoards`, the phone reads it. So the cases that
 * matter are the ones where the two could drift apart quietly —
 *
 *   - a field the phone does not understand must cost that field, not the
 *     board (a throw here blanks the feature; a filter costs one card);
 *   - the caps have to be the web file's caps, or a board that saves on the
 *     desktop comes up truncated in your hand;
 *   - the draw order is `z`, which is the whole difference between a
 *     moodboard and a pile.
 *
 * And one thing that is the phone's alone: a canvas authored on a 27-inch
 * monitor has to arrive FITTED, or opening one shows you a corner of one
 * photo with no way to tell what you are looking at.
 */
import {
  MAX_BOARDS,
  MAX_ITEMS,
  MAX_ZOOM,
  MIN_ZOOM,
  boardBounds,
  cleanName,
  decodeBoards,
  fitView,
  itemAtPoint,
  itemCountLabel,
  stacked,
  toWorld,
} from '../canvasDoc';

const item = (over = {}) => ({ id: 'i1', kind: 'media', ref: 'm1', x: 0, y: 0, w: 100, h: 100, z: 0, ...over });
const board = (over = {}) => ({ id: 'b1', name: 'Wall', createdAt: 1, updatedAt: 2, items: [item()], ...over });

describe('decoding what is in the settings blob', () => {
  it('reads a board the desktop wrote', () => {
    const [b] = decodeBoards([board()]);
    expect(b.id).toBe('b1');
    expect(b.name).toBe('Wall');
    expect(b.items).toHaveLength(1);
    expect(b.items[0]).toMatchObject({ id: 'i1', kind: 'media', ref: 'm1', w: 100, h: 100 });
  });

  it('is empty for anything that is not a list of boards', () => {
    expect(decodeBoards(undefined)).toEqual([]);
    expect(decodeBoards(null)).toEqual([]);
    expect(decodeBoards('nope')).toEqual([]);
    expect(decodeBoards({ boards: [] })).toEqual([]);
  });

  it('drops a broken ITEM and keeps the board', () => {
    const [b] = decodeBoards([board({
      items: [
        item({ id: 'ok' }),
        item({ id: 'no-kind', kind: 'wat' }),
        item({ id: '', kind: 'media' }),
        item({ id: 'no-ref', ref: '' }),
        'not an object',
        null,
      ],
    })]);
    expect(b.items.map((i) => i.id)).toEqual(['ok']);
  });

  it('drops a broken BOARD and keeps the rest', () => {
    const out = decodeBoards([board({ id: 'b1' }), { name: 'no id' }, null, board({ id: 'b2' })]);
    expect(out.map((b) => b.id)).toEqual(['b1', 'b2']);
  });

  it('keeps a TEXT item, which is the one kind with no ref', () => {
    const [b] = decodeBoards([board({ items: [item({ kind: 'text', ref: '', text: 'hello' })] })]);
    expect(b.items[0]).toMatchObject({ kind: 'text', text: 'hello' });
  });

  it('repairs numbers rather than trusting them', () => {
    const [b] = decodeBoards([board({
      items: [item({ x: 'nonsense', y: null, w: 0, h: 99999, z: undefined })],
    })]);
    const [i] = b.items;
    expect(i.x).toBe(0);
    expect(i.y).toBe(0);
    // Clamped to the shared floor and ceiling, not taken at face value.
    expect(i.w).toBe(48);
    expect(i.h).toBe(4000);
    expect(Number.isFinite(i.z)).toBe(true);
  });

  it('holds to the web file\'s caps', () => {
    const many = Array.from({ length: MAX_BOARDS + 5 }, (_, n) => board({ id: `b${n}` }));
    expect(decodeBoards(many)).toHaveLength(MAX_BOARDS);
    const crowded = board({
      items: Array.from({ length: MAX_ITEMS + 10 }, (_, n) => item({ id: `i${n}` })),
    });
    expect(decodeBoards([crowded])[0].items).toHaveLength(MAX_ITEMS);
  });

  it('keeps a PDF item\'s page, and only when there is one', () => {
    const [b] = decodeBoards([board({
      items: [item({ id: 'p', page: 4 }), item({ id: 'q', page: 1 }), item({ id: 'r' })],
    })]);
    expect(b.items.find((i) => i.id === 'p').page).toBe(4);
    // Page 1 is the default; carrying it would be a key per item saying nothing.
    expect(b.items.find((i) => i.id === 'q').page).toBeUndefined();
    expect(b.items.find((i) => i.id === 'r').page).toBeUndefined();
  });

  it('never leaves a board nameless', () => {
    expect(cleanName('')).toBe('Untitled canvas');
    expect(cleanName('  spaced   out  ')).toBe('spaced out');
    expect(decodeBoards([board({ name: null })])[0].name).toBe('Untitled canvas');
  });
});

describe('the order things are drawn in', () => {
  it('is z, back to front', () => {
    const b = decodeBoards([board({
      items: [item({ id: 'top', z: 9 }), item({ id: 'back', z: 0 }), item({ id: 'mid', z: 4 })],
    })])[0];
    expect(stacked(b).map((i) => i.id)).toEqual(['back', 'mid', 'top']);
  });

  it('is stable when two items claim the same z', () => {
    const b = { items: [item({ id: 'b', z: 1 }), item({ id: 'a', z: 1 })] };
    expect(stacked(b).map((i) => i.id)).toEqual(['a', 'b']);
  });
});

describe('framing a board on a phone', () => {
  it('measures the box everything sits in', () => {
    const b = { items: [item({ x: 10, y: 20, w: 100, h: 50 }), item({ x: -40, y: 0, w: 40, h: 300 })] };
    expect(boardBounds(b)).toEqual({ x: -40, y: 0, w: 150, h: 300 });
  });

  it('has nothing to frame on an empty board', () => {
    expect(boardBounds({ items: [] })).toBeNull();
    expect(boardBounds(null)).toBeNull();
  });

  it('fits a desktop-sized wall onto a phone, centred', () => {
    // A 4000×3000 arrangement on a 390×700 screen.
    const view = fitView({ x: 0, y: 0, w: 4000, h: 3000 }, { w: 390, h: 700 });
    expect(view.scale).toBeCloseTo((390 - 48) / 4000, 4);
    // The middle of the board lands in the middle of the screen.
    expect(2000 * view.scale + view.x).toBeCloseTo(195, 3);
    expect(1500 * view.scale + view.y).toBeCloseTo(350, 3);
  });

  it('will not zoom past the limits in either direction', () => {
    const huge = fitView({ x: 0, y: 0, w: 1e6, h: 1e6 }, { w: 390, h: 700 });
    expect(huge.scale).toBe(MIN_ZOOM);
    const tiny = fitView({ x: 0, y: 0, w: 1, h: 1 }, { w: 390, h: 700 });
    expect(tiny.scale).toBe(MAX_ZOOM);
  });

  it('leaves an empty board at 1:1 rather than inventing a zoom', () => {
    expect(fitView(null, { w: 390, h: 700 })).toEqual({ scale: 1, x: 195, y: 350 });
  });

  it('survives a viewport it has not been measured into yet', () => {
    const view = fitView({ x: 0, y: 0, w: 100, h: 100 }, { w: 0, h: 0 });
    expect(Number.isFinite(view.scale)).toBe(true);
    expect(Number.isFinite(view.x)).toBe(true);
  });
});

describe('what the finger landed on', () => {
  const b = {
    items: [
      { id: 'back', kind: 'media', ref: 'm1', x: 0, y: 0, w: 200, h: 200, z: 0 },
      { id: 'front', kind: 'media', ref: 'm2', x: 100, y: 100, w: 200, h: 200, z: 5 },
      { id: 'note', kind: 'note', ref: 'n1', x: 400, y: 0, w: 100, h: 100, z: 1 },
    ],
  };

  it('is the TOPMOST item under the point, which is what you can see', () => {
    // The overlap belongs to whichever is drawn last.
    expect(itemAtPoint(b, { x: 150, y: 150 }).id).toBe('front');
    expect(itemAtPoint(b, { x: 20, y: 20 }).id).toBe('back');
    expect(itemAtPoint(b, { x: 420, y: 20 }).id).toBe('note');
  });

  it('is nothing at all on bare canvas', () => {
    expect(itemAtPoint(b, { x: 2000, y: 2000 })).toBeNull();
    expect(itemAtPoint(b, { x: NaN, y: 0 })).toBeNull();
    expect(itemAtPoint({ items: [] }, { x: 0, y: 0 })).toBeNull();
  });

  it('turns a screen point into a world point, whatever the zoom', () => {
    // The inverse of the stage's transform: translate, then scale.
    expect(toWorld({ x: 100, y: 50 }, { scale: 1, x: 0, y: 0 })).toEqual({ x: 100, y: 50 });
    expect(toWorld({ x: 100, y: 50 }, { scale: 2, x: 20, y: 10 })).toEqual({ x: 40, y: 20 });
    expect(toWorld({ x: 0, y: 0 }, { scale: 0.5, x: -50, y: -25 })).toEqual({ x: 100, y: 50 });
  });

  it('survives a view it has no numbers for', () => {
    expect(toWorld({ x: 10, y: 10 }, null)).toEqual({ x: 10, y: 10 });
    expect(toWorld(null, { scale: 0 })).toEqual({ x: 0, y: 0 });
  });

  it('finds the item a tap at a zoomed-out scale lands on', () => {
    // The whole point of working in world units: at 0.2 zoom the front item
    // occupies 40 screen points, and the tap has to still resolve.
    const view = { scale: 0.2, x: 10, y: 10 };
    const world = toWorld({ x: 10 + 150 * 0.2, y: 10 + 150 * 0.2 }, view);
    expect(itemAtPoint(b, world).id).toBe('front');
  });
});

describe('what a board\'s row says', () => {
  it('counts what is on it', () => {
    expect(itemCountLabel(0)).toBe('Empty');
    expect(itemCountLabel(1)).toBe('1 item');
    expect(itemCountLabel(12)).toBe('12 items');
  });
});
