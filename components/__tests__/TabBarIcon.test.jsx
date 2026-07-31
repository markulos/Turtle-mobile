import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';

import TabBarIcon from '../TabBarIcon';

// The whole point of this component is that the ICON still renders. A previous
// attempt at the same effect replaced react-navigation's tabBarButton and
// emptied the bar entirely, so the guarantee worth pinning is simply: whatever
// you hand it comes out the other side, focused or not.
describe('TabBarIcon', () => {
  test('renders its icon in both states', async () => {
    const active = await render(
      <TabBarIcon focused highlightColor="rgba(255,255,255,0.1)">
        <Text>glyph</Text>
      </TabBarIcon>,
    );
    expect(active.getByText('glyph')).toBeTruthy();

    const idle = await render(
      <TabBarIcon focused={false} highlightColor="rgba(255,255,255,0.1)">
        <Text>idle-glyph</Text>
      </TabBarIcon>,
    );
    expect(idle.getByText('idle-glyph')).toBeTruthy();
  });

  test('renders the brand variant without dropping the icon', async () => {
    const view = await render(
      <TabBarIcon focused brand highlightColor="rgba(255,255,255,0.16)">
        <Text>turtle</Text>
      </TabBarIcon>,
    );
    expect(view.getByText('turtle')).toBeTruthy();
  });
});
