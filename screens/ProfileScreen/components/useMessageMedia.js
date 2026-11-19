/**
 * useMessageMedia — which of a thread's attachments are videos.
 *
 * ── Why a lookup at all, when the pictures need none ───────────────────────
 *
 * A bubble draws its attachment from `/api/media/display/:id` and asks the
 * vault nothing (MessagePhotos explains why that is the ONLY thing that works
 * for a photo somebody sent you). That stays true. But the display tier
 * answers for a video too — with its poster — so the first frame of a video
 * and the first frame of a photo are the same still image, and the bubble has
 * no way to tell that it should offer to PLAY one of them. Mark, 2026-11-18:
 * "but it just picture, no video".
 *
 * So this resolves the TYPE, and only the type. It is deliberately NOT on the
 * path to the first pixel: the poster paints from the id while this is still
 * in flight, and when the answer lands the play badge appears on the frames
 * that earned it. A thread with no attachments never makes a request.
 *
 * `/media/by-ids` is owner-scoped PLUS whatever has been shared with the
 * caller, and a message is one of the three things that share it — so both
 * ends of the conversation get an answer here. (That was not always so; a
 * recipient used to get `{items: []}`, which is the whole reason the bubble
 * draws from the display tier instead of from this.)
 *
 * Shaped after NotesScreen/useNoteThumbs, which solves the same problem for a
 * page of notes: ask about each id once ever, batch, and fail silently.
 */
import { useEffect, useRef, useState } from 'react';
import { useServer } from '../../../context/ServerContext';
import { BY_IDS_MAX, chunkIds, isVideo } from '../../../utils/mediaAttachments';
import { attachmentIdsOf } from '../../../utils/messageAttachments';

/** Every attachment id in the thread that we have not already asked about. */
export function unaskedIds(messages, asked) {
  const out = [];
  const seen = new Set();
  for (const m of messages || []) {
    for (const id of attachmentIdsOf(m)) {
      if (asked?.has(id) || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * @returns {Set<string>} the ids known to be videos. An id missing from it is
 *   "a picture, or not answered for yet" — which are the same thing to a
 *   caller, because both draw as the still the display tier already gave them.
 */
export default function useMessageMedia(messages) {
  const { api } = useServer();
  const [videos, setVideos] = useState(() => new Set());
  const askedRef = useRef(new Set());

  useEffect(() => {
    const wanted = unaskedIds(messages, askedRef.current);
    if (wanted.length === 0) return undefined;
    for (const id of wanted) askedRef.current.add(id);

    let alive = true;
    (async () => {
      for (const batch of chunkIds(wanted, BY_IDS_MAX)) {
        if (!alive) return;
        try {
          const r = await api.get(`/media/by-ids?ids=${encodeURIComponent(batch.join(','))}`);
          if (!alive) return;
          const found = (Array.isArray(r?.items) ? r.items : []).filter(isVideo);
          if (found.length === 0) continue;
          setVideos((prev) => {
            const next = new Set(prev);
            for (const m of found) next.add(String(m.id));
            return next;
          });
        } catch {
          // Silent, and the ids stay marked asked. The cost of being wrong is
          // a video that opens as its own still picture — which is exactly
          // what every bubble did before this existed.
        }
      }
    })();

    return () => { alive = false; };
  }, [messages, api]);

  return videos;
}
