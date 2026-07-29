import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { TaskSectionFrontier } from '../TaskSectionFrontier';

jest.mock('../TaskCardSkeleton', () => ({
  TaskCardSkeletonCluster: () => null,
}));

const theme = {
  colors: {
    primary: '#2563EB',
    textSecondary: '#64748B',
  },
};

const items = (prefix) => Array.from(
  { length: 23 },
  (_, index) => ({ id: `${prefix}-${index + 1}`, title: `${prefix} ${index + 1}` }),
);

describe('TaskSectionFrontier', () => {
  test('expands To-Do independently while both sections remain bounded by default', async () => {
    const toDos = items('To-Do');
    const pending = items('Pending');
    const renderItem = (item) => <Text key={item.id}>{item.title}</Text>;

    const view = await render(
      <>
        <TaskSectionFrontier
          items={toDos}
          sectionLabel="To-Do"
          renderItem={renderItem}
          theme={theme}
        />
        <TaskSectionFrontier
          items={pending}
          sectionLabel="Pending"
          renderItem={renderItem}
          theme={theme}
        />
      </>,
    );

    expect(view.getByText('To-Do 20')).toBeTruthy();
    expect(view.queryByText('To-Do 21')).toBeNull();
    expect(view.getByText('Pending 20')).toBeTruthy();
    expect(view.queryByText('Pending 21')).toBeNull();

    await fireEvent.press(view.getByLabelText('Show more To-Do tasks'));

    expect(view.getByText('To-Do 23')).toBeTruthy();
    expect(view.queryByText('Pending 21')).toBeNull();
    expect(view.getByLabelText('Show more Pending tasks')).toBeTruthy();
  });
});
