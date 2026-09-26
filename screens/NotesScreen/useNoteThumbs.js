/**
 * useNoteThumbs — thumbnails for the whole loaded timeline, resolved in bulk.
 *
 * A note stores media IDS, so a row that wanted to show a thumbnail would have
 * to go and fetch one. Sixty rows doing that as they mount, during a fling, is
 * a request storm in the worst possible frame — and the rows that scrolled past
 * would have paid for thumbnails nobody saw. So the resolution happens ONCE per
 * page of notes, here, in batches of BY_IDS_MAX, and the rows are handed a URL
 * they can render immediately.
 *
 * Properties worth keeping:
 *  - Ids are asked about once each, EVER (per mount). Paging to note 120 costs
 *    a request for the new ids only; a refresh of notes already seen costs
 *    nothing at all.
 *  - An id that doesn't come back — its media was deleted — is remembered as
 *    asked, so it can't turn into a request per refresh that can only fail.
 *  - Failures are silent. A missing thumbnail makes a row look like a note
 *    without one, which is the correct degradation for a decoration.
 */
import { useEffect, useRef, useState } from 'react';
import { useServer } from '../../context/ServerContext';
import { BY_IDS_MAX, chunkIds, collectMediaIds } from './attachments';

export default function useNoteThumbs(notes) {
  const { api } = useServer();
  // id → the media row from /media/by-ids. A Map so a row's lookup is O(1)
  // during render; replaced (not mutated) per batch so the list re-renders.
  const [resolved, setResolved] = useState(() => new Map());
  const askedRef = useRef(new Set());

  useEffect(() => {
    const wanted = collectMediaIds(notes, askedRef.current);
    if (wanted.length === 0) return undefined;
    for (const id of wanted) askedRef.current.add(id);

    let alive = true;
    (async () => {
      // Sequential, not Promise.all: the batches exist because the list is
      // long, and a long list is exactly when firing every request at once
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
          // Leave them marked asked — a pond that answered once will answer
          // again on the next mount, and retrying mid-scroll helps nobody.
        }
      }
    })();

    return () => { alive = false; };
  }, [notes, api]);

  return resolved;
}
