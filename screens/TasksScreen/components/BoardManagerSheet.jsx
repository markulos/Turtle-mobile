/**
 * BoardManagerSheet — the Tasks screen's board manager, on the app's sheet
 * shell (PhotoViewer/ViewerSheet: in-tree overlay, two detents, grab-bar
 * header, keyboard measure-then-lift, frosted dark card).
 *
 * One row per board, drawn as an inset panel: colour dot, name, done / total,
 * the overdue count, a hairline progress track, "shared by …" when the board
 * is someone else's. Tap a row to scope the screen to that board. The pencil
 * turns the name into a field (Return or the check saves, blur cancels); the
 * bin asks before deleting a board that still holds tasks. The add field sits
 * at the TOP of the sheet (house rule for search / add fields). A board shared
 * with me shows its owner and hides rename / delete — the server would refuse.
 *
 * Long-press on a rail card opens this sheet already editing that board.
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import AppTextInput from '../../../components/AppTextInput';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import ViewerSheet, { sheetColors } from '../../TurtleScreen/components/PhotoViewer/ViewerSheet';
import { impactHaptic, notifyHaptic, tapHaptic } from '../../../utils/haptics';
import { boardLabel } from '../utils/taskHelpers';

function BoardRow({ name, dot, stat, sharedBy, selected, editing, colors, onSelect, onStartEdit, onCommitEdit, onCancelEdit, onDelete }) {
  const total = stat?.total || 0;
  const done = stat?.done || 0;
  const overdue = stat?.overdue || 0;
  const pct = total > 0 ? Math.min(1, done / total) : 0;
  const [draft, setDraft] = useState(name);
  const inputRef = useRef(null);
  // The check key commits through onBlur's cancel otherwise: remember that a
  // commit is in flight so the blur that follows it does not undo it.
  const committingRef = useRef(false);
  useEffect(() => {
    if (editing) { committingRef.current = false; setDraft(name); setTimeout(() => inputRef.current?.focus(), 50); }
  }, [editing, name]);
  const commit = () => { committingRef.current = true; onCommitEdit(draft); };
  const mine = !sharedBy;

  return (
    <View
      style={[styles.row, { backgroundColor: colors.surface, borderColor: selected ? colors.textPrimary : colors.border }]}
      testID={`board-row-${name}`}
    >
      <Pressable
        onPressIn={() => tapHaptic()}
        onPress={editing ? undefined : onSelect}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={`${boardLabel(name)}: ${done} of ${total} done${overdue ? `, ${overdue} overdue` : ''}${sharedBy ? `, shared by ${sharedBy}` : ''}`}
        style={({ pressed }) => [styles.rowMain, pressed && !editing && styles.pressed]}
      >
        <View style={styles.rowTop}>
          <View style={[styles.dot, { backgroundColor: dot }]} />
          {editing ? (
            <TextInput
              ref={inputRef}
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={commit}
              onBlur={() => { if (!committingRef.current) onCancelEdit(); }}
              returnKeyType="done"
              autoCapitalize="words"
              autoCorrect={false}
              selectTextOnFocus
              style={[styles.nameInput, { color: colors.textPrimary, backgroundColor: 'rgba(255,255,255,0.10)' }]}
              accessibilityLabel={`Rename ${boardLabel(name)}`}
              testID={`board-rename-${name}`}
            />
          ) : (
            <Text style={[styles.name, { color: colors.textPrimary }]} numberOfLines={1}>{boardLabel(name)}</Text>
          )}
          <Text style={[styles.figure, { color: colors.textPrimary }]} numberOfLines={1}>
            {done}<Text style={[styles.figureTotal, { color: colors.textSecondary }]}>/{total}</Text>
          </Text>
        </View>
        <View style={styles.rowSub}>
          <Text style={[styles.caption, { color: colors.textMuted }]} numberOfLines={1}>
            {total === 0 ? 'Empty' : `${total - done} to do`}
            {overdue > 0 ? <Text style={styles.late}> · {overdue} late</Text> : null}
            {sharedBy ? ` · shared by ${sharedBy}` : ''}
          </Text>
        </View>
        <View style={[styles.track, { backgroundColor: 'rgba(255,255,255,0.14)' }]}>
          <View style={[styles.fill, { width: `${Math.round(pct * 100)}%`, backgroundColor: colors.textPrimary }]} />
        </View>
      </Pressable>
      {mine && (
        <View style={styles.rowKeys}>
          <Pressable
            onPressIn={() => tapHaptic()}
            onPress={editing ? commit : onStartEdit}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={editing ? `Save name for ${boardLabel(name)}` : `Rename ${boardLabel(name)}`}
            testID={`board-edit-${name}`}
            style={({ pressed }) => [styles.key, pressed && styles.pressed]}
          >
            <Icon name={editing ? 'check' : 'pencil-outline'} size={18} color={colors.textPrimary} />
          </Pressable>
          <Pressable
            onPressIn={() => notifyHaptic('warning')}
            onPress={onDelete}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Delete ${boardLabel(name)}`}
            testID={`board-delete-${name}`}
            style={({ pressed }) => [styles.key, pressed && styles.pressed]}
          >
            <Icon name="trash-can-outline" size={18} color="#F87171" />
          </Pressable>
        </View>
      )}
    </View>
  );
}

function BoardManagerSheet({
  boards, tasks, stats, colorOf, sharedIn, selected, initialBoard,
  onClose, onAdd, onRename, onDelete, onSelect, bottomInset = 0, theme,
}) {
  const colors = useMemo(() => sheetColors(theme, true), [theme]);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(initialBoard && boards.includes(initialBoard) ? initialBoard : null);
  const all = stats?.All || { total: 0, done: 0, overdue: 0 };

  const submitAdd = useCallback(async () => {
    const name = draft.trim();
    if (!name) return;
    impactHaptic('medium');
    const ok = await onAdd(name);
    if (ok) setDraft('');
  }, [draft, onAdd]);

  const commitRename = useCallback(async (from, to) => {
    const next = String(to || '').trim();
    setEditing(null);
    Keyboard.dismiss();
    if (!next || next === from) return;
    await onRename(from, next);
  }, [onRename]);

  const confirmDelete = useCallback((name) => {
    const boardTasks = (tasks || []).filter((t) => t && t.project === name);
    const taskCount = boardTasks.length;
    const subtaskCount = boardTasks.reduce((sum, t) => sum + (t.subtasks ? t.subtasks.length : 0), 0);
    const message = taskCount === 0
      ? `Delete "${name}"?`
      : `"${name}" holds ${taskCount} ${taskCount === 1 ? 'task' : 'tasks'}${subtaskCount ? ` and ${subtaskCount} subtask${subtaskCount === 1 ? '' : 's'}` : ''}. Deleting the board deletes them too. This cannot be undone.`;
    Alert.alert('Delete board', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => onDelete(name, { onDeleteTasks: taskCount > 0 }) },
    ]);
  }, [tasks, onDelete]);

  // Typing SEARCHES the boards (case-insensitive); when nothing matches the
  // exact name, a dashed template row offers to create it — the tags sheet's
  // model. The round + and Return do the same create.
  const query = draft.trim();
  const q = query.toLowerCase();
  const shown = useMemo(() => (q ? boards.filter((b) => b.toLowerCase().includes(q)) : boards), [boards, q]);
  const exactExists = !!q && boards.some((b) => b.toLowerCase() === q);
  const canAdd = query.length > 0 && !exactExists;
  const composer = (
    <View style={[styles.composer, { borderBottomColor: colors.border }]}>
      <Icon name="magnify" size={20} color={colors.textMuted} />
      {/* The field is a fixed-height pill that CENTRES an auto-height input —
          the only layout that keeps the placeholder and the caret on the
          pill's centre line on both platforms (a fixed-height TextInput
          parks its glyphs low on iOS). */}
      <View style={[styles.inputWrap, { backgroundColor: colors.surface }]}>
        <AppTextInput
          style={[styles.inputInner, { color: colors.textPrimary }]}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={submitAdd}
          placeholder="Search or add a board…"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="done"
          blurOnSubmit={false}
          accessibilityLabel="Search or add a board"
          testID="board-add-input"
        />
      </View>
      <Pressable
        onPress={submitAdd}
        disabled={!canAdd}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Add board"
        testID="board-add-send"
        style={({ pressed }) => [styles.send, pressed && styles.pressed]}
      >
        <Icon name="plus-circle" size={30} color={canAdd ? colors.primary : colors.textMuted} />
      </Pressable>
    </View>
  );

  const subtitle = `${boards.length} ${boards.length === 1 ? 'board' : 'boards'} · ${all.total - all.done} to do${all.overdue ? ` · ${all.overdue} late` : ''}`;

  return (
    <ViewerSheet
      title="Boards"
      subtitle={subtitle}
      bottomInset={bottomInset}
      onClose={onClose}
      theme={theme}
      dark
      keyboard
      topBar={composer}
      testID="board-manager-sheet"
    >
      {q.length > 0 && !exactExists && (
        <Pressable
          onPressIn={() => tapHaptic()}
          onPress={submitAdd}
          accessibilityRole="button"
          accessibilityLabel={`Create board ${query}`}
          testID="board-create-template"
          style={({ pressed }) => [styles.createRow, { borderColor: colors.chipGhostBorder }, pressed && styles.pressed]}
        >
          <View style={[styles.createIcon, { borderColor: colors.chipGhostBorder }]}>
            <Icon name="plus" size={16} color={colors.textPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.createTitle, { color: colors.textPrimary }]} numberOfLines={1}>Create "{query}"</Text>
            <Text style={[styles.createCaption, { color: colors.textMuted }]} numberOfLines={1}>New board</Text>
          </View>
        </Pressable>
      )}
      {q.length > 0 && shown.length > 0 && (
        <Text style={[styles.section, { color: colors.textSecondary }]}>Matching</Text>
      )}
      {boards.length === 0 && q.length === 0 && (
        <Text style={[styles.empty, { color: colors.textMuted }]}>No boards yet — type a name above.</Text>
      )}
      {shown.map((name) => (
        <BoardRow
          key={name}
          name={name}
          dot={colorOf(name)}
          stat={stats?.[name]}
          sharedBy={sharedIn?.[name]}
          selected={selected === name}
          editing={editing === name}
          colors={colors}
          onSelect={() => onSelect(name)}
          onStartEdit={() => setEditing(name)}
          onCommitEdit={(to) => commitRename(name, to)}
          onCancelEdit={() => setEditing((cur) => (cur === name ? null : cur))}
          onDelete={() => confirmDelete(name)}
        />
      ))}
    </ViewerSheet>
  );
}

export default memo(BoardManagerSheet);

const styles = StyleSheet.create({
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 4,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 8,
  },
  inputWrap: {
    flex: 1,
    height: 40,
    borderRadius: 20,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  inputInner: {
    paddingVertical: 0,
    paddingTop: 0,
    paddingBottom: 0,
    fontSize: 15,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  section: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: 4,
    marginBottom: 8,
  },
  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  createIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  createTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  createCaption: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
    marginTop: 1,
  },
  send: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    fontSize: 14,
    paddingVertical: 24,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 8,
    overflow: 'hidden',
  },
  rowMain: {
    flex: 1,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  name: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
  },
  nameInput: {
    flex: 1,
    height: 32,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 0,
    fontSize: 15,
    fontWeight: '700',
    textAlignVertical: 'center',
  },
  figure: {
    fontSize: 16,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    marginLeft: 8,
  },
  figureTotal: {
    fontSize: 12,
    fontWeight: '600',
  },
  rowSub: {
    marginTop: 3,
    paddingLeft: 16,
  },
  caption: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  late: {
    color: '#F87171',
  },
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
  },
  fill: {
    height: 3,
  },
  rowKeys: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 6,
    gap: 2,
  },
  key: {
    width: 40,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
});
