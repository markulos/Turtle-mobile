/**
 * keyboardLab — find out WHY the keyboard is not smooth, on the phone that
 * says it is not, instead of guessing a sixth time.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * The chat's keyboard motion has been retuned by eye over and over. Reading
 * the code no longer finds anything: every lift on the keyboard's path is a
 * transform, and nothing on that path changed between the build Mark called
 * "perfectly smooth" and the one he calls "very jittery and slow". The
 * friend chat took five blind passes the same way. An eye cannot tell these
 * apart, and they have different fixes:
 *
 *   DROPPING   the lift is in step with the keyboard but frames go missing on
 *              the way — something is costing the UI thread every frame
 *              (a layout pass, a blur being resized, a heavy composite);
 *   TRAILING   every frame is drawn, but the lift is BEHIND the keyboard —
 *              the thing reporting the keyboard's position is late;
 *   STARTING   it sets off late and then runs clean.
 *
 * So this measures, on the UI thread, each time the keyboard moves:
 *
 *   frames / worst / drops   how many frames the move got, the longest one,
 *                            and how many frame-times went by undrawn;
 *   off                      the most the lift was away from where the
 *                            keyboard really was, in points (the keyboard's
 *                            own position comes from react-native-keyboard-
 *                            controller, independently of whichever driver is
 *                            moving the chat);
 *   late                     ms from the keyboard starting to the lift moving;
 *   js                       how long the JS thread took to answer at that
 *                            moment — a busy JS thread is not what moves the
 *                            chat, but it is what a re-render looks like.
 *
 * …and it can CHANGE what is being measured, one thing at a time:
 *
 *   drive   'reanimated'  Reanimated's useAnimatedKeyboard — what the chat
 *                         has always used;
 *           'controller'  keyboard-controller's per-frame position;
 *           'spring'      a spring started once, on the keyboard's own start,
 *                         with iOS's keyboard spring — nothing is tracked per
 *                         frame at all, which is how a native app does it.
 *   console 'resize'      the Claude console shrinks its HEIGHT with the
 *                         keyboard (a layout change, every frame);
 *           'slide'       it keeps its size and its contents slide — a
 *                         transform, like everything else on the path.
 *
 * The DEFAULT is exactly what shipped before (reanimated + resize): nothing
 * about the app changes until something here is switched.
 *
 * Not __DEV__-only, for the reason dockMotionProbe gives: the phone that is
 * wrong runs the OTA build.
 */
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { runOnJS, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { useKeyboardHandler } from 'react-native-keyboard-controller';

export const DRIVES = ['reanimated', 'controller', 'spring'];
export const CONSOLE_MODES = ['resize', 'slide'];
export const DRIVE_LETTER = { reanimated: 'A', controller: 'B', spring: 'C' };
/** What the app did before the lab existed. */
export const DEFAULT_CONFIG = { drive: 'reanimated', console: 'resize', open: true };
const STORE_KEY = 'turtle.keyboardLab.v1';

// ── the setting ──────────────────────────────────────────────────────────
let config = DEFAULT_CONFIG;
const configListeners = new Set();
let loaded = false;

export const getKeyboardLab = () => config;

export function setKeyboardLab(patch, { persist = true } = {}) {
  const next = { ...config, ...patch };
  if (!DRIVES.includes(next.drive)) next.drive = DEFAULT_CONFIG.drive;
  if (!CONSOLE_MODES.includes(next.console)) next.console = DEFAULT_CONFIG.console;
  next.open = !!next.open;
  if (next.drive === config.drive && next.console === config.console && next.open === config.open) return;
  config = next;
  configListeners.forEach((fn) => { try { fn(); } catch { /* a readout must not take the chat down */ } });
  if (persist) AsyncStorage.setItem(STORE_KEY, JSON.stringify(config)).catch(() => {});
}

function loadOnce() {
  if (loaded) return;
  loaded = true;
  AsyncStorage.getItem(STORE_KEY).then((raw) => {
    if (!raw) return;
    try { setKeyboardLab(JSON.parse(raw), { persist: false }); } catch { /* keep the default */ }
  }).catch(() => {});
}

const subscribeConfig = (fn) => {
  loadOnce();
  configListeners.add(fn);
  return () => configListeners.delete(fn);
};

/** The lab's setting, for a component. Re-renders only when it changes. */
export function useKeyboardLab() {
  return useSyncExternalStore(subscribeConfig, getKeyboardLab, getKeyboardLab);
}

/** 'A', 'B·s' … — one short name for a setting. The console only matters in a session. */
export function configName(cfg, inSession) {
  const letter = DRIVE_LETTER[cfg.drive] || '?';
  return inSession ? `${letter}·${cfg.console === 'slide' ? 's' : 'r'}` : letter;
}

/** The settings an automatic run goes through, in order. The first is always what shipped. */
export function runPlan(inSession) {
  if (!inSession) return DRIVES.map((drive) => ({ drive, console: 'resize' }));
  return [
    { drive: 'reanimated', console: 'resize' },
    { drive: 'reanimated', console: 'slide' },
    { drive: 'controller', console: 'slide' },
    { drive: 'spring', console: 'slide' },
  ];
}

// ── the reports ──────────────────────────────────────────────────────────
const reportListeners = new Set();
let jsDelayMs = 0;

export const onKeyboardReport = (fn) => {
  reportListeners.add(fn);
  return () => reportListeners.delete(fn);
};

const publish = (report) => {
  const full = { ...report, jsMs: jsDelayMs };
  reportListeners.forEach((fn) => { try { fn(full); } catch { /* see above */ } });
};

// Called from the UI thread the moment the keyboard starts; how long it took
// to GET here is how busy the JS thread was at that moment.
const jsPing = (sentAt) => { jsDelayMs = Math.max(0, Date.now() - sentAt); };

const n = (v) => (Number.isFinite(v) ? Math.round(v) : 0);
const pad = (s, w) => String(s).padStart(w, ' ');

/** One line for one move of the keyboard. Fixed width, so a column of them lines up. */
export function describeMove(r) {
  if (!r) return '';
  // f frames · w worst frame (ms) · d frames dropped · off points away from the
  // keyboard at worst · late ms before the lift moved · js ms the JS thread took
  return `${r.opening ? 'open ' : 'close'} ${pad(n(r.frames), 3)}f w${pad(n(r.worstMs), 3)} d${pad(n(r.drops), 2)}`
    + ` off${pad(n(r.offMax), 3)} late${pad(n(r.firstMoveMs), 3)} js${pad(n(r.jsMs), 3)}`;
}

/**
 * The verdict — the cause, not the numbers. Short, because it shares a line:
 * DROP (frames went missing), TRAIL (drawn, but behind the keyboard), LATE
 * (set off late), ok.
 */
export function diagnose(r) {
  if (!r) return '';
  const cadence = r.bestMs > 0 ? r.bestMs : 16.7;
  if (r.drops >= 3 || r.worstMs > cadence * 3.5) return 'DROP';
  if (r.offMax > 24) return 'TRAIL';
  if (r.firstMoveMs > 70) return 'LATE';
  return 'ok';
}

const NONE = -1;

/**
 * Times every move of the keyboard against `height` — the shared value that
 * is actually lifting the chat, whichever driver is feeding it.
 *
 * The frame callback is always on, as in dockMotionProbe and for its reason:
 * switching it on from JS would put a JS hop at the instant being measured.
 * Idle, it is one shared-value read and a branch a frame.
 */
export function useKeyboardProbe(height) {
  const sampling = useSharedValue(0);
  const startedAt = useSharedValue(0);
  const frames = useSharedValue(0);
  const worst = useSharedValue(0);
  const best = useSharedValue(0);
  const target = useSharedValue(0);
  const startH = useSharedValue(0);
  const firstMove = useSharedValue(NONE);
  const settle = useSharedValue(NONE);
  const ended = useSharedValue(0);
  const kbMs = useSharedValue(0);
  const offMax = useSharedValue(0);

  useKeyboardHandler(
    {
      onStart: (e) => {
        'worklet';
        sampling.value = 1;
        startedAt.value = Date.now();
        frames.value = 0;
        worst.value = 0;
        best.value = 0;
        target.value = e.height;
        startH.value = height.value;
        firstMove.value = NONE;
        settle.value = NONE;
        ended.value = 0;
        kbMs.value = e.duration;
        offMax.value = 0;
        runOnJS(jsPing)(Date.now());
      },
      onMove: (e) => {
        'worklet';
        // Where the keyboard really is this frame, against where the chat is.
        const off = Math.abs(e.height - height.value);
        if (sampling.value && off > offMax.value) offMax.value = off;
      },
      onEnd: (e) => {
        'worklet';
        ended.value = 1;
        target.value = e.height;
      },
    },
    [height],
  );

  useFrameCallback((info) => {
    'worklet';
    if (!sampling.value) return;

    const dt = info.timeSincePreviousFrame;
    if (dt != null && dt > 0) {
      frames.value += 1;
      if (dt > worst.value) worst.value = dt;
      if (best.value === 0 || dt < best.value) best.value = dt;
    }
    const elapsed = Date.now() - startedAt.value;
    const h = height.value;
    if (firstMove.value < 0 && Math.abs(h - startH.value) > 0.5) firstMove.value = elapsed;
    if (settle.value < 0 && firstMove.value >= 0 && Math.abs(h - target.value) < 0.75) settle.value = elapsed;

    const settled = ended.value === 1 && (settle.value >= 0 || elapsed > kbMs.value + 450);
    if (!settled && elapsed < 2200) return;

    // Window over: report once, from the UI thread, and go quiet.
    sampling.value = 0;
    const cadence = best.value > 0 ? best.value : 16.7;
    const missing = Math.round(elapsed / cadence) - frames.value;
    runOnJS(publish)({
      opening: target.value > startH.value,
      frames: frames.value,
      worstMs: worst.value,
      bestMs: best.value,
      drops: missing > 0 ? missing : 0,
      offMax: offMax.value,
      firstMoveMs: firstMove.value < 0 ? elapsed : firstMove.value,
      settleMs: settle.value < 0 ? elapsed : settle.value,
      keyboardMs: kbMs.value,
      windowMs: elapsed,
    });
  }, true);
}
