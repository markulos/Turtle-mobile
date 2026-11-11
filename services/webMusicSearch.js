/**
 * Searching the WEB from the Music tab's search field.
 *
 * The vault's search has always been a search of what you already own, which
 * leaves the obvious question — "I want a song I do not have" — answered only
 * by leaving the app, finding it in a browser, and sharing the link back. The
 * field now has two scopes: your library (still the default, because that is
 * still the common errand) and the web.
 *
 * Everything here is either pure or one call, so the vault keeps its own job
 * and this keeps the decisions about what a web result IS:
 *
 *   • a result is PLAYED through the pond, never from YouTube directly. The
 *     pond's /api/music/web/preview proxies it — services/ytSearch.js on the
 *     server says why (the signed URL is bound to the IP that asked for it, so
 *     a URL resolved on the pond 403s on the phone).
 *
 *   • a result is DOWNLOADED by handing its ordinary watch URL to the
 *     downloads queue, which is the same ghost-download queue a shared link
 *     has always gone through — so progress shows up in the DownloadsPill, and
 *     the finished track lands in the Audio album with everything else. There
 *     is no separate web-download path to keep honest.
 *
 * ── Paths here do NOT start with `/api` ─────────────────────────────────
 * ServerContext's getBaseUrl() is already `<origin>/api` and every api.* call
 * appends to it, so `api.get('/api/music/web/search')` asks for
 * `/api/api/music/web/search`. That is a 404, and a 404 is the one status this
 * feature reads as "this pond predates the feature" — so all three calls in
 * this file (search, download, preview) failed with a message blaming the
 * SERVER, through a deploy that was already live and verified. Shipped broken
 * 2026-11-11, found the same day.
 *
 * The rule: `api.*` takes a path relative to /api (`/downloads`, `/me`), and
 * anything the server hands back as a root-relative URL already carries its
 * own `/api` — join those to pondOrigin(), never to getBaseUrl().
 */

/** Which half of the search field is lit. The library is the default. */
export const LIBRARY_SCOPE = 'library';
export const WEB_SCOPE = 'web';

/**
 * How long after the last keystroke the web is actually asked.
 *
 * Much longer than a local filter's, and deliberately: a library search is a
 * loop over an array, while this spawns a process on the pond and leaves for
 * YouTube — about five seconds, measured. Firing that per keystroke would
 * queue a dozen searches to show the answer to one.
 */
export const WEB_DEBOUNCE_MS = 700;

/** Below this a search is all noise — "a" matches the entire internet. */
export const MIN_WEB_QUERY = 2;

/** The pond's own search timeout is 30s; giving up first would turn a slow
 *  answer into an error the user has to retype to retry. */
const SEARCH_TIMEOUT_MS = 32_000;

const DEFAULT_LIMIT = 15;

/** Is there enough here to bother the pond with? */
export function shouldSearchWeb(query) {
  return String(query || '').trim().length >= MIN_WEB_QUERY;
}

/**
 * The pond's ORIGIN, from the API base every caller actually holds.
 *
 * ServerContext.getBaseUrl() is `<origin>/api`. Anything the SERVER hands back
 * as a root-relative path — `previewUrl` here, and media URLs elsewhere —
 * already carries its own `/api`, so joining the two doubles it. Trailing
 * slash goes too, so the join is exact either way.
 */
export function pondOrigin(apiBaseUrl) {
  return String(apiBaseUrl || '').replace(/\/+$/, '').replace(/\/api$/, '');
}

/**
 * The synthetic media id a web preview plays under.
 *
 * Prefixed because it shares a namespace with real media ids in the player's
 * `activeTrack.mediaId`, and the vault asks "is the playing track this row?"
 * of both. A bare video id could in principle collide with a media row's.
 */
export function webRowId(videoId) {
  return `yt:${videoId}`;
}

export function isWebRowId(id) {
  return String(id || '').startsWith('yt:');
}

/** "Record Makers · 4:17" — the line under a result's title. */
export function webResultMeta(result) {
  return [result?.channel, result?.durationLabel].filter(Boolean).join(' · ') || 'YouTube';
}

/**
 * A web result, in the shape the music player already understands.
 *
 * services/musicTrackMapper turns a MEDIA ROW into a queue item, and it is the
 * one place that knows how (titles, artwork, offline copies). Rather than teach
 * the player about a second kind of track, a result is dressed as the row it
 * would be if it were already downloaded — which is also why previewing and
 * then downloading look the same on screen.
 *
 * `previewUrl` arrives as a root-relative path that already starts `/api/…`,
 * because the phone, the browser and the tunnel each reach the pond
 * differently. `baseUrl` is therefore normalised through pondOrigin() rather
 * than trusted: callers hold getBaseUrl(), which ends in `/api`, and joining
 * the two is what produced `/api/api/music/web/preview/…`. Either form works
 * now, which is the point — this is not a distinction worth remembering at
 * four call sites.
 */
export function webPreviewRow(result, baseUrl) {
  if (!result?.videoId || !result?.previewUrl || !baseUrl) return null;
  return {
    id: webRowId(result.videoId),
    // The pond, not YouTube. See the note at the top of this file.
    rawUrl: `${pondOrigin(baseUrl)}${result.previewUrl}`,
    originalName: result.title,
    duration: result.duration ?? null,
    thumbUrl: result.thumbnail || null,
    // Becomes the artist line ("youtube.com") via musicTrackMapper's sourceOf,
    // and is the URL the download button sends to the queue.
    sourceUrl: result.url,
  };
}

/**
 * Ask the pond to search YouTube.
 *
 * Throws with the pond's own message where it has one — "this pond cannot
 * search the web" is worth reading, and a generic failure is not.
 */
export async function searchWebMusic(api, query, { limit = DEFAULT_LIMIT } = {}) {
  const q = String(query || '').trim();
  if (!q) return { query: '', results: [] };
  // NO `/api` PREFIX. ServerContext's getBaseUrl() is already
  // `<origin>/api`, and every api.* call appends to it — see the note at the
  // top of this file about the 404 that cost a day.
  const body = await api.get(
    `/music/web/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    { timeoutMs: SEARCH_TIMEOUT_MS },
  );
  return { query: body?.query || q, results: Array.isArray(body?.results) ? body.results : [] };
}

/**
 * Send a result to the pond's download queue as audio.
 *
 * `outputKind: 'audio'` is the whole of "as an mp3" from the caller's side: the
 * queue fetches the audio stream alone, files it into the Audio album, and the
 * track appears in this vault on the next refresh. A real .mp3 FILE, if one is
 * ever wanted on another device, is the existing GET /api/media/:id/mp3.
 */
export async function enqueueWebDownload(api, result) {
  if (!result?.url) throw new Error('That result has no link to download');
  // `/downloads`, which is what DownloadsContext has always posted to.
  return api.post('/downloads', { url: result.url, outputKind: 'audio' });
}

/**
 * The pond's own sentence, out of the Error `api.*` threw.
 *
 * ServerContext stringifies a failure as `API <status> on GET <path> — <body>`,
 * and the body is this feature's JSON. The message inside it is the only one
 * worth showing: "this pond cannot search the web — yt-dlp is not installed"
 * tells the owner exactly what to do, and "Could not search YouTube" does not.
 * Returns null when there is nothing better than the caller's own fallback.
 */
export function pondMessage(error) {
  const text = String(error?.message || '');
  const brace = text.indexOf('{');
  if (brace < 0) return null;
  try {
    const message = JSON.parse(text.slice(brace))?.error;
    return typeof message === 'string' && message.trim() ? message.trim() : null;
  } catch {
    return null;
  }
}

/**
 * What the user is told while a web search is in the air.
 *
 * Pure, and separate from the fetching, because this is the half that is easy
 * to get wrong: "Nothing found" must never appear over a search that has not
 * happened yet, and the count must not flicker to zero between two queries.
 */
export function webSearchStatus({ query, loading, error, results, searched }) {
  const typed = String(query || '').trim();
  if (!typed) return 'Search YouTube for something to listen to.';
  if (!shouldSearchWeb(typed)) return 'Keep typing…';
  if (error) return error;
  if (loading) return `Searching YouTube for “${typed}”…`;
  // `searched` is the query the results on screen belong to. Until it catches
  // up there is nothing truthful to say about a count.
  if (searched !== typed) return `Searching YouTube for “${typed}”…`;
  const n = results?.length || 0;
  if (n === 0) return `Nothing on YouTube for “${typed}”.`;
  return n === 1 ? '1 result on YouTube' : `${n} results on YouTube`;
}
