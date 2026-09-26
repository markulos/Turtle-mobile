/**
 * What colours a task in the calendar. It used to be PRIORITY, which made a
 * month of ordinary tasks one undifferentiated block of orange and said
 * nothing about the thing you actually scan a calendar for — which part of
 * life a day belongs to. It's the board now, and the order it resolves in is
 * the feature.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');

const { pillColor, boardTint } = require('../CalendarView');

const theme = { colors: { textTertiary: '#9E9E9E' } };
// The screen's palette: position in the board list, same as the rail and the
// agenda's cards read.
const boardColor = (name) => ({ Church: '#4CAF50', Work: '#2979FF' }[name] || '#607D8B');

describe('boardTint', () => {
  test('"no board" is all three of its spellings', () => {
    for (const project of [undefined, '', 'No Project']) {
      expect(boardTint({ id: 't', project }, boardColor)).toBeNull();
    }
  });

  test('a real board answers with the screen\'s colour for it', () => {
    expect(boardTint({ project: 'Church' }, boardColor)).toBe('#4CAF50');
  });

  test('no resolver at all is not a crash', () => {
    expect(boardTint({ project: 'Church' }, undefined)).toBeNull();
  });
});

describe('pillColor', () => {
  test('the board decides — priority no longer enters into it', () => {
    const high = { project: 'Church', priority: 'high' };
    const low = { project: 'Church', priority: 'low' };
    expect(pillColor(high, boardColor, theme)).toBe('#4CAF50');
    // Two priorities, one board → one colour. The whole point.
    expect(pillColor(high, boardColor, theme)).toBe(pillColor(low, boardColor, theme));
  });

  test('different boards stay different', () => {
    expect(pillColor({ project: 'Church' }, boardColor, theme))
      .not.toBe(pillColor({ project: 'Work' }, boardColor, theme));
  });

  test('an explicit per-item colour still wins — someone chose it', () => {
    expect(pillColor({ project: 'Church', meta: { color: '#FF00FF' } }, boardColor, theme)).toBe('#FF00FF');
  });

  test('a BOARDED event takes its board, not the generic event blue', () => {
    // "An event on the Church board" is more useful than "an event", and the
    // agenda's card for it says the same thing.
    expect(pillColor({ project: 'Church', itemType: 'event' }, boardColor, theme)).toBe('#4CAF50');
  });

  test('a boardless event/birthday keeps its type colour rather than going grey', () => {
    expect(pillColor({ itemType: 'event' }, boardColor, theme)).toBe('#2196F3');
    expect(pillColor({ itemType: 'birthday' }, boardColor, theme)).toBe('#E91E63');
  });

  test('a boardless plain task lands on the neutral', () => {
    expect(pillColor({ id: 't', title: 'Call Omar' }, boardColor, theme)).toBe('#9E9E9E');
  });

  test('no theme, no resolver, no task — still a colour, never undefined', () => {
    // The pill's backgroundColor: undefined here paints a transparent pill
    // with white text on the grid, i.e. an invisible task.
    expect(pillColor(null, undefined, undefined)).toBe('#9E9E9E');
  });
});
