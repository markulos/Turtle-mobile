/**
 * The rule the sweep established, kept true: NO raw TextInput in the app
 * carries a `placeholder` prop.
 *
 * iOS draws that prop outside the app's text pipeline, so under Figtree it
 * renders in the system face — one field, two typefaces (docs/STYLE-RULES.md
 * §5). components/AppTextInput is the field that fixes it, and it is the only
 * place allowed to hand a placeholder to a real TextInput.
 *
 * A convention nobody enforces drifts back: this scans the source rather than
 * trusting the sweep to have been final.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DIRS = ['screens', 'components'];
// The one file allowed to pass a placeholder to a TextInput — it is the fix.
const ALLOWED = [path.join('components', 'AppTextInput.jsx')];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      walk(p, out);
    } else if (/\.(jsx?|tsx?)$/.test(entry.name)) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Every `<TextInput …>` opening tag in a file, as text. Deliberately crude —
 * it only has to be good enough to see a prop inside a tag it already found.
 */
function textInputTags(src) {
  const tags = [];
  const re = /<TextInput\b/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    // To the end of the opening tag: the first ">" that is not inside braces.
    let depth = 0;
    let i = m.index;
    for (; i < src.length; i += 1) {
      const ch = src[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      else if (ch === '>' && depth === 0) break;
    }
    tags.push({ text: src.slice(m.index, i + 1), index: m.index });
  }
  return tags;
}

const lineOf = (src, index) => src.slice(0, index).split('\n').length;

describe('placeholder sweep', () => {
  const files = DIRS.flatMap((d) => walk(path.join(ROOT, d)));

  test('no TextInput anywhere hands iOS a placeholder to draw', () => {
    const offenders = [];
    for (const file of files) {
      const rel = path.relative(ROOT, file);
      if (ALLOWED.includes(rel)) continue;
      const src = fs.readFileSync(file, 'utf8');
      if (!src.includes('<TextInput')) continue;
      for (const tag of textInputTags(src)) {
        if (/\bplaceholder=/.test(tag.text)) {
          offenders.push(`${rel.replace(/\\/g, '/')}:${lineOf(src, tag.index)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('the sweep actually reached the app — this is not passing on an empty set', () => {
    const users = files.filter((f) => /AppTextInput/.test(fs.readFileSync(f, 'utf8')));
    // 30+ files were converted; well under that means something un-swept it.
    expect(users.length).toBeGreaterThan(30);
  });
});
