const AUDIO_EXTENSION = /\.[a-z0-9]{2,5}$/i;

/**
 * THE POND'S STORAGE NAME — `media_<epoch_ms>_<random>`, e.g.
 * media_1794518356672_9l5iakewv. It is what every uploaded and downloaded
 * file is called ON DISK; the name a person typed lives in `originalName`.
 *
 * It must never be shown. A row that has lost its originalName used to fall
 * through to this and put "media_1794518356672_9l5iakewv" on the lock screen
 * — reported as "the display becomes a bunch of numbers", which is exactly
 * what it looks like at a glance. "Unknown track" is a worse name and a far
 * better answer: it says the name is missing instead of pretending an
 * internal id is the name.
 *
 * Narrow on purpose. A voice memo really is called "Voice memo.m4a" on disk
 * and that IS its name, so only this one unambiguous shape is suppressed.
 */
const STORAGE_NAME = /^media_\d+_[a-z0-9]+$/i;

export function titleOf(row) {
  const named = String(row?.originalName || '').replace(AUDIO_EXTENSION, '').trim();
  if (named) return named;
  const stored = String(row?.filename || '').replace(AUDIO_EXTENSION, '').trim();
  if (stored && !STORAGE_NAME.test(stored)) return stored;
  return 'Unknown track';
}

export function sourceOf(row) {
  const value = row?.sourceUrl || row?.originalPath || '';
  try {
    return value ? new URL(value).hostname.replace(/^www\./, '') : '';
  } catch {
    return '';
  }
}

export function resolveMediaUrl(value, mediaBase) {
  if (!value) return null;
  const raw = String(value);
  if (/^https?:\/\//i.test(raw) || /^file:\/\//i.test(raw)) return raw;
  if (!mediaBase) return null;
  return `${String(mediaBase).replace(/\/$/, '')}/${raw.replace(/^\//, '')}`;
}

/**
 * `localUris` maps media id → a `file://` path for a track kept on this
 * device. Given one, it is used INSTEAD of the stream URL, which is the
 * whole of offline playback: resolveMediaUrl already passes a file: URI
 * through untouched, and the player plays local files natively.
 *
 * Artwork is deliberately left pointing at the pond. It is small, it is not
 * what you came for, and a missing cover on a plane is a far smaller loss
 * than another file per track to download, track and clean up.
 */
export function mapMediaRowToTrack(row, mediaBase, localUris) {
  if (row?.id == null) return null;
  const local = localUris ? localUris[String(row.id)] : null;
  const url = local || resolveMediaUrl(row.rawUrl || row.url, mediaBase);
  if (!url) return null;

  const item = {
    mediaId: String(row.id),
    url,
    title: titleOf(row),
    artist: sourceOf(row) || 'Turtle Music',
    extras: { turtleMediaId: String(row.id) },
  };
  const artworkUrl = resolveMediaUrl(
    row.artworkUrl || row.thumbUrl || row.thumbnailUrl,
    mediaBase
  );
  if (artworkUrl) item.artworkUrl = artworkUrl;
  if (Number.isFinite(Number(row.duration)) && Number(row.duration) > 0) {
    item.duration = Number(row.duration);
  }
  return item;
}

export function buildMusicQueue(rows, selectedId, mediaBase, localUris) {
  const selectedKey = String(selectedId);
  const items = (Array.isArray(rows) ? rows : [])
    .map((row) => mapMediaRowToTrack(row, mediaBase, localUris))
    .filter(Boolean);
  const startIndex = items.findIndex((item) => item.mediaId === selectedKey);
  if (startIndex < 0) throw new Error('Selected track is not playable');
  return { items, startIndex };
}
