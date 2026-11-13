// Only here because the real palettes live beside the storage-backed
// provider; this file asserts against THOSE rather than against copies, so
// that a retuned background cannot drift away from the navigator's.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import { buildNavTheme } from '../navTheme';
import { DARK_THEME, LIGHT_THEME_COLORS } from '../../context/ThemeContext';

// The light palette is exported as its colours (see ThemeContext) — which is
// all a theme needs to be, here.
const LIGHT_THEME = { colors: LIGHT_THEME_COLORS };

// Stand-ins for react-navigation's own themes: what matters is that whatever
// the library puts in them SURVIVES, not what it happens to contain today.
const BASES = {
  light: {
    dark: false,
    colors: { primary: '#007AFF', background: 'rgb(242, 242, 242)', card: '#fff', text: '#000', border: '#d8d8d8', notification: '#f00' },
    fonts: { regular: { fontFamily: 'System', fontWeight: '400' } },
  },
  dark: {
    dark: true,
    colors: { primary: '#0A84FF', background: 'rgb(1, 1, 1)', card: '#111', text: '#fff', border: '#272729', notification: '#f00' },
    fonts: { regular: { fontFamily: 'System', fontWeight: '400' } },
  },
};

describe('the colour behind the pages', () => {
  test('DARK MODE DOES NOT FLASH PALE — the one this exists for', () => {
    // forTabTurn cross-fades the two pages, so for a few frames what you see
    // is the navigator's background. Left as the library's rgb(242,242,242),
    // every tab change in dark mode blinked light grey.
    const nav = buildNavTheme(true, DARK_THEME, BASES);
    expect(nav.colors.background).toBe(DARK_THEME.colors.background);
    expect(nav.colors.background).not.toBe(BASES.light.colors.background);
    expect(nav.colors.background).not.toBe(BASES.dark.colors.background);
  });

  test('light mode gets the app’s light background, not the library’s', () => {
    const nav = buildNavTheme(false, LIGHT_THEME, BASES);
    expect(nav.colors.background).toBe(LIGHT_THEME.colors.background);
  });

  test('carries the rest of the palette through', () => {
    const nav = buildNavTheme(true, DARK_THEME, BASES);
    expect(nav.colors.card).toBe(DARK_THEME.colors.surface);
    expect(nav.colors.text).toBe(DARK_THEME.colors.textPrimary);
    expect(nav.colors.border).toBe(DARK_THEME.colors.border);
    expect(nav.colors.primary).toBe(DARK_THEME.colors.accent);
    expect(nav.dark).toBe(true);
    expect(buildNavTheme(false, LIGHT_THEME, BASES).dark).toBe(false);
  });

  test('keeps everything the library put in its theme', () => {
    // v7's theme carries `fonts` as well as colours, and a theme missing them
    // crashes at render — three screens away from anything that looks related.
    const nav = buildNavTheme(true, DARK_THEME, BASES);
    expect(nav.fonts).toEqual(BASES.dark.fonts);
    // …including colour keys this app has no opinion about.
    expect(nav.colors.notification).toBe(BASES.dark.colors.notification);
  });

  test('survives being called before anything has loaded', () => {
    // The provider renders null until storage is read, but a navigator built
    // from a half-made theme must still be an object with colours rather than
    // a crash.
    for (const nav of [buildNavTheme(true, undefined, BASES), buildNavTheme(false, {}, undefined)]) {
      expect(nav).toBeTruthy();
      expect(nav.colors).toBeTruthy();
    }
  });
});
