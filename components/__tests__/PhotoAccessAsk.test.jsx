import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

/**
 * The question itself.
 *
 * Mark, 2026-11-18: "remove the prompt that asks to autosave photos. make it
 * ask once on uploading images but also have a checkmark for never ask
 * again." The checkmark is the part a system sheet could never carry, so the
 * things pinned here are that it exists, that it reaches the service, and
 * that NEITHER answer reaches the OS without being asked for.
 */

const mockAnswer = jest.fn(async () => true);
const mockListeners = [];
/** Raise the question the way an image upload does. */
const mockAsk = (due) => { for (const l of mockListeners) l(due); };

jest.mock('../../services/photoAccessPrompt', () => ({
  // Wrapped, not referenced: this factory runs while the consts above are
  // still in their dead zone.
  answerPhotoAccessAsk: (...args) => mockAnswer(...args),
  onPhotoAccessAsk: (listener) => {
    mockListeners.push(listener);
    listener(false);
    return () => {
      const at = mockListeners.indexOf(listener);
      if (at >= 0) mockListeners.splice(at, 1);
    };
  },
}));
jest.mock('../../utils/haptics', () => ({
  impactHaptic: jest.fn(), tapHaptic: jest.fn(), notifyHaptic: jest.fn(),
}));

const theme = {
  mode: 'light',
  colors: {
    surface: '#fff', surfaceElevated: '#fafafa', border: '#ddd',
    textPrimary: '#111', textSecondary: '#555', textTertiary: '#888',
    accent: '#2E7D32', accentInk: '#2E7D32',
  },
};
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: mockTheme }),
}));
const mockTheme = theme;

const PhotoAccessAsk = require('../PhotoAccessAsk').default;
const { ASK_NEVER, ASK_TITLE } = require('../PhotoAccessAsk');

beforeEach(() => {
  mockListeners.length = 0;
  mockAnswer.mockClear();
});

const raise = async (view) => {
  await act(async () => { mockAsk(true); });
  return view;
};

describe('PhotoAccessAsk', () => {
  test('nothing is on screen until an image upload raises it', async () => {
    const view = await render(<PhotoAccessAsk />);
    expect(view.queryByTestId('photo-access-ask')).toBeNull();
    await raise(view);
    expect(view.queryByTestId('photo-access-ask')).not.toBeNull();
    expect(view.getByText(ASK_TITLE)).toBeTruthy();
  });

  test('ALLOW answers yes, and carries the unticked box', async () => {
    const view = await render(<PhotoAccessAsk />);
    await raise(view);
    await fireEvent.press(view.getByTestId('photo-access-allow'));
    expect(mockAnswer).toHaveBeenCalledWith({ allow: true, never: false });
    // …and it closes on the answer rather than waiting for the OS sheet.
    expect(view.queryByTestId('photo-access-ask')).toBeNull();
  });

  test('NOT NOW answers no — and still only once, which the service enforces', async () => {
    const view = await render(<PhotoAccessAsk />);
    await raise(view);
    await fireEvent.press(view.getByTestId('photo-access-decline'));
    expect(mockAnswer).toHaveBeenCalledWith({ allow: false, never: false });
  });

  test('THE CHECKMARK is a real control, and it rides on the answer', async () => {
    const view = await render(<PhotoAccessAsk />);
    await raise(view);
    const box = view.getByTestId('photo-access-never');
    expect(box.props.accessibilityState.checked).toBe(false);

    await fireEvent.press(box);
    expect(view.getByTestId('photo-access-never').props.accessibilityState.checked).toBe(true);

    await fireEvent.press(view.getByTestId('photo-access-decline'));
    expect(mockAnswer).toHaveBeenCalledWith({ allow: false, never: true });
  });

  test('…and it is announced as a checkbox, not as a button', async () => {
    // It is the one control on this card whose state means something after
    // the card is gone.
    const view = await render(<PhotoAccessAsk />);
    await raise(view);
    const box = view.getByTestId('photo-access-never');
    expect(box.props.accessibilityRole).toBe('checkbox');
    expect(box.props.accessibilityLabel).toBe(ASK_NEVER);
  });

  test('it can be ticked and UNticked', async () => {
    const view = await render(<PhotoAccessAsk />);
    await raise(view);
    await fireEvent.press(view.getByTestId('photo-access-never'));
    await fireEvent.press(view.getByTestId('photo-access-never'));
    await fireEvent.press(view.getByTestId('photo-access-allow'));
    expect(mockAnswer).toHaveBeenCalledWith({ allow: true, never: false });
  });

  test('a DOUBLE TAP answers once', async () => {
    // Two answers means two system sheets, and the second lands on an empty
    // screen. `answering` is a ref for exactly this: state would not be
    // written until the next render.
    const view = await render(<PhotoAccessAsk />);
    await raise(view);
    const allow = view.getByTestId('photo-access-allow');
    // SEQUENTIALLY, on the node captured before the first press — two
    // concurrent fireEvents overlap RNTL's own act() and poison every render
    // after them, so the second tap is delivered to the button as it was.
    // That is the real shape of the bug anyway: a finger that lands twice on
    // a card already on its way out.
    await fireEvent.press(allow);
    await fireEvent.press(allow);
    expect(mockAnswer).toHaveBeenCalledTimes(1);
  });

  test('a fresh question starts with the box CLEAR', async () => {
    // A tick left over from a prompt somebody already answered would silence
    // a question nobody has read.
    const view = await render(<PhotoAccessAsk />);
    await raise(view);
    await fireEvent.press(view.getByTestId('photo-access-never'));
    await fireEvent.press(view.getByTestId('photo-access-decline'));

    await raise(view);
    expect(view.getByTestId('photo-access-never').props.accessibilityState.checked).toBe(false);
  });

  test('the subscription is dropped when it unmounts', async () => {
    // `raise` first, because `render` alone does not flush the passive effect
    // that subscribes — the other tests get that flush for free from it.
    const view = await render(<PhotoAccessAsk />);
    await raise(view);
    expect(mockListeners).toHaveLength(1);
    // Awaited, and LAST in the file: unmount is async here, and an unmount
    // mid-file empties every tree rendered after it.
    await view.unmount();
    expect(mockListeners).toHaveLength(0);
  });
});
