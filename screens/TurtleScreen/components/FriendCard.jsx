import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  ScrollView,
  Modal,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../context/ThemeContext';
import { formatDueDate } from '../../TasksScreen/utils/taskHelpers';

// "3:45 PM" from "HH:MM" (24h); '' when unset.
const fmtTime12 = (t) => {
  if (!t || !/^\d{1,2}:\d{2}/.test(t)) return '';
  const [h, m] = t.split(':').map(Number);
  const pm = h >= 12;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${pm ? 'PM' : 'AM'}`;
};

/**
 * FriendCard — a tappable profile card for a pond member (org "friend").
 *
 * Shows the member's avatar, name, phone, role, and sign-in status, plus a
 * STATS section that is deliberately scaffolded for the future: it renders
 * whatever `friend.stats` carries and falls back to "—" placeholders. So the
 * later phase (points from tasks created/completed + pomodoros) only has to
 * populate `friend.stats` server-side — no change to this card needed.
 *
 * Kept as its own component (not inlined into the already-huge TurtleScreen
 * index) so the profile surface can grow independently.
 *
 * Props:
 *   friend     — friend object from /api/friends, or null/undefined = hidden.
 *                { id, phone, displayName, avatarUrl, role, joined, stats? }
 *   serverBase — server origin (no trailing /api) used to resolve a
 *                server-relative avatarUrl into a full URL.
 *   onClose()  — dismiss the card.
 *   onShare(f) — optional; open the project-share flow for this member.
 *   isOwner      — true when the VIEWER is the pond owner (unlocks dev-account
 *                  controls). Distinct from this member's own role.
 *   isDevAccount — true when this member's phone is already a developer account.
 *   devCode      — the fixed sign-in code dev accounts use (display only).
 *   onAssignDev(phone) — make this phone a developer account; returns a promise.
 *   onRemoveDev(phone) — revoke developer access for this phone.
 */
export default function FriendCard({
  friend,
  serverBase,
  onClose,
  onShare,
  tasks = [],
  isOwner = false,
  isDevAccount = false,
  devCode = '11111',
  onAssignDev,
  onRemoveDev,
}) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(theme);
  const [devBusy, setDevBusy] = useState(false);

  // This member's tasks (passed by the calendar). Pending first, each list in
  // soonest-date order, so the card reads like a quick agenda for that person.
  const byDate = (a, b) => String(a.dueDate || '~').localeCompare(String(b.dueDate || '~')) || String(a.time || '~').localeCompare(String(b.time || '~'));
  const pendingTasks = tasks.filter((t) => !t.completed).sort(byDate);
  const doneTasks = tasks.filter((t) => t.completed).sort(byDate);
  const orderedTasks = [...pendingTasks, ...doneTasks].slice(0, 12);

  const friendIsOwner = friend?.role === 'owner';
  const name = friend?.displayName || friend?.phone || 'Member';
  // Invited-on date for pending invitees (defensive against ms/ISO/garbage).
  const invitedOn = friend?.invitedAt ? new Date(friend.invitedAt) : null;
  const invitedStr = invitedOn && !isNaN(invitedOn.getTime()) ? invitedOn.toLocaleDateString() : null;
  // Whether to offer developer-account controls: viewer is owner, this isn't the
  // owner's own card, and we have a phone to key the account on.
  const canManageDev = isOwner && !friendIsOwner && !!friend?.phone;
  // A server-relative avatar ('/api/avatars/…') needs the origin prepended;
  // an absolute URL is used as-is. Null → fall back to the role glyph.
  const avatarUri = friend?.avatarUrl
    ? (friend.avatarUrl.startsWith('/') ? `${serverBase}${friend.avatarUrl}` : friend.avatarUrl)
    : null;

  // Future-ready stats. When the server starts attaching `friend.stats`
  // (e.g. { points, tasksCompleted, pomodoros }) these light up automatically;
  // until then each tile shows a placeholder.
  const stats = friend?.stats || {};
  const statTiles = [
    { key: 'points', label: 'Points', icon: 'star-four-points-outline', value: stats.points },
    // Prefer a server-supplied completed count; otherwise derive it from the
    // tasks we were handed so the tile isn't an empty "—" when we know it.
    { key: 'tasks', label: 'Tasks done', icon: 'checkbox-marked-circle-outline', value: typeof stats.tasksCompleted === 'number' ? stats.tasksCompleted : (tasks.length ? doneTasks.length : undefined) },
    { key: 'pomodoros', label: 'Pomodoros', icon: 'timer-outline', value: stats.pomodoros },
  ];

  return (
    // Transparent / over-full-screen so it reliably presents OVER the Friends
    // pageSheet modal. Stacking a second native pageSheet on top of another
    // doesn't show on iOS — a transparent modal drawn as our own bottom sheet
    // does. Tap the dimmed area or the X to dismiss.
    <Modal
      visible={!!friend}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close profile" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={styles.closeBtn}
              accessibilityLabel="Close profile"
            >
              <Icon name="close" size={22} color={theme.colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.body}>
          {/* Avatar */}
          <View style={styles.avatarWrap}>
            {avatarUri ? (
              <Image
                source={{ uri: avatarUri }}
                style={styles.avatarImg}
                contentFit="cover"
                transition={150}
              />
            ) : (
              <Icon
                name={friendIsOwner ? 'crown-outline' : 'account'}
                size={52}
                color={friendIsOwner ? '#f5a623' : theme.colors.textSecondary}
              />
            )}
          </View>

          {/* Name + role badge */}
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          <View style={styles.roleBadge}>
            <Icon
              name={friendIsOwner ? 'crown' : 'account-outline'}
              size={13}
              color={friendIsOwner ? '#f5a623' : theme.colors.accentInfo}
            />
            <Text style={[styles.roleText, { color: friendIsOwner ? '#f5a623' : theme.colors.accentInfo }]}>
              {friendIsOwner ? 'Owner' : 'Member'}
            </Text>
          </View>

          {/* Details — phone + invited-on + sign-in status */}
          <View style={styles.detailCard}>
            {friend?.phone ? (
              <View style={styles.detailRow}>
                <Icon name="phone-outline" size={18} color={theme.colors.textTertiary} />
                <Text style={styles.detailText} numberOfLines={1}>{friend.phone}</Text>
              </View>
            ) : null}
            {invitedStr ? (
              <View style={[styles.detailRow, friend?.phone && styles.detailRowDivided]}>
                <Icon name="email-outline" size={18} color={theme.colors.textTertiary} />
                <Text style={styles.detailText} numberOfLines={1}>Invited {invitedStr}</Text>
              </View>
            ) : null}
            <View style={[styles.detailRow, (friend?.phone || invitedStr) && styles.detailRowDivided]}>
              <Icon
                name={friend?.joined ? 'check-circle-outline' : 'clock-outline'}
                size={18}
                color={friend?.joined ? theme.colors.accentSuccess : theme.colors.textTertiary}
              />
              <Text style={styles.detailText}>
                {friend?.joined ? 'Signed in' : "Hasn't signed in yet"}
              </Text>
            </View>
            {isDevAccount ? (
              <View style={[styles.detailRow, styles.detailRowDivided]}>
                <Icon name="account-cog" size={18} color={theme.colors.accentInfo} />
                <Text style={[styles.detailText, { color: theme.colors.accentInfo }]}>
                  Developer account · signs in with code {devCode}
                </Text>
              </View>
            ) : null}
          </View>

          {/* Developer access — owner only. For someone who can't receive an SMS
              OTP, grant a developer account so they sign in with the fixed code.
              Offered for not-yet-joined invitees; a revoke option once granted. */}
          {canManageDev && (isDevAccount || !friend?.joined) ? (
            <>
              <Text style={styles.sectionLabel}>Developer access</Text>
              {isDevAccount ? (
                <TouchableOpacity
                  style={[styles.devRevokeBtn, devBusy && { opacity: 0.6 }]}
                  disabled={devBusy}
                  activeOpacity={0.85}
                  onPress={async () => {
                    if (!onRemoveDev) return;
                    setDevBusy(true);
                    try { await onRemoveDev(friend.phone); } finally { setDevBusy(false); }
                  }}
                  accessibilityLabel="Remove developer access"
                >
                  <Icon name="account-remove-outline" size={18} color={theme.colors.accentError} />
                  <Text style={[styles.devRevokeText, { color: theme.colors.accentError }]}>Remove developer access</Text>
                </TouchableOpacity>
              ) : (
                <>
                  <TouchableOpacity
                    style={[styles.devBtn, devBusy && { opacity: 0.6 }]}
                    disabled={devBusy}
                    activeOpacity={0.85}
                    onPress={async () => {
                      if (!onAssignDev) return;
                      setDevBusy(true);
                      try { await onAssignDev(friend.phone); } finally { setDevBusy(false); }
                    }}
                    accessibilityLabel="Make developer account"
                  >
                    <Icon name="account-cog-outline" size={18} color="#fff" />
                    <Text style={styles.devBtnText}>{devBusy ? 'Adding…' : 'Make developer account'}</Text>
                  </TouchableOpacity>
                  <Text style={[styles.statsHint, { alignSelf: 'flex-start', textAlign: 'left' }]}>
                    They'll sign in with code {devCode} — no SMS needed.
                  </Text>
                </>
              )}
            </>
          ) : null}

          {/* Stats — scaffold for future points (tasks + pomodoros) */}
          <Text style={styles.sectionLabel}>Stats</Text>
          <View style={styles.statsRow}>
            {statTiles.map((t) => (
              <View key={t.key} style={styles.statTile}>
                <Icon name={t.icon} size={20} color={theme.colors.accentInfo} />
                <Text style={styles.statValue}>
                  {typeof t.value === 'number' ? t.value : '—'}
                </Text>
                <Text style={styles.statLabel}>{t.label}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.statsHint}>Points from tasks &amp; pomodoros are coming soon.</Text>

          {/* Their tasks — a quick agenda for this member (pending first). Only
              shown when the caller passed a task list. */}
          {tasks.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>
                {`Tasks · ${pendingTasks.length} open / ${doneTasks.length} done`}
              </Text>
              <View style={styles.tasksCard}>
                {orderedTasks.map((t, i) => {
                  const when = [formatDueDate(t.dueDate), fmtTime12(t.time)].filter(Boolean).join(' · ');
                  return (
                    <View key={t.id || i} style={[styles.taskRow, i > 0 && styles.taskRowDivided]}>
                      <Icon
                        name={t.completed ? 'check-circle' : 'circle-outline'}
                        size={18}
                        color={t.completed ? theme.colors.accentSuccess : theme.colors.textTertiary}
                      />
                      <View style={styles.taskTextWrap}>
                        <Text style={[styles.taskTitle, t.completed && styles.taskTitleDone]} numberOfLines={1}>
                          {t.title || 'Untitled'}
                        </Text>
                        {when ? <Text style={styles.taskMeta} numberOfLines={1}>{when}</Text> : null}
                      </View>
                    </View>
                  );
                })}
                {tasks.length > orderedTasks.length && (
                  <Text style={styles.tasksMore}>{`+ ${tasks.length - orderedTasks.length} more`}</Text>
                )}
              </View>
            </>
          )}

          {/* Action — share a project with this member */}
          {onShare ? (
            <TouchableOpacity
              style={styles.shareBtn}
              activeOpacity={0.85}
              onPress={() => onShare(friend)}
              accessibilityLabel={`Share a project with ${name}`}
            >
              <Icon name="share-variant-outline" size={18} color="#fff" />
              <Text style={styles.shareBtnText}>Share a project</Text>
            </TouchableOpacity>
          ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (theme) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      justifyContent: 'flex-end',
    },
    sheet: {
      maxHeight: '92%',
      backgroundColor: theme.colors.background,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      overflow: 'hidden',
    },
    grabber: {
      alignSelf: 'center',
      width: 40,
      height: 5,
      borderRadius: 3,
      backgroundColor: theme.colors.border,
      marginTop: 8,
      marginBottom: 2,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      paddingHorizontal: 12,
      paddingBottom: 6,
    },
    closeBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    body: {
      paddingHorizontal: 20,
      paddingBottom: 40,
      alignItems: 'center',
    },
    avatarWrap: {
      width: 104,
      height: 104,
      borderRadius: 52,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.surfaceElevated,
      overflow: 'hidden',
      marginTop: 8,
      marginBottom: 14,
    },
    avatarImg: {
      width: '100%',
      height: '100%',
    },
    name: {
      fontSize: 22,
      fontWeight: '700',
      color: theme.colors.textPrimary,
      textAlign: 'center',
      maxWidth: '100%',
    },
    roleBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginTop: 6,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 12,
      backgroundColor: theme.colors.surfaceElevated,
    },
    roleText: {
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.3,
    },
    detailCard: {
      alignSelf: 'stretch',
      marginTop: 22,
      borderRadius: 14,
      backgroundColor: theme.colors.surface,
      borderWidth: 0.5,
      borderColor: theme.colors.border,
      paddingHorizontal: 14,
    },
    detailRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 13,
    },
    detailRowDivided: {
      borderTopWidth: 0.5,
      borderTopColor: theme.colors.border,
    },
    detailText: {
      fontSize: 15,
      color: theme.colors.textPrimary,
      flex: 1,
    },
    sectionLabel: {
      alignSelf: 'flex-start',
      fontSize: 12,
      fontWeight: '700',
      color: theme.colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginTop: 26,
      marginBottom: 10,
    },
    statsRow: {
      flexDirection: 'row',
      alignSelf: 'stretch',
      gap: 10,
    },
    statTile: {
      flex: 1,
      alignItems: 'center',
      gap: 4,
      paddingVertical: 16,
      borderRadius: 14,
      backgroundColor: theme.colors.surface,
      borderWidth: 0.5,
      borderColor: theme.colors.border,
    },
    statValue: {
      fontSize: 20,
      fontWeight: '700',
      color: theme.colors.textPrimary,
    },
    statLabel: {
      fontSize: 11,
      color: theme.colors.textTertiary,
      fontWeight: '600',
    },
    statsHint: {
      alignSelf: 'center',
      fontSize: 12,
      color: theme.colors.textTertiary,
      marginTop: 10,
      textAlign: 'center',
    },
    tasksCard: {
      alignSelf: 'stretch',
      borderRadius: 14,
      backgroundColor: theme.colors.surface,
      borderWidth: 0.5,
      borderColor: theme.colors.border,
      paddingHorizontal: 14,
    },
    taskRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 11,
    },
    taskRowDivided: {
      borderTopWidth: 0.5,
      borderTopColor: theme.colors.border,
    },
    taskTextWrap: {
      flex: 1,
      minWidth: 0,
    },
    taskTitle: {
      fontSize: 15,
      color: theme.colors.textPrimary,
      fontWeight: '500',
    },
    taskTitleDone: {
      textDecorationLine: 'line-through',
      color: theme.colors.textTertiary,
      fontWeight: '400',
    },
    taskMeta: {
      fontSize: 12,
      color: theme.colors.textTertiary,
      marginTop: 2,
    },
    tasksMore: {
      fontSize: 12,
      color: theme.colors.textTertiary,
      fontWeight: '600',
      paddingVertical: 10,
      borderTopWidth: 0.5,
      borderTopColor: theme.colors.border,
    },
    shareBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      alignSelf: 'stretch',
      marginTop: 28,
      paddingVertical: 14,
      borderRadius: 14,
      backgroundColor: theme.colors.primary || '#0a84ff',
    },
    shareBtnText: {
      fontSize: 15,
      fontWeight: '700',
      color: '#fff',
    },
    devBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      alignSelf: 'stretch',
      paddingVertical: 14,
      borderRadius: 14,
      backgroundColor: theme.colors.accentInfo || '#0a84ff',
    },
    devBtnText: {
      fontSize: 15,
      fontWeight: '700',
      color: '#fff',
    },
    devRevokeBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      alignSelf: 'stretch',
      paddingVertical: 13,
      borderRadius: 14,
      backgroundColor: theme.colors.surface,
      borderWidth: 0.5,
      borderColor: theme.colors.border,
    },
    devRevokeText: {
      fontSize: 15,
      fontWeight: '700',
    },
  });
