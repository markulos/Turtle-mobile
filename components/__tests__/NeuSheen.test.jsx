import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

// NOT `virtual` — the module is a real dependency, and marking it virtual
// let the real one win once another suite in the same run had loaded it. The
// real LinearGradient consumes `start`/`end` rather than forwarding them, so
// the assertions below saw undefined only in a full run.
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));

import NeuSheen, { SHEEN_ALPHA, SHEEN_REACH, sheenColors } from '../NeuSheen';
import { neuTones } from '../../utils/neumorph';

/**
 * The sheen is correctly hidden from assistive tech, which also hides it from
 * RNTL's default queries — the same allowance Grain.test makes.
 */
const HIDDEN = { includeHiddenElements: true };

/**
 * The light on a raised panel's upper face.
 *
 * Mark, 2026-11-16: "in focus, make the top of each panel tile be lighter
 * than the backdrop silver grain of the tab itself." On a page covered in
 * grain, tiles that are exactly the page's colour go missing in it — but the
 * fix has to stay LIGHT rather than becoming a two-tone fill, or §9's whole
 * claim (figure and ground share a colour) is gone.
 */

const LIGHT = '#EEECE9';
const DARK = '#241F1D';

describe('sheenColors', () => {
  test('the light is the panel’s OWN highlight tone, not a picked white', () => {
    // One light in the room. A hand-picked white would be a second source,
    // and on the dark page it would be the wrong one entirely.
    for (const [surface, mode] of [[LIGHT, 'light'], [DARK, 'dark']]) {
      const { lit } = neuTones(surface, mode);
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(lit.slice(1 + i, 3 + i), 16));
      expect(sheenColors(surface, mode)[0]).toBe(`rgba(${r},${g},${b},${SHEEN_ALPHA})`);
    }
  });

  test('…and it fades to NOTHING, so the panel keeps the page’s colour', () => {
    // The body of the tile is still exactly the ground. Only the top is lit,
    // which is what stops this reading as a gradient fill.
    for (const [surface, mode] of [[LIGHT, 'light'], [DARK, 'dark']]) {
      expect(sheenColors(surface, mode)[1]).toMatch(/,0\)$/);
    }
  });

  test('IT IS A LIT EDGE, not a gradient — short, and not opaque', () => {
    // Past about a third of the panel it stops being an edge catching the
    // light and becomes a two-tone fill, which is the thing every
    // neumorphic mock-up on the internet gets wrong.
    expect(SHEEN_REACH).toBeGreaterThan(0);
    expect(SHEEN_REACH).toBeLessThanOrEqual(0.4);
    expect(SHEEN_ALPHA).toBeLessThanOrEqual(1);
    expect(SHEEN_ALPHA).toBeGreaterThan(0.3);
  });

  test('a colour it cannot read draws nothing at all', async () => {
    // This renders inside a panel. A half-applied gradient over a surface is
    // worse than none, and a throw here takes the Focus tab down.
    for (const junk of [null, undefined, 'not a colour', '']) {
      expect(sheenColors(junk, 'light')).toBeNull();
      const view = await render(<NeuSheen colors={sheenColors(junk, 'light')} />);
      expect(view.queryByTestId('neu-sheen', HIDDEN)).toBeNull();
    }
  });
});

describe('NeuSheen', () => {
  test('straight down, and clipped to the panel it dresses', async () => {
    const view = await render(<NeuSheen colors={sheenColors(LIGHT, 'light')} radius={22} />);
    const g = view.getByTestId('neu-sheen', HIDDEN);
    // A diagonal on a wide tile lights one corner and leaves the other dark,
    // which reads as a crease rather than as a face.
    expect(g.props.start).toEqual({ x: 0, y: 0 });
    expect(g.props.end).toEqual({ x: 0, y: SHEEN_REACH });
    expect(StyleSheet.flatten(g.props.style).borderRadius).toBe(22);
  });

  test('it is paint: no touches, and nothing to announce', async () => {
    const view = await render(<NeuSheen colors={sheenColors(LIGHT, 'light')} />);
    const g = view.getByTestId('neu-sheen', HIDDEN);
    expect(g.props.pointerEvents).toBe('none');
    expect(g.props.accessibilityElementsHidden).toBe(true);
  });

  test('UNDER THE GRAIN, over the fill — on every panel of the Focus tab', () => {
    // The tooth belongs to the material, so it sits ON the lit face. Grain
    // first would put a film of speckle between a surface and its own light.
    const fs = require('fs');
    const path = require('path');
    const root = path.resolve(__dirname, '..', '..');
    for (const rel of ['screens/TasksScreen/components/FocusPage.jsx',
      'screens/TasksScreen/components/FocusStatsPanel.jsx']) {
      const src = fs.readFileSync(path.join(root, rel), 'utf8');
      const sheens = src.match(/<NeuSheen colors=\{sheen\} radius=\{(\d+)\} \/>/g) || [];
      expect(sheens.length).toBeGreaterThan(0);
      // Every one is immediately followed by the grain at the SAME radius.
      for (const tag of sheens) {
        const radius = /radius=\{(\d+)\}/.exec(tag)[1];
        const at = src.indexOf(tag);
        const after = src.slice(at + tag.length, at + tag.length + 120);
        expect(after).toContain(`<Grain level={grain} radius={${radius}} />`);
      }
    }
  });

  test('the PAGE is not lit — only the things standing out of it', () => {
    // The ground is the ground. A sheen on it would light the whole tab and
    // the tiles would go straight back to being invisible on it.
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'screens/TasksScreen/components/FocusPage.jsx'), 'utf8',
    );
    // The page's own grain carries no radius — and no sheen above it.
    const pageGrain = src.indexOf('<Grain level={grain} />');
    expect(pageGrain).toBeGreaterThan(-1);
    expect(src.slice(Math.max(0, pageGrain - 120), pageGrain)).not.toMatch(/<NeuSheen/);
  });
});
