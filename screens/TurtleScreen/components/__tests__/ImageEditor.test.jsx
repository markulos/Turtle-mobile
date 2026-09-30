/**
 * ImageEditor — the viewer's pencil key, one tool: rotate a quarter turn.
 *
 * What these tests hold in place, in order of how much a regression would cost:
 *   1. Cancel NEVER writes. The editor is the only screen that can permanently
 *      change a photo, so "I turned it, then changed my mind" must be free.
 *   2. Save sends ONE RELATIVE delta. The pond adds it to the stored angle, so
 *      sending an absolute value would double-rotate anything already turned.
 *   3. A no-op Save doesn't hit the network — a 0° rotate still makes the pond
 *      re-render every thumbnail tier.
 *   4. The preview frame SWAPS width/height on a quarter turn. Without it the
 *      rotated photo overflows the stage instead of fitting it.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import ImageEditor from '../ImageEditor';

jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('../../../../utils/haptics', () => ({
  impactHaptic: jest.fn(),
  notifyHaptic: jest.fn(),
  tapHaptic: jest.fn(),
}));

const colors = { primary: '#3b82f6' };
const getFullUrl = (p) => `https://pond${p}`;

const photo = (over = {}) => ({
  id: 'p1',
  type: 'image',
  width: 4000,
  height: 3000,
  blurhash: null,
  ...over,
});

/** A pond that accepts the rotate and answers the way the real route does. */
function okApi(over = {}) {
  return {
    post: jest.fn().mockResolvedValue({
      success: true,
      rotation: 90,
      width: 3000,
      height: 4000,
      thumbnailUrl: '/api/media/thumbnails/p1.webp',
      thumbnailLgUrl: '/api/media/thumbnails/p1-lg.webp',
      blurhash: 'LKO2',
      compressedUrl: null,
      ...over,
    }),
  };
}

async function open(props = {}) {
  const api = props.api || okApi();
  const onSaved = props.onSaved || jest.fn();
  const onClose = props.onClose || jest.fn();
  const onError = props.onError || jest.fn();
  const view = await render(
    <ImageEditor
      visible
      item={props.item || photo()}
      api={api}
      getFullUrl={getFullUrl}
      colors={colors}
      insets={{ top: 40, bottom: 20 }}
      bottomInset={60}
      onClose={onClose}
      onSaved={onSaved}
      onError={onError}
    />,
  );
  // The stage measures itself; nothing renders the photo until it has a size.
  await act(async () => {
    fireEvent(view.getByTestId('image-editor-stage'), 'layout', {
      nativeEvent: { layout: { width: 300, height: 600 } },
    });
  });
  return { view, api, onSaved, onClose, onError };
}

const frameOf = (view) => StyleSheet.flatten(view.getByTestId('image-editor-preview').props.style);

describe('ImageEditor', () => {
  test('renders nothing when closed, or when there is no photo', async () => {
    const closed = await render(<ImageEditor visible={false} item={photo()} api={okApi()} />);
    expect(closed.queryByTestId('image-editor')).toBeNull();

    const empty = await render(<ImageEditor visible item={null} api={okApi()} />);
    expect(empty.queryByTestId('image-editor')).toBeNull();
  });

  test('opens on the photo as it currently is, at its stored angle', async () => {
    const { view } = await open({ item: photo({ rotation: 90 }) });
    // The display tier, cache-busted for the angle it is already turned to —
    // so the editor shows what the viewer behind it was showing.
    expect(view.getByTestId('image-editor-preview').props.source)
      .toEqual({ uri: 'https://pond/api/media/display/p1?r=90' });
  });

  test('an unrotated photo asks for the plain URL, with no token', async () => {
    const { view } = await open();
    expect(view.getByTestId('image-editor-preview').props.source)
      .toEqual({ uri: 'https://pond/api/media/display/p1' });
  });

  test('CANCEL never writes, however many times the photo was turned', async () => {
    const { view, api, onSaved, onClose } = await open();

    await act(async () => { fireEvent.press(view.getByTestId('image-editor-rotate')); });
    await act(async () => { fireEvent.press(view.getByTestId('image-editor-rotate')); });
    await act(async () => { fireEvent.press(view.getByTestId('image-editor-cancel')); });

    expect(api.post).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  test('SAVE posts ONE relative delta — 90 per turn, never the absolute angle', async () => {
    const { view, api } = await open({ item: photo({ rotation: 180 }) });

    await act(async () => { fireEvent.press(view.getByTestId('image-editor-rotate')); });
    await act(async () => { fireEvent.press(view.getByTestId('image-editor-save')); });

    // 180 stored + one turn. The pond ADDS the delta, so sending 270 here
    // would land the photo on 90 — a full turn past where the user put it.
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/media/p1/rotate', { degrees: 90 });
  });

  test('three turns post 270, and four post nothing at all', async () => {
    const three = await open();
    for (let i = 0; i < 3; i += 1) {
      await act(async () => { fireEvent.press(three.view.getByTestId('image-editor-rotate')); });
    }
    await act(async () => { fireEvent.press(three.view.getByTestId('image-editor-save')); });
    expect(three.api.post).toHaveBeenCalledWith('/media/p1/rotate', { degrees: 270 });

    // Four turns is back where it started: a 0° rotate would still make the
    // pond re-encode every thumbnail tier, so it must not be sent.
    const four = await open();
    for (let i = 0; i < 4; i += 1) {
      await act(async () => { fireEvent.press(four.view.getByTestId('image-editor-rotate')); });
    }
    await act(async () => { fireEvent.press(four.view.getByTestId('image-editor-save')); });
    expect(four.api.post).not.toHaveBeenCalled();
    expect(four.onClose).toHaveBeenCalled();
  });

  test('an untouched Save just closes', async () => {
    const { view, api, onClose } = await open();
    await act(async () => { fireEvent.press(view.getByTestId('image-editor-save')); });
    expect(api.post).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  test('hands the caller every field that changed, in ONE patch', async () => {
    const { view, onSaved, onClose } = await open();

    await act(async () => { fireEvent.press(view.getByTestId('image-editor-rotate')); });
    await act(async () => { fireEvent.press(view.getByTestId('image-editor-save')); });

    // All together or not at all: applying the new thumbnail without the
    // swapped width/height renders it letterboxed in the old aspect.
    expect(onSaved).toHaveBeenCalledWith({
      rotation: 90,
      width: 3000,
      height: 4000,
      thumbnailUrl: '/api/media/thumbnails/p1.webp',
      thumbnailLgUrl: '/api/media/thumbnails/p1-lg.webp',
      blurhash: 'LKO2',
      compressedUrl: null,
    });
    expect(onClose).toHaveBeenCalled();
  });

  test('a rejected save STAYS OPEN with the turn still applied, and reports why', async () => {
    const api = { post: jest.fn().mockRejectedValue(new Error('API Error 410: {"success":false,"message":"The original file is no longer accessible."}')) };
    const { view, onSaved, onClose, onError } = await open({ api });

    await act(async () => { fireEvent.press(view.getByTestId('image-editor-rotate')); });
    await act(async () => { fireEvent.press(view.getByTestId('image-editor-save')); });

    // The server's own sentence, not `API Error 410: {"success":false,…}`.
    expect(onError).toHaveBeenCalledWith('The original file is no longer accessible.');
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // Still editable, so the retry doesn't start from scratch.
    expect(view.getByTestId('image-editor-rotate')).toBeTruthy();
  });

  test('a success:false body is a failure, not a silent no-op', async () => {
    const api = { post: jest.fn().mockResolvedValue({ success: false, message: 'Only photos can be rotated.' }) };
    const { view, onSaved, onError } = await open({ api });

    await act(async () => { fireEvent.press(view.getByTestId('image-editor-rotate')); });
    await act(async () => { fireEvent.press(view.getByTestId('image-editor-save')); });

    expect(onError).toHaveBeenCalledWith('Only photos can be rotated.');
    expect(onSaved).not.toHaveBeenCalled();
  });

  test('the preview frame SWAPS its axes on a quarter turn so the photo fits the stage', async () => {
    const { view } = await open();

    // Stage measured at 300x600 by open().
    expect(frameOf(view)).toMatchObject({ width: 300, height: 600 });

    await act(async () => { fireEvent.press(view.getByTestId('image-editor-rotate')); });
    // Turned 90°: the frame is laid out 600x300 BEFORE the rotation, so the
    // rotated result occupies exactly the 300x600 stage instead of overflowing.
    expect(frameOf(view)).toMatchObject({ width: 600, height: 300 });
    expect(frameOf(view).transform).toEqual([{ rotate: '90deg' }]);

    await act(async () => { fireEvent.press(view.getByTestId('image-editor-rotate')); });
    // A half turn is the original aspect again.
    expect(frameOf(view)).toMatchObject({ width: 300, height: 600 });
    expect(frameOf(view).transform).toEqual([{ rotate: '180deg' }]);
  });
});
