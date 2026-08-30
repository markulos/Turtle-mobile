/**
 * The pure halves of telemetry: route-key normalization (so slow endpoints
 * AGGREGATE instead of splintering per photo id) and the bounded buffer.
 * The fetch wrapper and timers are integration surface, deliberately not
 * unit-faked here.
 */
import { normalizeRouteKey, record, createStallGate, createSuspensionFilter, _internals } from '../perfTelemetry';

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

describe('createStallGate', () => {
  const THRESHOLD = 100;

  it('records a genuine stall while the app stays active', () => {
    const gate = createStallGate();
    expect(gate.accept(450, THRESHOLD)).toBe(true);
  });

  it('ignores a beat that was on time', () => {
    const gate = createStallGate();
    expect(gate.accept(12, THRESHOLD)).toBe(false);
    expect(gate.accept(THRESHOLD, THRESHOLD)).toBe(false); // strictly greater
  });

  it('drops the beat spanning a background/resume, however huge', () => {
    const gate = createStallGate();
    gate.noteAppStateChange();          // → background, timer suspends
    gate.noteAppStateChange();          // → active, minutes later
    // The 9.5-minute sample that dominated prod's ranked pitfalls.
    expect(gate.accept(570614, THRESHOLD)).toBe(false);
  });

  it('resumes recording on the very next beat', () => {
    const gate = createStallGate();
    gate.noteAppStateChange();
    expect(gate.accept(570614, THRESHOLD)).toBe(false);
    expect(gate.accept(450, THRESHOLD)).toBe(true);
  });

  it('spends the amnesty even on a beat that was not late', () => {
    // Otherwise a quiet return from background leaves the gate armed and
    // swallows the next REAL stall instead of the suspended interval.
    const gate = createStallGate();
    gate.noteAppStateChange();
    expect(gate.accept(3, THRESHOLD)).toBe(false);
    expect(gate.accept(450, THRESHOLD)).toBe(true);
  });

  it('covers a transient inactive with no background event', () => {
    // iOS control centre / incoming call: 'inactive' then 'active', no
    // 'background' in between, but the thread was parked all the same.
    const gate = createStallGate();
    gate.noteAppStateChange();
    gate.noteAppStateChange();
    expect(gate.accept(8000, THRESHOLD)).toBe(false);
  });

  it('trusts the first beat it sees — cold_start already guards launch', () => {
    const gate = createStallGate();
    expect(gate.accept(450, THRESHOLD)).toBe(true);
  });
});

describe('createSuspensionFilter', () => {
  it('keeps a measurement that began and ended in the same run', () => {
    const f = createSuspensionFilter();
    const stamp = f.begin();
    expect(f.accept(stamp)).toBe(true);
  });

  it('drops the request that lived across a suspension', () => {
    // The prod case: a poll starts, the OS suspends the app for 200s, the
    // socket dies, and the rejection arrives carrying 200,168ms.
    const f = createSuspensionFilter();
    const stamp = f.begin();
    f.noteAppStateChange();   // → background
    f.noteAppStateChange();   // → active, 200s later
    expect(f.accept(stamp)).toBe(false);
  });

  it('judges overlapping requests independently', () => {
    // Unlike the heartbeat, several of these are in flight at once and a
    // single flag would condemn or spare all of them together.
    const f = createSuspensionFilter();
    const before = f.begin();
    f.noteAppStateChange();
    const after = f.begin();
    expect(f.accept(before)).toBe(false); // spanned the transition
    expect(f.accept(after)).toBe(true);   // started after it
  });

  it('trusts requests again once the app has settled', () => {
    const f = createSuspensionFilter();
    f.noteAppStateChange();
    const stamp = f.begin();
    expect(f.accept(stamp)).toBe(true);
  });
});
