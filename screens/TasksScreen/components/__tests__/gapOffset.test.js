/**
 * A gap holds its open space as real layout height and TRANSLATES what that
 * space displaced back up by the same amount, so claiming the room moves
 * nothing; the animation is that translate running to zero.
 *
 * Two things have gone wrong with this pair, one after the other, and both are
 * asserted here:
 *
 *  1. The height and the offset were owned by different threads (React state
 *     vs a Reanimated worklet) and could be read a frame apart — height claimed
 *     with the content not held back is a whole gap of empty space, i.e. the
 *     list below dropping and snapping back.
 *  2. Fixing that by holding the content back with a React transform left a
 *     LIVE TRANSFORM AT REST. On Fabric that is content sitting outside its
 *     view's bounds, and `RCTViewComponentView.hitTest` refuses points outside
 *     bounds unless Yoga measured an overflowInset — which transforms never
 *     produce. The hour slots were visible and unpressable.
 *
 * So: zero at rest, in BOTH rests. That is the property that keeps the `+` on
 * every hour tappable, and it is worth a test because nothing about the code
 * looks wrong when it is violated — it still animates correctly.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');

import { gapOffset } from '../CalendarView';

// A 6h30m gap opens into seven 48 pt hour slots.
const OPEN_H = 7 * 48;

describe('gapOffset', () => {
  test('nothing is displaced once a gap is fully OPEN', () => {
    expect(gapOffset(1, 1, OPEN_H)).toBe(0);
  });

  test('nothing is displaced while a gap is SHUT', () => {
    expect(gapOffset(0, 0, OPEN_H)).toBe(0);
  });

  // The one that would have caught the unpressable slots: whatever the gap's
  // size, a settled gap leaves no offset behind for hit-testing to fall over.
  test.each([48, 336, 1152])('a settled gap of any size leaves no offset (%i)', (openH) => {
    expect(gapOffset(1, 1, openH)).toBe(0);
    expect(gapOffset(0, 0, openH)).toBe(0);
  });

  test('mid-reveal the content is held back by the part not yet revealed', () => {
    expect(gapOffset(1, 0, OPEN_H)).toBe(-OPEN_H);       // space claimed, nothing shown yet
    expect(gapOffset(1, 0.5, OPEN_H)).toBe(-OPEN_H / 2); // half way down
    expect(gapOffset(1, 0.25, OPEN_H)).toBe(-OPEN_H * 0.75);
  });

  // Space not claimed means nothing to hold back, whatever the reveal says.
  // This is the guard that keeps a closing gap from yanking the list up on the
  // frame after it hands its space back.
  test('an unreserved gap never displaces anything, at any progress', () => {
    for (const p of [0, 0.3, 1]) expect(gapOffset(0, p, OPEN_H)).toBe(0);
  });

  test('the offset never exceeds the space it is cancelling', () => {
    for (const p of [0, 0.1, 0.5, 0.9, 1]) {
      expect(Math.abs(gapOffset(1, p, OPEN_H))).toBeLessThanOrEqual(OPEN_H);
    }
  });
});
