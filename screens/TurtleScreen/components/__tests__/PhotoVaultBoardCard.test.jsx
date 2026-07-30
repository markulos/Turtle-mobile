import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import PhotoVaultBoardCard from '../PhotoVaultBoardCard';

jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');

const theme = {
  mode: 'dark',
  colors: {
    background: '#000',
    surfaceElevated: '#111',
    surfaceHighlight: '#1a1a1a',
    border: '#222',
    textPrimary: '#fff',
    textSecondary: '#aaa',
    textMuted: '#666',
  },
};

const board = {
  name: 'Warm interiors',
  covers: ['/one', '/two', '/three', '/four'],
  count: 47,
  latestDate: 1,
  metadata: '47 items · 2d',
};

describe('PhotoVaultBoardCard', () => {
  test('renders a three-pane collage with title and metadata outside the image', async () => {
    const view = await render(
      <PhotoVaultBoardCard
        board={board}
        width={180}
        theme={theme}
        resolveCoverUrl={(path) => `https://pond${path}`}
        onPress={jest.fn()}
        onLongPress={jest.fn()}
      />,
    );

    expect(view.getAllByTestId(/board-cover-/)).toHaveLength(3);
    expect(view.getByText('Warm interiors')).toBeTruthy();
    expect(view.getByText('47 items · 2d')).toBeTruthy();
    expect(view.queryByTestId('board-title-overlay')).toBeNull();
  });

  test('exposes useful accessibility and delegates press actions by board name', async () => {
    const onPress = jest.fn();
    const onLongPress = jest.fn();
    const onPressIn = jest.fn();
    const view = await render(
      <PhotoVaultBoardCard
        board={board}
        width={180}
        theme={theme}
        resolveCoverUrl={(path) => path}
        onPress={onPress}
        onLongPress={onLongPress}
        onPressIn={onPressIn}
      />,
    );

    const card = view.getByLabelText('Warm interiors, 47 items, updated 2d');
    await fireEvent(card, 'pressIn');
    await fireEvent.press(card);
    await fireEvent(card, 'longPress');

    expect(onPress).toHaveBeenCalledWith('Warm interiors');
    expect(onLongPress).toHaveBeenCalledWith('Warm interiors');
    expect(onPressIn).toHaveBeenCalledTimes(1);
  });

  test('matches the reference board proportions', async () => {
    // Measured off the Pinterest boards reference (1170px wide @3x = 390pt):
    // collage 555x380px = 1.46 aspect, hero pane 360/555 = 65%, ~20px (7pt)
    // outer/column spacing, ~85px (28pt) between stacked rows.
    const view = await render(
      <PhotoVaultBoardCard
        board={board}
        width={185}
        theme={theme}
        resolveCoverUrl={(path) => path}
        onPress={jest.fn()}
        onLongPress={jest.fn()}
      />,
    );

    const collage = StyleSheet.flatten(view.getByTestId('board-collage').props.style);
    const hero = StyleSheet.flatten(view.getByTestId('board-hero-pane').props.style);
    const card = StyleSheet.flatten(view.getByLabelText(/^Warm interiors/).props.style);

    expect(collage.aspectRatio).toBeCloseTo(1.46, 2);
    expect(collage.borderRadius).toBe(12);
    expect(collage.overflow).toBe('hidden');
    expect(hero.width).toBe('65%');
    expect(card.marginBottom).toBe(26);
    const title = StyleSheet.flatten(view.getByText('Warm interiors').props.style);
    expect(title.fontSize).toBeCloseTo(9.6, 2);
    expect(Number(title.fontWeight)).toBeLessThan(700);
    expect(StyleSheet.flatten(view.getByText('47 items · 2d').props.style).fontSize).toBe(14);
  });

  test('renders a single quiet empty-board placeholder when covers are absent', async () => {
    const view = await render(
      <PhotoVaultBoardCard
        board={{ ...board, covers: [], count: 0, metadata: '0 items' }}
        width={180}
        theme={theme}
        resolveCoverUrl={(path) => path}
        onPress={jest.fn()}
        onLongPress={jest.fn()}
      />,
    );

    expect(view.getByTestId('board-empty-cover')).toBeTruthy();
    expect(view.queryAllByTestId(/board-cover-/)).toHaveLength(0);
  });
});
