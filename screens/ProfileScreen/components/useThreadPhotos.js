/**
 * Thumbnails for every photo in the open conversation, resolved in bulk.
 *
 * A message stores media IDS (utils/messageAttachments), so a bubble that wanted
 * to draw its photo would have to go and fetch one. A thread read returns up to
 * 200 messages, so per-bubble fetching is up to 200 requests for one scroll —
 * mostly for photos nobody has scrolled to. The same trap useNoteThumbs exists to
 * avoid on the notes timeline, and the same answer: the SCREEN asks once, in
 * batches, and hands each bubble a row it already has.
 *
 * Properties worth keeping:
 *  - Ids are asked about once each, EVER (per mount). A refetch of the thread —
 *    which this screen does on every socket ping — costs nothing for the photos
 *    it already knows.
 *  - An id that does not come back (its photo was deleted from the vault) is
 *    remembered as ASKED, so it cannot turn into a request per ping that can
 *    only ever fail. A message outlives the photo it points at.
 *  - Failures are quiet and retried on the next id that appears. A photo that
 *    will not resolve leaves a placeholder in the bubble, which is the honest
 *    thing to show and not worth an error banner over a conversation.
 */
import { useEffect, useRef, useState } from 'react';
import { useServer } from '../../../context/ServerContext';
import { BY_IDS_MAX, chunkIds } from '../../../utils/mediaAttachments';
import { attachmentIdsOf } from '../../../utils/messageAttachments';

/** Every id in the thread that has not been asked about yet, oldest first. */
export function wantedPhotoIds(thread, known) {
  const out = [];
  const seen = new Set();
  for (const m of thread || []) {
    for (const id of attachmentIdsOf(m)) {
      if (seen.has(id) || known?.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

export default function useThreadPhotos(thread) {
  const { api } = useServer();
  // id → the media row from /media/by-ids. A Map so a bubble's lookup is O(1)
  // during render; replaced (not mutated) per batch so the list re-renders.
  const [resolved, setResolved] = useState(() => new Map());
  const askedRef = useRef(new Set());

  useEffect(() => {
    const wanted = wantedPhotoIds(thread, askedRef.current);
    if (wanted.length === 0) return undefined;
    for (const id of wanted) askedRef.current.add(id);

    let alive = true;
    (async () => {
      // Sequential, not Promise.all: the batches exist because a thread can be
      // long, and a long thread is exactly when firing every request at once
      // would compete with the scroll it is decorating.
      for (const batch of chunkIds(wanted, BY_IDS_MAX)) {
        if (!alive) return;
        try {
          const r = await api.get(`/media/by-ids?ids=${encodeURIComponent(batch.join(','))}`);
          if (!alive) return;
          const items = Array.isArray(r?.items) ? r.items : [];
          if (items.length === 0) continue;
          setResolved((prev) => {
            const next = new Map(prev);
            for (const m of items) next.set(String(m.id), m);
            return next;
          });
        } catch {
          // Left marked asked — a pond that answered once will answer again on
          // the next mount, and retrying mid-scroll helps nobody.
        }
      }
    })();

    return () => { alive = false; };
  }, [thread, api]);

  return resolved;
}
