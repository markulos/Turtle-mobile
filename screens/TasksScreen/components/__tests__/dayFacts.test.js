// The second line of the panel header: the board, then the shape of the day
// it is showing. Importing CalendarView pulls its whole graph (contexts,
// gesture handler, icons), so the native-backed modules are stubbed — this is
// a pure counter.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');

import { dayFacts } from '../CalendarView';

describe('dayFacts', () => {
  test('counts the day and how much of it is behind you', () => {
    expect(dayFacts(5, 3)).toEqual(['5 tasks', '2 done']);
  });

  // A day nobody has started is just a day of tasks — "0 done" is a fact
  // worth nothing.
  test('says nothing about done until something is', () => {
    expect(dayFacts(5, 5)).toEqual(['5 tasks']);
  });

  // The arithmetic stops being the point once there is nothing left.
  test('a finished day says so, rather than repeating the total', () => {
    expect(dayFacts(5, 0)).toEqual(['5 tasks', 'all done']);
    expect(dayFacts(1, 0)).toEqual(['1 task', 'all done']);
  });

  test('one task is a task', () => {
    expect(dayFacts(1, 1)).toEqual(['1 task']);
  });

  // "0 tasks · 0 done" reads as a broken count, not as a clear day.
  test('an empty day says it is empty', () => {
    expect(dayFacts(0, 0)).toEqual(['nothing planned']);
  });

  // The two counts come from separate filters (one of them per-occurrence), so
  // a momentary disagreement between them must not produce "5 tasks · -1 done".
  test('cannot be talked into a negative or a count past the total', () => {
    expect(dayFacts(3, 7)).toEqual(['3 tasks']);
    expect(dayFacts(-2, 0)).toEqual(['nothing planned']);
    expect(dayFacts(undefined, undefined)).toEqual(['nothing planned']);
  });
});
