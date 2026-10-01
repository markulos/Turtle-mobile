/**
 * ImageEditor — the viewer's pencil key. Rotate, draw, and cut out a sticker.
 *
 * What these tests hold in place, in order of how much a regression would cost:
 *   1. Cancel NEVER writes. The editor is the only screen that can permanently
 *      change a photo, so "I turned it, then changed my mind" must be free.
 *   2. Save sends ONE RELATIVE delta. The pond adds it to the stored angle, so
 *      sending an absolute value would double-rotate anything already turned.
 *   3. A no-op Save doesn't hit the network — a 0° rotate still makes the pond
 *      re-render every thumbnail tier, and an empty drawing would file a copy
 *      of the photo that is identical to it.
 *   4. The preview frame SWAPS width/height on a quarter turn. Without it the
 *      rotated photo overflows the stage instead of fitting it.
 *   5. A drawing is posted in PHOTO coordinates, with the letterbox subtracted.
 *      The pond multiplies them by the real pixel dimensions, so an offset here
 *      is a stroke that lands somewhere else at full resolution.
 *   6. Draw and sticker file a NEW item, and say so through onCreated — the
 *      caller must not patch the row the editor was opened on.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
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
      // What the markup/sticker routes answer with: a whole new row.
      item: { id: 'p2', filename: 'p1-sticker.png', rawUrl: '/api/media/raw/p2.png' },
      ...over,
    }),
  };
}

async function open(props = {}) {
  const api = props.api || okApi();
  const onSaved = props.onSaved || jest.fn();
  const onClose = props.onClose || jest.fn();
  const onError = props.onError || jest.fn();
  const onCreated = props.onCreated || jest.fn();
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
      onCreated={onCreated}
      onError={onError}
    />,
  );
  // The stage measures itself; nothing renders the photo until it has a size.
  await act(async () => {
    fireEvent(view.getByTestId('image-editor-stage'), 'layout', {
      nativeEvent: { layout: { width: 300, height: 600 } },
    });
  });
  return { view, api, onSaved, onClose, onError, onCreated };
}

/**
 * A 4000x3000 photo in a 300x600 stage is drawn 300x225, centred — so the
 * letterbox is 187.5 px of black above it. These helpers work in STAGE
 * coordinates, exactly as a finger does, which is what makes the assertions
 * about posted coordinates meaningful: 0.5/0.5 can only come out of the maths
 * if the 187.5 was subtracted.
 */
const PHOTO_TOP = 187.5;
const stagePoint = (x, y) => ({ locationX: x, locationY: y, pageX: x, pageY: y + 1000 });

/** One finger-down → moves → up over the drawing surface. */
async function drag(view, points) {
  const surface = view.getByTestId('image-editor-surface');
  const [first, ...rest] = points;
  await act(async () => {
    fireEvent(surface, 'responderGrant', { nativeEvent: stagePoint(first[0], first[1]) });
  });
  for (const [x, y] of rest) {
    // Each move in its own act: a batched pair would collapse into one render
    // and stop proving that the live stroke tracks the finger.
    await act(async () => {
      fireEvent(surface, 'responderMove', { nativeEvent: stagePoint(x, y) });
    });
  }
  await act(async () => { fireEvent(surface, 'responderRelease', { nativeEvent: stagePoint(0, 0) }); });
}

const pickTool = async (view, id) => {
  await act(async () => { fireEvent.press(view.getByTestId(id)); });
};

const frameOf = (view) => StyleSheet.flatten(view.getByTestId('image-editor-preview').props.style);

describe('ImageEditor', () => {
  test('renders nothing when closed, or when there is no photo', async () => {
    const closed = await render(<ImageEditor visible={false} item={photo()} api={okApi()} />);
    expect(closed.queryByTestId('image-editor')).toBeNull();

    const empty = await render(<ImageEditor visible item={null} api={okApi()} />);
    expect(empty.queryByTestId('image-editor')).toBeNull();
  });

  test('covers the viewer it is opened over, and swallows the touches meant for it', async () => {
    // The editor is an in-tree overlay, so it can only out-draw its siblings
    // inside the viewer's Modal: the chrome (5), the share "preparing" card
    // (300) and the sheets (1000). `elevation` says it again for Android,
    // which orders siblings by elevation and ignores zIndex on its own.
    const { view } = await open();
    const root = StyleSheet.flatten(view.getByTestId('image-editor').props.style);
    expect(root.zIndex).toBeGreaterThan(1000);
    expect(root.elevation).toBe(root.zIndex);

    // And it has to claim the touch: made of plain Views, a finger would reach
    // the viewer's gesture stage underneath and a swipe meant for the editor
    // would dismiss the viewer — taking the edit in progress with it.
    expect(view.getByTestId('image-editor').props.onStartShouldSetResponder()).toBe(true);
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

    // The server's own sentence, not `API Error 410: {"success":false,…}` —
    // and the tool it came from, so the alert can be titled for it.
    expect(onError).toHaveBeenCalledWith('The original file is no longer accessible.', 'rotate');
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

    expect(onError).toHaveBeenCalledWith('Only photos can be rotated.', 'rotate');
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

  describe('the drawing surface', () => {
    test('exists only for the drawing tools — rotate keeps its own taps', async () => {
      const { view } = await open();
      expect(view.queryByTestId('image-editor-surface')).toBeNull();

      await pickTool(view, 'image-editor-draw');
      expect(view.getByTestId('image-editor-surface')).toBeTruthy();

      await pickTool(view, 'image-editor-rotate');
      expect(view.queryByTestId('image-editor-surface')).toBeNull();
    });

    test('covers the whole stage, so a tap in the letterbox is distinguishable', async () => {
      // If it were sized to the photo, locationY would report a touch in the
      // black bars as the photo's own edge and stamp a mark there.
      const { view } = await open();
      await pickTool(view, 'image-editor-draw');
      const style = StyleSheet.flatten(view.getByTestId('image-editor-surface').props.style);
      expect(style).toMatchObject({ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 });
    });

    test('refuses to draw while a save is in flight', async () => {
      let release;
      const api = { post: jest.fn(() => new Promise((r) => { release = r; })) };
      const { view } = await open({ api });
      await pickTool(view, 'image-editor-draw');
      await drag(view, [[150, 300], [200, 350]]);
      await act(async () => { fireEvent.press(view.getByTestId('image-editor-save')); });

      const surface = view.getByTestId('image-editor-surface');
      expect(surface.props.onStartShouldSetResponder()).toBe(false);

      await act(async () => { release({ success: true, item: { id: 'p2' } }); });
    });
  });

  describe('markup', () => {
    test('posts the stroke in PHOTO coordinates, with the letterbox subtracted', async () => {
      const { view, api } = await open();
      await pickTool(view, 'image-editor-draw');

      // The photo is drawn 300x225 at y=187.5. These three touches are its
      // top-left corner, its centre and its bottom-right corner.
      await drag(view, [[0, PHOTO_TOP], [150, PHOTO_TOP + 112.5], [300, PHOTO_TOP + 225]]);
      await act(async () => { fireEvent.press(view.getByTestId('image-editor-save')); });

      expect(api.post).toHaveBeenCalledTimes(1);
      const [route, body] = api.post.mock.calls[0];
      expect(route).toBe('/media/p1/markup');
      expect(body.strokes).toHaveLength(1);
      expect(body.strokes[0].points).toEqual([[0, 0], [0.5, 0.5], [1, 1]]);
      // Fractions, never pixels: the pond multiplies by the real 4000x3000.
      for (const [x, y] of body.strokes[0].points) {
        expect(x).toBeLessThanOrEqual(1);
        expect(y).toBeLessThanOrEqual(1);
      }
    });

    test('sends the chosen colour, and a width relative to the photo', async () => {
      const { view, api } = await open();
      await pickTool(view, 'image-editor-draw');
      await act(async () => { fireEvent.press(view.getByTestId('image-editor-color-#ff3b30')); });
      await act(async () => { fireEvent.press(view.getByTestId('image-editor-size-12')); });

      await drag(view, [[100, 300], [200, 320]]);
      await act(async () => { fireEvent.press(view.getByTestId('image-editor-save')); });

      const [, body] = api.post.mock.calls[0];
      expect(body.strokes[0].color).toBe('#ff3b30');
      // 12 px on a photo drawn 300 px wide — 4 % of the photo, at any resolution.
      expect(body.strokes[0].width).toBeCloseTo(0.04);
    });

    test('each finger-down is its own stroke, and Undo drops the last one', async () => {
      const { view, api } = await open();
      await pickTool(view, 'image-editor-draw');
      await drag(view, [[50, 250], [80, 260]]);
      await drag(view, [[100, 300], [140, 320]]);
      await drag(view, [[200, 350], [240, 360]]);

      await act(async () => { fireEvent.press(view.getByTestId('image-editor-undo')); });
      await act(async () => { fireEvent.press(view.getByTestId('image-editor-save')); });

      const [, body] = api.post.mock.calls[0];
      expect(body.strokes).toHaveLength(2);
      // The SECOND stroke survived intact — undo must not merge or trim it.
      expect(body.strokes[1].points).toHaveLength(2);
    });

    test('a stroke that starts in the letterbox is not a stroke at all', async () => {
      const { view, api, onClose } = await open();
      await pickTool(view, 'image-editor-draw');

      // y=20 is in the black bar above a 4:3 photo in a 2:1 stage.
      await drag(view, [[150, 20], [160, 40]]);
      await act(async () => { fireEvent.press(view.getByTestId('image-editor-save')); });

      expect(api.post).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });

    test('a tap leaves a dot — one point, which the pond draws as a circle', async () => {
      const { view, api } = await open();
      await pickTool(view, 'image-editor-draw');
      await drag(view, [[150, 300]]);
      await act(async () => { fireEvent.press(view.getByTestId('image-editor-save')); });

      const [, body] = api.post.mock.calls[0];
      expect(body.strokes[0].points).toEqual([[0.5, 0.5]]);
    });

    test('hands back a NEW item through onCreated, and never patches the original', async () => {
      const api = okApi({ item: { id: 'p2', filename: 'p1-markup.jpg' } });
      const { view, onCreated, onSaved, onClose } = await open({ api });
      await pickTool(view, 'image-editor-draw');
      await drag(view, [[100, 300], [200, 350]]);
      await act(async () => { fireEvent.press(view.getByTestId('image-editor-save')); });

      expect(onCreated).toHaveBeenCalledWith({ id: 'p2', filename: 'p1-markup.jpg' }, { kind: 'markup' });
      // onSaved patches the row the editor was opened on — catastrophically
      // wrong here, since that photo was not touched.
      expect(onSaved).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });

    test('an empty canvas does not post, and the failure message names the tool', async () => {
      const { view, api } = await open();
      await pickTool(view, 'image-editor-draw');
      await act(async () => { fireEvent.press(view.getByTestId('image-editor-save')); });
      expect(api.post).not.toHaveBeenCalled();

      const sad = { post: jest.fn().mockRejectedValue(new Error('API Error 400: {"success":false,"message":"Nothing was drawn."}')) };
      const second = await open({ api: sad });
      await pickTool(second.view, 'image-editor-draw');
      await drag(second.view, [[100, 300], [200, 350]]);
      await act(async () => { fireEvent.press(second.view.getByTestId('image-editor-save')); });

      expect(second.onError).toHaveBeenCalledWith('Nothing was drawn.', 'draw');
      expect(second.onClose).not.toHaveBeenCalled();
      // Still drawn on, so the retry doesn't start from a blank photo.
      expect(second.view.getByTestId('image-editor-surface')).toBeTruthy();
    });
  });

  describe('stickers', () => {
    test('posts the traced outline, closed by the pond', async () => {
      const { view, api } = await open();
      await pickTool(view, 'image-editor-sticker');
      await drag(view, [
        [90, PHOTO_TOP + 45],
        [210, PHOTO_TOP + 45],
        [210, PHOTO_TOP + 180],
        [90, PHOTO_TOP + 180],
      ]);
      await act(async () => { fireEvent.press(view.getByTestId('image-editor-save')); });

      const [route, body] = api.post.mock.calls[0];
      expect(route).toBe('/media/p1/sticker');
      expect(body.outline).toEqual([[0.3, 0.2], [0.7, 0.2], [0.7, 0.8], [0.3, 0.8]]);
      // The phone does not close it — the pond does, and sends no `border` so
      // the default (on) applies.
      expect(body.outline[0]).not.toEqual(body.outline[body.outline.length - 1]);
    });

    test('the preview shows a CLOSED path, because that is what will be cut', async () => {
      const { view } = await open();
      await pickTool(view, 'image-editor-sticker');
      await drag(view, [[90, 250], [210, 250], [210, 380]]);
      expect(view.getByTestId('image-editor-lasso').props.d).toMatch(/ Z$/);
    });

    test('a second trace REPLACES the first — two lassos are not one cutout', async () => {
      const { view, api } = await open();
      await pickTool(view, 'image-editor-sticker');
      await drag(view, [[20, 200], [40, 220], [20, 240]]);
      await drag(view, [
        [90, PHOTO_TOP + 45],
        [210, PHOTO_TOP + 45],
        [150, PHOTO_TOP + 180],
      ]);
      await act(async () => { fireEvent.press(view.getByTestId('image-editor-save')); });

      const [, body] = api.post.mock.calls[0];
      expect(body.outline).toEqual([[0.3, 0.2], [0.7, 0.2], [0.5, 0.8]]);
    });

    test('a mis-tap is not a trace: nothing is posted and the editor just closes', async () => {
      const { view, api, onClose } = await open();
      await pickTool(view, 'image-editor-sticker');
      // Three points a hair apart — the pond would return a 6 px PNG.
      await drag(view, [[150, 300], [151, 301], [150, 302]]);
      await act(async () => { fireEvent.press(view.getByTestId('image-editor-save')); });

      expect(api.post).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });

    test('Clear drops the trace', async () => {
      const { view, api, onClose } = await open();
      await pickTool(view, 'image-editor-sticker');
      await drag(view, [[90, 250], [210, 250], [210, 380]]);
      await act(async () => { fireEvent.press(view.getByTestId('image-editor-undo')); });

      expect(view.queryByTestId('image-editor-lasso')).toBeNull();
      await act(async () => { fireEvent.press(view.getByTestId('image-editor-save')); });
      expect(api.post).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });

    test('tells the caller it was a sticker, so the share sheet can offer a PNG', async () => {
      const { view, onCreated } = await open();
      await pickTool(view, 'image-editor-sticker');
      await drag(view, [[90, 250], [210, 250], [210, 380]]);
      await act(async () => { fireEvent.press(view.getByTestId('image-editor-save')); });

      expect(onCreated).toHaveBeenCalledWith(
        { id: 'p2', filename: 'p1-sticker.png', rawUrl: '/api/media/raw/p2.png' },
        { kind: 'sticker' },
      );
    });
  });

  describe('switching tools', () => {
    test('discards the other tool\'s unsaved preview rather than mixing them', async () => {
      // Rotating and drawing at once would need a finger normalized against a
      // rotated rect — right on two angles, mirrored on the other two. Nothing
      // is written until Save, so a discarded preview costs nothing.
      const { view, api } = await open();
      await act(async () => { fireEvent.press(view.getByTestId('image-editor-rotate')); });
      expect(frameOf(view)).toMatchObject({ width: 600, height: 300 });

      await pickTool(view, 'image-editor-draw');
      expect(frameOf(view)).toMatchObject({ width: 300, height: 600 });
      expect(frameOf(view).transform).toEqual([{ rotate: '0deg' }]);

      await drag(view, [[100, 300], [200, 350]]);
      await pickTool(view, 'image-editor-sticker');
      await act(async () => { fireEvent.press(view.getByTestId('image-editor-save')); });
      expect(api.post).not.toHaveBeenCalled();
    });

    test('a reopen on another photo starts on Rotate with nothing drawn', async () => {
      const api = okApi();
      const view = await render(
        <ImageEditor visible item={photo()} api={api} getFullUrl={getFullUrl} colors={colors} />,
      );
      await act(async () => {
        fireEvent(view.getByTestId('image-editor-stage'), 'layout', {
          nativeEvent: { layout: { width: 300, height: 600 } },
        });
      });
      await pickTool(view, 'image-editor-draw');
      await drag(view, [[100, 300], [200, 350]]);

      // Not wrapped in act(): rerender drives its own. The flush afterwards is
      // for the reopen EFFECT, which is what discards the drawing — it runs
      // after the commit, so a synchronous assertion here would read the tree
      // one render too early.
      view.rerender(
        <ImageEditor visible item={photo({ id: 'p9' })} api={api} getFullUrl={getFullUrl} colors={colors} />,
      );
      await waitFor(() => expect(view.queryByTestId('image-editor-surface')).toBeNull());

      await act(async () => { fireEvent.press(view.getByTestId('image-editor-save')); });
      expect(api.post).not.toHaveBeenCalled();
    });
  });
});
