/**
 * Where a task captured from the Inbox tab actually lands.
 *
 * The point of an inbox is that you do not have to decide anything to use it:
 * you type the thing and it is safe. So the destination is not a question the
 * capture field asks — it is a rule, and this is the rule.
 *
 * ─── Their inbox, if they have one ─────────────────────────────────────────
 *
 * "Unsorted" is the classic answer: a task with no board at all, which the
 * Planner already lists as "No Board". But a pond that has made an actual board
 * called Inbox has ALREADY answered the question, and capturing into "no board"
 * next to a board literally named Inbox would be two inboxes — the exact
 * confusion the tab is meant to remove. So a real board wins, matched
 * case-insensitively because nobody should have to remember whether they typed
 * "inbox" or "Inbox".
 *
 * Nothing is ever CREATED here. A capture field that silently makes a board the
 * first time you use it is a capture field that changes your board list behind
 * your back; with no Inbox board, "no board" is a perfectly good home and the
 * Planner already shows it.
 */

/** The board name to capture into — '' meaning no board at all. */
export function inboxDestination(projects) {
  for (const p of Array.isArray(projects) ? projects : []) {
    if (typeof p === 'string' && p.trim().toLowerCase() === 'inbox') return p;
  }
  return '';
}

/**
 * What the capture field says it will do with what you type.
 *
 * It names the destination rather than saying "Add task", because the one thing
 * a first-time user needs to know about an inbox is where the thing GOES — and
 * "Unsorted" is a truer word for a boardless task than "No Board", which reads
 * like an error rather than a state.
 */
export function inboxDestinationLabel(projects) {
  const board = inboxDestination(projects);
  return board || 'Unsorted';
}

/**
 * The task a captured line becomes.
 *
 * Deliberately the emptiest possible task: a title, a home, and nothing else.
 * No date, no priority beyond the default, no tags. Everything a task might
 * need can be added later from the task itself, and asking for any of it at
 * capture time is what makes people stop capturing.
 *
 * Returns null for a blank line, so the caller never has to guard — an empty
 * field submitted by an accidental Return must not create an untitled task.
 */
export function inboxTaskFrom(title, projects, now = Date.now()) {
  const clean = String(title || '').trim();
  if (!clean) return null;
  return {
    id: String(now),
    title: clean,
    description: '',
    priority: 'medium',
    completed: false,
    project: inboxDestination(projects),
    dueDate: '',
    tags: [],
    subtasks: [],
    createdAt: now,
  };
}

/**
 * What is IN the inbox right now — the list the capture field is building.
 *
 * Open work only, and only where the capture field puts things: showing a
 * board's finished tasks under a box you are using to add new ones turns a
 * working list into an archive. Newest first, because the thing you just typed
 * is the thing you are looking at.
 *
 * `limit` caps what is DRAWN, not what exists. The full board is one tap away
 * on its own page; a list that grows without bound under a capture field pushes
 * everything else off the screen the moment you use it properly.
 */
export function inboxTasks(tasks, projects, { limit = 12, now = Date.now() } = {}) {
  const home = inboxDestination(projects);
  const out = [];
  for (const t of Array.isArray(tasks) ? tasks : []) {
    if (!t || !t.id) continue;
    if (t.completed || t.completedAt) continue;
    // '' is the boardless case, and `!t.project` is how a task says it.
    const belongs = home ? t.project === home : !t.project;
    if (!belongs) continue;
    out.push(t);
  }
  out.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
  return { items: out.slice(0, limit), total: out.length, now };
}
