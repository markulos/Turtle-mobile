/**
 * Choosing your animal: the picker, and the disc it changes.
 *
 * The case that matters is the task this came from — an identity assigned
 * "sheep" picking a raccoon — so it is walked end to end here rather than
 * asserted on the catalogue alone.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 59, right: 0, bottom: 34, left: 0 }),
}));
jest.mock('../../utils/haptics', () => ({
  tapHaptic: jest.fn(), impactHaptic: jest.fn(), notifyHaptic: jest.fn(),
  selectionHaptic: jest.fn(), markGesture: jest.fn(),
}));

import AnimalPicker from '../AnimalPicker';
import AnimalAvatar from '../AnimalAvatar';
import { avatarAnimal, generatedName } from '../../utils/avatar';

const theme = {
  mode: 'dark',
  colors: {
    background: '#000', surface: '#0a0a0a', surfaceElevated: '#111',
    textPrimary: '#fff', textSecondary: '#aaa', textTertiary: '#888', textMuted: '#666',
    border: '#222', accent: '#f90', accentInfo: '#58e', accentError: '#e44',
  },
};

/** An identity whose ASSIGNED animal is a sheep — the task's starting point. */
const sheepId = (() => {
  for (let i = 0; i < 5000; i += 1) {
    if (avatarAnimal(`probe:${i}`) === 'sheep') return `probe:${i}`;
  }
  throw new Error('no sheep identity found');
})();

describe('AnimalPicker', () => {
  const open = async (over = {}) => render(
    <AnimalPicker
      visible
      onClose={() => {}}
      identity={sheepId}
      chosen={null}
      onChoose={() => {}}
      theme={theme}
      testID="pick"
      {...over}
    />,
  );

  test('offers raccoon, and reports the key when it is pressed', async () => {
    const onChoose = jest.fn();
    await open({ onChoose });
    await fireEvent.press(screen.getByTestId('pick-raccoon'));
    expect(onChoose).toHaveBeenCalledWith('raccoon');
  });

  test('shows what the name will read as, and it follows the choice', async () => {
    const { rerender } = await open();
    // Starts as the assigned animal's name…
    expect(screen.getByText(generatedName(sheepId))).toBeTruthy();
    expect(generatedName(sheepId)).toMatch(/ Sheep$/);

    // …and once raccoon is the choice, the adjective is kept and the noun moves.
    rerender(
      <AnimalPicker
        visible
        onClose={() => {}}
        identity={sheepId}
        chosen="raccoon"
        onChoose={() => {}}
        theme={theme}
        testID="pick"
      />,
    );
    const expected = generatedName(sheepId).replace(/ Sheep$/, ' Raccoon');
    expect(await screen.findByText(expected)).toBeTruthy();
  });

  test('the way back to the assigned animal is always on offer', async () => {
    const onChoose = jest.fn();
    await open({ chosen: 'raccoon', onChoose });
    await fireEvent.press(screen.getByTestId('pick-assigned'));
    // null, not 'sheep' — the point is to stop having a choice at all, so a
    // later change to the hash pool still reaches this person.
    expect(onChoose).toHaveBeenCalledWith(null);
  });

  test('the current animal is marked as selected', async () => {
    await open({ chosen: 'raccoon' });
    expect(screen.getByTestId('pick-raccoon').props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId('pick-fox').props.accessibilityState.selected).toBe(false);
    expect(screen.getByTestId('pick-assigned').props.accessibilityState.selected).toBe(false);
  });

  test('with no choice made, "assigned" is the selected one', async () => {
    await open({ chosen: null });
    expect(screen.getByTestId('pick-assigned').props.accessibilityState.selected).toBe(true);
  });

  test('Done and the scrim both close it', async () => {
    const onClose = jest.fn();
    await open({ onClose });
    await fireEvent.press(screen.getByTestId('pick-done'));
    await fireEvent.press(screen.getByTestId('pick-scrim'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('AnimalAvatar', () => {
  test('draws the chosen animal as an emoji', async () => {
    await render(<AnimalAvatar id={sheepId} animal="raccoon" testID="disc" />);
    expect(screen.getByTestId('disc-emoji').props.children).toBe('🦝');
    expect(screen.queryByTestId('disc-icon')).toBeNull();
  });

  test('draws the assigned silhouette when nothing is chosen', async () => {
    await render(<AnimalAvatar id={sheepId} testID="disc" />);
    expect(screen.getByTestId('disc-icon').props.name).toBe('sheep');
    expect(screen.queryByTestId('disc-emoji')).toBeNull();
  });

  test('an unrecognised choice falls back rather than drawing blank', async () => {
    // A value from a newer build, or corrupted storage. An avatar is chrome:
    // it must never be the thing that renders empty.
    await render(<AnimalAvatar id={sheepId} animal="tyrannosaurus" testID="disc" />);
    expect(screen.getByTestId('disc-icon').props.name).toBe('sheep');
  });

  test('the disc keeps its stable tint whichever glyph is in it', async () => {
    const { rerender } = await render(<AnimalAvatar id={sheepId} testID="disc" />);
    const before = screen.getByTestId('disc').props.style;
    rerender(<AnimalAvatar id={sheepId} animal="raccoon" testID="disc" />);
    expect(screen.getByTestId('disc').props.style).toEqual(before);
  });
});
