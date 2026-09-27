/**
 * Finding the task you mean, from anywhere in the Planner.
 *
 * The Planner's one search field is on the header, so it is asked the same
 * question from four different pages and has to answer it the same way each
 * time. That answer lives here, pure, so it can be tested without rendering and
 * so the Agenda, the Calendar and the Focus tab can never drift into disagreeing
 * about what "matches" means.
 *
 * ─── Indexed, because a search that stutters is a search you stop using ─────
 *
 * The naive version is `tasks.filter(t => t.title.toLowerCase().includes(q))`,
 * and it re-lowercases every title of every task on EVERY KEYSTROKE. With a few
 * hundred tasks carrying titles, boards, tags and descriptions that is thousands
 * of string allocations per letter typed, on the JS thread, while the keyboard
 * is animating.
 *
 * So the work is split by how often it changes:
 *   · `buildTaskIndex` — once per change to the task list. Lowercases each
 *     task's fields into one flat record, and precomputes the haystack that the
 *     "does every word appear at all" test runs against.
 *   · `rankTasks` — once per keystroke, over that index. No allocation per task
 *     beyond the score itself.
 *   · `buildQuery` — once per keystroke rather than once per task, which is the
 *     same reason noteSearch has one: the word-boundary regexes are the
 *     expensive part, and building them inside the loop is a few hundred RegExp
 *     compilations per letter.
 *
 * ─── The matching rule is the app's, not a new one ─────────────────────────
 *
 * AND over tokens: a task matches when EVERY word in the query appears
 * somewhere in it. Identical to noteSearch, the Notes screen and the server's
 * FTS. Two surfaces disagreeing about what matches is worse than either rule
 * being imperfect.
 *
 * Scoring encodes one idea, also noteSearch's: WHERE a word matched says more
 * than how many times it did. The query that is a task's whole title is almost
 * certainly the task you meant; the same words scattered through a description
 * usually are not.
 */

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A task is done if it says so, or if its own completion moved it there. */
const isDone = (t) => !!(t?.completed || t?.completedAt);

/**
 * Prepare a query once per keystroke instead of once per task. Shape-compatible
 * with noteSearch's, deliberately — the two are read side by side.
 */
export function buildQuery(raw) {
  const text = String(raw || '').trim().toLowerCase();
  const tokens = text.split(/\s+/).filter(Boolean);
  return {
    text,
    tokens,
    // "starts a word" — `mil` hitting "milk" is a better signal than `mil`
    // hitting "familiar", and this is what tells them apart.
    boundaries: tokens.map((t) => new RegExp(`(^|[^a-z0-9])${escapeRe(t)}`, 'i')),
  };
}

/**
 * One task, flattened and lowercased — the unit of the index.
 *
 * `hay` is every searchable field joined once. The first thing scoring does is
 * reject non-matches, and doing that against one prepared string rather than
 * four separate `includes` calls is most of the speed.
 */
export function indexTask(task) {
  const title = String(task?.title || '').toLowerCase();
  const board = String(task?.project || '').toLowerCase();
  const tags = (Array.isArray(task?.tags) ? task.tags : []).join(' ').toLowerCase();
  const body = String(task?.description || task?.notes || '').toLowerCase();
  return {
    task,
    id: task?.id,
    title,
    board,
    tags,
    body,
    done: isDone(task),
    // Sorted-by-default key: a dated task's day, as a comparable number.
    due: dueMs(task),
    hay: `${title} ${board} ${tags} ${body}`,
  };
}

/**
 * The index. Rebuild it when the task list changes, not when the query does.
 *
 * Skips nothing and caps nothing: a task the index leaves out is a task that
 * cannot be found, which is the failure this whole module exists to avoid (the
 * note picker's old 200-item ceiling is the cautionary tale).
 */
export function buildTaskIndex(tasks) {
  const out = [];
  const seen = new Set();
  for (const t of tasks || []) {
    if (!t || !t.id || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(indexTask(t));
  }
  return out;
}

/** A task's due date as a sortable number; 0 when it has none. */
function dueMs(task) {
  const raw = task?.dueDate || task?.date;
  if (!raw) return 0;
  const parsed = Date.parse(`${String(raw).slice(0, 10)}T00:00:00`);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * How well an indexed task answers the query — higher is better, null is "no
 * match at all".
 */
export function scoreTask(rec, q) {
  if (!q || q.tokens.length === 0) return 0;
  // Every token must land somewhere, or it isn't a match.
  for (const t of q.tokens) if (!rec.hay.includes(t)) return null;

  let score = 0;
  if (rec.title === q.text) score += 120;             // it IS that task
  else if (rec.title.startsWith(q.text)) score += 70; // typed the start of it
  else if (rec.title.includes(q.text)) score += 45;   // the phrase, intact
  else if (rec.board === q.text) score += 30;         // named a whole board
  else if (rec.tags.includes(q.text)) score += 25;    // a label, intact

  for (let i = 0; i < q.tokens.length; i++) {
    const t = q.tokens[i];
    if (rec.title.includes(t)) score += 12;
    if (q.boundaries[i].test(rec.title)) score += 8;
    if (rec.board.includes(t)) score += 7;
    if (rec.tags.includes(t)) score += 7;
    if (rec.body.includes(t)) score += 3;
  }

  // A short title that matched is a more precise hit than a long one carrying
  // the same words among many others. Small — it breaks ties, it doesn't lead.
  if (rec.title.length > 0) score += Math.max(0, 8 - Math.floor(rec.title.length / 20));

  // Open work outranks finished work at the same relevance. You are far more
  // often looking for something still to do — and on the Focus tab, where the
  // result is "start a block on this", a completed task is rarely the answer.
  if (!rec.done) score += 10;
  return score;
}

/**
 * The four scopes the panel offers, as predicates over an index record.
 *
 * `overdue` is deliberately "dated before today AND not done" rather than
 * "late": a finished task that was late is not something you need to find.
 */
export const TASK_SCOPES = ['all', 'todo', 'done', 'overdue'];

function inScope(rec, scope, todayMs) {
  if (scope === 'todo') return !rec.done;
  if (scope === 'done') return rec.done;
  if (scope === 'overdue') return !rec.done && rec.due > 0 && rec.due < todayMs;
  return true;
}

/** Midnight this morning, as a number — the boundary `overdue` is measured from. */
export function startOfToday(now = Date.now()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Rank an index against a query.
 *
 * WITH NO QUERY this is not empty — it is the tasks you are most likely to want:
 * the soonest dated work first, undated after it. An empty search field that
 * answers "nothing" teaches you the search is broken; one that answers "here is
 * what is next" is useful before you have typed anything, which matters most on
 * the Focus tab, where the whole errand is "pick something to work on".
 */
export function rankTasks(index, query, { limit = 50, scope = 'all', now = Date.now() } = {}) {
  const todayMs = startOfToday(now);
  const pool = [];
  for (const rec of index || []) {
    if (!rec) continue;
    if (!inScope(rec, scope, todayMs)) continue;
    pool.push(rec);
  }

  const q = buildQuery(query);
  if (q.tokens.length === 0) {
    // Dated first, soonest to latest; undated behind them, since "no date" is
    // not "far away", it is "unscheduled".
    const sorted = pool.slice().sort((a, b) => {
      if (a.due !== b.due) {
        if (a.due === 0) return 1;
        if (b.due === 0) return -1;
        return a.due - b.due;
      }
      return String(a.title).localeCompare(String(b.title));
    });
    return sorted.slice(0, limit).map((r) => r.task);
  }

  const scored = [];
  for (const rec of pool) {
    const score = scoreTask(rec, q);
    if (score === null) continue;
    scored.push({ rec, score });
  }
  // Equal relevance → the sooner one, then alphabetical, so the order is
  // total: a list that reshuffles between identical queries reads as a bug.
  scored.sort((a, b) => (
    (b.score - a.score)
    || ((a.rec.due || Infinity) - (b.rec.due || Infinity))
    || String(a.rec.title).localeCompare(String(b.rec.title))
  ));
  return scored.slice(0, limit).map((s) => s.rec.task);
}

/**
 * The second line of a result row: where the task lives and when it is due.
 *
 * Built from what is actually SET — a task with no board and no date gets a
 * short honest line rather than "No board · —", which is three characters of
 * nothing pretending to be information.
 */
export function taskSearchMeta(task, { boardLabel = (b) => b, now = Date.now() } = {}) {
  const bits = [];
  if (task?.project) bits.push(boardLabel(task.project));
  const due = dueMs(task);
  if (due > 0) {
    const days = Math.round((due - startOfToday(now)) / 86400000);
    if (days === 0) bits.push('Today');
    else if (days === 1) bits.push('Tomorrow');
    else if (days === -1) bits.push('Yesterday');
    else if (days < 0) bits.push(`${Math.abs(days)}d ago`);
    else if (days <= 6) bits.push(new Date(due).toLocaleDateString('en-US', { weekday: 'long' }));
    else bits.push(new Date(due).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
  }
  if (task?.time) bits.push(String(task.time));
  if (isDone(task)) bits.push('Done');
  return bits.join(' · ');
}
