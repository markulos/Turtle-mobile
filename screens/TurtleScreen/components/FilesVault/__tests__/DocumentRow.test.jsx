import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import DocumentRow from '../DocumentRow';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));
jest.mock('../../../../../utils/haptics', () => ({ tapHaptic: jest.fn(), impactHaptic: jest.fn(), notifyHaptic: jest.fn() }));

const theme = { mode: 'dark', colors: { background: '#000', surface: '#0a0a0a', surfaceElevated: '#111', textPrimary: '#fff', textSecondary: '#aaa', textMuted: '#666', primary: '#fff', border: '#222', accentInfo: '#4af' } };
const pdf = { id: 'd1', type: 'document', originalName: 'Lease agreement 2025 final signed copy.pdf', size: 3.4 * 1024 * 1024, uploadDate: Date.UTC(2026, 0, 5), thumbnailUrl: '/t/d1.jpg' };

// NOTE: @testing-library/react-native 14.0.1's render/rerender/fireEvent are all
// `async function`s in this repo's installed version (verified in
// node_modules/@testing-library/react-native/dist/render.js + fire-event.js), so
// every call is awaited here — same convention as PhotoVaultBoardCard.test.jsx.
describe('DocumentRow', () => {
  it('renders the name, size and date, with the cover when there is one', async () => {
    const { getByText, getByTestId } = await render(<DocumentRow item={pdf} thumbUri="http://pond/t/d1.jpg" theme={theme} onPress={() => {}} testID="row" />);
    expect(getByText(pdf.originalName)).toBeTruthy();
    expect(getByText(/3\.4 MB · /)).toBeTruthy();
    expect(getByTestId('row-cover').props.source.uri).toBe('http://pond/t/d1.jpg');
  });
  it('falls back to a typed icon and shows the selection check in select mode', async () => {
    const { getByTestId, queryByTestId, rerender } = await render(<DocumentRow item={{ ...pdf, originalName: 'x.xlsx', thumbnailUrl: null }} theme={theme} onPress={() => {}} testID="row" />);
    expect(getByTestId('row-icon').props.name).toBe('file-excel-box');
    expect(queryByTestId('row-check')).toBeNull();
    await rerender(<DocumentRow item={pdf} theme={theme} onPress={() => {}} selectMode selected testID="row" />);
    expect(getByTestId('row-check').props.name).toBe('check-circle');
  });
  it('press + long press, and a progress bar while downloading', async () => {
    const onPress = jest.fn(); const onLongPress = jest.fn();
    const { getByLabelText, getByTestId } = await render(<DocumentRow item={pdf} theme={theme} onPress={onPress} onLongPress={onLongPress} progress={0.5} testID="row" />);
    await fireEvent.press(getByLabelText(`Open ${pdf.originalName}`));
    await fireEvent(getByLabelText(`Open ${pdf.originalName}`), 'longPress');
    expect(onPress).toHaveBeenCalled();
    expect(onLongPress).toHaveBeenCalled();
    expect(getByTestId('row-progress').props.style).toEqual(expect.arrayContaining([expect.objectContaining({ width: '50%' })]));
  });
});
