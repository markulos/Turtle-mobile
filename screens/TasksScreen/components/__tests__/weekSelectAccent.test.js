/**
 * The week strip's selected-day pill, and the hatch that marks today, follow the
 * HIGHLIGHT COLOUR chosen in Settings.
 *
 * These were a fixed amber (#F5A623) — the loudest mark in the planner, and the
 * one thing that kept saying "orange" after someone had chosen violet, which is
 * what made the setting feel like a decoration rather than a preference.
 *
 * Two things are pinned, and the second is the one that breaks quietly: the fill
 * follows the accent, and the INK follows the FILL. A fixed dark ink was fine on
 * amber and unreadable on a deep blue; a fixed white is unreadable on the light
 * pink. Only a derived ink survives every accent, including one the user mixed.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');

const { weekSelectBg, weekSelectInk } = require('../CalendarView');
const { contrastRatio, INK_DARK, INK_LIGHT } = require('../../../../utils/accentColor');

const themed = (accent) => ({ colors: { accent } });

// Every preset in Settings → Appearance, plus the extremes a mixed colour can
// reach. The pale end is the point: it is what a fixed white ink dies on.
const ACCENTS = [
  '#F97316', '#3B82F6', '#22C55E', '#8B5CF6', '#EC4899',
  '#F9A8D4', '#F59E0B', '#14B8A6', '#EF4444',
  '#FFFFFF', '#000000', '#FFFF00', '#1A1A1A',
];

describe('the selected day takes the chosen highlight colour', () => {
  test('the pill is the accent', () => {
    expect(weekSelectBg(themed('#8B5CF6'))).toBe('#8B5CF6');
    expect(weekSelectBg(themed('#F9A8D4'))).toBe('#F9A8D4');
  });

  test('it no longer answers with the amber it used to be pinned to', () => {
    expect(weekSelectBg(themed('#3B82F6'))).not.toBe('#F5A623');
  });

  // A palette with no accent at all (an older theme object, a partial palette
  // passed down to a sub-surface) must still paint a visible pill.
  test('a palette without an accent still has a colour, never undefined', () => {
    expect(weekSelectBg(themed(undefined))).toBe('#F5A623');
    expect(weekSelectBg({ colors: {} })).toBe('#F5A623');
    expect(weekSelectBg(undefined)).toBe('#F5A623');
  });
});

describe('the date on the pill stays readable on every accent', () => {
  test('the ink is one of the two, and always the better of them', () => {
    for (const accent of ACCENTS) {
      const ink = weekSelectInk(themed(accent));
      expect([INK_LIGHT, INK_DARK]).toContain(ink);
      const other = ink === INK_LIGHT ? INK_DARK : INK_LIGHT;
      expect(contrastRatio(accent, ink)).toBeGreaterThanOrEqual(contrastRatio(accent, other));
    }
  });

  // 3:1 is WCAG's floor for large text; the date on the pill is 17pt bold.
  test('every accent clears the large-text contrast floor', () => {
    for (const accent of ACCENTS) {
      expect(contrastRatio(accent, weekSelectInk(themed(accent)))).toBeGreaterThanOrEqual(3);
    }
  });

  test('a pale accent flips the ink dark — the case a fixed white would lose', () => {
    expect(weekSelectInk(themed('#F9A8D4'))).toBe(INK_DARK);
    expect(weekSelectInk(themed('#FFFFFF'))).toBe(INK_DARK);
  });

  test('a deep accent keeps it white — the case a fixed dark ink would lose', () => {
    expect(weekSelectInk(themed('#8B5CF6'))).toBe(INK_LIGHT);
    expect(weekSelectInk(themed('#000000'))).toBe(INK_LIGHT);
  });
});
