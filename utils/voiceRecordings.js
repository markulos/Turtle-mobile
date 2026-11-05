/**
 * Voice recordings — audio that is in the vault but NOT in the music library.
 *
 * A voice memo and an album track are both audio rows, and until now the music
 * library showed them side by side: press play on the library and your own
 * voice turned up between two songs. The vault is still the one place the audio
 * lives (nothing is moved, copied or re-uploaded) — what changes is which list
 * claims it.
 *
 * ─── The rule, in one line ─────────────────────────────────────────────────
 *
 * A row tagged `Voice recordings` is NOT part of the music library: not in the
 * list, not in the play-all queue, not in what Next walks to. It is reachable
 * only from the Voice recordings section, which plays it in a queue of its own.
 *
 * ─── Why a tag ─────────────────────────────────────────────────────────────
 *
 * Because that is how this app already models "a named group of media", and
 * music playlists are exactly that (see MusicVault's own note). A tag means no
 * server change, no new column and no migration: filing a recording is the same
 * `PUT /media/:id/tags` that adding to a playlist is, it syncs to every device,
 * and the web vault still sees the row with a tag it can read.
 *
 * The one thing that makes this tag different from a playlist is where the
 * EXCLUSION is applied: in MusicPlayerContext, on the rows the library is built
 * from, so there is a single place that decides what "the music library" means.
 * Filtering in the list alone would have left the recordings in the player's
 * queue — still played by press-play-and-walk, just invisible, which is worse
 * than not doing it.
 *
 * Pure: no react-native, no storage, no network. The screen and the context
 * both read the same two functions.
 */

/**
 * The reserved tag. Shared with the pond and with any other client that reads
 * these rows — do not rename it; an existing recording's tag would stop
 * resolving and it would reappear in the middle of the music library.
 */
export const VOICE_RECORDINGS_TAG = 'Voice recordings';

/** What the section calls itself. Same words, kept beside the tag so the two
 *  cannot drift apart in the UI. */
export const VOICE_RECORDINGS_LABEL = 'Voice recordings';

/**
 * One media row's tags.
 *
 * The gallery returns `tags` as a JSON STRING, and a row written by an older
 * build (or a half-migrated one) can carry anything at all — so this tolerates
 * a real array, a JSON array, and junk, and never throws into a render path.
 */
export function audioTags(row) {
  const raw = row?.tags;
  if (Array.isArray(raw)) return raw.filter((t) => typeof t === 'string');
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t) => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

/** Case- and space-insensitive, because the tag can also be typed by hand (the
 *  web vault's tag editor, a shared board) and "voice recordings" is the same
 *  intent as "Voice Recordings". */
const isTheTag = (tag) => String(tag).trim().toLowerCase() === VOICE_RECORDINGS_TAG.toLowerCase();

/** Is this row filed as a voice recording? */
export function isVoiceRecording(row) {
  return audioTags(row).some(isTheTag);
}

/**
 * Split an audio library into the music and the recordings.
 *
 * One pass, order preserved in both halves — the caller's sort is the sort.
 * Returns the SAME array for `music` when nothing is filed, so a library with
 * no recordings costs nothing and re-renders nothing.
 */
export function partitionVoiceRecordings(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const recordings = [];
  const music = [];
  for (const row of list) {
    if (isVoiceRecording(row)) recordings.push(row);
    else music.push(row);
  }
  if (recordings.length === 0) return { music: list, recordings };
  return { music, recordings };
}

/** The row's tags with the recordings tag added — what a "move here" writes. */
export function tagsWithVoiceRecording(row) {
  const tags = audioTags(row);
  if (tags.some(isTheTag)) return tags;
  return [...tags, VOICE_RECORDINGS_TAG];
}

/**
 * The row's tags with the recordings tag taken off — what "move back to music"
 * writes. Drops every spelling of it, so a row tagged twice by two clients
 * comes out of the section once and for good.
 */
export function tagsWithoutVoiceRecording(row) {
  return audioTags(row).filter((t) => !isTheTag(t));
}

/**
 * Recordings grouped by playlist: a Map of name → the rows carrying it.
 *
 * A recording's OTHER tags are playlists, exactly as they are for music — so
 * organising this folder needs no new concept, no new column and no server
 * change. What it does need is the reserved tag kept OUT of the result: it is
 * what put the row in this folder, not a group within it, and leaving it in
 * would produce a "Voice recordings" playlist inside Voice recordings holding
 * every recording there is.
 *
 * Lives here rather than in the screen because the exclusion has to use the
 * same case- and space-insensitive rule as `isVoiceRecording`. Two copies of
 * that comparison is how a recording tagged "voice recordings" ends up listed
 * as a playlist on one surface and not the other.
 *
 * Insertion order is the caller's order; the caller sorts.
 */
export function recordingPlaylistIndex(rows) {
  const byName = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    for (const tag of audioTags(row)) {
      if (isTheTag(tag)) continue;
      const list = byName.get(tag);
      if (list) list.push(row);
      else byName.set(tag, [row]);
    }
  }
  return byName;
}

/** "3 recordings" / "1 recording" / "" — the section row's own count. */
export function recordingCountLabel(count) {
  const n = Number(count) || 0;
  if (n <= 0) return 'Nothing filed here yet';
  return `${n} recording${n === 1 ? '' : 's'}`;
}
