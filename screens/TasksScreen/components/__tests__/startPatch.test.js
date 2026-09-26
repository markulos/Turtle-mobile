/**
 * Starting a focus block on a task that is sitting under "any time" moves it
 * onto the day's timeline at the minute you started — because the moment you
 * begin working on it, "no time set" is no longer true.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');

import { startPatch } from '../CalendarView';

const at = (h, m) => new Date(2026, 8, 18, h, m, 0);

describe('startPatch', () => {
  test('stamps the hour and minute the block began', () => {
    expect(startPatch({ id: 't' }, '2026-09-18', at(14, 38)))
      .toEqual({ dueDate: '2026-09-18', time: '14:38' });
  });

  // "9:5" is not a time, and the rest of the app parses HH:MM.
  test('pads both halves', () => {
    expect(startPatch({ id: 't' }, '2026-09-18', at(9, 5)).time).toBe('09:05');
    expect(startPatch({ id: 't' }, '2026-09-18', at(0, 0)).time).toBe('00:00');
  });

  // A task you deliberately put at 4 pm and started early keeps its 4 pm. This
  // guard is also what makes it a FIRST-block behaviour without counting
  // blocks: after the first, the task is timed and a second start finds
  // nothing to set.
  test('leaves a task that already has a time alone', () => {
    expect(startPatch({ id: 't', time: '16:00' }, '2026-09-18', at(14, 38))).toBeNull();
  });

  // An untimed task can also be an undated one — the backlog. A time with no
  // day is not a place on any timeline, so the day rides along.
  test('carries the day, so an undated task lands somewhere real', () => {
    expect(startPatch({ id: 't' }, '2026-09-18', at(7, 0)).dueDate).toBe('2026-09-18');
  });

  test('has nothing to say about a task that is not there', () => {
    expect(startPatch(null, '2026-09-18', at(7, 0))).toBeNull();
    expect(startPatch(undefined, '2026-09-18')).toBeNull();
  });

  test('takes a timestamp as readily as a Date', () => {
    expect(startPatch({ id: 't' }, '2026-09-18', at(14, 38).getTime()).time).toBe('14:38');
  });
});
