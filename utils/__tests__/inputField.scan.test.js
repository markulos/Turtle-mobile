import fs from 'fs';
import path from 'path';

import { INPUT_FIELD } from '../inputField';

/**
 * The house rule for text fields, enforced rather than remembered.
 *
 * A single-line TextInput sits on the centre line of the row around it. If it
 * ALSO declares a height, two layout systems have to agree about one baseline —
 * the row centres the box, then the platform places text inside the box by its
 * own rules — and the placeholder, the value and the caret stop landing on the
 * same line. That was the Login screen's invite field: `height: '100%'` inside
 * a 52pt row.
 *
 * Two rules, both narrow enough to be provably right:
 *
 *   1. No input stretches to its parent (`height: '100%'`). That is the
 *      double-ownership case with nothing to gain — the row already sized it.
 *   2. An input that DOES declare a height must spread INPUT_FIELD, so its text
 *      is centred within the height it chose.
 *
 * An input with no height of its own is left alone: its box comes from padding
 * or from the row, and forcing paddingVertical to 0 there would collapse it.
 *
 * A scan rather than a convention, because a convention drifts back — the same
 * reasoning behind the header separator scan next door.
 */
const ROOTS = ['screens', 'components'];
const SOURCE = /\.(js|jsx)$/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SOURCE.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Comments describe the rule; they must not be mistaken for breaking it.
 *
 * Blanked rather than deleted, and line endings left alone: a block comment
 * removed outright takes its newlines with it, and every offender reported
 * after it then names a line number that is short by however many lines of
 * prose came before — which sends you to the wrong place in the file.
 */
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/^(\s*)\/\/.*$/gm, '$1');

const files = ROOTS.flatMap((r) => (fs.existsSync(r) ? walk(r) : []));

/** Every `<something>input:` / `<something>Input:` style body in the repo. */
function eachFieldStyle(visit) {
  const KEY = /^(\s*)(\w*(?:input|Input))\s*:\s*\{/;
  for (const file of files) {
    const lines = stripComments(fs.readFileSync(file, 'utf8')).split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const match = KEY.exec(lines[i]);
      if (!match) continue;
      const name = match[2];
      // Multi-line inputs grow with their content, so they legitimately own a
      // height and want textAlignVertical 'top'. Out of scope by design.
      if (/area|multiline|desc/i.test(name)) continue;

      const body = [];
      if (lines[i].includes('}')) body.push(lines[i]);
      else {
        for (let j = i; j < Math.min(i + 25, lines.length); j++) {
          body.push(lines[j]);
          if (/^\s*\},?\s*$/.test(lines[j])) break;
        }
      }
      visit({ file: `${file.replace(/\\/g, '/')}:${i + 1}`, name, text: body.join('\n') });
    }
  }
}

const declaresHeight = (text) => /(?<![a-zA-Z])height:\s*/.test(text);

describe('INPUT_FIELD', () => {
  it('carries the three things that centre text, and no height', () => {
    expect(INPUT_FIELD.paddingVertical).toBe(0);
    expect(INPUT_FIELD.textAlignVertical).toBe('center');
    expect(INPUT_FIELD.includeFontPadding).toBe(false);
    // The whole point: it centres text, it never sizes a box.
    expect(INPUT_FIELD).not.toHaveProperty('height');
    expect(INPUT_FIELD).not.toHaveProperty('lineHeight');
  });
});

describe('the input rule holds across every screen and component', () => {
  it('the scan actually reaches the app', () => {
    // A scan over nothing passes forever and tells you nothing.
    expect(files.length).toBeGreaterThan(50);
  });

  it('no text field stretches to its parent', () => {
    const offenders = [];
    eachFieldStyle(({ file, name, text }) => {
      if (/height:\s*'100%'/.test(text)) offenders.push(`${file} — ${name}`);
    });
    expect(offenders).toEqual([]);
  });

  it('a text field that sets its own height also spreads INPUT_FIELD', () => {
    const offenders = [];
    eachFieldStyle(({ file, name, text }) => {
      if (declaresHeight(text) && !text.includes('INPUT_FIELD')) {
        offenders.push(`${file} — ${name}`);
      }
    });
    expect(offenders).toEqual([]);
  });
});
