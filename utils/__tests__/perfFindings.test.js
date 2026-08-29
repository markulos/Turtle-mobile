/**
 * perfFindings — telemetry keys turned into a readable log.
 *
 * The things worth pinning down here are the ones that would be invisible if
 * they broke: an unrecognised key silently vanishing from the log, the server's
 * "worst first" ordering being quietly re-sorted, and a severity being coloured
 * in on a scale that doesn't apply to it.
 */
const {
  describeFinding, severityOf, buildFindings, buildFailures, describeFailureReason,
} = require('../perfFindings');

describe('describeFinding', () => {
  it('names the two measurements that are not routes', () => {
    expect(describeFinding('cold_start')).toMatchObject({ kind: 'launch', title: 'Cold start' });
    expect(describeFinding('js_stall')).toMatchObject({ kind: 'stall', title: 'Frozen UI' });
  });

  it('keeps an API route as its literal path', () => {
    // Not "Photo tags" — the path is what you go and look at, and an alias
    // would drift the moment the route moved.
    const found = describeFinding('api:/api/media/tags');
    expect(found.kind).toBe('api');
    expect(found.title).toBe('/api/media/tags');
  });

  it('explains the id placeholder only when there is one', () => {
    expect(describeFinding('api:/api/media/:x/tags').hint).toMatch(/":x" stands in for an id/);
    expect(describeFinding('api:/api/tasks').hint).not.toMatch(/:x/);
  });

  it('surfaces an unknown key rather than dropping it', () => {
    // A key this module has never heard of is exactly the one worth seeing.
    expect(describeFinding('something_new')).toMatchObject({
      kind: 'other',
      title: 'something_new',
    });
  });

  it('does not crash on a missing key', () => {
    expect(describeFinding(undefined).title).toBe('(unnamed)');
    expect(describeFinding('api:').title).toBe('/');
  });
});

describe('severityOf', () => {
  it('judges a blocked UI harder than a network request', () => {
    // 500ms: a slow-ish request, but half a second of frozen gesture is bad.
    expect(severityOf('api', 500)).toBe('ok');
    expect(severityOf('stall', 500)).toBe('warn');
  });

  it('forgives a cold start what it would not forgive a request', () => {
    expect(severityOf('api', 2500)).toBe('warn');
    expect(severityOf('launch', 2500)).toBe('ok');
  });

  it('escalates at the documented thresholds', () => {
    expect(severityOf('api', 999)).toBe('ok');
    expect(severityOf('api', 1000)).toBe('warn');
    expect(severityOf('api', 3000)).toBe('bad');
  });

  it('refuses to colour a scale it does not have', () => {
    // Judging a measurement whose units are unknown would dress a guess up as
    // a verdict.
    expect(severityOf('other', 999999)).toBe('ok');
    expect(severityOf('api', null)).toBe('ok');
  });
});

describe('buildFindings', () => {
  const PITFALLS = [
    { k: 'api:/api/media/gallery', count: 400, p50: 180, p95: 1200, max: 4000, totalMs: 90_000 },
    { k: 'js_stall', count: 30, p50: 140, p95: 1400, max: 2200, totalMs: 6_000 },
    { k: 'cold_start', count: 4, p50: 2200, p95: 2400, max: 2600, totalMs: 9_000 },
  ];

  it('preserves the server ordering instead of re-sorting by how slow things are', () => {
    // js_stall has the worst p95, but the gallery burns fifteen times more
    // total time — and that is the order in which fixing things helps.
    const { findings } = buildFindings(PITFALLS);
    expect(findings.map((f) => f.key)).toEqual([
      'api:/api/media/gallery', 'js_stall', 'cold_start',
    ]);
  });

  it('gives every row its share of the total waiting', () => {
    const { findings, totalMs } = buildFindings(PITFALLS);
    expect(totalMs).toBe(105_000);
    expect(findings[0].share).toBeCloseTo(90_000 / 105_000, 5);
    expect(findings.reduce((sum, f) => sum + f.share, 0)).toBeCloseTo(1, 5);
  });

  it('attaches a severity from each row’s own scale', () => {
    const [gallery, stall, cold] = buildFindings(PITFALLS).findings;
    expect(gallery.severity).toBe('warn');   // 1200ms request
    expect(stall.severity).toBe('bad');      // 1400ms of frozen thread
    expect(cold.severity).toBe('ok');        // a 2.4s launch is normal
  });

  it('reports how many rows it left out rather than implying there were none', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ k: `api:/r${i}`, totalMs: 20 - i }));
    const { findings, hiddenCount } = buildFindings(many);
    expect(findings).toHaveLength(12);
    expect(hiddenCount).toBe(8);
  });

  it('survives an empty or absent summary', () => {
    expect(buildFindings(undefined)).toEqual({ findings: [], totalMs: 0, hiddenCount: 0 });
    expect(buildFindings([]).findings).toEqual([]);
  });

  it('does not divide by zero when nothing burned any time', () => {
    const { findings } = buildFindings([{ k: 'js_stall', totalMs: 0, count: 0 }]);
    expect(findings[0].share).toBe(0);
  });

  it('carries the failure count so a slow row can also read as broken', () => {
    const { findings } = buildFindings([{ k: 'api:/x', count: 10, failed: 3, totalMs: 900 }]);
    expect(findings[0].failed).toBe(3);
  });
});

describe('describeFailureReason', () => {
  it('separates "never answered" from every kind of answer', () => {
    expect(describeFailureReason('network-error').label).toBe('No reply');
    expect(describeFailureReason('http 500').label).toBe('Server error 500');
  });

  it('reads statuses by class, keeping the code for when it matters', () => {
    expect(describeFailureReason('http 502').label).toBe('Server error 502');
    expect(describeFailureReason('http 404').label).toBe('Not found (404)');
    expect(describeFailureReason('http 400').label).toBe('Rejected (400)');
  });

  it('calls an expired session refused rather than broken', () => {
    // On a phone a 401 is usually a token that aged out, not a bug.
    expect(describeFailureReason('http 401').label).toBe('Refused (401)');
    expect(describeFailureReason('http 403').label).toBe('Refused (403)');
  });

  it('passes an unrecognised reason through verbatim', () => {
    expect(describeFailureReason('tunnel-collapsed').label).toBe('tunnel-collapsed');
  });

  it('has something to say about an empty reason', () => {
    expect(describeFailureReason('').label).toBe('Failed');
    expect(describeFailureReason(null).label).toBe('Failed');
  });
});

describe('buildFailures', () => {
  it('finds a route that fails instantly, which the time ranking buries', () => {
    // The reason this list exists at all: /broken is the most broken thing in
    // the pond and burns 80ms total, so it sits at the BOTTOM of the pitfalls.
    const pitfalls = [
      { k: 'api:/api/slow', count: 50, p95: 900, totalMs: 40_000, failed: 0, reasons: [] },
      { k: 'api:/api/broken', count: 20, p95: 4, totalMs: 80, failed: 20, reasons: [{ reason: 'http 502', count: 20 }] },
    ];
    const { failures, totalFailed } = buildFailures(pitfalls);
    expect(failures.map((f) => f.key)).toEqual(['api:/api/broken']);
    expect(totalFailed).toBe(20);
    expect(failures[0].rate).toBe(1);
    expect(failures[0].reasons[0]).toMatchObject({ label: 'Server error 502', count: 20 });
  });

  it('ranks by how many times it broke, with the rate as the tiebreak', () => {
    const pitfalls = [
      { k: 'api:/a', count: 1000, failed: 40, reasons: [] },
      { k: 'api:/b', count: 3, failed: 3, reasons: [] },
      { k: 'api:/c', count: 40, failed: 40, reasons: [] },
    ];
    const { failures } = buildFailures(pitfalls);
    // /a and /c both failed 40 times; /c failed EVERY time, so it goes first.
    expect(failures.map((f) => f.key)).toEqual(['api:/c', 'api:/a', 'api:/b']);
    expect(failures[0].rate).toBe(1);
    expect(failures[1].rate).toBeCloseTo(0.04, 5);
  });

  it('leaves healthy routes out entirely', () => {
    const { failures, totalFailed } = buildFailures([
      { k: 'api:/a', count: 10, failed: 0, reasons: [] },
    ]);
    expect(failures).toEqual([]);
    expect(totalFailed).toBe(0);
  });

  it('counts every failing route in the total, even the ones it does not show', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      k: `api:/r${i}`, count: 10, failed: 2, reasons: [],
    }));
    const { failures, totalFailed, hiddenCount } = buildFailures(many);
    expect(failures).toHaveLength(8);
    expect(hiddenCount).toBe(4);
    expect(totalFailed).toBe(24);
  });

  it('never produces a rate above 100% from a malformed row', () => {
    const { failures } = buildFailures([{ k: 'api:/x', count: 0, failed: 5, reasons: [] }]);
    expect(failures[0].rate).toBe(0);
  });

  it('survives an absent summary', () => {
    expect(buildFailures(undefined)).toEqual({ failures: [], totalFailed: 0, hiddenCount: 0 });
  });
});
