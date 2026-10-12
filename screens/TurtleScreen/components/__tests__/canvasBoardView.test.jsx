/**
 * The wall, drawn.
 *
 * The geometry is tested where it belongs (utils/__tests__/canvasDoc.test.js);
 * what this covers is what the view does with it: every item on the board
 * present, drawn back to front, each kind rendered as the thing it is, and the
 * pictures addressed the way the desktop addresses them — `/api/media/display
 * /:id`, the capability URL that also resolves media somebody shared with you.
 *
 * It also pins the read-only promise from the UI side: no item carries a
 * handle, a resize corner or a delete key, because there is nothing here that
 * could write one back.
 */
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));
jest.mock('../../../../utils/haptics', () => ({
  tapHaptic: jest.fn(), impactHaptic: jest.fn(), notifyHaptic: jest.fn(), markGesture: jest.fn(),
}));

import CanvasBoardView from '../CanvasBoardView';

const theme = {
  colors: {
    background: '#000', surface: '#0a0a0a', surfaceElevated: '#111', border: '#222',
    textPrimary: '#fff', textSecondary: '#aaa', textTertiary: '#888', textMuted: '#666',
    accentInfo: '#4aa', accentSuccess: '#4ADE80',
  },
};

const item = (over = {}) => ({ id: 'i1', kind: 'media', ref: 'm1', x: 0, y: 0, w: 100, h: 100, z: 0, ...over });
const board = (items) => ({ id: 'b1', name: 'Wall', createdAt: 1, updatedAt: 2, items });

const draw = (items, props = {}) => render(
  <CanvasBoardView board={board(items)} origin="http://pond.local" theme={theme} {...props} />,
);

/** Every node of a type in the rendered tree, in tree order. */
const nodesOfType = (view, type) => {
  const out = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === type) out.push(node);
    (node.children || []).forEach(walk);
  };
  walk(view.toJSON());
  return out;
};

it('draws every item on the board', async () => {
  const view = await draw([
    item({ id: 'a' }),
    item({ id: 'b', kind: 'text', ref: '', text: 'a line of my own' }),
    item({ id: 'c', kind: 'note', ref: 'n1', label: 'The plan' }),
  ]);
  expect(view.getByTestId('canvas-item-a')).toBeTruthy();
  expect(view.getByTestId('canvas-item-b')).toBeTruthy();
  expect(view.getByTestId('canvas-item-c')).toBeTruthy();
});

it('draws them back to front, whatever order they are stored in', async () => {
  const view = await draw([
    item({ id: 'top', z: 9 }),
    item({ id: 'back', z: 0 }),
    item({ id: 'mid', z: 4 }),
  ]);
  // Paint order IS tree order, so the deepest z has to come first. Read off
  // the item FRAMES — every kind has one, which an image is not.
  const ids = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    const id = String(node.props?.testID || '');
    if (id.startsWith('canvas-item-')) ids.push(id);
    (node.children || []).forEach(walk);
  };
  walk(view.toJSON());
  expect(ids).toEqual(['canvas-item-back', 'canvas-item-mid', 'canvas-item-top']);
});

it('fetches the size the item is actually DRAWN at, not the biggest one', async () => {
  const view = await draw([item({ ref: 'media_abc' })]);
  const [img] = nodesOfType(view, 'ExpoImage');
  // A canvas item on a fitted board is a thumbnail on the glass. The 1600px
  // tier would be a third of a megabyte and a full-size decode to paint it,
  // times every item on the board — see tierFor.
  expect(img.props.source.uri).toBe('http://pond.local/api/media/preview/media_abc');
  // And the view is kept across a tier change, so zooming in swaps the file
  // without blinking through an empty frame.
  expect(img.props.recyclingKey).toBe('canvas:i1');
});

it('places each item relative to the board\'s CENTRE', async () => {
  // Two items spanning x 0..300 and y 0..100, so the centre is (150, 50) and
  // the placement is each item's own offset from it. Centre-relative is the
  // whole reason zooming out lands the board in the middle of the screen
  // rather than wherever a scroll offset happened to be — utils/canvasView.
  const view = await draw([
    item({ id: 'left', x: 0, y: 0, w: 100, h: 100 }),
    item({ id: 'right', x: 200, y: 0, w: 100, h: 100 }),
  ]);
  const boxOf = (id) => Object.assign(
    {},
    ...[].concat(view.getByTestId(`canvas-item-${id}`).props.style).filter(Boolean),
  );
  expect(boxOf('left')).toMatchObject({ left: -150, top: -50, width: 100, height: 100 });
  expect(boxOf('right')).toMatchObject({ left: 50, top: -50, width: 100, height: 100 });
});

it('says what a note or a task is by its cached label', async () => {
  const view = await draw([
    item({ id: 'n', kind: 'note', ref: 'n1', label: 'Kitchen ideas' }),
    item({ id: 't', kind: 'task', ref: 't1', label: 'Call the joiner' }),
  ]);
  // The label is cached ON the board precisely so it paints before any fetch.
  expect(view.getByText('Kitchen ideas')).toBeTruthy();
  expect(view.getByText('Call the joiner')).toBeTruthy();
});

it('owns up to a PDF page rather than drawing a blank sheet', async () => {
  const view = await draw([item({ id: 'p', page: 7 })]);
  expect(view.getByText('p7')).toBeTruthy();
});

it('says so when the board is empty', async () => {
  const view = await draw([]);
  expect(view.getByText(/Nothing on this canvas yet/)).toBeTruthy();
});

/**
 * ─── Being MEASURED is the moment it used to fall over ─────────────────────
 *
 * Mounting a canvas is only half of it. The board is framed from the stage's
 * first layout, and that is where the work happens: the viewport goes into
 * state, the fit runs, and the resting view is published for the picture tiers
 * and the culling to read.
 *
 * It shipped once with the fit called from INSIDE the viewport's state
 * updater. A state updater has to be pure — React may call it more than once
 * for one update — so publishing from in there is a setState during a render,
 * which React 19 throws on: the app died a beat after a canvas opened. Every
 * test above passed through it, because without a layout event none of that
 * code ever ran.
 */
describe('when the stage is measured', () => {
  const measure = async (view, w = 390, h = 700) => {
    await act(async () => {
      fireEvent(view.getByTestId('canvas-stage'), 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width: w, height: h } },
      });
    });
  };

  it('frames the board without taking the screen down', async () => {
    const view = await draw([item({ id: 'a' }), item({ id: 'b', x: 400, y: 0 })]);
    await measure(view);
    // Still here, still drawing — the assertion is really "it did not throw".
    expect(view.getByTestId('canvas-item-a')).toBeTruthy();
    expect(view.getByTestId('canvas-stage')).toBeTruthy();
  });

  it('survives being measured again at the same size, and at a new one', async () => {
    // Re-layout happens constantly (keyboard, rotation, the page settling).
    const view = await draw([item({ id: 'a' })]);
    await measure(view);
    await measure(view);
    await measure(view, 700, 390);
    expect(view.getByTestId('canvas-item-a')).toBeTruthy();
  });

  it('is measured fine with nothing on the board', async () => {
    const view = await draw([]);
    await measure(view);
    expect(view.getByText(/Nothing on this canvas yet/)).toBeTruthy();
  });
});

it('offers nothing that could move an item', async () => {
  const view = await draw([item({ id: 'a' }), item({ id: 'b', kind: 'note', ref: 'n1', label: 'x' })]);
  // No handle, no corner, no delete — the read-only promise, from the side
  // the user can see.
  expect(view.queryByLabelText(/resize/i)).toBeNull();
  expect(view.queryByLabelText(/delete/i)).toBeNull();
  expect(view.queryByLabelText(/remove/i)).toBeNull();
});
