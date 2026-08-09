/**
 * inviteLinks — pull an invite { code, server } out of whatever the user
 * pasted or tapped.
 *
 * Deliberately UNANCHORED matching: the common real-world paste is the entire
 * invite SMS ("You're invited to … Tap to join: https://host/join/CODE"), so
 * the link is fished out of the surrounding text. A hand-typed code never
 * contains "://", so per-keystroke input falls through untouched (null).
 *
 * Two shapes, matching what the server mints (server.js joinUrlFor + the
 * /join/:code landing page's deep link):
 *   • turtle://join/CODE?server=HOST — the deep link; server optional.
 *   • https://pond-host/join/CODE    — the landing URL invitees are texted;
 *     its origin IS the pond's public address, so the link self-configures.
 *
 * Returns { code, server } with server null when the text carried none, or
 * null when nothing link-shaped is present.
 */
export const parseInviteLink = (text) => {
  const s = String(text || '').trim();
  let m = s.match(/turtle:\/\/join\/([A-Za-z0-9-]{4,24})(?:\?([^#\s]*))?/i);
  if (m) {
    const qs = m[2] || '';
    const serverParam = qs.split('&').map((p) => p.split('=')).find(([k]) => k === 'server');
    let server = null;
    if (serverParam && serverParam[1]) {
      try {
        server = decodeURIComponent(serverParam[1]).trim();
      } catch {
        server = serverParam[1].trim(); // malformed escape — use it verbatim
      }
    }
    return { code: m[1], server: server || null };
  }
  m = s.match(/(https?:\/\/[^/\s]+)\/join\/([A-Za-z0-9-]{4,24})/i);
  if (m) return { code: m[2], server: m[1] };
  return null;
};
