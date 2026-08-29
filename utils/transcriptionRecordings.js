/**
 * The recordings list: every audio this phone has sent for transcription, and
 * what became of it.
 *
 * Pure list arithmetic, no storage and no react-native — `services/transcriptionStore`
 * puts these on disk and the panel renders them.
 *
 * ─── What a record may contain ──────────────────────────────────────────────
 *
 * The job id and a local display name, per the frontend contract, plus the last
 * status seen so a returning app can render the list before the first poll
 * answers. Explicitly NOT stored: the bearer token (the contract forbids it),
 * the source file's bytes or path (the server has the audio; a stale
 * `file://` from a previous launch is a broken promise), and the transcript
 * itself (it lives on the pond, is fetched on open, and can be large).
 *
 * ─── Why rows keep a local `key` as well as an `id` ─────────────────────────
 *
 * A row exists from the moment the upload starts, which is before the server
 * has issued an id — and that row must be cancellable, which is the acceptance
 * test that says cancelling mid-upload leaves no running state. So identity is
 * local and permanent (`key`), and `id` is a field that arrives later.
 */
import { isTerminal, UPLOADING } from './transcriptionProgress';

/**
 * Cap on the list. Old rows are dropped oldest-first: the pond retains
 * artifacts for its own window and a phone holding a thousand ids, most of
 * which 404, is a list of tombstones rather than a history.
 */
export const MAX_RECORDINGS = 40;

/**
 * Coerce anything read back off disk into a renderable row.
 *
 * Storage is the untrusted boundary here — a half-written JSON blob or a row
 * written by an older build must not take the panel down, so every field has a
 * type and a fallback and unknown fields are dropped rather than carried.
 */
export function normaliseRecording(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const key = String(raw.key || raw.id || '').trim();
  if (!key) return null;
  const status = String(raw.status || '') || UPLOADING;
  return {
    key,
    id: raw.id ? String(raw.id) : null,
    name: String(raw.name || 'Recording').slice(0, 120),
    status,
    uploadPercent: Number(raw.uploadPercent) || 0,
    failedAt: raw.failedAt ? String(raw.failedAt) : null,
    error: raw.error ? String(raw.error).slice(0, 300) : null,
    // A transient line under the name for a step the server has never heard of
    // — currently only "Fetching from the pond", which happens before an
    // upload and therefore before any stage exists to report.
    note: raw.note ? String(raw.note).slice(0, 80) : null,
    createdAt: Number(raw.createdAt) || 0,
    durationSeconds: Number(raw.durationSeconds) || 0,
    sizeBytes: Number(raw.sizeBytes) || 0,
    speakerCount: Number(raw.speakerCount) || 0,
    language: raw.language ? String(raw.language) : null,
  };
}

export function normaliseList(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const rows = [];
  for (const item of raw) {
    const row = normaliseRecording(item);
    if (!row || seen.has(row.key)) continue;
    seen.add(row.key);
    rows.push(row);
  }
  return rows.slice(0, MAX_RECORDINGS);
}

/**
 * The list as read back from disk on a fresh launch.
 *
 * A row persisted mid-upload can never resume: the upload lived in a process
 * that is gone, and the local file it was streaming from may be gone too. So it
 * is revived as a failure with an honest reason rather than as a spinner
 * nothing will ever move. Applied at LOAD only — a live upload is patched many
 * times a second and must not be condemned by its own progress updates.
 */
export function reviveList(raw) {
  return normaliseList(raw).map((row) => (
    row.status === UPLOADING
      ? { ...row, status: 'failed', uploadPercent: 0, error: 'Interrupted before it finished sending' }
      : row
  ));
}

/** Newest first, and never longer than the cap. */
export function addRecording(list, recording) {
  const row = normaliseRecording(recording);
  if (!row) return list;
  return [row, ...list.filter((r) => r.key !== row.key)].slice(0, MAX_RECORDINGS);
}

/**
 * Update one row in place.
 *
 * Order is preserved deliberately: a job that finishes does not jump to the
 * top. The list is a history in the order things were sent, and a row moving
 * under a thumb mid-scroll is how you delete the wrong one.
 */
export function patchRecording(list, key, patch) {
  let touched = false;
  const next = list.map((row) => {
    if (row.key !== key) return row;
    touched = true;
    return normaliseRecording({ ...row, ...patch, key: row.key });
  });
  return touched ? next : list;
}

export function removeRecording(list, key) {
  return list.filter((row) => row.key !== key);
}

/**
 * The rows a poller should still be asking about: accepted by the server (so
 * they have an id) and not yet finished. An uploading row has no id and is
 * driven by the upload's own progress callback, not by polling.
 */
export function pollableRecordings(list) {
  return list.filter((row) => row.id && row.status !== UPLOADING && !isTerminal(row.status));
}

/**
 * What the collapsed card says when it is not open.
 *
 * Anything in flight outranks everything else — that is the state someone is
 * coming back to check. Otherwise the most recent outcome, which is the other
 * reason to look.
 */
export function summariseRecordings(list) {
  if (!list.length) return null;
  const busy = list.filter((row) => !isTerminal(row.status));
  if (busy.length === 1) return { tone: 'busy', text: `${busy[0].name} · in progress` };
  if (busy.length > 1) return { tone: 'busy', text: `${busy.length} recordings in progress` };
  const failed = list.filter((row) => row.status === 'failed').length;
  const done = list.filter((row) => row.status === 'completed').length;
  if (failed && !done) return { tone: 'bad', text: `${failed} failed` };
  return {
    tone: failed ? 'bad' : 'done',
    text: `${done} transcribed${failed ? ` · ${failed} failed` : ''}`,
  };
}
