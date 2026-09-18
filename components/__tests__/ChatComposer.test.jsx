import React from 'react';
import { render } from '@testing-library/react-native';
import ChatComposer, { COMPOSER_MAX_LENGTH } from '../ChatComposer';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('expo-blur', () => ({ BlurView: 'BlurView' }));
jest.mock('../../utils/haptics', () => ({ tapHaptic: jest.fn(), impactHaptic: jest.fn() }));

const theme = {
  mode: 'dark',
  colors: {
    background: '#000',
    surface: '#0a0a0a',
    surfaceElevated: '#111',
    border: '#222',
    primary: '#fff',
    onPrimary: '#000',
    textPrimary: '#fff',
    textSecondary: '#aaa',
    textMuted: '#666',
  },
};

const renderComposer = async (overrides = {}) => {
  const props = {
    theme,
    value: '',
    onChangeText: jest.fn(),
    onSend: jest.fn(),
    ...overrides,
  };
  return { props, view: await render(<ChatComposer {...props} />) };
};

describe('ChatComposer length ceiling', () => {
  // Regression, 2026-09-16: reported as "the clipboard cuts off when you copy a
  // message". The clipboard was always fine — iOS truncates a PASTE to fit
  // `maxLength`, silently, and the default was 500. Copying a 4,400-character
  // prompt out of a reply and pasting it back landed 500 characters of it.
  test('accepts a prompt far longer than the old 500-character default', async () => {
    const { view } = await renderComposer();
    const input = view.getByPlaceholderText('Message…');

    expect(input.props.maxLength).toBe(COMPOSER_MAX_LENGTH);
    expect(COMPOSER_MAX_LENGTH).toBeGreaterThanOrEqual(8000);
    // The actual reply that triggered this was 5,231 chars with a 4,426-char
    // fence. Both have to paste whole, with room to edit afterwards.
    expect(COMPOSER_MAX_LENGTH).toBeGreaterThan(5231);
  });

  test('still caps, so pasting a whole file is not a chat message', async () => {
    const { view } = await renderComposer();
    expect(view.getByPlaceholderText('Message…').props.maxLength).toBeLessThan(100000);
  });

  test('a caller can still pin its own ceiling', async () => {
    const { view } = await renderComposer({ maxLength: 120 });
    expect(view.getByPlaceholderText('Message…').props.maxLength).toBe(120);
  });
});
