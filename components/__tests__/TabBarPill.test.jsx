import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

import { BAR_CONTENT_HEIGHT } from '../tabBarLayout';
import { dockSkin } from '../dockSkins';

const ACCENT = '#1F8A9B';

jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({
    theme: { mode: 'dark', colors: { accent: '#1F8A9B' } },
    dockIndicator: mockSettings().indicator,
    dockStyle: mockSettings().style,
    dockGlow: mockSettings().glow,
    dockGlowColor: mockSettings().glowColour,
  }),
}));

// What Settings is set to, swapped per test. A function rather than a let,
// because the mock factory is hoisted above everything else in the file.
let indicator = 'chip';
let style = 'smoked';
global.mockSettings = () => ({ indicator, style, glow: glowLevel, glowColour });

jest.mock('expo-blur', () => ({ BlurView: () => null }));

// The glow is a vector. Virtual, because the desktop mirror this also runs on
// has no react-native-svg installed; the box, and the phone, have the real one.
jest.mock('react-native-svg', () => {
  const ReactLib = require('react');
  const { View } = require('react-native');
  const Part = (props) => ReactLib.createElement(View, props);
  return {
    __esModule: true, default: Part, Defs: Part, Ellipse: Part, RadialGradient: Part, Stop: Part,
  };
}, { virtual: true });

let glowLevel;
let glowColour;

// The real gradient is a native view; what this file cares about is the stops
// it was handed and the box it was given to paint them in.
jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');
  return { LinearGradient: (props) => <View {...props} /> };
});

jest.mock('@react-navigation/native', () => ({
  useNavigationState: (selector) => selector({ index: 2, routes: new Array(5).fill({}) }),
  // The pill reads the navigator's live state when the index commits.
  NavigationHelpersContext: require('react').createContext({
    getState: () => ({ index: 2, routes: new Array(5).fill({}) }),
  }),
}));

jest.mock('react-native-reanimated', () => {
  const mock = require('react-native-reanimated/mock');
  return {
    ...mock,
    Easing: { bezier: () => ({ factory: () => (t) => t }) },
    useSharedValue: (init) => ({ value: init }),
    useAnimatedStyle: (fn) => fn(),
  };
});

import TabBarPill from '../TabBarPill';

/** Every style on a node, flattened the way the renderer sees it. */
const styleOf = (node) => StyleSheet.flatten(node.props.style) || {};

/** 'rgba(r,g,b,a)' → the four numbers. */
const parse = (css) => {
  const m = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(css);
  if (!m) throw new Error(`not an rgba string: ${css}`);
  return { r: +m[1], g: +m[2], b: +m[3], a: +m[4] };
};

beforeEach(() => { indicator = 'chip'; style = 'smoked'; glowLevel = undefined; glowColour = undefined; });

describe('the dock capsule reads as a channel CUT INTO the page', () => {
  test('the wash is painted top-to-bottom, darkest at the top edge', async () => {
    const { getByTestId } = await render(<TabBarPill />);
    const wash = getByTestId('dock-wash');

    // Direction is declared, not defaulted — the whole element is its
    // direction, and the default is not guaranteed to be vertical.
    expect(wash.props.start).toEqual({ x: 0, y: 0 });
    expect(wash.props.end).toEqual({ x: 0, y: 1 });

    // Lit from above is a BULGE. This has to be the other way round: the first
    // stop is the heaviest ink and the last the lightest.
    const first = parse(wash.props.colors[0]);
    const last = parse(wash.props.colors[wash.props.colors.length - 1]);
    expect(first.a).toBeGreaterThan(last.a);
    expect(first.r).toBeLessThan(last.r);
  });

  test('a lit hairline runs along the INSIDE of the bottom edge', async () => {
    const { getByTestId } = await render(<TabBarPill />);
    const lip = styleOf(getByTestId('dock-lip'));

    expect(lip.bottom).toBe(0);
    expect(lip.top).toBeUndefined();
    expect(lip.height).toBeLessThanOrEqual(2);
    // Full width, NOT inset by the corner radius: it is clipped to the
    // capsule's shape by the card's own overflow, which is what carries it up
    // into the rounded ends. Inset instead and it stops short of both.
    expect(lip.left).toBe(0);
    expect(lip.right).toBe(0);
    expect(parse(lip.backgroundColor)).toMatchObject({ r: 255, g: 255, b: 255 });
  });

  test('the lip is brighter than the bezel it sits inside', async () => {
    const { getByTestId } = await render(<TabBarPill />);
    const lip = parse(styleOf(getByTestId('dock-lip')).backgroundColor);
    const card = styleOf(getByTestId('dock-card'));
    const bezel = parse(card.borderColor);

    // The capsule, not some other rounded box: radius is half its height.
    expect(card.borderRadius).toBe(BAR_CONTENT_HEIGHT / 2);

    // A bright rim all the way round — the top edge included — is a lit object
    // resting on the page. Only the floor of the cut catches the light.
    expect(lip.a).toBeGreaterThan(bezel.a);
    expect(card.overflow).toBe('hidden');
  });

  test('the travelling chip is untouched — it still rests ON the capsule', async () => {
    const { getByTestId } = await render(<TabBarPill />);
    const chip = styleOf(getByTestId('dock-chip'));

    // The recess belongs to the backdrop. The chip is the one thing in the
    // dock that IS raised, and its shadow is what says so.
    expect(chip.backgroundColor).toBe(ACCENT);
    expect(chip.shadowOpacity).toBeGreaterThan(0);
    expect(chip.shadowOffset).toEqual({ width: 0, height: 2 });
  });

  test('a different skin repaints the capsule — all of it, from the skin', async () => {
    style = 'paper';
    const paper = dockSkin('paper');
    const { getByTestId, queryByTestId } = await render(<TabBarPill />);

    expect(styleOf(getByTestId('dock-card')).borderColor).toBe(paper.edge);
    expect(getByTestId('dock-wash').props.colors).toEqual(paper.wash.colors);
    // Paper describes no depth, so there is no floor to light. The lip must be
    // ABSENT rather than drawn in a colour nobody can see — a white hairline
    // left on a white bar is the kind of thing that survives a review.
    expect(queryByTestId('dock-lip')).toBeNull();
  });

  test('the underline treatment still takes the accent', async () => {
    indicator = 'underline';
    const { getByTestId, queryByTestId } = await render(<TabBarPill />);
    expect(styleOf(getByTestId('dock-underline')).backgroundColor).toBe(ACCENT);
    expect(queryByTestId('dock-chip')).toBeNull();
    // The capsule's recess is not an indicator treatment — it is there either way.
    expect(queryByTestId('dock-lip')).not.toBeNull();
  });
});

describe('the indicator\'s glow', () => {
  // Every colour the glow's gradient stops are drawn in, under one test id.
  const glowColours = (view, id) => {
    const found = [];
    const walk = (node, inside) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach((n) => walk(n, inside)); return; }
      const here = inside || node.props?.testID === id;
      if (here && node.props?.stopColor) found.push(node.props.stopColor);
      walk(node.children, here);
    };
    walk(view.toJSON(), false);
    return [...new Set(found)];
  };

  test('the spot is the highlight colour by default — on a LIGHT dock too', async () => {
    indicator = 'underline';
    style = 'paper';
    const view = await render(<TabBarPill />);
    expect(view.queryByTestId('dock-spot')).not.toBeNull();
    const colours = glowColours(view, 'dock-spot');
    expect(colours).toHaveLength(1);
    expect(colours[0]).not.toBe('#12AB34');
  });

  test('a colour picked in Settings recolours the spot and the chip\'s rim — never its shade', async () => {
    glowColour = '#12AB34';
    indicator = 'underline';
    const line = await render(<TabBarPill />);
    expect(glowColours(line, 'dock-spot')).toEqual(['#12AB34']);
    await line.unmount();

    indicator = 'chip';
    const chip = await render(<TabBarPill />);
    expect(glowColours(chip, 'dock-chip-shade')).toEqual(['#000000']);
    expect(StyleSheet.flatten(chip.getByTestId('dock-chip').props.style).borderColor)
      .toBe('rgba(18,171,52,0.4)');
  });

  test('the chip is DARKER in its middle, not lighter — glass set in, not a dome', async () => {
    const chip = await render(<TabBarPill />);
    expect(glowColours(chip, 'dock-chip-shade')).toEqual(['#000000']);
  });

  test('the underline has a spot and no bloom', async () => {
    indicator = 'underline';
    const dark = await render(<TabBarPill />);
    expect(dark.queryByTestId('dock-spot')).not.toBeNull();
    // One radial gradient, as a vector — not a staircase of bands.
    expect(dark.queryByTestId('dock-spot-glow')).not.toBeNull();
    expect(dark.queryByTestId('dock-chip-shade')).toBeNull();
  });

  test('the chip has a shade in its middle and a translucent ridge round its edge', async () => {
    const view = await render(<TabBarPill />);
    expect(view.queryByTestId('dock-chip-shade')).not.toBeNull();
    expect(view.queryByTestId('dock-spot')).toBeNull();
    const chip = StyleSheet.flatten(view.getByTestId('dock-chip').props.style);
    expect(chip.borderWidth).toBe(1);
    expect(chip.borderColor).toMatch(/^rgba\(255,255,255,0\.\d+\)$/);
  });

  test('the underline has no ridge — a line with a border is just a thicker line', async () => {
    indicator = 'underline';
    const view = await render(<TabBarPill />);
    const line = StyleSheet.flatten(view.getByTestId('dock-underline').props.style);
    expect(line.borderWidth).toBeUndefined();
  });

  test('Off in Settings removes the glow from both, and leaves the indicator', async () => {
    glowLevel = 0;
    const chip = await render(<TabBarPill />);
    expect(chip.queryByTestId('dock-chip-shade')).toBeNull();
    expect(chip.queryByTestId('dock-chip')).not.toBeNull();
    await chip.unmount();

    indicator = 'underline';
    const line = await render(<TabBarPill />);
    expect(line.queryByTestId('dock-spot')).toBeNull();
    expect(line.queryByTestId('dock-underline')).not.toBeNull();
  });
});
