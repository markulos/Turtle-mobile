/**
 * TaskDetail now rides the app's sheet shell (docs/STYLE-RULES.md §4) instead
 * of its own Modal + fade. Two things are worth pinning:
 *
 *  1. It renders nothing at all while closed. The shell plays its entrance on
 *     MOUNT, so a card that stayed mounted behind `visible` would either never
 *     animate or animate once and never again — and it would keep polling
 *     /pomodoros for a task nobody is looking at.
 *  2. Everything the old card showed it still shows: the title, the priority
 *     stamp, the meta chips, the subtasks, the three actions and the comment
 *     composer — plus Edit / Delete, which moved into the shell's footer.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { TaskDetail } from '../TaskDetail';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));
jest.mock('../../../../utils/haptics', () => ({
  tapHaptic: jest.fn(), impactHaptic: jest.fn(), notifyHaptic: jest.fn(),
}));
jest.mock('../../../../services/offlineQueue', () => ({ sendOrQueue: jest.fn() }));
jest.mock('../../../../context/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      mode: 'dark',
      colors: {
        background: '#000',
        surface: '#111',
        surfaceElevated: '#1c1c1e',
        textPrimary: '#fff',
        textSecondary: '#aaa',
        textTertiary: '#888',
        textMuted: '#777',
        accentSuccess: '#4ADE80',
        accentWarning: '#FBBF24',
        accentError: '#F87171',
        accentInfo: '#60A5FA',
        border: '#333',
        borderStrong: '#444',
        primary: '#3b82f6',
      },
      typography: { body: 14 },
    },
  }),
}));
// ONE api object for the whole suite. Handing back a fresh one per render
// would re-identify the comment loader every pass and spin the effect that
// depends on it — the real ServerContext value is stable, so the mock is too.
const mockApi = { get: jest.fn(() => Promise.resolve({})) };
jest.mock('../../../../context/ServerContext', () => ({ useServer: () => ({ api: mockApi }) }));
// The shell itself is covered by its own tests; here it only has to hand back
// the pieces the card gives it so we can assert on what the card renders.
jest.mock('../../../TurtleScreen/components/PhotoViewer/ViewerSheet', () => {
  const React2 = require('react');
  const { View, Text } = require('react-native');
  const Sheet = ({ children, topBar, footer, title, subtitle }) => React2.createElement(
    View,
    null,
    React2.createElement(Text, null, title),
    React2.createElement(Text, null, subtitle),
    topBar,
    children,
    footer,
  );
  return {
    __esModule: true,
    default: Sheet,
    sheetColors: () => ({
      card: 'rgba(10,10,12,0.55)', textPrimary: '#fff', textSecondary: 'rgba(255,255,255,0.7)',
      textMuted: 'rgba(255,255,255,0.45)', border: 'rgba(255,255,255,0.18)', handle: '#555',
      surface: 'rgba(255,255,255,0.12)', primary: '#fff', background: '#000',
      chip: '#fff', chipText: '#000', chipGhostBorder: 'rgba(255,255,255,0.45)', chipGhostText: '#fff',
    }),
  };
});

const task = {
  id: 't1',
  title: 'Details portfolio for Gensler',
  priority: 'medium',
  project: 'Job search',
  dueDate: '2026-09-16',
  createdAt: 1758000000000,
  subtasks: [{ id: 's1', title: 'Pick the projects', completed: true }, { id: 's2', title: 'Export the PDF', completed: false }],
  tags: ['portfolio'],
};

describe('TaskDetail', () => {
  test('renders nothing while closed', async () => {
    const view = await render(<TaskDetail task={task} visible={false} onClose={jest.fn()} />);
    expect(view.toJSON()).toBeNull();
  });

  test('renders nothing without a task', async () => {
    const view = await render(<TaskDetail task={null} visible onClose={jest.fn()} />);
    expect(view.toJSON()).toBeNull();
  });

  test('shows the task on the sheet: title, stamp, chips, subtasks, footer', async () => {
    const view = await render(
      <TaskDetail
        task={task}
        visible
        onClose={jest.fn()}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        onToggleComplete={jest.fn()}
        onToggleSubtask={jest.fn()}
        onStartPomodoro={jest.fn()}
        onContinue={jest.fn()}
      />,
    );
    expect(view.getByText('Details portfolio for Gensler')).toBeTruthy();
    // The one filled pill, and the board name as the sheet's header title.
    expect(view.getByText('medium')).toBeTruthy();
    expect(view.getAllByText('Job search').length).toBeGreaterThan(0);
    // The DATE is the header's subtitle and is said ONCE. It used to be
    // repeated underneath as a "Due: 2026-09-16" chip — the same fact, in raw
    // ISO, under a DETAILS heading, beside a second copy of the board name
    // that the header was already carrying. That pair of sections is what
    // made the card read as cluttered.
    expect(view.getByText('Wed, Sep 16')).toBeTruthy();
    expect(view.queryByText('Due: 2026-09-16')).toBeNull();
    // Section labels are the app's small-caps scale, and the count rides the label.
    expect(view.getByText('Subtasks · 1/2')).toBeTruthy();
    expect(view.getByText('Export the PDF')).toBeTruthy();
    // Actions are keys in the body; Edit / Delete are the shell's footer.
    expect(view.getByText('Continue today')).toBeTruthy();
    expect(view.getByText('Start Pomodoro')).toBeTruthy();
    expect(view.getByText('Edit')).toBeTruthy();
    expect(view.getByText('Delete')).toBeTruthy();
    expect(view.getByText('No comments yet. Start the conversation.')).toBeTruthy();
  });

  test('an action that was not handed down does not draw its key', async () => {
    const view = await render(<TaskDetail task={task} visible onClose={jest.fn()} />);
    expect(view.queryByText('Continue today')).toBeNull();
    expect(view.queryByText('Start Pomodoro')).toBeNull();
    expect(view.queryByText('Send to Claude')).toBeNull();
  });

  test('an occasion stamps its kind, keeps its guests and reminders, and is never continued', async () => {
    const birthday = {
      id: 'b1', title: "Mum's birthday", itemType: 'birthday', dueDate: '2026-10-02', time: '18:00',
      createdAt: 1758000000000, subtasks: [], tags: [],
      meta: { yearly: true, guests: ['Dad'], reminders: ['1-day'] },
    };
    const view = await render(
      <TaskDetail task={birthday} visible onClose={jest.fn()} onContinue={jest.fn()} onStartPomodoro={jest.fn()} />,
    );
    expect(view.getByText('birthday')).toBeTruthy();
    expect(view.getByText('Every year')).toBeTruthy();
    expect(view.getByText('Guests · 1')).toBeTruthy();
    expect(view.getByText('Dad')).toBeTruthy();
    expect(view.getByText('1 day before')).toBeTruthy();
    expect(view.getByText('18:00')).toBeTruthy();
    // "Continue today" is a task affordance; an occasion recurs on its own.
    expect(view.queryByText('Continue today')).toBeNull();
    expect(view.getByText('Start Pomodoro')).toBeTruthy();
  });

  test('a tag closes the card before it filters by it', async () => {
    const onClose = jest.fn();
    const onTagPress = jest.fn();
    const view = await render(
      <TaskDetail task={task} visible onClose={onClose} onTagPress={onTagPress} />,
    );
    fireEvent.press(view.getByText('portfolio'));
    expect(onClose).toHaveBeenCalled();
    expect(onTagPress).toHaveBeenCalledWith('portfolio');
  });
});

/**
 * The card was asked to be simpler to read. What went was DUPLICATION and
 * labels that named things already named — not information.
 */
describe('the card says each thing once', () => {
  const open = (over = {}, props = {}) => render(
    <TaskDetail task={{ ...task, ...over }} visible onClose={jest.fn()} onEdit={jest.fn()} {...props} />,
  );

  // The board is the sheet's header TITLE. A chip repeating it sat two lines
  // below, under a heading, next to a second copy of the date.
  test('the board is the header, not also a chip under it', async () => {
    const view = await open();
    expect(view.getAllByText('Job search')).toHaveLength(1);
  });

  // Two headings over a stamp and a row of chips, where the stamp reads
  // "MEDIUM" and the chips say what they are.
  test('neither the stamp nor the facts wear a heading', async () => {
    const view = await open();
    expect(view.queryByText('PRIORITY')).toBeNull();
    expect(view.queryByText('Priority')).toBeNull();
    expect(view.queryByText('Details')).toBeNull();
    expect(view.getByText('medium')).toBeTruthy();
  });

  // Provenance, demoted from a chip to a footnote — still there, no longer
  // weighted the same as the priority.
  test('“Added” is a footnote, and not a chip saying Created', async () => {
    const view = await open();
    expect(view.queryByText(/^Created:/)).toBeNull();
    expect(view.getByTestId('detail-created')).toBeTruthy();
  });

  // Edit is a labelled button in the footer. The caption under the title was
  // a second name for it, in the place the eye lands first.
  test('the title carries no “Tap to edit” caption', async () => {
    const view = await open();
    expect(view.queryByText('Tap to edit')).toBeNull();
    expect(view.getByText('Edit')).toBeTruthy();
  });

  test('a heading does not announce that the verbs are verbs', async () => {
    const view = await open({}, { onContinue: jest.fn(), onStartPomodoro: jest.fn() });
    expect(view.queryByText('Actions')).toBeNull();
    expect(view.getByText('Continue today')).toBeTruthy();
    expect(view.getByText('Start Pomodoro')).toBeTruthy();
  });

  // A ticked recurring task names the day it was TICKED, which used to live
  // in the Details chip. Dropping the chip must not drop the fact.
  test('a ticked recurring task still says when it was done', async () => {
    // `isTaskDoneNow` only calls a repeater done while its last ticked
    // occurrence is TODAY or later — before that it is simply due again — so
    // the tick has to be today, and it lives under `meta`.
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const view = await open({
      recurring: 'weekly',
      // The already-ADVANCED next due date, which is what made the old card
      // read "completed it, so why does it say due next week?".
      dueDate: '2099-01-01',
      meta: { completedDates: [today] },
    });
    expect(view.getByText(/^Done · /)).toBeTruthy();
    expect(view.queryByText('Fri, Jan 1')).toBeNull();
  });
});

/**
 * /friends is everyone EXCEPT you, so a card that resolved names from it
 * alone printed your raw user id — "user_owner" — whenever the person
 * involved was you. The screen's member map merges /me for that reason.
 */
describe('a person involved reads as a name', () => {
  const withPeople = (memberOf) => render(
    <TaskDetail
      task={{ ...task, involvedUsers: ['user_owner'] }}
      visible
      onClose={jest.fn()}
      memberOf={memberOf}
    />,
  );

  test('it asks the screen’s map, which knows about you too', async () => {
    const memberOf = jest.fn((id) => (id === 'user_owner' ? { id, name: 'Mark' } : null));
    const view = await withPeople(memberOf);
    expect(memberOf).toHaveBeenCalledWith('user_owner');
    expect(view.getByText('Mark')).toBeTruthy();
    expect(view.queryByText('user_owner')).toBeNull();
  });

  // Still loading, or a member who has since left: a word, never the id.
  test('an unresolved person is “Member”, never a raw id', async () => {
    const view = await withPeople(() => null);
    expect(view.getByText('Member')).toBeTruthy();
    expect(view.queryByText('user_owner')).toBeNull();
  });

  test('and the section carries no “edit in the full editor” small print', async () => {
    const view = await withPeople(() => ({ name: 'Mark' }));
    expect(view.queryByText('edit in the full editor')).toBeNull();
  });
});
