/**
 * Public share links for a single photo or video.
 *
 * The other way to send something out of the vault is the OS share sheet with
 * the FILE attached — that's what `doShare` in MediaGallery does, and it's why
 * a video shows "Preparing video… 1%" while a couple of hundred megabytes are
 * pulled onto the phone before the sheet can even open. It uploads again from
 * the phone, over whatever connection you're standing in, and WhatsApp
 * re-compresses it at the far end.
 *
 * A link is the other trade. Nothing leaves the machine until the recipient
 * opens it, the original stays untouched, it can be turned off later, and —
 * the point — a video PLAYS INSIDE the conversation, the way a Facebook reel
 * does, instead of arriving as a blue link.
 *
 * ── Why a video link has to wait ─────────────────────────────────────────
 * When a link lands in iMessage, WhatsApp, Signal or Discord, the app sends an
 * anonymous fetcher that reads the page's Open Graph tags and leaves. It runs
 * no JavaScript and — the part that matters here — CACHES what it finds, often
 * for good. The server only advertises `og:video` once an H.264/MP4 copy
 * actually exists on disk (phones record HEVC, which nothing in a chat app can
 * play), so handing out the URL before that is done means the preview every
 * recipient sees is the one WITHOUT a player, permanently.
 *
 * Hence `waitForPlayable`: the share sheet holds the link back until the
 * server says it's ready. Photos are ready the moment they're created.
 *
 * Server side: server/routes/mediaShares.js (owner API) and /m/<slug> (the
 * public page the link points at).
 */

/** How often to ask the server whether the video is ready yet. */
const POLL_INTERVAL_MS = 1200;
/** Past this, something is wrong — stop asking and say so. */
const POLL_TIMEOUT_MS = 15 * 60_000;

/**
 * The live link for this item, or null.
 *
 * Asked before creating, so sharing the same photo twice doesn't scatter two
 * separately-revocable capabilities through your chat history.
 *
 * @param {{get: Function}} api  ServerContext's api wrapper
 * @param {string|number} mediaId
 */
export async function findLiveShareLink(api, mediaId) {
  const res = await api.get(`/media-shares?mediaId=${encodeURIComponent(String(mediaId))}`);
  const shares = (res && res.shares) || [];
  return shares.find((s) => !s.dead) || null;
}

/**
 * Mint a link (or hand back the live one for this item).
 *
 * Creating also kicks off the poster and — for a video — the MP4 conversion,
 * server-side, so the wait below has usually already started by the time
 * anyone looks at it.
 */
export async function createShareLink(api, mediaId, opts = {}) {
  const body = { mediaId: String(mediaId) };
  if (opts.expiresInDays != null) body.expiresInDays = opts.expiresInDays;
  if (opts.allowDownload === false) body.allowDownload = false;
  if (opts.fresh) body.fresh = true;
  const res = await api.post('/media-shares', body);
  if (!res || !res.success || !res.share) {
    throw new Error((res && res.error) || 'Could not create the link');
  }
  return res.share;
}

/** Current state of one link — the poll target while a video is converting. */
export async function getShareLinkStatus(api, id) {
  const res = await api.get(`/media-shares/${id}/status`);
  if (!res || !res.share) throw new Error('Could not check the link');
  return res.share;
}

/** Kill a link. Anyone holding it loses access immediately. */
export async function revokeShareLink(api, id) {
  return api.delete(`/media-shares/${id}`);
}

// ── Who can currently see this photo ────────────────────────────────────────
// Two independent things expose one picture, and the owner has no way to know
// about either from looking at it:
//
//   the DIRECT link  — /m/<slug>, minted for this item alone.
//   an ALBUM link    — /s/<slug>, which exposes it because the photo carries
//                      that album's name as a tag. Nobody "adds a photo to a
//                      shared album"; it happens as a side effect of tagging,
//                      possibly months earlier, possibly by someone else's
//                      upload landing in the same album.
//
// The second is the one people forget, so the server resolves it rather than
// the client: matching a tag list against a share list here would have to
// re-implement SQLite's NOCASE fold, and getting that wrong under-reports —
// silently hiding a live link from the person trying to find it.

const isDeadShare = (s) => !!s?.revokedAt || !!(s?.expiresAt && s.expiresAt < Date.now());

/**
 * Every link that exposes `mediaId`, direct and album, newest first.
 *
 * Partial by design: the two lists come from different routers, and one of
 * them failing is not a reason to claim the photo is unshared. Whatever
 * answered is returned, and `errors` names what didn't — so the UI can show
 * the links it knows about AND admit the list may be short, rather than
 * quietly reporting "not shared" because a request timed out.
 *
 * @returns {Promise<{links: object[], liveCount: number, errors: string[]}>}
 */
export async function loadShareExposure(api, mediaId) {
  const id = encodeURIComponent(String(mediaId));
  const errors = [];

  const [direct, albums] = await Promise.all([
    api.get(`/media-shares?mediaId=${id}`)
      .then((r) => (r && r.shares) || [])
      .catch(() => { errors.push('direct'); return []; }),
    api.get(`/album-shares?mediaId=${id}`)
      .then((r) => {
        // The server says which filter it APPLIED. An older build ignored
        // ?mediaId= and answered with every album link the user owns — which
        // this screen would then present as "where this photo is shared".
        // Showing somebody a list of albums their photo is NOT in, under that
        // heading, is worse than showing nothing: it invites them to revoke
        // links that had nothing to do with it.
        //
        // So an unconfirmed filter is treated as "couldn't check", never as an
        // answer. Requires a server new enough to echo `filteredBy`.
        if (!r || r.filteredBy !== 'mediaId') {
          errors.push('album');
          return [];
        }
        return r.shares || [];
      })
      .catch(() => { errors.push('album'); return []; }),
  ]);

  // One shape for the list, so the sheet doesn't branch per row. `dead` is
  // computed here because the two routers disagree: media shares send a `dead`
  // flag, album shares send the raw revokedAt/expiresAt it's derived from.
  const links = [
    ...direct.map((s) => ({
      kind: 'direct',
      id: s.id,
      slug: s.slug,
      url: s.url,
      album: null,
      hasPassword: false,
      viewCount: s.viewCount || 0,
      createdAt: s.createdAt,
      dead: typeof s.dead === 'boolean' ? s.dead : isDeadShare(s),
      revokedAt: s.revokedAt || null,
      expiresAt: s.expiresAt || null,
    })),
    ...albums.map((s) => ({
      kind: 'album',
      id: s.id,
      slug: s.slug,
      url: s.url,
      album: s.album || s.title || null,
      hasPassword: !!s.hasPassword,
      viewCount: s.viewCount || 0,
      createdAt: s.createdAt,
      dead: isDeadShare(s),
      revokedAt: s.revokedAt || null,
      expiresAt: s.expiresAt || null,
    })),
  ].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  return {
    links,
    // The badge counts LIVE links only — a turned-off link is history, not
    // exposure, and counting it would make the viewer cry wolf forever.
    liveCount: links.filter((l) => !l.dead).length,
    errors,
  };
}

/** Turn off one link, whichever kind it is. */
export async function revokeExposureLink(api, link) {
  const path = link.kind === 'album' ? '/album-shares/' : '/media-shares/';
  const res = await api.delete(`${path}${link.id}`);
  if (res && res.success === false) throw new Error(res.error || 'Could not turn off the link');
  return res;
}

/**
 * Block until the link is safe to hand out.
 *
 * Returns the final share. Photos return immediately. A video whose conversion
 * fails comes back with `prepareFailed` — the link still WORKS, it just won't
 * play inline, and the caller decides whether that's worth sending.
 *
 * @param {object} opts
 * @param {(progress: number) => void} [opts.onProgress] 0–1, for the overlay
 * @param {() => boolean} [opts.isCancelled] polled between ticks; true stops it
 */
export async function waitForPlayable(api, share, opts = {}) {
  const { onProgress, isCancelled } = opts;
  let current = share;
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (!current.playable && !current.prepareFailed) {
    if (isCancelled && isCancelled()) return { ...current, cancelled: true };
    if (Date.now() > deadline) {
      return { ...current, prepareFailed: true, timedOut: true };
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    if (isCancelled && isCancelled()) return { ...current, cancelled: true };
    try {
      current = await getShareLinkStatus(api, share.id);
    } catch (e) {
      // A dropped poll is one more tick of waiting, not a failure — phones
      // move between networks constantly and the work carries on server-side.
      if (__DEV__) console.warn('[mediaShareLinks] poll failed:', e && e.message);
      continue;
    }
    if (onProgress) onProgress(current.prepareProgress || 0);
  }
  return current;
}

/**
 * One call for the whole flow: reuse or mint, then wait.
 *
 * @returns {Promise<object>} the share, possibly with `cancelled` set
 */
export async function prepareShareLink(api, mediaId, opts = {}) {
  const existing = await findLiveShareLink(api, mediaId).catch(() => null);
  const share = existing && existing.playable
    ? existing
    : await createShareLink(api, mediaId, opts);
  if (share.playable) return share;
  return waitForPlayable(api, share, opts);
}
