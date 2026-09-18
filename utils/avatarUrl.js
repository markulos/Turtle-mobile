/**
 * resolveAvatarUrl — a stored avatar path as something an <Image> can load.
 *
 * The server hands back `avatarUrl` as a path relative to its own origin
 * ("/api/avatars/ab12.jpg?v=…"), because the pond is reachable at several
 * addresses — a LAN ip, a Tailscale name, app.t3d.ca — and baking one of them
 * into a row would rot the moment you changed how you connect. So the client
 * joins it to whatever base URL it is actually talking to.
 *
 * That join was written out by hand at every call site (the profile, Settings,
 * a note's sharer), each slightly differently: one tested `startsWith('/')`,
 * another `^https?:`, so an absolute URL was handled in one place and mangled
 * in the next. This is the one version.
 */

/**
 * Anything carrying a URI SCHEME is already loadable and must be left alone —
 * and the list is not just http/https. An optimistic local pick straight out
 * of the image picker is `file://` on Android, `ph://` on iOS, sometimes
 * `content://`; a preview can be `data:` or `blob:`. Enumerating them is how
 * you miss one and prepend an origin to it, so this matches the SHAPE of a
 * scheme instead (RFC 3986: a letter, then letters/digits/+/-/.).
 */
const ABSOLUTE = /^[a-z][a-z0-9+.-]*:/i;

export function resolveAvatarUrl(url, baseUrl) {
  const raw = String(url == null ? '' : url).trim();
  if (!raw) return null;
  // Already absolute — an uploaded file:// preview, or a pond configured with
  // a full URL. Joining a base onto it would break it.
  if (ABSOLUTE.test(raw)) return raw;

  // The API base ends in /api; the avatar path carries its own /api prefix, so
  // the origin is what we want to join to.
  const origin = String(baseUrl == null ? '' : baseUrl)
    .trim()
    .replace(/\/api\/?$/i, '')
    .replace(/\/+$/, '');
  if (!origin) return null;

  return `${origin}${raw.startsWith('/') ? '' : '/'}${raw}`;
}

export default resolveAvatarUrl;
