import { getAuthIdentity, getAuthTokenGeneration } from '../authIdentity';

const jwt = (payload, signature = 'signature') => {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value))
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.${signature}`;
};

describe('auth identity', () => {
  test('keeps one immutable identity across token refreshes for the same user', () => {
    const first = jwt({ sub: 'user-a', exp: 100 }, 'first');
    const refreshed = jwt({ sub: 'user-a', exp: 200 }, 'second');

    expect(getAuthIdentity(first)).toBe('sub:user-a');
    expect(getAuthIdentity(refreshed)).toBe('sub:user-a');
    expect(getAuthTokenGeneration(first)).not.toBe(getAuthTokenGeneration(refreshed));
  });

  test('does not collapse distinct account claims into one owner', () => {
    expect(getAuthIdentity(jwt({ userId: 'account-a' }))).toBe('userId:account-a');
    expect(getAuthIdentity(jwt({ userId: 'account-b' }))).toBe('userId:account-b');
  });

  test('uses a non-secret stable fingerprint when a legacy token has no user claim', () => {
    const token = jwt({ role: 'legacy-admin' });
    const identity = getAuthIdentity(token);

    expect(identity).toMatch(/^token:[a-f0-9]{8}$/);
    expect(identity).not.toContain(token);
    expect(getAuthIdentity(token)).toBe(identity);
  });

  test('returns no authenticated identity or generation without a token', () => {
    expect(getAuthIdentity(null)).toBeNull();
    expect(getAuthTokenGeneration('')).toBeNull();
  });
});
