import { Platform, Share } from 'react-native';

/**
 * Hand ONE link to the OS share sheet.
 *
 * The bug this exists to prevent: `Share.share({ message: url, url })` looks
 * like belt-and-braces — "give the sheet the link both ways, whichever it
 * prefers" — and it is wrong. React Native's iOS implementation builds an ARRAY
 * of activity items and appends one per field it was given, so passing both
 * hands UIActivityViewController the same address twice. The sheet then titles
 * itself "2 Links", and the apps behind it act on both: Messages and WhatsApp
 * paste the URL twice, Copy copies a doubled string.
 *
 * The two platforms genuinely want different fields, which is what makes the
 * "pass both" instinct so tempting:
 *
 *   iOS     — `url` becomes an NSURL, which is what earns the rich link
 *             preview (title, favicon, thumbnail) in Messages and Mail.
 *             `message` would be a plain NSString: one item still, but no
 *             preview.
 *   Android — `url` is ignored outright; only `message` reaches the intent.
 *
 * So: exactly one field, chosen by platform, never both.
 *
 * The same rule is why prose that CONTAINS a link (an invite blurb, say) passes
 * `message` alone and must not gain a `url` beside it — that would split one
 * invitation into two items in exactly the way described above.
 *
 * @param url      the link to share.
 * @param options  `{ title }` — the Android chooser's title and the iOS mail
 *                 subject. It is metadata, not an activity item, so it does not
 *                 count toward the item total.
 * @returns the Share.share result, or null for a url that isn't one.
 */
export default async function shareLink(url, { title } = {}) {
  const link = typeof url === 'string' ? url.trim() : '';
  if (!link) return null;
  const content = Platform.OS === 'ios' ? { url: link } : { message: link };
  if (title) content.title = title;
  return Share.share(content, title ? { subject: title, dialogTitle: title } : undefined);
}
