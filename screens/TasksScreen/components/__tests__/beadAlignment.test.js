/**
 * The day planner's timeline bead must sit level with the time it belongs to.
 *
 * The bead is absolutely positioned inside the card's wrapper; the time label
 * is laid out by ScheduleCard in its own column. Nothing in the layout makes
 * those two agree — the bead's `top` was a hand-tuned 12 against a label whose
 * line box centres at 24.5, so every dot floated 7 pt above its time. This is
 * the arithmetic that keeps them together, and it is arithmetic precisely so
 * that changing the label's padding or leading can't silently break it again.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');

const { TIME_LABEL_CENTER_Y } = require('../ScheduleCard');
const { BEAD, BEAD_TOP_CARD } = require('../CalendarView');

describe('the timeline bead and its time label', () => {
  test('share a centre line, to within a rounded pixel', () => {
    const beadCentre = BEAD_TOP_CARD + BEAD / 2;
    expect(Math.abs(beadCentre - TIME_LABEL_CENTER_Y)).toBeLessThanOrEqual(0.5);
  });

  test('the bead is on the card\'s FIRST line, not its middle', () => {
    // Centring on the card would put 9am's bead level with about 9:40 — the
    // card is a fixed height whatever the task's duration.
    expect(BEAD_TOP_CARD + BEAD).toBeLessThan(40);
  });

  test('the old hand-tuned value is what this replaces', () => {
    // Guards the direction of the fix: 12 is the number that was wrong.
    expect(BEAD_TOP_CARD).not.toBe(12);
    expect(BEAD_TOP_CARD).toBe(19);
  });
});
