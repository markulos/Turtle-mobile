/**
 * Light, dark, and following the phone.
 *
 * The auto mode is auto by DELEGATION — the OS already reads the sensor and
 * knows the real sunset at your latitude, and pushes a new value when it
 * flips. So what there is to test here is the wiring: that the answer tracks
 * the system while 'system' is chosen, that it STOPS tracking the moment you
 * pin one, and that the choice survives a relaunch.
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

let scheme = 'dark';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme(),
}));
global.mockScheme = () => scheme;

import React from 'react';
import { Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  THEME_MODES, DEFAULT_THEME_MODE, ThemeProvider, useTheme,
} from '../ThemeContext';

const THEME_KEY = '@connected_pass_theme';

let api;
function Probe() {
  api = useTheme();
  return <Text testID="live">{api.isDark ? 'dark' : 'light'}</Text>;
}

const mount = async () => {
  await render(<ThemeProvider><Probe /></ThemeProvider>);
  return screen.findByTestId('live');
};

beforeEach(async () => {
  api = undefined;
  scheme = 'dark';
  await AsyncStorage.clear();
});

describe('the appearance mode', () => {
  test('the three modes include the auto one, and the default is a real mode', () => {
    expect(THEME_MODES).toEqual(expect.arrayContaining(['system', 'light', 'dark']));
    expect(THEME_MODES).toContain(DEFAULT_THEME_MODE);
  });

  test('following the phone: the answer is whatever the system says', async () => {
    scheme = 'light';
    await mount();
    await act(async () => { await api.setThemeMode('system'); });
    expect(api.isDark).toBe(false);
    expect(screen.getByTestId('live').props.children).toBe('light');
  });

  test('a pinned mode IGNORES the phone — that is what pinning is', async () => {
    scheme = 'light';
    await mount();
    await act(async () => { await api.setThemeMode('dark'); });
    expect(api.isDark).toBe(true);

    scheme = 'dark';
    await act(async () => { await api.setThemeMode('light'); });
    expect(api.isDark).toBe(false);
  });

  test('the choice survives a relaunch', async () => {
    await mount();
    await act(async () => { await api.setThemeMode('system'); });
    expect(await AsyncStorage.getItem(THEME_KEY)).toBe('system');

    // …and the old boolean values still read: 'dark' and 'light' were always
    // the two things written to this key, so nobody's setting is lost.
    await AsyncStorage.setItem(THEME_KEY, 'light');
    api = undefined;
    await mount();
    expect(api.themeMode).toBe('light');
    expect(api.isDark).toBe(false);
  });

  test('a stored mode this build does not know falls back rather than breaking', async () => {
    await AsyncStorage.setItem(THEME_KEY, 'sepia');
    await mount();
    expect(THEME_MODES).toContain(api.themeMode);
  });

  test('the old switch still works, and pins the opposite of what you see', async () => {
    scheme = 'dark';
    await mount();
    await act(async () => { await api.setThemeMode('system'); });
    expect(api.isDark).toBe(true);

    // The only reason to flip a switch you are watching is to disagree with
    // what it shows — so toggling leaves auto rather than staying in it.
    await act(async () => { await api.toggleTheme(); });
    expect(api.isDark).toBe(false);
    expect(api.themeMode).toBe('light');
  });

  test('a phone that reports nothing does not drop the app into light', async () => {
    // Older Androids and a simulator mid-launch both answer null here.
    scheme = null;
    await mount();
    await act(async () => { await api.setThemeMode('system'); });
    expect(api.isDark).toBe(DEFAULT_THEME_MODE === 'dark');
  });
});
