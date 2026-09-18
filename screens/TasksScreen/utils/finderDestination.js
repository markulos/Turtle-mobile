/**
 * finderDestination — the one line that says where a new task is about to land.
 *
 * The finder creates on the SELECTED DAY, in the CURRENTLY FILTERED BOARD, and
 * neither of those is visible once the field has focus and the results have
 * covered the panel. That is the whole reason this exists: you are typing a
 * title into a box, and the two facts that decide what happens when you hit
 * return are off screen.
 *
 * Shape is fixed:  TO-DO | Wed, Sep 16 • Ambarch
 *   - the kind first, so the line reads as a label rather than a date
 *   - a PIPE to the day, because those two are different sorts of thing
 *   - a BULLET to the board, because the day and the board are peers
 *
 * `board` falls back to a plain "All" when no board filter is on — that IS the
 * destination in that case (the task is created unfiled), and saying nothing
 * would leave the line looking truncated.
 */

export const KIND_SEP = ' | ';
export const FIELD_SEP = ' • ';
export const KIND_LABEL = 'TO-DO';

/** The unfiltered pseudo-boards, which are not real destinations. */
const NO_BOARD = new Set(['all', 'no project', '']);

export function finderDestination({ dateLabel, board, kind = KIND_LABEL } = {}) {
  const day = String(dateLabel || '').trim();
  const raw = String(board || '').trim();
  // Boolean, not the empty string `raw &&` would hand back — callers branch on
  // this and `filed === false` should mean what it says.
  const filed = Boolean(raw) && !NO_BOARD.has(raw.toLowerCase());
  const where = filed ? raw : 'All';

  return {
    kind,
    day,
    board: where,
    filed,
    // Pre-joined for the accessibility label, where the glyphs would be read
    // out as "vertical line" and "bullet" and help nobody.
    speech: [kind, day, where].filter(Boolean).join(', '),
    text: day
      ? `${kind}${KIND_SEP}${day}${FIELD_SEP}${where}`
      : `${kind}${KIND_SEP}${where}`,
  };
}

export default finderDestination;

/**
 * Did the header line get CUT OFF?
 *
 * `laidOut` is what RN's `onTextLayout` reports for the first line, `full` the
 * string we asked it to draw. A line that fitted reports back what it was
 * given; a truncated one reports less, plus an ellipsis. That is the only
 * reliable signal — a character count cannot know the screen width, the type
 * scale the user chose, or how much room the + key beside it is taking.
 *
 * Compared on LENGTH rather than equality: iOS hands back the ellipsis glyph
 * appended and Android sometimes trims differently, so "is it shorter than what
 * I gave it" is the question that survives both.
 */
export function wasTruncated(laidOut, full) {
  const shown = String(laidOut == null ? '' : laidOut).replace(/[……]/g, '').trim();
  const whole = String(full == null ? '' : full).trim();
  if (!shown || !whole) return false;
  return shown.length < whole.length;
}
