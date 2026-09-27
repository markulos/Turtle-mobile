/**
 * NotesFilterPanel — both of the Notes screen's filters, in one place.
 *
 * What it replaces was two rails of chips stacked under the title: the KIND
 * (All / Notes / Todos / Feedback) and every TOPIC, all of them on screen all
 * of the time. Two scrolling rows of controls is most of a phone's header spent
 * on options nobody is currently using, and the rails still hid things — a
 * topic past the right edge was as invisible as one in a panel, only it cost a
 * third of the screen to hide it.
 *
 * So: the header states what is active and carries a key, the key opens this,
 * and the list gets its room back. Same shape as the Planner's filter panel
 * (see TasksScreen/components/PlannerFilterPanel) on purpose — the two screens
 * filter the same way, so they should look like they do.
 *
 * ─── The rules it inherits ─────────────────────────────────────────────────
 *
 *   · EVERY SECTION STATES ITS ANSWER in its heading, so the panel can be read
 *     without touching anything.
 *   · Every control is the same chip — kind and topic are two filters over one
 *     list, and two filters drawn as different kinds of control read as two
 *     lists.
 *   · THE FOOTER SAYS THE COUNT, live, so a chip that empties the list says so
 *     before you leave.
 *   · CLEAR is always there, disabled rather than hidden when there is nothing
 *     to clear — a key that comes and goes is a key you cannot aim for.
 */
import React, { useCallback, useEffect, useMemo } from 'react';
import {
  BackHandler, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import EdgeSwipePage from '../TurtleScreen/components/EdgeSwipePage';
import { tapHaptic } from '../../utils/haptics';
import { panelBottomInset } from '../../components/tabBarLayout';

/** The kind chips, in the order they read — widest scope first. */
const KIND_ICONS = {
  all: 'format-list-bulleted',
  note: 'note-text-outline',
  todo: 'checkbox-marked-circle-outline',
  feedback: 'message-text-outline',
};

/**
 * One chip. The kinds, the topics and "All Topics" are all this — one shape to
 * learn, and the only difference that carries meaning is lit / not.
 */
function Chip({ label, count, active, onPress, icon, theme, isDark, testID, accessibilityLabel }) {
  const s = useMemo(() => panelStyles(theme, isDark), [theme, isDark]);
  return (
    <Pressable
      onPressIn={() => tapHaptic()}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      accessibilityLabel={accessibilityLabel || label}
      testID={testID}
      style={({ pressed }) => [s.chip, active && s.chipOn, pressed && s.pressed]}
    >
      {!!icon && (
        <Icon name={icon} size={14} color={active ? theme.colors.accentInfo : theme.colors.textTertiary} />
      )}
      <Text style={[s.chipText, active && s.chipTextOn]} numberOfLines={1}>{label}</Text>
      {typeof count === 'number' && (
        <Text style={[s.chipCount, active && s.chipCountOn]}>{count}</Text>
      )}
      {active && <Icon name="check" size={14} color={theme.colors.accentInfo} />}
    </Pressable>
  );
}

/** A section: its name, what it is currently set to, and its chips. */
function Section({ title, value, action, children, theme, isDark, testID }) {
  const s = useMemo(() => panelStyles(theme, isDark), [theme, isDark]);
  return (
    <View style={s.section} testID={testID}>
      <View style={s.sectionHead}>
        <Text style={s.sectionTitle} numberOfLines={1}>{title}</Text>
        {/* The heading carries the answer. Its own testID because it says the
            same word as the lit chip below it — the summary and the control are
            two different claims that happen to share a label. */}
        <Text style={s.sectionValue} numberOfLines={1} testID={testID ? `${testID}-value` : undefined}>
          {value}
        </Text>
        {action}
      </View>
      <View style={s.chipWrap}>{children}</View>
    </View>
  );
}

export default function NotesFilterPanel({
  visible,
  onClose,
  theme,
  isDark,
  // Kind — all / note / todo / feedback
  kinds = [],
  kindLabels = {},
  filter,
  onFilterChange,
  counts = {},
  // Topic (board). `topics` is [{ topic, count }], already merged with the
  // server's boards by the screen.
  topics = [],
  selectedTopic,
  onSelectTopic,
  untaggedKey,
  untaggedCount = 0,
  // The full board/topic universe lives behind the screen's search sheet — the
  // chips below are only the ones a note or a board already names.
  onOpenTopicSearch,
  // How many rows survive both filters, live.
  matchCount = 0,
  onClearAll,
}) {
  const insets = useSafeAreaInsets();
  const s = useMemo(() => panelStyles(theme, isDark), [theme, isDark]);

  const scoped = (filter && filter !== 'all') || !!selectedTopic;

  const close = useCallback(() => { onClose?.(); }, [onClose]);

  // Android back closes the PANEL, not the screen under it. Registered while
  // visible, and BackHandler calls the most recent listener first.
  useEffect(() => {
    if (!visible) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { close(); return true; });
    return () => sub.remove();
  }, [visible, close]);

  const topicValue = !selectedTopic
    ? 'All topics'
    : selectedTopic === untaggedKey ? 'Untagged' : selectedTopic;

  return (
    <EdgeSwipePage overlay visible={visible} onClose={close}>
      <View style={[s.page, { backgroundColor: theme.colors.background }]}>
        {/* No safe-area padding at the top: this overlay opens INSIDE Notes,
            under a header that has already cleared the status bar. The BOTTOM
            inset still applies — nothing else clears the home indicator. */}
        <View style={[s.header, { paddingTop: 8 }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={close}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={s.backKey}
            testID="notes-filter-cancel"
          >
            <Icon name="chevron-left" size={28} color={theme.colors.textPrimary} />
          </Pressable>
          <Text style={s.title} numberOfLines={1}>Filter</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear all filters"
            accessibilityState={{ disabled: !scoped }}
            disabled={!scoped}
            onPressIn={() => tapHaptic()}
            onPress={() => onClearAll?.()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            testID="notes-filter-clear"
            style={({ pressed }) => [s.clearKey, pressed && s.pressed]}
          >
            <Text style={[s.clearText, !scoped && s.clearTextOff]}>Clear</Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={[s.body, { paddingBottom: 24 }]}
          keyboardShouldPersistTaps="handled"
          testID="notes-filter-scroll"
        >
          <Section
            title="Kind"
            value={kindLabels[filter] || 'All'}
            theme={theme}
            isDark={isDark}
            testID="notes-filter-kind"
          >
            {kinds.map((k) => (
              <Chip
                key={k}
                label={kindLabels[k] || k}
                icon={KIND_ICONS[k]}
                // "All" counts the whole list, so a badge on it is the list's
                // own length restated — noise beside the chips that narrow.
                count={k === 'all' ? undefined : (counts[k] || undefined)}
                active={filter === k}
                onPress={() => onFilterChange?.(k)}
                theme={theme}
                isDark={isDark}
                testID={`notes-filter-kind-${k}`}
              />
            ))}
          </Section>

          <Section
            title="Topic"
            value={topicValue}
            theme={theme}
            isDark={isDark}
            testID="notes-filter-topic"
            action={(
              <Pressable
                onPressIn={() => tapHaptic()}
                onPress={() => onOpenTopicSearch?.()}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Search boards and topics"
                testID="notes-filter-topic-search"
                style={({ pressed }) => [s.sectionKey, pressed && s.pressed]}
              >
                <Icon name="magnify" size={16} color={theme.colors.accentInfo} />
              </Pressable>
            )}
          >
            <Chip
              label="All Topics"
              icon="asterisk"
              active={!selectedTopic}
              onPress={() => onSelectTopic?.(null)}
              theme={theme}
              isDark={isDark}
              testID="notes-filter-topic-all"
            />
            {/* A picked SUB-topic ('a/b') is not one of the chips below — it
                came from the search sheet — so it rides as its own lit chip
                rather than leaving the section looking unset. */}
            {!!selectedTopic && selectedTopic !== untaggedKey
              && !topics.some((t) => t.topic === selectedTopic) && (
              <Chip
                label={selectedTopic}
                icon="subdirectory-arrow-right"
                active
                onPress={() => onSelectTopic?.(null)}
                theme={theme}
                isDark={isDark}
              />
            )}
            {topics.map(({ topic, count }) => (
              <Chip
                key={topic}
                label={topic}
                icon="folder-outline"
                // Hide the badge on note-less boards — the chip reads as just
                // the board name instead of a noisy "0".
                count={count || undefined}
                // A parent lights for its sub-topics too: selecting `moodboard`
                // shows `moodboard/wedding`, so the chip that did it must say so.
                active={selectedTopic === topic || String(selectedTopic || '').startsWith(topic + '/')}
                onPress={() => onSelectTopic?.(selectedTopic === topic ? null : topic)}
                theme={theme}
                isDark={isDark}
                testID={`notes-filter-topic-${topic}`}
              />
            ))}
            {untaggedCount > 0 && (
              <Chip
                label="Untagged"
                icon="tag-off-outline"
                count={untaggedCount}
                active={selectedTopic === untaggedKey}
                onPress={() => onSelectTopic?.(selectedTopic === untaggedKey ? null : untaggedKey)}
                theme={theme}
                isDark={isDark}
                testID="notes-filter-topic-untagged"
              />
            )}
          </Section>
        </ScrollView>

        {/* The count, live. Without it you have to close the panel to find out
            whether what you just picked left anything at all. The footer clears
            the DOCK, which floats over this panel and reserves no layout space
            (see panelBottomInset). */}
        <View style={[s.foot, { paddingBottom: panelBottomInset(insets.bottom) }]}>
          <Text style={s.footCount} numberOfLines={1} testID="notes-filter-count">
            {matchCount === 1 ? '1 item' : `${matchCount} items`}
            {scoped ? ' match' : ' in Notes'}
          </Text>
          <Pressable
            onPressIn={() => tapHaptic()}
            onPress={close}
            accessibilityRole="button"
            accessibilityLabel="Show these items"
            testID="notes-filter-done"
            style={({ pressed }) => [s.doneKey, pressed && s.pressed]}
          >
            <Text style={s.doneText}>Show</Text>
          </Pressable>
        </View>
      </View>
    </EdgeSwipePage>
  );
}

const panelStyles = (theme, isDark) => StyleSheet.create({
  page: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingBottom: 10,
  },
  backKey: { width: 44, height: 38, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 18, fontWeight: '700', color: theme.colors.textPrimary },
  clearKey: { paddingHorizontal: 8, height: 38, justifyContent: 'center' },
  clearText: { fontSize: 14, fontWeight: '700', color: theme.colors.accentInfo },
  clearTextOff: { color: theme.colors.textMuted, opacity: 0.6 },

  body: { paddingHorizontal: 16, gap: 18, paddingTop: 4 },
  section: { gap: 10 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionTitle: {
    fontSize: 11, fontWeight: '800', letterSpacing: 1,
    textTransform: 'uppercase', color: theme.colors.textTertiary,
  },
  // Shrinks and ellipsizes: a long topic must never push its own heading off
  // the page (STYLE-RULES §2).
  sectionValue: { flex: 1, fontSize: 12.5, color: theme.colors.textSecondary, textAlign: 'right' },
  // The one key a section may carry, on its heading line — the topic universe
  // is longer than any chip wrap, so it keeps its search.
  sectionKey: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.colors.accentInfo + (isDark ? '24' : '16'),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.accentInfo + '55',
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    flexShrink: 1,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 16, borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  chipOn: {
    borderColor: (theme.colors.accentInfo || '#5598e7') + '88',
    backgroundColor: (theme.colors.accentInfo || '#5598e7') + (isDark ? '2E' : '1F'),
  },
  chipText: { flexShrink: 1, fontSize: 13, fontWeight: '600', color: theme.colors.textSecondary },
  chipTextOn: { color: theme.colors.accentInfo },
  chipCount: { fontSize: 11, fontWeight: '700', color: theme.colors.textMuted, fontVariant: ['tabular-nums'] },
  chipCountOn: { color: theme.colors.accentInfo },
  pressed: { opacity: 0.75 },

  foot: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border,
  },
  footCount: { flex: 1, fontSize: 13, color: theme.colors.textSecondary },
  doneKey: {
    paddingHorizontal: 20, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.colors.accentInfo || theme.colors.textPrimary,
  },
  doneText: { fontSize: 14, fontWeight: '800', color: theme.colors.background },
});
