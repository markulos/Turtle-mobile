/**
 * InboxCapture — the first thing on the Inbox tab, and the whole reason the tab
 * is called that.
 *
 * The page used to open on four statistics and a list of boards, which answers
 * questions you only have once you already use the app. The question a
 * first-time user actually has is "where do I put a thing", and the answer was
 * three taps away behind a floating key on another tab.
 *
 * So the page now opens on a field you can type into. One line, one key, no
 * decisions: no date picker, no board picker, no priority. Everything a task
 * might need can be added from the task itself afterwards, and asking for any of
 * it at capture time is exactly what stops people capturing.
 *
 * ─── IT IS NOT A CARD, AND THAT IS THE POINT ───────────────────────────────
 *
 * This sits directly on the page. Every other block on the tab is an inset dark
 * card (docs/STYLE-RULES.md §1) and this deliberately is not: a card is a THING
 * among other things, and the one affordance a blank-slate page should have is
 * not one more tile competing with four statistics. On the page, with room
 * around it, it reads as the page's own invitation.
 *
 * WHICH MEANS ITS INK IS THE PAGE'S. The inset palette's `text` is WHITE in both
 * modes — the cards are charcoal even on the light page — so a block that takes
 * those colours while sitting on the page is invisible in light mode. That is
 * not hypothetical: the Focus tab shipped a whole ring, clock and Start key that
 * way. Everything here reads from `theme.colors.*`, and a test pins it.
 *
 * ─── The field keeps the keyboard ──────────────────────────────────────────
 *
 * `blurOnSubmit={false}` and the field clears itself: capture is almost never
 * one thing. Emptying the box and staying focused turns "add a task" into "empty
 * your head", which is the errand this is really for.
 */
import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import AppTextInput from '../../../components/AppTextInput';
import { impactHaptic, notifyHaptic } from '../../../utils/haptics';

export default function InboxCapture({ destinationLabel = 'Unsorted', onAdd, theme, trailing = null }) {
  const [text, setText] = useState('');
  const clean = text.trim();
  const c = theme.colors;

  const submit = useCallback(() => {
    const title = text.trim();
    if (!title) return;
    notifyHaptic('success');
    onAdd?.(title);
    // Cleared and still focused: capture is almost never one thing.
    setText('');
  }, [text, onAdd]);

  return (
    <View style={styles.wrap} testID="inbox-capture">
      {/* Two weights on one line — the Planner's own title idiom and the
          calendar sheet's ("TO-DO | Today · Sat, Sep 26"): the constant half
          hairline, the half that says what this particular thing does in a
          weight you actually read. Same furniture as the rest of the app, so
          the page announces itself the way every other page does. */}
      <View style={styles.headingRow}>
        <Text style={[styles.heading, { color: c.textPrimary }]} numberOfLines={1} testID="inbox-capture-heading">
          <Text style={styles.headingThin}>TO-DO </Text>
          <Text style={[styles.headingDivider, { color: c.textTertiary }]}>| </Text>
          <Text style={styles.headingStrong}>Make a list</Text>
        </Text>
        {/* Whatever the page wants on this line, hard right — the Overview key,
            in practice. Above the field rather than between the field and the
            list it is building, which is where it was interrupting. */}
        {trailing}
      </View>

      <View style={[styles.field, { backgroundColor: c.surface, borderColor: c.border }]}>
        <AppTextInput
          style={[styles.input, { color: c.textPrimary }]}
          placeholder="What needs doing?"
          placeholderTextColor={c.textMuted || c.textTertiary}
          value={text}
          onChangeText={setText}
          // Sentences, not `none`: this is prose a person is writing, unlike a
          // search field where autocaps fights a name they are spelling.
          autoCapitalize="sentences"
          returnKeyType="done"
          blurOnSubmit={false}
          onSubmitEditing={submit}
          accessibilityLabel="What needs doing?"
          testID="inbox-capture-input"
        />
        <Pressable
          onPressIn={() => impactHaptic('medium')}
          onPress={submit}
          // Disabled rather than hidden: a key that appears as you type is a key
          // you cannot aim for, and its absence reads as "this box does nothing".
          disabled={!clean}
          accessibilityRole="button"
          accessibilityState={{ disabled: !clean }}
          accessibilityLabel="Add this task"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          testID="inbox-capture-add"
          style={({ pressed }) => [
            styles.addKey,
            { backgroundColor: clean ? c.textPrimary : 'transparent' },
            pressed && styles.pressed,
          ]}
        >
          {/* DOWN, not up. The list builds downward from this field, so the
              arrow points where the thing you typed is about to go — up would
              be "send it away", which is the opposite of what happens. */}
          <Icon
            name="arrow-down"
            size={18}
            color={clean ? c.background : (c.textMuted || c.textTertiary)}
          />
        </Pressable>
      </View>

      {/* "It is saved" only reassures if you know WHERE — a box that swallows
          things anonymously is one people stop trusting after the first thing
          they cannot find. Said plainly, as a sentence, rather than as a row of
          bulleted attributes. */}
      <Text
        style={[styles.note, { color: c.textTertiary }]}
        numberOfLines={2}
        testID="inbox-capture-note"
      >
        {`Goes to ${destinationLabel}. Give it a date or a board whenever you like.`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // No card, no fill, no border — the page itself, with room around it.
  wrap: { gap: 10, paddingTop: 6, paddingBottom: 4 },
  // One line, three weights. Sized to lead the page without shouting: a step
  // above the section labels under it, a step below the screen's own title.
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  // Shrinks to whatever sits beside it rather than pushing it off the edge
  // (STYLE-RULES §2).
  heading: { flex: 1, fontSize: 22, letterSpacing: -0.3 },
  headingThin: { fontWeight: '200' },
  headingDivider: { fontWeight: '200' },
  headingStrong: { fontWeight: '700' },
  field: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    height: 52, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: 14, paddingRight: 7,
  },
  // The single-line field metrics this app uses everywhere
  // (TaskInspectorSheet's subAddInput is the reference): NO height of its own
  // inside a fixed-height row — two layout systems arguing over one baseline is
  // what puts the placeholder, the value and the caret on three different lines
  // — Android's reserved ascender/descender room off, and its centring on.
  input: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 0,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  addKey: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.75 },
  note: { fontSize: 13, lineHeight: 18 },
});
