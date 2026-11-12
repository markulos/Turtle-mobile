import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

import { PILL_SIZE } from '../tabBarLayout';
import { CHIP_SHADE, CHIP_SHEEN } from '../chipRecess';

const ACCENT = '#1F8A9B';

jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({
    theme: { mode: 'dark', colors: { accent: '#1F8A9B' } },
    dockIndicator: mockIndicator(),
  }),
}));

// Which indicator Settings is on, swapped per test. A function rather than a
// let, because the mock factory is hoisted above everything else in the file.
let indicator = 'chip';
global.mockIndicator = () => indicator;

jest.mock('expo-blur', () => ({ BlurView: () => null }));

// The real gradient is a native view; what this file cares about is the stops
// it was handed and the box it was given to paint them in.
jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');
  return { LinearGradient: (props) => <View {...props} /> };
});

jest.mock('@react-navigation/native', () => ({
  useNavigationState: (selector) => selector({ index: 2, routes: new Array(5).fill({}) }),
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

beforeEach(() => { indicator = 'chip'; });

describe('the dock chip reads as CUT INTO the capsule', () => {
  test('carries no drop shadow — the thing that made it look like a raised tile', async () => {
    const { getByTestId } = await render(<TabBarPill />);
    // A shadow offset DOWN from an opaque square is the signature of an object
    // resting on a surface; it is why the chip read as bevelled outward. If
    // this ever comes back, so does the bug — no matter what else is drawn.
    for (const id of ['dock-chip', 'dock-chip-face', 'dock-chip-lip']) {
      const s = styleOf(getByTestId(id));
      expect(s.shadowOpacity || 0).toBe(0);
      expect(s.elevation || 0).toBe(0);
    }
  });

  test('is shadowed along its TOP edge and lit along its BOTTOM one', async () => {
    const { getByTestId } = await render(<TabBarPill />);
    const shade = getByTestId('dock-chip-shade');
    const sheen = getByTestId('dock-chip-sheen');

    // Anchored to opposite edges. Swapped, this is a dome: lit on top and
    // shadowed underneath, which is exactly the protruding look it replaces.
    expect(styleOf(shade).top).toBe(0);
    expect(styleOf(shade).bottom).toBeUndefined();
    expect(styleOf(sheen).bottom).toBe(0);
    expect(styleOf(sheen).top).toBeUndefined();

    // Black at the top edge fading to nothing; white at the bottom edge, same.
    expect(shade.props.colors[0]).toBe(`rgba(0,0,0,${CHIP_SHADE.a})`);
    expect(shade.props.colors[shade.props.colors.length - 1]).toBe('rgba(0,0,0,0)');
    expect(sheen.props.colors[0]).toBe('rgba(255,255,255,0)');
    expect(sheen.props.colors[sheen.props.colors.length - 1])
      .toBe(`rgba(255,255,255,${CHIP_SHEEN.a})`);

    // Neither band fills the chip: the middle stays the accent, which is what
    // the eye tracks as the chip travels.
    expect(styleOf(shade).height + styleOf(sheen).height).toBeLessThan(PILL_SIZE);
  });

  test('the lip is the same squircle, one point lower, so only its bottom shows', async () => {
    const { getByTestId } = await render(<TabBarPill />);
    const face = styleOf(getByTestId('dock-chip-face'));
    const lip = styleOf(getByTestId('dock-chip-lip'));

    // Dropped by a point or so and no more: any further and the ridge stops
    // being an edge and becomes a second shape sitting under the chip.
    expect(lip.top).toBeGreaterThan(0);
    expect(lip.top).toBeLessThanOrEqual(2);
    expect(lip.height).toBe(PILL_SIZE);
    // Same corner, or the ridge crosses the chip's own curve at the bottom
    // corners instead of hugging it.
    expect(lip.borderRadius).toBe(face.borderRadius);
    expect(lip.borderCurve).toBe('continuous');
    // Light, and far weaker than the face it sits under.
    expect(lip.backgroundColor).toMatch(/^rgba\(255,255,255,0\.\d+\)$/);
  });

  test('the face carries the accent and a dark groove where it meets the capsule', async () => {
    const { getByTestId } = await render(<TabBarPill />);
    const face = styleOf(getByTestId('dock-chip-face'));

    expect(face.backgroundColor).toBe(ACCENT);
    expect(face.borderWidth).toBe(StyleSheet.hairlineWidth);
    expect(face.borderColor).toMatch(/^rgba\(0,0,0,0\.\d+\)$/);
    // The washes are clipped to the squircle rather than cutting its corners.
    expect(face.overflow).toBe('hidden');
    expect(face.borderCurve).toBe('continuous');
  });

  test('the underline treatment is untouched by any of it', async () => {
    indicator = 'underline';
    const { getByTestId, queryByTestId } = await render(<TabBarPill />);

    // A 3pt line has no inside to be recessed and nothing to cast a ridge; it
    // is ON the capsule, and it still takes the accent itself.
    expect(styleOf(getByTestId('dock-underline')).backgroundColor).toBe(ACCENT);
    expect(queryByTestId('dock-chip')).toBeNull();
    expect(queryByTestId('dock-chip-lip')).toBeNull();
    expect(queryByTestId('dock-chip-shade')).toBeNull();
  });
});
