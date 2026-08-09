/**
 * gestureProbe — DEV-ONLY responsiveness watchdog.
 *
 * Answers one question the simulator can't: "when my finger did something, did
 * the app actually do it, and how long did it take?" It watches three things
 * and turns what it finds into ready-to-send bug-fix prompts:
 *
 *   1. JS-THREAD STALLS. React Native's touch pipeline runs on the JS thread,
 *      so a long synchronous block IS an unresponsive app — gestures that land
 *      during one are delivered late or not at all. A steady interval measures
 *      its own drift; drift past STALL_MS is a stall, recorded with whatever
 *      the app was last doing.
 *   2. SLOW RESPONSES. Instrumented sites call `respond(label)` when a gesture
 *      visibly takes effect. The probe pairs that with the most recent
 *      touch-down and records the gap — the honest measure of "felt laggy".
 *   3. FROZEN GESTURES. A touch-down immediately followed by a stall: the
 *      finger landed and the thread died under it. This is the "discrepancy
 *      between what I did and what the app did" case, and it is the one worth
 *      hunting.
 *
 * Everything is gated on __DEV__ — in a release build every entry point below
 * is an immediate return and the monitor never starts.
 *
 * Deliberately dependency-free (no react-native import): it must be safe to
 * call from any thread-blocking hot path, and it stays trivially unit-testable.
 * Persistence is injected by the overlay, not imported here.
 */

const IS_DEV = typeof __DEV__ !== 'undefined' && __DEV__;

// ── Tuning ────────────────────────────────────────────────────────────────
// Cadence of the drift monitor. 100ms gives ~6-frame resolution on a stall
// while costing one trivial callback per tick.
export const TICK_MS = 100;
// Drift past this is a stall worth recording. ~7 frames at 60Hz: past this a
// human perceives the app as stuck rather than merely slow.
export const STALL_MS = 120;
// A gesture that takes longer than this to visibly take effect reads as lag.
export const SLOW_MS = 120;
// ...and past this it reads as broken.
export const BAD_MS = 300;
// A stall beginning within this long of a touch-down is attributed to it.
export const FREEZE_WINDOW_MS = 250;
// Per-finding sample cap — enough to show a spread, bounded for memory.
const MAX_SAMPLES = 6;
// Total distinct findings kept (dev safety valve).
const MAX_FINDINGS = 40;

/**
 * Where to look when a label misbehaves. Keeping the map here (rather than
 * threading a hint through every call site) means an instrumented site stays a
 * one-liner, and the generated prompt still tells the next session where to
 * start reading.
 */
export const LABEL_HINTS = {
  'viewer:open': 'MediaGallery.jsx openViewer / the scaleAnim+opacityAnim open transition',
  'viewer:swipe': 'MediaGallery.jsx viewer FlatList (onScrollBeginDrag) — pager touch delivery',
  'viewer:pageSettle': 'MediaGallery.jsx syncSelectedFromOffset — deferred selectedMedia adoption',
  'viewer:chromeToggle': 'MediaGallery.jsx handleViewerSingleTap → toggleInfoVisibility',
  'viewer:close': 'MediaGallery.jsx closeViewer / resetViewerState',
  'viewer:favourite': 'MediaGallery.jsx toggleFavourite (optimistic path)',
  'grid:scroll': 'MediaGallery.jsx grid FlashList onScroll / handleGridScroll',
  'grid:openPhoto': 'MediaGallery.jsx grid cell press → openViewer',
};

const severityOf = (ms) => (ms >= BAD_MS ? 'bad' : ms >= SLOW_MS ? 'slow' : 'ok');

/** Stable identity for a finding — one row per (kind, label). */
export const findingKey = (kind, label) => `${kind}:${label || 'unknown'}`;

/** Merge one measurement into a finding row (pure — unit-tested). */
export const mergeSample = (finding, sample) => {
  const next = finding || { count: 0, worstMs: 0, samples: [] };
  const samples = [...next.samples, sample].slice(-MAX_SAMPLES);
  return {
    ...next,
    count: next.count + 1,
    worstMs: Math.max(next.worstMs, sample.ms),
    lastAt: sample.at,
    samples,
  };
};

/** Median of the retained samples — resists one freak outlier. */
export const medianMs = (samples) => {
  if (!samples || samples.length === 0) return 0;
  const sorted = samples.map((s) => s.ms).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

const KIND_TITLES = {
  'slow-response': (label) => `${label} responds slowly`,
  'js-blocked': (label) => `JS thread blocks during ${label}`,
  'freeze-after-touch': (label) => `Touch freezes the app during ${label}`,
};

const KIND_SYMPTOMS = {
  'slow-response': 'the gesture works but visibly lags behind the finger',
  'js-blocked': 'the app stops rendering and stops accepting input for that whole window',
  'freeze-after-touch': 'the finger lands and the app goes dead under it — gestures started in that window are delivered late or dropped entirely',
};

/**
 * Turn a finding into a self-contained prompt. The user pastes this into a
 * Claude session cold, so it must carry the measurement, the symptom, the
 * place to look, and the standing constraints — never "as discussed".
 */
export const buildFixPrompt = (finding) => {
  const { kind, label, count, worstMs, samples } = finding;
  const title = (KIND_TITLES[kind] || (() => `${label} misbehaves`))(label);
  const hint = LABEL_HINTS[label];
  const med = medianMs(samples);
  const contexts = Array.from(
    new Set(samples.map((s) => s.context).filter(Boolean)),
  ).slice(0, 3);

  const lines = [
    `Mobile app performance bug found by the in-app gesture probe (dev build, real device).`,
    ``,
    `WHAT: ${title}.`,
    `SYMPTOM: ${KIND_SYMPTOMS[kind] || 'the app does not do what the gesture asked'}.`,
    `MEASURED: ${count} occurrence${count === 1 ? '' : 's'}, worst ${Math.round(worstMs)}ms, median ${med}ms.`,
  ];
  if (contexts.length) lines.push(`WHEN: ${contexts.join(' · ')}.`);
  if (hint) lines.push(`START HERE: ${hint}.`);
  lines.push(
    ``,
    `Find the actual cause before changing anything — measure or read the code path, don't guess.`,
    `The usual culprits in this codebase: state updates that re-render the whole 6000-line MediaGallery on a gesture frame, work done synchronously in a scroll/settle callback, and overlay views whose pointerEvents swallow touches meant for the pager.`,
    `Follow the repo skills: turtle-vault-invariants before touching viewer/grid code, then turtle-mobile-verify (parse, undef-audit, jest, Metro bundle) and turtle-safe-commit.`,
  );
  return lines.join('\n');
};

/** Short human label for the probe pill / list rows. */
export const describeFinding = (f) =>
  `${f.label} — ${f.count}×, worst ${Math.round(f.worstMs)}ms`;

// ── The probe ─────────────────────────────────────────────────────────────

const createProbe = () => {
  /** @type {Map<string, object>} */
  let findings = new Map();
  let listeners = new Set();
  let timer = null;
  let lastTick = 0;
  let lastTouch = null;      // { at, context }
  let lastLabel = null;      // most recent respond() label — the "what were we doing"
  let running = false;
  let totalStalls = 0;
  let worstStallMs = 0;
  let onPersist = null;      // injected by the overlay (AsyncStorage write)
  let consoleTrail = true;   // Metro log line per finding

  const emit = () => {
    const snapshot = getState();
    listeners.forEach((l) => {
      try { l(snapshot); } catch { /* a bad listener must not break the probe */ }
    });
    if (onPersist) { try { onPersist(snapshot.findings); } catch { /* best effort */ } }
  };

  const record = (kind, label, ms, context) => {
    const key = findingKey(kind, label);
    const prev = findings.get(key);
    if (!prev && findings.size >= MAX_FINDINGS) return;
    const merged = mergeSample(prev, { ms: Math.round(ms), at: Date.now(), context });
    findings.set(key, { ...merged, key, kind, label: label || 'unknown' });
    if (consoleTrail) {
      // One line per event in the Metro log — the "background debugger" trail
      // you can watch while driving the app, without opening the panel.
      console.log(`[probe] ${kind} ${Math.round(ms)}ms · ${label || 'unknown'}${context ? ` · ${context}` : ''}`);
    }
    emit();
  };

  const getState = () => ({
    running,
    totalStalls,
    worstStallMs: Math.round(worstStallMs),
    findings: Array.from(findings.values()).sort((a, b) => b.worstMs - a.worstMs),
  });

  const tick = () => {
    const now = Date.now();
    const drift = now - lastTick - TICK_MS;
    lastTick = now;
    if (drift < STALL_MS) return;
    totalStalls += 1;
    worstStallMs = Math.max(worstStallMs, drift);
    // A stall that began right after a touch-down is the "app went dead under
    // my finger" case; anything else is a background block.
    const touch = lastTouch;
    const frozeUnderFinger = touch && now - drift - touch.at <= FREEZE_WINDOW_MS;
    record(
      frozeUnderFinger ? 'freeze-after-touch' : 'js-blocked',
      lastLabel || (touch && touch.context) || 'app',
      drift,
      touch && touch.context,
    );
  };

  return {
    enabled: IS_DEV,

    /** Begin watching. Idempotent; a no-op outside dev. */
    start() {
      if (!IS_DEV || running) return;
      running = true;
      lastTick = Date.now();
      timer = setInterval(tick, TICK_MS);
      emit();
    },

    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      running = false;
      emit();
    },

    /**
     * A finger landed. Called from the root capture responder, so it sees
     * every touch that enters the JS pipeline without ever claiming one.
     */
    touchStart(context) {
      if (!IS_DEV) return;
      lastTouch = { at: Date.now(), context: context || null };
    },

    /**
     * A gesture visibly took effect. Pairs with the pending touch-down and
     * records the gap when it is slow enough to feel.
     */
    respond(label, context) {
      if (!IS_DEV) return;
      lastLabel = label;
      const touch = lastTouch;
      if (!touch) return;
      const ms = Date.now() - touch.at;
      lastTouch = null; // one response per touch — later marks aren't this gesture
      if (severityOf(ms) === 'ok') return;
      record('slow-response', label, ms, context || touch.context);
    },

    /** Mark what the app is doing without pairing to a touch (scroll settle…). */
    mark(label) {
      if (!IS_DEV) return;
      lastLabel = label;
    },

    subscribe(listener) {
      listeners.add(listener);
      listener(getState());
      return () => listeners.delete(listener);
    },

    getState,

    /** Restore findings persisted across a Metro reload. */
    hydrate(rows) {
      if (!IS_DEV || !Array.isArray(rows)) return;
      rows.forEach((r) => { if (r && r.key) findings.set(r.key, r); });
      emit();
    },

    /** Overlay injects an AsyncStorage writer; keeps this module dep-free. */
    setPersist(fn) { onPersist = typeof fn === 'function' ? fn : null; },

    /** Silence the per-event Metro log without stopping collection. */
    setConsoleTrail(on) { consoleTrail = !!on; },

    clear() {
      findings = new Map();
      totalStalls = 0;
      worstStallMs = 0;
      lastTouch = null;
      lastLabel = null;
      emit();
    },

    /** One prompt per finding, worst first — what the to-do rows carry. */
    buildPrompts() {
      return getState().findings.map((f) => ({
        key: f.key,
        title: (KIND_TITLES[f.kind] || (() => `${f.label} misbehaves`))(f.label),
        prompt: buildFixPrompt(f),
      }));
    },
  };
};

export const gestureProbe = createProbe();
export default gestureProbe;
