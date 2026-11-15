import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

import Grain, { GRAIN_OPACITY } from '../Grain';

/**
 * What broke on the phone, pinned.
 *
 * The first version was a bare `<Image absoluteFill resizeMode="repeat"
 * borderRadius=…>` and it drew ONE 128pt square anchored top-left of each
 * panel — square corners over rounded ones, hanging off the edges. Neither
 * failure is visible in jest: the style was valid, the component rendered,
 * and every assertion anyone would have written about it passed.
 *
 * So these check the two STRUCTURAL facts that fix it, which are the things
 * a later tidy-up would undo without noticing: the clip is on a parent View,
 * and the Image fills that parent rather than carrying its own frame.
 */

const flat = (node) => StyleSheet.flatten(node.props.style) || {};
/**
 * The clip wrapper and the tile itself, by id — this RNTL has no by-type.
 *
 * `includeHiddenElements`: the whole component is correctly hidden from
 * assistive tech, which also hides it from RNTL's default queries.
 */
const HIDDEN = { includeHiddenElements: true };
const clipOf = (v) => v.getByTestId('grain-clip', HIDDEN);
const tileOf = (v) => v.getByTestId('grain', HIDDEN);

describe('Grain', () => {
  test('the CLIP is on a wrapper, not on the Image', async () => {
    // borderRadius on an Image does not reliably clip a repeating fill. A
    // parent with overflow: hidden clips whatever it holds, always.
    const view = await render(<Grain radius={24} />);
    const w = flat(clipOf(view));
    expect(w.overflow).toBe('hidden');
    expect(w.borderRadius).toBe(24);

    expect(flat(tileOf(view)).borderRadius).toBeUndefined();
  });

  test('the Image fills its wrapper, so the tiled area is never in doubt', async () => {
    const view = await render(<Grain />);
    const img = flat(tileOf(view));
    // An Image whose frame comes only from its own absoluteFill can lay the
    // tile out at its intrinsic size; the wrapper owns the frame instead.
    expect(img).toMatchObject(StyleSheet.flatten(StyleSheet.absoluteFillObject));
    expect(tileOf(view).props.resizeMode).toBe('repeat');
  });

  test('it is paint: no touches, and nothing to announce', async () => {
    const view = await render(<Grain />);
    const wrapper = clipOf(view);
    expect(wrapper.props.pointerEvents).toBe('none');
    expect(wrapper.props.accessibilityElementsHidden).toBe(true);
    expect(wrapper.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  test('the strength is one number, and the default is subtle', async () => {
    const view = await render(<Grain />);
    expect(flat(clipOf(view)).opacity).toBe(GRAIN_OPACITY);
    expect(GRAIN_OPACITY).toBeGreaterThan(0);
    // Texture, not noise: past about two thirds the speckle stops reading as
    // a surface and starts reading as a broken image.
    expect(GRAIN_OPACITY).toBeLessThanOrEqual(0.66);
  });

  test('a square surface asks for no radius and still clips', async () => {
    const view = await render(<Grain />);
    const w = flat(clipOf(view));
    expect(w.borderRadius).toBe(0);
    expect(w.overflow).toBe('hidden');
  });
});
