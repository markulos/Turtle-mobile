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

describe('the icon is drawn in both inks, and follows the chip', () => {
  const { Text } = require('react-native');
  const { StyleSheet } = require('react-native');
  /** Every style in the rendered tree, flattened. */
  const stylesIn = (view) => {
    const out = [];
    const walk = (n) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) { n.forEach(walk); return; }
      out.push(StyleSheet.flatten(n.props && n.props.style) || {});
      walk(n.children);
    };
    walk(view.toJSON());
    return out;
  };
  const opacitiesIn = (view) => stylesIn(view).map((st) => st.opacity).filter((o) => typeof o === 'number');
  const scaleIn = (view) => stylesIn(view).find((st) => Array.isArray(st.transform)).transform[0].scale;

  const draw = async (props) => {
    const view = await render(
      <TabBarIcon focused={false} slot={2} active={<Text>ON</Text>} inactive={<Text>OFF</Text>} {...props} />,
    );
    return { view, on: view.getByText('ON'), off: view.getByText('OFF') };
  };

  test('both layers are always in the tree — there has to be something to cross-fade', async () => {
    const { on, off } = await draw({ chipPos: { value: 2 } });
    expect(on).toBeTruthy();
    expect(off).toBeTruthy();
  });

  test('the chip centred on this slot: fully in the active ink', async () => {
    const { view } = await draw({ chipPos: { value: 2 } });
    const opacities = opacitiesIn(view);
    expect(opacities).toEqual(expect.arrayContaining([0, 1]));
  });

  test('the chip a whole slot away: fully in the resting ink, whatever `focused` says', async () => {
    // `focused` flips at React\'s commit; the chip has not got here yet.
    const { view } = await draw({ chipPos: { value: 3 }, focused: true });
    expect(scaleIn(view)).toBe(1);
  });

  test('half-way across, the ink is half-way too — not a step', async () => {
    const { view } = await draw({ chipPos: { value: 2.5 } });
    const opacities = opacitiesIn(view);
    for (const o of opacities) {
      expect(o).toBeGreaterThan(0);
      expect(o).toBeLessThan(1);
    }
  });

  test('before the chip\'s position is known it falls back to `focused`', async () => {
    const { view } = await draw({ chipPos: { value: -1 }, focused: true });
    expect(scaleIn(view)).toBeCloseTo(1.04, 5);
  });
});
