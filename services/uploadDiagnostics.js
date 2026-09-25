/**
 * uploadDiagnostics — the upload pipeline's error logger.
 *
 * Every anomaly the vault uploader can detect but not fully explain on the
 * phone (a task whose completion never came back after a suspension, a
 * watchdog trip, an item re-queued or failed) is logged to the console AND
 * filed as a feedback to-do in the Notes tab — the same shape the gesture
 * probe files (tags Turtle App / Mobile app), so the fixes can be scheduled
 * from the notes later with the facts attached, instead of from memory.
 *
 * Deduped and capped, so a bad night can't spam the notes: ONE report per
 * anomaly kind per item per batch for the life of the JS session — the FIRST
 * occurrence is filed with its details; later ones only bump a counter in the
 * console. A kind that carries its attempt number (`watchdog-transfer-attempt-2`)
 * dedupes on the kind WITHOUT it: the 184 MB thesis filed three tasks for one
 * stall, one per attempt, and the pond ended up with 36 tasks describing three
 * defects. The attempt still reaches the console line and the details.
 */
const FEEDBACK_TAGS = ['Turtle App', 'Mobile app', 'bug', 'uploads'];
const MAX_NOTES_PER_SESSION = 6;

const filed = new Map(); // dedupe key → count
let notesFiled = 0;

/** `<kind minus its attempt suffix>|<item>|<batch>` — what "the same report" means. */
export function dedupeKeyOf(kind, details = {}, ctx = {}) {
  const base = String(kind || '').replace(/-attempt-\d+$/, '');
  const item = details?.item != null ? String(details.item) : '';
  const batch = ctx?.batch != null ? String(ctx.batch) : (details?.batch != null ? String(details.batch) : '');
  return `${base}|${item}|${batch}`;
}

function buildDescription(kind, details, ctx) {
  const lines = [
    `Upload pipeline anomaly: ${kind}`,
    `When: ${new Date().toISOString()}`,
    ...(ctx?.batch && details?.batch == null ? [`Batch: ${ctx.batch}`] : []),
    '',
    'Details:',
    ...Object.entries(details || {}).map(([k, v]) => `  ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`),
    '',
    'Where to look: mobile-app/context/VaultUploadContext.jsx (pool + reconcile), services/streamMultipartUpload.js (watchdog),',
    'docs/superpowers/plans/2026-09-09-background-uploads.md (phase 1 limits: JS sleeps while backgrounded).',
  ];
  return lines.join('\n');
}

/**
 * Log an anomaly. `ctx` = { getBaseUrl, token, batch } — the pond and the
 * session to file the note under (missing either → console only), and the
 * batch the item belongs to, which scopes the dedupe.
 */
export function reportUploadIssue(kind, details = {}, ctx = {}) {
  const key = dedupeKeyOf(kind, details, ctx);
  const count = (filed.get(key) || 0) + 1;
  filed.set(key, count);
  const summary = `[VaultUpload] ⚠ ${kind}${count > 1 ? ` (×${count})` : ''} ${JSON.stringify(details)}`;
  console.warn(summary);
  if (count > 1 || notesFiled >= MAX_NOTES_PER_SESSION) return Promise.resolve(false);
  notesFiled += 1;

  const base = typeof ctx.getBaseUrl === 'function' ? ctx.getBaseUrl() : ctx.baseUrl;
  if (!base) return Promise.resolve(false);
  const endpoint = base.endsWith('/api') ? `${base}/turtle/note` : `${base}/api/turtle/note`;
  const title = `Mobile feedback: uploads — ${kind}`;
  return fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(ctx.token ? { Authorization: `Bearer ${ctx.token}` } : {}) },
    body: JSON.stringify({
      // Both field names on purpose (older handlers read `note`).
      note: title,
      content: title,
      description: buildDescription(kind, details, ctx),
      type: 'todo',
      done: false,
      tags: FEEDBACK_TAGS,
    }),
  })
    .then((r) => r.json())
    .then((res) => !!(res && res.success !== false && res.noteId))
    .catch(() => false);
}

/** Test hook. */
export function _resetUploadDiagnostics() {
  filed.clear();
  notesFiled = 0;
}
