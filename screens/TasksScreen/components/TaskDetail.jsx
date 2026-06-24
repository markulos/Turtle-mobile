import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Animated,
  PanResponder,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../context/ThemeContext';
import { useServer } from '../../../context/ServerContext';
import { normalizeTags, getPriorityColor, areAllSubtasksCompleted, itemTypeOf, itemColorOf } from '../utils/taskHelpers';
import { REMINDER_OPTIONS } from '../utils/constants';

// iPhone-style edge-swipe-to-back. Touch must start within the first
// ~24px of the screen's left edge and drag rightward fast enough or
// far enough to commit. Matches the system gesture every other iOS app
// responds to when you swipe in from the bezel.
const EDGE_BACK_ZONE_PX = 24;
const EDGE_BACK_COMMIT_DX = 80;
const EDGE_BACK_COMMIT_VX = 0.5;

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
}) => {
  const { theme } = useTheme();
  const { api } = useServer();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [isClosing, setIsClosing] = useState(false);
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
      const res = await api.post(`/tasks/${task.id}/comments`, { content });
      setCommentDraft('');
      if (res?.comment) setComments((prev) => [...prev, res.comment]);
      else await loadComments();
    } catch { /* keep draft */ } finally { setPostingComment(false); }
  }, [api, task?.id, commentDraft, postingComment, loadComments]);

  useEffect(() => {
    if (visible) {
      setIsClosing(false);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    } else if (isClosing) {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(() => {
        setIsClosing(false);
      });
    }
  }, [visible, isClosing, fadeAnim]);
  
  const handleClose = () => {
    setIsClosing(true);
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      onClose();
    });
  };

  // Ref-mirror of handleClose. The PanResponder below is created ONCE
  // (useMemo with empty deps), so it would otherwise close over the
  // first-render handleClose forever. We point this ref at the latest
  // handleClose every render — the responder dereferences it on
  // release, so a stale `onClose` prop can never leak through.
  const handleCloseRef = useRef(handleClose);
  handleCloseRef.current = handleClose;

  // Edge-swipe-back gesture. Only claims gestures that BEGAN within
  // the left bezel and drag dominantly right; everything else passes
  // through to the ScrollView so taps and vertical scrolls keep
  // working. PanResponder identity is stable for the component's
  // lifetime — see the ref above for why.
  const edgeBackResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (evt, g) => {
          const startX = evt.nativeEvent.pageX - g.dx;
          return (
            startX < EDGE_BACK_ZONE_PX &&
            g.dx > 8 &&
            Math.abs(g.dx) > Math.abs(g.dy) * 1.5
          );
        },
        onPanResponderRelease: (_, g) => {
          if (g.dx > EDGE_BACK_COMMIT_DX || g.vx > EDGE_BACK_COMMIT_VX) {
            handleCloseRef.current?.();
          }
        },
      }),
    [],
  );

  if (!task) return null;

  // Ensure subtasks exists
  const subtasks = task.subtasks || [];
  const tags = normalizeTags(task.tags);
  const allSubtasksDone = areAllSubtasksCompleted(subtasks);
  const completedSubtasks = subtasks.filter(st => st.completed).length;

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

  const styles = createStyles(theme);

  return (
    <Modal animationType="none" transparent visible={visible} onRequestClose={handleClose}>
      <Animated.View
        style={[styles.overlay, { opacity: fadeAnim }]}
        {...edgeBackResponder.panHandlers}
      >
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          <View style={styles.content}>
            <View style={styles.header}>
              {isOccasion ? (
                <View style={[styles.badge, { backgroundColor: occasionColor || theme.colors.accentInfo }]}>
                  <Text style={styles.badgeText}>{kind}</Text>
                </View>
              ) : (
                <View style={[styles.badge, { backgroundColor: getPriorityColor(task.priority, theme) }]}>
                  <Text style={styles.badgeText}>{task.priority}</Text>
                </View>
              )}
              <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
                <Icon name="close" size={24} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Title row — web-style: a tappable complete circle on the left
                (fills green w/ a check when done), and the title itself is
                tappable to expand into the editor. */}
            <View style={styles.titleRow}>
              <TouchableOpacity
                onPress={onToggleComplete}
                activeOpacity={0.7}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                style={[styles.completeCircle, task.completed && styles.completeCircleDone]}
                accessibilityLabel={task.completed ? 'Mark incomplete' : 'Mark complete'}
              >
                {task.completed && (
                  <Icon name="check" size={16} color={theme.colors.background} />
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.titleTextWrap}
                onPress={onEdit}
                activeOpacity={0.6}
              >
                <Text style={[styles.title, task.completed && styles.titleCompleted]}>
                  {task.title}
                </Text>
                <View style={styles.editHintRow}>
                  <Icon name="pencil-outline" size={12} color={theme.colors.textTertiary} />
                  <Text style={styles.editHint}>Tap to edit</Text>
                </View>
              </TouchableOpacity>
            </View>

            {/* Subtasks progress */}
            {subtasks.length > 0 && (
              <View style={styles.subtaskSection}>
                <View style={styles.subtaskHeader}>
                  <Text style={styles.subtaskTitle}>Subtasks</Text>
                  <Text style={styles.subtaskCount}>
                    {completedSubtasks}/{subtasks.length}
                  </Text>
                </View>
                <View style={styles.progressBar}>
                  <View 
                    style={[
                      styles.progressFill, 
                      { width: `${(completedSubtasks / subtasks.length) * 100}%` }
                    ]} 
                  />
                </View>
                {allSubtasksDone && (
                  <Text style={styles.allDoneText}>All subtasks completed!</Text>
                )}
              </View>
            )}

            <View style={styles.meta}>
              {task.project && (
                <View style={styles.metaItem}>
                  <Icon name="folder" size={16} color={theme.colors.textPrimary} />
                  <Text style={styles.metaText}>{task.project}</Text>
                </View>
              )}

              {tags.length > 0 && (
                <View style={styles.tagsRow}>
                  {tags.map((tag, idx) => (
                    <TouchableOpacity 
                      key={idx} 
                      style={styles.tagChip}
                      onPress={() => { onClose(); onTagPress(tag); }}
                    >
                      <Icon name="tag" size={12} color={theme.colors.textPrimary} />
                      <Text style={styles.tagText}>{tag}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {task.dueDate && (
                <View style={styles.metaItem}>
                  <Icon name="calendar" size={16} color={theme.colors.textSecondary} />
                  <Text style={styles.metaText}>{isOccasion ? 'Date' : 'Due'}: {task.dueDate}</Text>
                </View>
              )}

              {task.time && isOccasion && (
                <View style={styles.metaItem}>
                  <Icon name="clock-outline" size={16} color={theme.colors.textSecondary} />
                  <Text style={styles.metaText}>{task.time}</Text>
                </View>
              )}

              {yearly && (
                <View style={styles.metaItem}>
                  <Icon name="calendar-refresh" size={16} color={theme.colors.accentSuccess} />
                  <Text style={styles.metaText}>Every year</Text>
                </View>
              )}

              <View style={styles.metaItem}>
                <Icon name="clock-outline" size={16} color={theme.colors.textSecondary} />
                <Text style={styles.metaText}>
                  Created: {new Date(task.createdAt).toLocaleDateString()}
                </Text>
              </View>

              {task.completed && task.completedTime && (
                <View style={[styles.metaItem, styles.completedItem]}>
                  <Icon name="check-circle" size={16} color={theme.colors.accentSuccess} />
                  <Text style={[styles.metaText, styles.completedText]}>
                    Done: {new Date(task.completedTime).toLocaleString()}
                  </Text>
                </View>
              )}

              {pomoCount > 0 && (
                <View style={styles.metaItem}>
                  <Icon name="timer-outline" size={16} color={theme.colors.accentInfo} />
                  <Text style={styles.metaText}>
                    {pomoCount} {pomoCount === 1 ? 'pomodoro' : 'pomodoros'} spent
                  </Text>
                </View>
              )}
            </View>

            {task.description && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Description</Text>
                <Text style={styles.description}>{task.description}</Text>
              </View>
            )}

            {/* Guests — events. */}
            {guests.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Guests ({guests.length})</Text>
                <View style={styles.tagsRow}>
                  {guests.map((g, idx) => (
                    <View key={idx} style={styles.tagChip}>
                      <Icon name="account" size={12} color={theme.colors.textPrimary} />
                      <Text style={styles.tagText}>{g}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* People involved — tasks. They can see the task (view-only) and
                were notified when added. Edit the set via the task editor. */}
            {!isOccasion && involvedUsers.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>People involved ({involvedUsers.length})</Text>
                <View style={styles.tagsRow}>
                  {involvedUsers.map((id) => (
                    <View key={id} style={styles.tagChip}>
                      <Icon name="account" size={12} color={theme.colors.accentInfo} />
                      <Text style={styles.tagText}>{nameOfUser(id)}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Reminders — birthdays. */}
            {reminderLabels.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Reminders</Text>
                <View style={styles.tagsRow}>
                  {reminderLabels.map((label, idx) => (
                    <View key={idx} style={styles.tagChip}>
                      <Icon name="bell-ring" size={12} color={theme.colors.textPrimary} />
                      <Text style={styles.tagText}>{label}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Subtasks list in detail */}
            {subtasks.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Subtasks</Text>
                {subtasks.map((subtask, idx) => (
                  <TouchableOpacity 
                    key={subtask.id} 
                    style={styles.subtaskRow}
                    onPress={() => onToggleSubtask?.(task.id, subtask.id)}
                    activeOpacity={0.7}
                  >
                    <Icon 
                      name={subtask.completed ? "checkbox-marked" : "checkbox-blank-outline"} 
                      size={18} 
                      color={subtask.completed ? theme.colors.accentSuccess : theme.colors.textSecondary} 
                    />
                    <Text style={[
                      styles.subtaskText,
                      subtask.completed && styles.subtaskCompleted
                    ]}>
                      {subtask.title}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Start a focus timer for this task. Routes through the Turtle
                chat's /pomodoro pipeline (the task title rides along as the
                session label), then jumps to the Turtle tab where the timer
                card lives. */}
            {onStartPomodoro && (
              <TouchableOpacity
                style={styles.pomodoroBtn}
                onPress={onStartPomodoro}
                activeOpacity={0.85}
              >
                <Icon name="timer-outline" size={20} color={theme.colors.textPrimary} />
                <Text style={styles.pomodoroText}>Start Pomodoro</Text>
              </TouchableOpacity>
            )}

            {/* Hand this task off to the Claude session (Turtle tab). It's
                added to a queue that Claude works through one at a time. */}
            {onQueueForClaude && (
              <TouchableOpacity
                style={styles.claudeQueueBtn}
                onPress={onQueueForClaude}
                activeOpacity={0.85}
              >
                <Icon name="robot-outline" size={20} color={theme.colors.textPrimary} />
                <Text style={styles.claudeQueueText}>Send to Claude</Text>
              </TouchableOpacity>
            )}

            <View style={styles.actions}>
              <TouchableOpacity style={[styles.actionBtn, styles.editBtn]} onPress={onEdit}>
                <Icon name="pencil" size={20} color={theme.colors.textPrimary} />
                <Text style={styles.actionText}>Edit</Text>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.actionBtn, styles.deleteBtn]} onPress={onDelete}>
                <Icon name="delete" size={20} color={theme.colors.textPrimary} />
                <Text style={styles.actionText}>Delete</Text>
              </TouchableOpacity>
            </View>

            {/* Comments — read + reply. Gated server-side by taskVisibility, so
                the owner, shared-board members, and involved parties can all
                participate. */}
            <View style={styles.section}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: theme.colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                {comments.length ? `Comments · ${comments.length}` : 'Comments'}
              </Text>
              {comments.length === 0 ? (
                <Text style={{ fontSize: 13, color: theme.colors.textTertiary, fontStyle: 'italic', paddingVertical: 6 }}>
                  No comments yet. Start the conversation.
                </Text>
              ) : (
                comments.map((c) => (
                  <View key={c.id} style={{ flexDirection: 'row', gap: 10, paddingVertical: 8 }}>
                    <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: (theme.colors.accentInfo || '#0a84ff') + '33', alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: theme.colors.accentInfo || '#0a84ff' }}>
                        {commentInitials(c.authorName)}
                      </Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ fontSize: 13 }}>
                        <Text style={{ fontWeight: '700', color: theme.colors.textPrimary }}>{c.authorName}</Text>
                        <Text style={{ color: theme.colors.textTertiary }}>{`  ${fmtCommentTime(c.createdAt)}`}</Text>
                      </Text>
                      <Text style={{ fontSize: 14, color: theme.colors.textPrimary, marginTop: 2 }}>{c.content}</Text>
                    </View>
                  </View>
                ))
              )}
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 10 }}>
                <TextInput
                  style={{ flex: 1, minHeight: 40, maxHeight: 120, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, color: theme.colors.textPrimary, backgroundColor: theme.colors.surfaceElevated }}
                  placeholder="Add a comment…"
                  placeholderTextColor={theme.colors.textTertiary}
                  value={commentDraft}
                  onChangeText={setCommentDraft}
                  multiline
                />
                <TouchableOpacity
                  onPress={postComment}
                  disabled={!commentDraft.trim() || postingComment}
                  style={{ width: 44, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accentInfo || '#0a84ff', opacity: commentDraft.trim() && !postingComment ? 1 : 0.5 }}
                >
                  <Icon name="send" size={18} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </ScrollView>
      </Animated.View>
    </Modal>
  );
};

const createStyles = (theme) => StyleSheet.create({
  overlay: { 
    flex: 1, 
    backgroundColor: 'rgba(0, 0, 0, 0.5)', 
    justifyContent: 'flex-end' 
  },
  scrollView: { 
    maxHeight: '80%' 
  },
  scrollContent: { 
    flexGrow: 1, 
    justifyContent: 'flex-end' 
  },
  content: { 
    backgroundColor: theme.colors.background, 
    borderTopLeftRadius: 20, 
    borderTopRightRadius: 20, 
    padding: 20 
  },
  header: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    marginBottom: 15 
  },
  closeBtn: { 
    padding: 5 
  },
  // Title row — complete circle + tappable title (expands to editor)
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 15,
  },
  completeCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: theme.colors.borderStrong,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    marginTop: 1,
  },
  completeCircleDone: {
    borderColor: theme.colors.accentSuccess,
    backgroundColor: theme.colors.accentSuccess,
  },
  titleTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: theme.typography.body,
    fontWeight: 'bold',
    color: theme.colors.textPrimary,
  },
  titleCompleted: {
    textDecorationLine: 'line-through',
    color: theme.colors.textMuted,
  },
  editHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 4,
  },
  editHint: {
    fontSize: 11,
    color: theme.colors.textTertiary,
  },

  // Subtask section
  subtaskSection: {
    backgroundColor: theme.colors.surfaceElevated,
    padding: 12,
    borderRadius: 10,
    marginBottom: 15,
  },
  subtaskHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  subtaskTitle: {
    fontSize: theme.typography.body,
    fontWeight: '600',
    color: theme.colors.textPrimary,
  },
  subtaskCount: {
    fontSize: theme.typography.body,
    color: theme.colors.textSecondary,
  },
  progressBar: {
    height: 4,
    backgroundColor: theme.colors.surfaceHighlight,
    borderRadius: 2,
  },
  progressFill: {
    height: '100%',
    backgroundColor: theme.colors.textSecondary,
    borderRadius: 2,
  },
  allDoneText: {
    fontSize: theme.typography.body,
    color: theme.colors.accentSuccess,
    marginTop: 8,
    fontStyle: 'italic',
  },
  
  badge: { 
    paddingHorizontal: 12, 
    paddingVertical: 6, 
    borderRadius: 15 
  },
  badgeText: { 
    color: theme.colors.textPrimary, 
    fontWeight: '600', 
    textTransform: 'uppercase', 
    fontSize: theme.typography.body 
  },
  
  meta: { 
    flexDirection: 'row', 
    flexWrap: 'wrap', 
    marginBottom: 20 
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceElevated,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
    marginRight: 10,
    marginBottom: 5,
  },
  metaText: { 
    fontSize: theme.typography.body, 
    color: theme.colors.textSecondary, 
    marginLeft: 6 
  },
  tagsRow: { 
    flexDirection: 'row', 
    flexWrap: 'wrap', 
    marginRight: 10, 
    marginBottom: 5 
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceElevated,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 6,
    marginBottom: 4,
  },
  tagText: { 
    fontSize: theme.typography.body, 
    color: theme.colors.textPrimary, 
    marginLeft: 4 
  },
  completedItem: { 
    backgroundColor: theme.colors.surfaceHighlight 
  },
  completedText: { 
    color: theme.colors.accentSuccess 
  },
  
  section: { 
    marginBottom: 20 
  },
  sectionTitle: { 
    fontSize: theme.typography.body, 
    fontWeight: '600', 
    color: theme.colors.textSecondary, 
    marginBottom: 8, 
    textTransform: 'uppercase' 
  },
  description: { 
    fontSize: theme.typography.body, 
    color: theme.colors.textPrimary, 
    lineHeight: 22 
  },
  
  // Subtasks in detail
  subtaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  subtaskText: {
    fontSize: theme.typography.body,
    color: theme.colors.textPrimary,
    marginLeft: 8,
  },
  subtaskCompleted: {
    textDecorationLine: 'line-through',
    color: theme.colors.textMuted,
  },
  
  pomodoroBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 10,
    marginTop: 20,
    backgroundColor: theme.colors.surfaceElevated,
    borderWidth: 1,
    // accentPrimary is a web-only token (undefined on mobile); accentInfo is the
    // valid blue accent here.
    borderColor: theme.colors.accentInfo || theme.colors.border,
  },
  pomodoroText: {
    color: theme.colors.textPrimary,
    fontWeight: '600',
    marginLeft: 8,
  },
  claudeQueueBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 10,
    marginTop: 20,
    backgroundColor: theme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: theme.colors.accentPrimary || theme.colors.border,
  },
  claudeQueueText: {
    color: theme.colors.textPrimary,
    fontWeight: '600',
    marginLeft: 8,
  },
  actions: {
    flexDirection: 'row',
    marginTop: 20,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border
  },
  actionBtn: { 
    flex: 1, 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'center', 
    padding: 12, 
    borderRadius: 10, 
    marginHorizontal: 5,
    backgroundColor: theme.colors.surfaceElevated,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
  },
  editBtn: { 
    backgroundColor: theme.colors.surfaceElevated 
  },
  completeBtn: { 
    backgroundColor: theme.colors.surfaceElevated 
  },
  uncompleteBtn: { 
    backgroundColor: theme.colors.surfaceHighlight 
  },
  deleteBtn: { 
    backgroundColor: theme.colors.surfaceElevated 
  },
  actionText: { 
    color: theme.colors.textPrimary, 
    fontWeight: '600', 
    marginLeft: 8 
  },
});
