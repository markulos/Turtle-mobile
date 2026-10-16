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
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BackHandler, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import EdgeSwipePage from '../../TurtleScreen/components/EdgeSwipePage';
import VaultSearchPanel from '../../TurtleScreen/components/VaultSearchPanel';
import { VaultResultRow } from '../../TurtleScreen/components/VaultSearchDock';
import { tapHaptic } from '../../../utils/haptics';
import { inkOn } from '../../../utils/accentColor';
import { boardLabel } from '../utils/taskHelpers';
import { previewChips } from '../utils/recentFirst';
import { panelBottomInset, panelTopInset } from '../../../components/tabBarLayout';

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
function Section({ title, value, children, theme, testID, action }) {
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
        {action}
      </View>
      <View style={s.chipWrap}>{children}</View>
    </View>
  );
}

/**
 * The search key a long section carries on its heading.
 *
 * A section shows the few you have touched most recently; the whole list is
 * longer than any chip wrap should be, so it lives behind this — the same
 * search page the task form's board picker and the vault use, so it is one
 * search to learn rather than three.
 */
function SearchKey({ label, onPress, theme, testID }) {
  const s = chipStyles(theme);
  return (
    <Pressable
      onPressIn={() => tapHaptic()}
      onPress={onPress}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      style={({ pressed }) => [s.sectionKey, pressed && s.pressed]}
    >
      <Icon name="magnify" size={16} color={theme.colors.accentInfo} />
    </Pressable>
  );
}

/**
 * "+9 more" / "Show less" — the rest of a long list, in place.
 *
 * Drawn as a chip because everything in this panel is, but deliberately
 * without the lit state: it changes how much you can SEE, never what is
 * filtered, and a control that looks like the others but means something else
 * is how a panel teaches you not to trust it.
 */
function MoreChip({ expanded, hidden, onPress, theme, testID }) {
  const s = chipStyles(theme);
  return (
    <Pressable
      onPressIn={() => tapHaptic()}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={expanded ? 'Show fewer' : `Show ${hidden} more`}
      testID={testID}
      style={({ pressed }) => [s.chip, s.moreChip, pressed && s.pressed]}
    >
      <Icon
        name={expanded ? 'chevron-up' : 'chevron-down'}
        size={14}
        color={theme.colors.textTertiary}
      />
      <Text style={[s.chipText, s.moreText]} numberOfLines={1}>
        {expanded ? 'Show less' : `${hidden} more`}
      </Text>
    </Pressable>
  );
}

export default function PlannerFilterPanel({
  visible,
  onClose,
  theme,
  // Status
  statusFilter,
  onStatusChange,
  // Board scope. `projects` is every board there is — what the SEARCH page
  // offers; `recentProjects` is the same names ordered by what you have
  // touched most recently, and the first few of those are the chips. A panel
  // that lists twenty-six boards alphabetically asks you to read all of them
  // to find the two you are working on this week.
  projects = [],
  recentProjects = [],
  selectedProject,
  onSelectProject,
  // Tags, the same way round.
  tags = [],
  recentTags = [],
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

  // How much of each long section is unfolded, and which one the search page
  // is open for ('board' | 'tag' | null).
  const [expanded, setExpanded] = useState({ board: false, tag: false });
  const [searchFor, setSearchFor] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const openSearch = useCallback((kind) => { setSearchQuery(''); setSearchFor(kind); }, []);
  const closeSearch = useCallback(() => { setSearchFor(null); setSearchQuery(''); }, []);
  const toggleExpanded = useCallback(
    (kind) => setExpanded((prev) => ({ ...prev, [kind]: !prev[kind] })),
    [],
  );

  // The ordered list each section draws from, and the few it shows closed.
  // Falls back to the full list when the screen has not supplied a recency
  // order, so the panel is never empty because a prop was forgotten.
  const boardOrder = recentProjects.length ? recentProjects : projects;
  const tagOrder = recentTags.length ? recentTags : tags;
  const boardsShown = useMemo(
    () => (expanded.board ? boardOrder : previewChips(boardOrder, selectedProject)),
    [expanded.board, boardOrder, selectedProject],
  );
  const tagsShown = useMemo(
    () => (expanded.tag ? tagOrder : previewChips(tagOrder, selectedTags)),
    [expanded.tag, tagOrder, selectedTags],
  );

  // What the search page lists: the WHOLE list for that kind, narrowed by the
  // query. Substring and case-insensitive, like every other search in the app
  // — typing "cons" has to find "Mayfield Construction".
  const searchMatches = useMemo(() => {
    if (!searchFor) return [];
    const all = searchFor === 'tag' ? tagOrder : boardOrder;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return all;
    return all.filter((n) => (searchFor === 'tag' ? n : boardLabel(n)).toLowerCase().includes(q));
  }, [searchFor, searchQuery, boardOrder, tagOrder]);

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
        {/* Both ends are the panel's own job. Opening INSIDE the Planner does
            NOT mean its header has covered this: the page is an absolute fill,
            so it lays out over the hood whatever the screen above it padded —
            OverviewPage is an overlay in this same tree and takes the whole
            inset. See panelTopInset; this is the bug it exists to close.
            Nothing else clears the home indicator or the dock below, either. */}
        <View style={[s.header, { paddingTop: panelTopInset(insets.top) }]}>
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
            action={projects.length > 0 && (
              <SearchKey
                label="Search boards"
                onPress={() => openSearch('board')}
                theme={theme}
                testID="planner-filter-board-search"
              />
            )}
          >
            <Chip
              label="All boards"
              icon="folder-multiple-outline"
              active={!selectedProject || selectedProject === ALL}
              onPress={() => onSelectProject?.(ALL)}
              theme={theme}
              testID="planner-filter-board-all"
            />
            {boardsShown.map((p) => (
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
            {boardOrder.length > boardsShown.length || expanded.board ? (
              <MoreChip
                expanded={expanded.board}
                hidden={boardOrder.length - boardsShown.length}
                onPress={() => toggleExpanded('board')}
                theme={theme}
                testID="planner-filter-board-more"
              />
            ) : null}
          </Section>

          {tags.length > 0 && (
            <Section
              title="Labels"
              value={selectedTags.length
                ? `${selectedTags.length} chosen · ${tagFilterMode === 'all' ? 'match all' : 'match any'}`
                : 'Any'}
              theme={theme}
              testID="planner-filter-tags"
              action={(
                <SearchKey
                  label="Search labels"
                  onPress={() => openSearch('tag')}
                  theme={theme}
                  testID="planner-filter-tag-search"
                />
              )}
            >
              {tagsShown.map((t) => (
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
              {tagOrder.length > tagsShown.length || expanded.tag ? (
                <MoreChip
                  expanded={expanded.tag}
                  hidden={tagOrder.length - tagsShown.length}
                  onPress={() => toggleExpanded('tag')}
                  theme={theme}
                  testID="planner-filter-tag-more"
                />
              ) : null}
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

        {/* Search over EVERY board / label, for the ones the chips do not
            show. The vault's search page, as the task form's board picker
            already uses it — one search to learn rather than three.

            ── fullScreen, and why it has to be ──────────────────────────────
            As an in-tree overlay it filled THIS PANEL, which is itself laid
            out inside the Planner — so the Planner's header and tab row sat
            above the search field and the day sheet and the dock sat over the
            results. A page you opened by pressing something, framed by three
            things you did not. STYLE-RULES §4: it covers everything.

            The Modal form is allowed here precisely because this panel is an
            in-tree overlay and not a Modal itself — iOS drops a sibling Modal
            over an OPEN one, which is the case `overlay` exists for and is not
            this one. Same arrangement as the Notes topic search over the Notes
            filter panel. It renders nothing while closed. */}
        <VaultSearchPanel
          fullScreen
          visible={!!searchFor}
          placeholder={searchFor === 'tag' ? 'Search labels' : 'Search boards'}
          accessibilityLabel={searchFor === 'tag' ? 'Search labels' : 'Search boards'}
          query={searchQuery}
          onQueryChange={setSearchQuery}
          onClose={closeSearch}
          items={searchMatches}
          keyExtractor={(name) => name}
          emptyText={searchFor === 'tag' ? 'No label matches that.' : 'No board matches that.'}
          theme={theme}
          isDark={theme.mode === 'dark'}
          testIDPrefix="planner-filter-search"
          renderItem={({ item }) => {
            const picked = searchFor === 'tag'
              ? selectedTags.includes(item)
              : selectedProject === item;
            return (
              <VaultResultRow
                name={searchFor === 'tag' ? item : boardLabel(item)}
                theme={theme}
                accessibilityState={{ selected: picked }}
                accessibilityLabel={`${searchFor === 'tag' ? item : boardLabel(item)}${picked ? ', chosen' : ''}`}
                testID={`planner-filter-search-pick-${item}`}
                leading={(
                  <Icon
                    name={searchFor === 'tag' ? 'tag-outline' : 'folder-outline'}
                    size={18}
                    color={theme.colors.textTertiary}
                  />
                )}
                trailing={picked ? <Icon name="check" size={18} color={theme.colors.accentInfo} /> : null}
                onPress={() => {
                  tapHaptic();
                  if (searchFor === 'tag') {
                    // Labels are a multi-pick, so the page STAYS: choosing
                    // three in a row should not be three trips through it.
                    onToggleTag?.(item);
                    return;
                  }
                  onSelectProject?.(item);
                  closeSearch();
                }}
              />
            );
          }}
        />
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
  // `center`, not `baseline`: the heading now carries a round key as well as
  // two lines of text, and a 28pt circle has no baseline to sit on — it would
  // hang off the bottom of the row.
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionTitle: {
    fontSize: 11, fontWeight: '800', letterSpacing: 1,
    textTransform: 'uppercase', color: theme.colors.textTertiary,
  },
  // Shrinks and ellipsizes: a long board name must never push its own heading
  // off the page (STYLE-RULES §2).
  sectionValue: { flex: 1, fontSize: 12.5, color: theme.colors.textSecondary, textAlign: 'right' },
  // The one key a heading may carry — the whole list is longer than any chip
  // wrap should be, so the sections that can run long keep a search.
  sectionKey: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: (theme.colors.accentInfo || '#5598e7') + (theme.mode === 'dark' ? '24' : '16'),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: (theme.colors.accentInfo || '#5598e7') + '55',
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
    backgroundColor: (theme.colors.accentInfo || '#5598e7') + (theme.mode === 'dark' ? '2E' : '1F'),
  },
  chipText: { flexShrink: 1, fontSize: 13, fontWeight: '600', color: theme.colors.textSecondary },
  chipTextOn: { color: theme.colors.accentInfo },
  // "N more" is a chip in shape only. No fill and a dashed-quiet edge, so a
  // row of filters never looks like it has one more filter in it than it has.
  moreChip: { backgroundColor: 'transparent', borderColor: theme.colors.borderStrong || theme.colors.border },
  moreText: { color: theme.colors.textTertiary, fontWeight: '700' },
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
  // Inked against the key's own fill: `background` is the PAGE colour, which on
  // a light theme is near-white — invisible once the accent is a pale one.
  doneText: { fontSize: 14, fontWeight: '800', color: inkOn(theme.colors.accentInfo) },
});
