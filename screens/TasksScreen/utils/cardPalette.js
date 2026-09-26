// Task cards are INSET DARK panels (docs/STYLE-RULES.md §1) in BOTH modes:
// a charcoal surface — never pitch black — with a hairline rim a touch
// lighter than the panel and a lit top edge (the light catching the edge of
// a recess), white text, muted captions. The Teenage-Engineering /
// Scandinavian read of the reference tile. No drop shadow: a recess casts
// none. On the light page the dark panel is what makes a task stand off the
// page; on the dark page it sits a step ABOVE the black so it still reads
// as a panel. TimelineTaskRow, TaskItem, the board rail, the Overview tiles
// and the countdown badge all draw from this one palette.
export function insetCardPalette(theme) {
  const dark = theme?.mode === 'dark';
  return dark
    ? {
      /** Charcoal, a step above the black page. */
      card: '#17171A',
      text: '#F2F2F4',
      sub: 'rgba(255,255,255,0.68)',
      muted: 'rgba(255,255,255,0.48)',
      border: 'rgba(255,255,255,0.10)',
      field: 'rgba(255,255,255,0.07)',
      track: 'rgba(255,255,255,0.14)',
      /** Text drawn ON a `text`-coloured badge — i.e. the card colour. */
      onText: '#17171A',
      /** The rim: a hairline lighter than the panel, all the way round. */
      edge: 'rgba(255,255,255,0.11)',
      /** The lit top edge of the recess. */
      edgeTop: 'rgba(255,255,255,0.17)',
      /** Small icon tile inside a card (the cup in the reference). */
      tile: '#242429',
      shadow: {},
    }
    : {
      /** Charcoal on the white page — dark, not black. */
      card: '#1F2024',
      text: '#FFFFFF',
      sub: 'rgba(255,255,255,0.72)',
      muted: 'rgba(255,255,255,0.50)',
      border: 'rgba(255,255,255,0.10)',
      field: 'rgba(255,255,255,0.08)',
      track: 'rgba(255,255,255,0.16)',
      onText: '#1F2024',
      edge: 'rgba(255,255,255,0.12)',
      edgeTop: 'rgba(255,255,255,0.20)',
      tile: '#2C2D33',
      shadow: {},
    };
}

/** @deprecated name kept for one release; the palette is inset, not inverted. */
export const invertedCardPalette = insetCardPalette;

// ── Board-coloured cards ────────────────────────────────────────────────────
// The agenda's cards wear their BOARD: a card with no board is the PLAIN card
// above — the dark panel, unchanged — and a board's card is that board's
// colour laid over it. With a dozen boards in rotation the fill has to
// identify the board at a glance WITHOUT fighting the white title sitting on
// it, so the colour is mixed into the dark base rather than used neat: a deep
// version of the board's hue, not a billboard. One constant per mode, so the
// whole set dials up or down together.
const BOARD_TINT_LIGHT = 0.32;
const BOARD_TINT_DARK = 0.34;

const parseHex = (hex) => {
  const h = String(hex || '').trim().replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};

/**
 * `over` laid on `base` at strength `t` (0 = base, 1 = over), as #RRGGBB.
 * Returns `base` unchanged for anything it can't read — a board colour that
 * isn't a plain hex (an rgba() theme token, say) degrades to the plain card
 * instead of painting `NaN` and blanking the row.
 */
export function mixHex(base, over, t) {
  const a = parseHex(base);
  const b = parseHex(over);
  if (!a || !b) return base;
  const k = Math.max(0, Math.min(1, t));
  const ch = (i) => Math.round(a[i] + (b[i] - a[i]) * k).toString(16).padStart(2, '0');
  return `#${ch(0)}${ch(1)}${ch(2)}`;
}

/**
 * A card palette in the shape `insetCardPalette` returns, but filled with the
 * board's colour. `color` null/absent → the plain card, VERBATIM: a boardless
 * row is exactly the dark panel every other card in the app is, which is why
 * this returns the inset palette itself rather than a reconstruction of it.
 *
 * A board's card is that panel with the board's colour mixed in. Everything
 * else — the white ink, the muted caption, the absent shadow (a recess casts
 * none) — is inherited untouched, so one board's card and the next differ in
 * exactly one thing: hue.
 *
 * The INK therefore never has to be recomputed per colour: the fill is mostly
 * the dark base, so white text is readable on every board from navy to
 * lemon-yellow without a per-colour contrast dance.
 */
export function boardCardPalette(theme, color) {
  const inset = insetCardPalette(theme);
  if (!color) return inset;

  const base = inset.card;
  const card = mixHex(base, color, theme?.mode === 'dark' ? BOARD_TINT_DARK : BOARD_TINT_LIGHT);
  // Unreadable colour → mixHex hands the base straight back, and a "tinted"
  // card identical to the plain one should just BE the plain one.
  if (card === base) return inset;

  return {
    ...inset,
    card,
    /** Text drawn ON a `text`-coloured badge — i.e. this card's own colour. */
    onText: card,
    // The rim and the lit top edge: the card's own colour lifted toward white,
    // the same relationship the plain panel has with its charcoal.
    edge: mixHex(card, '#FFFFFF', 0.20),
    edgeTop: mixHex(card, '#FFFFFF', 0.30),
    tile: mixHex(card, '#FFFFFF', 0.10),
  };
}
