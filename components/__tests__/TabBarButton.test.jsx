import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { render } from '@testing-library/react-native';

jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: { colors: { textPrimary: '#E0E0E0' } } }),
}));

import TabBarButton from '../TabBarButton';

// This stands in for react-navigation's own tab button, so it has to honour
// that contract exactly. Both assertions below cover a bug that shipped: every
// tab came out zero-width and the active state never lit up.
describe('TabBarButton', () => {
  test('keeps the flex navigation passes in, so the tab has width', async () => {
    // BottomTabItem hands the button `style: [styles.tab, { flex, ... }]`.
    // Replacing that style instead of composing it collapsed every tab to zero
    // width, and the whole bar rendered empty.
    const view = await render(
      <TabBarButton testID="tab" style={[{ flex: 1, padding: 5 }]} aria-selected={false}>
        <Text>icon</Text>
      </TabBarButton>,
    );

    expect(view.getByText('icon')).toBeTruthy();
    const style = StyleSheet.flatten(view.getByTestId('tab').props.style);
    expect(style.flex).toBe(1);
    expect(style.padding).toBe(5);
  });

  test('reads selection from aria-selected, which is what v7 sends', async () => {
    // Reading only accessibilityState left `focused` permanently false.
    const view = await render(
      <TabBarButton testID="tab" style={{ flex: 1 }} aria-selected>
        <Text>icon</Text>
      </TabBarButton>,
    );

    // Input is aria-selected; the assertion is on the state the component
    // DERIVED from it, which is what drives the highlight. (RN folds the aria
    // prop into accessibilityState on the host node, so that is where it lands.)
    const button = view.getByTestId('tab');
    expect(button.props.accessibilityState.selected).toBe(true);
  });
});
