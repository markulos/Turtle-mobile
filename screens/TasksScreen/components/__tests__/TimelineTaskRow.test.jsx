import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { TimelineTaskRow } from '../TimelineTaskRow';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('../../../../context/ThemeContext', () => ({
  useTheme: () => ({
    timeFormat: '12h',
    theme: {
      mode: 'light',
      colors: {
        textPrimary: '#111827',
        textSecondary: '#64748B',
        textTertiary: '#94A3B8',
        surfaceElevated: '#FFFFFF',
        border: '#CBD5E1',
      },
    },
  }),
}));
jest.mock('../../../../utils/haptics', () => ({ tapHaptic: jest.fn() }));

describe('TimelineTaskRow', () => {
  test('renders shared owner identity and opens that owner profile', async () => {
    const item = {
      id: 'shared-1',
      title: 'Shared task',
      userId: 'user-alex',
      ownerName: 'Alex',
      dueDate: '2026-07-29',
    };
    const onOwnerPress = jest.fn();
    const view = await render(
      <TimelineTaskRow
        item={item}
        hideCountdown
        owner={{ name: 'Alex', color: '#7C3AED' }}
        onOwnerPress={onOwnerPress}
      />,
    );

    const ownerButton = view.getByLabelText('Owner: Alex. Open profile');
    expect(view.getByText('A')).toBeTruthy();

    await fireEvent.press(ownerButton);

    expect(onOwnerPress).toHaveBeenCalledWith(item);
  });
});
