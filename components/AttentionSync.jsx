/**
 * AttentionSync — keeps the Profile tab's dot honest, from outside the tab.
 *
 * Renders nothing. It lives at the app root for the same reason the message
 * and focus listeners do: the tab navigator is lazy, so anything mounted
 * inside the Profile tab does not exist until that tab is first opened — and
 * a dot whose whole job is to say "there is something on Profile" cannot wait
 * for Profile to be opened to find out.
 *
 * Two counts, two reads (see utils/attention for the third source, the app
 * update, which services/launchUpdate writes):
 *
 *   GET /messages        unread direct messages, counted off the same rows
 *                        the Messages page draws
 *   GET /notifications   unread task notifications (`unread`)
 *
 * Asked again whenever something could have changed them — never just once:
 * on sign-in and reconnect (the callback keys on both), on the socket's
 * content-free message ping, on a task change (a comment is one; debounced,
 * because your own edits are too), and on coming back to the foreground.
 * A failed read leaves the last good number alone.
 */
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useServer } from '../context/ServerContext';
import { useAuth } from '../context/AuthContext';
import { useSyncSignals } from '../context/DownloadsContext';
import { threadRows, unreadCount } from '../utils/messageThreads';
import { registerAttentionRefresh, setAttention } from '../utils/attention';

/** A burst of task changes (your own edits included) is one re-read. */
export const TASK_PING_DEBOUNCE_MS = 1500;

export default function AttentionSync() {
  const { api, isConnected } = useServer();
  const { isAuthenticated } = useAuth();
  const { messagesVersion, tasksVersion } = useSyncSignals();
  const ready = !!isAuthenticated && !!isConnected;

  const readMessages = useCallback(async () => {
    if (!ready) return;
    try {
      const res = await api.get('/messages');
      setAttention({ messages: unreadCount(threadRows(res, null)) });
    } catch {
      // Decoration: the last good count is a better guess than zero.
    }
  }, [api, ready]);

  const readNotifications = useCallback(async () => {
    if (!ready) return;
    try {
      const res = await api.get('/notifications');
      if (res && res.success !== false) setAttention({ notifications: Number(res.unread) || 0 });
    } catch {
      // As above.
    }
  }, [api, ready]);

  const refresh = useCallback(() => {
    readMessages();
    readNotifications();
  }, [readMessages, readNotifications]);

  // Signed out: nothing is waiting for nobody.
  useEffect(() => {
    if (!isAuthenticated) setAttention({ messages: 0, notifications: 0 });
  }, [isAuthenticated]);

  // Sign-in, reconnect, and every message ping.
  useEffect(() => { refresh(); }, [refresh, messagesVersion]);

  // A task changed. Skips the mount (the effect above already asked).
  const firstTaskPing = useRef(true);
  useEffect(() => {
    if (firstTaskPing.current) { firstTaskPing.current = false; return undefined; }
    const id = setTimeout(readNotifications, TASK_PING_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [tasksVersion, readNotifications]);

  // Back in the foreground: a push may have arrived while the socket slept.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') refresh(); });
    return () => sub?.remove?.();
  }, [refresh]);

  // Whoever changes a count themselves (the Notifications page marking
  // everything read) can ask for the truth afterwards.
  useEffect(() => registerAttentionRefresh(refresh), [refresh]);

  return null;
}
