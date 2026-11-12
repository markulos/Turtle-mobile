import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, within } from '@testing-library/react-native';

import { dockSkin, activeInk } from '../dockSkins';

const setDockStyle = jest.fn();
const setDockIndicator = jest.fn();
const setDockColor = jest.fn();
const setDockInk = jest.fn();

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
    dockColor: mockState().colour,
    setDockColor: mockState().setDockColor,
    dockInk: mockState().ink,
    setDockInk: mockState().setDockInk,
  }),
}));

let state = { style: 'smoked', indicator: 'chip', colour: '#C8413B', ink: 'auto' };
global.mockState = () => ({ ...state, setDockStyle, setDockIndicator, setDockColor, setDockInk });

jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');
  return { LinearGradient: (props) => <View {...props} /> };
});
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');

// The colour sheet is a unit of its own (sliders, a hex field, safe-area and
// keyboard wiring) with its own tests. What this file cares about is WHETHER
// the picker opens it and WITH WHAT — so the stub keeps only the one piece of
// the real contract that matters here: nothing is rendered until it is shown.
jest.mock('../AccentColorPicker', () => {
  const { View } = require('react-native');
  return { __esModule: true, default: (props) => (props.visible ? <View {...props} /> : null) };
});

const impactHaptic = jest.fn();
jest.mock('../../utils/haptics', () => ({ impactHaptic: (...a) => mockHaptic(...a) }));
global.mockHaptic = (...a) => impactHaptic(...a);

import DockStylePicker from '../DockStylePicker';

const styleOf = (node) => StyleSheet.flatten(node.props.style) || {};

beforeEach(() => {
  state = { style: 'smoked', indicator: 'chip', colour: '#C8413B', ink: 'auto' };
  setDockStyle.mockClear();
  setDockInk.mockClear();
  setDockIndicator.mockClear();
  setDockColor.mockClear();
  impactHaptic.mockClear();
});

describe('Settings → Navigation → Navbar style', () => {
  test('offers every backdrop and every indicator', async () => {
    const { getByTestId } = await render(<DockStylePicker />);
    for (const id of ['dock-skin-smoked', 'dock-skin-paper', 'dock-skin-custom',
      'dock-indicator-chip', 'dock-indicator-underline',
      'dock-ink-auto', 'dock-ink-light', 'dock-ink-dark']) {
      expect(getByTestId(id)).toBeTruthy();
    }
  });

  test('each tile previews the skin it is offering, from the skin itself', async () => {
    const { getByTestId } = await render(<DockStylePicker />);
    // The preview is the whole control — one that can disagree with the dock
    // is worse than none, because it is believed. So it must be drawn from
    // dockSkins, not from a copy of those colours living in the picker.
    for (const key of ['smoked', 'paper', 'custom']) {
      const capsule = within(getByTestId(`dock-skin-${key}`))
        .getByTestId('dock-preview-capsule');
      expect(styleOf(capsule).borderColor).toBe(dockSkin(key, state.colour).edge);
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

  test('the custom tile selects AND asks which colour', async () => {
    const { getByTestId, queryByTestId } = await render(<DockStylePicker />);
    // Nothing is asking yet.
    expect(queryByTestId('accent-sheet')).toBeNull();

    await act(async () => { fireEvent.press(getByTestId('dock-skin-custom')); });
    // Choosing "custom" without being asked which colour would hand you
    // whatever the last one was and no way to see that you had a say.
    expect(setDockStyle).toHaveBeenCalledWith('custom');
    expect(getByTestId('accent-sheet').props.visible).toBe(true);
    // Opened on the colour the dock is wearing, not on a colour nobody chose.
    expect(getByTestId('accent-sheet').props.initialColor).toBe('#C8413B');
  });

  test('tapping custom again reopens the colour sheet rather than doing nothing', async () => {
    state = { style: 'custom', indicator: 'chip', colour: '#C8413B' };
    const { getByTestId } = await render(<DockStylePicker />);

    await act(async () => { fireEvent.press(getByTestId('dock-skin-custom')); });
    // Already selected, so it is NOT a change — but it is the only way back to
    // the colour, so it must still open the sheet.
    expect(setDockStyle).not.toHaveBeenCalled();
    expect(getByTestId('accent-sheet').props.visible).toBe(true);
  });

  test('the custom tile previews YOUR colour even when you are not on it', async () => {
    // Otherwise the tile is a blank you have to select to see.
    const { getByTestId } = await render(<DockStylePicker />);
    const capsule = within(getByTestId('dock-skin-custom')).getByTestId('dock-preview-capsule');
    expect(styleOf(capsule).borderColor).toBe(dockSkin('custom', '#C8413B').edge);
  });

  test('the ink row overrides the contrast check, and says so', async () => {
    const { getByTestId } = await render(<DockStylePicker />);
    fireEvent.press(getByTestId('dock-ink-dark'));
    expect(setDockInk).toHaveBeenCalledWith('dark');
  });

  test('each ink tile draws the glyph in the ink it is offering', async () => {
    // 'Auto' included: it is a preview precisely BECAUSE the answer depends on
    // your accent, and a tile labelled "Auto" showing nothing is a word, not a
    // choice.
    state = { style: 'smoked', indicator: 'chip', colour: '#C8413B', ink: 'light' };
    const { getByTestId } = await render(<DockStylePicker />);
    for (const key of ['auto', 'light', 'dark']) {
      const chip = within(getByTestId(`dock-ink-${key}`)).getByTestId('dock-preview-glyph');
      expect(styleOf(chip).backgroundColor).toBe(activeInk(key, '#1F8A9B'));
    }
  });

  test('the dock previews use the ink you have chosen, not the derived one', async () => {
    state = { style: 'smoked', indicator: 'chip', colour: '#C8413B', ink: 'dark' };
    const { getByTestId } = await render(<DockStylePicker />);
    const chip = within(getByTestId('dock-skin-smoked')).getByTestId('dock-preview-glyph');
    expect(styleOf(chip).backgroundColor).toBe(activeInk('dark', '#1F8A9B'));
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
