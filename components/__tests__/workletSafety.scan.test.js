import fs from 'fs';
import path from 'path';
import * as babel from '@babel/core';

/**
 * NOTHING ON THE UI THREAD MAY CALL A FUNCTION THAT IS NOT A WORKLET.
 *
 * This is the only bug class in the app that a green suite actively hides, and
 * it is fatal rather than cosmetic. A worklet runs on Reanimated's own runtime;
 * any plain function it captures arrives there wrapped by the value unpacker,
 * and calling it throws
 *
 *   [Worklets] Tried to synchronously call a non-worklet function on the UI
 *   thread.
 *
 * In a release build — which is what an OTA is, and therefore what is on Mark's
 * phone — that throw is not a warning in a console nobody is reading. It takes
 * the app down.
 *
 * ── Why a scan and not a test ──────────────────────────────────────────────
 *
 * Because no test can see it. Jest has no UI runtime: every worklet in this
 * repo runs as an ordinary JS closure under the jest-expo preset, so the
 * offending call succeeds in the suite and crashes on the device. The dock has
 * now been taken down this way three times — a helper that built a timing spec,
 * then React Native's `Easing` called from a gesture, and then `framesMissing`
 * inside the motion probe's frame callback, which is the one that made the app
 * die a fifth of a second after the first tab change. All three shipped with
 * every test passing, and dockMotion.js carries the scars as comments.
 *
 * So this compiles the project with the REAL worklets babel plugin and reads
 * what the plugin actually emitted: each worklet's captured closure and its
 * body. A captured name that the body CALLS has to be one of
 *
 *   • a Reanimated/worklets builtin or a JS language global (SAFE),
 *   • a function in this project that carries the 'worklet' directive,
 *   • hopped to the JS thread — runOnJS(fn)(…) / scheduleOnRN(fn, …),
 *   • or an explicitly reasoned exception (ALLOWED).
 *
 * Anything else fails here, at the only point in the pipeline where it is
 * visible without a phone in your hand.
 */

const ROOT = path.join(__dirname, '..', '..');

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'ios', 'ios-widget', '.scan', '__tests__',
  '.worktrees', '.maestro', 'assets', 'docs', 'certs', 'coverage',
]);

// Callable from the UI thread: Reanimated's own API surface (every one of these
// is a worklet or a host function inside the library) plus the JS language
// globals Hermes gives every runtime.
const SAFE = new Set([
  'runOnJS', 'runOnUI', 'withTiming', 'withSpring', 'withDecay', 'withDelay',
  'withSequence', 'withRepeat', 'withClamp', 'cancelAnimation', 'measure',
  'scrollTo', 'setGestureState', 'dispatchCommand', 'setNativeProps',
  'interpolate', 'interpolateColor', 'clamp', 'makeMutable',
  'createWorkletRuntime', 'scheduleOnRN', 'scheduleOnUI',
  'executeOnUIRuntimeSync', 'makeShareableCloneRecursive',
  'Math', 'JSON', 'Date', 'Number', 'String', 'Array', 'Object', 'Boolean',
  'isNaN', 'isFinite', 'parseInt', 'parseFloat', 'console', 'Easing', 'global',
  '_WORKLET',
]);

// Reasoned exceptions. Each one needs a sentence, because the default answer to
// "this one is fine" is that it is not.
const ALLOWED = new Map([
  // MediaGallery's "jump to top" pill builds its Tap with `.runOnJS(true)`, so
  // every callback on that gesture already runs on the JS thread —
  // recognition stays native (which is what lets the press land mid-fling) and
  // only the callback hops. A JS-thread gesture may call JS functions.
  ['pressBoardsTop', 'screens/TurtleScreen/components/MediaGallery.jsx'],
]);

function sources(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) sources(p, acc);
    else if (/\.(js|jsx|ts|tsx)$/.test(entry.name) && !/\.(test|scan)\./.test(entry.name)) acc.push(p);
  }
  return acc;
}

const PRESETS = [
  require.resolve('@babel/preset-react'),
  [require.resolve('@babel/preset-typescript'), { isTSX: true, allExtensions: true }],
];

/**
 * Every function in a file that carries the 'worklet' directive, by the name it
 * is bound to.
 *
 * Walked off the AST rather than grepped for. A regex has to guess how far the
 * directive can sit from the name, and the honest answer in this codebase is
 * "behind four lines of comment" — which is how `clusterStart`, `finite`,
 * `resetZoom` and `scheduleHide` all read as offenders on the first pass of
 * this scan. The AST knows exactly which function the directive belongs to.
 *
 * The name does have to be chased through `useCallback`, though: the common
 * shape here is `const limitsFor = useCallback((s) => { 'worklet'; … }, deps)`,
 * where the function carrying the directive is an ARGUMENT to a call and the
 * name belongs to the variable the call's result lands in. Without that hop
 * CanvasBoardView's `limitsFor` and `zoomAbout` both read as offenders when
 * they are nothing of the kind.
 */
function workletNamesIn(ast) {
  const names = new Set();
  const seen = new Set();
  const walk = (node, hint) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    if (Array.isArray(node)) { node.forEach((n) => walk(n, hint)); return; }
    if (!node.type) return;
    seen.add(node);

    // Does this function declare itself a worklet?
    const directives = node.body && node.body.directives;
    if (Array.isArray(directives) && directives.some((d) => d.value && d.value.value === 'worklet')) {
      const name = (node.id && node.id.name) || hint;
      if (name) names.add(name);
    }

    // What name would a function in each child position be bound to?
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
      const child = node[key];
      let nextHint = null;
      if (node.type === 'VariableDeclarator' && key === 'init') nextHint = node.id && node.id.name;
      else if ((node.type === 'ObjectProperty' || node.type === 'ClassMethod' || node.type === 'ObjectMethod') && (key === 'value' || key === 'body')) nextHint = node.key && (node.key.name || node.key.value);
      else if (node.type === 'AssignmentExpression' && key === 'right') nextHint = node.left && node.left.name;
      // `const fn = useCallback(() => { 'worklet'; … }, deps)` — the directive
      // is on an argument, the name is on the variable the call result lands
      // in, so the hint has to survive the call. useCallback only: for
      // useMemo it is the RETURN that gets the name, not the callback.
      else if (node.type === 'CallExpression' && key === 'arguments' && node.callee && node.callee.name === 'useCallback') nextHint = hint;
      walk(child, nextHint || (key === 'body' || key === 'init' ? hint : null));
    }
  };
  walk(ast, null);
  return names;
}

// Each worklet the plugin emitted: its generated name, its captured closure
// names, and its compiled body.
const EMITTED = /code: "function ([A-Za-z0-9_$]+)\([^)]*\)\{const\{([^}]*)\}=this\.__closure;([\s\S]*?)",\n/g;
const ANY_WORKLET = /code: "function [A-Za-z0-9_$]+\(/g;

describe('no worklet calls a non-worklet on the UI thread', () => {
  const files = sources(ROOT);
  const workletNames = new Set();
  const failedToParse = [];
  const failedToCompile = [];
  const offenders = [];
  let workletsEmitted = 0;

  beforeAll(() => {
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');

      try {
        const ast = babel.parse(src, { filename: file, presets: PRESETS, babelrc: false, configFile: false });
        for (const name of workletNamesIn(ast)) workletNames.add(name);
      } catch (err) {
        failedToParse.push(`${rel}: ${err.message.split('\n')[0]}`);
      }

      let out;
      try {
        out = babel.transformSync(src, {
          filename: file,
          plugins: [require.resolve('react-native-worklets/plugin')],
          presets: PRESETS,
          babelrc: false,
          configFile: false,
        });
      } catch (err) {
        failedToCompile.push(`${rel}: ${err.message.split('\n')[0]}`);
        continue;
      }

      workletsEmitted += (out.code.match(ANY_WORKLET) || []).length;

      let match;
      EMITTED.lastIndex = 0;
      while ((match = EMITTED.exec(out.code))) {
        const [, worklet, closure, body] = match;
        for (const id of closure.split(',').map((s) => s.trim()).filter(Boolean)) {
          if (SAFE.has(id)) continue;
          if (ALLOWED.get(id) === rel) continue;
          // Called directly in the body? `id(` — not a property access
          // (`x.id(`), and not handed to a JS-thread hop (`runOnJS(id)`).
          const call = new RegExp(`(^|[^A-Za-z0-9_$.])(${id.replace(/\$/g, '\\$')})\\(`, 'g');
          let hit;
          let direct = false;
          while ((hit = call.exec(body))) {
            const at = hit.index + hit[1].length;
            if (/(runOnJS|scheduleOnRN)\(\s*$/.test(body.slice(Math.max(0, at - 32), at))) continue;
            direct = true;
            break;
          }
          if (direct) offenders.push({ rel, worklet, id });
        }
      }
    }
  });

  test('the scan actually ran — the toolchain still emits worklets it can read', () => {
    // Without this the whole file is a no-op the day the plugin changes its
    // output shape or a preset goes missing: every regex stops matching,
    // `offenders` stays empty, and the test below passes while checking
    // nothing. The floor is well under the ~150 this app compiles today, so it
    // fails on a broken scan rather than on ordinary churn.
    expect(files.length).toBeGreaterThan(100);
    expect(workletsEmitted).toBeGreaterThan(100);
    expect(workletNames.size).toBeGreaterThan(30);
    expect(failedToParse).toEqual([]);
    expect(failedToCompile).toEqual([]);
  });

  test('every function a worklet calls is itself callable from the UI thread', () => {
    const unknown = offenders.filter((o) => !workletNames.has(o.id));
    const said = unknown.map((o) => `${o.rel} [${o.worklet}] calls non-worklet: ${o.id}`);
    // `framesMissing` was here, and the app died on the first tab change.
    expect(said).toEqual([]);
  });
});
