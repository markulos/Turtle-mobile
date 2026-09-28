/**
 * The custom highlight-colour sheet.
 *
 * What is worth testing here is the WIRING between its two ways in — the three
 * sliders and the hex field write one colour, and the colour it hands back has
 * to be the one on the preview. The drag itself is a PanResponder and belongs on
 * a device; `fractionAt` is exported and tested directly instead, because it is
 * the line that decides whether the colour under the thumb is the colour under
 * the finger.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
}));
jest.mock('../../utils/haptics', () => ({
  impactHaptic: jest.fn(),
  markGesture: jest.fn(),
}));
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      mode: 'dark',
      colors: new Proxy({ background: '#000000' }, {
        get: (t, k) => (k in t ? t[k] : '#888888'),
      }),
    },
  }),
}));

import AccentColorPicker, { fractionAt } from '../AccentColorPicker';

const open = (props = {}) =>
  render(
    <AccentColorPicker
      visible
      initialColor="#F97316"
      onSelect={jest.fn()}
      onClose={jest.fn()}
      {...props}
    />,
  );

describe('fractionAt', () => {
  test('a touch maps to where it landed on the track', () => {
    expect(fractionAt(0, 200)).toBe(0);
    expect(fractionAt(100, 200)).toBe(0.5);
    expect(fractionAt(200, 200)).toBe(1);
  });

  test('past either end it clamps, so a drag off the track parks at the end', () => {
    expect(fractionAt(-40, 200)).toBe(0);
    expect(fractionAt(999, 200)).toBe(1);
  });

  test('an unmeasured track reads 0, never NaN', () => {
    // A NaN reaches `left` and RN drops the thumb out of the row silently.
    expect(fractionAt(50, 0)).toBe(0);
    expect(Number.isNaN(fractionAt(50, 0))).toBe(false);
  });
});

describe('AccentColorPicker', () => {
  test('nothing is mounted while it is closed', async () => {
    await open({ visible: false });
    expect(screen.queryByText('Custom colour')).toBeNull();
  });

  test('it opens on the colour it was given, in hex and in the three sliders', async () => {
    await open({ initialColor: '#F97316' });
    expect(screen.getByLabelText('Highlight colour hex code').props.value).toBe('#F97316');
    // Orange: ~25°, high saturation, mid lightness.
    expect(screen.getByLabelText('Hue').props.accessibilityValue).toEqual({ min: 0, max: 360, now: 25 });
    expect(screen.getByLabelText('Saturation').props.accessibilityValue.now).toBeGreaterThan(80);
    expect(screen.getByLabelText('Lightness').props.accessibilityValue.now).toBeCloseTo(53, 0);
  });

  test('a typed hex moves the sliders with it', async () => {
    await open();
    const field = screen.getByLabelText('Highlight colour hex code');
    await act(async () => { fireEvent.changeText(field, '#F9A8D4'); });
    const hue = screen.getByLabelText('Hue').props.accessibilityValue.now;
    expect(hue).toBeGreaterThan(300);
    expect(screen.getByLabelText('Lightness').props.accessibilityValue.now).toBeGreaterThan(75);
  });

  test('a half-typed hex is left alone and does not move anything', async () => {
    await open();
    const field = screen.getByLabelText('Highlight colour hex code');
    await act(async () => { fireEvent.changeText(field, '#F9'); });
    // The caret's text stands, but the colour is still the one it opened on.
    expect(screen.getByLabelText('Highlight colour hex code').props.value).toBe('#F9');
    expect(screen.getByLabelText('Hue').props.accessibilityValue.now).toBe(25);
  });

  test('Use this colour hands back the hex, normalized, then closes', async () => {
    const onSelect = jest.fn();
    const onClose = jest.fn();
    await open({ onSelect, onClose });
    const field = screen.getByLabelText('Highlight colour hex code');
    // Lower case and no hash, the way a paste arrives.
    await act(async () => { fireEvent.changeText(field, 'f9a8d4'); });
    // It slides out BEFORE it reports, so the exit animation has to run down
    // inside the act — awaiting one is what lets the Animated callback land.
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Use this colour as the highlight colour'));
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    expect(onSelect).toHaveBeenCalledWith('#F9A8D4');
    expect(onClose).toHaveBeenCalled();
  });

  test('Cancel reports nothing', async () => {
    const onSelect = jest.fn();
    const onClose = jest.fn();
    await open({ onSelect, onClose });
    await act(async () => { fireEvent.press(screen.getByText('Cancel')); });
    expect(onSelect).not.toHaveBeenCalled();
  });

  // The whole point of the note: a highlight colour draws LINK TEXT, so one that
  // cannot be read on the page has to say so at the moment it is chosen.
  test('it warns about a colour too faint for the page it will draw on', async () => {
    await open({ initialColor: '#111111' }); // near-black, and this theme is dark
    expect(screen.getByText(/faint against this page/i)).toBeTruthy();

    await act(async () => {
      fireEvent.changeText(screen.getByLabelText('Highlight colour hex code'), '#F9A8D4');
    });
    expect(screen.queryByText(/faint against this page/i)).toBeNull();
  });
});
