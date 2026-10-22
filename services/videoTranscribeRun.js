/**
 * Starting a transcription for a video the pond already holds, and seeing it
 * through the part no screen can watch.
 *
 * ─── Why this is a module and not a hook ────────────────────────────────────
 *
 * In "audio file and transcript" mode the run is TWO pond jobs back to back:
 * an audio conversion, then a transcription of the track it made. Only the
 * second one is a transcription job, and only transcription jobs are in the
 * recordings store — which is what `TranscriptionPanel` resumes polling when
 * it mounts. So the gap between "the conversion started" and "there is a job
 * id to poll" belongs to nobody, and if it belonged to a component it would
 * die the moment someone closed the sheet and the user would be left with a
 * track and no transcript.
 *
 * Living at module scope, a run outlives every screen, exactly like the
 * upload controllers in the panel do.
 *
 * ─── What the user sees while it runs ───────────────────────────────────────
 *
 * A recordings row, from the first tap. Before the pond has issued a
 * transcription id the row sits in the client-only `uploading` pseudo-status
 * with a `note` saying what is actually happening ("Taking the audio out") —
 * the same device the panel already uses for "Fetching from the pond", for
 * the same reason: it is a real step the server has no stage for. The moment
 * an id exists the row is patched with it and the panel's poller takes over.
 *
 * ─── What it refuses to do ──────────────────────────────────────────────────
 *
 * Retry. Both pond endpoints are keyed on the media row, so a request that
 * was ACCEPTED and whose answer was lost is already deduped server-side — but
 * a failure still ends as a failed row with a reason, for a person to press
 * again on purpose. Nothing here auto-repeats.
 */
import {
  addLocalRecording, getRecordings, patchLocalRecording,
} from './transcriptionStore';
import { extractAudio, extractAudioStatus, statusOfError, submitMediaTranscription } from './transcriptions';
import { UPLOADING, nextPollDelay } from '../utils/transcriptionProgress';
import { itemTitle } from '../utils/videoTranscribe';

let keySeed = 0;
const newKey = () => `vid_${Date.now().toString(36)}_${(keySeed += 1)}`;

/** How long to keep asking about a conversion before calling it stuck. */
const CONVERSION_TIMEOUT_MS = 30 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * A row the user has cancelled or deleted is gone from the store. The run
 * stops rather than resurrecting it with the next patch.
 */
function stillWanted(key) {
  const row = getRecordings().find((r) => r.key === key);
  if (!row) return false;
  return row.status !== 'cancelled' && row.status !== 'failed';
}

function reasonFor(error, fallback) {
  const status = statusOfError(error);
  if (status === 401) return 'Not signed in — sign in again and try once more.';
  if (status === 404) return 'The pond no longer has that video.';
  if (status === 409) return 'The pond has no copy of that video to work from.';
  if (status === 415) return 'The pond cannot take audio out of that file.';
  if (status === 429 || status === 503) return 'The pond is busy — try again shortly.';
  const message = String(error?.message || '').trim();
  return message && !/^\d{3}$/.test(message) ? message : fallback;
}

/**
 * Wait for a conversion to produce its track. Resolves to the new media id,
 * or throws with something worth showing.
 */
async function awaitTrack(api, jobId, key, { now = () => Date.now() } = {}) {
  const deadline = now() + CONVERSION_TIMEOUT_MS;
  for (let attempt = 0; ; attempt += 1) {
    if (!stillWanted(key)) return null;
    let status;
    try {
      status = await extractAudioStatus(api, jobId);
    } catch (error) {
      // A conversion the pond has forgotten is not coming back; anything else
      // earns another look on the shared backoff curve.
      if (statusOfError(error) === 404) throw error;
      status = null;
    }
    if (status?.phase === 'failed') {
      throw new Error(status.error || 'The pond could not take the audio out of that video');
    }
    // A finished conversion with no media id has produced nothing to
    // transcribe; treated as still working rather than as a reason to submit
    // an empty id.
    if (status?.phase === 'completed' && status.mediaId) return String(status.mediaId);
    if (now() > deadline) throw new Error('The conversion is taking too long — look in Files for the track.');
    await sleep(nextPollDelay(attempt));
  }
}

/**
 * Start one run.
 *
 * @param api          the ServerContext api client
 * @param item         the vault's video row
 * @param mode         'transcript' | 'audio'
 * @param options      the submit parameters the panel would have sent
 * @param onTrackSaved called with the new track's media id, in `audio` mode
 * @returns the recordings-store key, so a caller can point at the row
 */
export function startVideoTranscription(api, {
  item, mode = 'transcript', options = {}, onTrackSaved,
}) {
  const key = newKey();
  const mediaId = String(item?.id ?? '');
  const wantsAudio = mode === 'audio';
  addLocalRecording({
    key,
    name: itemTitle(item),
    status: UPLOADING,
    uploadPercent: 0,
    sizeBytes: Number(item?.size) || 0,
    durationSeconds: Number(item?.duration) || 0,
    createdAt: Date.now(),
    note: wantsAudio ? 'Taking the audio out' : 'Asking the pond',
    // Left null until it is known which row the transcript belongs to: in
    // `audio` mode that is the TRACK, not the video, and the music vault
    // follows this link to decide which tracks it can read along with.
    mediaId: wantsAudio ? null : mediaId,
    mediaTags: [],
  });

  (async () => {
    try {
      let target = mediaId;
      if (wantsAudio) {
        const { jobId } = await extractAudio(api, mediaId);
        const trackId = await awaitTrack(api, jobId, key);
        if (!trackId) return;            // the row was cancelled under us
        target = trackId;
        patchLocalRecording(key, { mediaId: trackId, note: 'Asking the pond' });
        onTrackSaved?.(trackId);
      }
      if (!stillWanted(key)) return;
      const accepted = await submitMediaTranscription(api, target, options);
      patchLocalRecording(key, {
        id: String(accepted.id),
        status: accepted.status || 'queued',
        uploadPercent: 100,
        note: null,
      });
    } catch (error) {
      patchLocalRecording(key, {
        status: 'failed',
        note: null,
        uploadPercent: 0,
        error: reasonFor(error, wantsAudio
          ? 'The pond could not take the audio out of that video'
          : 'The pond would not accept that video'),
      });
    }
  })();

  return key;
}
