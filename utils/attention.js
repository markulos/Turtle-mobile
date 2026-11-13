/**
 * attention — what the dot on the Profile tab lights for.
 *
 * Three sources, one store:
 *   • messages       unread direct messages (GET /messages, counted off the
 *                    same rows the Messages page draws — utils/messageThreads)
 *   • notifications  unread task notifications: comments on your tasks and on
 *                    tasks you have commented on (GET /notifications)
 *   • update         'none' | 'available' | 'ready' — a newer app update is
 *                    published / already downloaded and applies on next launch
 *                    (services/launchUpdate)
 *
 * A module store rather than a context: the writers are a renderless sync
 * component, the launch update check and the Profile screen, and the readers
 * are a tab icon and a few cards. None of them share a parent below the
 * providers, and a context value change would re-render the navigator.
 * `useSyncExternalStore` re-renders only the readers.
 *
 * The counts are decoration. Nothing here may throw into a render, and a
 * failed refresh leaves the last good value in place rather than zeroing it.
 */
import { useSyncExternalStore } from 'react';

export const UPDATE_STATES = ['none', 'available', 'ready'];

const INITIAL = Object.freeze({ messages: 0, notifications: 0, update: 'none' });

let state = INITIAL;
const listeners = new Set();

const count = (n) => (Number.isFinite(Number(n)) && Number(n) > 0 ? Math.floor(Number(n)) : 0);

export function getAttention() {
  return state;
}

/** Merge a partial update. Unchanged values notify nobody. */
export function setAttention(patch) {
  if (!patch) return;
  const next = { ...state };
  if ('messages' in patch) next.messages = count(patch.messages);
  if ('notifications' in patch) next.notifications = count(patch.notifications);
  if ('update' in patch && UPDATE_STATES.includes(patch.update)) {
    // A downloaded update stays downloaded for the rest of this run: a later
    // check that finds "nothing newer than what is pending" must not hide it.
    next.update = state.update === 'ready' && patch.update !== 'ready' ? 'ready' : patch.update;
  }
  if (next.messages === state.messages && next.notifications === state.notifications && next.update === state.update) return;
  state = next;
  listeners.forEach((fn) => fn());
}

export function subscribeAttention(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useAttention() {
  return useSyncExternalStore(subscribeAttention, getAttention, getAttention);
}

export function hasAttention(s) {
  return !!s && (s.messages > 0 || s.notifications > 0 || s.update !== 'none');
}

/**
 * What the dot means, for a screen reader: "2 unread messages, 1 new
 * notification, an app update". Empty when there is nothing.
 */
export function attentionSummary(s) {
  if (!hasAttention(s)) return '';
  const parts = [];
  if (s.messages > 0) parts.push(`${s.messages} unread message${s.messages === 1 ? '' : 's'}`);
  if (s.notifications > 0) parts.push(`${s.notifications} new notification${s.notifications === 1 ? '' : 's'}`);
  if (s.update === 'ready') parts.push('an app update ready');
  else if (s.update === 'available') parts.push('an app update');
  return parts.join(', ');
}

/**
 * Something the Profile screen can ask for after it changes a count itself
 * (marking notifications read): the sync component registers how to refetch.
 */
let refresher = null;
export function registerAttentionRefresh(fn) {
  refresher = fn;
  return () => { if (refresher === fn) refresher = null; };
}
export function requestAttentionRefresh() {
  try { refresher?.(); } catch { /* decoration */ }
}

/** Tests only. */
export function __resetAttention() {
  state = INITIAL;
  listeners.clear();
  refresher = null;
}
