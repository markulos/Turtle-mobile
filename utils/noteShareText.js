/**
 * noteShareText — a note as plain text, ready to be the body of a message.
 *
 * The point is a note you can hand to WhatsApp, Signal, Mail or anything else
 * that takes text, without the recipient needing Turtle or a link they may not
 * be able to open. So: no markup, no URLs back into the pond, no metadata —
 * just the note's own words, in the order you'd read them.
 *
 * The parts, blank-line separated (which is the "space between the title and
 * the body" this was asked for):
 *
 *   title         only shared-link notes carry one — it's the unfurled og:title
 *   description   also unfurl-only; the summary under the headline
 *   content       the note's actual body, and for a link note the bare URL
 *
 * Title first and content last is deliberate for the link case: it reads as
 * headline → summary → link, which is the shape a person expects a forwarded
 * article to arrive in. A plain note has only `content`, so it shares as itself
 * with nothing bolted on.
 *
 * Tags are left OUT on purpose. They are how YOU file a note, not part of what
 * it says, and "#moodboard/wedding" arriving in someone's chat is noise.
 *
 * Kept free of react-native imports so it runs under plain `node --test` as
 * well as jest — the whole utils/ directory holds to that.
 */

export function noteShareText(note) {
  if (!note) return '';

  const parts = [];
  const push = (value) => {
    const s = String(value ?? '').trim();
    if (!s) return;
    // An unfurl quite often copies the og:title into the description (and a
    // bare-URL note can have the host as both), so a part that repeats one we
    // already have is dropped rather than sent twice.
    if (parts.includes(s)) return;
    parts.push(s);
  };

  push(note.title);
  push(note.description);
  push(note.content);

  return parts.join('\n\n');
}

export default noteShareText;
