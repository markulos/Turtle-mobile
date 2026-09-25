import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { TaskForm } from '../TaskForm';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
// The People picker keeps its "Often with you" tally in AsyncStorage
// (utils/peopleFrequency), which the form imports to bump on save.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));
jest.mock('react-native-gesture-handler', () => ({
  GestureHandlerRootView: 'GestureHandlerRootView',
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('../../../../context/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      mode: 'light',
      colors: new Proxy({}, { get: () => '#334155' }),
      typography: new Proxy({}, { get: () => 14 }),
    },
  }),
}));
jest.mock('../../../../context/ServerContext', () => ({
  ...(() => {
    const api = { get: jest.fn().mockResolvedValue({ partnersOut: [] }) };
    return { useServer: () => ({ api }) };
  })(),
}));
jest.mock('../../../TurtleScreen/components/EdgeSwipePage', () => {
  const React = require('react');
  return function MockEdgeSwipePage({ visible, children }) {
    return visible ? React.createElement(React.Fragment, null, children) : null;
  };
});
jest.mock('../FormField', () => ({
  FormField: ({ children }) => children,
}));

jest.mock('../DatePickerModal', () => ({ DatePickerModal: () => null }));
jest.mock('../WheelTimePicker', () => ({ WheelTimePicker: () => null }));
jest.mock('../../../../utils/haptics', () => ({
  impactHaptic: jest.fn(),
  notifyHaptic: jest.fn(),
  tapHaptic: jest.fn(),
}));

const baseProps = {
  visible: true,
  onClose: jest.fn(),
  onSave: jest.fn(),
  onDelete: jest.fn(),
  projects: [],
  allTags: [],
  onAddProject: jest.fn(),
  onCollectTags: jest.fn(),
};

describe('TaskForm Save state', () => {
  test.each([
    ['event', "What's the occasion?", 'Add Event'],
    ['birthday', "Whose birthday?", 'Add Birthday'],
  ])('keeps %s Save disabled when a title exists without the required date', async (
    initialType,
    titlePlaceholder,
    saveLabel,
  ) => {
    const view = await render(<TaskForm {...baseProps} initialType={initialType} />);
    const titleInput = view.getByPlaceholderText(titlePlaceholder);

    await fireEvent.changeText(titleInput, 'Required date is missing');

    const saveButton = view.getByLabelText(saveLabel);
    expect(saveButton.props.accessibilityState).toMatchObject({ disabled: true });
  });

  test('carries the finder’s title and time into a new full form', async () => {
    // "Full form" from the day panel's finder continues the SAME task: the
    // title typed there and the time chip set there arrive filled in, so the
    // only reason to open the full form (a board, a note, participants) does
    // not cost you the work already done.
    const view = await render(
      <TaskForm {...baseProps} initialDate="2026-09-14" initialTitle="Call the vet" initialTime="14:30" />,
    );

    expect(view.getByPlaceholderText('What needs to be done?').props.value).toBe('Call the vet');
    // The time chip renders the seeded time as its label, in 12-hour form.
    expect(view.getByText('2:30 PM')).toBeTruthy();
    expect(view.getByLabelText('Add Task').props.accessibilityState).toMatchObject({ disabled: false });
  });

  test('a new form with no seed is still blank', async () => {
    const view = await render(<TaskForm {...baseProps} />);
    expect(view.getByPlaceholderText('What needs to be done?').props.value).toBe('');
    expect(view.getByText('Time')).toBeTruthy();  // the chip's unset label
  });

  test('the seed never overrides the item being EDITED', async () => {
    const view = await render(
      <TaskForm
        {...baseProps}
        initialData={{ id: 7, title: 'Existing task', itemType: 'task', tags: [], dueDate: '2026-09-14' }}
        initialTitle="Call the vet"
        initialTime="14:30"
      />,
    );
    expect(view.getByPlaceholderText('What needs to be done?').props.value).toBe('Existing task');
  });

  test('enables event Save when both title and date are present', async () => {
    const view = await render(
      <TaskForm {...baseProps} initialType="event" initialDate="2026-07-29" />,
    );
    const titleInput = view.getByPlaceholderText("What's the occasion?");

    await fireEvent.changeText(titleInput, 'Release dinner');

    const saveButton = view.getByLabelText('Add Event');
    expect(saveButton.props.accessibilityState).toMatchObject({ disabled: false });
  });
});

/**
 * The form used to be one scroll of every field an item could have, behind a
 * single "More options" fold. Options are now ADDED one at a time, which puts
 * one rule under everything: a field is on the page if you added it OR it
 * already holds something. The second half is what these guard — get it wrong
 * and the symptom is a value you saved that isn't there when you re-open, with
 * nothing to tell you it's still stored.
 */
describe('TaskForm option disclosure', () => {
  test('a new task opens as just the title and the body', async () => {
    const view = await render(<TaskForm {...baseProps} />);

    expect(view.getByPlaceholderText('Notes, links, anything…')).toBeTruthy();
    // None of the optional fields are on the page uninvited.
    expect(view.queryByPlaceholderText('Type to see suggestions...')).toBeNull();
    expect(view.queryByText('Single event (appointment)')).toBeNull();
    expect(view.getByLabelText('Add an option to this item')).toBeTruthy();
  });

  test('adding an option from the sheet puts that field on the page', async () => {
    const view = await render(<TaskForm {...baseProps} />);

    await fireEvent.press(view.getByLabelText('Add an option to this item'));
    await fireEvent.press(view.getByLabelText('Add Tags'));

    expect(view.getByPlaceholderText('Type to see suggestions...')).toBeTruthy();
    // And it stops being on offer, so it can't be added twice.
    await fireEvent.press(view.getByLabelText('Add an option to this item'));
    expect(view.queryByLabelText('Add Tags')).toBeNull();
  });

  test('editing an item shows what it already carries without adding anything', async () => {
    const view = await render(
      <TaskForm
        {...baseProps}
        // `isAppointment` is DERIVED — the form calls a task an appointment when
        // it was created on the day it is due, so the fixture has to say that
        // with createdAt rather than by setting the flag.
        initialData={{
          id: 't1',
          title: 'Renew the licence',
          tags: ['admin'],
          dueDate: '2026-10-01',
          createdAt: new Date(2026, 9, 1, 12).toISOString(),
        }}
      />,
    );

    expect(view.getByPlaceholderText('Type to see suggestions...')).toBeTruthy();
    expect(view.getByText('Single event (appointment)')).toBeTruthy();
    // Still nothing it doesn't carry: the linked-note field stays off.
    expect(view.queryByText('Find a note to link')).toBeNull();
  });

  test('the body is the description, and it round-trips', async () => {
    const view = await render(
      <TaskForm {...baseProps} initialData={{ id: 't2', title: 'Write it up', description: 'the details' }} />,
    );
    expect(view.getByPlaceholderText('Notes, links, anything…').props.value).toBe('the details');
  });

  test('an option offered for one item type is not offered for another', async () => {
    // Guests are an event idea; a task should never be asked about them.
    const task = await render(<TaskForm {...baseProps} />);
    await fireEvent.press(task.getByLabelText('Add an option to this item'));
    expect(task.queryByLabelText('Add Guests')).toBeNull();
    expect(task.getByLabelText('Add Linked note')).toBeTruthy();

    const event = await render(<TaskForm {...baseProps} initialType="event" />);
    await fireEvent.press(event.getByLabelText('Add an option to this item'));
    expect(event.getByLabelText('Add Guests')).toBeTruthy();
    expect(event.queryByLabelText('Add Linked note')).toBeNull();
  });

  // It shipped once behind the "+ Add" chip, which meant a PEOPLE heading with
  // nothing under it and no way to reach the picker without knowing it was
  // there. A task's people are not an edge case.
  test('the People picker is on the page for a task without adding anything', async () => {
    const view = await render(<TaskForm {...baseProps} />);
    expect(view.getByTestId('people-open')).toBeTruthy();
  });

  // (What the picker does once open — search, suggestions, contacts — is
  // covered by PeoplePicker.test.js; opening a Modal inside this form's own
  // overlay is not something this suite can drive.)
});

/**
 * The board picker. Tapping Board opens a search field with the boards listed
 * under it — one control that both finds an existing board and names a new one.
 * The old version listed every board as a chip with a separate "New board"
 * input, which stopped scaling at about a dozen boards.
 */
describe('TaskForm board picker', () => {
  const MANY = [
    'Mayfield Construction', 'Home', 'Thesis', 'Groceries', 'Reading',
    'Turtle App', 'Physio', 'Taxes', 'Garden', 'Cabin',
  ];

  const openPicker = async (props = {}) => {
    const view = await render(<TaskForm {...baseProps} projects={MANY} {...props} />);
    await fireEvent.press(view.getByText('Board'));
    return view;
  };

  test('the Board chip opens a search PAGE listing every board', async () => {
    const view = await openPicker();
    expect(view.getByTestId('board-search')).toBeTruthy();
    // No cap any more. The old list was sliced to eight with a "2 more — keep
    // typing" line under it, because an in-form list cannot scroll (a nested
    // scroller fights the form for every drag). As a pushed page it scrolls,
    // so the tenth board is reachable without guessing letters of its name.
    expect(view.getByTestId('board-option-Mayfield Construction')).toBeTruthy();
    expect(view.getByTestId('board-option-Cabin')).toBeTruthy();
    expect(view.queryByText(/keep typing to narrow it down/)).toBeNull();
  });

  test('typing filters the list on any part of a board name', async () => {
    const view = await openPicker();

    // Substring, not prefix: "cons" has to find "Mayfield Construction".
    await fireEvent.changeText(view.getByTestId('board-search'), 'cons');

    expect(view.getByTestId('board-option-Mayfield Construction')).toBeTruthy();
    expect(view.queryByTestId('board-option-Home')).toBeNull();
  });

  test('a name that is already a board is not also offered as a new one', async () => {
    const view = await openPicker();

    await fireEvent.changeText(view.getByTestId('board-search'), 'thesis'); // any case
    expect(view.getByTestId('board-option-Thesis')).toBeTruthy();
    expect(view.queryByTestId('board-option-create')).toBeNull();
  });

  test('picking a board closes the picker and puts it on the Board chip', async () => {
    const view = await openPicker();

    await fireEvent.press(view.getByTestId('board-option-Thesis'));

    expect(view.queryByTestId('board-search')).toBeNull();
    expect(view.getByText('Thesis')).toBeTruthy();
  });

  test('a name no board has is offered as a new board, from the same field', async () => {
    const view = await openPicker();

    await fireEvent.changeText(view.getByTestId('board-search'), 'Boat repair');
    await fireEvent.press(view.getByTestId('board-option-create'));

    // Chosen, and flagged as a creation — the form creates it on save.
    expect(view.queryByTestId('board-search')).toBeNull();
    expect(view.getByText('Will create new board "Boat repair"')).toBeTruthy();
  });

  test('"No board — later" is reachable even from a query nothing matches', async () => {
    // An item that already has a board: the chip carries its name, so that is
    // what opens the picker.
    const view = await render(
      <TaskForm
        {...baseProps}
        projects={MANY}
        initialData={{ id: 9, title: 'Filed already', itemType: 'task', project: 'Thesis' }}
      />,
    );
    await fireEvent.press(view.getByText('Thesis'));

    await fireEvent.changeText(view.getByTestId('board-search'), 'zzz nothing matches');
    await fireEvent.press(view.getByTestId('board-option-none'));

    expect(view.queryByTestId('board-search')).toBeNull();
    expect(view.getByText('Board')).toBeTruthy();  // back to the unset label
  });
});