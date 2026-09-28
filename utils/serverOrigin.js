/**
 * What a saved server address becomes on the wire. Pure, so it is testable
 * without the native modules context/ServerContext pulls in; that context
 * re-exports these, so every existing importer keeps working.
 *
 * The pond every install starts on is also the pond DIRECTORY: signing in by
 * phone asks it which ponds know the number, so nobody types a pond address.
 * The desktop app starts on the same one (DEFAULT_POND in the tray). A full
 * origin on purpose — serverOrigin() keeps it exactly as written.
 */
export const DEFAULT_POND = 'https://app.t3d.ca';

// A host that is reached on the pond's own port, plainly: an IP literal,
// localhost, or a LAN-only name (.local / .lan / .home / .internal / a single
// label). Every other bare name is public DNS — a tunnel (Cloudflare, Tailscale
// Funnel), which serves TLS on 443 and nothing on :3000.
const LOCAL_HOST_RE = /^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:.]+\]|[0-9a-f:]*:[0-9a-f:.]*|[^.]+|.+\.(local|lan|home|internal))$/i;
export const isLocalHost = (host) => LOCAL_HOST_RE.test(String(host || '').trim());

// Normalize whatever the user saved into a server ORIGIN. Accepted forms:
//   '100.64.0.1'                → http://100.64.0.1:3000     (IP / local name — the classic pond port)
//   '192.168.1.50:3000'         → http://192.168.1.50:3000   (host:port — the port is the user's word)
//   'app.t3d.ca'                → https://app.t3d.ca         (public DNS name — a tunnel, TLS on 443)
//   'https://pc.tail123.ts.net' → https://pc.tail123.ts.net  (URL — its scheme + port ARE the address)
// Every base-URL builder (the api wrapper, the health check, the three
// socket.io hooks, the login screen's invite preview) goes through this. The
// old code glued `http://` + ip + `:3000` in seven separate places, which made
// URL-shaped servers impossible to enter at all; and until 2026-09-27 a bare
// DNS name got the same treatment, so the TestFlight build's `app.t3d.ca`
// became `http://app.t3d.ca:3000` — an address nothing answers on.
export const serverOrigin = (raw) => {
  const s = String(raw || '').trim().replace(/\/+$/, '');
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[^:]+:\d+$/.test(s) || /^\[[0-9a-f:.]+\]:\d+$/i.test(s)) return `http://${s}`;
  return isLocalHost(s) ? `http://${s}:3000` : `https://${s}`;
};
