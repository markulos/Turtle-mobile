import gestureProbe, {
  findingKey,
  mergeSample,
  medianMs,
  buildFixPrompt,
  describeFinding,
  LABEL_HINTS,
} from '../gestureProbe';

describe('gestureProbe aggregation', () => {
  test('findingKey is stable per (kind, label)', () => {
    expect(findingKey('js-blocked', 'viewer:swipe')).toBe('js-blocked:viewer:swipe');
    expect(findingKey('js-blocked', null)).toBe('js-blocked:unknown');
  });

  test('mergeSample counts, tracks the worst, and caps samples', () => {
    let f;
    for (let i = 1; i <= 10; i++) f = mergeSample(f, { ms: i * 10, at: i, context: 'v' });
    expect(f.count).toBe(10);
    expect(f.worstMs).toBe(100);
    expect(f.samples).toHaveLength(6);        // MAX_SAMPLES
    expect(f.samples[f.samples.length - 1].ms).toBe(100); // newest retained
    expect(f.lastAt).toBe(10);
  });

  test('worst survives a later smaller sample', () => {
    let f = mergeSample(undefined, { ms: 900, at: 1 });
    f = mergeSample(f, { ms: 30, at: 2 });
    expect(f.worstMs).toBe(900);
    expect(f.count).toBe(2);
  });

  test('medianMs handles odd, even, and empty', () => {
    expect(medianMs([{ ms: 10 }, { ms: 30 }, { ms: 20 }])).toBe(20);
    expect(medianMs([{ ms: 10 }, { ms: 20 }])).toBe(15);
    expect(medianMs([])).toBe(0);
    expect(medianMs(undefined)).toBe(0);
  });
});

describe('buildFixPrompt', () => {
  const finding = {
    kind: 'freeze-after-touch',
    label: 'viewer:swipe',
    count: 4,
    worstMs: 612.4,
    samples: [
      { ms: 300, at: 1, context: 'photo viewer' },
      { ms: 612, at: 2, context: 'photo viewer' },
    ],
  };

  test('carries the measurement, the symptom, and where to look', () => {
    const p = buildFixPrompt(finding);
    expect(p).toContain('4 occurrences');
    expect(p).toContain('worst 612ms');
    expect(p).toContain('median 456ms');
    expect(p).toContain('photo viewer');
    expect(p).toContain(LABEL_HINTS['viewer:swipe']);
  });

  test('is self-contained — names the skills and forbids guessing', () => {
    const p = buildFixPrompt(finding);
    expect(p).toContain('turtle-mobile-verify');
    expect(p).toContain('turtle-vault-invariants');
    expect(p).toMatch(/don't guess/i);
    expect(p).not.toMatch(/as discussed|earlier session|we talked/i);
  });

  test('singular occurrence reads correctly and an unknown label still works', () => {
    const p = buildFixPrompt({
      kind: 'slow-response',
      label: 'notes:openCard',
      count: 1,
      worstMs: 210,
      samples: [{ ms: 210, at: 1 }],
    });
    expect(p).toContain('1 occurrence,');
    expect(p).toContain('notes:openCard');
  });
});

// A drag's latency is timed from the first MOVE. Dwell — a finger resting on a
// photo before it travels — is the user taking their time, not the app lagging,
// and timing it from the touch-down reported half-second "stalls" with the JS
// thread idle.
describe('respond() measures from the first move, not the touch-down', () => {
  let now;
  beforeEach(() => {
    now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    gestureProbe.setConsoleTrail(false);
    gestureProbe.clear();
  });
  afterEach(() => {
    Date.now.mockRestore();
    gestureProbe.clear();
    gestureProbe.setConsoleTrail(true);
  });

  test('a long dwell followed by a prompt swipe records nothing', () => {
    gestureProbe.touchStart('photo viewer');
    now += 520;                       // thumb resting on the photo
    gestureProbe.touchMove();
    now += 30;                        // pager moves ~2 frames later
    gestureProbe.respond('viewer:swipe');
    expect(gestureProbe.getState().findings).toHaveLength(0);
  });

  test('a real delay after the finger travels is still recorded', () => {
    gestureProbe.touchStart('photo viewer');
    now += 520;
    gestureProbe.touchMove();
    now += 300;                       // finger moving, pager still stuck
    gestureProbe.respond('viewer:swipe');
    const [finding] = gestureProbe.getState().findings;
    expect(finding.kind).toBe('slow-response');
    expect(finding.worstMs).toBe(300); // the dwell is NOT folded in
  });

  test('a tap still measures from the touch-down (nothing moved)', () => {
    gestureProbe.touchStart('photo viewer');
    now += 200;
    gestureProbe.respond('viewer:chromeToggle');
    expect(gestureProbe.getState().findings[0].worstMs).toBe(200);
  });

  test('only the FIRST move of a touch starts the clock', () => {
    gestureProbe.touchStart('photo viewer');
    gestureProbe.touchMove();
    now += 200;
    gestureProbe.touchMove();         // later moves must not reset the basis
    gestureProbe.respond('viewer:swipe');
    expect(gestureProbe.getState().findings[0].worstMs).toBe(200);
  });
});

describe('slow-render findings', () => {
  test('name the tree and say a commit owned the thread', () => {
    const p = buildFixPrompt({
      kind: 'slow-render',
      label: 'render:gallery',
      count: 3,
      worstMs: 158,
      samples: [{ ms: 150, at: 1, context: 'update' }, { ms: 158, at: 2, context: 'update' }],
    });
    expect(p).toContain('render:gallery spends too long in one commit');
    expect(p).toContain('one React commit');
    // The Profiler phase rides along as the context — mount points at a list
    // batch, update at a state change, and the prompt must carry the difference.
    expect(p).toContain('update');
  });
});

describe('describeFinding', () => {
  test('renders a compact row label', () => {
    expect(describeFinding({ label: 'viewer:swipe', count: 3, worstMs: 481.6 }))
      .toBe('viewer:swipe — 3×, worst 482ms');
  });
});
