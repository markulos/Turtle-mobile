import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

import Grain, { GRAIN_OPACITY, GRAIN_TILE, grainTiles } from '../Grain';

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

describe('Grain', () => {
  test('the CLIP is on a wrapper, not on the Image', async () => {
    // borderRadius on an Image does not reliably clip a repeating fill. A
    // parent with overflow: hidden clips whatever it holds, always.
    const view = await render(<Grain radius={24} />);
    const w = flat(clipOf(view));
    expect(w.overflow).toBe('hidden');
    expect(w.borderRadius).toBe(24);
    // …and it is also what gives onLayout something to measure, which is
    // where the tile count comes from.
    expect(typeof clipOf(view).props.onLayout).toBe('function');
  });

  test('IT COVERS THE WHOLE SURFACE — the count comes from the measurement', () => {
    // The bug, twice: the texture drew once at its own size in the top-left
    // corner and left the rest of the panel bare. Nothing on screen tells you
    // that — a half-covered panel renders perfectly happily — so the arithmetic
    // is what gets pinned.
    expect(grainTiles(GRAIN_TILE, GRAIN_TILE)).toEqual([1, 1]);
    // A surface one point wider than a tile needs a second column, not a
    // stretched tile: the speckle must never scale.
    expect(grainTiles(GRAIN_TILE + 1, GRAIN_TILE)).toEqual([2, 1]);
    // A whole phone page, and a small stat tile.
    expect(grainTiles(390, 900)).toEqual([2, 4]);
    expect(grainTiles(165, 105)).toEqual([1, 1]);
  });

  test('nothing is laid down before it has been measured', () => {
    // onLayout has not fired on the first pass. Laying a fixed grid "just in
    // case" is how a small tile ends up with dozens of discarded quads.
    expect(grainTiles(0, 0)).toEqual([0, 0]);
    expect(grainTiles(-5, 100)).toEqual([0, 1]);
  });

  test('tiles are laid at 1:1, so the speckle is the same size everywhere', async () => {
    const view = await render(<Grain />);
    // Before layout there is nothing to assert on; after it, every tile is
    // the art's own size — no resizeMode, nothing to scale it.
    expect(GRAIN_TILE).toBeGreaterThan(0);
    expect(view.queryByTestId('grain', HIDDEN)).toBeNull();
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
