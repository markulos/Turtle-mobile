/**
 * notificationRows — GET /api/notifications, as rows the list can draw.
 *
 * The server sends the caller's task notifications newest first, with the
 * actor, the task and the comment already joined in:
 *
 *   { success, unread, notifications: [{ id, taskId, commentId, type,
 *     actorId, actorName, actorAvatarUrl, taskTitle, taskItemType,
 *     taskExists, preview, createdAt, readAt }] }
 *
 * Today the only `type` is 'comment' (someone commented on your task, or on
 * one you have commented on). An unknown type still gets a sentence rather
 * than being dropped — a row you cannot explain is better than a count that
 * does not match the list under it.
 *
 * Pure: no React, no network. The page and the tests both read it.
 */

const text = (v) => (typeof v === 'string' ? v.trim() : '');

/** What happened, as the row's headline. */
export function notificationLine(row) {
  const who = row.actor || 'Someone';
  const thing = row.itemType === 'event' ? 'event' : 'task';
  if (row.kind === 'comment') return `${who} commented on your ${thing}`;
  if (row.kind === 'mention') return `${who} mentioned you`;
  return `${who} updated a ${thing}`;
}

export function notificationRows(payload) {
  const list = payload && Array.isArray(payload.notifications) ? payload.notifications : [];
  return list
    .filter((n) => n && n.id != null)
    .map((n) => ({
      id: String(n.id),
      kind: text(n.type) || 'comment',
      taskId: n.taskId != null ? String(n.taskId) : null,
      // A deleted task comes back as '(deleted)' with taskExists false.
      taskExists: n.taskExists !== false && n.taskId != null,
      title: text(n.taskTitle) || 'Untitled',
      itemType: text(n.taskItemType) || 'task',
      actorId: n.actorId != null ? String(n.actorId) : '',
      actor: text(n.actorName),
      avatarUrl: n.actorAvatarUrl || null,
      preview: text(n.preview),
      at: Number(n.createdAt) || 0,
      unread: !n.readAt,
    }));
}

/** How many of these have not been seen. */
export function unreadNotifications(rows) {
  return (rows || []).reduce((n, r) => n + (r && r.unread ? 1 : 0), 0);
}

/** "2 new" for the card's subtitle, or the resting line when there are none. */
export function notificationsLabel(n, { idle = 'Comments on your tasks' } = {}) {
  const count = Number.isFinite(Number(n)) && Number(n) > 0 ? Math.floor(Number(n)) : 0;
  return count > 0 ? `${count} new` : idle;
}
