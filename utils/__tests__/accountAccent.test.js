/**
 * The account accent on the wire: what is read, what is sent, and what
 * counts as a change worth sending.
 *
 * The mock is here because the swatch list lives in ThemeContext, which pulls
 * AsyncStorage in at import time — same one-liner accentChoice.test.jsx uses.
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import {
  ACCENT_CUSTOM_SETTING,
  ACCENT_SETTING,
  accentPatch,
  accentSignature,
  isKnownAccent,
  readAccent,
} from '../accountAccent';
import { CUSTOM_ACCENT } from '../../context/ThemeContext';

const me = (settings) => ({ user: { settings } });

describe('readAccent', () => {
  it('reads a preset', () => {
    expect(readAccent(me({ [ACCENT_SETTING]: 'teal' }))).toEqual({ key: 'teal', custom: null });
  });

  it('reads a custom colour, normalised', () => {
    expect(readAccent(me({ [ACCENT_SETTING]: CUSTOM_ACCENT, [ACCENT_CUSTOM_SETTING]: '#AB12CD' })))
      .toEqual({ key: CUSTOM_ACCENT, custom: '#ab12cd' });
  });

  it('refuses custom with no colour behind it', () => {
    expect(readAccent(me({ [ACCENT_SETTING]: CUSTOM_ACCENT }))).toBeNull();
    expect(readAccent(me({ [ACCENT_SETTING]: CUSTOM_ACCENT, [ACCENT_CUSTOM_SETTING]: 'teal' }))).toBeNull();
  });

  it('is null for an account that has never picked, and for junk', () => {
    expect(readAccent(me({}))).toBeNull();
    expect(readAccent(me(null))).toBeNull();
    expect(readAccent(null)).toBeNull();
    expect(readAccent(undefined)).toBeNull();
    expect(readAccent(me({ [ACCENT_SETTING]: 'chartreuse' }))).toBeNull();
  });

  it('never resolves a prototype key', () => {
    expect(isKnownAccent('__proto__', null)).toBe(false);
    expect(isKnownAccent('constructor', null)).toBe(false);
  });
});

describe('accentPatch', () => {
  /** null deletes the key server-side, so a preset never leaves a stale mix. */
  it('clears the custom colour when a preset is chosen', () => {
    expect(accentPatch({ key: 'pink', custom: '#123456' }))
      .toEqual({ [ACCENT_SETTING]: 'pink', [ACCENT_CUSTOM_SETTING]: null });
  });

  it('sends both halves for a custom colour', () => {
    expect(accentPatch({ key: CUSTOM_ACCENT, custom: '#123456' }))
      .toEqual({ [ACCENT_SETTING]: CUSTOM_ACCENT, [ACCENT_CUSTOM_SETTING]: '#123456' });
  });

  /** 'custom' with nothing behind it is not a custom choice. */
  it('falls back to sending the key alone when custom has no colour', () => {
    expect(accentPatch({ key: CUSTOM_ACCENT, custom: null }))
      .toEqual({ [ACCENT_SETTING]: CUSTOM_ACCENT, [ACCENT_CUSTOM_SETTING]: null });
  });
});

describe('accentSignature', () => {
  /**
   * The picker remembers your mixed colour behind a selected preset, so the
   * swatch still shows it. That remembered colour is not part of the choice,
   * and a push triggered by it would be a write with nothing behind it.
   */
  it('ignores a custom colour that is only being remembered', () => {
    expect(accentSignature({ key: 'teal', custom: '#abcdef' }))
      .toBe(accentSignature({ key: 'teal', custom: null }));
  });

  it('separates two different mixed colours', () => {
    expect(accentSignature({ key: CUSTOM_ACCENT, custom: '#aaaaaa' }))
      .not.toBe(accentSignature({ key: CUSTOM_ACCENT, custom: '#bbbbbb' }));
  });

  it('is empty for nothing, so an unloaded theme never pushes', () => {
    expect(accentSignature(null)).toBe('');
    expect(accentSignature({})).toBe('');
  });
});

describe('the wire spelling', () => {
  /**
   * The two apps disagree about hex case. If that reached the wire, each
   * device would read the other's write as a change and answer it.
   */
  it('is lower case whichever app wrote it', () => {
    expect(accentPatch({ key: CUSTOM_ACCENT, custom: '#AB12CD' })[ACCENT_CUSTOM_SETTING])
      .toBe('#ab12cd');
    expect(readAccent(me({ [ACCENT_SETTING]: CUSTOM_ACCENT, [ACCENT_CUSTOM_SETTING]: '#AB12CD' })).custom)
      .toBe('#ab12cd');
  });

  it('makes a colour from either app compare equal', () => {
    // What this phone holds, against what the web stored.
    expect(accentSignature({ key: CUSTOM_ACCENT, custom: '#AB12CD' }))
      .toBe(accentSignature({ key: CUSTOM_ACCENT, custom: '#ab12cd' }));
  });
});
