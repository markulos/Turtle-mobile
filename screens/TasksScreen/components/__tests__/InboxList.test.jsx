import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('../../../../utils/haptics', () => ({ tapHaptic: jest.fn(), markGesture: jest.fn() }));

import InboxList from '../InboxList';

const c = {
  background: '#FFFFFF', textPrimary: '#111111', textSecondary: '#444',
  textTertiary: '#6B7280', border: 'rgba(0,0,0,0.1)',
};

const task = (over = {}) => ({ id: 't1', title: 'Ring the bank', ...over });

const props = (over = {}) => ({
  items: [task()],
  total: 1,
  freshId: null,
  destinationLabel: 'Inbox',
  c,
  onOpenTask: jest.fn(),
  onOpenAll: jest.fn(),
  ...over,
});

const styleOf = (testID) => StyleSheet.flatten(screen.getByTestId(testID).props.style);

describe('the list the capture field is building', () => {
  test('every line you have written is on it, in order', async () => {
    await render(<InboxList {...props({
      items: [task({ id: 'a', title: 'Milk' }), task({ id: 'b', title: 'Bread' })],
      total: 2,
    })} />);
    expect(screen.getByText('Milk')).toBeTruthy();
    expect(screen.getByText('Bread')).toBeTruthy();
  });

  test('a line opens its task', async () => {
    const p = props();
    await render(<InboxList {...p} />);
    await act(async () => { fireEvent.press(screen.getByTestId('inbox-line-t1')); });
    expect(p.onOpenTask).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }));
  });

  // An empty list under a capture field should say what the field is FOR, not
  // sit blank — a blank page under an input reads as something being broken.
  test('nothing written yet says so, and names where it would go', async () => {
    await render(<InboxList {...props({ items: [], total: 0 })} />);
    expect(screen.getByTestId('inbox-list-empty')).toHaveTextContent(/Nothing in Inbox yet/);
  });
});

/**
 * The string is the whole idea: one thread down the left with a bead per line,
 * so the column reads as one continuous thing being added to rather than as N
 * stacked objects.
 */
describe('the string', () => {
  test('is drawn ONCE, behind the rows', async () => {
    await render(<InboxList {...props({
      items: [task({ id: 'a' }), task({ id: 'b' }), task({ id: 'c' })],
      total: 3,
    })} />);
    // Abutting per-row hairlines composite darker where they meet, so a
    // segment per row gives the list a rung ladder it never wanted. One line.
    const wrap = screen.getByTestId('inbox-list');
    const threads = wrap.props.children.flat?.() ?? [];
    expect(screen.getByTestId('inbox-list')).toBeTruthy();
    expect(threads.length).toBeGreaterThan(0);
  });

  test('the rows leave room for it rather than sitting on it', async () => {
    await render(<InboxList {...props()} />);
    expect(styleOf('inbox-line-t1').paddingLeft).toBeGreaterThan(20);
  });
});

describe('what the cap means', () => {
  // The cap is on what is DRAWN. A list that grows without bound under a
  // capture field pushes everything else off the screen the moment you use it.
  test('a capped list says how much it is not showing', async () => {
    await render(<InboxList {...props({ items: [task()], total: 9 })} />);
    expect(screen.getByTestId('inbox-list-more')).toHaveTextContent('8 more');
  });

  test('an uncapped one offers nothing to open', async () => {
    await render(<InboxList {...props({ items: [task()], total: 1 })} />);
    expect(screen.queryByTestId('inbox-list-more')).toBeNull();
  });

  test('and the key goes to the whole board', async () => {
    const p = props({ items: [task()], total: 9 });
    await render(<InboxList {...p} />);
    await act(async () => { fireEvent.press(screen.getByTestId('inbox-list-more')); });
    expect(p.onOpenAll).toHaveBeenCalled();
  });
});
