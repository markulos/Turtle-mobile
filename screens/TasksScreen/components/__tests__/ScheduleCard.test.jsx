import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import ScheduleCard from '../ScheduleCard';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('../../../../utils/haptics', () => ({ tapHaptic: jest.fn(), impactHaptic: jest.fn() }));

const theme = {
  mode: 'light',
  colors: {
    textPrimary: '#111827',
    textSecondary: '#64748B',
    textTertiary: '#94A3B8',
    background: '#FFFFFF',
    surface: '#F1F5F9',
    surfaceElevated: '#FFFFFF',
  },
};

const task = { id: 't1', title: 'Apply to OAA Admissions Course', project: 'Architecture License' };

describe('ScheduleCard time column', () => {
  test('the time is a button when the row can be re-timed', async () => {
    const onTimePress = jest.fn();
    const view = await render(
      <ScheduleCard task={task} theme={theme} timeLabel="any time" range="" onTimePress={onTimePress} />,
    );

    await fireEvent.press(
      view.getByLabelText('Edit the time for Apply to OAA Admissions Course, currently any time'),
    );

    expect(onTimePress).toHaveBeenCalledWith(task);
  });

  // The Pending strip shows a due DATE in that column, so it passes no
  // handler — tapping a date must not open a time picker.
  test('the time is inert when no handler is given', async () => {
    const view = await render(<ScheduleCard task={task} theme={theme} timeLabel="09/18" range="" />);

    expect(view.getByText('09/18')).toBeTruthy();
    expect(
      view.queryByLabelText('Edit the time for Apply to OAA Admissions Course, currently 09/18'),
    ).toBeNull();
  });
});
