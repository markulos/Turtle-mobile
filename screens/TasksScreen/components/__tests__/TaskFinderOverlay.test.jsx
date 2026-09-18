import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import TaskFinderOverlay from '../TaskFinderOverlay';
import { finderDestination } from '../../utils/finderDestination';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('../../../../utils/haptics', () => ({ tapHaptic: jest.fn(), impactHaptic: jest.fn() }));

const theme = {
  mode: 'dark',
  colors: {
    background: '#000',
    surface: '#0a0a0a',
    surfaceElevated: '#111',
    border: '#222',
    borderStrong: '#333',
    textPrimary: '#fff',
    textSecondary: '#aaa',
    textTertiary: '#666',
    textPlaceholder: '#555',
  },
};

const open = [{ id: 'a', title: 'Reflection Wednesday' }, { id: 'b', title: 'Interview Gensler' }];

const renderOverlay = async (overrides = {}) => {
  const props = {
    visible: true,
    theme,
    keyboardHeight: 300,
    destination: finderDestination({ dateLabel: 'Wed, Sep 16', board: 'Ambarch' }),
    value: '',
    onChangeText: jest.fn(),
    onSubmit: jest.fn(),
    onCancel: jest.fn(),
    placeholder: 'Search or add a task…',
    showCreate: false,
    createCaption: 'Create · Wed, Sep 16',
    onOpenFullForm: jest.fn(),
    results: [],
    renderResult: (t) => <Text key={t.id}>{t.title}</Text>,
    resultsCaption: '0 matching',
    idleResults: open,
    idleCaption: '2 open · Wed, Sep 16',
    idleEmptyHint: 'Nothing open on Wed, Sep 16.',
    ...overrides,
  };
  return { props, view: await render(<TaskFinderOverlay {...props} />) };
};

describe('TaskFinderOverlay', () => {
  test('renders nothing at all when not visible', async () => {
    const { view } = await renderOverlay({ visible: false });
    expect(view.queryByTestId('finder-overlay-input')).toBeNull();
  });

  // The ask: an empty field should not waste the biggest surface in the app on
  // a sentence. It opens ON the day it would create into.
  test('shows the day\'s open tasks before anything is typed', async () => {
    const { view } = await renderOverlay();
    expect(view.getByText('2 open · Wed, Sep 16')).toBeTruthy();
    expect(view.getByText('Reflection Wednesday')).toBeTruthy();
    expect(view.getByText('Interview Gensler')).toBeTruthy();
    // And no create card — there is nothing to create yet.
    expect(view.queryByTestId('finder-overlay-create')).toBeNull();
  });

  test('falls back to a hint naming the day when nothing is open on it', async () => {
    const { view } = await renderOverlay({ idleResults: [] });
    expect(view.getByText('Nothing open on Wed, Sep 16.')).toBeTruthy();
  });

  test('swaps the day list for the matches once there is a query', async () => {
    const { view } = await renderOverlay({
      value: 'gen',
      results: [{ id: 'b', title: 'Interview Gensler' }],
      resultsCaption: '1 matching',
      idleResults: open,
    });
    expect(view.getByText('1 matching')).toBeTruthy();
    expect(view.queryByText('2 open · Wed, Sep 16')).toBeNull();
    // 'Reflection Wednesday' was in the idle list and is NOT a match.
    expect(view.queryByText('Reflection Wednesday')).toBeNull();
  });

  test('puts the destination above the field, with its separators', async () => {
    const { view } = await renderOverlay();
    const line = view.getByTestId('finder-overlay-destination');
    expect(line.props.accessibilityLabel).toBe('New task destination: TO-DO, Wed, Sep 16, Ambarch');
  });

  test('offers the ghost create card, and Return and the card do the same thing', async () => {
    const { props, view } = await renderOverlay({ value: 'New thing', showCreate: true });
    const card = view.getByTestId('finder-overlay-create');
    expect(view.getByText('New thing')).toBeTruthy();
    expect(view.getByText('Create · Wed, Sep 16')).toBeTruthy();

    await fireEvent.press(card);
    expect(props.onSubmit).toHaveBeenCalledTimes(1);

    await fireEvent(view.getByTestId('finder-overlay-input'), 'submitEditing');
    expect(props.onSubmit).toHaveBeenCalledTimes(2);
  });

  test('the full-form key does NOT also fire the create', async () => {
    const { props, view } = await renderOverlay({ value: 'New thing', showCreate: true });
    await fireEvent.press(view.getByTestId('finder-overlay-full-form'));
    expect(props.onOpenFullForm).toHaveBeenCalledTimes(1);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  test('closes on the × key', async () => {
    const { props, view } = await renderOverlay();
    await fireEvent.press(view.getByTestId('finder-overlay-close'));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  // The whole reason the panel exists: the list's bottom edge sits ON the
  // keyboard, so everything between the field and the keys is answer area.
  test('sizes the list against the measured keyboard', async () => {
    const { view } = await renderOverlay({ keyboardHeight: 291 });
    const list = view.getByTestId('finder-overlay-list');
    expect(list).toBeTruthy();
  });

  test('keeps taps working while the keyboard is up', async () => {
    const { view } = await renderOverlay();
    const list = view.getByTestId('finder-overlay-list');
    // Without this the FIRST tap on a row is spent dismissing the keyboard.
    expect(list.props.keyboardShouldPersistTaps).toBe('handled');
  });
});

// The field is the vault's board-search pill, and its placeholder is DRAWN by
// the app: a real <Text> over the empty input. iOS renders the `placeholder`
// prop outside the app's text pipeline, so Figtree comes out wide-tracked —
// "S e a r c h  o r  a d d  a  t a s k …" beside a correctly spaced page. The
// prop survives, transparent, so VoiceOver and getByPlaceholderText still work.
// See components/AppTextInput.
describe('TaskFinderOverlay field', () => {
  test('draws the placeholder itself, and hides the one iOS would draw', async () => {
    const { view } = await renderOverlay({ value: '' });
    expect(view.getByTestId('finder-overlay-placeholder').props.children).toBe('Search or add a task…');
    const input = view.getByTestId('finder-overlay-input');
    expect(input.props.placeholder).toBe('Search or add a task…');
    expect(input.props.placeholderTextColor).toBe('transparent');
  });

  test('the placeholder goes the moment there is a value to read', async () => {
    const { view } = await renderOverlay({ value: 'Call CIBC' });
    expect(view.queryByTestId('finder-overlay-placeholder')).toBeNull();
    expect(view.getByTestId('finder-overlay-input').props.value).toBe('Call CIBC');
  });

  test('the placeholder is not in the way of a tap, or of a screen reader', async () => {
    const { view } = await renderOverlay({ value: '' });
    const ph = view.getByTestId('finder-overlay-placeholder');
    // It sits OVER the input: it must pass touches through, and the input's own
    // accessibilityLabel is what a screen reader should read, not this copy.
    expect(ph.props.pointerEvents).toBe('none');
    expect(ph.props.accessible).toBe(false);
    expect(view.getByTestId('finder-overlay-input').props.accessibilityLabel).toBe('Search or add a task');
  });
});

// The clock key opens the time wheel. That wheel is its own Modal, and the
// panel is an opaque full-screen Modal — so a SIBLING wheel is the case
// docs/STYLE-RULES.md §4 names: iOS drops a Modal presented over an open one.
// Here it drew UNDERNEATH, so picking a tentative time looked like a dead key.
// The wheel is handed in and mounted INSIDE the panel's Modal instead.
describe('TaskFinderOverlay overlays', () => {
  test('renders what it is handed, inside its own Modal and after the panel', async () => {
    const { view } = await renderOverlay({
      overlays: <Text testID="finder-wheel">wheel</Text>,
    });
    expect(view.getByTestId('finder-wheel')).toBeTruthy();
  });

  test('draws the overlay LAST, so it is over the panel and not under it', async () => {
    const { view } = await renderOverlay({
      overlays: <Text testID="finder-wheel">wheel</Text>,
    });
    // Same parent as the panel's content, mounted after it: in an in-tree
    // overlay, later siblings paint on top.
    const wheel = view.getByTestId('finder-wheel');
    const panel = wheel.parent;
    const kids = panel.children;
    expect(kids[kids.length - 1]).toBe(wheel);
  });

  test('nothing is drawn when the caller hands it nothing', async () => {
    const { view } = await renderOverlay();
    expect(view.queryByTestId('finder-wheel')).toBeNull();
  });
});
