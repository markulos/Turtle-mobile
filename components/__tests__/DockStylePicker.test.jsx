import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, within } from '@testing-library/react-native';

import { dockSkin, activeInk } from '../dockSkins';
import { DOCK_PALETTES } from '../dockPalettes';
import { DOCK_THEMES, themeSkin } from '../dockThemes';
import { chipFill } from '../dockLight';

const setDockStyle = jest.fn();
const setDockIndicator = jest.fn();
const setDockColor = jest.fn();
const setDockInk = jest.fn();
const setCustomAccent = jest.fn();
const setDockTheme = jest.fn();

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
    accentColor: mockState().accentColor,
    setCustomAccent: mockState().setCustomAccent,
    dockGlow: mockState().glow,
    setDockGlow: mockState().setDockGlow,
    dockGlowColor: mockState().glowColour,
    setDockGlowColor: mockState().setDockGlowColor,
    dockTheme: mockState().theme,
    setDockTheme: mockState().setDockTheme,
  }),
}));

let state = {
  style: 'smoked', indicator: 'chip', colour: '#C8413B', ink: 'auto',
  accentColor: '#1F8A9B', theme: '',
};
global.mockState = () => ({
  ...state,
  setDockStyle, setDockIndicator, setDockColor, setDockInk, setCustomAccent, setDockTheme,
  setDockGlow, setDockGlowColor,
});

jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');
  return { LinearGradient: (props) => <View {...props} /> };
});
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
// The live preview draws the glow as a vector. Virtual: the desktop mirror
// has no react-native-svg installed.
jest.mock('react-native-svg', () => {
  const ReactLib = require('react');
  const { View } = require('react-native');
  const Part = (props) => ReactLib.createElement(View, props);
  return {
    __esModule: true, default: Part, Defs: Part, Ellipse: Part, RadialGradient: Part, Stop: Part,
  };
}, { virtual: true });
const setDockGlow = jest.fn();
const setDockGlowColor = jest.fn();

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
  state = {
    style: 'smoked', indicator: 'chip', colour: '#C8413B', ink: 'auto',
    accentColor: '#1F8A9B', theme: '',
  };
  setDockStyle.mockClear();
  setDockGlow.mockClear();
  setDockGlowColor.mockClear();
  setDockInk.mockClear();
  setCustomAccent.mockClear();
  setDockTheme.mockClear();
  setDockIndicator.mockClear();
  setDockColor.mockClear();
  impactHaptic.mockClear();
});

describe('Settings → Navigation → Navbar style', () => {
  test('offers every backdrop and every indicator', async () => {
    const { getByTestId } = await render(<DockStylePicker />);
    // The ink row is one of the hand-set controls: it is behind Custom.
    await fireEvent.press(getByTestId('dock-mode-custom'));
    for (const id of ['dock-skin-smoked', 'dock-skin-paper', 'dock-skin-custom',
      'dock-indicator-chip', 'dock-indicator-underline',
      'dock-ink-auto', 'dock-ink-light', 'dock-ink-dark',
      ...DOCK_PALETTES.map((p) => `dock-palette-${p.key}`),
      ...DOCK_THEMES.map((t) => `dock-theme-${t.key}`)]) {
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
    await fireEvent.press(getByTestId('dock-mode-custom'));
    setDockInk.mockClear();
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

  test('a palette writes the whole look in one tap', async () => {
    const p = DOCK_PALETTES[2];
    const { getByTestId } = await render(<DockStylePicker />);
    fireEvent.press(getByTestId(`dock-palette-${p.key}`));

    // All four, or it is half a look: the backdrop needs the custom SKIN
    // selected to be visible at all, and the chip is the app's accent.
    expect(setDockStyle).toHaveBeenCalledWith('custom');
    expect(setDockColor).toHaveBeenCalledWith(p.backdrop);
    expect(setDockInk).toHaveBeenCalledWith(p.ink);
    expect(setCustomAccent).toHaveBeenCalledWith(p.accent);
    expect(impactHaptic).toHaveBeenCalledTimes(1);
  });

  test('the palette you are wearing is ticked, and editing it un-ticks it', async () => {
    const p = DOCK_PALETTES[0];
    state = {
      style: 'custom', indicator: 'chip', colour: p.backdrop, ink: p.ink, accentColor: p.accent,
    };
    const on = await render(<DockStylePicker />);
    expect(on.getByTestId(`dock-palette-${p.key}`).props.accessibilityState)
      .toMatchObject({ selected: true });

    // Nudge one of the four it wrote. The tile must let go rather than keep a
    // tick on a look that has since been edited — it is recomputed, not saved.
    state = { ...state, ink: 'dark' };
    const off = await render(<DockStylePicker />);
    expect(off.getByTestId(`dock-palette-${p.key}`).props.accessibilityState)
      .toMatchObject({ selected: false });
  });

  test('re-tapping the palette you are on writes nothing', async () => {
    const p = DOCK_PALETTES[0];
    state = {
      style: 'custom', indicator: 'chip', colour: p.backdrop, ink: p.ink, accentColor: p.accent,
    };
    const { getByTestId } = await render(<DockStylePicker />);
    fireEvent.press(getByTestId(`dock-palette-${p.key}`));
    expect(setCustomAccent).not.toHaveBeenCalled();
    expect(impactHaptic).not.toHaveBeenCalled();
  });

  test('each palette tile previews its OWN pairing, not the dock you are on', async () => {
    const { getByTestId } = await render(<DockStylePicker />);
    for (const p of DOCK_PALETTES) {
      const tile = within(getByTestId(`dock-palette-${p.key}`));
      expect(styleOf(tile.getByTestId('dock-preview-capsule')).borderColor)
        .toBe(dockSkin('custom', p.backdrop).edge);
      expect(styleOf(tile.getByTestId('dock-preview-glyph')).backgroundColor)
        .toBe(activeInk(p.ink, p.accent));
    }
  });

  describe('named themes', () => {
    const g = DOCK_THEMES[0];
    const worn = () => ({
      style: 'custom', indicator: 'chip', colour: g.backdrop, ink: g.ink,
      accentColor: g.accent, theme: g.key,
    });

    test('applying one writes the four settings AND remembers the theme', async () => {
      const { getByTestId } = await render(<DockStylePicker />);
      fireEvent.press(getByTestId(`dock-theme-${g.key}`));
      // The key is the only thing that can bring the skin overrides back;
      // without it this would be a palette with extra words.
      expect(setDockTheme).toHaveBeenCalledWith(g.key);
      expect(setDockStyle).toHaveBeenCalledWith('custom');
      expect(setDockColor).toHaveBeenCalledWith(g.backdrop);
      expect(setDockInk).toHaveBeenCalledWith(g.ink);
      expect(setCustomAccent).toHaveBeenCalledWith(g.accent);
    });

    test('its tile previews the OVERRIDES, not the plain custom skin', async () => {
      const { getByTestId } = await render(<DockStylePicker />);
      const capsule = within(getByTestId(`dock-theme-${g.key}`))
        .getByTestId('dock-preview-capsule');
      expect(styleOf(capsule).borderColor).toBe(themeSkin(g).edge);
      expect(styleOf(capsule).borderColor).not.toBe(dockSkin('custom', g.backdrop).edge);
    });

    test('it is ticked only while the settings under it still agree', async () => {
      state = worn();
      const on = await render(<DockStylePicker />);
      expect(on.getByTestId(`dock-theme-${g.key}`).props.accessibilityState)
        .toMatchObject({ selected: true });

      state = { ...worn(), ink: 'dark' };
      const off = await render(<DockStylePicker />);
      expect(off.getByTestId(`dock-theme-${g.key}`).props.accessibilityState)
        .toMatchObject({ selected: false });
    });

    test('ANY hand-made change afterwards drops the theme', async () => {
      // Its overrides are not settings, so leaving the key on while the
      // colours under it are edited paints a dock that matches nothing in
      // this card.
      state = worn();
      const { getByTestId } = await render(<DockStylePicker />);
      fireEvent.press(getByTestId('dock-skin-paper'));
      expect(setDockTheme).toHaveBeenCalledWith('');
      expect(setDockStyle).toHaveBeenCalledWith('paper');
    });

    test('and so does picking a palette', async () => {
      state = worn();
      const { getByTestId } = await render(<DockStylePicker />);
      fireEvent.press(getByTestId(`dock-palette-${DOCK_PALETTES[1].key}`));
      expect(setDockTheme).toHaveBeenCalledWith('');
    });

    test('a palette tile does not also claim you while a theme is on', async () => {
      // Wearing the theme, with its colours — which no palette matches, but
      // the rule has to hold whatever colours a future theme picks.
      state = worn();
      const { getByTestId } = await render(<DockStylePicker />);
      for (const p of DOCK_PALETTES) {
        expect(getByTestId(`dock-palette-${p.key}`).props.accessibilityState)
          .toMatchObject({ selected: false });
      }
    });

    test('re-tapping the theme you are wearing writes nothing', async () => {
      state = worn();
      const { getByTestId } = await render(<DockStylePicker />);
      fireEvent.press(getByTestId(`dock-theme-${g.key}`));
      expect(setDockTheme).not.toHaveBeenCalled();
      expect(impactHaptic).not.toHaveBeenCalled();
    });
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

describe('one panel: the live preview, and Auto or Custom', () => {
  test('the live preview is the dock you have, and follows the indicator', async () => {
    const chip = await render(<DockStylePicker />);
    expect(chip.getByTestId('dock-live')).toBeTruthy();
    expect(chip.queryByTestId('dock-live-chip')).not.toBeNull();
    expect(chip.queryByTestId('dock-live-line')).toBeNull();
    await chip.unmount();

    state = { ...state, indicator: 'underline' };
    const line = await render(<DockStylePicker />);
    expect(line.queryByTestId('dock-live-chip')).toBeNull();
    expect(line.queryByTestId('dock-live-line')).not.toBeNull();
    // On the smoked (dark) bar with no chip, auto ink is white.
    expect(line.getByTestId('dock-live-active-icon').props.color).toBe('#FFFFFF');
  });

  test('a worn theme\'s black ink does not land on its black bar under the underline', async () => {
    const g = DOCK_THEMES[0];
    state = {
      style: 'custom', indicator: 'underline', colour: g.backdrop, ink: g.ink,
      accentColor: g.accent, theme: g.key,
    };
    const view = await render(<DockStylePicker />);
    expect(view.getByTestId('dock-live-active-icon').props.color).toBe('#FFFFFF');
  });

  test('Auto hides the hand-set controls; Custom shows them', async () => {
    const view = await render(<DockStylePicker />);
    expect(view.getByTestId('dock-mode-auto').props.accessibilityState.selected).toBe(true);
    for (const id of ['dock-ink-auto', 'dock-glow-medium', 'dock-glow-colour-custom', 'dock-highlight']) {
      expect(view.queryByTestId(id)).toBeNull();
    }
    // The look itself is not a hand-set detail: it is offered either way.
    expect(view.queryByTestId('dock-skin-paper')).not.toBeNull();
    expect(view.queryByTestId('dock-indicator-underline')).not.toBeNull();

    await fireEvent.press(view.getByTestId('dock-mode-custom'));
    for (const id of ['dock-ink-auto', 'dock-glow-medium', 'dock-glow-colour-custom', 'dock-highlight']) {
      expect(view.queryByTestId(id)).not.toBeNull();
    }
    // Looking at the controls changes nothing.
    expect(setDockInk).not.toHaveBeenCalled();
    expect(setDockGlow).not.toHaveBeenCalled();
  });

  test('anything set by hand opens the panel on Custom', async () => {
    state = { ...state, glow: 1.6 };
    const view = await render(<DockStylePicker />);
    expect(view.getByTestId('dock-mode-custom').props.accessibilityState.selected).toBe(true);
    expect(view.queryByTestId('dock-glow-strong')).not.toBeNull();
  });

  test('going back to Auto undoes what was set by hand', async () => {
    state = { ...state, ink: 'dark', glow: 1.6, glowColour: '#12AB34' };
    const view = await render(<DockStylePicker />);
    fireEvent.press(view.getByTestId('dock-mode-auto'));
    expect(setDockInk).toHaveBeenCalledWith('auto');
    expect(setDockGlow).toHaveBeenCalledWith(1);
    expect(setDockGlowColor).toHaveBeenCalledWith(null);
  });

  test('Auto leaves a worn look\'s own ink alone — nobody set it by hand', async () => {
    const p = DOCK_PALETTES[0];
    state = {
      style: 'custom', indicator: 'chip', colour: p.backdrop, ink: p.ink,
      accentColor: p.accent, theme: '', glow: 0.6,
    };
    const view = await render(<DockStylePicker />);
    fireEvent.press(view.getByTestId('dock-mode-auto'));
    expect(setDockInk).not.toHaveBeenCalled();
    expect(setDockGlow).toHaveBeenCalledWith(1);
  });

  test('the highlight colour can be changed from here, with the app\'s own sheet', async () => {
    const view = await render(<DockStylePicker />);
    await fireEvent.press(view.getByTestId('dock-mode-custom'));
    expect(view.queryByTestId('highlight-sheet')).toBeNull();
    await fireEvent.press(view.getByTestId('dock-highlight'));
    const sheet = view.getByTestId('highlight-sheet');
    expect(sheet.props.initialColor).toBe('#1F8A9B');
    await act(async () => { sheet.props.onSelect('#AA5500'); });
    expect(setCustomAccent).toHaveBeenCalledWith('#AA5500');
  });
});

describe('the tiles are small docks, not swatches', () => {
  const stops = (node) => {
    const found = [];
    const walk = (n) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (n.props?.stopColor) found.push({ colour: n.props.stopColor, alpha: n.props.stopOpacity });
      walk(n.children);
    };
    walk(node);
    return found;
  };
  const peak = (view, id) => {
    const tile = view.getByTestId(id);
    const json = view.toJSON();
    // Find the tile's subtree in the JSON by its testID.
    let sub = null;
    const find = (n) => {
      if (!n || typeof n !== 'object' || sub) return;
      if (Array.isArray(n)) { n.forEach(find); return; }
      if (n.props?.testID === tile.props.testID) { sub = n; return; }
      find(n.children);
    };
    find(json);
    return Math.max(0, ...stops(sub).map((s) => s.alpha));
  };

  test('each glow step draws your bar at that strength — Off draws none', async () => {
    state = { ...state, indicator: 'underline', glow: 1.6 };
    const view = await render(<DockStylePicker />);
    const off = peak(view, 'dock-glow-off');
    const soft = peak(view, 'dock-glow-soft');
    const medium = peak(view, 'dock-glow-medium');
    const strong = peak(view, 'dock-glow-strong');
    expect(off).toBe(0);
    expect(soft).toBeGreaterThan(0);
    expect(medium).toBeGreaterThan(soft);
    expect(strong).toBeGreaterThan(medium);
  });

  test('the chip in a tile is translucent, exactly like the real one', async () => {
    // The tile is a preview and a preview that disagrees with the bar is worse
    // than none, because it is believed. The chip lost its painted shade and
    // its lit rim; it is the highlight colour let through a little, and the
    // tile has to say the same thing.
    const view = await render(<DockStylePicker />);
    const chip = within(view.getByTestId('dock-indicator-chip')).getByTestId('dock-preview-chip');
    expect(styleOf(chip).backgroundColor).toBe(chipFill('#1F8A9B'));
    expect(styleOf(chip).borderWidth).toBeUndefined();
  });

  test('under the underline the glyph takes its own ink, not the highlight colour', async () => {
    // Smoked is a dark bar and there is no chip: auto is white.
    const view = await render(<DockStylePicker />);
    const glyph = within(view.getByTestId('dock-indicator-underline')).getByTestId('dock-preview-glyph');
    expect(styleOf(glyph).backgroundColor).toBe('#FFFFFF');
    expect(within(view.getByTestId('dock-indicator-underline')).queryByTestId('dock-preview-spot'))
      .not.toBeNull();
  });

  test('the custom glow-colour tile shows the colour it is offering', async () => {
    state = { ...state, indicator: 'underline', glowColour: '#12AB34' };
    const view = await render(<DockStylePicker />);
    const json = view.toJSON();
    let sub = null;
    const find = (n) => {
      if (!n || typeof n !== 'object' || sub) return;
      if (Array.isArray(n)) { n.forEach(find); return; }
      if (n.props?.testID === 'dock-glow-colour-custom') { sub = n; return; }
      find(n.children);
    };
    find(json);
    expect([...new Set(stops(sub).map((s) => s.colour))]).toEqual(['#12AB34']);
  });
});
