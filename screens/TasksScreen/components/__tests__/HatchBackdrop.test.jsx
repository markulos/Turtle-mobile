import React from 'react';
import { render } from '@testing-library/react-native';
import { HatchBackdrop } from '../HatchBackdrop';

describe('HatchBackdrop', () => {
  test('keeps a visible deterministic hatch below one thousand glyph characters', async () => {
    const view = await render(<HatchBackdrop color="#7C3AED" />);
    const tree = view.toJSON();
    const textNode = tree.children[0];
    const hatchText = textNode.children.join('');

    expect(tree.type).toBe('View');
    expect(tree.children).toHaveLength(1);
    expect(textNode.type).toBe('Text');
    expect(hatchText.length).toBeLessThan(1000);
    expect((hatchText.match(/╱/g) || [])).toHaveLength(240);
  });
});
