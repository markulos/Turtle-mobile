import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import VaultImagePicker from '../VaultImagePicker';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));
jest.mock('../../../../utils/haptics', () => ({ tapHaptic: jest.fn() }));

const theme = {
  mode: 'dark',
  colors: {
    background: '#000',
    surfaceElevated: '#111',
    border: '#222',
    textPrimary: '#fff',
    textSecondary: '#aaa',
    textMuted: '#666',
  },
};

const photo = (id) => ({ id, type: 'image', thumbnailUrl: `/thumb/${id}.jpg`, width: 4032 });

const renderPicker = async (overrides = {}) => {
  const props = {
    visible: true,
    onClose: jest.fn(),
    onPick: jest.fn(),
    theme,
    api: { get: jest.fn().mockResolvedValue({ success: true, items: [photo(1), photo(2)] }) },
    getFullUrl: (path) => `http://pond${path}`,
    ...overrides,
  };
  return { props, view: await render(<VaultImagePicker {...props} />) };
};

describe('VaultImagePicker', () => {
  test('asks for PHOTOS only, newest first', async () => {
    const { props } = await renderPicker();

    await waitFor(() => expect(props.api.get).toHaveBeenCalled());
    const url = props.api.get.mock.calls[0][0];
    // 'photo' is the value normalizeFilters accepts. 'image' would be dropped
    // back to the default — which is 'all', i.e. a picker full of videos you
    // cannot attach.
    expect(url).toContain('mediaType=photo');
    expect(url).toContain('/media/gallery');
    expect(url).toContain('limit=60');
    expect(url).toContain('offset=0');
  });

  // Tapping SELECTS; Add commits. A tap that committed straight away would
  // make choosing a second photo impossible, which is the whole feature.
  test('collects a selection and hands it over in tap order', async () => {
    const { props, view } = await renderPicker();

    await waitFor(() => expect(view.getAllByLabelText('Vault photo').length).toBe(2));
    const cells = view.getAllByLabelText('Vault photo');
    await fireEvent.press(cells[1]);
    await fireEvent.press(cells[0]);
    expect(props.onPick).not.toHaveBeenCalled();

    await fireEvent.press(view.getByTestId('vault-picker-add'));
    // Second photo first: the order they were tapped is the order they attach,
    // and the order Claude will read them in.
    expect(props.onPick).toHaveBeenCalledWith([
      expect.objectContaining({ id: 2 }),
      expect.objectContaining({ id: 1 }),
    ]);
  });

  test('a tap toggles a photo back off', async () => {
    const { props, view } = await renderPicker();

    await waitFor(() => expect(view.getAllByLabelText('Vault photo').length).toBe(2));
    const cell = view.getAllByLabelText('Vault photo')[0];
    await fireEvent.press(cell);
    await fireEvent.press(cell);

    // Nothing selected — Add is inert rather than sending an empty list.
    expect(view.getByTestId('vault-picker-add').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
    await fireEvent.press(view.getByTestId('vault-picker-add'));
    expect(props.onPick).not.toHaveBeenCalled();
  });

  test('stops selecting at the composer’s remaining room', async () => {
    const { props, view } = await renderPicker({ maxSelection: 1 });

    await waitFor(() => expect(view.getAllByLabelText('Vault photo').length).toBe(2));
    const cells = view.getAllByLabelText('Vault photo');
    await fireEvent.press(cells[0]);
    await fireEvent.press(cells[1]); // past the cap — ignored, not swapped

    await fireEvent.press(view.getByTestId('vault-picker-add'));
    expect(props.onPick).toHaveBeenCalledWith([expect.objectContaining({ id: 1 })]);
  });

  test('a short page ends the paging instead of asking again', async () => {
    const api = { get: jest.fn().mockResolvedValue({ success: true, items: [photo(1)] }) };
    const { view } = await renderPicker({ api });

    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
    // One item back for a 60-item page means the library ended here.
    await view.getByTestId('vault-picker-grid').props.onEndReached();
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  test('a failed load says so and offers a retry', async () => {
    const api = { get: jest.fn().mockRejectedValue(new Error('pond unreachable')) };
    const { view } = await renderPicker({ api });

    await waitFor(() => expect(view.getByText('pond unreachable')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('Retry loading your photos'));
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  test('stays out of the tree until it is opened', async () => {
    const { props, view } = await renderPicker({ visible: false });

    expect(view.toJSON()).toBeNull();
    expect(props.api.get).not.toHaveBeenCalled();
  });
});
