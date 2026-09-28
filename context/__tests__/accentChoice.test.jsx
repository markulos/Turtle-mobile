/**
 * The highlight colour: the presets, the user's own, and what survives a restart.
 *
 * The two failures this pins are both invisible until someone relaunches the
 * app: a 'custom' accent restored with no colour behind it (the app would wear
 * whatever accentColorFor fell back to and the swatch row would show a ring on a
 * blank disc), and a chosen colour that reaches `theme.colors` but never reaches
 * storage.
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import React from 'react';
import { Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ACCENTS, CUSTOM_ACCENT, DEFAULT_ACCENT, ThemeProvider, useTheme } from '../ThemeContext';

const ACCENT_KEY = '@connected_pass_accent';
const CUSTOM_KEY = '@connected_pass_accent_custom';

// A probe rather than renderHook: the provider renders null until it has read
// storage, so the thing under test only exists once a child of it has mounted.
let api;
function Probe() {
  api = useTheme();
  return <Text testID="live">{api.accentColor}</Text>;
}

const mount = async () => {
  await render(<ThemeProvider><Probe /></ThemeProvider>);
  return screen.findByTestId('live');
};

beforeEach(async () => {
  api = undefined;
  await AsyncStorage.clear();
});

describe('the presets', () => {
  test('light pink is one of them, and every swatch is a renderable colour', () => {
    expect(ACCENTS.map((a) => a.key)).toContain('lightPink');
    for (const a of ACCENTS) {
      expect(a.color).toMatch(/^#[0-9A-F]{6}$/i);
      expect(a.label.length).toBeGreaterThan(0);
    }
  });

  test('no key is used twice — the swatch row keys off it and a ring would double up', () => {
    const keys = ACCENTS.map((a) => a.key).concat(CUSTOM_ACCENT);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('choosing a preset', () => {
  test('it lands on the palette and in storage', async () => {
    await mount();
    await act(async () => { await api.setAccent('lightPink'); });
    expect(api.accent).toBe('lightPink');
    expect(api.theme.colors.accent).toBe('#F9A8D4');
    // The token the existing screens already draw links and active chips with.
    expect(api.theme.colors.accentInfo).toBe('#F9A8D4');
    expect(await AsyncStorage.getItem(ACCENT_KEY)).toBe('lightPink');
  });

  test('a key nobody has heard of falls back rather than blanking the accent', async () => {
    await mount();
    await act(async () => { await api.setAccent('chartreuse'); });
    expect(api.accent).toBe(DEFAULT_ACCENT);
  });
});

describe('the custom colour', () => {
  test('one call takes the colour AND selects it', async () => {
    await mount();
    await act(async () => { await api.setCustomAccent('f9a8d4'); });
    expect(api.accent).toBe(CUSTOM_ACCENT);
    expect(api.customAccent).toBe('#F9A8D4');
    expect(api.accentColor).toBe('#F9A8D4');
    expect(api.theme.colors.accentInfo).toBe('#F9A8D4');
    // The rules take a wash of it too, which is what carries the choice to
    // every hairline in the app.
    expect(api.theme.colors.border).toMatch(/^rgba\(249, 168, 212, /);
    expect(await AsyncStorage.getItem(CUSTOM_KEY)).toBe('#F9A8D4');
    expect(await AsyncStorage.getItem(ACCENT_KEY)).toBe(CUSTOM_ACCENT);
  });

  test('a non-colour changes nothing', async () => {
    await mount();
    await act(async () => { await api.setCustomAccent('#F9'); });
    expect(api.accent).toBe(DEFAULT_ACCENT);
    expect(api.customAccent).toBeNull();
    expect(await AsyncStorage.getItem(ACCENT_KEY)).toBeNull();
  });

  test('a preset can be picked again, and the custom colour is still remembered', async () => {
    await mount();
    await act(async () => { await api.setCustomAccent('#F9A8D4'); });
    await act(async () => { await api.setAccent('teal'); });
    expect(api.accentColor).toBe('#14B8A6');
    // Still there, so the custom swatch keeps showing what it was.
    expect(api.customAccent).toBe('#F9A8D4');
  });

  test('it comes back after a restart', async () => {
    await AsyncStorage.setItem(CUSTOM_KEY, '#F9A8D4');
    await AsyncStorage.setItem(ACCENT_KEY, CUSTOM_ACCENT);
    await mount();
    expect(api.accent).toBe(CUSTOM_ACCENT);
    expect(api.accentColor).toBe('#F9A8D4');
  });

  test("'custom' with no colour behind it is not an accent", async () => {
    // The half-written pair: a store that took the key and lost the colour.
    await AsyncStorage.setItem(ACCENT_KEY, CUSTOM_ACCENT);
    await mount();
    expect(api.accent).toBe(DEFAULT_ACCENT);
    expect(api.customAccent).toBeNull();
  });

  test('and neither is asking for it before one has been mixed', async () => {
    await mount();
    await act(async () => { await api.setAccent(CUSTOM_ACCENT); });
    expect(api.accent).toBe(DEFAULT_ACCENT);
  });

  test('a stored colour that is not a colour is dropped, not trusted', async () => {
    await AsyncStorage.setItem(CUSTOM_KEY, 'lavender');
    await AsyncStorage.setItem(ACCENT_KEY, CUSTOM_ACCENT);
    await mount();
    expect(api.accent).toBe(DEFAULT_ACCENT);
  });
});
