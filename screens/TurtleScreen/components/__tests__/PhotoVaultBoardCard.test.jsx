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
    // collage 557x375px = 1.48 aspect on a 186pt card, hero pane 65%, a ~23px
    // corner arc, ~20px (7pt) outer/column spacing, and a 15pt semibold title
    // over 13.5pt metadata.
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

    expect(collage.aspectRatio).toBeCloseTo(1.48, 2);
    expect(collage.borderRadius).toBe(9);
    expect(collage.overflow).toBe('hidden');
    expect(hero.width).toBe('65%');
    expect(card.marginBottom).toBe(26);
    const title = StyleSheet.flatten(view.getByText('Warm interiors').props.style);
    expect(title.fontSize).toBe(14);
    // Weight comes from the family, not fontWeight — RN ignores fontWeight once
    // a custom fontFamily is set, so a numeric weight would silently do nothing.
    expect(title.fontFamily).toBe('Figtree_600SemiBold');
    expect(title.fontWeight).toBeUndefined();
    // Metadata stays a step below the title so the hierarchy reads title-first.
    const meta = StyleSheet.flatten(view.getByText('47 items · 2d').props.style);
    expect(meta.fontSize).toBeCloseTo(13.5, 2);
    expect(meta.fontSize).toBeLessThan(title.fontSize);
    // The caption is ONE block: no margin between the two lines, and line-heights
    // close to the glyph size so leading slack doesn't reopen the gap.
    expect(meta.marginTop).toBe(0);
    expect(title.lineHeight).toBe(17);
    expect(meta.lineHeight).toBe(16);
  });

  test('badges a published board as SHARED, and says so to screen readers', async () => {
    const view = await render(
      <PhotoVaultBoardCard
        board={{ ...board, isLive: true }}
        width={180}
        theme={{ ...theme, colors: { ...theme.colors, accentInfo: '#38BDF8' } }}
        resolveCoverUrl={(path) => path}
        onPress={jest.fn()}
        onLongPress={jest.fn()}
      />,
    );

    expect(view.getByTestId('board-shared-badge')).toBeTruthy();
    expect(view.getByText('SHARED')).toBeTruthy();
    expect(view.getByLabelText('Warm interiors, 47 items, updated 2d, shared on the web')).toBeTruthy();
  });

  test('the badge opens share insights without opening the board', async () => {
    const onPress = jest.fn();
    const onPressShared = jest.fn();
    const view = await render(
      <PhotoVaultBoardCard
        board={{ ...board, isLive: true }}
        width={180}
        theme={{ ...theme, colors: { ...theme.colors, accentInfo: '#38BDF8' } }}
        resolveCoverUrl={(path) => path}
        onPress={onPress}
        onLongPress={jest.fn()}
        onPressShared={onPressShared}
      />,
    );

    await fireEvent.press(view.getByTestId('board-shared-badge'));

    expect(onPressShared).toHaveBeenCalledWith('Warm interiors');
    expect(onPress).not.toHaveBeenCalled();
  });

  test('shows nothing at all for a private board', async () => {
    const view = await render(
      <PhotoVaultBoardCard
        board={board}
        width={180}
        theme={theme}
        resolveCoverUrl={(path) => path}
        onPress={jest.fn()}
        onLongPress={jest.fn()}
      />,
    );

    expect(view.queryByTestId('board-shared-badge')).toBeNull();
    expect(view.queryByText('SHARED')).toBeNull();
  });

  // ── The caption's right end: who it is shared with, and the way in ────────
  //
  // The overflow arithmetic is pinned in utils/__tests__/faceStack.test.js;
  // these are about the CARD — that the cog is on every real board and nothing
  // else, that it reaches the sharing card, and that faces appear only when
  // there are people to draw.
  const people = (n) => Array.from({ length: n }, (_, i) => ({ userId: `u${i}`, name: `Person ${i}` }));
  const drawCard = (over = {}, props = {}) => render(
    <PhotoVaultBoardCard
      board={{ ...board, ...over }}
      width={186}
      theme={theme}
      resolveCoverUrl={(path) => path}
      onPress={jest.fn()}
      onLongPress={jest.fn()}
      onPressShareSettings={jest.fn()}
      {...props}
    />,
  );

  test('every real board carries a sharing cog, and it opens that board’s card', async () => {
    const onPressShareSettings = jest.fn();
    const view = await drawCard({}, { onPressShareSettings });
    await fireEvent.press(view.getByTestId('board-share-settings'));
    expect(onPressShareSettings).toHaveBeenCalledWith('Warm interiors');
  });

  test('All Photos has none — the whole library is not a thing you share', async () => {
    const view = await drawCard({ name: 'All Photos' }, { onPressShareSettings: undefined });
    expect(view.queryByTestId('board-share-settings')).toBeNull();
  });

  test('the cog is quiet at rest: a column of them must not compete with the covers', async () => {
    const view = await drawCard();
    const style = view.getByTestId('board-share-settings').props.style;
    const flat = StyleSheet.flatten(typeof style === 'function' ? style({ pressed: false }) : style);
    expect(flat.opacity).toBeLessThan(0.5);
  });

  test('its label counts the people', async () => {
    const view = await drawCard({ sharedWith: people(2) });
    expect(view.getByLabelText('Sharing for Warm interiors: 2 people')).toBeTruthy();
  });

  test('and counts one of them properly', async () => {
    const view = await drawCard({ sharedWith: people(1) });
    expect(view.getByLabelText('Sharing for Warm interiors: 1 person')).toBeTruthy();
  });

  test('a board shared with nobody draws no faces at all', async () => {
    const view = await drawCard();
    expect(view.getByLabelText('Sharing for Warm interiors')).toBeTruthy();
    expect(view.queryByText(/^\+\d+$/)).toBeNull();
  });

  test('more people than the caption can spare become a +n', async () => {
    const view = await drawCard({ sharedWith: people(6) });
    expect(view.getByText(/^\+\d+$/)).toBeTruthy();
  });

  test('a SHARED board keeps both its badge and its cog', async () => {
    // Both are pinned to the same end of one caption row; the stack is handed
    // less room when the badge is there rather than either being dropped.
    const view = await drawCard(
      { isLive: true, sharedWith: people(6) },
      { theme: { ...theme, colors: { ...theme.colors, accentInfo: '#38BDF8' } } },
    );
    expect(view.getByTestId('board-shared-badge')).toBeTruthy();
    expect(view.getByTestId('board-share-settings')).toBeTruthy();
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
