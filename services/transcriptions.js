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

  // Only send options the caller actually chose. Every field has a server-side
  // default (see the capabilities response), and echoing a default back is how
  // a client's stale idea of one silently overrides the server's current one.
  const parameters = {};
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined || value === null || value === '') continue;
    parameters[key] = String(value);
  }

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
