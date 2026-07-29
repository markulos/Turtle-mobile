import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { TaskForm } from '../TaskForm';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
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
jest.mock('../ParticipantPicker', () => () => null);
jest.mock('../DatePickerModal', () => ({ DatePickerModal: () => null }));
jest.mock('../WheelTimePicker', () => ({ WheelTimePicker: () => null }));
jest.mock('../../../../utils/haptics', () => ({
  impactHaptic: jest.fn(),
  notifyHaptic: jest.fn(),
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
