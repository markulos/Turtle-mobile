/**
 * Filing a finished transcript's track into the "Transcribed" playlist.
 *
 * A playlist in this vault IS a tag on an audio row (see MusicVault), so this
 * is one PUT of that row's tags. Two things make it worth its own module:
 *
 *   • The tags route REPLACES the list. Sending just ['Transcribed'] would
 *     quietly empty every other playlist the track was in, which is a data
 *     loss you would not notice for weeks. It must always be a union.
 *   • It runs at COMPLETION — minutes after the send, from whatever screen
 *     happens to be watching the job. So it goes through the offline outbox
 *     like every other write in the app: a transcript that finishes while the
 *     phone is on a train still gets filed when it reconnects.
 *
 * Best-effort by design. Failing to file a track is a missing playlist entry,
 * not a lost transcript, and the music vault also derives the playlist from
 * the local recordings list — so the track shows up there either way.
 */
import { sendOrQueue } from './offlineQueue';
import { TRANSCRIBED_PLAYLIST } from '../utils/transcriptionRecordings';

/** The tags to write: everything it had, plus ours, without duplicates. */
export function withTranscribedTag(tags) {
  const existing = (Array.isArray(tags) ? tags : []).filter((t) => typeof t === 'string' && t.trim());
  if (existing.some((t) => t === TRANSCRIBED_PLAYLIST)) return existing;
  return [...existing, TRANSCRIBED_PLAYLIST];
}

/**
 * File `mediaId` into the playlist. Resolves true when the write went (or was
 * parked), false when there was nothing to do or it was refused outright.
 */
export async function fileIntoTranscribedPlaylist(api, { mediaId, mediaTags } = {}) {
  if (!api || !mediaId) return false;
  const next = withTranscribedTag(mediaTags);
  // Already filed — don't spend a request saying so.
  if (next.length === (mediaTags || []).length) return false;
  try {
    await sendOrQueue(api, {
      method: 'put',
      path: `/media/${encodeURIComponent(mediaId)}/tags`,
      body: { tags: next },
      // Keyed per track: re-transcribing one twice offline should file it
      // once, and the newer tag list is the better one to send.
      key: `media:${mediaId}:transcribed`,
      label: `File into ${TRANSCRIBED_PLAYLIST}`,
    });
    return true;
  } catch {
    // A permanent refusal (the track was deleted while the GPU worked, say).
    return false;
  }
}
