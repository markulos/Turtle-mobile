/**
 * How a track row reads at a glance: is it filling up, is it kept, is it out
 * of reach. The two states worth pinning are the ones hardest to get on
 * screen by hand — a download half way through, and a phone with no pond.
 */
import { rowOfflineAppearance } from '../musicRowAppearance';

describe('a row with nothing downloaded', () => {
  it('is plain while the pond is reachable', () => {
    expect(rowOfflineAppearance({ state: 'absent' }, true)).toEqual({
      state: 'absent', kept: false, fillPercent: 0, unreachable: false,
    });
  });

  it('greys out when the pond cannot be reached', () => {
    expect(rowOfflineAppearance({ state: 'absent' }, false).unreachable).toBe(true);
  });
});

describe('a row being downloaded', () => {
  it('fills to the percentage', () => {
    expect(rowOfflineAppearance({ state: 'downloading', progress: 0.42 }, true).fillPercent).toBe(42);
  });

  it('rounds to whole percents, so the bar does not jitter', () => {
    expect(rowOfflineAppearance({ state: 'downloading', progress: 0.4249 }, true).fillPercent).toBe(42);
  });

  it('never runs past the row, or short of it', () => {
    expect(rowOfflineAppearance({ state: 'downloading', progress: 1.4 }, true).fillPercent).toBe(100);
    expect(rowOfflineAppearance({ state: 'downloading', progress: -1 }, true).fillPercent).toBe(0);
    expect(rowOfflineAppearance({ state: 'downloading' }, true).fillPercent).toBe(0);
  });

  it('is NOT greyed offline — it is the one row making progress', () => {
    expect(rowOfflineAppearance({ state: 'downloading', progress: 0.5 }, false).unreachable).toBe(false);
  });
});

describe('a row kept on this device', () => {
  it('carries the tint and no fill', () => {
    const look = rowOfflineAppearance({ state: 'done', bytes: 1000 }, true);
    expect(look.kept).toBe(true);
    expect(look.fillPercent).toBe(0);
  });

  it('stays in full colour with no pond — that is the whole point', () => {
    expect(rowOfflineAppearance({ state: 'done', bytes: 1000 }, false)).toEqual({
      state: 'done', kept: true, fillPercent: 0, unreachable: false,
    });
  });
});

describe('a row whose download failed', () => {
  it('is not treated as kept', () => {
    const look = rowOfflineAppearance({ state: 'failed', error: 'nope' }, true);
    expect(look.kept).toBe(false);
    expect(look.fillPercent).toBe(0);
  });

  it('greys offline like any other track with no copy here', () => {
    expect(rowOfflineAppearance({ state: 'failed', error: 'nope' }, false).unreachable).toBe(true);
  });
});

describe('missing input', () => {
  it('reads as absent rather than throwing', () => {
    expect(rowOfflineAppearance(undefined, true).state).toBe('absent');
    expect(rowOfflineAppearance(null, false).unreachable).toBe(true);
  });
});
