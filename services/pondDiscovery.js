// LAN discovery for Turtle ponds — powers the login screen's alias search.
//
// A fresh install can't ask "which server invited me?" out of thin air (ponds
// are self-hosted; there's no central registry), so we do what Plex/Chromecast
// do: sweep the local network for servers answering GET /api/auth/pond/info.
// Each hit self-describes { name, alias, memberCount, discoverable, invited } —
// and a PRIVATE pond only answers at all when the supplied phone number is on
// its invite list (enforced server-side).
//
// Subnet selection: expo-network (when present — it's a native module, so it
// activates after the next dev-app rebuild) gives the device's own /24.
// Until then we sweep the common home subnets, which covers most routers.
import { serverOrigin } from '../context/ServerContext';

let Network = null;
try {
  // eslint-disable-next-line global-require
  Network = require('expo-network');
} catch (e) {
  Network = null;
}

const COMMON_SUBNETS = ['192.168.0', '192.168.1', '192.168.2', '10.0.0'];
const PROBE_TIMEOUT_MS = 600;
const CONCURRENCY = 32;

// Public Tailscale Funnel ponds — HTTPS URLs reachable from ANYWHERE (cellular,
// off the home LAN), unlike the subnet sweep below which only works on Wi-Fi.
// Seeded with the known pond; the login screen unions this with any funnel the
// user has previously connected to (persisted in AsyncStorage), and walks the
// whole list to confirm which pond invited a given number. A private pond
// reveals itself ONLY to a phone it invited (server-enforced via
// /api/auth/pond/info?phone=), so the funnel that answers IS the right server.
// Seeded ONLY from the environment. This was a hardcoded personal funnel
// hostname, which shipped one person's server address to every install; the
// remembered-funnel list (AsyncStorage) and the invite link are where a real
// pond address comes from. Comma-separated, dev builds only.
export const SEED_FUNNELS = ((__DEV__ && process.env.EXPO_PUBLIC_TURTLE_SEED_FUNNELS) || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
// Funnels go over the internet/tailnet with a TLS handshake, so they need a far
// longer leash than the 600 ms LAN probe (which is one hop away).
const FUNNEL_TIMEOUT_MS = 4000;

async function deviceSubnet(onStatus) {
  try {
    if (!Network || !Network.getIpAddressAsync) {
      onStatus && onStatus('expo-network module not in this build — sweeping common home subnets');
      console.log('[pond-scan] expo-network unavailable → fallback subnets');
      return null;
    }
    const ip = await Network.getIpAddressAsync();
    console.log('[pond-scan] device IP from expo-network:', ip);
    if (typeof ip === 'string' && /^\d+\.\d+\.\d+\.\d+$/.test(ip) && !ip.startsWith('169.254')) {
      const subnet = ip.split('.').slice(0, 3).join('.');
      // A 10.x carrier-range address with Wi-Fi OFF means we'd scan the
      // CELLULAR network — useless. Surface that loudly: it's the #1 reason
      // a scan finds nothing.
      if (/^10\.|^100\.|^172\./.test(ip)) {
        onStatus && onStatus(`device IP ${ip} looks like CELLULAR/VPN, not home Wi-Fi — turn Wi-Fi on for the scan`);
      } else {
        onStatus && onStatus(`device IP ${ip} → scanning ${subnet}.1-254`);
      }
      return subnet;
    }
    onStatus && onStatus(`device IP unusable (${String(ip)}) — sweeping common home subnets`);
  } catch (e) {
    console.log('[pond-scan] getIpAddressAsync failed:', e.message);
    onStatus && onStatus('could not read device IP — sweeping common home subnets');
  }
  return null;
}

// Probe ONE origin's /api/auth/pond/info. Returns the self-described pond (with
// `host` = the origin we probed, so the caller can save exactly what it can
// reach) or null. Shared by the LAN sweep and the funnel walk.
async function probeOrigin(origin, phone, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const qs = phone ? `?phone=${encodeURIComponent(phone)}` : '';
    const r = await fetch(`${origin}/api/auth/pond/info${qs}`, { signal: ctrl.signal });
    if (!r.ok) return null;
    const d = await r.json().catch(() => null);
    if (d && d.success && d.pond) return { ...d.pond, host: origin };
  } catch (e) {
    /* not a turtle server / no response — the overwhelmingly common case */
  } finally {
    clearTimeout(t);
  }
  return null;
}

// LAN probe: a bare host on the home subnet. We keep `host` as the bare host
// (not the full http://…:3000 origin) so the existing UI shows/saves it exactly
// as before — serverOrigin() re-expands it on save.
async function probe(host, phone) {
  const p = await probeOrigin(`http://${host}:3000`, phone, PROBE_TIMEOUT_MS);
  return p ? { ...p, host } : null;
}

// Sweep for ponds. `phone` (optional) unlocks private ponds you're invited to.
// `onFound(pond)` streams hits as they land so the UI can show them live.
// Returns the full list when the sweep completes.
export async function scanForPonds(phone, onFound, onStatus) {
  const own = await deviceSubnet(onStatus);
  // Known own subnet → scan just it (fast, exact). Unknown → sweep the usual
  // suspects; slower, but it's a one-tap fallback until the rebuild.
  const subnets = own ? [own] : COMMON_SUBNETS;
  console.log('[pond-scan] scanning subnets:', subnets.join(', '), phone ? `(phone supplied for private ponds)` : '(no phone — only OPEN ponds will answer)');
  const hosts = [];
  for (const s of subnets) {
    for (let i = 1; i <= 254; i++) hosts.push(`${s}.${i}`);
  }
  const found = [];
  let idx = 0;
  let answered = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (idx < hosts.length) {
        const h = hosts[idx++];
        const p = await probe(h, phone);
        if (p) {
          answered++;
          console.log('[pond-scan] HIT:', h, '→', p.name, '@' + (p.alias || ''), 'host=' + p.host);
          found.push(p);
          if (onFound) onFound(p);
        }
        // Progress heartbeat every ~64 probes so the log shows liveness.
        if (idx % 64 === 0) console.log(`[pond-scan] progress ${idx}/${hosts.length}, hits: ${answered}`);
      }
    }),
  );
  console.log(`[pond-scan] DONE: probed ${hosts.length} hosts across [${subnets.join(', ')}], found ${found.length} pond(s)`);
  onStatus && onStatus(`probed ${hosts.length} addresses on ${subnets.join(', ')} — found ${found.length} pond${found.length === 1 ? '' : 's'}`);
  return found;
}

// Normalize + de-dupe a list of funnel URLs (trim, drop trailing slash, blanks).
const cleanFunnels = (funnels) =>
  Array.from(new Set((funnels || []).map((f) => String(f || '').trim().replace(/\/+$/, '')).filter(Boolean)));

// Probe a list of funnel URLs (in parallel) with the phone. Returns the ponds
// that REVEAL themselves to this number — i.e. ones that invited it, or that are
// open for search. `onFound(pond)` streams hits so the login list can show them
// live alongside LAN hits. Each hit's `host` is the funnel URL itself (set by
// probeOrigin), which is the address an invitee can reach from anywhere.
export async function scanFunnels(phone, funnels, onFound) {
  const list = cleanFunnels(funnels);
  if (!list.length) return [];
  console.log('[funnel-scan] probing', list.length, 'funnel(s)', phone ? '(phone supplied)' : '(no phone — open ponds only)');
  const found = [];
  await Promise.all(
    list.map(async (origin) => {
      const p = await probeOrigin(origin, phone, FUNNEL_TIMEOUT_MS);
      if (p) {
        console.log('[funnel-scan] HIT:', origin, '→', p.name, p.invited ? '(invited)' : '(open)');
        found.push(p);
        if (onFound) onFound(p);
      }
    }),
  );
  console.log(`[funnel-scan] DONE: ${found.length}/${list.length} funnel(s) answered for this number`);
  return found;
}

// Find the ONE funnel URL to save for a number, preferring a pond that actually
// INVITED it over a merely-open one. Returns the funnel URL string, or null.
export async function confirmPondForPhone(phone, funnels) {
  const ponds = await scanFunnels(phone, funnels);
  if (!ponds.length) return null;
  const chosen = ponds.find((p) => p.invited) || ponds[0];
  return chosen ? chosen.host : null;
}

// Decide the server to use for a number right after the phone is entered:
//   • If the server we ALREADY have confirms this number is invited, keep it
//     (returns null = "no change") — so a fast LAN/Tailscale path isn't traded
//     for a slower funnel hop when you're already on the right network at home.
//   • Otherwise (current server unreachable or doesn't know this number, e.g.
//     a fresh install on cellular) return the funnel URL whose pond invited it.
// Both probes run concurrently, so the worst case is one timeout, not two.
export async function confirmServerForPhone(currentServer, phone, funnels) {
  const curProbe = currentServer
    ? probeOrigin(serverOrigin(currentServer), phone, FUNNEL_TIMEOUT_MS)
    : Promise.resolve(null);
  const [cur, funnelUrl] = await Promise.all([curProbe, confirmPondForPhone(phone, funnels)]);
  if (cur && cur.invited) return null; // current server already invited this number — keep it
  return funnelUrl; // switch to the funnel that did (or null if none matched)
}
