import React from 'react';
import { StyleSheet } from 'react-native';
import { act, render } from '@testing-library/react-native';

import Grain, { FINE_GRAIN, GRAIN_OPACITY, GRAIN_TILE, grainTiles } from '../Grain';

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
    // A whole phone page, and a small stat tile — worked out from the tile
    // size rather than written down, so changing the art cannot leave this
    // asserting yesterday's arithmetic.
    expect(grainTiles(390, 900))
      .toEqual([Math.ceil(390 / GRAIN_TILE), Math.ceil(900 / GRAIN_TILE)]);
    expect(grainTiles(GRAIN_TILE - 1, GRAIN_TILE - 1)).toEqual([1, 1]);
  });

  test('nothing is laid down before it has been measured', () => {
    // onLayout has not fired on the first pass. Laying a fixed grid "just in
    // case" is how a small tile ends up with dozens of discarded quads.
    expect(grainTiles(0, 0)).toEqual([0, 0]);
    expect(grainTiles(-5, 100)).toEqual([0, 1]);
  });

  test('the art ships at every density, all the same size in POINTS', () => {
    // This is what makes the speckle FINE rather than blocky: at @3x one
    // speckle is one device pixel. A single-density asset draws 1pt blocks,
    // which is what Mark was looking at. The three files must agree on the
    // point size or the tiles stop meeting edge to edge and the repeat is
    // no longer seamless.
    const fs = require('fs');
    const path = require('path');
    const dir = path.resolve(__dirname, '..', '..', 'assets');
    const px = (file) => {
      const b = fs.readFileSync(path.join(dir, file));
      return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    };
    for (const [file, scale] of [['grain.png', 1], ['grain@2x.png', 2], ['grain@3x.png', 3]]) {
      const { w, h } = px(file);
      expect(w).toBe(h);
      expect(w / scale).toBe(GRAIN_TILE);
    }
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

  test('the SETTING scales it, and Off draws nothing at all', async () => {
    // Settings → Appearance. A multiplier on the designed opacity rather than
    // an opacity itself, so a surface keeps its relative weights and one
    // control moves all of them.
    const half = await render(<Grain level={0.5} />);
    expect(flat(clipOf(half)).opacity).toBeCloseTo(GRAIN_OPACITY * 0.5);

    // Off is off: nothing rendered, not a transparent layer still measuring
    // itself and laying tiles nobody can see.
    const off = await render(<Grain level={0} />);
    expect(off.queryByTestId('grain-clip', HIDDEN)).toBeNull();
  });

  test('`fine` is a LIGHTER DUSTING of the same tooth, not a smaller one', async () => {
    // Mark, 2026-11-16: a panel should be "a lighter colour and finer grain"
    // than the ground it sits on. The speckle is already one device pixel at
    // @3x and cannot be drawn smaller, so finer means less of it.
    const coarse = await render(<Grain />);
    const fine = await render(<Grain fine />);
    expect(flat(clipOf(fine)).opacity).toBeCloseTo(GRAIN_OPACITY * FINE_GRAIN);
    expect(flat(clipOf(fine)).opacity).toBeLessThan(flat(clipOf(coarse)).opacity);
    // The art is untouched: both lay the same tile at the same size, or the
    // two surfaces would have visibly different textures rather than the
    // same one at two weights.
    expect(grainTiles(390, 900)).toEqual(grainTiles(390, 900));
  });

  test('…and the setting still moves BOTH, with Off still off everywhere', async () => {
    // A second opacity would have let a panel keep its speckle after the
    // ground lost it. It is a multiplier on the same number.
    const half = await render(<Grain level={0.5} fine />);
    expect(flat(clipOf(half)).opacity).toBeCloseTo(GRAIN_OPACITY * 0.5 * FINE_GRAIN);
    const off = await render(<Grain level={0} fine />);
    expect(off.queryByTestId('grain-clip', HIDDEN)).toBeNull();
  });

  test('TINT recolours the speckle without touching its alpha', async () => {
    // Anodized, not brushed: the art is grey noise, so a tint is what turns
    // aluminium into aluminium anodized in a colour. The alpha channel is
    // the texture itself and must survive — tinting the IMAGE rather than
    // washing a colour over it is what keeps it.
    // Nothing is laid until the clip has been measured, so the layout has
    // to be fired before there is an Image to look at (see the tiling
    // tests above).
    const laid = async (node) => {
      const view = await render(node);
      await act(async () => {
        clipOf(view).props.onLayout({ nativeEvent: { layout: { width: 200, height: 100 } } });
      });
      return view;
    };
    const plain = await laid(<Grain />);
    expect(plain.getByTestId('grain', HIDDEN).props.tintColor).toBeUndefined();
    const anodized = await laid(<Grain tint="#58665D" />);
    expect(anodized.getByTestId('grain', HIDDEN).props.tintColor).toBe('#58665D');
    // …and the strength is still the setting, not the tint.
    expect(flat(clipOf(anodized)).opacity).toBe(GRAIN_OPACITY);
  });
  test('a level it cannot read falls back to the designed strength', async () => {
    // A surface with its texture silently off looks like a bug, not like a
    // preference — so junk means "as designed", never "none".
    for (const junk of [undefined, null, NaN, 'lots']) {
      const view = await render(<Grain level={junk} />);
      expect(flat(clipOf(view)).opacity).toBe(GRAIN_OPACITY);
    }
  });

  test('a square surface asks for no radius and still clips', async () => {
    const view = await render(<Grain />);
    const w = flat(clipOf(view));
    expect(w.borderRadius).toBe(0);
    expect(w.overflow).toBe('hidden');
  });
});
