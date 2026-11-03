/**
 * The copy key is three lines of clipboard call and a dozen of everything
 * around it, which is why it is shared rather than retyped per caller. The
 * part a second copy would get wrong is the LAST one here: `copyText` can
 * come back 'none' — no clipboard AND the share sheet dismissed — and a key
 * that says "Copied" then is lying about where your text went.
 */
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('../../utils/haptics', () => ({ tapHaptic: jest.fn() }));
const mockCopy = jest.fn();
jest.mock('../../utils/copyText', () => ({ copyText: (...a) => mockCopy(...a) }));

import CopyKey from '../CopyKey';
import { tapHaptic } from '../../utils/haptics';

const press = async (view, id = 'copy-key') => {
  await act(async () => { fireEvent.press(view.getByTestId(id)); });
};

beforeEach(() => {
  mockCopy.mockReset();
  mockCopy.mockResolvedValue('copied');
  tapHaptic.mockClear();
  jest.useRealTimers();
});

describe('CopyKey', () => {
  test('it copies the text it was given, and buzzes', async () => {
    const view = await render(<CopyKey text="14 Larkin Street" testID="copy-key" />);
    await press(view);
    expect(mockCopy).toHaveBeenCalledWith('14 Larkin Street');
    expect(tapHaptic).toHaveBeenCalled();
  });

  test('it says Copied back', async () => {
    const view = await render(<CopyKey text="x" testID="copy-key" />);
    expect(view.getByText('Copy')).toBeTruthy();
    await press(view);
    expect(view.getByText('Copied')).toBeTruthy();
  });

  // The share sheet is a different destination and says a different word.
  test('…or Shared, when it fell back to the share sheet', async () => {
    mockCopy.mockResolvedValue('shared');
    const view = await render(<CopyKey text="x" testID="copy-key" />);
    await press(view);
    expect(view.getByText('Shared')).toBeTruthy();
    expect(view.queryByText('Copied')).toBeNull();
  });

  // THE ONE THAT MATTERS: nothing happened, so it must claim nothing.
  test('it claims nothing when the text went nowhere', async () => {
    mockCopy.mockResolvedValue('none');
    const view = await render(<CopyKey text="x" testID="copy-key" />);
    await press(view);
    expect(view.queryByText('Copied')).toBeNull();
    expect(view.queryByText('Shared')).toBeNull();
    expect(view.getByText('Copy')).toBeTruthy();
  });

  // For a key that has to sit beside a 10pt timestamp, where the word would
  // be the loudest thing in the bubble.
  test('label off is the glyph alone, and still announces itself', async () => {
    const view = await render(
      <CopyKey text="x" label={false} accessibilityLabel="Copy this message" testID="copy-key" />,
    );
    expect(view.queryByText('Copy')).toBeNull();
    expect(view.getByLabelText('Copy this message')).toBeTruthy();
  });

  // A screen reader should hear the result, not the offer, once it has landed.
  test('and what it announces changes once the text has gone', async () => {
    const view = await render(
      <CopyKey text="x" label={false} accessibilityLabel="Copy this message" testID="copy-key" />,
    );
    await press(view);
    expect(view.getByLabelText('Copied')).toBeTruthy();
  });

  // The confirmation is on a timer, and a chat transcript recycles its rows:
  // the row can be gone long before 1600ms is up.
  test('unmounting mid-confirmation does not set state on a dead key', async () => {
    const warn = jest.spyOn(console, 'error').mockImplementation(() => {});
    const view = await render(<CopyKey text="x" testID="copy-key" />);
    await press(view);
    await act(async () => { view.unmount(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 1700)); });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
