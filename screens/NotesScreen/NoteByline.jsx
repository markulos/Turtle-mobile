/**
 * Who a note belongs to, at the top of its card.
 *
 * The AUTHOR's face first, then the people it is shared with, overlapping and
 * tucked behind it — the same reading order a task row has, where the first disc
 * answers "whose is this" and the ones behind it answer "who else is on it".
 *
 * The stack TRAILS the name so it lands on the card's right edge, at the same x
 * on every row. With it leading, the row ended at the end of the name and the
 * discs drifted with how long that person's name happened to be — which is no
 * good for the one thing you scan down a list for.
 *
 * The server stamps `notes.user_id` at creation and owner-backfills legacy rows,
 * so every note carries an author and this row is never empty for a real note.
 * `involvedUsers` is the shared-with list and arrives as IDS ONLY — resolving it
 * server-side would be a join per note — so the names and pictures come from
 * usePondPeople, which asks once for the whole app rather than once per card.
 *
 * ── Why FaceStack and not an avatar drawn here ────────────────────────────
 * This row used to draw its own disc: a photo, or the author's initial on a
 * hand-rolled userId→hue hash. FaceStack already owns all of that and more — the
 * overlap, the ring that stops two dark discs merging into one blob, explicit
 * first-on-top z-order, the generated disc UNDER a photo rather than instead of
 * it (so a picture still loading shows a face, not a hole), and the "+n" for
 * whoever does not fit. It is the app's one definition of this row
 * (STYLE-RULES §5), and a second hand-rolled avatar is exactly how two surfaces
 * that should match start to drift.
 *
 * Its own file rather than markup inside index.jsx so it can be rendered in a
 * test without the screen's entire native graph coming with it.
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import FaceStack from '../../components/FaceStack';
import { useTheme } from '../../context/ThemeContext';
import { useServer } from '../../context/ServerContext';
import { stackWidth } from '../../utils/faceStack';
import usePondPeople from '../../utils/usePondPeople';
import { notePeopleLabel, notePeopleRoster } from '../../utils/notePeople';

/**
 * Face size for the byline.
 *
 * Larger than the 18pt disc this row started as: at the BOTTOM of a card, beside
 * a 10pt timestamp, the faces are the only thing in that line you are meant to
 * read at a glance, and 18 made them read as punctuation.
 */
export const BYLINE_FACE = 22;

/** Past four, discs stop reading as faces at all; the rest become a "+n". */
const BYLINE_MAX_FACES = 4;

/**
 * The room this row gives its stack.
 *
 * FaceStack's contract is that WIDTH decides, because a stack cannot shrink or
 * ellipsize and would otherwise push a caption off the end of its card. Here that
 * danger is already handled — the name beside it is `numberOfLines={1}` with
 * `flexShrink: 1`, so it narrows instead of being pushed — which makes the honest
 * answer "as much as this stack could ever want".
 *
 * That is MAX_FACES + 1 discs, not MAX_FACES: `facesThatFit` has to fit the "+n"
 * inside the room it is given too, so a budget of exactly four discs yields three
 * faces and a "+n" the moment a note has five people on it. The extra disc's
 * worth is what buys the fourth FACE. Written as the arithmetic rather than as a
 * number so it tracks the size above.
 *
 * Deliberately NOT measured with onLayout: that renders no faces at all on the
 * first frame and then pops them in, and a correction downward drops one.
 */
export const BYLINE_FACE_ROOM = stackWidth(BYLINE_MAX_FACES + 1, BYLINE_FACE);

/**
 * @param tone  The colour the NAME is written in. A note card is filled with
 *   the chosen highlight, so the page's `textSecondary` grey on it reads as a
 *   different ink rather than as a quiet one — the card passes down the ink its
 *   own fill chose. Optional, because the card is the only caller that has a
 *   fill of its own; anywhere else the page's grey is still right.
 */
export default function NoteByline({ note, style, tone }) {
  const { theme } = useTheme();
  const { getBaseUrl } = useServer();
  const people = usePondPeople();
  const roster = useMemo(() => notePeopleRoster(note, people), [note, people]);

  // An author with neither a name nor a picture is a row with nothing to say.
  // Checked on the NOTE rather than on the roster: a note whose author never
  // resolved should stay silent even if it lists collaborators.
  const author = note && note.sharedBy;
  if (!author || (!author.name && !author.avatarUrl)) return null;

  // The whole ROW carries the spoken label, not the stack: FaceStack only
  // announces itself when it is PRESSABLE, and overlapped discs are not something
  // you can aim at, so this one is not. Reading the faces and the name as one
  // phrase is also what someone hearing the card actually wants.
  return (
    <View
      style={[styles.row, style]}
      testID="note-byline"
      accessible
      accessibilityLabel={notePeopleLabel(roster)}
    >
      {/* The name comes FIRST so the faces can be LAST, which is what pins them
          to the right edge of the card.
          
          With the stack leading, the row's right edge was the end of the NAME —
          so the discs landed at a different x on every card, drifting with how
          long that person's name happened to be. Trailing them anchors the one
          thing you track down a list. The name ellipsizes into whatever is left. */}
      <Text
        numberOfLines={1}
        testID="note-byline-name"
        style={[styles.name, { color: tone || theme.colors.textSecondary }]}
      >
        {author.name || 'Member'}
      </Text>
      <FaceStack
        people={roster}
        available={BYLINE_FACE_ROOM}
        size={BYLINE_FACE}
        max={BYLINE_MAX_FACES}
        theme={theme}
        baseUrl={getBaseUrl()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Everything packs to the RIGHT, so the stack's right edge is the card's and
  // sits at the same x on every row.
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6 },
  // Narrows before the faces do — a stack cannot shrink, a name can.
  name: { flexShrink: 1, textAlign: 'right', fontSize: 11.5, fontWeight: '600' },
});
