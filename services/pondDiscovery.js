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

async function probe(host, phone) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const qs = phone ? `?phone=${encodeURIComponent(phone)}` : '';
    const r = await fetch(`http://${host}:3000/api/auth/pond/info${qs}`, { signal: ctrl.signal });
    if (!r.ok) return null;
    const d = await r.json().catch(() => null);
    if (d && d.success && d.pond) return { ...d.pond, host };
  } catch (e) {
    /* not a turtle server / no response — the overwhelmingly common case */
  } finally {
    clearTimeout(t);
  }
  return null;
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
