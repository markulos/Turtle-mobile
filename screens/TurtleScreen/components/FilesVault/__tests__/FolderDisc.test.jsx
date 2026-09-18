import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import FolderDisc from '../FolderDisc';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));
jest.mock('../../../../../utils/haptics', () => ({ tapHaptic: jest.fn(), impactHaptic: jest.fn(), notifyHaptic: jest.fn() }));

const theme = { mode: 'dark', colors: { background: '#000', surface: '#0a0a0a', textPrimary: '#fff', textSecondary: '#aaa', textMuted: '#666', primary: '#fff', border: '#222' } };

// NOTE: @testing-library/react-native 14.0.1's render/rerender/fireEvent are all
// `async function`s in this repo's installed version (verified in
// node_modules/@testing-library/react-native/dist/render.js + fire-event.js), so
// every call is awaited here — same convention as PhotoVaultBoardCard.test.jsx.
describe('FolderDisc', () => {
  it('shows the initial with a tint when there are no covers, and the count', async () => {
    const { getByText, queryAllByTestId } = await render(<FolderDisc name="Taxes" covers={[]} count={12} base="http://pond" theme={theme} onPress={() => {}} testID="disc" />);
    expect(getByText('T')).toBeTruthy();
    expect(getByText('Taxes')).toBeTruthy();
    expect(getByText('12')).toBeTruthy();
    expect(queryAllByTestId('disc-cover').length).toBe(0);
  });
  it('collages up to four covers, absolute or pond-relative', async () => {
    const { queryAllByTestId } = await render(<FolderDisc name="Taxes" covers={['/a.jpg', 'http://x/b.jpg', '/c.jpg', '/d.jpg', '/e.jpg']} count={4} base="http://pond" theme={theme} onPress={() => {}} testID="disc" />);
    const covers = queryAllByTestId('disc-cover');
    expect(covers.length).toBe(4);
    expect(covers[0].props.source.uri).toBe('http://pond/a.jpg');
    expect(covers[1].props.source.uri).toBe('http://x/b.jpg');
  });
  it('presses and long-presses, and is inert while pending', async () => {
    const onPress = jest.fn(); const onLongPress = jest.fn();
    const { getByLabelText, rerender } = await render(<FolderDisc name="Taxes" covers={[]} count={0} theme={theme} onPress={onPress} onLongPress={onLongPress} />);
    await fireEvent.press(getByLabelText('Open folder Taxes'));
    await fireEvent(getByLabelText('Open folder Taxes'), 'longPress');
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onLongPress).toHaveBeenCalledTimes(1);
    await rerender(<FolderDisc name="Taxes" covers={[]} count={0} theme={theme} onPress={onPress} pending />);
    await fireEvent.press(getByLabelText('Open folder Taxes'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
