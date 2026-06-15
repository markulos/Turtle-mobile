// Metro config with CONNECTION DIAGNOSTICS for the Turtle dev workflow.
//
// Two additions over the Expo default, both tagged [turtle-metro] so they're
// easy to spot / grep / paste:
//
//   1. A startup banner: which hostname Metro will ADVERTISE (the
//      REACT_NATIVE_PACKAGER_HOSTNAME env — printed JSON-stringified so a
//      stray trailing space is visible), every IPv4 address this machine
//      holds, and which URL the phone should be entering.
//
//   2. Request logging: EVERY HTTP request that reaches Metro is logged with
//      the caller's IP. This is the decisive debugging signal — when the
//      phone taps "connect":
//        • a [turtle-metro] line appears  → the phone IS reaching Metro; any
//          failure is in what happens next (and will be in the log too).
//        • nothing appears               → the request never arrived: dead
//          Metro, wrong URL, firewall, or the phone's VPN/Wi-Fi.
const { getDefaultConfig } = require('expo/metro-config');
const os = require('os');

const config = getDefaultConfig(__dirname);

// ── 1) Startup banner ──────────────────────────────────────────────────────
const hostnameEnv = process.env.REACT_NATIVE_PACKAGER_HOSTNAME;
const ipv4s = [];
for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
  for (const a of addrs || []) {
    if (a.family === 'IPv4' && !a.internal) ipv4s.push(`${a.address} (${name})`);
  }
}
const advertised = (hostnameEnv || '').trim();
console.log('┌─[turtle-metro]──────────────────────────────────────────────');
console.log(`│ started:    ${new Date().toLocaleString()}`);
console.log(`│ project:    ${__dirname}`);
console.log(`│ node:       ${process.version}`);
console.log(`│ hostname env (REACT_NATIVE_PACKAGER_HOSTNAME): ${hostnameEnv === undefined ? 'NOT SET → Metro advertises the LAN IP' : JSON.stringify(hostnameEnv)}`);
console.log(`│ machine IPv4s: ${ipv4s.join('  ·  ') || '(none?!)'}`);
console.log(`│ phone should connect to: http://${advertised || (ipv4s[0] || 'THIS-MACHINE-IP').split(' ')[0]}:8081`);
console.log('└─────────────────────────────────────────────────────────────');

// ── 2) Log every incoming request with the caller's IP ────────────────────
config.server = config.server || {};
const prevEnhance = config.server.enhanceMiddleware;
config.server.enhanceMiddleware = (middleware, server) => {
  const wrapped = (req, res, next) => {
    try {
      const ip = (req.socket && req.socket.remoteAddress) || '?';
      const url = String(req.url || '').slice(0, 100);
      console.log(`[turtle-metro] ${new Date().toLocaleTimeString()} ← ${ip}  ${req.method} ${url}`);
    } catch (e) { /* logging must never break serving */ }
    return middleware(req, res, next);
  };
  return prevEnhance ? prevEnhance(wrapped, server) : wrapped;
};

module.exports = config;
