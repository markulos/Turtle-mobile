import nacl from 'tweetnacl';
import * as Crypto from 'expo-crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Phone side of the cross-device biometric vault unlock.
//
// The browser publishes an ephemeral public key. After a local biometric check
// this device seals the master password TO that key with an anonymous-sender
// NaCl box (a fresh ephemeral keypair of our own) so ONLY that browser tab can
// open it. The server relays opaque bytes — it never sees the master password.
//
// No Buffer / btoa dependency: base64 + UTF-8 are done by hand so this works on
// Hermes without polyfills. Randomness comes from expo-crypto (a real CSPRNG),
// wired into tweetnacl which otherwise has none on React Native.
// ─────────────────────────────────────────────────────────────────────────────

let prngReady = false;
function ensurePRNG() {
  if (prngReady) return;
  nacl.setPRNG((x, n) => {
    const bytes = Crypto.getRandomBytes(n); // CSPRNG, synchronous Uint8Array
    for (let i = 0; i < n; i++) x[i] = bytes[i];
  });
  prngReady = true;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytesToB64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[b2 & 63] : '=';
  }
  return out;
}

function b64ToBytes(str) {
  const lookup = (ch) => (ch === '=' ? 64 : B64.indexOf(ch));
  const clean = String(str).replace(/[^A-Za-z0-9+/=]/g, '');
  const out = [];
  for (let i = 0; i + 3 < clean.length; i += 4) {
    const e0 = lookup(clean[i]);
    const e1 = lookup(clean[i + 1]);
    const e2 = lookup(clean[i + 2]);
    const e3 = lookup(clean[i + 3]);
    out.push((e0 << 2) | (e1 >> 4));
    if (e2 !== 64) out.push(((e1 & 15) << 4) | (e2 >> 2));
    if (e3 !== 64) out.push(((e2 & 3) << 6) | e3);
  }
  return new Uint8Array(out);
}

function utf8ToBytes(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c <= 0xdbff) {
      const c2 = str.charCodeAt(++i);
      const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return new Uint8Array(out);
}

/**
 * Seal `message` (the master password) TO the browser's public key.
 * Returns base64 { sealed, nonce, phonePub } to POST to the approve endpoint.
 */
export function sealTo(message, recipientPubB64) {
  ensurePRNG();
  const ephemeral = nacl.box.keyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const boxed = nacl.box(utf8ToBytes(message), nonce, b64ToBytes(recipientPubB64), ephemeral.secretKey);
  return {
    sealed: bytesToB64(boxed),
    nonce: bytesToB64(nonce),
    phonePub: bytesToB64(ephemeral.publicKey),
  };
}
