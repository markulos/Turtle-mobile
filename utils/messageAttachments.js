/**
 * The photos a direct message carries — the rules, with no React and no fetch.
 *
 * ── The wire shape, and why it is ids ──────────────────────────────────────
 * An attachment is a short list of VAULT MEDIA IDS, never bytes (the server's own
 * `sanitizeAttachments` in routes/messages.js says the same). The photo goes
 * through the ordinary media pipeline FIRST and the message references what came
 * back, so a sent photo is a vault item like any other: it gets its tiers, its
 * thumbnail, its rotation, and everything that already knows how to open, share
 * or delete a photo can do so.
 *
 * Kept in lockstep with the web app's components/messages/messageAttachments.ts —
 * the two clients write to the same endpoint and must not disagree about the cap
 * or about what an empty message is.
 */

/**
 * The most photos one message may carry.
 *
 * MIRRORS `MAX_MESSAGE_ATTACHMENTS` in server/routes/messages.js, which is the
 * rule. This copy is the courtesy that stops the composer offering a seventh slot
 * the pond would then drop on the floor.
 */
export const MAX_MESSAGE_ATTACHMENTS = 6;

/**
 * The media ids on a message, in order.
 *
 * Defensive to the point of returning [] for anything unrecognised, matching the
 * server's own instinct: an attachment is chrome on a message whose WORDS are the
 * point, and a row that cannot be parsed must still deliver its text.
 */
export function attachmentIdsOf(message) {
  const list = message?.attachments;
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const a of list) {
    const id = typeof a === 'string' ? String(a).trim() : String(a?.mediaId || '').trim();
    if (!id || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

/** Ids → the shape the POST body wants. */
export function toAttachments(ids) {
  return (ids || []).map((mediaId) => ({ type: 'media', mediaId }));
}

/** How many more photos this message can take before the server's cap bites. */
export function attachmentRoom(ids) {
  return Math.max(0, MAX_MESSAGE_ATTACHMENTS - (ids?.length || 0));
}

/**
 * Add a just-uploaded photo to a draft — de-duped and capped exactly like the
 * server, so the composer never shows a thumbnail the POST is about to discard.
 *
 * This is the LAST gate, not the first: the cap is also checked when files are
 * picked, where the system picker can refuse them before anything uploads. This
 * one catches what that cannot — two uploads finishing at once, each having seen
 * room for itself.
 */
export function appendDraftPhoto(list, item) {
  const current = list || [];
  if (!item || !item.id) return current;
  if (current.length >= MAX_MESSAGE_ATTACHMENTS) return current;
  if (current.some((m) => m.id === item.id)) return current;
  return [...current, item];
}

/** Take one photo back off the draft. The file stays in the vault. */
export function removeDraftPhoto(list, id) {
  const target = String(id);
  return (list || []).filter((m) => String(m.id) !== target);
}

/**
 * Is there anything to send?
 *
 * A PHOTO IS A MESSAGE. The server agrees — it refuses only when the words AND
 * the attachments are both empty — so the send key must not sit dark on a photo
 * with nothing typed beside it, which is the one thing people most often send on
 * its own.
 */
export function canSendMessage(content, ids) {
  return String(content ?? '').trim().length > 0 || (ids?.length || 0) > 0;
}

/**
 * What a wordless message says where only one line fits.
 *
 * '' for a count of zero, so a caller falls straight through to the text. The
 * wording matches the lock-screen preview the server builds for the same case, so
 * a message reads the same in a list as it did in the notification.
 */
export function attachmentSummary(count) {
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 0) return '';
  return Math.floor(n) === 1 ? 'Photo' : `${Math.floor(n)} photos`;
}

/**
 * The one line a thread summary shows for a message: its words, or — when it has
 * none — what came instead of them.
 */
export function messagePreviewLine(message) {
  const text = String(message?.content ?? '').trim();
  if (text) return text;
  return attachmentSummary(attachmentIdsOf(message).length);
}
