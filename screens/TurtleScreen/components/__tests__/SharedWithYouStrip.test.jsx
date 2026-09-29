/**
 * The "Shared with you" strip — boards other people gave me, pinned above my
 * own in the boards grid.
 *
 * The claim worth testing is mostly about ABSENCE: on a vault where nobody has
 * ever shared anything, this must render nothing at all rather than an empty
 * heading promising a feature.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import SharedWithYouStrip from '../SharedWithYouStrip';

const theme = {
  colors: {
    textPrimary: '#fff',
    textSecondary: '#bbb',
    textTertiary: '#999',
    textMuted: '#777',
    surfaceHighlight: '#222',
  },
};

const board = (over = {}) => ({
  shareId: 'share_1',
  album: 'Trip',
  ownerUserId: 'u_bea',
  ownerName: 'Bea',
  ownerAvatarUrl: null,
  permission: 'view',
  count: 2,
  covers: ['/api/media/thumbnails/a.jpg'],
  ...over,
});

const draw = (props = {}) => render(
  <SharedWithYouStrip
    boards={[board()]}
    theme={theme}
    resolveCoverUrl={(u) => `https://pond${u}`}
    baseUrl="https://pond"
    onOpen={() => {}}
    {...props}
  />,
);

describe('SharedWithYouStrip', () => {
  test('renders nothing when nobody has shared a board', async () => {
    const empty = await draw({ boards: [] });
    expect(empty.queryByTestId('shared-with-you')).toBeNull();

    // Undefined is the first-render case, before the request has answered —
    // it must be as silent as the empty one, not a flash of heading.
    const pending = await draw({ boards: undefined });
    expect(pending.queryByTestId('shared-with-you')).toBeNull();
  });

  test('names the board and who it came from', async () => {
    const view = await draw();
    expect(view.getByTestId('shared-with-you')).toBeTruthy();
    expect(view.getByText('Trip')).toBeTruthy();
    expect(view.getByText('Bea')).toBeTruthy();
  });

  test('opening a card hands back the whole row, not just its name', async () => {
    // The page it opens needs the shareId — that id IS the authorisation, and
    // the board name alone would not be enough to read anything.
    const onOpen = jest.fn();
    const view = await draw({ onOpen });
    fireEvent.press(view.getByTestId('shared-board-share_1'));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ shareId: 'share_1', album: 'Trip' }));
  });

  test('says who and how many to a screen reader', async () => {
    const view = await draw({ boards: [board({ count: 1 })] });
    expect(view.getByLabelText('Trip, shared by Bea, 1 item')).toBeTruthy();
    const many = await draw({ boards: [board({ count: 4 })] });
    expect(many.getByLabelText('Trip, shared by Bea, 4 items')).toBeTruthy();
  });

  test('a board with no covers still draws a card rather than a hole', async () => {
    const view = await draw({ boards: [board({ covers: [] })] });
    expect(view.getByText('Trip')).toBeTruthy();
  });

  test('draws one card per share, including two boards of the same name', async () => {
    // Two people can each own a "Trip"; they are different boards and the
    // shareId is what tells them apart.
    const view = await draw({
      boards: [
        board(),
        board({ shareId: 'share_2', ownerUserId: 'u_cal', ownerName: 'Cal' }),
      ],
    });
    expect(view.getByTestId('shared-board-share_1')).toBeTruthy();
    expect(view.getByTestId('shared-board-share_2')).toBeTruthy();
    expect(view.getAllByText('Trip')).toHaveLength(2);
  });
});
