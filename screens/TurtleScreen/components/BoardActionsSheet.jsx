/**
 * BoardActionsSheet — what you can do to one board on the canvas, held down.
 *
 * A tap on a node has exactly one meaning (go there), which is what keeps the
 * map usable one-handed — so everything else a board can do lives behind a
 * long-press, in this card:
 *
 *   • Open — the board's own conversation. This is the main way to reach the
 *     timeline of a board with anything in it, because tapping one of those
 *     opens it out on the map instead. A board that holds other boards is still
 *     a board with its own tasks, notes and photos, and there has to be a door
 *     to them.
 *   • New board inside — the way to nest that works from anywhere.
 *   • Focus the map here — re-root the whole canvas on this board.
 *   • Move to… — a PAGE of this same card: the whole tree, indented, with the
 *     illegal destinations already gone (a board cannot be moved into itself or
 *     into anything already inside it — that would cut the branch off from every
 *     root).
 *   • Delete board — another page, and the only one that asks you to TYPE the
 *     board's name back. A board is the root of a pile of work; a tap-to-confirm
 *     dialog is dismissed by the same reflex that opened it, and on a map you
 *     navigate by holding things, a mis-hold followed by a mis-tap is a
 *     plausible way to lose one. Typing the name cannot be done by reflex, and
 *     it makes you read WHICH board you are about to delete — which is the
 *     failure this actually guards against.
 *
 * Rendered as an IN-TREE absolute overlay, not a <Modal>: the canvas already
 * sits inside one, and iOS won't present a second sibling modal over an open
 * one.
 */
import React, { useCallback, useState } from 'react';
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Reanimated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { impactHaptic, notifyHaptic, tapHaptic } from '../../../utils/haptics';
import { useSheetPresentation } from '../../../utils/useSheetPresentation';
import { boardTint } from './BoardAvatar';

// One indent step in the move picker. Deep enough to read as nesting, shallow
// enough that a five-deep board still has room for its name.
const INDENT = 16;
// How tall the destination list may get before it scrolls, so the card can
// never grow past the screen on a pond with a hundred boards.
const LIST_MAX_H = 320;

export default function BoardActionsSheet({
  visible,
  board,                 // the board's name, or null when nothing is held
  childCount = 0,
  nestedCount = 0,
  currentParent = null,  // where it sits today; the picker marks this row
  targets = [],          // [{ name, depth }] — legal destinations, depth-first
  busy = false,
  error = null,
  onOpen,
  onAddChild,
  onFocus,
  onMove,                // (parentName|null) => void
  onDelete,
  onClose,
  bottomInset = 0,
  colors,
}) {
  const c = colors;
  const tint = c.accentInfo || c.primary || '#60A5FA';
  const danger = c.accentError || '#F87171';

  // The delete page has a field in it, so the card rides the keyboard. It
  // already rests on `bottomInset` of dock clearance, so the lift CANCELS
  // exactly that clearance — adding the two leaves the card floating.
  const keyboard = useAnimatedKeyboard();
  const keyboardLift = useAnimatedStyle(() => {
    'worklet';
    return { transform: [{ translateY: -Math.max(keyboard.height.value - bottomInset, 0) }] };
  });

  const [page, setPage] = useState('actions');
  // What the user has typed on the delete page. Only an exact match arms the
  // button — see the note on the page itself.
  const [typed, setTyped] = useState('');

  const sheet = useSheetPresentation({
    visible,
    onClose,
    height: 340,
    // Every open starts on the actions page with the confirm field empty —
    // a half-typed board name must never survive into the next open.
    onOpen: useCallback(() => {
      setPage('actions');
      setTyped('');
    }, []),
  });
  const { mounted, panHandlers, scrollProps } = sheet;

  if (!mounted || !board) return null;

  const rowBorder = { borderTopColor: c.border };
  const contains = nestedCount
    ? `${nestedCount} board${nestedCount === 1 ? '' : 's'} inside`
    : 'Nothing inside it yet';
  const subtitleFor = {
    move: 'Choose where it goes',
    delete: 'Type its name to confirm',
  }[page] || contains;
  // Exact, and case-sensitive — the field turns autocapitalise and autocorrect
  // off so the phone can't type it for you, which is the entire point.
  // Surrounding whitespace is forgiven: that is a keyboard artefact, not a
  // different board, and failing on it would just look broken.
  const confirmed = typed.trim() === String(board).trim();
  // Where the sub-boards land, phrased for the middle of a sentence.
  const destination = currentParent ? `“${currentParent}”` : 'the top level';

  const armDelete = () => {
    if (!confirmed || busy) return;
    notifyHaptic('warning');
    onDelete?.();
  };

  return (
    <View style={[StyleSheet.absoluteFill, styles.layer]} pointerEvents="box-none">
      <Animated.View
        pointerEvents={visible ? 'auto' : 'none'}
        style={[StyleSheet.absoluteFill, styles.scrim, sheet.scrimStyle]}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityLabel="Close board options"
          onPress={onClose}
        />
      </Animated.View>

      {/* Keyboard-lift anchor. It carries the bottom pin so the card inside
          keeps its own open/drag transform (an RN Animated value and a
          Reanimated style cannot drive the same node). */}
      <Reanimated.View pointerEvents="box-none" style={[styles.cardAnchor, keyboardLift]}>
        <Animated.View
          {...panHandlers}
          testID="board-actions-sheet"
          onLayout={sheet.onCardLayout}
          style={[styles.card, {
            backgroundColor: c.surfaceElevated,
            borderColor: c.border,
            paddingBottom: bottomInset + 10,
            transform: sheet.cardStyle.transform,
          }]}
        >
        <View style={styles.grabArea}>
          <View style={[styles.grabber, { backgroundColor: c.border }]} />
        </View>

        <View style={styles.headerRow}>
          {page !== 'actions' && (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Back to board options"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              onPress={() => { tapHaptic(); setTyped(''); setPage('actions'); }}
            >
              <Icon name="chevron-left" size={26} color={c.textPrimary} />
            </TouchableOpacity>
          )}
          <View style={[styles.disc, {
            backgroundColor: boardTint(board, 0.16),
            borderColor: page === 'delete' ? danger : c.border,
          }]}
          >
            <Text style={[styles.discLetter, { color: boardTint(board, 1) }]}>
              {String(board).trim().charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={styles.headerText}>
            <Text style={[styles.title, { color: c.textPrimary }]} numberOfLines={1}>{board}</Text>
            <Text
              style={[styles.subtitle, { color: page === 'delete' ? danger : c.textTertiary }]}
              numberOfLines={1}
            >
              {subtitleFor}
            </Text>
          </View>
        </View>

        {!!error && (
          <Text style={[styles.error, { color: c.accentError || '#F87171' }]}>{error}</Text>
        )}

        {page === 'actions' ? (
          <>
            <ActionRow
              icon="forum-outline"
              label={`Open ${board}`}
              hint={childCount ? 'Its own tasks, notes and photos' : null}
              color={c.textPrimary}
              hintColor={c.textTertiary}
              style={rowBorder}
              disabled={busy}
              onPress={() => { tapHaptic(); onOpen?.(); }}
            />
            <ActionRow
              icon="plus-box-outline"
              label="New board inside"
              hint={`Nested under ${board}`}
              color={c.textPrimary}
              hintColor={c.textTertiary}
              style={rowBorder}
              disabled={busy}
              chevron
              onPress={() => { tapHaptic(); onAddChild?.(); }}
            />
            {/* Opening a board on the map is not navigation — the map just
                gets bigger, and a deep branch ends up a long drag from
                everything else. This makes the board the whole map instead,
                with a breadcrumb trail back out. Pointless for a board with
                nothing under it, so it isn't offered. */}
            {childCount > 0 && (
              <ActionRow
                icon="target"
                label="Focus the map here"
                hint={`Show only ${board} and what is inside it`}
                color={c.textPrimary}
                hintColor={c.textTertiary}
                style={rowBorder}
                disabled={busy}
                onPress={() => { tapHaptic(); onFocus?.(); }}
              />
            )}
            <ActionRow
              icon="folder-move-outline"
              label="Move to…"
              hint={currentParent ? `Currently inside ${currentParent}` : 'Currently at the top level'}
              color={c.textPrimary}
              hintColor={c.textTertiary}
              style={rowBorder}
              disabled={busy}
              chevron
              onPress={() => { tapHaptic(); setPage('move'); }}
            />
            <ActionRow
              icon="trash-can-outline"
              label="Delete board"
              hint={nestedCount ? `The ${nestedCount === 1 ? 'board' : 'boards'} inside move up` : 'Its items stay, unfiled'}
              color={danger}
              hintColor={c.textTertiary}
              style={rowBorder}
              disabled={busy}
              chevron
              onPress={() => { tapHaptic(); setTyped(''); setPage('delete'); }}
            />
          </>
        ) : page === 'delete' ? (
          <>
            {/* What actually happens, in the order it matters. Deleting a board
                is NOT deleting what is on it — the server un-files its tasks and
                lifts its sub-boards up a level rather than cascading — and
                saying so is what makes the ritual below proportionate instead of
                theatrical. */}
            <View style={[styles.consequences, rowBorder]}>
              {nestedCount > 0 && (
                <Consequence
                  icon="arrow-up-bold-box-outline"
                  colors={c}
                  text={
                    nestedCount === 1
                      ? `Its board moves up to ${destination}.`
                      : `Its ${nestedCount} boards move up to ${destination}.`
                  }
                />
              )}
              <Consequence
                icon="checkbox-marked-circle-outline"
                colors={c}
                text="Tasks on it stay — they just lose their board."
              />
              <Consequence
                icon="image-multiple-outline"
                colors={c}
                text="Notes and photos keep the tag."
              />
              <Consequence
                icon="account-off-outline"
                colors={c}
                text="Anyone you shared it with loses it."
              />
            </View>

            <View style={[styles.fieldRow, rowBorder]}>
              <Icon name="keyboard-outline" size={20} color={confirmed ? danger : c.textSecondary} />
              <TextInput
                style={[styles.input, { color: c.textPrimary }]}
                placeholder={board}
                placeholderTextColor={c.textMuted}
                value={typed}
                onChangeText={setTyped}
                autoFocus
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                returnKeyType="done"
                onSubmitEditing={armDelete}
                testID="board-delete-confirm"
                accessibilityLabel={`Type ${board} to confirm deleting it`}
              />
            </View>

            <View style={styles.actions}>
              <TouchableOpacity
                onPress={() => { tapHaptic(); setTyped(''); setPage('actions'); }}
                style={[styles.button, { borderColor: c.border }]}
                accessibilityRole="button"
                accessibilityLabel="Keep this board"
              >
                <Text style={[styles.buttonText, { color: c.textSecondary }]}>Keep it</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={armDelete}
                disabled={!confirmed || busy}
                style={[
                  styles.button,
                  styles.primary,
                  { backgroundColor: danger },
                  (!confirmed || busy) && styles.disabled,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Delete ${board}`}
              >
                <Text style={[styles.buttonText, styles.primaryText]}>
                  {busy ? 'Deleting…' : 'Delete'}
                </Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <ScrollView
            style={{ maxHeight: LIST_MAX_H }}
            contentContainerStyle={styles.listContent}
            {...scrollProps}
          >
            <DestinationRow
              label="Top level"
              icon="home-outline"
              depth={0}
              selected={!currentParent}
              colors={c}
              tint={tint}
              disabled={busy}
              onPress={() => { impactHaptic('medium'); onMove?.(null); }}
            />
            {targets.map((target) => (
              <DestinationRow
                key={target.name}
                label={target.name}
                icon="shape-outline"
                depth={target.depth + 1}
                selected={currentParent === target.name}
                colors={c}
                tint={tint}
                disabled={busy}
                onPress={() => { impactHaptic('medium'); onMove?.(target.name); }}
              />
            ))}
            {targets.length === 0 && (
              <Text style={[styles.emptyTargets, { color: c.textTertiary }]}>
                There is no other board to put this one inside yet.
              </Text>
            )}
          </ScrollView>
        )}
        </Animated.View>
      </Reanimated.View>
    </View>
  );
}

/** One line of "here is what deleting this actually does". */
function Consequence({ icon, text, colors }) {
  return (
    <View style={styles.consequence}>
      <Icon name={icon} size={15} color={colors.textTertiary} />
      <Text style={[styles.consequenceText, { color: colors.textSecondary }]}>{text}</Text>
    </View>
  );
}

function ActionRow({ icon, label, hint, color, hintColor, onPress, style, disabled, chevron }) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      activeOpacity={0.7}
      disabled={disabled}
      onPress={onPress}
      style={[styles.row, style, disabled && styles.rowDisabled]}
    >
      <Icon name={icon} size={20} color={color} />
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color }]} numberOfLines={1}>{label}</Text>
        {!!hint && (
          <Text style={[styles.rowHint, { color: hintColor }]} numberOfLines={1}>{hint}</Text>
        )}
      </View>
      {chevron ? <Icon name="chevron-right" size={20} color={color} /> : null}
    </TouchableOpacity>
  );
}

/** One row of the move picker, indented to its depth in the tree. */
function DestinationRow({ label, icon, depth, selected, colors, tint, disabled, onPress }) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`Move into ${label}`}
      accessibilityState={{ selected }}
      activeOpacity={0.7}
      disabled={disabled || selected}
      onPress={onPress}
      style={[
        styles.destination,
        { paddingLeft: 18 + depth * INDENT, borderTopColor: colors.border },
        disabled && styles.rowDisabled,
      ]}
    >
      <Icon name={icon} size={17} color={selected ? tint : colors.textSecondary} />
      <Text
        style={[styles.destinationLabel, { color: selected ? tint : colors.textPrimary }]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {selected && <Text style={[styles.hereText, { color: tint }]}>Here now</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  layer: { zIndex: 60, elevation: 60 },
  scrim: { backgroundColor: 'rgba(0,0,0,0.5)' },
  // The bottom pin lives on the ANCHOR (which carries the keyboard lift), not
  // on the card — the card's transform stays free for the open/drag motion.
  cardAnchor: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  card: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  grabArea: { alignItems: 'center', paddingTop: 8, paddingBottom: 6 },
  grabber: { width: 38, height: 4, borderRadius: 2 },
  headerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingBottom: 12,
  },
  headerText: { flex: 1 },
  disc: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  discLetter: { fontSize: 18, fontWeight: '700' },
  title: { fontSize: 15, fontWeight: '700' },
  subtitle: { fontSize: 12, marginTop: 1 },
  error: { fontSize: 12, paddingHorizontal: 18, paddingBottom: 8 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 18, paddingVertical: 13,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowDisabled: { opacity: 0.55 },
  rowText: { flex: 1 },
  rowLabel: { fontSize: 15, fontWeight: '600' },
  rowHint: { fontSize: 11.5, marginTop: 1 },
  listContent: { paddingBottom: 4 },
  destination: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingRight: 18, paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  destinationLabel: { flex: 1, fontSize: 14.5, fontWeight: '600' },
  hereText: { fontSize: 11, fontWeight: '700' },
  emptyTargets: { fontSize: 12.5, paddingHorizontal: 18, paddingVertical: 16, textAlign: 'center' },
  consequences: {
    gap: 8, paddingHorizontal: 18, paddingVertical: 13,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  consequence: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  consequenceText: { flex: 1, fontSize: 12.5, lineHeight: 17 },
  fieldRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 18, paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  // Inline field in an icon row: explicit height + zero vertical padding, or
  // the glyphs ride high against the icon. App-wide rule for inline inputs.
  input: {
    flex: 1, fontSize: 15, height: 34,
    paddingVertical: 0, textAlignVertical: 'center', includeFontPadding: false,
  },
  actions: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 14 },
  button: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 11, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth,
  },
  primary: { borderWidth: 0 },
  disabled: { opacity: 0.45 },
  buttonText: { fontSize: 15, fontWeight: '700' },
  primaryText: { color: '#fff' },
});
