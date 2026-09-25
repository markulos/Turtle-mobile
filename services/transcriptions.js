/**
 * The one transcription API client, per the contract in the server's
 * `docs/WHISPERX-FRONTEND-PLAN.md`.
 *
 * Every feature surface goes through this and nothing talks to
 * `/api/transcriptions` directly, so the rules that are easy to get wrong live
 * in exactly one place: the JWT is attached by `api` (ServerContext's
 * interceptor), a foreign or missing job is a `404` rather than an error state
 * to invent, and retryable `429`/`503` is distinguished from everything else.
 *
 * ─── Why submit does not auto-retry ─────────────────────────────────────────
 *
 * `streamMultipartUpload` retries 5xx/408/429 by default, which is right for a
 * photo import — the vault dedupes and a repeat costs nothing. It is WRONG
 * here. The plan's acceptance test says a retry must not duplicate a successful
 * submission, and the dangerous case is a request the server ACCEPTED whose
 * response we never saw: retrying then queues a second GPU job for the same
 * audio, and one at a time is the documented concurrency. So submission is
 * single-attempt and a failure is handed to the user as an explicit Retry —
 * a button press cannot be mistaken for a lost response.
 *
 * Bearer tokens are never persisted in job records (the plan is explicit);
 * the token is read per-call and passed to the uploader for that one request.
 */
import { streamMultipartUpload } from './streamMultipartUpload';

/** The API base is mounted at '/api', which `api.get` already prefixes. */
const ROOT = '/transcriptions';

/**
 * Pull an HTTP status out of whatever the api layer threw. The interceptor
 * stringifies failures rather than throwing typed errors, so this reads the
 * code back out of the message — the same shape ServerStatsPanel matches on.
 */
export function statusOfError(error) {
  const message = String(error?.message || error || '');
  const explicit = Number(error?.status);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const match = /\b(\d{3})\b/.exec(message);
  return match ? Number(match[1]) : 0;
}

/**
 * What this pond can actually do. Drives the option controls AND the empty
 * state: `runtime.pythonAvailable` false means the worker was never installed
 * here, which is a sentence to show the owner, not an error to swallow.
 */
export async function getCapabilities(api) {
  return api.get(`${ROOT}/capabilities`);
}

/**
 * The newer routes, as the pond declares them on `/capabilities`:
 *
 *   mediaSubmit — POST accepts `{ mediaId }` and transcribes the pond's own
 *                 copy, so a vault track needs no download-and-re-upload.
 *   list        — GET / lists the caller's jobs (the vault learns which
 *                 tracks already have a transcript from one request).
 *   words       — each turn of a result carries aligned `words`, which is
 *                 what word-level playback sync needs.
 *
 * Only a literal `true` counts. An older pond publishes no `features` at all
 * and every flag comes back false, which is exactly the fallback: upload
 * only, the local job list, turn-level sync. Works on the raw response and
 * on the normalised shape `readCapabilities` returns, which carries
 * `features` through untouched.
 */
export function capabilityFeatures(caps) {
  const flags = caps?.features;
  const on = (key) => !!(flags && typeof flags === 'object' && flags[key] === true);
  return { mediaSubmit: on('mediaSubmit'), list: on('list'), words: on('words') };
}

/**
 * Only the options the caller actually chose, as strings.
 *
 * Every field has a server-side default (see the capabilities response), and
 * echoing a default back is how a client's stale idea of one silently
 * overrides the server's current one — so empties are dropped. Values go as
 * STRINGS in the JSON body too, not just the multipart one: multipart fields
 * can only ever be strings, so that is the shape the route's validators are
 * proven against, and one shape for both modes means one validation path.
 */
export function cleanOptions(options = {}) {
  const parameters = {};
  for (const [key, value] of Object.entries(options || {})) {
    if (value === undefined || value === null || value === '') continue;
    parameters[key] = String(value);
  }
  return parameters;
}

/**
 * Send one local file for transcription.
 *
 * `fileUri` is a local content URI — the file is STREAMED from it by the
 * uploader rather than read into JS memory, which the plan requires and which
 * is the difference between a 300 MB recording working and the app dying.
 *
 * Resolves to the server's `{ id, status }`. `onProgress` receives 0..100 for
 * the byte transfer only; everything after acceptance is polled.
 */
export async function submitTranscription({
  baseUrl,
  token,
  fileUri,
  mimeType,
  name,
  options = {},
  onProgress,
  signal,
}) {
  if (!baseUrl) throw new Error('Not connected to a pond');
  if (!fileUri) throw new Error('No file to send');

  const parameters = cleanOptions(options);

  const result = await streamMultipartUpload({
    url: `${String(baseUrl).replace(/\/$/, '')}/api/transcriptions`,
    fileUri,
    mimeType: mimeType || 'audio/mpeg',
    fieldName: 'file',      // the route reads upload.single('file'), not 'media'
    parameters,
    token,
    label: name || 'recording',
    onProgress,
    signal,
    maxAttempts: 1,         // see the header: a duplicate GPU job is the worse failure
  });

  let body;
  try {
    body = JSON.parse(result?.body || '{}');
  } catch {
    throw new Error('The pond returned something unreadable');
  }
  if (!body?.id) throw new Error(body?.error || 'The pond did not accept the recording');
  return body;
}

/**
 * Transcribe a recording the pond already holds, by its vault media id.
 *
 * A plain JSON POST through `api.post` (the JWT interceptor attaches the
 * token): the bytes never leave the pond, so there is no upload to stream, no
 * progress to report and nothing to cancel — acceptance is the whole request.
 * Resolves to `{ id, status, mediaId }`; a job already running for the same
 * recording comes back as that job with `existing: true` rather than a
 * second one, which is the server's dedupe and needs nothing from us.
 *
 * Single-attempt for the same reason `submitTranscription` is: a retry after
 * an accepted-but-unanswered request would queue the GPU twice.
 */
export async function submitMediaTranscription(api, { mediaId, options = {} } = {}) {
  if (mediaId === undefined || mediaId === null || String(mediaId).trim() === '') {
    throw new Error('No recording to transcribe');
  }
  const body = await api.post(ROOT, { mediaId: String(mediaId), ...cleanOptions(options) });
  if (!body?.id) throw new Error(body?.error || 'The pond did not accept the recording');
  return body;
}

/**
 * The caller's jobs, newest first. `mediaId` narrows it to one recording;
 * `limit` caps the count (the server's default is 50, its ceiling 200).
 * Resolves to the array itself — an answer without one is an empty list, so
 * a caller can map over it without a guard.
 */
export async function listJobs(api, { mediaId, limit } = {}) {
  const query = [];
  if (mediaId !== undefined && mediaId !== null && String(mediaId) !== '') {
    query.push(`mediaId=${encodeURIComponent(String(mediaId))}`);
  }
  if (Number(limit) > 0) query.push(`limit=${Math.floor(Number(limit))}`);
  const response = await api.get(`${ROOT}${query.length ? `?${query.join('&')}` : ''}`);
  return Array.isArray(response?.jobs) ? response.jobs : [];
}

/**
 * The server's sanitized rejection, in the words of someone who just pressed
 * a button. The uploader wraps the body in "HTTP 415: {json}" and the api
 * layer in "API Error 409: …" — both diagnostics, not sentences. Shared by
 * the Settings panel and the music reader so the two never disagree about
 * what a 409 means.
 */
export function friendlySubmitError(error) {
  const status = statusOfError(error);
  const known = {
    404: 'The pond cannot find that recording',
    409: 'This recording has no copy on the pond to transcribe',
    413: 'That file is bigger than this pond accepts',
    415: 'The pond cannot read that file, or it has no audio in it',
    422: 'That recording is longer than this pond allows',
    429: 'Too many transcriptions on the go — try again shortly',
    503: 'The pond’s transcription worker is busy or offline',
  };
  return known[status] || 'The pond would not accept that recording';
}

/** Poll one job. A 404 means it is gone — callers stop rather than retry. */
export async function getJob(api, id) {
  return api.get(`${ROOT}/${encodeURIComponent(id)}`);
}

/** The structured transcript, once the job is `completed`. */
export async function getResult(api, id) {
  return api.get(`${ROOT}/${encodeURIComponent(id)}/result`);
}

/**
 * The authenticated plain-text artifact URL.
 *
 * Returned as a URL rather than fetched, because the caller hands it to a
 * download/share sheet that must carry the Authorization header itself — this
 * endpoint is not public and a bare link would 401.
 */
export function downloadTextUrl(baseUrl, id) {
  return `${String(baseUrl).replace(/\/$/, '')}/api/transcriptions/${encodeURIComponent(id)}/download?format=txt`;
}

/**
 * Cancel a running job or delete a finished one — the server picks which based
 * on the job's own state, so the client does not have to race it.
 */
export async function cancelOrDelete(api, id) {
  return api.delete(`${ROOT}/${encodeURIComponent(id)}`);
}
