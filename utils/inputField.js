/**
 * INPUT_FIELD — the style every single-line TextInput in this app spreads.
 *
 * ─── The rule ───────────────────────────────────────────────────────────────
 *
 * A text field NEVER declares its own height. The row around it does, with
 * `alignItems: 'center'`, and the input sits on that centre line. Give the
 * input a height as well and you are asking two different layout systems to
 * agree about one baseline: the row centres the box, then the platform places
 * the text inside that box by its own rules, and the placeholder, the value and
 * the caret stop landing on the same line. That was the Login screen's invite
 * field — `height: '100%'` inside a 52px row.
 *
 * ─── What each line is for ──────────────────────────────────────────────────
 *
 *   paddingVertical: 0      Android gives a TextInput vertical padding of its
 *                           own, on top of whatever the row already reserves.
 *                           iOS does not, so this is what stops the two
 *                           platforms disagreeing by a few pixels.
 *   textAlignVertical       Android only, and the actual centring instruction
 *                           there — without it the text hugs the top of its box.
 *   includeFontPadding      Android only. Reserves room for ascenders and
 *                           descenders no glyph in the string may use, which
 *                           shifts short text off the centre it was placed on.
 *
 * Spread it, then add the things that ARE the field's own business — flex,
 * fontSize, colour:
 *
 *   input: { ...INPUT_FIELD, flex: 1, fontSize: 16 }
 *
 * A multi-line input is a different animal and is deliberately out of scope:
 * it grows with its content, so it does own its height and `textAlignVertical`
 * should usually be 'top' instead.
 *
 * ─── Why it lives here and not in ThemeContext ──────────────────────────────
 *
 * It is a plain object with no colour in it, so it needs nothing from the
 * theme. Putting it there meant every consumer imported ThemeContext, which
 * reaches AsyncStorage at module load — enough to break a test that had no
 * business knowing about storage. A constant this small should cost nothing to
 * depend on.
 */
export const INPUT_FIELD = {
  paddingVertical: 0,
  textAlignVertical: 'center',
  includeFontPadding: false,
};
