import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('../../../../utils/haptics', () => ({
  impactHaptic: jest.fn(),
  notifyHaptic: jest.fn(),
  markGesture: jest.fn(),
  tapHaptic: jest.fn(),
}));

import InboxCapture from '../InboxCapture';

const theme = {
  mode: 'dark',
  colors: {
    background: '#000', textPrimary: '#fff', textSecondary: '#ccc', textTertiary: '#888',
    textMuted: '#777', surface: '#111', border: '#333', accentInfo: '#5598e7',
  },
};

/** The light page, where the white-on-white trap lives. */
const light = {
  mode: 'light',
  colors: {
    background: '#FFFFFF', textPrimary: '#111111', textSecondary: '#444',
    textTertiary: '#6B7280', textMuted: '#9CA3AF', surface: '#F5F5F5',
    border: 'rgba(0,0,0,0.1)', accentInfo: '#5598e7',
  },
};

const props = (over = {}) => ({ destinationLabel: 'Unsorted', onAdd: jest.fn(), theme, ...over });

const styleOf = (testID) => StyleSheet.flatten(screen.getByTestId(testID).props.style);

const type = async (text) => {
  await act(async () => { fireEvent.changeText(screen.getByTestId('inbox-capture-input'), text); });
};
const press = async (testID) => {
  const el = screen.getByTestId(testID);
  await act(async () => { fireEvent.press(el); });
};

describe('the first thing on the Inbox tab', () => {
  // The page used to open on four statistics and a list of boards — answers to
  // questions you only have once you already use the app.
  test('is a field you can type into', async () => {
    await render(<InboxCapture {...props()} />);
    expect(screen.getByTestId('inbox-capture-input')).toBeTruthy();
    expect(screen.getByTestId('inbox-capture-heading')).toHaveTextContent(/Make a list/);
  });

  test('asking one question, with no decisions attached to it', async () => {
    await render(<InboxCapture {...props()} />);
    expect(screen.getByTestId('inbox-capture-input').props.placeholder).toBe('What needs doing?');
  });

  // "It is saved" is only reassuring if you know where. A box that swallows
  // things anonymously is one people stop trusting after the first thing they
  // cannot find.
  test('and saying where what you type will go', async () => {
    await render(<InboxCapture {...props({ destinationLabel: 'Inbox' })} />);
    expect(screen.getByTestId('inbox-capture-note')).toHaveTextContent(/Goes to Inbox/);
  });

  // The app's own title idiom, two weights on one line — the Planner header and
  // the calendar's "TO-DO | Today · Sat, Sep 26" are the same shape.
  // Down, not up: the list builds downward from the field, so the arrow points
  // where the thing you typed is about to go. Up would read as "send it away".
  test('the key points down the page, toward the list it is building', async () => {
    await render(<InboxCapture {...props()} />);
    expect(screen.getByTestId('inbox-capture-add')).toBeTruthy();
  });

  test('the heading names the list and the deed, in that order', async () => {
    await render(<InboxCapture {...props()} />);
    const h = screen.getByTestId('inbox-capture-heading');
    expect(h).toHaveTextContent(/TO-DO/);
    expect(h).toHaveTextContent(/Make a list/);
  });
});

/**
 * It sits on the PAGE, not in a card — and that is exactly the arrangement the
 * Focus tab got wrong: a block drawing the inset palette's ink (white in BOTH
 * modes, because those cards are charcoal even on the light page) onto the page
 * itself. A whole ring, clock and Start key shipped invisible in light mode.
 */
describe('it is on the page, so it wears the page’s ink', () => {
  test('no card: no fill and no border behind it', async () => {
    await render(<InboxCapture {...props({ theme: light })} />);
    const box = styleOf('inbox-capture');
    expect(box.backgroundColor).toBeUndefined();
    expect(box.borderWidth).toBeUndefined();
  });

  test('the heading is the PAGE’s ink — dark on the white page, not white on it', async () => {
    await render(<InboxCapture {...props({ theme: light })} />);
    expect(styleOf('inbox-capture-heading').color).toBe('#111111');
    expect(styleOf('inbox-capture-heading').color).not.toBe(light.colors.background);
  });

  test('…and it follows the theme rather than being pinned to one mode', async () => {
    await render(<InboxCapture {...props({ theme })} />);
    expect(styleOf('inbox-capture-heading').color).toBe('#fff');
  });

  test('the typed text is legible on the light page too', async () => {
    await render(<InboxCapture {...props({ theme: light })} />);
    expect(styleOf('inbox-capture-input').color).toBe('#111111');
  });

  // The filled key takes the PAGE's colour for its glyph, so the arrow is
  // readable whichever way round the theme is.
  test('the add key’s glyph inverts against its own fill', async () => {
    await render(<InboxCapture {...props({ theme: light })} />);
    await type('a');
    expect(styleOf('inbox-capture-add').backgroundColor).toBe('#111111');
  });
});

describe('capturing', () => {
  test('the key reports what was typed', async () => {
    const p = props();
    await render(<InboxCapture {...p} />);
    await type('Ring the bank');
    await press('inbox-capture-add');
    expect(p.onAdd).toHaveBeenCalledWith('Ring the bank');
  });

  test('Return does the same thing, without reaching for the key', async () => {
    const p = props();
    await render(<InboxCapture {...p} />);
    await type('Book the ferry');
    await act(async () => { fireEvent(screen.getByTestId('inbox-capture-input'), 'submitEditing'); });
    expect(p.onAdd).toHaveBeenCalledWith('Book the ferry');
  });

  // Capture is almost never one thing: emptying the box turns "add a task" into
  // "empty your head".
  test('the field clears itself, ready for the next one', async () => {
    await render(<InboxCapture {...props()} />);
    await type('Ring the bank');
    await press('inbox-capture-add');
    expect(screen.getByTestId('inbox-capture-input').props.value).toBe('');
  });

  test('a blank line is not a task', async () => {
    const p = props();
    await render(<InboxCapture {...p} />);
    await press('inbox-capture-add');
    expect(p.onAdd).not.toHaveBeenCalled();

    await type('   ');
    await press('inbox-capture-add');
    expect(p.onAdd).not.toHaveBeenCalled();
  });
});

describe('the add key', () => {
  // Disabled rather than hidden: a key that appears as you type is a key you
  // cannot aim for, and its absence reads as "this box does nothing".
  test('is always there, and dead until there is something to add', async () => {
    await render(<InboxCapture {...props()} />);
    expect(screen.getByTestId('inbox-capture-add').props.accessibilityState.disabled).toBe(true);
  });

  test('wakes up as soon as you type', async () => {
    await render(<InboxCapture {...props()} />);
    await type('a');
    expect(screen.getByTestId('inbox-capture-add').props.accessibilityState.disabled).toBe(false);
  });

  test('and goes back to sleep when the line is emptied', async () => {
    await render(<InboxCapture {...props()} />);
    await type('a');
    await type('');
    expect(screen.getByTestId('inbox-capture-add').props.accessibilityState.disabled).toBe(true);
  });
});
