/**
 * The transcription option set: what this pond will accept, what the user
 * picked, and the narrow difference between the two that is worth sending.
 *
 * Pure and free of react-native imports, like `transcriptionProgress` beside
 * it, so the one rule that is easy to get wrong here can be tested directly.
 *
 * ─── Why only the DIFFERENCE is sent ────────────────────────────────────────
 *
 * Every option has a server-side default (`GET /api/transcriptions/capabilities`
 * publishes them). `services/transcriptions.js` already drops empty values, but
 * dropping empties is not the same as dropping defaults: a build that shipped
 * while the pond defaulted to `small` would keep pinning `small` forever after
 * the pond moved to `large-v3`, and it would look like the server changing its
 * mind and nothing happening. So the panel sends a field only when the user
 * moved it away from what the pond itself said it would do.
 *
 * The corollary is that capabilities are the source of truth, not this file.
 * `FALLBACK` exists for the seconds before the request lands and for a pond too
 * old to answer — it is a shape to render, never an authority.
 */

/** Mirrors the route's own defaults, used only until the pond answers. */
export const FALLBACK = {
  models: ['tiny', 'base', 'small', 'medium', 'large-v2', 'large-v3'],
  defaults: {
    diarize: true,
    model: 'small',
    language: null,
    minSpeakers: 2,
    maxSpeakers: 5,
    primaryName: 'Primary',
    batchSize: 8,
    outputFormat: 'json',
  },
  ranges: { minSpeakers: [1, 10], maxSpeakers: [1, 10], batchSize: [1, 32] },
  maxUploadBytes: 2 * 1024 * 1024 * 1024,
  maxDurationSeconds: 8 * 60 * 60,
  acceptedExtensions: [],
  runtime: {},
};

/**
 * The models worth offering, largest last.
 *
 * The list is the server's, re-ordered by capability rather than alphabetically
 * — 'base' sorting before 'large-v3' before 'small' is technically a list and
 * practically a puzzle. Anything the pond offers that this build has never
 * heard of is kept, at the end, rather than hidden: a newer pond's model is
 * still a model someone might want.
 */
const MODEL_ORDER = ['tiny', 'base', 'small', 'medium', 'large-v2', 'large-v3'];

/** Roughly what each model costs you in waiting, for the picker's subtitle. */
const MODEL_NOTE = {
  tiny: 'fastest, roughest',
  base: 'fast',
  small: 'balanced',
  medium: 'slower, better',
  'large-v2': 'slow, best',
  'large-v3': 'slowest, best',
};

export function modelNote(model) {
  return MODEL_NOTE[String(model || '')] || '';
}

function clampInt(value, [low, high], fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(high, Math.max(low, Math.round(parsed)));
}

/**
 * Normalise whatever `/capabilities` returned into the shape the panel renders.
 *
 * Defensive on purpose: this is the one place a pond older or newer than the
 * app can hand us a partial answer, and every field has a usable fallback so a
 * missing `ranges` block degrades to a working picker instead of a crash.
 */
export function readCapabilities(raw) {
  const defaults = { ...FALLBACK.defaults, ...(raw?.defaults || {}) };
  const ranges = { ...FALLBACK.ranges, ...(raw?.ranges || {}) };
  const offered = Array.isArray(raw?.models) && raw.models.length
    ? raw.models.map(String)
    : FALLBACK.models;
  const models = [
    ...MODEL_ORDER.filter((m) => offered.includes(m)),
    ...offered.filter((m) => !MODEL_ORDER.includes(m)),
  ];
  return {
    models,
    defaults,
    ranges,
    maxUploadBytes: Number(raw?.maxUploadBytes) > 0
      ? Number(raw.maxUploadBytes) : FALLBACK.maxUploadBytes,
    maxDurationSeconds: Number(raw?.maxDurationSeconds) > 0
      ? Number(raw.maxDurationSeconds) : FALLBACK.maxDurationSeconds,
    acceptedExtensions: Array.isArray(raw?.acceptedExtensions)
      ? raw.acceptedExtensions.map(String) : [],
    runtime: raw?.runtime || {},
  };
}

/**
 * What the pond can do RIGHT NOW, as opposed to what the route accepts.
 *
 * Three separate answers, because they need three different sentences: the
 * worker was never installed here, the worker is there but diarization is not,
 * or everything works. Rendering "unavailable" for all three would tell the
 * owner nothing about which thing to go and fix.
 */
export function runtimeState(capabilities) {
  const runtime = capabilities?.runtime || {};
  if (!runtime.pythonAvailable || !runtime.workerAvailable) return 'no-worker';
  if (!runtime.diarizationAvailable) return 'no-diarization';
  return 'ready';
}

/** The user's starting position: exactly what the pond said it would do. */
export function defaultChoices(capabilities, { primaryName } = {}) {
  const d = capabilities?.defaults || FALLBACK.defaults;
  return {
    model: d.model,
    diarize: d.diarize,
    minSpeakers: d.minSpeakers,
    maxSpeakers: d.maxSpeakers,
    language: d.language || '',
    // Seeded from the profile display name when there is one: the whole point
    // of `primaryName` is that the transcript says "Mark" instead of
    // "SPEAKER_00", and nobody is going to type their own name every time.
    primaryName: primaryName || d.primaryName,
  };
}

/**
 * Keep a choice legal without arguing with the person making it.
 *
 * Speakers are the only pair that can contradict each other, and the route
 * rejects `minSpeakers > maxSpeakers` outright. Rather than refuse to move,
 * the OTHER end follows — dragging the minimum past the maximum pushes the
 * maximum up, which is what a range control is expected to do.
 */
export function clampChoices(choices, capabilities, moved) {
  const ranges = capabilities?.ranges || FALLBACK.ranges;
  const next = { ...choices };
  next.minSpeakers = clampInt(next.minSpeakers, ranges.minSpeakers, 2);
  next.maxSpeakers = clampInt(next.maxSpeakers, ranges.maxSpeakers, 5);
  if (next.minSpeakers > next.maxSpeakers) {
    if (moved === 'maxSpeakers') next.minSpeakers = next.maxSpeakers;
    else next.maxSpeakers = next.minSpeakers;
  }
  next.language = String(next.language || '').trim().toLowerCase();
  next.primaryName = String(next.primaryName ?? '').replace(/\s+/g, ' ').trim();
  return next;
}

/**
 * Why a choice cannot be sent, in the words the user would use. Returns null
 * when it can. The route enforces all of this too — this exists so a rejection
 * arrives before a hundred megabytes have been uploaded, not after.
 */
export function optionsProblem(choices, capabilities) {
  const c = clampChoices(choices, capabilities);
  if (c.language && !/^[a-z]{2,3}$/.test(c.language)) {
    return 'A language code is two or three letters, like en or fra. Leave it empty to detect it automatically.';
  }
  if (!c.primaryName) return 'Give the main speaker a name — it labels their lines in the transcript.';
  if ([...c.primaryName].length > 64) return 'That name is too long for a speaker label.';
  const models = capabilities?.models || FALLBACK.models;
  if (!models.includes(c.model)) return 'This pond no longer offers that model.';
  return null;
}

/**
 * The multipart fields to send: the user's choices minus everything they left
 * at the pond's own default. See the header for why the subtraction matters.
 */
export function submitParameters(choices, capabilities) {
  const d = capabilities?.defaults || FALLBACK.defaults;
  const c = clampChoices(choices, capabilities);
  const out = {};
  if (c.model !== d.model) out.model = c.model;
  if (c.diarize !== d.diarize) out.diarize = c.diarize;
  if (c.primaryName && c.primaryName !== d.primaryName) out.primaryName = c.primaryName;
  // Speaker bounds only mean anything when speakers are being separated at all.
  if (c.diarize) {
    if (c.minSpeakers !== d.minSpeakers) out.minSpeakers = c.minSpeakers;
    if (c.maxSpeakers !== d.maxSpeakers) out.maxSpeakers = c.maxSpeakers;
  }
  if (c.language && c.language !== (d.language || '')) out.language = c.language;
  return out;
}

/** The options as one line, for the collapsed row. */
export function summariseChoices(choices, capabilities) {
  const c = clampChoices(choices, capabilities);
  const parts = [c.model];
  parts.push(c.diarize
    ? (c.minSpeakers === c.maxSpeakers
      ? `${c.minSpeakers} speaker${c.minSpeakers === 1 ? '' : 's'}`
      : `${c.minSpeakers}–${c.maxSpeakers} speakers`)
    : 'one transcript, no speakers');
  parts.push(c.language ? c.language.toUpperCase() : 'auto language');
  return parts.join(' · ');
}

/**
 * Whether a file is worth sending before it is sent.
 *
 * Size only — duration is measured by the server's probe, which the phone
 * cannot do without decoding the file. `null` means "no objection".
 */
export function fileProblem({ sizeBytes }, capabilities) {
  const limit = capabilities?.maxUploadBytes || FALLBACK.maxUploadBytes;
  if (Number(sizeBytes) > limit) {
    return `That file is larger than this pond accepts (${formatBytes(limit)}).`;
  }
  return null;
}

/** Bytes as a short human string. Hermes' Intl is unreliable, so no toLocaleString. */
export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** Seconds as m:ss / h:mm:ss, matching the music vault's clock. */
export function formatDuration(seconds) {
  const total = Math.floor(Number(seconds) || 0);
  if (total <= 0) return '';
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}
