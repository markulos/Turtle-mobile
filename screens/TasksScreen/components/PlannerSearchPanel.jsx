/**
 * PlannerSearchPanel — the Planner's one search, asked from whichever tab you
 * are on.
 *
 * Search used to live on the Boards tab and nowhere else, which made it a
 * property of that page rather than of the Planner: to look for a task you had
 * to first go somewhere you did not want to be. The field is on the header now,
 * so it is on every tab, and this is what it opens.
 *
 * ─── One surface, four questions ───────────────────────────────────────────
 *
 * The tab you opened it from decides what the rows MEAN, because the same words
 * are a different errand on each page:
 *
 *   · agenda / calendar — "find this task". A hit opens it.
 *   · focus            — "what shall I work on?" A hit STARTS A BLOCK on it,
 *                        which is why its rows wear a play key and why its
 *                        empty query lists what is next rather than nothing.
 *   · boards           — "find this board". A hit scopes the Planner to it.
 *
 * What does NOT change is the surface: it is `VaultSearchPanel` wearing
 * `VaultResultRow`, the vault's board search exactly, because a second search
 * that looked almost like the first would be the worst of both. The scope chips
 * are the panel's own `filters` row, so they are the vault's chips too.
 *
 * ─── Why the matching is not in here ───────────────────────────────────────
 *
 * `utils/taskSearch` owns it, indexed: the index is rebuilt when the task list
 * changes and scored when the query does, so a keystroke costs one pass and no
 * allocations per task. This file decides what a row LOOKS like and what a tap
 * DOES, which is the part that differs per tab; it never decides what matches.
 */
import React, { useCallback, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import VaultSearchPanel from '../../TurtleScreen/components/VaultSearchPanel';
import { VaultResultRow } from '../../TurtleScreen/components/VaultSearchDock';
import { tapHaptic } from '../../../utils/haptics';
import { boardLabel } from '../utils/taskHelpers';
import { rankTasks, taskSearchMeta } from '../utils/taskSearch';

/** How many answers a query gets. Far past what fits — the list scrolls. */
const LIMIT = 60;

/**
 * The scope chips, and the fact that they are the SAME four everywhere the
 * rows are tasks. A per-tab chip set would mean learning the search three
 * times.
 */
const TASK_SCOPE_CHIPS = [
  { key: 'all', label: 'All' },
  { key: 'todo', label: 'To do' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'done', label: 'Done' },
];

/** The sentinel for "no board scope" — the screen's own, not a new one. */
const ALL = 'All';

/** What the field says it will do, per tab. The verb is the whole difference. */
const PLACEHOLDER = {
  assign: 'Which task is this session for?',
  focus: 'Find a task to focus on',
  boards: 'Search boards',
  list: 'Search your tasks',
  calendar: 'Search your tasks',
};

/**
 * What a board's row says under its name.
 *
 * Open work leads, because that is what picking a board is usually ABOUT. A
 * board with nothing left says so in words rather than showing "0 open", which
 * reads as an error at a glance; a board with nothing at all says nothing.
 */
function boardMetaLine(stat) {
  if (!stat || !stat.total) return '';
  const open = Math.max(0, (stat.total || 0) - (stat.done || 0));
  if (open === 0) return 'all done';
  const bits = [open === 1 ? '1 open' : `${open} open`];
  if (stat.overdue > 0) bits.push(`${stat.overdue} late`);
  return bits.join(' · ');
}

/** And what an empty result means, which is not the same sentence either. */
const EMPTY = {
  assign: 'No task matches that. A session with no task still counts.',
  focus: 'No task matches that. Start a block without one from the Focus tab.',
  boards: 'No board matches that.',
  list: 'No task matches that.',
  calendar: 'No task matches that.',
};

export default function PlannerSearchPanel({
  visible,
  mode = 'list',
  query,
  onQueryChange,
  onClose,
  scope = 'all',
  onScopeChange,
  // The prebuilt index from utils/taskSearch — NOT the raw tasks. Built by the
  // screen so it survives this panel opening and closing.
  taskIndex,
  projects = [],
  selectedProject,
  // name -> { total, done, overdue }, for the board rows' second line. The
  // screen already keeps it for the board rail's counts.
  boardStats,
  // (name) => hex, so a board's row wears the colour its cards do.
  boardColor,
  // Take the whole screen rather than the area under the Planner header. The
  // board PICKER does; the per-tab search does not, because you want to see
  // which tab you are searching.
  fullScreen = false,
  // (task) => void — open it. Agenda and Calendar.
  onOpenTask,
  // (task) => void — start a focus block on it. Focus.
  onFocusTask,
  // (task) => void — name the task the NEXT session is for, without starting
  // it. The Focus deck's own picker.
  onAssignTask,
  // (name) => void — scope the Planner to a board. Boards.
  onPickBoard,
  theme,
  isDark,
  nowMs,
}) {
  const styles = useMemo(() => panelStyles(theme), [theme]);
  const q = String(query || '').trim();
  const isBoards = mode === 'boards';
  const isFocus = mode === 'focus';
  const isAssign = mode === 'assign';

  // ── Boards: the names, filtered ───────────────────────────────────────────
  // Substring and case-insensitive, the same rule the vault's board search
  // uses: typing "cons" finds "Mayfield Construction".
  const boardRows = useMemo(() => {
    const list = Array.isArray(projects) ? projects : [];
    if (!q) return list;
    const needle = q.toLowerCase();
    return list.filter((p) => String(p).toLowerCase().includes(needle));
  }, [projects, q]);

  // ── Tasks: ranked against the index ───────────────────────────────────────
  const taskRows = useMemo(
    () => (isBoards ? [] : rankTasks(taskIndex, query, { limit: LIMIT, scope, now: nowMs ?? Date.now() })),
    [isBoards, taskIndex, query, scope, nowMs],
  );

  const items = useMemo(
    () => {
      if (!isBoards) return taskRows.map((t) => ({ key: `task-${t.id}`, task: t }));
      // "All boards" FIRST, and as a row rather than as a separate Clear key:
      // widening the scope back out is the same kind of choice as narrowing it,
      // so it belongs in the same list, at the top where the unfiltered state
      // lives. Hidden only when the query has ruled it out.
      const offerAll = !q || 'all boards'.includes(q.toLowerCase());
      return [
        ...(offerAll ? [{ key: 'board-__all__', name: ALL, isAll: true }] : []),
        ...boardRows.map((name) => ({ key: `board-${name}`, name })),
      ];
    },
    [isBoards, boardRows, taskRows, q],
  );

  const pickBoard = useCallback((name) => {
    tapHaptic();
    onPickBoard?.(name);
  }, [onPickBoard]);

  const pickTask = useCallback((task) => {
    tapHaptic();
    if (isAssign) onAssignTask?.(task);
    else if (isFocus) onFocusTask?.(task);
    else onOpenTask?.(task);
  }, [isAssign, isFocus, onAssignTask, onFocusTask, onOpenTask]);

  const renderRow = useCallback(({ item }) => {
    if (item.name !== undefined) {
      const isAll = !!item.isAll;
      const active = isAll
        ? (!selectedProject || selectedProject === ALL)
        : selectedProject === item.name;
      const tint = isAll ? null : boardColor?.(item.name);
      return (
        <VaultResultRow
          theme={theme}
          name={isAll ? 'All boards' : boardLabel(item.name)}
          meta={boardMetaLine(boardStats?.[isAll ? ALL : item.name])}
          accessibilityLabel={isAll ? 'All boards, no scope' : `${boardLabel(item.name)} board`}
          accessibilityState={{ selected: active }}
          testID={`planner-search-board-${isAll ? '__all__' : item.name}`}
          onPress={() => pickBoard(isAll ? ALL : item.name)}
          leading={(
            <Icon
              name={isAll ? 'folder-multiple-outline' : (active ? 'folder' : 'folder-outline')}
              size={20}
              // A board's own colour, so the row and the cards it scopes to
              // agree at a glance. Only where it HAS one — "All boards" is not
              // a board and must not borrow a hue that means one.
              color={tint || (active ? theme.colors.accentInfo : theme.colors.textMuted)}
            />
          )}
          trailing={active ? <Icon name="check" size={18} color={theme.colors.accentInfo} /> : null}
        />
      );
    }
    const t = item.task;
    const done = !!(t.completed || t.completedAt);
    return (
      <VaultResultRow
        theme={theme}
        name={t.title || 'Untitled'}
        meta={taskSearchMeta(t, { boardLabel, now: nowMs ?? Date.now() })}
        accessibilityLabel={isAssign ? `Focus on ${t.title} next` : (isFocus ? `Focus on ${t.title}` : t.title)}
        testID={`planner-search-task-${t.id}`}
        onPress={() => pickTask(t)}
        leading={(
          <Icon
            name={done ? 'check-circle' : (t.itemType === 'event' ? 'calendar' : 'checkbox-blank-circle-outline')}
            size={20}
            color={done ? theme.colors.accentSuccess || theme.colors.accentInfo : theme.colors.textMuted}
          />
        )}
        // A row that STARTS something and a row that merely names it are the
        // same row otherwise, so the difference is drawn on it — said once, on
        // the thing you are about to press, rather than in a note above the
        // list that nobody reads twice.
        trailing={(isFocus || isAssign) ? (
          <View style={styles.playKey}>
            <Icon name={isAssign ? 'target' : 'play'} size={16} color={theme.colors.accentInfo} />
          </View>
        ) : null}
      />
    );
  }, [theme, styles, selectedProject, isFocus, isAssign, pickBoard, pickTask, nowMs, boardStats, boardColor]);

  return (
    <VaultSearchPanel
      visible={visible}
      query={query}
      onQueryChange={onQueryChange}
      onClose={onClose}
      placeholder={PLACEHOLDER[mode] || PLACEHOLDER.list}
      accessibilityLabel={PLACEHOLDER[mode] || PLACEHOLDER.list}
      testIDPrefix="planner-search"
      inputTestID="planner-search-input"
      // Return takes the obvious answer: the top row, which is the one the
      // ranking already put there.
      onSubmitEditing={() => {
        if (isBoards) { if (boardRows.length) pickBoard(boardRows[0]); return; }  // a NAMED board, never "all"
        if (taskRows.length) pickTask(taskRows[0]);
      }}
      // Boards have no to-do / done / overdue, so they get no chips rather than
      // four that would do nothing.
      filters={isBoards ? null : TASK_SCOPE_CHIPS}
      activeFilter={scope}
      onFilterChange={(k) => { tapHaptic(); onScopeChange?.(k); }}
      items={items}
      keyExtractor={(r) => r.key}
      renderItem={renderRow}
      emptyText={EMPTY[mode] || EMPTY.list}
      fullScreen={fullScreen}
      // No safe-area padding when this opens INSIDE the Planner, under a header
      // that has already cleared the status bar — taking the inset again there
      // was a notch's worth of nothing above the field. Full-screen it owns the
      // status bar itself, so the inset is its job again (undefined = take it).
      insetTop={fullScreen ? undefined : 0}
      // The Focus tab's list before you have typed is a SUGGESTION, and saying
      // so is the difference between "here is what is next" and "here are some
      // tasks for no reason".
      ListHeaderComponent={(isFocus || isAssign) && !q ? (
        <Text style={styles.hint} testID="planner-search-focus-hint">
          {isAssign
            ? 'Up next — pick one, then press Start session.'
            : 'Up next — pick one to start a focus block on it.'}
        </Text>
      ) : null}
      theme={theme}
      isDark={isDark}
    />
  );
}

const panelStyles = (theme) => StyleSheet.create({
  hint: {
    paddingVertical: 10,
    fontSize: theme?.typography?.small || 13,
    color: theme.colors.textTertiary,
  },
  playKey: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: (theme.colors.accentInfo || '#5598e7') + '22',
  },
});
