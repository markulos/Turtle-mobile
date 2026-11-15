import { hexToHsl } from '../accentColor';
import {
  NEU_BLUR, NEU_GAP, NEU_OFFSET, neuPressed, neuRaised, neuTones,
} from '../neumorph';

/**
 * The one rule this style is: an element is the SAME COLOUR as its page, and
 * only the light tells them apart. Everything here checks that rule survives
 * — a tinted fill, a neutral-grey shadow or a single shadow would each turn
 * it back into an ordinary card wearing soft edges.
 */

const PANEL_DARK = '#241F1D';   // the focus page's charcoal
const PANEL_LIGHT = '#E8E6E1';

describe('neumorphic surfaces', () => {
  test('THE SHADING STAYS ON ITS OWN PANEL — reach must not cross the gap', () => {
    // The style's claim is that the panel IS the page, extruded. A shadow
    // that reaches past the gutter lands on the NEXT panel's highlight, and
    // what pools in between is a dark smudge belonging to nothing — which is
    // something a continuous surface cannot do, and a floating card can.
    // It shipped at 6 + 14 = 20 against a 10pt gap and Mark circled the
    // result.
    expect(NEU_OFFSET + NEU_BLUR).toBeLessThanOrEqual(NEU_GAP);
    // …and still far enough to read as raised at arm's length. The illusion
    // needs the DIRECTION, not the distance, but it does need both tones.
    expect(NEU_OFFSET).toBeGreaterThan(0);
    expect(NEU_BLUR).toBeGreaterThan(NEU_OFFSET);
  });

  test('the surface keeps its own colour — there is no fill change', () => {
    // If the element is a different colour from its page, the light is
    // decoration on a card rather than the thing that makes the shape.
    expect(neuRaised(PANEL_DARK, 'dark').backgroundColor).toBe(PANEL_DARK);
    expect(neuPressed(PANEL_DARK, 'dark').backgroundColor).toBe(PANEL_DARK);
  });

  test('RAISED is lit above-left and shadowed below-right', () => {
    const { boxShadow } = neuRaised(PANEL_LIGHT, 'light');
    expect(boxShadow).toHaveLength(2);
    const [cast, lit] = boxShadow;
    // Shadow away from the light…
    expect(cast.offsetX).toBe(NEU_OFFSET);
    expect(cast.offsetY).toBe(NEU_OFFSET);
    // …highlight toward it.
    expect(lit.offsetX).toBe(-NEU_OFFSET);
    expect(lit.offsetY).toBe(-NEU_OFFSET);
    // Soft: a hard edge is a drop shadow, which is the other style.
    expect(cast.blurRadius).toBe(NEU_BLUR);
    expect(cast.inset).toBeUndefined();
  });

  test('PRESSED is the same two tones, inside and swapped', () => {
    // The swap IS the dent: shadow where the light was, light where the
    // shadow was. Same geometry, opposite reading.
    const up = neuRaised(PANEL_LIGHT, 'light');
    const down = neuPressed(PANEL_LIGHT, 'light');
    for (const s of down.boxShadow) expect(s.inset).toBe(true);
    const upAt = (x) => up.boxShadow.find((s) => s.offsetX === x).color;
    const downAt = (x) => down.boxShadow.find((s) => s.offsetX === x).color;
    expect(downAt(NEU_OFFSET)).toBe(upAt(-NEU_OFFSET));
    expect(downAt(-NEU_OFFSET)).toBe(upAt(NEU_OFFSET));
  });

  test('both tones are the SURFACE’S OWN colour, moved only in lightness', () => {
    // Monochromatic is half the style. A neutral-grey shadow under a warm
    // charcoal panel is what makes this look cheap.
    //
    // Checked on a colour with room in it, because 8-bit hex cannot hold HSL
    // exactly: at #241F1D's lightness of 13 a round trip through hex moves
    // saturation a point on its own, and hue several — a near-grey has very
    // little of either left to round. That is quantisation, not the maths.
    const PANEL = '#3F6EA8';
    const base = hexToHsl(PANEL);
    const { lit, cast } = neuTones(PANEL, 'light');
    for (const tone of [hexToHsl(lit), hexToHsl(cast)]) {
      expect(Math.abs(tone.h - base.h)).toBeLessThanOrEqual(1);
      expect(Math.abs(tone.s - base.s)).toBeLessThanOrEqual(2);
    }
    expect(hexToHsl(lit).l).toBeGreaterThan(base.l);
    expect(hexToHsl(cast).l).toBeLessThan(base.l);
  });

  test('…and the charcoal panel stays warm, within what hex can hold', () => {
    // The page's actual colour, where the drift is largest. The claim worth
    // making here is only that it does not go COLD or neutral — a blue-grey
    // shadow under a warm panel is the visible failure.
    const base = hexToHsl(PANEL_DARK);
    const { lit, cast } = neuTones(PANEL_DARK, 'dark');
    for (const tone of [hexToHsl(lit), hexToHsl(cast)]) {
      // Still in the warm quadrant, and still carrying a tint.
      expect(tone.h).toBeGreaterThan(0);
      expect(tone.h).toBeLessThan(45);
      expect(tone.s).toBeGreaterThan(5);
    }
    expect(hexToHsl(lit).l).toBeGreaterThan(base.l);
    expect(hexToHsl(cast).l).toBeLessThan(base.l);
  });

  test('a dark surface leans on its SHADOW, a light one on its highlight', () => {
    // There is almost no room above a charcoal panel before it looks lit from
    // inside, and a great deal below it. On a pale page it is the other way
    // round. Symmetric tones read as one of the two being missing.
    const dark = neuTones(PANEL_DARK, 'dark');
    const light = neuTones(PANEL_LIGHT, 'light');
    const up = (t, base) => hexToHsl(t.lit).l - hexToHsl(base).l;
    const down = (t, base) => hexToHsl(base).l - hexToHsl(t.cast).l;
    expect(up(dark, PANEL_DARK)).toBeGreaterThan(down(dark, PANEL_DARK));
    expect(down(light, PANEL_LIGHT)).toBeGreaterThan(up(light, PANEL_LIGHT));
  });

  test('a colour it cannot read leaves the surface alone, with no shadows', () => {
    // This runs inside a render. A thrown error here takes the page down over
    // a malformed theme value, and a half-applied style is worse than none.
    for (const junk of [null, undefined, 'not a colour', '']) {
      const out = neuRaised(junk, 'light');
      expect(out.boxShadow).toBeUndefined();
      expect(out.backgroundColor).toBe(junk);
    }
  });

  test('lightness never leaves the scale', () => {
    // Black and white are the two surfaces with nowhere to go in one
    // direction; clamping is what stops a shadow wrapping to a highlight.
    for (const edge of ['#000000', '#FFFFFF']) {
      const { lit, cast } = neuTones(edge, 'light');
      for (const l of [hexToHsl(lit).l, hexToHsl(cast).l]) {
        expect(l).toBeGreaterThanOrEqual(0);
        expect(l).toBeLessThanOrEqual(100);
      }
    }
  });
});
