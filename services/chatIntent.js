/**
 * "Open the conversation with this person" — a request that crosses the app.
 *
 * It is raised by a notification handler, which has no component and no props,
 * and answered by ProfileScreen, which owns the thread. Those two cannot be
 * wired to each other directly: the tab navigator is LAZY, so on a cold start
 * ProfileScreen does not exist at the moment the tap is handled, and anything
 * passed down the tree would be passed to nothing.
 *
 * ── Deliver, or park ───────────────────────────────────────────────────────
 *
 * If somebody is listening, the request is handed over and kept nowhere. If
 * nobody is — the usual case from a killed app — it waits in one slot until the
 * screen mounts and takes it.
 *
 * Taking it CLEARS it, and that is the point. A request left lying around is
 * one that re-opens the same conversation every time the Profile tab is next
 * visited, which reads as an app that will not let you leave a thread.
 *
 * One slot rather than a queue: two taps mean the user wants the second one.
 */

/** The request nobody was around to take, or null. */
let parked = null;

const listeners = new Set();

/** Ask for a conversation with a pond member, by user id. */
export function requestChat(userId) {
  const id = String(userId || '').trim();
  if (!id) return;
  if (listeners.size === 0) {
    parked = id;
    return;
  }
  // Somebody is home: hand it over rather than parking it, so nothing is left
  // to fire a second time.
  parked = null;
  for (const fn of [...listeners]) {
    // One bad listener must not stop the others, and must not take the app
    // down from inside a notification handler.
    try { fn(id); } catch { /* a screen that failed to open is not fatal */ }
  }
}

/** Listen for requests made while mounted. Returns the unsubscribe. */
export function subscribeChatIntent(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** The request made before anyone was listening — read once, then gone. */
export function takePendingChat() {
  const id = parked;
  parked = null;
  return id;
}

/** Tests only — module state outlives a test file. */
export function __resetChatIntent() {
  parked = null;
  listeners.clear();
}
