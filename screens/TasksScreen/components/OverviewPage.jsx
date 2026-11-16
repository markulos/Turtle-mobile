/**
 * OverviewPage — task stats for every board, on a page that overlays the
 * calendar (an in-tree EdgeSwipePage overlay: slides in from the right,
 * left-edge swipe back; sibling Modals like FilterMenu / TaskDetail still
 * present over it).
 *
 * Reads like the reference stat tile (docs/STYLE-RULES.md §1, inset cards):
 * four inset tiles on top — To do, Done, Late, Today — each an icon tile, a
 * big bold figure and a muted caption; then one inset row per board with its
 * colour dot, done / total, a to-do · late caption, a hairline progress track
 * and "shared by …" where the board is someone else's. A row drills into the
 * board: its tags, then the actual to-do and done lists, with a key to show
 * that board on the calendar. Tags get their own section at the end.
 *
 * The tag / owner filters live here too (the funnel key in the header), since
 * the Tasks header gave its filter key to this page.
 */
import React, { memo, useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Reanimated, {
  Easing as ReEasing, runOnJS, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import EdgeSwipePage from '../../TurtleScreen/components/EdgeSwipePage';
import AppTextInput from '../../../components/AppTextInput';
import { tapHaptic } from '../../../utils/haptics';
// One string down the whole tab — the inbox lines, the boards, and the tasks a
// board reveals all sit on it, so the geometry cannot live in any one of them.
import {
  THREAD_X, BEAD, BEAD_SMALL, ROW_PAD_LEFT, REVEAL_MS, REVEAL_OUT_MS, REVEAL_RISE,
} from '../utils/threadGeometry';
import { focusSkin } from '../utils/focusSkin';
import { NEU_GAP, NEU_PAGE_TOP, neuRaised } from '../../../utils/neumorph';
import Grain from '../../../components/Grain';
import { RULE_HIGHLIGHT, RULE_W } from '../../../utils/surfaceDepth';
import { insetRule } from '../../../utils/surfaceDepth';
import { boardLabel, isTaskDoneNow, itemTypeOf, localTodayStr } from '../utils/taskHelpers';
import { overviewStats, NO_BOARD } from '../utils/overviewStats';
import { INPUT_FIELD } from '../../../utils/inputField';
import StatsPanel from './StatsPanel';
import { SCROLL_INDICATOR } from '../../../utils/scrollIndicator';

const pct = (done, total) => (total > 0 ? Math.round((done / total) * 100) : 0);

/**
 * A colour at a fraction of its strength, as an 8-digit hex.
 *
 * Only for a real 6-digit hex — the boardless row's "colour" is a THEME TOKEN
 * (`textTertiary`), which may already be an `rgba()` and would become
 * `rgba(...)1F`: not a colour, and RN renders an invalid colour as black. It
 * falls back to no fill, which is the honest answer for a row that has no
 * colour of its own.
 */
function faint(hex, alpha) {
  if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) return 'transparent';
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0');
  return `${hex}${a}`;
}

/** One shared empty list — a fresh `[]` per render busts every tile's memo. */
const EMPTY_TASKS = [];

/**
 * The space between two boards, and therefore how far each tile's thread
 * overhangs its own borders: half of it at each end, so consecutive segments
 * meet exactly. Derived in one place because the two have to agree — a gap and
 * an overhang that disagree leave either a break in the string or a double
 * hairline at every join.
 */
const BOARD_GAP = 8;

/**
 * The tile's corner and the weight of its coloured edge — named because the
 * white liner inside it is DERIVED from both: its radius is this one less the
 * border it sits within, or the two curves run at different rates round the
 * corner and the line pinches against the colour.
 */
const BD_TILE_RADIUS = 14;
const BD_TILE_BORDER = 2;
const BD_TILE_BORDER_ON = 3;


/**
 * The embedded shell: a box that simply fills its slot.
 *
 * It exists so the page's root can be chosen by a prop without duplicating the
 * whole tree — and it has to be a real View, not a fragment, because the
 * drill-downs below render as absolute-fill overlays and an absolute child
 * needs a positioned parent to fill.
 */
function EmbeddedShell({ children }) {
  return <View style={styles.embedded}>{children}</View>;
}

/** The board finder's pill — the placeholder centres itself against it. */
const FINDER_HEIGHT = 46;

/**
 * A stat tile. Given an `onPress` it becomes the way into the list behind the
 * number — a figure you cannot open is a dead end, and "3 late" is exactly the
 * moment you want to know WHICH three.
 */
function Tile({ icon, label, value, caption, pal, neu, grain, accent, testID, onPress }) {
  const body = (
    <>
      <Grain level={grain} fine radius={16} />
      <View style={styles.tileTop}>
        <View style={[styles.iconTile, { backgroundColor: pal.tile }]}>
          <Icon name={icon} size={15} color={accent || pal.text} />
        </View>
        <Text style={[styles.label, { color: pal.muted }]} numberOfLines={1}>{label}</Text>
        {!!onPress && <Icon name="chevron-right" size={15} color={pal.muted} />}
      </View>
      <Text style={[styles.value, { color: accent || pal.text }]} numberOfLines={1}>{value}</Text>
      <Text style={[styles.caption, { color: pal.muted }]} numberOfLines={1}>{caption}</Text>
    </>
  );
  // RAISED, not outlined: the tile is the page's own colour and only the light
  // separates them (utils/neumorph, STYLE-RULES §9). The rim it used to carry
  // is gone with the fill change — an edge you can see is the other style.
  const box = [styles.tile, neu];
  if (!onPress) return <View style={box} testID={testID}>{body}</View>;
  return (
    <Pressable
      onPressIn={() => tapHaptic()}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}, ${caption}`}
      testID={testID}
      style={({ pressed }) => [...box, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

function Track({ done, total, pal, color }) {
  return (
    <View style={[styles.track, { backgroundColor: pal.track }]}>
      <View style={[styles.fill, { width: `${pct(done, total)}%`, backgroundColor: color || pal.text }]} />
    </View>
  );
}

/**
 * The body rolling open and shut.
 *
 * ─── Why this is Reanimated and not Animated ───────────────────────────────
 *
 * A collapse is a LAYOUT change: everything below the board has to come up as
 * it closes, and a transform cannot move the boards underneath. So the height
 * is what animates — and `Animated` with `useNativeDriver: false` drives that
 * from JAVASCRIPT, one value per frame, each one triggering a layout pass over
 * the whole scroller: the capture block, the written lines, and twenty-six
 * bordered tiles. That is not a slow animation, it is sixty full layouts a
 * second queued behind everything else on the JS thread.
 *
 * Reanimated runs the same interpolation on the UI thread, so the per-frame
 * work never touches JS. LayoutAnimation would also have been native, but it is
 * GLOBAL — this screen already carries a scar from one capturing every other
 * layout change in its frame (see CalendarView's keyboard listener).
 *
 * ─── IT MEASURES IN A PASS OF ITS OWN, AND THAT IS NOT OPTIONAL ────────────
 *
 * A height animation needs a height to animate TO, and the obvious way to get
 * one — put the content inside the collapsing box and read its `onLayout` —
 * cannot work: the box is clipped and starts at zero, so the thing being
 * measured is measured inside the constraint it is supposed to escape. Shipped
 * that way, every board simply stayed shut: the animation was waiting on a
 * measurement that was never coming.
 *
 * So an unmeasured body renders ONCE, absolutely positioned and invisible. Out
 * of flow it takes no height from the tile, so nothing moves and nothing
 * flashes; `left: 0, right: 0` gives it the tile's width, which is all a height
 * measurement needs. The moment it reports one, the real collapsing box takes
 * over and the roll begins. Measured heights survive a close (the component
 * stays mounted and only returns null), so it is one extra pass per board, ever.
 *
 * ─── And the two smaller stutters ──────────────────────────────────────────
 *
 *   · `onLayout` ONLY COUNTS ONCE PER SIZE. Setting state from a layout the
 *     animation itself provokes is a re-render per frame, which is the JS
 *     thread busy exactly when it must not be.
 *   · It stays mounted until the close has finished, or there would be nothing
 *     left to animate.
 */
function Collapsible({ open, children }) {
  const [measured, setMeasured] = useState(0);
  const [mounted, setMounted] = useState(open);
  const p = useSharedValue(open ? 1 : 0);
  // What the roll is already heading for, so a re-render mid-animation does not
  // restart it from wherever it had got to.
  const target = useRef(open ? 1 : 0);

  useEffect(() => { if (open) setMounted(true); }, [open]);

  useEffect(() => {
    if (!mounted) return;
    // Nothing to roll against yet — the measuring pass will bring us back.
    if (open && measured === 0) return;
    const to = open ? 1 : 0;
    if (target.current === to && p.value === to) return;
    target.current = to;
    p.value = withTiming(
      to,
      { duration: open ? REVEAL_MS : REVEAL_OUT_MS, easing: ReEasing.out(ReEasing.cubic) },
      (finished) => { if (finished && !open) runOnJS(setMounted)(false); },
    );
  }, [open, mounted, measured, p]);

  // Depends on `measured`, so a board whose task list changes while it is open
  // simply takes the new height — no second animation, no re-measure dance.
  const style = useAnimatedStyle(() => ({
    height: p.value * measured,
    opacity: p.value,
    transform: [{ translateY: (1 - p.value) * -REVEAL_RISE }],
  }), [measured]);

  const onLayout = (e) => {
    const h = Math.round(e.nativeEvent.layout.height);
    // Same height, same state object: no re-render. A layout provoked by the
    // animation must never cost one.
    if (h > 0) setMeasured((m) => (m === h ? m : h));
  };

  if (!mounted) return null;

  // The measuring pass: out of flow, invisible, and not in anyone's way.
  if (measured === 0) {
    return (
      <View style={styles.bdMeasure} pointerEvents="none" onLayout={onLayout} testID="board-measuring">
        {children}
      </View>
    );
  }

  return (
    <Reanimated.View testID="board-collapsible" style={[styles.bdCollapse, style]}>
      <View onLayout={onLayout}>{children}</View>
    </Reanimated.View>
  );
}

/**
 * A board — the coloured rectangle, and everything in it.
 *
 * OPENED, THE BORDER ENVELOPES THE LOT: the header row, the tasks, their beads
 * and the length of string they hang on. A board that holds tasks should look
 * like it holds them.
 *
 * ─── The string crosses the borders ────────────────────────────────────────
 *
 * Each tile draws its OWN segment of thread, running half a gap past its top
 * and bottom edges. A child paints over its parent's border, so the line
 * visibly crosses each rectangle instead of stopping at it, and consecutive
 * segments meet exactly in the gap. Half a gap and no more: overlapping
 * segments composite two hairlines into one darker one at every join.
 *
 * THE BEADS PAINT OVER THE THREAD because they come after it in the tree, and
 * they are filled with the page's colour — so the string runs behind each bead
 * rather than through it.
 *
 * ITS INK IS THE PAGE'S, not the inset palette's: those cards are charcoal in
 * both modes, so a surface drawing the page's own fill with their text colour
 * is white-on-white in light mode. That bug has shipped three times here.
 */
function BoardTile({
  row, dot, sharedBy, selected, expanded, tasks, todayStr, c,
  // THE PAGE'S OWN COLOUR. The thread runs behind the bead, so the bead has to
  // be filled with whatever is behind it — and on this tab that is the
  // neumorphic surface, not `c.background` (STYLE-RULES §9).
  surface,
  adding, addQuery, onAddQueryChange, onStartAdd, onCancelAdd, onSubmitAdd,
  // onManage — (name) => the ALL-boards manager (add one, see them all), on a
  // long press. The tap and the pencil both belong to THIS board now, and the
  // manager is a different question.
  onToggle, onOpen, onOpenTask, onManage,
}) {
  const open = row.total - row.done;
  const q = String(addQuery || '').trim().toLowerCase();
  // Typing in the add box NARROWS what is shown as well as naming what would be
  // created — so "is this already here?" and "put it here" are one gesture
  // rather than two, which is the whole reason it is one box.
  const shown = adding && q
    ? tasks.filter((t) => String(t.title || '').toLowerCase().includes(q))
    : tasks;

  return (
    <View
      style={[styles.bdTile, { borderColor: dot }, selected && styles.bdTileOn]}
      testID={`overview-board-wrap-${row.name}`}
    >
      {/* A WHITE LINE HUGGING THE OUTLINE, and that is the whole of the depth.
          The colour stays exactly what it was — flat, one hue, the board's own
          — and the light sits BESIDE it rather than being mixed into it. Two
          adjacent edges, one coloured and one lit, is what the header's rule
          does across a page; wrapped around a rectangle it reads as the same
          material, which is the point of borrowing its white rather than
          picking one.

          Absolutely filled, so it traces the tile's PADDING box — immediately
          inside the coloured border, with no gap to misalign. Its radius is the
          tile's less the border it sits within, or the two curves would run at
          different rates round the corners and the line would pinch. */}
      <View pointerEvents="none" style={[styles.bdTileLiner, selected && styles.bdTileLinerOn]} />
      {/* This tile's length of the string, running past both its borders. */}
      <View style={[styles.bdThread, { backgroundColor: c.border }]} pointerEvents="none" />

      {/* ── The head OPENS the board ──────────────────────────────────────
          It used to unfold the tile, which made the board's name the one
          thing on the card that did not take you to the board — the tap
          everybody tries first landed on a six-row preview instead. The
          preview is still here; it is what the chevron is for, and the
          chevron is the mark that already said so. */}
      <Pressable
        onPressIn={() => tapHaptic()}
        onPress={onOpen}
        onLongPress={onManage ? () => onManage(row.name) : undefined}
        accessibilityRole="button"
        accessibilityState={{ selected: !!selected, expanded: !!expanded }}
        accessibilityLabel={`${boardLabel(row.name)}: ${row.done} of ${row.total} done${row.overdue ? `, ${row.overdue} late` : ''}. Opens the board.`}
        testID={`overview-board-${row.name}`}
        style={({ pressed }) => [styles.bdHead, pressed && styles.pressed]}
      >
        <View style={[styles.bdBead, { backgroundColor: surface, borderColor: dot }]} />
        <View style={styles.bdTileText}>
          <View style={styles.bdNameRow}>
            <Text style={[styles.bdTileName, { color: c.textPrimary }]} numberOfLines={1}>
              {boardLabel(row.name)}
            </Text>
            {/* The pencil stays with the NAME, because that is what it edits —
                and it lands on the board's own page, which is where editing
                now happens: the name is renamed by tapping it in that page's
                header. It used to open a sheet listing every board, which is
                an odd answer to "edit THIS one".
                Quiet by default — it is on every board, so at full strength
                twenty-six of them would be the loudest thing on the page — and
                it comes up to full on press. */}
            <Pressable
              onPressIn={() => tapHaptic()}
              onPress={onOpen}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={`Edit ${boardLabel(row.name)}`}
              testID={`overview-board-edit-${row.name}`}
              style={({ pressed }) => [styles.bdVerb, pressed && styles.bdVerbOn]}
            >
              <Icon name="pencil-outline" size={15} color={c.textSecondary} />
            </Pressable>
          </View>
          <Text style={[styles.bdTileCaption, { color: c.textTertiary }]} numberOfLines={1}>
            {row.total === 0 ? 'Empty' : `${row.done}/${row.total} done`}
            {row.overdue > 0 ? <Text style={styles.late}> · {row.overdue} late</Text> : null}
            {row.today > 0 ? ` · ${row.today} today` : ''}
            {sharedBy ? ` · ${sharedBy}` : ''}
          </Text>
        </View>
        {/* ADD, in a FIXED SLOT. Beside the name it sat wherever that name
            happened to end, so on a column of boards it landed in twenty-six
            different places and there was nowhere to aim. Here it is a fixed
            distance from the right edge on every card: the same target every
            time, and the row's own gap keeps it clear of the count and of the
            chevron that closes the board.

            A tinted square rather than a bare glyph, in the BOARD's colour at a
            tenth: enough to read as a key you can hit, faint enough that a page
            of them is still a list of boards rather than a row of buttons. */}
        <Pressable
          onPressIn={() => tapHaptic()}
          onPress={() => onStartAdd?.(row.name)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Add a task to ${boardLabel(row.name)}`}
          testID={`overview-board-add-${row.name}`}
          style={({ pressed }) => [
            styles.bdAddKey,
            { backgroundColor: faint(dot, adding ? 0.28 : 0.12) },
            pressed && styles.pressed,
          ]}
        >
          <Icon name="plus" size={17} color={dot} />
        </Pressable>
        <Text style={[styles.bdTileFigure, { color: c.textPrimary }]} numberOfLines={1}>
          {open}
          <Text style={[styles.bdTileFigureUnit, { color: c.textTertiary }]}> to do</Text>
        </Text>
        {/* The unfold, now that the head around it opens the board. Its own
            key rather than the whole card's: the chevron is already the mark
            that means "there is more under this", so it is the one part of the
            head that should keep doing it. Nested inside the head Pressable —
            the inner one takes the touch. */}
        <Pressable
          onPressIn={() => tapHaptic()}
          onPress={onToggle}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityState={{ expanded: !!expanded }}
          accessibilityLabel={expanded
            ? `Hide ${boardLabel(row.name)}'s tasks`
            : `Show ${boardLabel(row.name)}'s tasks`}
          testID={`overview-board-peek-${row.name}`}
          style={({ pressed }) => [styles.bdVerb, pressed && styles.bdVerbOn]}
        >
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={c.textTertiary} />
        </Pressable>
      </Pressable>

      <Collapsible open={!!expanded}>
        <View style={styles.bdBody} testID={`overview-board-body-${row.name}`}>
          {/* The add box, at the TOP of this board's string — where the line it
              is about to make will appear. A field at the bottom would have the
              new row arrive somewhere you are not looking. */}
          {adding && (
            <View style={styles.bdAddRow}>
              <View style={[styles.bdOpenBead, { backgroundColor: dot }]} />
              <AppTextInput
                style={[styles.bdAddInput, { color: c.textPrimary }]}
                placeholder={`Add to ${boardLabel(row.name)}…`}
                placeholderTextColor={c.textMuted || c.textTertiary}
                value={addQuery}
                onChangeText={onAddQueryChange}
                autoFocus
                autoCapitalize="sentences"
                returnKeyType="done"
                blurOnSubmit={false}
                onSubmitEditing={() => onSubmitAdd?.(row.name)}
                accessibilityLabel={`Add a task to ${boardLabel(row.name)}`}
                testID={`overview-board-add-input-${row.name}`}
              />
              <Pressable
                onPressIn={() => tapHaptic()}
                onPress={() => (q ? onSubmitAdd?.(row.name) : onCancelAdd?.())}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={q ? 'Create this task' : 'Close'}
                testID={`overview-board-add-go-${row.name}`}
                style={({ pressed }) => [styles.bdVerb, pressed && styles.bdVerbOn]}
              >
                <Icon name={q ? 'arrow-down' : 'close'} size={16} color={c.textSecondary} />
              </Pressable>
            </View>
          )}

          {shown.length === 0 ? (
            <Text style={[styles.bdOpenTaskEmpty, { color: c.textTertiary }]}>
              {adding && q ? 'Nothing here matches that — the key makes it.' : 'Nothing open here.'}
            </Text>
          ) : shown.map((t) => {
            const overdue = !!t.dueDate && t.dueDate < todayStr;
            return (
                <Pressable
                  key={t.id}
                  onPressIn={() => tapHaptic()}
                  onPress={() => onOpenTask?.(t)}
                  accessibilityRole="button"
                  accessibilityLabel={t.title}
                  testID={`overview-board-task-${t.id}`}
                  style={({ pressed }) => [styles.bdOpenTask, pressed && styles.pressed]}
                >
                  <View style={[styles.bdOpenBead, { backgroundColor: overdue ? '#F87171' : dot }]} />
                  <Text style={[styles.bdOpenTaskText, { color: c.textPrimary }]} numberOfLines={1}>{t.title}</Text>
                </Pressable>
            );
          })}
            <Pressable
              onPressIn={() => tapHaptic()}
              onPress={onOpen}
              accessibilityRole="button"
              accessibilityLabel={`Open ${boardLabel(row.name)}`}
              testID={`overview-board-open-${row.name}`}
              style={({ pressed }) => [styles.bdOpenMore, pressed && styles.pressed]}
            >
              <Text style={[styles.bdOpenMoreText, { color: c.textSecondary }]}>Open board</Text>
              <Icon name="chevron-right" size={15} color={c.textTertiary} />
            </Pressable>
        </View>
      </Collapsible>
    </View>
  );
}

/**
 * One task in a board's list — an INSET CARD, like every other task surface in
 * the app (docs/STYLE-RULES.md §1).
 *
 * It used to be a bare row drawn straight on the page while taking its colours
 * from the inset-card palette — i.e. WHITE text on the WHITE light-mode page.
 * The only parts you could see were the red overdue icon and the red date; the
 * titles were there the whole time, in white, on white. Giving each task the
 * charcoal panel the palette was written for fixes both modes at once: the
 * panel is dark on the light page and a step above black on the dark one, so
 * the white title reads either way.
 *
 * Tapping opens the task — the list is the obvious place to reach for one, and
 * until now it was the one task list in the app that did nothing when pressed.
 */
function TaskRow({ t, done, todayStr, theme, onPress, board }) {
  const c = theme.colors;
  const overdue = !done && t.dueDate && t.dueDate < todayStr;
  const when = t.dueDate
    ? (t.dueDate === todayStr ? 'Today' : t.dueDate.slice(5)) + (t.time ? ` · ${t.time}` : '')
    : '—';
  // The tick stays a CIRCLE, open or filled — it is the same mark the planner
  // rows, the day sheet and the Notes to-dos use, and the one part of a task
  // row you read without reading.
  const mark = done ? 'check-circle' : overdue ? 'alert-circle-outline' : 'circle-outline';
  const markColor = done ? c.textTertiary : overdue ? '#F87171' : c.textTertiary;
  return (
    <Pressable
      onPressIn={() => tapHaptic()}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={`${t.title || 'Untitled'}${board ? `, ${board}` : ''}${done ? ', done' : ''}${overdue ? ', late' : ''}, ${when}`}
      testID={`overview-task-${t.id}`}
      style={({ pressed }) => [styles.taskRow, pressed && styles.pressed]}
    >
      <Icon name={mark} size={18} color={markColor} testID={`overview-task-mark-${t.id}`} />
      {board ? (
        // All-boards list: the board is the one thing the title cannot tell
        // you, so it rides as a quiet second line of provenance.
        <View style={styles.taskStack}>
          <Text
            style={[styles.taskTitle, { color: done ? c.textTertiary : c.textPrimary }, done && styles.taskDone]}
            numberOfLines={1}
          >
            {t.title || 'Untitled'}
          </Text>
          <Text style={[styles.taskBoard, { color: c.textTertiary }]} numberOfLines={1}>{board}</Text>
        </View>
      ) : (
        <Text
          style={[styles.taskTitle, { color: done ? c.textTertiary : c.textPrimary }, done && styles.taskDone]}
          numberOfLines={1}
        >
          {t.title || 'Untitled'}
        </Text>
      )}
      <Text style={[styles.taskMeta, { color: overdue ? '#F87171' : c.textTertiary }]} numberOfLines={1}>
        {when}
      </Text>
    </Pressable>
  );
}

/**
 * A list of tasks as ROWS ON ONE SURFACE, cut apart by the app's one
 * separator — the same groove the Notes timeline uses (`insetRule`: a shadow
 * hairline with a highlight a point under it, which reads as a score in the
 * page rather than as a line drawn on it).
 *
 * They were a stack of inset CARDS, each row its own charcoal panel with its
 * own border and corner. On a page that already carries four stat tiles and a
 * card per tag, every row then read as another OBJECT — ten objects in a
 * column — when a list of ten things is one surface with nine cuts in it. The
 * tiles above are still cards, because they are still objects; these are
 * lines.
 *
 * THE RULE IS A SIBLING BETWEEN ROWS, never a border on the row. `insetRule`
 * is two hairlines a point apart and IS the element, so on the row it would
 * draw across the top of the first one and under the last as well — the same
 * reason the Notes list passes it as `ItemSeparatorComponent`.
 */
function TaskList({ tasks, isDone, todayStr, theme, onOpenTask, showBoard }) {
  return tasks.map((t, i) => (
    <React.Fragment key={t.id}>
      {i > 0 && <View style={insetRule(theme)} testID="task-rule" />}
      <TaskRow
        t={t}
        done={isDone(t)}
        todayStr={todayStr}
        theme={theme}
        board={showBoard ? boardLabel(t.project || NO_BOARD) : undefined}
        onPress={onOpenTask ? () => onOpenTask(t) : null}
      />
    </React.Fragment>
  ));
}

/**
 * Search this board, or add to it — one field, the way the day panel's finder
 * works. Typing filters the two lists below; when nothing on the board carries
 * that exact title, a create row appears under the field and makes the task
 * ON THIS BOARD, which is the whole reason to add it from here.
 *
 * The placeholder is our own <Text>, not the TextInput's `placeholder` prop —
 * see components/AppTextInput, which owns that rule for every field in the app.
 */
function BoardFinder({ query, onChangeQuery, onCreate, boardName, pal, neu, grain, canCreate }) {
  return (
    <View style={[styles.finder, neu]}>
      <Grain level={grain} fine radius={14} />
      <View style={styles.finderField}>
        <Icon name="magnify" size={18} color={pal.muted} />
        <AppTextInput
          style={[styles.finderInput, { color: pal.text }]}
          value={query}
          onChangeText={onChangeQuery}
          placeholder="Search or add a task…"
          placeholderTextColor={pal.muted}
          placeholderTestID="overview-finder-placeholder"
          accessibilityLabel={`Search or add a task in ${boardLabel(boardName)}`}
          testID="overview-board-finder"
          autoCorrect={false}
          autoCapitalize="sentences"
          returnKeyType="done"
          onSubmitEditing={canCreate ? onCreate : undefined}
        />
        {query ? (
          <Pressable
            onPress={() => onChangeQuery('')}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            testID="overview-finder-clear"
          >
            <Icon name="close-circle" size={18} color={pal.muted} />
          </Pressable>
        ) : null}
      </View>
      {canCreate && (
        <Pressable
          onPressIn={() => tapHaptic()}
          onPress={onCreate}
          accessibilityRole="button"
          accessibilityLabel={`Create task ${query.trim()} in ${boardLabel(boardName)}`}
          testID="overview-finder-create"
          style={({ pressed }) => [styles.finderCreate, { borderTopColor: pal.border }, pressed && styles.pressed]}
        >
          <Icon name="plus-circle-outline" size={18} color={pal.text} />
          <Text style={[styles.finderCreateText, { color: pal.text }]} numberOfLines={2}>
            Create “{query.trim()}” in {boardLabel(boardName)}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

/**
 * The list behind a tile — every task in that bucket, across every board, with
 * the board it belongs to under each title (the one thing an all-boards list
 * has to say that a board's own list does not).
 */
const SCOPES = {
  todo: { title: 'To do', empty: 'Nothing to do.' },
  done: { title: 'Done', empty: 'Nothing finished yet.' },
  late: { title: 'Late', empty: 'Nothing late. ' },
  today: { title: 'Today', empty: 'Nothing due today.' },
};

export function scopeTasks(tasks, scope, todayStr) {
  const items = (tasks || []).filter((t) => t && itemTypeOf(t) === 'task');
  const isDone = (t) => !!(t.completed || isTaskDoneNow(t, todayStr));
  if (scope === 'done') {
    return items.filter(isDone).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  }
  const byDue = (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
  if (scope === 'late') return items.filter((t) => !isDone(t) && t.dueDate && t.dueDate < todayStr).sort(byDue);
  if (scope === 'today') return items.filter((t) => t.dueDate === todayStr).sort(byDue);
  return items.filter((t) => !isDone(t)).sort(byDue);   // 'todo'
}

function ScopePage({ scope, tasks, todayStr, pal, grain, theme, onBack, onOpenTask }) {
  const c = theme.colors;
  const copy = SCOPES[scope] || SCOPES.todo;
  const rows = useMemo(() => scopeTasks(tasks, scope, todayStr), [tasks, scope, todayStr]);
  return (
    <View style={[styles.page, { backgroundColor: pal.card }]}>
      <Grain level={grain} />
      <PageHeader title={`${copy.title} · ${rows.length}`} onBack={onBack} theme={theme} />
      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator
        {...SCROLL_INDICATOR}
        indicatorStyle={theme.mode === 'dark' ? 'white' : 'black'}
      >
        {rows.length === 0
          ? <Text style={[styles.empty, { color: c.textTertiary }]}>{copy.empty}</Text>
          : (
            <TaskList
              tasks={rows}
              isDone={(t) => scope === 'done' || !!(t.completed || isTaskDoneNow(t, todayStr))}
              todayStr={todayStr}
              theme={theme}
              onOpenTask={onOpenTask}
              showBoard
            />
          )}
      </ScrollView>
    </View>
  );
}

/**
 * The pushed page's bar.
 *
 * `onRename` makes the TITLE the control: tap it and it becomes a field. A
 * page that is about one thing should let you rename that thing where its name
 * already is, rather than somewhere else that also lists twenty-five others.
 * Return saves, blur cancels — the same contract the board manager's rows use,
 * so a half-typed name never commits itself on the way out.
 */
function PageHeader({ title, onBack, right, theme, onRename }) {
  const c = theme.colors;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  // A commit is followed by a blur, and blur CANCELS — so the field has to
  // remember that it already saved or the save undoes itself.
  const committingRef = useRef(false);
  useEffect(() => { setDraft(title); }, [title]);

  const commit = useCallback(() => {
    committingRef.current = true;
    const next = draft.trim();
    setEditing(false);
    // Empty or unchanged is not a rename — it is a way out of the field, and
    // writing it would touch every task on the board for nothing.
    if (!next || next === title) return;
    onRename?.(next);
  }, [draft, title, onRename]);

  return (
    <>
      <View style={styles.topBar}>
        <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back" style={({ pressed }) => [styles.backKey, pressed && styles.pressed]}>
          <Icon name="chevron-left" size={28} color={c.textPrimary} />
        </Pressable>
        {editing ? (
          <AppTextInput
            style={[styles.topTitle, styles.topTitleField, { color: c.textPrimary, borderColor: c.borderStrong }]}
            value={draft}
            onChangeText={setDraft}
            autoFocus
            selectTextOnFocus
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={commit}
            onBlur={() => { if (!committingRef.current) setEditing(false); }}
            accessibilityLabel="Board name"
            testID="page-title-field"
          />
        ) : onRename ? (
          <Pressable
            onPressIn={() => tapHaptic()}
            onPress={() => { committingRef.current = false; setDraft(title); setEditing(true); }}
            accessibilityRole="button"
            accessibilityLabel={`${title}. Tap to rename.`}
            testID="page-title-key"
            style={({ pressed }) => [styles.topTitleKey, pressed && styles.pressed]}
          >
            <Text style={[styles.topTitleText, { color: c.textPrimary }]} numberOfLines={1}>{title}</Text>
            <Icon name="pencil-outline" size={13} color={c.textTertiary} />
          </Pressable>
        ) : (
          <Text style={[styles.topTitle, { color: c.textPrimary }]} numberOfLines={1}>{title}</Text>
        )}
        <View style={styles.topRight}>{right}</View>
      </View>
      {/* The rule is a SIBLING, never spread onto the bar: `insetRule` is two
          borders a point apart and needs an element of its own — on the bar it
          would draw across its top edge too. */}
      <View style={insetRule(theme)} />
    </>
  );
}

/**
 * The board's tags, as the filter they always were.
 *
 * Same rows as the block that used to sit in the board's body — name, done /
 * total, a hairline track — only now a tap on one narrows the list behind this
 * page instead of simply being read. "All tags" leads, because getting back
 * out of a filter has to be at least as easy as getting into one.
 */
function BoardTagsPage({ rows, selected, pal, neu, grain, theme, onBack, onPick }) {
  const total = rows.reduce((n, r) => n + r.total, 0);
  const totalDone = rows.reduce((n, r) => n + r.done, 0);
  return (
    <View style={[styles.page, { backgroundColor: pal.card }]}>
      <Grain level={grain} />
      <PageHeader title={`Tags · ${rows.length}`} onBack={onBack} theme={theme} />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator {...SCROLL_INDICATOR} indicatorStyle={theme.mode === 'dark' ? 'white' : 'black'}>
        <TagPick
          label="All tags"
          done={totalDone}
          total={total}
          active={!selected}
          pal={pal}
          neu={neu}
          grain={grain}
          onPress={() => onPick(null)}
          testID="board-tag-pick-all"
        />
        {rows.map((r) => (
          <TagPick
            key={r.tag}
            label={r.tag}
            done={r.done}
            total={r.total}
            active={selected === r.tag}
            pal={pal}
            neu={neu}
            grain={grain}
            // A second tap on the lit one clears it — the same gesture in and
            // out, so you never have to find "All tags" to undo a mis-tap.
            onPress={() => onPick(selected === r.tag ? null : r.tag)}
            testID={`board-tag-pick-${r.tag}`}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function TagPick({ label, done, total, active, pal, neu, grain, onPress, testID }) {
  return (
    <Pressable
      onPressIn={() => tapHaptic()}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      accessibilityLabel={`${label}, ${done} of ${total} done`}
      testID={testID}
      style={({ pressed }) => [
        styles.tagRow,
        neu,
        // SELECTED is a rim, and only when selected. On a neumorphic surface
        // the unlit state has no edge at all — the light is what draws it —
        // so the border can go back to meaning one thing: this is the one.
        active && { borderWidth: 1, borderColor: pal.text },
        pressed && styles.pressed,
      ]}
    >
      <Grain level={grain} fine radius={14} />
      <View style={styles.rowTop}>
        <Text style={[styles.rowName, { color: pal.text }]} numberOfLines={1}>{label}</Text>
        {active && <Icon name="check" size={16} color={pal.text} />}
        <Text style={[styles.rowFigure, { color: pal.text }]}>{done}<Text style={[styles.rowFigureTotal, { color: pal.sub }]}>/{total}</Text></Text>
      </View>
      <Track done={done} total={total} pal={pal} />
    </Pressable>
  );
}

function TagRows({ rows, pal, neu, grain }) {
  return rows.map((r) => (
    <View key={r.tag} style={[styles.tagRow, neu]}>
      <Grain level={grain} fine radius={14} />
      <View style={styles.rowTop}>
        <Text style={[styles.rowName, { color: pal.text }]} numberOfLines={1}>{r.tag}</Text>
        <Text style={[styles.rowFigure, { color: pal.text }]}>{r.done}<Text style={[styles.rowFigureTotal, { color: pal.sub }]}>/{r.total}</Text></Text>
      </View>
      <Track done={r.done} total={r.total} pal={pal} />
    </View>
  ));
}

function BoardDetail({
  row, tasks, todayStr, pal, neu, grain, theme, onBack, onShow, isShown, onOpenTask, onAddTask,
  // (next) => void and () => void. Absent on a board that cannot be either:
  // NO_BOARD is a display sentinel with no row to rename, and a board shared
  // BY someone else is theirs — the server refuses both, so the page must not
  // offer them.
  onRename, onDelete,
  // ── The board's tags, which are a FILTER and not a readout ───────────────
  // They were a block of cards in the body, between the figures and the list:
  // one card per tag, with a count and a progress track, scrolled past on the
  // way to the tasks every time. They answered a question nobody had arrived
  // with, and on a board with half a dozen tags they pushed the list itself
  // off the first screen. Behind the funnel key they are what they always
  // were — a way to narrow this list — and the body is the list again.
  tagCount = 0, tagFilter = null, onOpenTags,
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const pending = tasks.filter((t) => !(t.completed || isTaskDoneNow(t, todayStr))).sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  const done = tasks.filter((t) => t.completed || isTaskDoneNow(t, todayStr)).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  // The query filters what is LISTED; the counts in the headings follow it, so
  // "To do · 2" always describes the two rows under it.
  const matches = (t) => !q || (t.title || '').toLowerCase().includes(q);
  const pendingShown = pending.filter(matches);
  const doneShown = done.filter(matches);
  // Offer to create only when nothing on this board already carries that exact
  // title — a near-match is what the list below is for.
  const canCreate = !!onAddTask && q.length > 0
    && !tasks.some((t) => (t.title || '').trim().toLowerCase() === q);
  const createHere = () => {
    if (!canCreate) return;
    // NO_BOARD is a DISPLAY sentinel for "this task has no board" (see
    // overviewStats) — never a board name. Creating with it would give the
    // task a real board literally called "No Project".
    onAddTask(query.trim(), row.name === NO_BOARD ? '' : row.name);
    setQuery('');
  };
  const c = theme.colors;
  return (
    <View style={[styles.page, { backgroundColor: pal.card }]}>
      <Grain level={grain} />
      <PageHeader
        title={boardLabel(row.name)}
        onBack={onBack}
        theme={theme}
        onRename={onRename}
        right={(
          <View style={styles.topKeys}>
            {/* The funnel only appears on a board that HAS tags — a key that
                opens an empty list is a promise of something to pick. */}
            {tagCount > 0 && !!onOpenTags && (
              <Pressable
                onPressIn={() => tapHaptic()}
                onPress={onOpenTags}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={tagFilter ? `Tags, filtered to ${tagFilter}` : 'Filter by tag'}
                testID="board-tags-key"
                style={({ pressed }) => [
                  styles.iconKey,
                  { borderColor: c.borderStrong },
                  !!tagFilter && { backgroundColor: c.textPrimary, borderColor: c.textPrimary },
                  pressed && styles.pressed,
                ]}
              >
                <Icon name="filter-variant" size={18} color={tagFilter ? c.background : c.textTertiary} />
                {!!tagFilter && (
                  <View style={[styles.badge, { backgroundColor: c.background }]}>
                    <Text style={[styles.badgeText, { color: c.textPrimary }]}>1</Text>
                  </View>
                )}
              </Pressable>
            )}
            <Pressable
              onPressIn={() => tapHaptic()}
              onPress={onShow}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={isShown ? 'Showing on calendar' : `Show ${boardLabel(row.name)} on calendar`}
              testID="overview-show-board"
              style={({ pressed }) => [styles.pill, { borderColor: c.borderStrong }, isShown && { backgroundColor: c.textPrimary, borderColor: c.textPrimary }, pressed && styles.pressed]}
            >
              <Text style={[styles.pillText, { color: isShown ? c.background : c.textTertiary }]} numberOfLines={1}>{isShown ? 'Showing' : 'Show'}</Text>
            </Pressable>
          </View>
        )}
      />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator {...SCROLL_INDICATOR} indicatorStyle={theme.mode === 'dark' ? 'white' : 'black'}>
        <View style={styles.tiles}>
          <Tile icon="checkbox-blank-circle-outline" label="To do" value={row.total - row.done} caption={`of ${row.total}`} pal={pal} neu={neu} grain={grain} testID="board-tile-todo" />
          <Tile icon="check" label="Done" value={row.done} caption={`${pct(row.done, row.total)}% complete`} pal={pal} neu={neu} grain={grain} testID="board-tile-done" />
          <Tile icon="alert-circle-outline" label="Late" value={row.overdue} caption={row.overdue ? 'past due' : 'nothing late'} pal={pal} neu={neu} grain={grain} accent={row.overdue ? '#F87171' : null} testID="board-tile-late" />
          <Tile icon="calendar-today" label="Today" value={row.today} caption={row.today ? `${row.todayDone} done` : 'nothing due'} pal={pal} neu={neu} grain={grain} testID="board-tile-today" />
        </View>
        {/* A filter you cannot see is a list that is quietly lying about how
            much is on this board, so the scope says itself — and the line IS
            the way out of it. */}
        {!!tagFilter && (
          <Pressable
            onPressIn={() => tapHaptic()}
            onPress={onOpenTags}
            accessibilityRole="button"
            accessibilityLabel={`Filtered to ${tagFilter}. Change or clear it.`}
            testID="board-tag-scope"
            style={({ pressed }) => [styles.scopeLine, { borderColor: c.borderStrong }, pressed && styles.pressed]}
          >
            <Icon name="tag-outline" size={14} color={c.textTertiary} />
            <Text style={[styles.scopeText, { color: c.textSecondary || c.textTertiary }]} numberOfLines={1}>
              {tagFilter}
            </Text>
            <Icon name="close-circle" size={15} color={c.textTertiary} />
          </Pressable>
        )}

        <BoardFinder
          query={query}
          onChangeQuery={setQuery}
          onCreate={createHere}
          canCreate={canCreate}
          boardName={row.name}
          pal={pal}
          neu={neu}
          grain={grain}
        />

        <Text style={[styles.section, { color: c.textTertiary }]}>To do · {pendingShown.length}</Text>
        {pendingShown.length === 0
          ? <Text style={[styles.empty, { color: c.textTertiary }]}>{q ? 'Nothing to do matches.' : 'All clear.'}</Text>
          : (
            <TaskList
              tasks={pendingShown}
              isDone={() => false}
              todayStr={todayStr}
              theme={theme}
              onOpenTask={onOpenTask}
            />
          )}
        <Text style={[styles.section, { color: c.textTertiary }]}>Done · {doneShown.length}</Text>
        {doneShown.length === 0
          ? <Text style={[styles.empty, { color: c.textTertiary }]}>{q ? 'Nothing done matches.' : 'None yet.'}</Text>
          : (
            <TaskList
              tasks={doneShown}
              isDone={() => true}
              todayStr={todayStr}
              theme={theme}
              onOpenTask={onOpenTask}
            />
          )}

        {/* Deleting the board belongs on the board's page, at the end of it —
            the pencil that used to be the only way here opens this page now,
            so without it the one door to deleting a board would have closed.
            Last and quiet, because it is the one thing on the page you cannot
            undo. */}
        {!!onDelete && (
          <Pressable
            onPressIn={() => tapHaptic()}
            onPress={onDelete}
            accessibilityRole="button"
            accessibilityLabel={`Delete the board ${boardLabel(row.name)}`}
            testID="board-delete"
            style={({ pressed }) => [styles.deleteRow, { borderColor: c.border }, pressed && styles.pressed]}
          >
            <Icon name="trash-can-outline" size={16} color="#F87171" />
            <Text style={styles.deleteText}>Delete board</Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

function OverviewPage({
  visible, onClose, tasks, boards, colorOf, sharedIn, selectedProject, calendarDate,
  onSelectBoard, onOpenFilters,
  // (name) => void — the ALL-boards manager (add one, see them all), on a long
  // press of a tile. The tap and the pencil open the board's own page instead:
  // "edit this board" is a question about one board, and it used to be
  // answered with a list of every board there is.
  onEditBoard,
  // (from, to) => void — the board page's header renames by being tapped.
  onRenameBoard,
  // (name) => void — from the end of the board's page. Confirmation is the
  // caller's: it is the one that knows what deleting takes with it.
  onDeleteBoard,
  filterCount = 0, bottomInset = 0, theme,
  // Settings → Appearance → Surface grain, as a multiplier. A PROP, not a
  // useTheme() read: components/Grain must not import ThemeContext (it pulls
  // AsyncStorage into every test that mounts it), so the screen threads it.
  grain = 1,
  // (task) => void — a tap on a task in a board's list opens it for editing.
  onOpenTask,
  // (title, boardName) => void — the finder's create row, which is the point
  // of it: a task added from here is born on the board you are looking at.
  onAddTask,
  // EMBEDDED: this is a tab in the Tasks pager rather than a page pushed over
  // it. No sliding shell, no header of its own — the pager's segmented control
  // IS the header, and the keys that would sit here (search, filters) live on
  // the page around it. Everything BELOW the top level is unchanged: a board,
  // a tile's list and the stats sheet are still pushed pages with a back
  // swipe, they simply push within the tab instead of over the whole screen.
  embedded = false,
  // Rendered at the TOP OF THIS PAGE'S SCROLLER, not above it. The Inbox tab's
  // capture field and its list live here: as siblings ABOVE this component they
  // were outside the only scroll view on the page, so they took their height
  // off it — and once the list had a few lines in it there was no scrollable
  // area left at all. A fixed header that grows is a page that stops scrolling.
  header = null,
  // Filters the board rows. The page's own search, passed in rather than owned
  // here because the field lives outside this component when embedded.
  query = '',
  // (open) => void — fires whenever a drill-down opens or closes, so the pager
  // hosting this can stop paging under it. A left-edge back-swipe and a
  // page-swipe are otherwise the same gesture.
  onDrillChange,
}) {
  const insets = useSafeAreaInsets();
  // The safe area is this page's to pay only when it owns the whole screen.
  // Embedded, the screen's header has already cleared the notch and the pager
  // starts below it — paying it again is a band of dead page under a header
  // that is already clear. Applies to the drill-downs too: they fill the tab,
  // not the screen.
  const pageTopInset = embedded ? 0 : insets.top;
  // NEUMORPHIC, like the Focus tab (STYLE-RULES §9): the panels on this page
  // are the page's own colour, raised out of it by light rather than by a fill
  // change. `insetCardPalette` is the other claim — a charcoal recess on a
  // page it stands off — and the two cannot share a surface.
  const pal = useMemo(() => focusSkin(theme), [theme]);
  const neu = useMemo(() => neuRaised(pal.panel, theme?.mode), [pal.panel, theme?.mode]);
  const c = theme.colors;
  const todayStr = localTodayStr();
  const { all, rows: allRows, tagRows } = useMemo(() => overviewStats(tasks, boards, todayStr), [tasks, boards, todayStr]);
  // The search narrows the BOARD list only — the tiles above it are the whole
  // picture and stay whole, which is what makes it obvious you are filtering a
  // list rather than looking at a smaller pond.
  const rows = useMemo(() => {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return allRows;
    return allRows.filter((r) => boardLabel(r.name).toLowerCase().includes(q));
  }, [allRows, query]);
  const [board, setBoard] = useState(null);
  // The open board's tag filter, and the page that sets it. Scoped to the
  // board: leaving one and opening another must not carry a tag across that
  // the next board may not even have.
  const [tagFilter, setTagFilter] = useState(null);
  const [tagsOpen, setTagsOpen] = useState(false);
  const openBoardPage = useCallback((name) => {
    setTagFilter(null);
    setBoard(name);
  }, []);
  const closeBoardPage = useCallback(() => {
    setTagsOpen(false);
    setTagFilter(null);
    setBoard(null);
  }, []);
  // Which drill-down is up: a tile's list, or the stats page. Both are nested
  // overlays, so the back-swipe stack reads overview → here → back.
  const [scope, setScope] = useState(null);
  // The four figures, behind their one key. See the note at the key itself.
  const [overviewOpen, setOverviewOpen] = useState(false);
  /**
   * Which board tiles are unfolded, by name.
   *
   * A SET, not a name: one-at-a-time made the grid close a board you were
   * reading to show you another, so comparing two boards meant opening each in
   * turn and remembering the first. Twenty-six of them open at once is your
   * business, not the page's — that is what the chevrons are for.
   */
  const [openBoards, setOpenBoards] = useState(() => new Set());
  const toggleBoard = useCallback((name) => setOpenBoards((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  }), []);

  // Which board's add box is open, and what is in it. One at a time here, and
  // deliberately: two focused text fields is one keyboard fighting over two
  // places to put what you type.
  const [addingBoard, setAddingBoard] = useState(null);
  const [addQuery, setAddQuery] = useState('');

  const startAdd = useCallback((name) => {
    setAddQuery('');
    setAddingBoard(name);
    // Opening the box on a shut board would put the field somewhere you cannot
    // see it, so asking to add is also asking to open.
    setOpenBoards((prev) => (prev.has(name) ? prev : new Set(prev).add(name)));
  }, []);
  const cancelAdd = useCallback(() => { setAddingBoard(null); setAddQuery(''); }, []);
  const [statsOpen, setStatsOpen] = useState(false);
  useEffect(() => { if (!visible) { closeBoardPage(); setScope(null); setStatsOpen(false); } }, [visible, closeBoardPage]);
  // Report the drill state up. One effect rather than a call at each open /
  // close site: those are five places and counting, and one of them will be
  // missed — leaving the pager locked with nothing on top of it.
  const drilled = !!board || !!scope || statsOpen || tagsOpen;
  useEffect(() => { onDrillChange?.(drilled); }, [drilled, onDrillChange]);
  useEffect(() => () => onDrillChange?.(false), [onDrillChange]);
  // A board found by search, then dropped from the rows by a keystroke, must
  // not strand its detail page on a row that no longer exists.
  const detailRow = board ? (allRows.find((r) => r.name === board) || null) : null;
  // Can this board be renamed or deleted at all? NO_BOARD is a display
  // sentinel — there is no row behind "No Project" to rename — and a board
  // shared BY someone else belongs to them; the server refuses either write,
  // so the page must not offer a key that cannot work.
  const detailEditable = !!detailRow && detailRow.name !== NO_BOARD && !sharedIn?.[detailRow.name];
  // Everything on the board, before the tag filter. The tag ROWS are counted
  // off this — a tag list that narrowed with the filter would collapse to the
  // one tag you picked and leave no way back to the others.
  const detailTasksAll = useMemo(() => (board ? (tasks || []).filter((t) => t && itemTypeOf(t) === 'task' && (t.project || NO_BOARD) === board) : []), [tasks, board]);
  const detailTagRows = useMemo(() => {
    const map = new Map();
    for (const t of detailTasksAll) {
      for (const tag of (t.tags || [])) {
        const e = map.get(tag) || { total: 0, done: 0 };
        e.total += 1;
        if (t.completed) e.done += 1;
        map.set(tag, e);
      }
    }
    return Array.from(map.entries()).map(([tag, s]) => ({ tag, ...s })).sort((a, b) => b.total - a.total);
  }, [detailTasksAll]);
  const detailTasks = useMemo(
    () => (tagFilter ? detailTasksAll.filter((t) => (t.tags || []).includes(tagFilter)) : detailTasksAll),
    [detailTasksAll, tagFilter],
  );
  const dayLabel = (calendarDate instanceof Date ? calendarDate : new Date()).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  // Embedded, the shell is nothing: a plain flex box in whatever slot the
  // pager gave us. The nested drill-downs still need a parent to fill, which
  // is why this is a fragment-with-a-box rather than a fragment.
  /**
   * The open tiles' tasks, board by board — open work only, a handful each.
   *
   * ONE PASS over the task list for however many boards are unfolded, rather
   * than a pass per board: with twenty-six boards and several open, the
   * per-board version is the same list walked again and again for answers that
   * could all have come out of one walk.
   *
   * Capped per board because a tile is a preview: its own page is one tap
   * further and holds the lot. An unfolded tile running to forty rows would
   * push every other board off the screen, which is the list undoing itself.
   */
  const openBoardTasks = useMemo(() => {
    const map = new Map();
    if (openBoards.size === 0) return map;
    for (const name of openBoards) map.set(name, []);
    for (const t of tasks || []) {
      if (!t || t.completed || isTaskDoneNow(t, todayStr)) continue;
      const key = t.project || NO_BOARD;
      const bucket = map.get(key);
      if (!bucket || bucket.length >= 6) continue;
      bucket.push(t);
    }
    return map;
  }, [openBoards, tasks, todayStr]);

  /**
   * ONE key where four squares were, and it is handed to the HEADER so it can
   * sit on the heading's own line, top right — above the field rather than
   * between the field and the list it is building. The squares answered
   * questions you only have once you already use the app; they are all still
   * here, a tap away, and the figure that changes the shape of a day (what is
   * LATE) rides on the key so nothing urgent hides behind it.
   */
  const overviewKey = (
    <Pressable
      onPressIn={() => tapHaptic()}
      onPress={() => setOverviewOpen(true)}
      accessibilityRole="button"
      accessibilityLabel={`Overview: ${all.total - all.done} to do, ${all.overdue} late`}
      testID="overview-key"
      style={({ pressed }) => [styles.overviewKey, { borderColor: c.border }, pressed && styles.pressed]}
    >
      <Icon name="chart-box-outline" size={16} color={c.textSecondary} />
      <Text style={[styles.overviewKeyText, { color: c.textPrimary }]} numberOfLines={1}>Overview</Text>
      {all.overdue > 0 && (
        <View style={styles.overviewKeyDot} testID="overview-key-late" />
      )}
    </Pressable>
  );

  const Shell = embedded ? EmbeddedShell : EdgeSwipePage;
  const shellProps = embedded
    ? {}
    : { visible, onClose, overlay: true, swipeEnabled: !board };

  return (
    <Shell {...shellProps}>
      <View
        style={[
          styles.page,
          // The tab's ground IS the panels' colour — the whole of neumorphism
          // is that figure and ground share one, so there is no page colour
          // left to use here (STYLE-RULES §9).
          { backgroundColor: pal.card },
          // Embedded, the safe area is the screen's business and has already
          // been paid for by the header above us — paying it twice is a band
          // of dead page under a header that is already clear of the notch.
          { paddingTop: pageTopInset },
        ]}
      >
        {!embedded && (
        <PageHeader
          title="Overview"
          onBack={onClose}
          theme={theme}
          right={(
            <View style={styles.topKeys}>
              <Pressable
                onPressIn={() => tapHaptic()}
                onPress={() => setStatsOpen(true)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Stats"
                testID="overview-stats-key"
                style={({ pressed }) => [styles.iconKey, { borderColor: c.borderStrong }, pressed && styles.pressed]}
              >
                <Icon name="chart-box-outline" size={18} color={c.textTertiary} />
              </Pressable>
              <Pressable
                onPressIn={() => tapHaptic()}
                onPress={onOpenFilters}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={filterCount ? `Filters, ${filterCount} active` : 'Filters'}
                testID="overview-filters"
                style={({ pressed }) => [styles.iconKey, { borderColor: c.borderStrong }, filterCount > 0 && { backgroundColor: c.textPrimary, borderColor: c.textPrimary }, pressed && styles.pressed]}
              >
                <Icon name="filter-variant" size={18} color={filterCount > 0 ? c.background : c.textTertiary} />
                {filterCount > 0 && (
                  <View style={[styles.badge, { backgroundColor: c.background }]}>
                    <Text style={[styles.badgeText, { color: c.textPrimary }]}>{filterCount}</Text>
                  </View>
                )}
              </Pressable>
            </View>
          )}
        />
        )}
        <ScrollView
          contentContainerStyle={[styles.body, { paddingBottom: 32 + Math.max(insets.bottom, bottomInset) }]}
          showsVerticalScrollIndicator
          {...SCROLL_INDICATOR}
          indicatorStyle={theme.mode === 'dark' ? 'white' : 'black'}
          // The capture field sits in here, so a drag that starts on it has to
          // put the keyboard away rather than fight the scroll.
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          testID="overview-scroll"
        >
          {typeof header === 'function' ? header({ overviewKey }) : header}
          {/* A caller that takes the key places it (the Inbox tab puts it on
              the heading's line). One that does not still needs it, or the four
              figures would have no way in at all. */}
          {typeof header !== 'function' && (
            <View style={styles.overviewKeyRow}>{overviewKey}</View>
          )}

          <Text style={[styles.section, { color: c.textTertiary }]}>Boards · {rows.length}</Text>
          {rows.length === 0 && <Text style={[styles.empty, { color: c.textTertiary }]}>No boards yet.</Text>}
          <View style={styles.grid}>
            {rows.map((row) => (
              <BoardTile
                key={row.name}
                row={row}
                dot={row.name === NO_BOARD ? c.textTertiary : colorOf(row.name)}
                surface={pal.card}
                sharedBy={sharedIn?.[row.name]}
                selected={selectedProject === row.name}
                expanded={openBoards.has(row.name)}
                // Only ever built for the tiles that are OPEN — see the memo.
                tasks={openBoardTasks.get(row.name) || EMPTY_TASKS}
                todayStr={todayStr}
                c={c}
                adding={addingBoard === row.name}
                addQuery={addingBoard === row.name ? addQuery : ''}
                onAddQueryChange={setAddQuery}
                onStartAdd={startAdd}
                onCancelAdd={cancelAdd}
                onSubmitAdd={(name) => {
                  const title = addQuery.trim();
                  if (!title) return;
                  // NO_BOARD is a DISPLAY sentinel — a task filed under it has
                  // no board at all, not one named for the sentinel.
                  onAddTask?.(title, name === NO_BOARD ? '' : name);
                  // Cleared and still focused: adding is rarely one thing.
                  setAddQuery('');
                }}
                onToggle={() => toggleBoard(row.name)}
                onManage={onEditBoard}
                onOpen={() => openBoardPage(row.name)}
                onOpenTask={onOpenTask}
              />
            ))}
          </View>

          {tagRows.length > 0 && (
            <>
              <Text style={[styles.section, { color: c.textTertiary }]}>Tags · {tagRows.length}</Text>
              <TagRows rows={tagRows} pal={pal} neu={neu} grain={grain} />
            </>
          )}
        </ScrollView>
      </View>

      {/* The four figures, as a page of their own. Nothing was dropped when they
          left the tab — they moved behind one key, which is the whole
          simplification: the page leads with what you DO and keeps what you
          READ one tap away. Each still drills into its own list. */}
      <EdgeSwipePage overlay visible={overviewOpen} onClose={() => setOverviewOpen(false)}>
        {overviewOpen && (
          <View style={{ flex: 1, paddingTop: pageTopInset, backgroundColor: pal.card }}>
            <Grain level={grain} />
            <PageHeader title="Overview" onBack={() => setOverviewOpen(false)} theme={theme} />
            <ScrollView {...SCROLL_INDICATOR} contentContainerStyle={[styles.body, { paddingBottom: 32 + Math.max(insets.bottom, bottomInset) }]}>
              <View style={styles.tiles}>
                <Tile icon="checkbox-blank-circle-outline" label="To do" value={all.total - all.done} caption={`of ${all.total} tasks`} pal={pal} neu={neu} grain={grain} testID="overview-tile-todo" onPress={() => setScope('todo')} />
                <Tile icon="check" label="Done" value={all.done} caption={`${pct(all.done, all.total)}% complete`} pal={pal} neu={neu} grain={grain} testID="overview-tile-done" onPress={() => setScope('done')} />
                <Tile icon="alert-circle-outline" label="Late" value={all.overdue} caption={all.overdue ? 'past due' : 'nothing late'} pal={pal} neu={neu} grain={grain} accent={all.overdue ? '#F87171' : null} testID="overview-tile-late" onPress={() => setScope('late')} />
                <Tile icon="calendar-today" label="Today" value={all.today} caption={all.today ? `${dayLabel} · ${all.todayDone} done` : dayLabel} pal={pal} neu={neu} grain={grain} testID="overview-tile-today" onPress={() => setScope('today')} />
              </View>
            </ScrollView>
          </View>
        )}
      </EdgeSwipePage>

      {/* A tile's list: every task in that bucket, across every board. */}
      <EdgeSwipePage overlay visible={!!scope} onClose={() => setScope(null)}>
        {!!scope && (
          <View style={{ flex: 1, paddingTop: pageTopInset, backgroundColor: pal.card }}>
            <ScopePage
              scope={scope}
              tasks={tasks}
              todayStr={todayStr}
              pal={pal}
              theme={theme}
              onBack={() => setScope(null)}
              onOpenTask={onOpenTask}
            />
          </View>
        )}
      </EdgeSwipePage>

      {/* Stats. Its own page rather than more tiles here: the charts want the
          width, and the overview's job is the boards. */}
      <EdgeSwipePage overlay visible={statsOpen} onClose={() => setStatsOpen(false)}>
        {statsOpen && (
          <StatsPanel
            tasks={tasks}
            todayStr={todayStr}
            pal={pal}
            theme={theme}
            onClose={() => setStatsOpen(false)}
            insetTop={pageTopInset}
            bottomInset={Math.max(insets.bottom, bottomInset)}
          />
        )}
      </EdgeSwipePage>

      {/* Board drill-down: a nested in-tree overlay so the back-swipe stack
          holds (overview → board → back). */}
      <EdgeSwipePage overlay visible={!!detailRow} onClose={closeBoardPage}>
        {detailRow && (
          <View style={{ flex: 1, paddingTop: pageTopInset, backgroundColor: pal.card }}>
            <BoardDetail
              row={detailRow}
              tasks={detailTasks}
              todayStr={todayStr}
              pal={pal}
              theme={theme}
              onBack={closeBoardPage}
              isShown={selectedProject === detailRow.name}
              onShow={() => onSelectBoard(detailRow.name)}
              onOpenTask={onOpenTask}
              onAddTask={onAddTask}
              tagCount={detailTagRows.length}
              tagFilter={tagFilter}
              onOpenTags={() => setTagsOpen(true)}
              onRename={detailEditable && onRenameBoard
                // The page is looking at `board` by NAME, so a rename has to
                // move it or the next render finds no row and the page empties
                // out underneath you.
                ? (next) => { setBoard(next); onRenameBoard(detailRow.name, next); }
                : undefined}
              onDelete={detailEditable && onDeleteBoard
                ? () => { closeBoardPage(); onDeleteBoard(detailRow.name); }
                : undefined}
            />
          </View>
        )}
      </EdgeSwipePage>

      {/* The open board's tag filter. Mounted LAST and OUTSIDE the board's own
          page, so it covers it rather than being clipped by it — the rule the
          album picker proved (STYLE-RULES §4) — and so the back-swipe stack
          reads boards → board → tags → back. */}
      <EdgeSwipePage overlay visible={tagsOpen && !!detailRow} onClose={() => setTagsOpen(false)}>
        {tagsOpen && !!detailRow && (
          <View style={{ flex: 1, paddingTop: pageTopInset, backgroundColor: pal.card }}>
            <BoardTagsPage
              rows={detailTagRows}
              neu={neu}
              grain={grain}
              selected={tagFilter}
              pal={pal}
              theme={theme}
              onBack={() => setTagsOpen(false)}
              // Picking is the whole errand, so it closes on the pick — the
              // board behind is already showing the answer.
              onPick={(tag) => { setTagFilter(tag); setTagsOpen(false); }}
            />
          </View>
        )}
      </EdgeSwipePage>
    </Shell>
  );
}

export default memo(OverviewPage);

const styles = StyleSheet.create({
  page: { flex: 1 },
  // The embedded root. `overflow: hidden` matters: the drill-downs slide in
  // from the right, and without it their off-screen resting position paints
  // across the page beside this one in the pager.
  embedded: { flex: 1, overflow: 'hidden' },
  // The app's one separator carries the bottom edge (STYLE-RULES §1), spread
  // at the call site so it takes the live theme.
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  backKey: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  topTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700' },
  // The tappable title keeps the bar's geometry exactly — flex 1, centred —
  // and only adds the pencil beside the words, so the page does not shift when
  // a header becomes renameable.
  topTitleKey: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  topTitleText: { flexShrink: 1, fontSize: 17, fontWeight: '700' },
  // Single-line field metrics from the one definition (utils/inputField); the
  // rule is a hairline under the words so the title reads as a field without
  // becoming a box in the middle of the bar.
  topTitleField: {
    ...INPUT_FIELD,
    height: 34,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  topRight: { minWidth: 36, alignItems: 'flex-end' },
  topKeys: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconKey: { width: 36, height: 32, borderRadius: 9, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -5, right: -5, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 9, fontWeight: '800' },
  pill: { height: 32, paddingHorizontal: 12, borderRadius: 9, borderWidth: 1, alignItems: 'center', justifyContent: 'center', maxWidth: 120 },
  pillText: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.9, textTransform: 'uppercase' },
  // The page's top gutter, the same number the Focus tab uses — the first
  // panel is held off the chrome by twice the gap between two (NEU_PAGE_TOP).
  body: { paddingHorizontal: 16, paddingTop: NEU_PAGE_TOP },
  // The "you are filtered" line, which is also the way out of it.
  scopeLine: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: 14, height: 34, paddingHorizontal: 12,
    borderRadius: 17, borderWidth: StyleSheet.hairlineWidth,
    alignSelf: 'flex-start', maxWidth: '100%',
  },
  scopeText: { flexShrink: 1, fontSize: 13, fontWeight: '700' },
  deleteRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 26, height: 44, borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  deleteText: { fontSize: 14, fontWeight: '700', color: '#F87171' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: NEU_GAP },
  tile: {
    width: '48%',
    flexGrow: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
  },
  tileTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  iconTile: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  label: { flexShrink: 1, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.9, textTransform: 'uppercase' },
  value: { fontSize: 30, fontWeight: '800', letterSpacing: -0.8, fontVariant: ['tabular-nums'] },
  caption: { fontSize: 11, fontWeight: '600', letterSpacing: 0.2, marginTop: 2 },
  // The page's section labels ("BOARDS · 26", "TAGS · 8"). A step up from 10.5,
  // with the tracking eased back as the size rises — wide tracking is what makes
  // small caps legible and what makes larger ones look stretched. Still uppercase
  // and still quiet: they label the page, they do not lead it. That is the
  // capture heading's job, and the gap between the two is what gives the page an
  // order to read in.
  section: { fontSize: 12, fontWeight: '700', letterSpacing: 0.7, textTransform: 'uppercase', marginTop: 22, marginBottom: 10 },
  empty: { fontSize: 13, paddingVertical: 8 },

  // A column of rows on a string. Relative, so the thread can be absolute
  // inside it; `gap` states the spacing once rather than a margin per tile.
  grid: { position: 'relative', gap: BOARD_GAP },
  // The rectangle itself. Full width from the page's own margin — the string
  // runs INSIDE it now, not to its left — and no padding of its own: every row
  // in it carries the same paddingLeft, which is what puts their beads and the
  // header's on one x.
  bdTile: {
    borderRadius: BD_TILE_RADIUS,
    // 2, not a hairline: the colour was a 3pt strip on one edge before, and at
    // a hairline all the way round it read as barely there. Thin enough to be
    // an outline, heavy enough to be the board's.
    borderWidth: BD_TILE_BORDER,
    paddingRight: 13,
    // NOT hidden: the thread deliberately paints past both borders, and the
    // beads sit in the padding gutter. Clipping here would cut the string at
    // every rectangle, which is the one thing this arrangement exists to stop.
    overflow: 'visible',
  },
  // Scoped: the same outline, drawn heavier. The board is identified once, by
  // its colour, and the SELECTION is only ever a weight — a second colour on
  // top would be two claims in one place.
  bdTileOn: { borderWidth: BD_TILE_BORDER_ON },
  // The liner: the rule's own white, traced just inside the coloured edge.
  bdTileLiner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: BD_TILE_RADIUS - BD_TILE_BORDER,
    borderWidth: RULE_W,
    borderColor: RULE_HIGHLIGHT,
  },
  // Follows the border it hugs, so the pair stay adjacent when one thickens.
  bdTileLinerOn: { borderRadius: BD_TILE_RADIUS - BD_TILE_BORDER_ON },
  // This tile's length of string. Half the grid's gap past each border, so
  // consecutive segments MEET in the gap without overlapping — two hairlines on
  // one line composite darker, and the join becomes a rung.
  bdThread: {
    position: 'absolute',
    left: THREAD_X,
    top: -(BOARD_GAP / 2) - 2,
    bottom: -(BOARD_GAP / 2) - 2,
    width: StyleSheet.hairlineWidth,
  },
  bdHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: ROW_PAD_LEFT,
    paddingVertical: 11,
  },
  bdNameRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  // A board verb: quiet at rest, full on press. They are on every board, so at
  // full strength a column of them would be the loudest thing on the page.
  bdVerb: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.35,
  },
  bdVerbOn: { opacity: 1 },
  // A square with a soft corner, not a circle: a circle reads as a floating
  // action and this is a key on a row. 32 is the visible box; the hitSlop takes
  // it past the 44 the rest of the app holds to.
  bdAddKey: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The body's clip, which is what a height animation needs to roll against.
  // Only ever vertical: the beads sit inside the row's own width.
  bdCollapse: { overflow: 'hidden' },
  // The measuring pass. Out of flow so it adds no height to the tile, full
  // width so the measurement is the real one, and invisible so the frame it
  // takes cannot be seen. See the note on Collapsible.
  bdMeasure: { position: 'absolute', left: 0, right: 0, opacity: 0 },
  bdAddRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: ROW_PAD_LEFT,
    paddingRight: 4,
    paddingVertical: 4,
  },
  bdAddInput: {
    ...INPUT_FIELD,
    flex: 1,
    fontSize: 14,
    height: 36,
  },
  // The board's own bead, on the string that now runs inside the rectangle.
  // Painted after the thread, and filled with the page colour, so the line
  // runs behind it rather than through it.
  bdBead: {
    position: 'absolute',
    left: THREAD_X - BEAD / 2,
    width: BEAD,
    height: BEAD,
    borderRadius: BEAD / 2,
    borderWidth: 2,
  },

  bdBody: { paddingBottom: 4 },
  // A revealed task: a line on the SAME string, inside the same rectangle.
  bdOpenTask: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingLeft: ROW_PAD_LEFT, paddingRight: 4, paddingVertical: 9,
  },
  bdOpenBead: {
    position: 'absolute',
    left: THREAD_X - BEAD_SMALL / 2,
    width: BEAD_SMALL,
    height: BEAD_SMALL,
    borderRadius: BEAD_SMALL / 2,
  },
  bdOpenTaskText: { flex: 1, fontSize: 14 },
  bdOpenTaskEmpty: { fontSize: 13, paddingLeft: ROW_PAD_LEFT, paddingVertical: 9 },
  bdOpenMore: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingLeft: ROW_PAD_LEFT, paddingVertical: 9, paddingBottom: 12,
  },
  bdOpenMoreText: { fontSize: 13, fontWeight: '700' },
  // One board per row, open or closed. Two-up meant a tile had to be tall and
  // stacked to fit anything; full width it is a line you read across.
  bdTileHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bdTileText: { flex: 1, gap: 2 },
  bdTileName: { fontSize: 16, fontWeight: '700' },
  // THIN. At 800 the count was competing with the board's own name for the
  // row, and on a page of twenty-six boards that reads as twenty-six numbers
  // with names attached rather than the other way round. Light and a size up:
  // a thin face needs the extra points to keep the same presence.
  bdTileFigure: { fontSize: 22, fontWeight: '200', letterSpacing: -0.3 },
  bdTileFigureUnit: { fontSize: 12, fontWeight: '400', letterSpacing: 0 },
  bdTileCaption: { fontSize: 12 },

  // The one key the four squares became, sized for the heading's line: a small
  // outline pill, not a full-width row. It opens something; it is not a
  // statistic in its own right, and next to a 22pt heading it must not read as
  // a second heading.
  overviewKey: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 32,
    paddingHorizontal: 11,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  overviewKeyText: { fontSize: 13, fontWeight: '700' },
  // Late is the one figure that cannot wait behind a tap. It does not fit
  // beside a heading as words, so it is a dot — present or absent, which is
  // the only thing you need from it at a glance.
  overviewKeyDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#F87171' },
  // The fallback slot, for a caller that did not take the key to place itself.
  overviewKeyRow: { flexDirection: 'row', marginBottom: 4 },
  row: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingTop: 11,
    paddingBottom: 14,
    marginBottom: 8,
    overflow: 'hidden',
  },
  tagRow: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingTop: 9,
    paddingBottom: 12,
    marginBottom: 8,
    overflow: 'hidden',
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  rowName: { flex: 1, fontSize: 15, fontWeight: '700' },
  rowFigure: { fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'], letterSpacing: -0.3 },
  rowFigureTotal: { fontSize: 12, fontWeight: '600' },
  rowCaption: { fontSize: 11, fontWeight: '600', letterSpacing: 0.3, marginTop: 3, paddingLeft: 16 },
  late: { color: '#F87171' },
  track: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3 },
  fill: { height: 3 },
  // One task = one inset card, stacked. The 8pt gap is the same rhythm as the
  // board rows above, so a board's tasks read as the same kind of object.
  // A line in a list, not a card: no fill, no border, no corner — the rule
  // between two of them is the whole separation. Horizontal padding is small
  // but not nil, so a pressed row's highlight does not start hard against the
  // page's own margin.
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 4,
    paddingVertical: 13,
  },
  taskTitle: { flex: 1, fontSize: 15, fontWeight: '600' },
  taskDone: { textDecorationLine: 'line-through' },
  // The all-boards variant stacks the board under the title, so the row keeps
  // one line of title and gains a quiet second line of provenance.
  taskStack: { flex: 1 },
  taskBoard: { fontSize: 11, fontWeight: '600', marginTop: 2 },
  taskMeta: { fontSize: 12, fontWeight: '600', flexShrink: 0, fontVariant: ['tabular-nums'] },
  finder: {
    borderRadius: 14,
    marginTop: 18,
    overflow: 'hidden',
  },
  finderField: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, height: FINDER_HEIGHT },
  finderInput: { ...INPUT_FIELD, flex: 1, fontSize: 15, padding: 0 },
  finderCreate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  finderCreateText: { flex: 1, fontSize: 14, fontWeight: '600' },
  pressed: { opacity: 0.6 },
});
