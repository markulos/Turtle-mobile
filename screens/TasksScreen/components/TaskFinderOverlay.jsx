/**
 * TaskFinderOverlay — the task finder as a PANEL, not as a row in the day.
 *
 * The finder used to be a field at the top of the day's scroll view with its
 * results underneath, which meant the list competed for room with the day's
 * actual schedule and with everything above it — the sheet title, the week
 * strip, the toolbar. On a phone with the keyboard up, that left a few rows.
 *
 * As an overlay it gets the whole screen: the destination line and the field
 * sit at the very top, and EVERYTHING below them down to the keyboard is the
 * list. That is the only reason this is a separate surface — not decoration,
 * just the largest possible answer area for a thing you are typing into.
 *
 * Purely presentational. Every decision (what matches, what Return does, where
 * a new task lands) belongs to the caller; this draws and reports taps.
 */
import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { depth } from '../../../utils/surfaceDepth';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import AppTextInput from '../../../components/AppTextInput';
import { tapHaptic } from '../../../utils/haptics';
import { KIND_SEP, FIELD_SEP } from '../utils/finderDestination';

/**
 * The field is the vault's board-search pill, one size up: a fully rounded
 * hairline pill on the surface fill, 15 pt type, a 21 pt magnifier in muted
 * ink. 46 rather than the board row's 38 because this is the panel's one
 * input with the keyboard already up — the shape matches, the target stays a
 * comfortable 44+.
 */
const SEARCH_HEIGHT = 46;

export default function TaskFinderOverlay({
  visible,
  theme,
  topInset = 0,
  // Height of the on-screen keyboard. The list is sized against it directly
  // rather than through KeyboardAvoidingView, which animates a LAYOUT prop on
  // its own timeline and lands a beat late (same reasoning as the chat
  // composer's lift).
  keyboardHeight = 0,
  destination,
  value,
  onChangeText,
  onSubmit,
  onCancel,
  placeholder,
  // Time chip. `timeLabel` present ⇒ a time is pending.
  timeLabel,
  onEditTime,
  onClearTime,
  // Create row
  showCreate,
  createCaption,
  onOpenFullForm,
  // Matches
  results = [],
  renderResult,
  resultsCaption,
  // What stands in for the matches BEFORE anything is typed — the selected
  // day's open tasks. Same row renderer, so the list does not change shape the
  // moment you start typing; only what is in it changes.
  idleResults = [],
  idleCaption = '',
  idleEmptyHint = 'Type to search every task — or to name a new one.',
  // Anything that must draw OVER this panel — the time wheel the clock key
  // opens. It has to be mounted INSIDE this Modal, not beside it: the panel is
  // an opaque full-screen Modal, and a SIBLING Modal presented over an already
  // open one is the case docs/STYLE-RULES.md §4 names — iOS drops it, and here
  // it drew underneath, so tapping the clock appeared to do nothing. Rendered
  // LAST so it is over the panel's own content.
  overlays,
}) {
  if (!visible) return null;
  const c = theme.colors;
  const s = makeStyles(theme);
  const trimmed = (value || '').trim();

  return (
    /* An OPAQUE full-screen modal, in the shape the rest of the app uses for
       one (see TerminalConsole): visible + animationType + onRequestClose +
       statusBarTranslucent, and no `presentationStyle`.

       `presentationStyle="overFullScreen"` was the outlier here, and it is not
       a combination React Native supports alongside `transparent={false}` —
       overFullScreen is what RN picks for itself when a modal IS transparent.
       Forcing it on an opaque panel presents the window over the app instead
       of as it, and the dismissal that follows leaves that window in the
       hierarchy: the schedule underneath is drawn, and completely untappable,
       because every touch is still going to a panel that is no longer there.
       Dropping the prop lets RN present this as the full-screen page it is. */
    <Modal
      visible
      animationType="fade"
      transparent={false}
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <View style={[s.panel, { paddingTop: topInset + 8 }]}>
        {/* Destination, then the field. In that order on purpose: the line
            answers "where is this going" BEFORE you commit a title to the box,
            which is the question the old inline finder never answered at all. */}
        <Text
          style={s.destination}
          numberOfLines={1}
          accessibilityLabel={`New task destination: ${destination?.speech || ''}`}
          testID="finder-overlay-destination"
        >
          <Text style={s.destinationKind}>{destination?.kind}</Text>
          <Text style={s.destinationSep}>{KIND_SEP}</Text>
          {destination?.day}
          {destination?.day ? <Text style={s.destinationSep}>{FIELD_SEP}</Text> : null}
          <Text style={destination?.filed ? s.destinationBoard : null}>{destination?.board}</Text>
        </Text>

        <View style={s.searchRow}>
          <Icon name="magnify" size={21} color={c.textMuted} />
          <AppTextInput
            style={s.input}
            value={value}
            onChangeText={onChangeText}
            onSubmitEditing={onSubmit}
            placeholder={placeholder}
            placeholderTextColor={c.textMuted}
            placeholderTestID="finder-overlay-placeholder"
            autoFocus
            blurOnSubmit={false}
            returnKeyType="done"
            autoCorrect={false}
            accessibilityLabel="Search or add a task"
            testID="finder-overlay-input"
          />
          {timeLabel ? (
            <View style={s.timeChip}>
              <TouchableOpacity
                style={s.timeChipMain}
                onPress={onEditTime}
                hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                accessibilityRole="button"
                accessibilityLabel={`Edit time, currently ${timeLabel}`}
              >
                <Icon name="clock-outline" size={12} color={c.background} />
                <Text style={s.timeChipText}>{timeLabel}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onClearTime}
                hitSlop={{ top: 8, bottom: 8, left: 6, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Clear time"
              >
                <Icon name="close-circle" size={14} color={c.background} />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              onPress={onEditTime}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Add a time"
            >
              <Icon name="clock-plus-outline" size={18} color={c.textTertiary} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={onCancel}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel="Close the finder"
            testID="finder-overlay-close"
          >
            <Icon name="close" size={19} color={c.textTertiary} />
          </TouchableOpacity>
        </View>

        {/* Everything left, down to the keyboard. marginBottom (not padding)
            so the scroll view's own bottom edge lands on the keyboard and its
            scrollbar does too. */}
        <View style={[s.listWrap, { marginBottom: keyboardHeight }]}>
          <ScrollView
            style={s.list}
            contentContainerStyle={s.listContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="none"
            testID="finder-overlay-list"
          >
            {trimmed.length === 0 ? (
              /* Nothing typed yet — so the panel shows the day it is about to
                 create into. Opening onto an empty box wasted the biggest
                 surface in the app on a sentence, when the question people
                 actually arrive with is "is this already on today?". */
              idleResults.length > 0 ? (
                <>
                  {idleCaption ? <Text style={s.resultsCaption}>{idleCaption}</Text> : null}
                  {idleResults.map((item, i) => renderResult(item, i))}
                </>
              ) : (
                <Text style={s.hint}>{idleEmptyHint}</Text>
              )
            ) : (
              <>
                {showCreate ? (
                  /* The ghost card: a task-shaped hole at the top of the list,
                     so "make this one" is the first thing under your thumb and
                     is visibly not one of the matches. */
                  <TouchableOpacity
                    style={s.ghost}
                    onPressIn={() => tapHaptic()}
                    onPress={onSubmit}
                    activeOpacity={0.6}
                    accessibilityRole="button"
                    accessibilityLabel={`Create task ${trimmed}`}
                    testID="finder-overlay-create"
                  >
                    <View style={s.ghostTop}>
                      <Text style={s.ghostTitle} numberOfLines={2}>{trimmed}</Text>
                      <View style={s.ghostRing}>
                        <Icon name="plus" size={14} color={c.textPrimary} />
                      </View>
                    </View>
                    <Text style={s.ghostCaption} numberOfLines={1}>{createCaption}</Text>
                    <View style={s.ghostBottom}>
                      <Text style={s.ghostHint} numberOfLines={1}>Return creates</Text>
                      <Pressable
                        onPressIn={() => tapHaptic()}
                        onPress={onOpenFullForm}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        accessibilityRole="button"
                        accessibilityLabel="Open the full form for this day"
                        testID="finder-overlay-full-form"
                        style={s.fullKey}
                      >
                        <Icon name="tune-variant" size={13} color={c.textSecondary} />
                        <Text style={s.fullKeyText}>Full form</Text>
                      </Pressable>
                    </View>
                  </TouchableOpacity>
                ) : null}

                {results.length > 0 ? (
                  <Text style={s.resultsCaption}>{resultsCaption}</Text>
                ) : null}
                {results.map((item, i) => renderResult(item, i))}

                {results.length === 0 && !showCreate ? (
                  <Text style={s.hint}>Nothing else matches.</Text>
                ) : null}
              </>
            )}
          </ScrollView>
        </View>
        {overlays}
      </View>
    </Modal>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  panel: {
    flex: 1,
    backgroundColor: theme.colors.background,
    paddingHorizontal: 14,
  },
  destination: {
    // Matches the day panel's header, which is the same line in the same place
    // — the overlay opens over it, so a size change here reads as a jump.
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.2,
    color: theme.colors.textSecondary,
    paddingBottom: 8,
  },
  destinationKind: { color: theme.colors.textTertiary, letterSpacing: 0.8 },
  // Punctuation between three facts — at full strength the pipe and the bullet
  // read as loudly as the words they separate.
  destinationSep: { color: theme.colors.textTertiary, fontWeight: '400' },
  destinationBoard: { color: theme.colors.textPrimary },
  // The board-search pill: hairline rim, fully rounded, surface fill, 14 pt of
  // side padding and an 8 pt gap to the glyphs. A fixed height (not minHeight)
  // — the placeholder centres itself against it.
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: theme.colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    borderRadius: SEARCH_HEIGHT / 2,
    paddingHorizontal: 14,
    height: SEARCH_HEIGHT,
    ...depth(theme, 'control'),
  },
  input: { flex: 1, height: '100%', fontSize: 15, color: theme.colors.textPrimary, padding: 0 },
  timeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: theme.colors.textPrimary,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  timeChipMain: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  timeChipText: { fontSize: 11, fontWeight: '700', color: theme.colors.background },
  listWrap: { flex: 1 },
  list: { flex: 1 },
  listContent: { paddingTop: 12, paddingBottom: 24 },
  hint: {
    fontSize: 13,
    lineHeight: 19,
    color: theme.colors.textTertiary,
    paddingTop: 18,
    textAlign: 'center',
  },
  ghost: {
    borderRadius: 18,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: theme.colors.borderStrong || theme.colors.border,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    minHeight: 72,
    marginBottom: 14,
  },
  ghostTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  ghostTitle: { flex: 1, fontSize: 16, fontWeight: '600', color: theme.colors.textPrimary, lineHeight: 21 },
  ghostRing: {
    width: 26, height: 26, borderRadius: 13,
    borderWidth: 1.5, borderStyle: 'dashed',
    borderColor: theme.colors.borderStrong || theme.colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  ghostCaption: { fontSize: 12, color: theme.colors.textSecondary, marginTop: 4 },
  ghostBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  ghostHint: { fontSize: 11, color: theme.colors.textTertiary },
  fullKey: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  fullKeyText: { fontSize: 12, fontWeight: '600', color: theme.colors.textSecondary },
  resultsCaption: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
    color: theme.colors.textTertiary,
    marginBottom: 4,
  },
});
