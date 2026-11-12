import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, within } from '@testing-library/react-native';

import { dockSkin } from '../dockSkins';

const setDockStyle = jest.fn();
const setDockIndicator = jest.fn();

jest.mock('../../context/ThemeContext', () => ({
  DOCK_INDICATORS: ['chip', 'underline'],
  useTheme: () => ({
    theme: {
      mode: 'dark',
      colors: {
        accent: '#1F8A9B',
        border: '#333',
        background: '#000',
        surfaceElevated: '#111',
        textPrimary: '#fff',
        textSecondary: '#bbb',
        textTertiary: '#888',
      },
    },
    dockStyle: mockState().style,
    setDockStyle: mockState().setDockStyle,
    dockIndicator: mockState().indicator,
    setDockIndicator: mockState().setDockIndicator,
  }),
}));

let state = { style: 'smoked', indicator: 'chip' };
global.mockState = () => ({ ...state, setDockStyle, setDockIndicator });

jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');
  return { LinearGradient: (props) => <View {...props} /> };
});
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');

const impactHaptic = jest.fn();
jest.mock('../../utils/haptics', () => ({ impactHaptic: (...a) => mockHaptic(...a) }));
global.mockHaptic = (...a) => impactHaptic(...a);

import DockStylePicker from '../DockStylePicker';

const styleOf = (node) => StyleSheet.flatten(node.props.style) || {};

beforeEach(() => {
  state = { style: 'smoked', indicator: 'chip' };
  setDockStyle.mockClear();
  setDockIndicator.mockClear();
  impactHaptic.mockClear();
});

describe('Settings → Navigation → Navbar style', () => {
  test('offers both backdrops and both indicators', async () => {
    const { getByTestId } = await render(<DockStylePicker />);
    for (const id of ['dock-skin-smoked', 'dock-skin-paper',
      'dock-indicator-chip', 'dock-indicator-underline']) {
      expect(getByTestId(id)).toBeTruthy();
    }
  });

  test('each tile previews the skin it is offering, from the skin itself', async () => {
    const { getByTestId } = await render(<DockStylePicker />);
    // The preview is the whole control — one that can disagree with the dock
    // is worse than none, because it is believed. So it must be drawn from
    // dockSkins, not from a copy of those colours living in the picker.
    for (const key of ['smoked', 'paper']) {
      const capsule = within(getByTestId(`dock-skin-${key}`))
        .getByTestId('dock-preview-capsule');
      expect(styleOf(capsule).borderColor).toBe(dockSkin(key).edge);
    }
  });

  test('picking the other backdrop sets it, with one tick of feedback', async () => {
    const { getByTestId } = await render(<DockStylePicker />);
    fireEvent.press(getByTestId('dock-skin-paper'));
    expect(setDockStyle).toHaveBeenCalledWith('paper');
    expect(impactHaptic).toHaveBeenCalledTimes(1);
  });

  test('tapping the one you are already on does nothing at all', async () => {
    const { getByTestId } = await render(<DockStylePicker />);
    fireEvent.press(getByTestId('dock-skin-smoked'));
    // Not a change — and a tick for it would make the control feel like it had
    // done something it had not.
    expect(setDockStyle).not.toHaveBeenCalled();
    expect(impactHaptic).not.toHaveBeenCalled();
  });

  test('the indicator row is live too — it had no control at all before', async () => {
    const { getByTestId } = await render(<DockStylePicker />);
    fireEvent.press(getByTestId('dock-indicator-underline'));
    expect(setDockIndicator).toHaveBeenCalledWith('underline');
  });

  test('the selected tile is the one marked, and it follows the setting', async () => {
    const first = await render(<DockStylePicker />);
    expect(first.getByTestId('dock-skin-smoked').props.accessibilityState)
      .toMatchObject({ selected: true });
    expect(first.getByTestId('dock-skin-paper').props.accessibilityState)
      .toMatchObject({ selected: false });

    state = { style: 'paper', indicator: 'underline' };
    const second = await render(<DockStylePicker />);
    expect(second.getByTestId('dock-skin-paper').props.accessibilityState)
      .toMatchObject({ selected: true });
    expect(second.getByTestId('dock-indicator-underline').props.accessibilityState)
      .toMatchObject({ selected: true });
  });

  test('the indicator previews are drawn on the backdrop you actually have', async () => {
    state = { style: 'paper', indicator: 'chip' };
    const { getByTestId } = await render(<DockStylePicker />);
    // Otherwise the two rows contradict each other: a chip-vs-underline
    // comparison drawn on a dock you are not using answers the wrong question.
    for (const key of ['chip', 'underline']) {
      const capsule = within(getByTestId(`dock-indicator-${key}`))
        .getByTestId('dock-preview-capsule');
      expect(styleOf(capsule).borderColor).toBe(dockSkin('paper').edge);
    }
  });
});
