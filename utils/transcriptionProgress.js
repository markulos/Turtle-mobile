/**
 * Reading a transcription job: what stage it is at, how far along that is, and
 * when to ask again.
 *
 * The backend is asynchronous — submitting returns `202` and a job id, and the
 * client polls (see `docs/WHISPERX.md` on the server). Everything in this file
 * is the client half of that contract, kept pure and free of react-native
 * imports so the polling arithmetic can be tested without a renderer — the same
 * rule `statsFormat`, `zoomMath` and `perfFindings` follow.
 *
 * ─── Why progress is a STEPPER, not a percentage ────────────────────────────
 *
 * The server reports a stage, never a percentage: WhisperX does not emit
 * fine-grained progress, and nothing downstream can invent one honestly. So
 * `stageFraction` is `stageIndex / stageCount` — a bar that advances in five
 * visible steps and is truthful about what is known, rather than a smooth
 * animation that would be a fabrication. A job sitting in `transcribing` for
 * four minutes genuinely has no more information than that, and a bar that
 * crept forward anyway would be lying to look busy.
 *
 * The one genuinely continuous number is the UPLOAD, which is bytes sent over
 * bytes total. That is measured elsewhere (`streamMultipartUpload`) and belongs
 * to a phase that happens BEFORE a job id exists — which is why `uploading` is
 * a client-side pseudo-stage here and not one of the server's.
 */

/**
 * The server's own stage names, in the order they happen. Mirrors `STAGES` in
 * routes/transcriptions.js — the source of truth is the server, and the client
 * ordering exists only to turn a stage into a position on a bar.
 */
export const STAGES = ['queued', 'transcribing', 'aligning', 'diarizing', 'formatting'];

/** Statuses after which nothing more will happen, and polling must stop. */
export const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'];

/**
 * A client-only phase covering "chosen, being sent, no job id yet".
 * Deliberately not in STAGES: the server has never heard of it.
 */
export const UPLOADING = 'uploading';

const LABELS = {
  [UPLOADING]: 'Uploading',
  queued: 'Waiting to start',
  transcribing: 'Transcribing',
  aligning: 'Aligning words',
  diarizing: 'Separating speakers',
  formatting: 'Formatting',
  completed: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function isTerminal(status) {
  return TERMINAL_STATUSES.includes(String(status || ''));
}

/**
 * The stage in words. An unknown status comes back capitalised rather than
 * blank — a stage this build has not heard of is still a stage, and showing
 * nothing would read as a hang.
 */
export function stageLabel(status) {
  const raw = String(status || '').trim();
  if (LABELS[raw]) return LABELS[raw];
  if (!raw) return 'Waiting';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/**
 * How far along, 0..1, for the progress bar.
 *
 * `queued` is deliberately 0 — nothing has happened yet, and a queued job that
 * showed a fifth of a bar would suggest work already done. `completed` is 1,
 * and the two other terminal states return the position they stopped at rather
 * than a full bar, because a failed job did not finish.
 */
export function stageFraction(status, { failedAt } = {}) {
  const raw = String(status || '');
  if (raw === 'completed') return 1;
  if (raw === 'failed' || raw === 'cancelled') {
    const stopped = STAGES.indexOf(String(failedAt || ''));
    return stopped > 0 ? stopped / STAGES.length : 0;
  }
  const index = STAGES.indexOf(raw);
  if (index < 0) return 0;
  return index / STAGES.length;
}

// Polling. Start responsive, decay to something a phone can hold open all day.
const POLL_BASE_MS = 2000;
const POLL_FACTOR = 1.6;
const POLL_MAX_FOREGROUND_MS = 30_000;
// Backgrounded, the answer only has to be current by the time the app is looked
// at again, and the plan asks for an immediate poll on foreground anyway — so
// this can be far lazier than politeness alone would suggest.
const POLL_MAX_BACKGROUND_MS = 120_000;

/**
 * How long to wait before polling a job again.
 *
 * Bounded exponential backoff on the number of consecutive polls that told us
 * nothing new. `consecutive` resets to 0 whenever the stage actually changes,
 * so an active job stays responsive while a job stuck in `queued` behind a
 * long GPU run decays to one request every thirty seconds instead of hammering
 * the pond for an hour.
 *
 * A retryable error (429/503) backs off on the SAME curve rather than a
 * separate one: the server is telling us it is busy, and the correct response
 * to that is identical to the correct response to "nothing changed".
 */
export function nextPollDelay(consecutive, { background = false } = {}) {
  const steps = Math.max(0, Math.floor(Number(consecutive) || 0));
  const cap = background ? POLL_MAX_BACKGROUND_MS : POLL_MAX_FOREGROUND_MS;
  return Math.min(cap, Math.round(POLL_BASE_MS * POLL_FACTOR ** steps));
}

/**
 * Whether an HTTP status is worth trying again, per the frontend contract:
 * 429 (rate limited) and 503 (worker busy or unavailable) are transient; a 404
 * means the job is gone and polling must stop, and a 4xx is our own fault and
 * will not improve by repetition.
 */
export function isRetryableStatus(status) {
  const code = Number(status);
  return code === 429 || code === 503;
}

/**
 * One job as the card renders it.
 *
 * `tone` is the only judgement here — 'bad' for a failure, 'done' for success,
 * 'busy' for anything still moving — and it exists so the card does not have to
 * re-derive severity from a status string in three places.
 */
export function describeJob(job) {
  const status = String(job?.status || '');
  const uploading = status === UPLOADING;
  const fraction = uploading
    // The upload's own byte progress, scaled into the first stage's worth of
    // bar so the indicator never jumps BACKWARDS at the moment a job id
    // arrives and the server takes over reporting.
    ? Math.max(0, Math.min(1, (Number(job?.uploadPercent) || 0) / 100)) / STAGES.length
    : stageFraction(status, { failedAt: job?.failedAt });

  return {
    label: stageLabel(status),
    fraction,
    tone: status === 'failed' ? 'bad'
      : status === 'cancelled' ? 'muted'
        : status === 'completed' ? 'done'
          : 'busy',
    // Only a live job may be cancelled; a terminal one is deleted instead, and
    // the button says so.
    canCancel: uploading || (!isTerminal(status) && !!job?.id),
    canDelete: isTerminal(status) && !!job?.id,
  };
}
