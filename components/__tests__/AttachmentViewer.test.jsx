import React from 'react';
import { BackHandler } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));
// No SafeAreaProvider under jest, so the hook needs a stub.
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import AttachmentViewer from '../AttachmentViewer';

const IMAGES = [
  { key: '1', uri: 'http://pond/api/media/display/1', previewUri: 'http://pond/t/1.webp', name: 'one.png' },
  { key: '2', uri: 'http://pond/api/media/display/2', previewUri: 'http://pond/t/2.webp', name: 'two.png' },
  { key: '3', uri: 'http://pond/api/media/display/3', previewUri: 'http://pond/t/3.webp', name: 'three.png' },
];

const draw = (props = {}) => render(
  <AttachmentViewer visible images={IMAGES} index={0} onClose={jest.fn()} {...props} />,
);

it('renders nothing when hidden or empty', async () => {
  expect((await draw({ visible: false })).toJSON()).toBeNull();
  expect((await draw({ images: [] })).toJSON()).toBeNull();
});

it('shows one page per image with the thumbnail as placeholder', async () => {
  const view = await draw();
  const first = view.getByTestId('attachment-image-1');
  expect(view.getByTestId('attachment-image-3')).toBeTruthy();
  expect(first.props.source).toEqual({ uri: 'http://pond/api/media/display/1' });
  // The small copy paints immediately while the display tier is generated.
  expect(first.props.placeholder).toEqual({ uri: 'http://pond/t/1.webp' });
});

it('opens on the image that was tapped', async () => {
  const view = await draw({ index: 2 });
  expect(view.getByText('3 of 3')).toBeTruthy();
  expect(view.getByText('three.png')).toBeTruthy();
});

it('follows the pager as the user swipes', async () => {
  const view = await draw();
  expect(view.getByText('1 of 3')).toBeTruthy();

  // One viewport's worth of scroll = the second page (jest's window is 750pt).
  await fireEvent(view.getByTestId('attachment-pager'), 'momentumScrollEnd', {
    nativeEvent: { contentOffset: { x: 750 }, contentSize: { width: 2250 }, layoutMeasurement: { width: 750 } },
  });

  await waitFor(() => expect(view.getByText('2 of 3')).toBeTruthy());
  expect(view.getByText('two.png')).toBeTruthy();
});

it('omits the counter for a single image', async () => {
  const view = await draw({ images: [IMAGES[0]] });
  expect(view.queryByText('1 of 1')).toBeNull();
  expect(view.getByText('one.png')).toBeTruthy();
});

it('closes on the X', async () => {
  const onClose = jest.fn();
  const view = await draw({ onClose });
  await fireEvent.press(view.getByLabelText('Close image'));
  expect(onClose).toHaveBeenCalled();
});

it('falls back to the thumbnail when the full-size image will not load', async () => {
  // The display tier is generated on demand and can answer 503; a soft picture
  // beats an empty frame.
  const view = await draw();
  await fireEvent(view.getByTestId('attachment-image-1'), 'error', {});
  await waitFor(() => {
    expect(view.getByTestId('attachment-image-1').props.source).toEqual({ uri: 'http://pond/t/1.webp' });
  });
});

it('takes Android back for itself instead of letting the note close', async () => {
  const onClose = jest.fn();
  const spy = jest.spyOn(BackHandler, 'addEventListener');
  await draw({ onClose });

  const handler = spy.mock.calls.find(([e]) => e === 'hardwareBackPress')?.[1];
  expect(handler).toBeInstanceOf(Function);
  expect(handler()).toBe(true); // consumed — the host page does not also close
  expect(onClose).toHaveBeenCalled();
  spy.mockRestore();
});
