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
import { render } from '@testing-library/react-native';

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

it('addresses a picture by id, through the display tier', async () => {
  const view = await draw([item({ ref: 'media_abc' })]);
  const [img] = nodesOfType(view, 'ExpoImage');
  expect(img.props.source.uri).toBe('http://pond.local/api/media/display/media_abc');
});

it('places each item where the board says, in world units', async () => {
  const view = await draw([item({ id: 'a', x: 120, y: -40, w: 200, h: 150 })]);
  const node = view.getByTestId('canvas-item-a');
  // The parent frame carries the box; the transform on the world above it is
  // what turns these into screen points.
  const flat = Object.assign({}, ...[].concat(node.props.style).filter(Boolean));
  expect(flat).toMatchObject({ left: 120, top: -40, width: 200, height: 150 });
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

it('offers nothing that could move an item', async () => {
  const view = await draw([item({ id: 'a' }), item({ id: 'b', kind: 'note', ref: 'n1', label: 'x' })]);
  // No handle, no corner, no delete — the read-only promise, from the side
  // the user can see.
  expect(view.queryByLabelText(/resize/i)).toBeNull();
  expect(view.queryByLabelText(/delete/i)).toBeNull();
  expect(view.queryByLabelText(/remove/i)).toBeNull();
});
