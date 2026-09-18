/**
 * What counts as a tap, app-wide.
 *
 * RN enters the pressed state on finger-DOWN, so every scroll begins by
 * lighting whatever is under it. `delayPressIn` covers the case where a parent
 * scroll takes the responder; `pressRetentionOffset` covers the finger that
 * wanders off the control. Neither covers a drag that starts AND ends inside
 * one large target — a 48 pt timeline slot, a tall row, a full-width card —
 * which is what `useTapOnly` judges by distance.
 */
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { TAP_ONLY, TAP_ONLY_PRESSABLE, TAP_SLOP, movedBeyond, useTapOnly } from '../pressBehavior';

describe('the shared props', () => {
  test('delay the press-in, so a scroll gets the responder first', () => {
    expect(TAP_ONLY.delayPressIn).toBeGreaterThan(0);
    expect(TAP_ONLY_PRESSABLE.unstable_pressDelay).toBe(TAP_ONLY.delayPressIn);
    // Well clear of RN's 500ms long-press threshold.
    expect(TAP_ONLY.delayPressIn).toBeLessThan(200);
  });

  test('tighten how far a live press may travel', () => {
    for (const side of ['top', 'bottom', 'left', 'right']) {
      expect(TAP_ONLY.pressRetentionOffset[side]).toBeLessThanOrEqual(10);
    }
  });
});

describe('movedBeyond', () => {
  test('a thumb wobble is still a tap', () => {
    expect(movedBeyond({ x: 100, y: 100 }, { x: 103, y: 104 })).toBe(false);
  });

  test('a swipe is not', () => {
    expect(movedBeyond({ x: 100, y: 100 }, { x: 100, y: 160 })).toBe(true);
    expect(movedBeyond({ x: 100, y: 100 }, { x: 180, y: 100 })).toBe(true);
  });

  test('measures the diagonal, not just one axis', () => {
    // 8 across and 8 down is 11.3 — further than the slop, though neither
    // axis alone is.
    expect(movedBeyond({ x: 0, y: 0 }, { x: 8, y: 8 }, 10)).toBe(true);
  });

  test('is inclusive at the slop, so exactly-at is still a tap', () => {
    expect(movedBeyond({ x: 0, y: 0 }, { x: TAP_SLOP, y: 0 })).toBe(false);
  });

  test('says "no movement" rather than throwing on a missing point', () => {
    expect(movedBeyond(null, { x: 1, y: 1 })).toBe(false);
    expect(movedBeyond({ x: 0, y: 0 }, null)).toBe(false);
    expect(movedBeyond({ x: 0, y: 0 }, { x: NaN, y: 0 })).toBe(false);
  });
});

const touch = (x, y) => ({ nativeEvent: { pageX: x, pageY: y } });

function Slot({ onPress }) {
  const tap = useTapOnly(onPress);
  return (
    <Pressable testID="slot" {...tap.props}>
      {({ pressed }) => (
        <View testID="band" style={pressed && tap.settled ? { backgroundColor: '#eee' } : null}>
          <Text>{tap.settled ? 'settled' : 'moved'}</Text>
        </View>
      )}
    </Pressable>
  );
}

describe('useTapOnly', () => {
  test('a still finger is a tap', async () => {
    const onPress = jest.fn();
    const view = await render(<Slot onPress={onPress} />);
    const slot = view.getByTestId('slot');
    await fireEvent(slot, 'touchStart', touch(100, 100));
    await fireEvent(slot, 'touchMove', touch(102, 101));
    await fireEvent.press(slot);
    expect(onPress).toHaveBeenCalled();
  });

  test('a finger that travelled is NOT — no task gets created by a swipe', async () => {
    const onPress = jest.fn();
    const view = await render(<Slot onPress={onPress} />);
    const slot = view.getByTestId('slot');
    await fireEvent(slot, 'touchStart', touch(100, 100));
    await fireEvent(slot, 'touchMove', touch(100, 180));
    await fireEvent.press(slot);
    expect(onPress).not.toHaveBeenCalled();
  });

  test('the highlight leaves the moment the gesture starts', async () => {
    const view = await render(<Slot onPress={jest.fn()} />);
    const slot = view.getByTestId('slot');
    await fireEvent(slot, 'touchStart', touch(100, 100));
    expect(view.getByText('settled')).toBeTruthy();
    await fireEvent(slot, 'touchMove', touch(100, 180));
    // Not left glowing under a scroll that already took over.
    expect(view.getByText('moved')).toBeTruthy();
  });

  test('the next touch starts clean, so one swipe does not disarm the row', async () => {
    const onPress = jest.fn();
    const view = await render(<Slot onPress={onPress} />);
    const slot = view.getByTestId('slot');
    await fireEvent(slot, 'touchStart', touch(100, 100));
    await fireEvent(slot, 'touchMove', touch(100, 180));
    await fireEvent.press(slot);
    expect(onPress).not.toHaveBeenCalled();

    await fireEvent(slot, 'touchStart', touch(100, 100));
    await fireEvent.press(slot);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test('a press with no touch events at all still works', async () => {
    // Keyboard / accessibility activation never sends touches.
    const onPress = jest.fn();
    const view = await render(<Slot onPress={onPress} />);
    await fireEvent.press(view.getByTestId('slot'));
    expect(onPress).toHaveBeenCalled();
  });
});
