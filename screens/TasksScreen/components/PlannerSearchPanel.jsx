/**
 * PlannerSearchPanel — the Planner's one search, asked from whichever tab you
 * are on.
 *
 * Search used to live on the Boards tab and nowhere else, which made it a
 * property of that page rather than of the Planner: to look for a task you had
 * to first go somewhere you did not want to be. The field is on the header now,
 * so it is on every tab, and this is what it opens.
 *
 * ─── One surface, three questions ──────────────────────────────────────────
 *
 * Not one per TAB — that was the earlier arrangement and it is the thing that
 * went wrong. The header key read the tab underneath it, so the same magnifier
 * searched boards on one page and started a focus block on another, and the
 * plain question "where is that task" could only be asked from half the
 * Planner. The key asks that one question now, from everywhere. What is left
 * is three callers, each opening this from the surface its errand belongs to:
 *
 *   · list   — the header key. "Find this task", any task, any tab. A hit
 *              opens it for editing.
 *   · assign — the Focus deck's own picker. A hit NAMES the task the next
 *              session is for; it does not start one. Composes as well as
 *              finds, which is why its rows wear a key and its empty query
 *              lists what is next rather than nothing.
 *   · boards — the title. "Find this board". A hit scopes the Planner to it.
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
import { BOARD_ANY, needsCreateRow, rankTasks, taskSearchMeta } from '../utils/taskSearch';

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

/** What the field says it will do, per tab. The verb is the whole difference. */
const PLACEHOLDER = {
  assign: 'Pick or create a task',
  boards: 'Search boards',
  list: 'Search every task',
};

/** …and what it says instead when the Planner is on a board. */
const scopedPlaceholder = (board) => `Search ${boardLabel(board)}`;

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
  // Only ever seen with an EMPTY field now: type anything and the create row
  // heads the list, so "nothing matches" is never a dead end.
  assign: 'No task matches that. A session with no task still counts.',
  boards: 'No board matches that.',
  list: 'No task matches that.',
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
  // EdgeSwipePage's Modal form rather than its in-tree overlay. Both cover the
  // screen; what differs is whether another Modal can be presented over the
  // top, and on iOS the answer for a sibling Modal is no.
  //
  // So this is decided by WHAT A HIT DOES, not by how much room the panel
  // wants. The two pickers only set state, so they take the Modal. The task
  // search opens the edit FORM, which is itself a Modal — it has to be the
  // overlay, mounted on the screen's unpadded frame so it still starts at the
  // top of the screen. The Planner's own note at that call site has the
  // longer version.
  fullScreen = false,
  // (task) => void — open it for editing. The header key.
  onOpenTask,
  // (task) => void — name the task the NEXT session is for, without starting
  // it. The Focus deck's own picker.
  onAssignTask,
  // (title) => void — nothing carries that title, so make it. Given only where
  // creating is part of the job (assign / focus); without it the row never
  // appears and the panel stays a pure search.
  onCreateTask,
  // (name) => void — scope the Planner to a board. Boards.
  onPickBoard,
  theme,
  isDark,
  nowMs,
}) {
  const styles = useMemo(() => panelStyles(theme), [theme]);
  const q = String(query || '').trim();
  const isBoards = mode === 'boards';
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

  /**
   * THE PLANNER'S BOARD, applied to the search.
   *
   * One scope, named in the title, obeyed by every tab — the search included,
   * or it is the one place where being on a board does not mean being on it.
   * Only where the rows are TASKS and only where the panel SAYS so (below):
   * a filter you cannot see is indistinguishable from missing data.
   *
   * Not the board picker, obviously — that lists boards, and a board picker
   * showing one board is a picker you cannot use to leave it.
   */
  const boardScope = (!isBoards && selectedProject && selectedProject !== BOARD_ANY)
    ? selectedProject
    : null;

  // ── Tasks: ranked against the index ───────────────────────────────────────
  const taskRows = useMemo(
    () => (isBoards
      ? []
      : rankTasks(taskIndex, query, { limit: LIMIT, scope, board: boardScope, now: nowMs ?? Date.now() })),
    [isBoards, taskIndex, query, scope, boardScope, nowMs],
  );

  /**
   * "Create X" heads the list whenever what you typed is not already the exact
   * title of one of the answers — the same rule the Planner's finder uses
   * (CalendarView's `showCreate`), kept in one place so the two cannot drift.
   *
   * Only where a create makes sense: picking the task a session is for.
   * Searching the tasks or the boards is a lookup, not a composer.
   */
  const canCreate = isAssign && !!onCreateTask;
  const showCreate = canCreate && needsCreateRow(query, taskRows);

  const items = useMemo(
    () => {
      if (!isBoards) {
        return [
          ...(showCreate ? [{ key: 'create', createTitle: q }] : []),
          ...taskRows.map((t) => ({ key: `task-${t.id}`, task: t })),
        ];
      }
      // "All boards" FIRST, and as a row rather than as a separate Clear key:
      // widening the scope back out is the same kind of choice as narrowing it,
      // so it belongs in the same list, at the top where the unfiltered state
      // lives. Hidden only when the query has ruled it out.
      const offerAll = !q || 'all boards'.includes(q.toLowerCase());
      return [
        ...(offerAll ? [{ key: 'board-__all__', name: BOARD_ANY, isAll: true }] : []),
        ...boardRows.map((name) => ({ key: `board-${name}`, name })),
      ];
    },
    [isBoards, boardRows, taskRows, q, showCreate],
  );

  const pickBoard = useCallback((name) => {
    tapHaptic();
    onPickBoard?.(name);
  }, [onPickBoard]);

  /**
   * Make the task the field is describing, then do with it what this panel was
   * opened to do — assign it to the next session, or start one on it. Creating
   * and then having to find it again would be two steps for one intention.
   */
  const createTask = useCallback(() => {
    const title = String(query || '').trim();
    if (!title) return;
    tapHaptic();
    onCreateTask?.(title);
  }, [onCreateTask, query]);

  const pickTask = useCallback((task) => {
    tapHaptic();
    if (isAssign) onAssignTask?.(task);
    else onOpenTask?.(task);
  }, [isAssign, onAssignTask, onOpenTask]);

  const renderRow = useCallback(({ item }) => {
    if (item.createTitle !== undefined) {
      return (
        <VaultResultRow
          theme={theme}
          name={item.createTitle}
          // What pressing it will DO, said on the row itself: it does not just
          // make a task, it makes the one this session is about.
          meta="New task · for this session"
          accessibilityLabel={`Create task ${item.createTitle}`}
          testID="planner-search-create"
          onPress={createTask}
          leading={<Icon name="plus" size={20} color={theme.colors.accentInk} />}
          trailing={(
            <View style={styles.playKey}>
              <Icon name="target" size={16} color={theme.colors.accentInk} />
            </View>
          )}
        />
      );
    }
    if (item.name !== undefined) {
      const isAll = !!item.isAll;
      const active = isAll
        ? (!selectedProject || selectedProject === BOARD_ANY)
        : selectedProject === item.name;
      const tint = isAll ? null : boardColor?.(item.name);
      return (
        <VaultResultRow
          theme={theme}
          name={isAll ? 'All boards' : boardLabel(item.name)}
          meta={boardMetaLine(boardStats?.[isAll ? BOARD_ANY : item.name])}
          accessibilityLabel={isAll ? 'All boards, no scope' : `${boardLabel(item.name)} board`}
          accessibilityState={{ selected: active }}
          testID={`planner-search-board-${isAll ? '__all__' : item.name}`}
          onPress={() => pickBoard(isAll ? BOARD_ANY : item.name)}
          leading={(
            <Icon
              name={isAll ? 'folder-multiple-outline' : (active ? 'folder' : 'folder-outline')}
              size={20}
              // A board's own colour, so the row and the cards it scopes to
              // agree at a glance. Only where it HAS one — "All boards" is not
              // a board and must not borrow a hue that means one.
              color={tint || (active ? theme.colors.accentInk : theme.colors.textMuted)}
            />
          )}
          trailing={active ? <Icon name="check" size={18} color={theme.colors.accentInk} /> : null}
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
        accessibilityLabel={isAssign ? `Focus on ${t.title} next` : t.title}
        testID={`planner-search-task-${t.id}`}
        onPress={() => pickTask(t)}
        leading={(
          <Icon
            name={done ? 'check-circle' : (t.itemType === 'event' ? 'calendar' : 'checkbox-blank-circle-outline')}
            size={20}
            color={done ? theme.colors.accentSuccess || theme.colors.accentInk : theme.colors.textMuted}
          />
        )}
        // A row that STARTS something and a row that merely names it are the
        // same row otherwise, so the difference is drawn on it — said once, on
        // the thing you are about to press, rather than in a note above the
        // list that nobody reads twice.
        trailing={isAssign ? (
          <View style={styles.playKey}>
            <Icon name="target" size={16} color={theme.colors.accentInk} />
          </View>
        ) : null}
      />
    );
  }, [theme, styles, selectedProject, isAssign, pickBoard, pickTask, createTask, nowMs, boardStats, boardColor]);

  return (
    <VaultSearchPanel
      visible={visible}
      query={query}
      onQueryChange={onQueryChange}
      onClose={onClose}
      placeholder={boardScope ? scopedPlaceholder(boardScope) : (PLACEHOLDER[mode] || PLACEHOLDER.list)}
      accessibilityLabel={boardScope ? scopedPlaceholder(boardScope) : (PLACEHOLDER[mode] || PLACEHOLDER.list)}
      testIDPrefix="planner-search"
      inputTestID="planner-search-input"
      // Return takes the obvious answer: the top row, which is the one the
      // ranking already put there.
      onSubmitEditing={() => {
        if (isBoards) { if (boardRows.length) pickBoard(boardRows[0]); return; }  // a NAMED board, never "all"
        // RETURN CREATES when nothing carries that exact title — the create row
        // is what heads the list, so Return takes the top answer either way.
        if (showCreate) { createTask(); return; }
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
      // Nothing matching INSIDE a board is a different fact from nothing
      // matching at all, and the difference is the next thing you would do.
      emptyText={boardScope
        ? `No task in ${boardLabel(boardScope)} matches that. The title widens the scope.`
        : (EMPTY[mode] || EMPTY.list)}
      fullScreen={fullScreen}
      // No insetTop: the hood is the panel's job in BOTH forms. The overlay
      // form opening inside the Planner does not inherit its header's
      // clearance — an absolute fill lays out over the hood regardless — so the
      // 0 this used to pass put the search field through the clock. See
      // panelTopInset.
      // The picker's list before you have typed is a SUGGESTION, and saying so
      // is the difference between "here is what is next" and "here are some
      // tasks for no reason". The header key's list needs no such note: an
      // untyped search obviously has nothing to say yet.
      ListHeaderComponent={(
        <>
          {/* WHAT YOU ARE SEARCHING INSIDE. The board is the Planner's scope,
              so the search obeys it — and a narrowed list with nothing on
              screen saying so is the bug that would make, not the feature.
              Wears the board's own colour, the same mark its chip does. */}
          {boardScope ? (
            <View style={styles.scopeLine} testID="planner-search-board-scope">
              <View style={[styles.scopeDot, { backgroundColor: boardColor?.(boardScope) || theme.colors.accentInfo }]} />
              <Text style={styles.scopeText} numberOfLines={1}>
                {`Within ${boardLabel(boardScope)} — the board the Planner is on`}
              </Text>
            </View>
          ) : null}
          {isAssign && !q ? (
            <Text style={styles.hint} testID="planner-search-focus-hint">
              Up next — pick one, or type a new one. You still press Start session.
            </Text>
          ) : null}
        </>
      )}
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
  scopeLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 10,
  },
  scopeDot: { width: 8, height: 8, borderRadius: 4 },
  scopeText: {
    flexShrink: 1,
    fontSize: theme?.typography?.small || 13,
    color: theme.colors.textTertiary,
  },
});
