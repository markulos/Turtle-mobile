import {
  normalizeBase,
  resolveCollabBase,
  readHealth,
  describeFailure,
  probeCollab,
  DEFAULT_COLLAB_BASE,
} from '../collabHealth';

describe('normalizeBase', () => {
  it('adds a scheme when one is missing', () => {
    expect(normalizeBase('collab.t3d.ca')).toBe('https://collab.t3d.ca');
  });

  it('keeps an explicit scheme, including http for a LAN address', () => {
    expect(normalizeBase('http://192.168.2.50:7878')).toBe('http://192.168.2.50:7878');
    expect(normalizeBase('https://collab.t3d.ca')).toBe('https://collab.t3d.ca');
  });

  it('strips trailing slashes so the probe never builds a //health URL', () => {
    expect(normalizeBase('https://collab.t3d.ca/')).toBe('https://collab.t3d.ca');
    expect(normalizeBase('https://collab.t3d.ca///')).toBe('https://collab.t3d.ca');
  });

  it('rejects anything that is not usable as a base', () => {
    expect(normalizeBase('')).toBeNull();
    expect(normalizeBase('   ')).toBeNull();
    expect(normalizeBase(null)).toBeNull();
    expect(normalizeBase(undefined)).toBeNull();
    expect(normalizeBase(42)).toBeNull();
    // A scheme with no host is not an address.
    expect(normalizeBase('https://')).toBeNull();
  });
});

describe('resolveCollabBase', () => {
  it('falls back to the default when the pond has no setting', () => {
    expect(resolveCollabBase(null)).toBe(DEFAULT_COLLAB_BASE);
    expect(resolveCollabBase({})).toBe(DEFAULT_COLLAB_BASE);
    expect(resolveCollabBase({ collab_base_url: '' })).toBe(DEFAULT_COLLAB_BASE);
  });

  it('uses the pond setting when it is usable', () => {
    expect(resolveCollabBase({ collab_base_url: 'http://10.0.0.9:7878' })).toBe('http://10.0.0.9:7878');
  });

  it('falls back rather than probing a malformed setting', () => {
    expect(resolveCollabBase({ collab_base_url: 'https://' })).toBe(DEFAULT_COLLAB_BASE);
  });
});

describe('readHealth', () => {
  it('accepts the bridge shape', () => {
    expect(readHealth({ status: 'ok', entities: 128 })).toEqual({ ok: true, entities: 128 });
  });

  it('tolerates a missing entity count', () => {
    expect(readHealth({ status: 'ok' })).toEqual({ ok: true, entities: null });
  });

  it('refuses anything that is not a bridge health reply', () => {
    // A proxy error page can return 200 with a body; it must not read as "up".
    expect(readHealth({ error: 'nope' }).ok).toBe(false);
    expect(readHealth('<html>').ok).toBe(false);
    expect(readHealth(null).ok).toBe(false);
    expect(readHealth({ status: 'degraded' }).ok).toBe(false);
  });
});

describe('describeFailure', () => {
  it('separates "nothing is serving it" from "it refused"', () => {
    // The distinction matters: a DNS record with no tunnel route times out,
    // while a running bridge answers. Different fixes.
    expect(describeFailure('timeout')).toMatch(/nothing is serving/i);
    expect(describeFailure('http', 403)).toMatch(/refused/i);
    expect(describeFailure('http', 404)).toMatch(/no \/health/i);
    expect(describeFailure('http', 500)).toMatch(/answered 500/);
  });
});

describe('probeCollab', () => {
  const okRes = (body, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });

  it('reports up, with the entity count, on a healthy bridge', async () => {
    const r = await probeCollab('https://collab.t3d.ca', {
      fetchImpl: async () => okRes({ status: 'ok', entities: 7 }),
    });
    expect(r.state).toBe('up');
    expect(r.entities).toBe(7);
    expect(r.url).toBe('https://collab.t3d.ca/health');
  });

  it('reports down on a non-2xx', async () => {
    const r = await probeCollab('https://collab.t3d.ca', {
      fetchImpl: async () => okRes({}, 404),
    });
    expect(r.state).toBe('down');
    expect(r.detail).toMatch(/no \/health/i);
  });

  it('reports down when a 200 body is not a bridge reply', async () => {
    // Exactly the Cloudflare-error-page case.
    const r = await probeCollab('https://collab.t3d.ca', {
      fetchImpl: async () => okRes({ nope: true }),
    });
    expect(r.state).toBe('down');
    expect(r.detail).toMatch(/not a bridge/i);
  });

  it('survives a body that is not JSON at all', async () => {
    const r = await probeCollab('https://collab.t3d.ca', {
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error('not json'); } }),
    });
    expect(r.state).toBe('down');
  });

  it('reports a timeout distinctly from a network error', async () => {
    const abort = Object.assign(new Error('Aborted'), { name: 'AbortError' });
    const timedOut = await probeCollab('https://collab.t3d.ca', {
      fetchImpl: async () => { throw abort; },
    });
    expect(timedOut.state).toBe('down');
    expect(timedOut.timedOut).toBe(true);
    expect(timedOut.detail).toMatch(/nothing is serving/i);

    const netFail = await probeCollab('https://collab.t3d.ca', {
      fetchImpl: async () => { throw new Error('Network request failed'); },
    });
    expect(netFail.timedOut).toBe(false);
    expect(netFail.detail).toMatch(/could not reach/i);
  });

  it('never throws, whatever fetch does', async () => {
    await expect(probeCollab('https://collab.t3d.ca', {
      fetchImpl: () => { throw new Error('sync boom'); },
    })).resolves.toMatchObject({ state: 'down' });
  });
});
