/**
 * useLinkPreview — the unfurled description of one URL, fetched once.
 *
 * Two endpoints, in this order, because they cost very different things:
 *
 *   1. `GET /api/share/link-preview?url=` — reads the pond's `link_previews`
 *      cache and NEVER fetches the remote page. Instant, and the right answer
 *      for a link that was shared into Turtle before.
 *   2. `POST /api/share/preview` — unfurls the page for real (up to ~8s, with
 *      a thumbnail generated server-side). Only reached when step 1 has
 *      nothing, which for a link someone just typed is the usual case. Its
 *      result lands in the same cache, so the SECOND reader of the thread —
 *      including the web app — gets step 1.
 *
 * De-duplicated across the whole app by a module-level cache keyed on URL plus
 * an in-flight promise map. A FlatList recycles rows aggressively, so without
 * that a scroll up and back down would re-ask the pond for every bubble.
 *
 * A FAILURE is remembered only briefly (NEGATIVE_TTL_MS) — a link that could
 * not be unfurled while the phone was off the tailnet has to be retried, which
 * is the "nothing is fetched only once" rule.
 */
import { useEffect, useState } from 'react';
import { useServer } from '../context/ServerContext';
import { isFreshEntry, previewFromFlat, previewFromRow } from './messageLinks';

const cache = new Map();
const inFlight = new Map();

/** Drop everything remembered. For tests — nothing in the app calls this. */
export function __resetLinkPreviewCache() {
  cache.clear();
  inFlight.clear();
}

/** The cheap read, then the expensive unfurl. Never throws. */
async function fetchPreview(api, url) {
  try {
    const res = await api.get(`/share/link-preview?url=${encodeURIComponent(url)}`);
    const cached = previewFromRow(url, res?.preview);
    if (cached) return cached;
  } catch {
    // Unreachable pond, or an older pond without the route. The POST below is
    // the same question asked a more expensive way, so it is still worth a go.
  }
  try {
    const res = await api.post('/share/preview', { url });
    return previewFromFlat(url, res?.preview);
  } catch {
    return null;
  }
}

/**
 * The preview for `url`, or null while it is unknown / not unfurlable.
 * Pass null to ask for nothing (a message with no link).
 */
export default function useLinkPreview(url) {
  const { api } = useServer();
  // Seeded from the cache so a bubble scrolled back into view draws its card
  // on the FIRST frame instead of flashing without one.
  const [preview, setPreview] = useState(() => (url ? cache.get(url)?.preview ?? null : null));

  useEffect(() => {
    if (!url) { setPreview(null); return undefined; }
    const hit = cache.get(url);
    if (isFreshEntry(hit, Date.now())) {
      setPreview(hit.preview);
      return undefined;
    }
    let cancelled = false;
    let pending = inFlight.get(url);
    if (!pending) {
      pending = fetchPreview(api, url).then((result) => {
        cache.set(url, { preview: result, at: Date.now() });
        inFlight.delete(url);
        return result;
      });
      inFlight.set(url, pending);
    }
    pending.then((result) => { if (!cancelled) setPreview(result); });
    return () => { cancelled = true; };
  }, [api, url]);

  return preview;
}
