/**
 * The photos on a message you have not sent yet.
 *
 * Two rules live here:
 *  - A tile is the SHAPE of its photo. It was a 56pt square filled with
 *    `cover`, so every picked photo was cropped before it was ever sent.
 *  - You can LOOK at one before you send it. A hold (or a tap) opens the
 *    full-size viewer; the remove key on the same 56pt tile still removes,
 *    which is the thing a new press target on a small tile tends to break.
 */
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));
jest.mock('../../../../utils/haptics', () => ({
  tapHaptic: jest.fn(), impactHaptic: jest.fn(), notifyHaptic: jest.fn(),
}));

import MessageDraftPhotos, { thumbWidthFor } from '../MessageDraftPhotos';

const theme = {
  colors: {
    surface: '#0a0a0a', surfaceElevated: '#111', border: '#222',
    textPrimary: '#fff', textSecondary: '#aaa', textTertiary: '#888', textMuted: '#666',
    accentError: '#e5484d',
  },
};

const photo = (over = {}) => ({
  key: 'p1', uri: 'file:///tmp/one.jpg', asset: { fileName: 'one.jpg' }, error: null, ...over,
});

const draw = (props = {}) => render(
  <MessageDraftPhotos theme={theme} items={[photo()]} onRemove={jest.fn()} {...props} />,
);

/** Every node of a given type in the rendered tree — this repo's other render
 *  tests walk `toJSON()` the same way; the RNTL here has no *ByType query. */
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

describe('a tile is the shape of its photo', () => {
  it('takes the width the photo\'s own ratio asks for at tile height', () => {
    // 16:9 at 56pt tall is 100pt wide — not a 56pt square with the sides cut.
    expect(thumbWidthFor(1920, 1080)).toBe(100);
    // A portrait photo makes a NARROW tile. It used to lose its head and feet.
    const tall = thumbWidthFor(1200, 1600);
    expect(tall).toBe(42);
    expect(tall / 56).toBeCloseTo(1200 / 1600, 2);
    expect(thumbWidthFor(800, 800)).toBe(56);
  });

  it('caps a panorama and floors a sliver, so one photo cannot take the row', () => {
    expect(thumbWidthFor(10000, 1000)).toBe(112);
    expect(thumbWidthFor(100, 10000)).toBe(38);
  });

  it('stays square until the photo reports a size it can use', () => {
    expect(thumbWidthFor(0, 0)).toBe(56);
    expect(thumbWidthFor(undefined, undefined)).toBe(56);
    expect(thumbWidthFor(100, 0)).toBe(56);
  });

  it('draws the picture whole rather than filling the tile with it', async () => {
    const view = await draw();
    const images = nodesOfType(view, 'ExpoImage');
    expect(images).toHaveLength(1);
    expect(images[0].props.contentFit).toBe('contain');
  });
});

describe('looking at a photo before it is sent', () => {
  it('opens it on a hold, naming which one was held', async () => {
    const onView = jest.fn();
    const view = await draw({
      items: [photo(), photo({ key: 'p2', uri: 'file:///tmp/two.jpg' })],
      onView,
    });
    await act(async () => { fireEvent(view.getByTestId('draft-photo-view-p2'), 'longPress'); });
    expect(onView).toHaveBeenCalledWith(1);
  });

  it('opens it on a plain tap too', async () => {
    const onView = jest.fn();
    const view = await draw({ onView });
    await act(async () => { fireEvent.press(view.getByTestId('draft-photo-view-p1')); });
    expect(onView).toHaveBeenCalledWith(0);
  });

  it('still removes when the remove key is the thing pressed', async () => {
    const onView = jest.fn();
    const onRemove = jest.fn();
    const view = await draw({ onView, onRemove });
    await act(async () => { fireEvent.press(view.getByTestId('draft-photo-remove-p1')); });
    expect(onRemove).toHaveBeenCalledWith('p1');
    expect(onView).not.toHaveBeenCalled();
  });

  it('is a plain strip when no host offers a viewer', async () => {
    const view = await draw({ onView: undefined });
    expect(view.queryByTestId('draft-photo-view-p1')).toBeTruthy();
    // The tile is still there (it carries the picture); it just does nothing.
    await act(async () => { fireEvent.press(view.getByTestId('draft-photo-view-p1')); });
  });

  it('keeps the uploading veil and the error veil off the press target', async () => {
    // A veil is pointerEvents="none" — a photo mid-upload must still be
    // openable, and the one thing that would silently break that is a veil
    // drawn over the whole tile.
    const view = await draw({ items: [photo({ uploading: true })], onView: jest.fn() });
    const veils = nodesOfType(view, 'View').filter((v) => v.props.pointerEvents === 'none');
    // The upload veil, and the magnifier badge.
    expect(veils.length).toBe(2);
  });
});
