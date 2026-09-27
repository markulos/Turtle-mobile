/**
 * PlannerFilterPanel — every way the Planner can be narrowed, in one place you
 * can read top to bottom.
 *
 * What it replaces was three places. The status keys and the board rail lived
 * folded inside the Boards tab; tags and people lived in a bottom sheet behind
 * a key inside that fold; and none of it was reachable from the Agenda, the
 * Calendar or Focus at all — the pages the filters actually act on. You could
 * be looking at a silently narrowed agenda with no way to widen it without
 * swiping to another tab first.
 *
 * ─── The shape is the point ────────────────────────────────────────────────
 *
 * A full page, sectioned, in the order you would ask the questions: what state,
 * which board, which labels, whose. Each section states its CURRENT answer in
 * its heading, so the panel can be read without touching anything — which is
 * most of what "intuitive" means for a filter: knowing what is on before you
 * start changing it.
 *
 * Every control is the same chip. One shape to learn, and the only differences
 * that carry meaning are lit / unlit and the tick.
 *
 * ─── Two things that are easy to get wrong ─────────────────────────────────
 *
 *   · THE FOOTER SAYS THE COUNT. A filter panel that does not tell you how many
 *     things survive is a panel you have to close to evaluate. The number is
 *     live, so a chip that empties the list says so before you leave.
 *   · CLEAR ALL IS ALWAYS THERE, and disabled when there is nothing to clear
 *     rather than hidden — a key that appears and disappears is a key you
 *     cannot aim for.
 */
import React, { useCallback, useEffect, useMemo } from 'react';
import {
  BackHandler, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import EdgeSwipePage from '../../TurtleScreen/components/EdgeSwipePage';
import { tapHaptic } from '../../../utils/haptics';
import { boardLabel } from '../utils/taskHelpers';
import { panelBottomInset } from '../../../components/tabBarLayout';

const STATUS = [
  { key: 'todo', label: 'To do', icon: 'checkbox-blank-circle-outline' },
  { key: 'done', label: 'Done', icon: 'check-circle-outline' },
  { key: 'all', label: 'Everything', icon: 'format-list-bulleted' },
];

/** The sentinel the screen uses for "no board scope at all". */
const ALL = 'All';

/**
 * A chip. Every control on this page is one — the status keys, the boards, the
 * tags, the people — so there is exactly one thing to learn.
 */
function Chip({ label, active, onPress, icon, swatch, theme, testID, accessibilityLabel }) {
  const s = chipStyles(theme);
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
      {!!swatch && <View style={[s.swatch, { backgroundColor: swatch }]} />}
      {!!icon && !swatch && (
        <Icon name={icon} size={14} color={active ? theme.colors.accentInfo : theme.colors.textTertiary} />
      )}
      <Text style={[s.chipText, active && s.chipTextOn]} numberOfLines={1}>{label}</Text>
      {active && <Icon name="check" size={14} color={theme.colors.accentInfo} />}
    </Pressable>
  );
}

/** A section: its name, what it is currently set to, and its chips. */
function Section({ title, value, children, theme, testID }) {
  const s = chipStyles(theme);
  return (
    <View style={s.section} testID={testID}>
      <View style={s.sectionHead}>
        <Text style={s.sectionTitle} numberOfLines={1}>{title}</Text>
        {/* The heading carries the answer, so the panel reads without being
            operated. Its own testID because it deliberately says the same word
            as the lit chip below it — the summary and the control are two
            different claims that happen to share a label. */}
        <Text style={s.sectionValue} numberOfLines={1} testID={testID ? `${testID}-value` : undefined}>
          {value}
        </Text>
      </View>
      <View style={s.chipWrap}>{children}</View>
    </View>
  );
}

export default function PlannerFilterPanel({
  visible,
  onClose,
  theme,
  // Status
  statusFilter,
  onStatusChange,
  // Board scope
  projects = [],
  selectedProject,
  onSelectProject,
  // Tags
  tags = [],
  selectedTags = [],
  onToggleTag,
  tagFilterMode = 'any',
  onTagModeChange,
  // People (shared ponds only — a solo pond has nobody to disambiguate)
  owners = [],
  selectedOwners = [],
  onToggleOwner,
  ownerColor,
  // How many items survive everything above, live.
  matchCount = 0,
  onClearAll,
  bottomInset = 0,
}) {
  const insets = useSafeAreaInsets();
  const s = useMemo(() => chipStyles(theme), [theme]);

  const scoped = (selectedProject && selectedProject !== ALL)
    || statusFilter !== 'todo'
    || selectedTags.length > 0
    || selectedOwners.length > 0;

  const close = useCallback(() => { onClose?.(); }, [onClose]);

  // Android back closes the PANEL, not the screen under it. Registered while
  // visible, and BackHandler calls the most recent listener first.
  useEffect(() => {
    if (!visible) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { close(); return true; });
    return () => sub.remove();
  }, [visible, close]);

  const statusLabel = STATUS.find((o) => o.key === statusFilter)?.label || 'To do';

  return (
    <EdgeSwipePage overlay visible={visible} onClose={close}>
      <View style={[s.page, { backgroundColor: theme.colors.background }]}>
        {/* No safe-area padding at the top: this overlay opens INSIDE the
            Planner, under a header that has already cleared the status bar, so
            taking the inset again here was a notch's worth of nothing above the
            title. The BOTTOM inset still applies — nothing else clears the home
            indicator for us. */}
        <View style={[s.header, { paddingTop: 8 }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={close}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={s.backKey}
            testID="planner-filter-cancel"
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
            testID="planner-filter-clear"
            style={({ pressed }) => [s.clearKey, pressed && s.pressed]}
          >
            <Text style={[s.clearText, !scoped && s.clearTextOff]}>Clear</Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={[s.body, { paddingBottom: 24 }]}
          keyboardShouldPersistTaps="handled"
          testID="planner-filter-scroll"
        >
          <Section title="Status" value={statusLabel} theme={theme} testID="planner-filter-status">
            {STATUS.map((o) => (
              <Chip
                key={o.key}
                label={o.label}
                icon={o.icon}
                active={statusFilter === o.key}
                onPress={() => onStatusChange?.(o.key)}
                theme={theme}
                testID={`planner-filter-status-${o.key}`}
              />
            ))}
          </Section>

          <Section
            title="Board"
            value={selectedProject && selectedProject !== ALL ? boardLabel(selectedProject) : 'All boards'}
            theme={theme}
            testID="planner-filter-board"
          >
            <Chip
              label="All boards"
              icon="folder-multiple-outline"
              active={!selectedProject || selectedProject === ALL}
              onPress={() => onSelectProject?.(ALL)}
              theme={theme}
              testID="planner-filter-board-all"
            />
            {projects.map((p) => (
              <Chip
                key={p}
                label={boardLabel(p)}
                icon="folder-outline"
                active={selectedProject === p}
                onPress={() => onSelectProject?.(p)}
                theme={theme}
                testID={`planner-filter-board-${p}`}
              />
            ))}
          </Section>

          {tags.length > 0 && (
            <Section
              title="Labels"
              value={selectedTags.length
                ? `${selectedTags.length} chosen · ${tagFilterMode === 'all' ? 'match all' : 'match any'}`
                : 'Any'}
              theme={theme}
              testID="planner-filter-tags"
            >
              {tags.map((t) => (
                <Chip
                  key={t}
                  label={t}
                  icon="tag-outline"
                  active={selectedTags.includes(t)}
                  onPress={() => onToggleTag?.(t)}
                  theme={theme}
                  testID={`planner-filter-tag-${t}`}
                />
              ))}
            </Section>
          )}

          {/* ANY vs ALL only means something once two labels are picked — with
              one they select the same set, and offering a choice that changes
              nothing is how a panel teaches you not to trust its controls. */}
          {selectedTags.length > 1 && (
            <Section
              title="Match"
              value={tagFilterMode === 'all' ? 'Every label' : 'Any label'}
              theme={theme}
              testID="planner-filter-tagmode"
            >
              <Chip
                label="Any of them"
                active={tagFilterMode !== 'all'}
                onPress={() => onTagModeChange?.('any')}
                theme={theme}
                testID="planner-filter-tagmode-any"
              />
              <Chip
                label="All of them"
                active={tagFilterMode === 'all'}
                onPress={() => onTagModeChange?.('all')}
                theme={theme}
                testID="planner-filter-tagmode-all"
              />
            </Section>
          )}

          {owners.length > 0 && (
            <Section
              title="People"
              value={selectedOwners.length ? `${selectedOwners.length} chosen` : 'Everyone'}
              theme={theme}
              testID="planner-filter-people"
            >
              {owners.map((o) => (
                <Chip
                  key={o.userId}
                  label={o.ownerName || 'Someone'}
                  swatch={ownerColor ? ownerColor(o.userId) : undefined}
                  active={selectedOwners.includes(o.userId)}
                  onPress={() => onToggleOwner?.(o.userId)}
                  theme={theme}
                  testID={`planner-filter-owner-${o.userId}`}
                />
              ))}
            </Section>
          )}
        </ScrollView>

        {/* The count, live. Without it you have to close the panel to find out
            whether what you just picked left anything at all. */}
        {/* The footer clears the DOCK, which floats over this panel and reserves
            no layout space — its Show key and its count were sitting behind the
            capsule, two slivers poking out either side. See panelBottomInset;
            useBottomTabBarHeight() is the trap here, not the answer. */}
        <View style={[s.foot, { paddingBottom: panelBottomInset(insets.bottom) }]}>
          <Text style={s.footCount} numberOfLines={1} testID="planner-filter-count">
            {matchCount === 1 ? '1 item' : `${matchCount} items`}
            {scoped ? ' match' : ' in the Planner'}
          </Text>
          <Pressable
            onPressIn={() => tapHaptic()}
            onPress={close}
            accessibilityRole="button"
            accessibilityLabel="Show these items"
            testID="planner-filter-done"
            style={({ pressed }) => [s.doneKey, pressed && s.pressed]}
          >
            <Text style={s.doneText}>Show</Text>
          </Pressable>
        </View>
      </View>
    </EdgeSwipePage>
  );
}

const chipStyles = (theme) => StyleSheet.create({
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
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  sectionTitle: {
    fontSize: 11, fontWeight: '800', letterSpacing: 1,
    textTransform: 'uppercase', color: theme.colors.textTertiary,
  },
  // Shrinks and ellipsizes: a long board name must never push its own heading
  // off the page (STYLE-RULES §2).
  sectionValue: { flex: 1, fontSize: 12.5, color: theme.colors.textSecondary, textAlign: 'right' },
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
    backgroundColor: (theme.colors.accentInfo || '#5598e7') + (theme.mode === 'dark' ? '2E' : '1F'),
  },
  chipText: { flexShrink: 1, fontSize: 13, fontWeight: '600', color: theme.colors.textSecondary },
  chipTextOn: { color: theme.colors.accentInfo },
  swatch: { width: 10, height: 10, borderRadius: 5 },
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
