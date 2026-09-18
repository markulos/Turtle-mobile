/**
 * TaskDetail — the task card that pops up from the list, on the app's sheet
 * shell (PhotoViewer/ViewerSheet: in-tree overlay, frosted dark, two detents,
 * grab-bar header, keyboard measure-then-lift).
 *
 * It used to be a bespoke Modal: an 80 %-tall ScrollView over a flat
 * `theme.colors.background` card, chips the same colour as the card, one
 * full-width accent-outlined button per action and a left-bezel swipe-back of
 * its own. docs/STYLE-RULES.md §4 has since made the sheet shell the app-wide
 * contract for anything that pops up from below, and TaskInspectorSheet — the
 * day panel's task card — already moved. This is the same move for the list's
 * card, so the two read as one surface:
 *   • the SHELL supplies the handle, the grab-bar header (drag from any scroll
 *     position, tap to flip detents), the scrim, the enter/exit curves and the
 *     drag-down-to-close that replaces the bespoke edge-swipe;
 *   • the SURFACE is the dark frost (§1), so every chip inverts instead of
 *     being a slightly-different-dark-on-dark;
 *   • sections are small-caps 10.5/700 labels and chips are 34 pt keys, the
 *     same type scale the inspector and the Overview page use;
 *   • the three task actions become a wrapping row of keys rather than three
 *     stacked full-width buttons, and Edit / Delete become the shell's footer.
 *
 * Everything it showed before it still shows, and every prop it took it still
 * takes.
 */
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
} from 'react-native';
import AppTextInput from '../../../components/AppTextInput';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ViewerSheet, { sheetColors } from '../../TurtleScreen/components/PhotoViewer/ViewerSheet';
import { useTheme } from '../../../context/ThemeContext';
import { useServer } from '../../../context/ServerContext';
import {
  normalizeTags,
  getPriorityColor,
  areAllSubtasksCompleted,
  itemTypeOf,
  itemColorOf,
  isTaskDoneNow,
  lastCompletedDate,
  boardLabel,
  formatDueDate,
} from '../utils/taskHelpers';
import { REMINDER_OPTIONS } from '../utils/constants';
import { tapHaptic, impactHaptic, notifyHaptic } from '../../../utils/haptics';
import { sendOrQueue } from '../../../services/offlineQueue';

const commentInitials = (name) => (String(name || '').match(/\b\w/g) || ['?']).slice(0, 2).join('').toUpperCase();
const fmtCommentTime = (ms) => {
  try {
    const d = new Date(ms);
    const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return d.toDateString() === new Date().toDateString()
      ? t
      : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${t}`;
  } catch { return ''; }
};

const titleCase = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);

/**
 * A ghost KEY — the app's chip: 34 pt tall, hairline rim, label 12/700. On the
 * dark frost the rim and the ink are white, so it always separates from the
 * card (§1: never a slightly-different-dark-on-dark chip). `tint` colours the
 * icon only — one accent per chip, the way the Overview tiles carry theirs.
 */
function Key({ label, icon, tint, colors, onPress, testID }) {
  const body = (
    <>
      {!!icon && <Icon name={icon} size={14} color={tint || colors.textSecondary} />}
      <Text style={[styles.keyText, { color: colors.textPrimary }]} numberOfLines={1}>{label}</Text>
    </>
  );
  if (!onPress) {
    return <View style={[styles.key, { borderColor: colors.chipGhostBorder }]} testID={testID}>{body}</View>;
  }
  return (
    <Pressable
      onPressIn={() => tapHaptic()}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      style={({ pressed }) => [styles.key, { borderColor: colors.chipGhostBorder }, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

/**
 * An ACTION key — the same chip one rung taller (40 pt), for the things this
 * card can DO. Three of them wrap instead of stacking three full-width
 * buttons; §2 gives each one `flexShrink` and a single-line label so the row
 * can never overset the card.
 */
function ActionKey({ label, icon, tint, colors, onPress, onPressIn, testID }) {
  return (
    <Pressable
      onPressIn={onPressIn}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      style={({ pressed }) => [styles.actionKey, { borderColor: colors.chipGhostBorder }, pressed && styles.pressed]}
    >
      <Icon name={icon} size={16} color={tint || colors.textPrimary} />
      <Text style={[styles.actionKeyText, { color: colors.textPrimary }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

function Section({ label, colors, children, right }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{label}</Text>
        {right}
      </View>
      {children}
    </View>
  );
}

export const TaskDetail = ({
  task,
  visible,
  onClose,
  onEdit,
  onToggleComplete,
  onDelete,
  onTagPress,
  onToggleSubtask,
  onQueueForClaude,
  onStartPomodoro,
  onContinue,
}) => {
  const { theme } = useTheme();
  const { api } = useServer();
  const insets = useSafeAreaInsets();
  const [pomoCount, setPomoCount] = useState(0);
  const [comments, setComments] = useState([]);
  const [commentDraft, setCommentDraft] = useState('');
  const [postingComment, setPostingComment] = useState(false);
  // Pond members, used to resolve the task's involvedUsers (user IDs) to display
  // names for the read-only "People involved" chips. Same source the editor's
  // ParticipantPicker uses (/api/friends). Only fetched when the task actually
  // has assignees so a solo task makes no extra call.
  const [friends, setFriends] = useState([]);

  // Per-task completed-pomodoro count for the meta chip (read-only on mobile;
  // removing some lives in the web edit modal). Refetched when the sheet opens.
  useEffect(() => {
    if (!visible || !task?.id) return;
    let cancelled = false;
    api.get(`/pomodoros?taskId=${encodeURIComponent(task.id)}`)
      .then((res) => {
        if (cancelled) return;
        const list = Array.isArray(res?.pomodoros) ? res.pomodoros : [];
        setPomoCount(list.filter((p) => p.status === 'completed' && p.completedAt).length);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [api, visible, task?.id]);

  // Resolve assignee names for the "People involved" chips. Skipped entirely
  // for tasks with no one assigned.
  const involvedUsers = Array.isArray(task?.involvedUsers) ? task.involvedUsers : [];
  useEffect(() => {
    if (!visible || involvedUsers.length === 0) return;
    let cancelled = false;
    api.get('/friends')
      .then((r) => { if (!cancelled) setFriends(Array.isArray(r?.friends) ? r.friends : []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [api, visible, involvedUsers.length]);

  // Comment thread — anyone who can SEE the task (owner, shared-board, involved)
  // may read + reply; the server gates by taskVisibility. Loaded on open.
  const loadComments = useCallback(async () => {
    if (!task?.id) return;
    try {
      const res = await api.get(`/tasks/${task.id}/comments`);
      setComments(Array.isArray(res?.comments) ? res.comments : []);
    } catch { /* keep last */ }
  }, [api, task?.id]);
  useEffect(() => { if (visible && task?.id) loadComments(); }, [visible, task?.id, loadComments]);
  const postComment = useCallback(async () => {
    const content = commentDraft.trim();
    if (!content || postingComment) return;
    setPostingComment(true);
    try {
      // Through the outbox: offline, the comment shows at once (pending) and
      // lands on reconnect.
      const r = await sendOrQueue(api, { method: 'post', path: `/tasks/${task.id}/comments`, body: { content }, label: 'comment' });
      setCommentDraft('');
      if (r.queued) setComments((prev) => [...prev, { id: `local_${Date.now()}`, content, pending: true, created_at: new Date().toISOString() }]);
      else if (r.result?.comment) setComments((prev) => [...prev, r.result.comment]);
      else await loadComments();
    } catch { /* keep draft */ } finally { setPostingComment(false); }
  }, [api, task?.id, commentDraft, postingComment, loadComments]);

  // The sheet is a white-on-black surface whatever the app theme is (§1), the
  // same frost the day panel's inspector wears.
  const colors = useMemo(() => sheetColors(theme, true), [theme]);

  // The shell owns the exit animation and calls onClose at the end of it, so
  // dismissal is just the prop — no local fade/isClosing state, and no
  // bespoke edge-swipe: a drag down past the collapsed detent closes.
  const handleTagPress = useCallback((tag) => { onClose?.(); onTagPress?.(tag); }, [onClose, onTagPress]);

  // Mounted only while open: a closed card costs the gesture path nothing, and
  // ViewerSheet plays its entrance on mount.
  if (!task || !visible) return null;

  const subtasks = task.subtasks || [];
  const tags = normalizeTags(task.tags);
  const allSubtasksDone = areAllSubtasksCompleted(subtasks);
  const completedSubtasks = subtasks.filter(st => st.completed).length;
  const done = isTaskDoneNow(task);

  // Occasion (event / birthday) extras.
  const kind = itemTypeOf(task);
  const isOccasion = kind !== 'task';
  const occasionColor = itemColorOf(task);
  const guests = Array.isArray(task.meta?.guests) ? task.meta.guests : [];
  const reminderLabels = (Array.isArray(task.meta?.reminders) ? task.meta.reminders : [])
    .map(v => (REMINDER_OPTIONS.find(o => o.value === v)?.label) || v);
  const yearly = kind === 'birthday' && task.meta?.yearly !== false;

  // People involved (tasks only). Resolve IDs -> display name via the fetched
  // pond members; fall back to the raw id if the member list hasn't loaded yet.
  const nameOfUser = (id) => {
    const f = friends.find((x) => x.id === id);
    return f ? (f.displayName || f.phone || 'Member') : id;
  };

  // The one filled pill on the card: priority for a task, the kind for an
  // occasion. Black ink on the accent — the inversion rule, and the only
  // colour-as-fill on the surface.
  const stampColor = isOccasion ? (occasionColor || theme.colors.accentInfo) : getPriorityColor(task.priority, theme);
  const stampLabel = isOccasion ? kind : (task.priority || 'medium');

  // While a recurring task is checked (done-now), show the TICKED date — not
  // the already-advanced next dueDate, which read as "completed it, now it
  // says due tomorrow?!".
  const shownDate = (done && !task.completed && lastCompletedDate(task)) || task.dueDate;
  const dateLabel = isOccasion ? 'Date' : (done && !task.completed ? 'Done' : 'Due');

  const titleField = (
    <View style={styles.titleRow}>
      {/* done-now, not the raw bool: a recurring task's `completed` never flips
          (the series stays live), so keying off it left the ring unchecked
          right after ticking — and a confused second tap silently unticked it. */}
      <Pressable
        onPressIn={() => tapHaptic()}
        onPress={onToggleComplete}
        hitSlop={12}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={done ? 'Mark incomplete' : 'Mark complete'}
        testID="detail-done"
        style={[styles.ring, { borderColor: colors.textPrimary }, done && { backgroundColor: colors.textPrimary }]}
      >
        {done && <Icon name="check" size={16} color={colors.background} />}
      </Pressable>
      <Pressable
        onPressIn={() => tapHaptic()}
        onPress={onEdit}
        accessibilityRole="button"
        accessibilityLabel={`Edit ${task.title}`}
        testID="detail-title"
        style={({ pressed }) => [styles.titleTextWrap, pressed && styles.pressed]}
      >
        <Text style={[styles.title, { color: colors.textPrimary }, done && styles.struck]}>
          {task.title}
        </Text>
        <View style={styles.editHintRow}>
          <Icon name="pencil-outline" size={12} color={colors.textMuted} />
          <Text style={[styles.editHint, { color: colors.textMuted }]}>Tap to edit</Text>
        </View>
      </Pressable>
    </View>
  );

  const footer = (
    /* No bottom padding: the shell pins this bar and owns the space under it. */
    <View style={styles.footer}>
      <Pressable
        onPressIn={() => tapHaptic()}
        onPress={onEdit}
        accessibilityRole="button"
        accessibilityLabel="Edit task"
        testID="detail-edit"
        style={({ pressed }) => [styles.primary, { backgroundColor: colors.chip }, pressed && styles.pressed]}
      >
        <Icon name="square-edit-outline" size={16} color={colors.chipText} />
        <Text style={[styles.primaryText, { color: colors.chipText }]}>Edit</Text>
      </Pressable>
      <Pressable
        onPressIn={() => notifyHaptic('warning')}
        onPress={onDelete}
        accessibilityRole="button"
        accessibilityLabel="Delete task"
        testID="detail-delete"
        style={({ pressed }) => [styles.secondary, { borderColor: 'rgba(248,113,113,0.6)' }, pressed && styles.pressed]}
      >
        <Icon name="trash-can-outline" size={16} color="#F87171" />
        <Text style={[styles.secondaryText, { color: '#F87171' }]}>Delete</Text>
      </Pressable>
    </View>
  );

  const hasActions = (onContinue && !isOccasion) || onStartPomodoro || onQueueForClaude;

  return (
    /* Transparent Modal so the card covers the floating tab bar too — the same
       mounting the day panel's inspector uses. The shell's own footer only has
       to clear the home indicator, so bottomInset is the safe-area inset. */
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
      supportedOrientations={['portrait', 'landscape']}
    >
      <ViewerSheet
        title={isOccasion ? titleCase(kind) : (task.project ? boardLabel(task.project) : 'Task')}
        subtitle={done && !task.completed
          ? 'Done'
          : (task.dueDate ? `${formatDueDate(task.dueDate)}${task.time ? ` · ${task.time}` : ''}` : 'No date')}
        bottomInset={insets.bottom}
        onClose={onClose}
        theme={theme}
        dark
        keyboard
        topBar={titleField}
        footer={footer}
        testID="task-detail-sheet"
      >
        <Section label={isOccasion ? 'Type' : 'Priority'} colors={colors}>
          <View style={styles.wrap}>
            <View style={[styles.stamp, { backgroundColor: stampColor }]}>
              <Text style={styles.stampText} numberOfLines={1}>{stampLabel}</Text>
            </View>
          </View>
        </Section>

        <Section label="Details" colors={colors}>
          <View style={styles.wrap}>
            {!!task.project && <Key icon="folder-outline" label={boardLabel(task.project)} colors={colors} />}
            {!!shownDate && <Key icon="calendar-blank-outline" label={`${dateLabel}: ${shownDate}`} colors={colors} />}
            {!!task.time && isOccasion && <Key icon="clock-outline" label={task.time} colors={colors} />}
            {yearly && <Key icon="calendar-refresh" label="Every year" tint={theme.colors.accentSuccess} colors={colors} />}
            <Key icon="clock-outline" label={`Created: ${new Date(task.createdAt).toLocaleDateString()}`} colors={colors} />
            {task.completed && task.completedTime && (
              <Key icon="check-circle" label={`Done: ${new Date(task.completedTime).toLocaleString()}`} tint={theme.colors.accentSuccess} colors={colors} />
            )}
            {pomoCount > 0 && (
              <Key icon="timer-outline" label={`${pomoCount} ${pomoCount === 1 ? 'pomodoro' : 'pomodoros'} spent`} tint={theme.colors.accentInfo} colors={colors} />
            )}
          </View>
        </Section>

        {tags.length > 0 && (
          <Section label="Tags" colors={colors}>
            <View style={styles.wrap}>
              {tags.map((tag, idx) => (
                <Key key={idx} icon="tag-outline" label={tag} colors={colors} onPress={() => handleTagPress(tag)} />
              ))}
            </View>
          </Section>
        )}

        {/* Guests — events. */}
        {guests.length > 0 && (
          <Section label={`Guests · ${guests.length}`} colors={colors}>
            <View style={styles.wrap}>
              {guests.map((g, idx) => <Key key={idx} icon="account-outline" label={g} colors={colors} />)}
            </View>
          </Section>
        )}

        {/* People involved — tasks. They can see the task (view-only) and were
            notified when added. Edit the set via the task editor. */}
        {!isOccasion && involvedUsers.length > 0 && (
          <Section label={`People involved · ${involvedUsers.length}`} colors={colors} right={<Text style={[styles.hint, { color: colors.textMuted }]}>edit in the full editor</Text>}>
            <View style={styles.wrap}>
              {involvedUsers.map((id) => (
                <Key key={id} icon="account-outline" label={nameOfUser(id)} tint={theme.colors.accentInfo} colors={colors} />
              ))}
            </View>
          </Section>
        )}

        {/* Reminders — birthdays. */}
        {reminderLabels.length > 0 && (
          <Section label="Reminders" colors={colors}>
            <View style={styles.wrap}>
              {reminderLabels.map((label, idx) => <Key key={idx} icon="bell-ring-outline" label={label} colors={colors} />)}
            </View>
          </Section>
        )}

        {task.description ? (
          <Section label="Notes" colors={colors}>
            <View style={[styles.notes, { backgroundColor: colors.surface }]}>
              <Text style={[styles.notesText, { color: colors.textPrimary }]}>{task.description}</Text>
            </View>
          </Section>
        ) : null}

        {subtasks.length > 0 && (
          <Section
            label={`Subtasks · ${completedSubtasks}/${subtasks.length}`}
            colors={colors}
            right={allSubtasksDone ? <Text style={[styles.hint, { color: theme.colors.accentSuccess }]}>all done</Text> : null}
          >
            <View style={[styles.track, { backgroundColor: colors.surface }]}>
              <View style={[styles.trackFill, { width: `${(completedSubtasks / subtasks.length) * 100}%`, backgroundColor: colors.textPrimary }]} />
            </View>
            {subtasks.map((subtask) => (
              <Pressable
                key={subtask.id}
                onPressIn={() => impactHaptic('light')}
                onPress={() => onToggleSubtask?.(task.id, subtask.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: !!subtask.completed }}
                accessibilityLabel={subtask.completed ? `Mark ${subtask.title} not done` : `Mark ${subtask.title} done`}
                style={({ pressed }) => [styles.subRow, { borderBottomColor: colors.border }, pressed && styles.pressed]}
              >
                <View style={[styles.subRing, { borderColor: colors.textPrimary }, subtask.completed && { backgroundColor: colors.textPrimary }]}>
                  {subtask.completed && <Icon name="check" size={12} color={colors.background} />}
                </View>
                <Text
                  style={[styles.subTitle, { color: subtask.completed ? colors.textMuted : colors.textPrimary }, subtask.completed && styles.struck]}
                  numberOfLines={2}
                >
                  {subtask.title}
                </Text>
              </Pressable>
            ))}
          </Section>
        )}

        {hasActions && (
          <Section label="Actions" colors={colors}>
            <View style={styles.wrap}>
              {/* "Continue today" — re-add this task to today as a
                  progress-carrying copy. Subtasks and their done state ride
                  along (the "status it already had"); the copy itself is an
                  open continuation of this still-open task. Tasks only —
                  occasions (events/birthdays) aren't continued this way. */}
              {onContinue && !isOccasion && (
                <ActionKey
                  label="Continue today"
                  icon="calendar-plus"
                  tint={theme.colors.accentSuccess}
                  colors={colors}
                  onPressIn={() => notifyHaptic('success')}
                  onPress={onContinue}
                  testID="detail-continue"
                />
              )}
              {/* Start a focus timer for this task. Routes through the Turtle
                  chat's /pomodoro pipeline (the task title rides along as the
                  session label), then jumps to the Turtle tab where the timer
                  card lives. */}
              {onStartPomodoro && (
                <ActionKey
                  label="Start Pomodoro"
                  icon="timer-outline"
                  tint={theme.colors.accentWarning}
                  colors={colors}
                  onPressIn={() => impactHaptic('medium')}
                  onPress={onStartPomodoro}
                  testID="detail-pomodoro"
                />
              )}
              {/* Hand this task off to the Claude session (Turtle tab). It's
                  added to a queue that Claude works through one at a time. */}
              {onQueueForClaude && (
                <ActionKey
                  label="Send to Claude"
                  icon="robot-outline"
                  tint={theme.colors.accentInfo}
                  colors={colors}
                  onPressIn={() => tapHaptic()}
                  onPress={onQueueForClaude}
                  testID="detail-claude"
                />
              )}
            </View>
          </Section>
        )}

        {/* Comments — read + reply. Gated server-side by taskVisibility, so the
            owner, shared-board members, and involved parties can all take part. */}
        <Section label={comments.length ? `Comments · ${comments.length}` : 'Comments'} colors={colors}>
          {comments.length === 0 ? (
            <Text style={[styles.empty, { color: colors.textMuted }]}>No comments yet. Start the conversation.</Text>
          ) : (
            comments.map((c) => (
              <View key={c.id} style={styles.commentRow}>
                <View style={[styles.avatar, { backgroundColor: colors.surface }]}>
                  <Text style={[styles.avatarText, { color: colors.textPrimary }]}>{commentInitials(c.authorName)}</Text>
                </View>
                <View style={styles.commentBody}>
                  <Text style={styles.commentMeta} numberOfLines={1}>
                    <Text style={[styles.commentAuthor, { color: colors.textPrimary }]}>{c.authorName}</Text>
                    <Text style={{ color: colors.textMuted }}>{`  ${fmtCommentTime(c.createdAt)}`}</Text>
                  </Text>
                  <Text style={[styles.commentText, { color: colors.textPrimary }]}>{c.content}</Text>
                </View>
              </View>
            ))
          )}
          <View style={styles.composer}>
            <View style={[styles.composerField, { backgroundColor: colors.surface }]}>
              <AppTextInput
                style={[styles.composerInput, { color: colors.textPrimary }]}
                placeholder="Add a comment…"
                placeholderTextColor={colors.textMuted}
                value={commentDraft}
                onChangeText={setCommentDraft}
                accessibilityLabel="Add a comment"
                testID="detail-comment-input"
                multiline
              />
            </View>
            <Pressable
              onPressIn={() => impactHaptic('medium')}
              onPress={postComment}
              disabled={!commentDraft.trim() || postingComment}
              accessibilityRole="button"
              accessibilityLabel="Post comment"
              testID="detail-comment-send"
              style={({ pressed }) => [
                styles.send,
                { backgroundColor: colors.chip, opacity: commentDraft.trim() && !postingComment ? 1 : 0.4 },
                pressed && styles.pressed,
              ]}
            >
              <Icon name="send" size={18} color={colors.chipText} />
            </Pressable>
          </View>
        </Section>
      </ViewerSheet>
    </Modal>
  );
};

const styles = StyleSheet.create({
  // Top bar — the ring and the title, the shell's fixed row under the header.
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingBottom: 12 },
  ring: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  titleTextWrap: { flex: 1, minWidth: 0 },
  title: { fontSize: 20, fontWeight: '600', lineHeight: 26 },
  struck: { textDecorationLine: 'line-through', opacity: 0.6 },
  editHintRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  editHint: { fontSize: 11, fontWeight: '500' },

  // Sections — the app's small-caps label, the Overview / inspector scale.
  section: { marginTop: 4, marginBottom: 14 },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 },
  sectionLabel: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.9, textTransform: 'uppercase' },
  hint: { fontSize: 11, fontWeight: '500' },

  // Chips. maxWidth + flexShrink + one line: nothing oversets the card (§2).
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  key: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, maxWidth: '100%', flexShrink: 1 },
  keyText: { fontSize: 12, fontWeight: '600', letterSpacing: 0.2, flexShrink: 1 },
  stamp: { height: 30, paddingHorizontal: 14, borderRadius: 15, alignItems: 'center', justifyContent: 'center', maxWidth: '100%', flexShrink: 1 },
  stampText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: '#000' },
  actionKey: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, maxWidth: '100%', flexShrink: 1 },
  actionKeyText: { fontSize: 13, fontWeight: '700', flexShrink: 1 },

  notes: { borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 },
  notesText: { fontSize: 15, lineHeight: 21 },

  track: { height: 4, borderRadius: 2, marginBottom: 6, overflow: 'hidden' },
  trackFill: { height: '100%', borderRadius: 2 },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth },
  subRing: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  subTitle: { flex: 1, fontSize: 15 },

  // Comments.
  empty: { fontSize: 13, fontStyle: 'italic', paddingVertical: 6 },
  commentRow: { flexDirection: 'row', gap: 10, paddingVertical: 8 },
  avatar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 11, fontWeight: '700' },
  commentBody: { flex: 1, minWidth: 0 },
  commentMeta: { fontSize: 13 },
  commentAuthor: { fontWeight: '700' },
  commentText: { fontSize: 14, marginTop: 2 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 10 },
  composerField: { flex: 1, minHeight: 40, maxHeight: 120, borderRadius: 14, paddingHorizontal: 14, justifyContent: 'center' },
  composerInput: { fontSize: 15, lineHeight: 20, paddingVertical: 10, textAlignVertical: 'top', includeFontPadding: false },
  send: { width: 44, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },

  footer: { flexDirection: 'row', gap: 10, paddingTop: 8 },
  primary: { flex: 1, height: 46, borderRadius: 23, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryText: { fontSize: 15, fontWeight: '700' },
  secondary: { height: 46, paddingHorizontal: 18, borderRadius: 23, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  secondaryText: { fontSize: 15, fontWeight: '700' },
  pressed: { opacity: 0.6 },
});
