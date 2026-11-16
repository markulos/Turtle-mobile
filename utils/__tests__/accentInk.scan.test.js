const fs = require('fs');
const path = require('path');

/**
 * THE ACCENT IS A FILL; `accentInk` IS THE INK.
 *
 * Mark, 2026-11-16: "if the highlight colour is too pale or fluorescent, turn
 * down the fluorescent and make the tone more neutral and dark within the
 * same palette for items like text and others that are on a cream/white/off
 * white background in light mode."
 *
 * The maths is `neutralInk` (utils/accentColor) and the token is
 * `theme.colors.accentInk` (ThemeContext); `accentColor.test` proves both.
 * What this file stops is the thing that put the app here in the first place:
 * a screen writing `color: theme.colors.accentInfo` because that is what the
 * screen beside it did. One raw-accent label is invisible on a fluorescent
 * theme and nobody notices until the owner sends a screenshot.
 *
 * ── What is NOT a violation ───────────────────────────────────────────────
 *
 *  · a FILL — backgroundColor, borderColor, tintColor, shadowColor. Being
 *    bright is the whole job of the colour there.
 *  · `inkOn(accent)` — text drawn ON an accent fill, which is the opposite
 *    problem and already has its own answer.
 *  · `readableOn` / `neutralInk` called directly with a surface. A caller
 *    that has measured the actual composited surface is doing better than
 *    the token can, and the Media Vault glyphs do exactly that.
 */

const ROOT = path.join(__dirname, '..', '..');
const DIRS = ['screens', 'components'];

/**
 * Both ways a colour is spelled: a style property `color: x` and a JSX prop
 * `color={x}` — which is how an ICON takes one. A non-letter is required
 * before each, so backgroundColor / borderColor / tintColor / shadowColor
 * (all capital-C) are never matched: those are FILLS, and a fill is supposed
 * to be the bright colour.
 */
const COLOR_PROP = /(?<![A-Za-z])color:\s*([^,;\n}]*)/g;
const COLOR_ATTR = /(?<![A-Za-z])color=\{([^}]*)\}?/g;

function sources() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '__tests__', '.git'].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(jsx?|tsx?)$/.test(e.name)) out.push(p);
    }
  };
  for (const d of DIRS) walk(path.join(ROOT, d));
  return out;
}

describe('the accent as INK', () => {
  test('no screen draws TEXT OR AN ICON in the raw accent', () => {
    // Mark asked for the text first (2026-11-16) and then for the glyphs:
    // "change to a more tame fade with fluorescent/pale highlight colours for
    // icons on a light backdrop as well". Same page, same problem, same ink.
    const offenders = [];
    for (const file of sources()) {
      const src = fs.readFileSync(file, 'utf8');
      const lines = src.split('\n');
      for (const [i, line] of lines.entries()) {
        // Comments explain the rule; they are not the rule being broken.
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
        for (const re of [COLOR_PROP, COLOR_ATTR]) {
          for (const m of line.matchAll(re)) {
            const value = m[1];
            if (!/\.accent(Info)?\b/.test(value)) continue;
            if (/inkOn\(|readableOn\(|neutralInk\(|accentFrostInk\(/.test(value)) continue;
            offenders.push(`${path.relative(ROOT, file)}:${i + 1}  ${line.trim()}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('…and the token it reaches for instead is real, and gated on the mode', () => {
    const ctx = fs.readFileSync(path.join(ROOT, 'context', 'ThemeContext.js'), 'utf8');
    expect(ctx).toMatch(/accentInk:/);
    // LIGHT ONLY. On the black page a bright accent is the legible one and
    // darkening it is the exact wrong move — there is nothing fluorescent
    // about neon yellow on black, it is just yellow.
    expect(ctx).toMatch(/accentInk: isDark \? accentColor : neutralInk\(/);
    // `accent` itself is untouched, because fills still want the colour.
    expect(ctx).toMatch(/\n {6}accent: accentColor,/);
  });

  test('the rule is WRITTEN DOWN, which is the half that outlives the code', () => {
    const doc = fs.readFileSync(path.join(ROOT, 'docs', 'STYLE-RULES.md'), 'utf8');
    expect(doc).toMatch(/##\s*10\./);
    const sec = doc.slice(doc.indexOf('## 10.'));
    for (const part of ['accentInk', 'INK_SAT_CAP', 'readableOn', 'inkOn']) {
      expect(sec).toContain(part);
    }
    expect(doc.slice(doc.indexOf('## Checklist'))).toMatch(/§10/);
  });

  test('the ink is used widely enough to be the convention, not an exception', () => {
    // A rule one screen follows is a special case. The two sweeps that
    // introduced this touched ~45 files between them; if that number
    // collapses, somebody has reverted the convention rather than improved it.
    const users = sources().filter((f) => /accentInk/.test(fs.readFileSync(f, 'utf8')));
    expect(users.length).toBeGreaterThanOrEqual(40);
  });
});
