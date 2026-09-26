/**
 * The agenda's time bubble opens this. Two panels, and WHICH one it lands on
 * is the whole design: a row that already has a day only wants a new hour, a
 * row with no day needs the day first or the hour means nothing.
 */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { SchedulePickerSheet, buildMonthGrid, toDateKey } from '../SchedulePickerSheet';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
}));
jest.mock('../../../../context/ThemeContext', () => ({
  useTheme: () => ({
    timeFormat: '12h',
    theme: {
      mode: 'dark',
      colors: {
        background: '#000',
        surface: '#111',
        surfaceElevated: '#1c1c1e',
        surfaceHighlight: '#222',
        textPrimary: '#fff',
        textSecondary: '#aaa',
        textTertiary: '#888',
        textMuted: '#666',
        accentInfo: '#60A5FA',
        border: '#333',
      },
    },
  }),
}));

// The sheet's exit is animated and the commit fires in the animation's
// callback — drive RN's Animated off timers so a press resolves in the test.
jest.useFakeTimers();
const settle = () => { jest.runOnlyPendingTimers(); };

const dated = { id: 't1', title: 'Confession', dueDate: '2026-10-02', time: '19:20' };
const undated = { id: 't2', title: 'Someday' };

describe('buildMonthGrid', () => {
  test('pads the first week so day 1 falls under its weekday', () => {
    // 1 Oct 2026 is a Thursday → four blanks (Sun..Wed) ahead of it.
    const cells = buildMonthGrid(2026, 9);
    const lead = cells.filter((c) => c.blank).length;
    expect(lead).toBe(4);
    expect(cells[lead].day).toBe(1);
    expect(cells[lead].dateKey).toBe('2026-10-01');
  });

  test('ends on the real last day of the month, not a rolled-over one', () => {
    expect(buildMonthGrid(2026, 1).filter((c) => !c.blank).length).toBe(28); // Feb 2026
    expect(buildMonthGrid(2024, 1).filter((c) => !c.blank).length).toBe(29); // leap
  });
});

describe('toDateKey', () => {
  test('is the LOCAL day — the bug toISOString would reintroduce every evening', () => {
    // 23:30 local on 2 Oct is already 3 Oct in UTC east of nothing but is
    // still the 2nd to the person tapping.
    expect(toDateKey(new Date(2026, 9, 2, 23, 30))).toBe('2026-10-02');
  });
});

describe('SchedulePickerSheet', () => {
  test('a dated row opens on the TIME panel and Set keeps its day', async () => {
    const onSubmit = jest.fn();
    const view = await render(
      <SchedulePickerSheet visible task={dated} onSubmit={onSubmit} onClose={jest.fn()} />,
    );
    // Landed on time: the commit button commits rather than advancing.
    expect(view.getByLabelText('Set date and time')).toBeTruthy();
    expect(view.queryByLabelText('Next, choose a time')).toBeNull();

    await fireEvent.press(view.getByLabelText('Set date and time'));
    settle();
    expect(onSubmit).toHaveBeenCalledWith({ dueDate: '2026-10-02', time: '19:20' });
  });

  test('an undated row opens on the DATE panel and picking a day advances', async () => {
    const onSubmit = jest.fn();
    const view = await render(
      <SchedulePickerSheet visible task={undated} onSubmit={onSubmit} onClose={jest.fn()} />,
    );
    // Panel one: the right-hand button moves on, it does not save.
    expect(view.getByLabelText('Next, choose a time')).toBeTruthy();

    await fireEvent.press(view.getByLabelText(toDateKey(new Date())));
    settle();
    // Panel two, with the day now chosen.
    expect(view.getByLabelText('Set date and time')).toBeTruthy();
  });

  test('nothing is written until Set — the panels edit a draft', async () => {
    const onSubmit = jest.fn();
    const onClose = jest.fn();
    const view = await render(
      <SchedulePickerSheet visible task={undated} onSubmit={onSubmit} onClose={onClose} />,
    );
    await fireEvent.press(view.getByLabelText(toDateKey(new Date())));
    settle();
    await fireEvent.press(view.getByText('Cancel'));
    settle();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  test('"No time" keeps the day and clears the clock', async () => {
    const onSubmit = jest.fn();
    const view = await render(
      <SchedulePickerSheet visible task={dated} onSubmit={onSubmit} onClose={jest.fn()} />,
    );
    await fireEvent.press(view.getByLabelText('Save without a time'));
    settle();
    expect(onSubmit).toHaveBeenCalledWith({ dueDate: '2026-10-02', time: '' });
  });

  test('closed, it renders nothing at all', async () => {
    const view = await render(
      <SchedulePickerSheet visible={false} task={null} onSubmit={jest.fn()} onClose={jest.fn()} />,
    );
    expect(view.toJSON()).toBeNull();
  });
});
