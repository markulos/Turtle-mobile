/**
 * NO HOOK AFTER AN EARLY RETURN — scanned, because nothing else catches it.
 *
 * On 2026-11-12 the app failed to start: "Rendered more hooks than during the
 * previous render." The cause was one `useMemo` added near the bottom of
 * AppContent, below the three early returns that component makes (still
 * loading, a share intent came in, not signed in). On the renders that take
 * one of those exits the hook never runs; on the first render that gets past
 * them it does — and a render with MORE hooks than the one before it is
 * something React refuses outright, so the whole app showed an error card
 * instead of a screen.
 *
 * THE FULL UNIT SUITE WENT GREEN THROUGH ALL OF IT. Every test that mounts a
 * component mounts one small enough to have no early return, and nothing
 * mounts AppContent at all — so the one file where it mattered had no cover.
 * A crash that only reproduces on a cold start of the real app is exactly
 * what a scan is for: this reads the source rather than running it.
 *
 * The rule is absolute and has no exceptions worth encoding: hooks go at the
 * top of a component, above every `return`. If this fires on a file you are
 * adding, move the hook up rather than teaching the scan about your case.
 */
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');

const ROOT = path.resolve(__dirname, '..', '..');

/** Files worth scanning: the ones that render and are ours. */
const DIRS = ['.', 'components', 'context', 'screens', 'utils'];
const SKIP = new Set(['node_modules', '__tests__', 'ios', 'android', 'assets', 'docs']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name) || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(jsx?|tsx?)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const FILES = DIRS.flatMap((d) => {
  const abs = path.join(ROOT, d);
  if (!fs.existsSync(abs)) return [];
  if (d === '.') {
    return fs.readdirSync(abs)
      .filter((f) => /\.jsx?$/.test(f))
      .map((f) => path.join(abs, f));
  }
  return walk(abs);
});

const isHookName = (name) => /^use[A-Z]/.test(name || '');

/** The callee's name for `useThing(...)` and `React.useThing(...)`. */
function calleeName(node) {
  if (!node || node.type !== 'CallExpression') return null;
  const c = node.callee;
  if (c.type === 'Identifier') return c.name;
  if (c.type === 'MemberExpression' && c.property.type === 'Identifier') return c.property.name;
  return null;
}

/** Every hook call anywhere inside a node, with its line. */
function hookCallsIn(node, found = []) {
  if (!node || typeof node !== 'object') return found;
  if (Array.isArray(node)) {
    for (const n of node) hookCallsIn(n, found);
    return found;
  }
  if (node.type === 'CallExpression' && isHookName(calleeName(node))) {
    found.push({ name: calleeName(node), line: node.loc?.start.line });
  }
  // Do NOT descend into nested functions: a hook inside a callback is a
  // different (and separately wrong) thing, and a custom hook defined inline
  // has its own top.
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
    if (!value || typeof value !== 'object') continue;
    if (value.type === 'FunctionDeclaration'
      || value.type === 'FunctionExpression'
      || value.type === 'ArrowFunctionExpression') continue;
    hookCallsIn(value, found);
  }
  return found;
}

/**
 * Hooks that run only SOMETIMES: the ones in statements that come after a
 * top-level exit.
 *
 * Walked statement by statement rather than compared by line number, which
 * matters for one shape that looks identical and is fine — a hook INSIDE the
 * final return (`return { refresh: useCallback(...) }`). That call is part of
 * the return expression, so it runs on every render that reaches it; only
 * statements that come AFTER an exit can be skipped.
 */
function hooksPastAnExit(body) {
  const out = [];
  let exitLine = null;
  for (const st of body?.body || []) {
    if (exitLine != null) {
      for (const hook of hookCallsIn(st)) out.push({ ...hook, exitLine });
      continue;
    }
    // `if (x) return ...` — the function keeps going afterwards, so what
    // follows runs on some renders and not others. A bare `return` at the top
    // level ends the function, and anything after it is unreachable rather
    // than conditional, but it is caught here too for the same price.
    if (st.type === 'IfStatement') {
      const branches = [st.consequent, st.alternate].filter(Boolean);
      const returns = branches.some((b) => {
        const inner = b.type === 'BlockStatement' ? b.body : [b];
        return inner.some((n) => n.type === 'ReturnStatement');
      });
      if (returns) exitLine = st.loc.start.line;
    } else if (st.type === 'ReturnStatement') {
      exitLine = st.loc.start.line;
    }
  }
  return out;
}

/** Function-ish nodes that look like components or custom hooks. */
function componentsIn(ast) {
  const out = [];
  const visit = (node, name) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach((n) => visit(n)); return; }
    if (node.type === 'FunctionDeclaration' && node.id) {
      if (/^[A-Z]/.test(node.id.name) || isHookName(node.id.name)) {
        out.push({ name: node.id.name, body: node.body });
      }
    }
    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier'
      && (/^[A-Z]/.test(node.id.name) || isHookName(node.id.name))
      && (node.init?.type === 'ArrowFunctionExpression' || node.init?.type === 'FunctionExpression')
      && node.init.body?.type === 'BlockStatement') {
      out.push({ name: node.id.name, body: node.init.body });
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc') continue;
      if (value && typeof value === 'object') visit(value, name);
    }
  };
  visit(ast.program.body);
  return out;
}

const OFFENDERS = [];
for (const file of FILES) {
  let ast;
  try {
    ast = parser.parse(fs.readFileSync(file, 'utf8'), {
      sourceType: 'module',
      plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator'],
    });
  } catch {
    continue; // not parseable as JS/JSX — not ours to police
  }
  for (const { name, body } of componentsIn(ast)) {
    for (const hook of hooksPastAnExit(body)) {
      OFFENDERS.push(
        `${path.relative(ROOT, file)}:${hook.line} — ${name}() calls ${hook.name}() `
        + `after the return on line ${hook.exitLine}`,
      );
    }
  }
}

describe('hooks live above every return', () => {
  test('nothing calls a hook after an early return', () => {
    // If this fails, MOVE THE HOOK UP. The listed call runs on some renders
    // and not others, and React takes the app down the first time the count
    // changes — on a cold start, far from the code that caused it.
    expect(OFFENDERS).toEqual([]);
  });

  test('the scan is actually reading the app', () => {
    // A scan that silently matched nothing would pass forever.
    expect(FILES.length).toBeGreaterThan(50);
    expect(FILES.some((f) => f.endsWith('App.js'))).toBe(true);
  });

  test('…and it can SEE the bug it exists for, without crying wolf', () => {
    // The detector run against the three shapes that matter: the real one, a
    // hook correctly placed above the exit, and a hook inside the final
    // return (which executes every render and is NOT this bug — it was the
    // scan's first false positive).
    const fixture = `
      function Broken() {
        const a = useState(0);
        if (loading) return null;
        const b = useMemo(() => 1, []);
        return a + b;
      }
      function Correct() {
        const b = useMemo(() => 1, []);
        if (loading) return null;
        return b;
      }
      function useFine() {
        const x = useRef(0);
        return { refresh: useCallback(() => x, []) };
      }
      function AlsoFine() {
        const cb = useCallback(() => {
          if (whatever) return 1;
          return 2;
        }, []);
        return cb;
      }
    `;
    const ast = parser.parse(fixture, { sourceType: 'module', plugins: ['jsx'] });
    const hits = componentsIn(ast).flatMap(
      ({ name, body }) => hooksPastAnExit(body).map((h) => `${name}:${h.name}`),
    );
    expect(hits).toEqual(['Broken:useMemo']);
  });
});
