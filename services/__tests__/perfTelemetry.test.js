/**
 * The pure halves of telemetry: route-key normalization (so slow endpoints
 * AGGREGATE instead of splintering per photo id) and the bounded buffer.
 * The fetch wrapper and timers are integration surface, deliberately not
 * unit-faked here.
 */
import { normalizeRouteKey, record, _internals } from '../perfTelemetry';

describe('normalizeRouteKey', () => {
  it('collapses ids, uuids, and app-style keys to :x', () => {
    expect(normalizeRouteKey('http://100.85.19.127:3100/api/media/thumbnails/079a4b38-5235-40f6-8721-52804ce7843c.jpg'))
      .toBe('api:/api/media/thumbnails/:x');
    expect(normalizeRouteKey('http://h:3000/api/tasks/1786550048854'))
      .toBe('api:/api/tasks/:x');
    expect(normalizeRouteKey('http://h:3000/api/media/file/media_1787850105485_tzxinjdsq.mp4'))
      .toBe('api:/api/media/file/:x');
  });

  it('keeps stable segments and drops the query', () => {
    expect(normalizeRouteKey('https://app.t3d.ca/api/tasks/counts?scope=all'))
      .toBe('api:/api/tasks/counts');
  });

  it('never throws on garbage', () => {
    expect(normalizeRouteKey(null)).toMatch(/^api:/);
    expect(normalizeRouteKey({})).toMatch(/^api:/);
  });
});

describe('record buffer', () => {
  it('caps at 500, oldest first out', () => {
    _internals.buffer.length = 0;
    for (let i = 0; i < 520; i++) record('js_stall', i);
    expect(_internals.buffer.length).toBe(500);
    expect(_internals.buffer[0].ms).toBe(20); // 0..19 evicted
    expect(_internals.buffer[499].ms).toBe(519);
  });

  it('rounds ms and stamps at', () => {
    _internals.buffer.length = 0;
    record('cold_start', 123.7);
    expect(_internals.buffer[0].ms).toBe(124);
    expect(typeof _internals.buffer[0].at).toBe('number');
  });
});
