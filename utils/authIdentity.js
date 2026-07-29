import { Buffer } from 'buffer';

const fingerprint = (value) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const decodePayload = (token) => {
  try {
    const segment = String(token).split('.')[1];
    if (!segment) return null;
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return null;
  }
};

export function getAuthTokenGeneration(token) {
  return token ? `token:${fingerprint(String(token))}` : null;
}

export function getAuthIdentity(token) {
  if (!token) return null;
  const payload = decodePayload(token);
  for (const claim of ['sub', 'userId', 'user_id', 'id', 'phone']) {
    const value = payload?.[claim];
    if (typeof value === 'string' && value.trim()) return `${claim}:${value.trim()}`;
    if (typeof value === 'number' && Number.isFinite(value)) return `${claim}:${value}`;
  }
  return getAuthTokenGeneration(token);
}
