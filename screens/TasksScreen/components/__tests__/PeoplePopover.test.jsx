/**
 * The list a card's avatar stack opens: who is on this task, what is known
 * about each of them, and a way into their profile.
 *
 * The positioning is a pure function so the flip-and-clamp arithmetic is
 * tested rather than eyeballed on one screen size — a popover half off the
 * edge is worse than one on the wrong side of its anchor.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import PeoplePopover, { popoverPosition, personDetail } from '../PeoplePopover';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('../../../../utils/haptics', () => ({ tapHaptic: jest.fn() }));

const theme = {
  mode: 'light',
  colors: {
    surface: '#F5F5F5', surfaceElevated: '#EEE', background: '#fff',
    textPrimary: '#000', textSecondary: '#555', textTertiary: '#888', textMuted: '#aaa',
    border: '#ddd',
  },
};
const P = (id, name, extra = {}) => ({ id, name, color: '#34D399', avatarUrl: null, ...extra });

describe('popoverPosition', () => {
  const box = { screenW: 390, screenH: 844, cardW: 268, cardH: 200, edge: 12, gap: 8 };

  test('drops BELOW the anchor, centred on it', () => {
    const { top, left } = popoverPosition({ x: 300, y: 200, width: 22, height: 22 }, box);
    expect(top).toBe(230);                       // 200 + 22 + 8
    expect(left).toBe(390 - 12 - 268);           // wanted 177, clamped to the right edge
  });

  test('flips ABOVE when there is no room below and room above', () => {
    const { top } = popoverPosition({ x: 100, y: 700, width: 22, height: 22 }, box);
    expect(top).toBe(700 - 8 - 200);
  });

  test('stays below, clamped, when neither side really fits', () => {
    // Anchored near the top with a tall card: above would be off-screen, so it
    // stays below rather than flipping into the notch.
    const { top } = popoverPosition({ x: 100, y: 10, width: 22, height: 22 }, { ...box, cardH: 800 });
    expect(top).toBeGreaterThanOrEqual(box.edge);
  });

  test('never runs off either side', () => {
    expect(popoverPosition({ x: 0, y: 100, width: 22, height: 22 }, box).left).toBe(12);
    expect(popoverPosition({ x: 389, y: 100, width: 22, height: 22 }, box).left).toBe(110);
  });

  test('centres itself when there is no anchor to drop from', () => {
    // A press that carried no coordinates — the list still has to appear
    // somewhere sensible rather than at 0,0 or not at all.
    const { top, left } = popoverPosition(null, box);
    expect(left).toBe(Math.round((390 - 268) / 2));
    expect(top).toBe(Math.round((844 - 200) / 2));
    expect(popoverPosition({ x: NaN, y: 10 }, box).left).toBe(left);
  });
});

describe('personDetail', () => {
  test('says what is known, in one line', () => {
    expect(personDetail({ role: 'member', phone: '+1 647 555 0100' })).toBe('Member · +1 647 555 0100');
  });

  test('calls out someone who has never signed in — it explains an empty profile', () => {
    expect(personDetail({ role: 'member', joined: false })).toMatch(/signed in yet/);
  });

  test('says nothing rather than printing blanks while the member list loads', () => {
    expect(personDetail({})).toBe('');
    expect(personDetail(null)).toBe('');
    // `joined: undefined` is "not known yet", NOT "has not signed in".
    expect(personDetail({ joined: undefined })).toBe('');
  });
});

describe('PeoplePopover', () => {
  const open = (people, props = {}) => render(
    <PeoplePopover visible people={people} anchor={{ x: 100, y: 200, width: 22, height: 22 }} theme={theme} {...props} />,
  );

  test('lists everyone, with their basic info', async () => {
    const view = await open([
      P('u1', 'Michelle', { role: 'owner', phone: '+1 647 555 0100' }),
      P('u2', 'Naser', { joined: false }),
    ]);
    expect(view.getByText('Michelle')).toBeTruthy();
    expect(view.getByText('Owner · +1 647 555 0100')).toBeTruthy();
    expect(view.getByText('Naser')).toBeTruthy();
    expect(view.getByText('ON THIS TASK · 2')).toBeTruthy();
  });

  test('shows a picture where there is one, over the initial', async () => {
    const view = await open([P('u1', 'Michelle', { avatarUrl: 'https://x/m.jpg' })]);
    const src = view.getByTestId('people-popover-u1-photo').props.source;
    expect([].concat(src)[0]).toMatchObject({ uri: 'https://x/m.jpg' });
    expect(view.getByText('M')).toBeTruthy();
  });

  test('picking someone hands that person back', async () => {
    const onPick = jest.fn();
    const view = await open([P('u1', 'Michelle'), P('u2', 'Naser')], { onPick });
    await fireEvent.press(view.getByTestId('people-popover-u2'));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'u2' }));
  });

  test('tapping away closes it — a popover has no Done key', async () => {
    const onClose = jest.fn();
    const view = await open([P('u1', 'Michelle')], { onClose });
    await fireEvent.press(view.getByTestId('people-popover-scrim'));
    expect(onClose).toHaveBeenCalled();
  });

  test('draws nothing when closed, or when there is nobody to list', async () => {
    const closed = await render(<PeoplePopover visible={false} people={[P('u1', 'M')]} theme={theme} />);
    expect(closed.queryByTestId('people-popover')).toBeNull();
    const empty = await render(<PeoplePopover visible people={[]} theme={theme} />);
    expect(empty.queryByTestId('people-popover')).toBeNull();
  });
});
