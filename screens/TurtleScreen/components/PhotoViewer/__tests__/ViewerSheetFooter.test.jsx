/**
 * A sheet's FOOTER is a pinned bar, and the shell owns the space under it.
 *
 * The bug this pins: `bottomInset` / the safe-area inset only ever reached the
 * ScrollView's contentContainer — which sits INSIDE the scroll and never
 * reaches a footer — so every sheet that had one (the task card, the day
 * panel's inspector, the upload confirm) rested its buttons flush on the home
 * indicator. Mark called it on the task card: "the edit or delete shouldn't be
 * flush to the bottom of page."
 *
 * The footer now gets max(insets.bottom, bottomInset) + 12 pt, and footers
 * themselves declare no bottom padding.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import ViewerSheet from '../ViewerSheet';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));
jest.mock('expo-blur', () => {
  const { View } = require('react-native');
  return { BlurView: View };
});

const theme = { mode: 'dark', colors: { background: '#000', surface: '#111', textPrimary: '#fff', border: '#333', primary: '#3b82f6' } };

const padOf = (node) => {
  const style = Array.isArray(node.props.style)
    ? Object.assign({}, ...node.props.style.filter(Boolean))
    : (node.props.style || {});
  return style.paddingBottom;
};

describe('ViewerSheet footer clearance', () => {
  test('clears the home indicator plus 12 pt of air', async () => {
    const view = await render(
      <ViewerSheet title="Task" theme={theme} dark onClose={jest.fn()} testID="s" footer={<Text>Edit</Text>}>
        <Text>body</Text>
      </ViewerSheet>,
    );
    expect(padOf(view.getByTestId('s-footer'))).toBe(34 + 12);
  });

  test('a caller that names what sits under the sheet (a floating tab bar) wins over the inset', async () => {
    const view = await render(
      <ViewerSheet title="Task" theme={theme} dark onClose={jest.fn()} testID="s" bottomInset={82} footer={<Text>Edit</Text>}>
        <Text>body</Text>
      </ViewerSheet>,
    );
    expect(padOf(view.getByTestId('s-footer'))).toBe(82 + 12);
  });

  test('no footer, no wrapper — a sheet without one is untouched', async () => {
    const view = await render(
      <ViewerSheet title="Task" theme={theme} dark onClose={jest.fn()} testID="s">
        <Text>body</Text>
      </ViewerSheet>,
    );
    expect(view.queryByTestId('s-footer')).toBeNull();
  });
});
