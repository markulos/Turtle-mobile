/**
 * What a saved server address becomes on the wire. The TestFlight build turned
 * `app.t3d.ca` into `http://app.t3d.ca:3000`, an address nothing answers on
 * (the tunnel serves TLS on 443 and nothing else). These pin the rule: a bare
 * public name is an https origin; IPs and local names keep the pond's plain
 * port; a typed port is the user's word; a URL is kept as written.
 */
import { DEFAULT_POND, isLocalHost, serverOrigin } from '../../utils/serverOrigin';

describe('serverOrigin', () => {
  test('a bare public DNS name is a tunnel: https on 443, no port appended', () => {
    expect(serverOrigin('app.t3d.ca')).toBe('https://app.t3d.ca');
    expect(serverOrigin('pc.tail123.ts.net')).toBe('https://pc.tail123.ts.net');
    expect(serverOrigin('app.t3d.ca/')).toBe('https://app.t3d.ca');
  });

  test('an IP literal, localhost or a LAN-only name keeps the plain pond port', () => {
    expect(serverOrigin('192.168.1.50')).toBe('http://192.168.1.50:3000');
    expect(serverOrigin('100.64.0.1')).toBe('http://100.64.0.1:3000');
    expect(serverOrigin('localhost')).toBe('http://localhost:3000');
    expect(serverOrigin('turtle-pc')).toBe('http://turtle-pc:3000');
    expect(serverOrigin('turtle.local')).toBe('http://turtle.local:3000');
    expect(serverOrigin('pond.lan')).toBe('http://pond.lan:3000');
  });

  test('a typed port is the user\'s word, on any name', () => {
    expect(serverOrigin('192.168.1.50:3000')).toBe('http://192.168.1.50:3000');
    expect(serverOrigin('app.t3d.ca:3000')).toBe('http://app.t3d.ca:3000');
    expect(serverOrigin('pc.tail123.ts.net:3100')).toBe('http://pc.tail123.ts.net:3100');
  });

  test('a URL is kept as written, minus a trailing slash', () => {
    expect(serverOrigin('https://app.t3d.ca')).toBe('https://app.t3d.ca');
    expect(serverOrigin('https://pc.tail123.ts.net/')).toBe('https://pc.tail123.ts.net');
    expect(serverOrigin('http://100.85.19.127:3100')).toBe('http://100.85.19.127:3100');
  });

  test('nothing saved is no origin, not a broken one', () => {
    expect(serverOrigin('')).toBe('');
    expect(serverOrigin(null)).toBe('');
    expect(serverOrigin('   ')).toBe('');
  });

  test('the pond every install starts on is a full https origin', () => {
    expect(DEFAULT_POND).toBe('https://app.t3d.ca');
    expect(serverOrigin(DEFAULT_POND)).toBe('https://app.t3d.ca');
  });
});

describe('isLocalHost', () => {
  test('local things', () => {
    for (const h of ['localhost', '10.0.0.2', '[::1]', 'fe80::1', 'turtle-pc', 'nas.local', 'pond.home', 'box.internal']) {
      expect(isLocalHost(h)).toBe(true);
    }
  });
  test('public names', () => {
    for (const h of ['app.t3d.ca', 'pc.tail123.ts.net', 'example.com']) {
      expect(isLocalHost(h)).toBe(false);
    }
  });
});
