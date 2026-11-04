import fs from 'fs';
import path from 'path';

import { SCROLL_INDICATOR, scrollIndicator } from '../scrollIndicator';

/**
 * THE SCROLL BAR GOES ON THE EDGE, AND THIS IS WHAT KEEPS IT THERE.
 *
 * iOS places the indicator itself unless you tell it not to:
 * `automaticallyAdjustsScrollIndicatorInsets` is on by default and derives the
 * insets from the scroll view's adjusted content inset. On a plain screen that
 * lands roughly where you would have put it, which is why this is easy to miss
 * — but inside the surfaces this app is made of (an overlay page, a
 * transparent Modal, a sheet over a pager) the number has nothing to do with
 * the panel you are looking at, and the bar is drawn INSIDE the content. On
 * the profile card it came down the middle of the page.
 *
 * It was fixed one surface at a time for a year: 20 scrollables had the inset
 * and 47 did not, which is why it read as "the app does this everywhere". One
 * spread (`utils/scrollIndicator`) now carries it, and this makes going
 * without a test failure rather than a thing nobody notices until they see a
 * screenshot.
 *
 * ─── The two real exceptions ───────────────────────────────────────────────
 *
 *   · `horizontal` — its bar runs along the bottom, and `right` means nothing.
 *   · `showsVerticalScrollIndicator={false}` — there is no bar to place.
 *
 * Anything else that scrolls vertically and shows a bar must spread the rule.
 * A convention nobody enforces drifts back — the same reasoning behind the
 * headerRule, INPUT_FIELD and tabBarLayout scans.
 */
const ROOTS = ['screens', 'components'];
const EXT = new Set(['.js', '.jsx']);

/** Every scrollable, however it is wrapped. */
const TAG = /<(?:Animated\.|Reanimated\.)?(?:ScrollView|FlatList|SectionList|FlashList)\b(?!\s*\.)/g;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (EXT.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

/** The element's props: from the tag to the `>` that closes it. */
function propsOf(src, start) {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    else if (c === '>' && depth === 0) return src.slice(start, i);
  }
  return src.slice(start, start + 800);
}

function scan() {
  const all = [];
  const offenders = [];
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      const src = fs.readFileSync(file, 'utf8');
      TAG.lastIndex = 0;
      let m;
      while ((m = TAG.exec(src))) {
        const props = propsOf(src, m.index);
        all.push(file);
        // `.Context.Provider` is not a list — the negative lookahead on the
        // tag keeps it out, and this is the case that broke the first sweep.
        if (/\bhorizontal\b/.test(props)) continue;
        if (/showsVerticalScrollIndicator=\{false\}/.test(props)) continue;
        if (/SCROLL_INDICATOR|scrollIndicator\(/.test(props)) continue;
        const rel = file.split(path.sep).join('/');
        offenders.push(`${rel} → ${m[0]}`);
      }
    }
  }
  return { all, offenders };
}

describe('one scroll bar position, app-wide', () => {
  test('the scan actually reaches the app (a silent zero would pass forever)', () => {
    const { all } = scan();
    expect(all.length).toBeGreaterThan(80);
    expect(all.some((f) => f.includes('TurtleScreen'))).toBe(true);
    expect(all.some((f) => f.includes('TasksScreen'))).toBe(true);
  });

  test('every vertical scrollable spreads the shared rule', () => {
    // Named, so a failure says which file and which tag rather than a count.
    expect(scan().offenders).toEqual([]);
  });

  // The literal is how it drifted before: twenty surfaces each spelling out
  // `{{ right: 1 }}`, and nothing saying what the number meant or that the
  // other forty-seven were missing it.
  test('and nobody writes the insets out by hand any more', () => {
    const written = [];
    for (const root of ROOTS) {
      for (const file of walk(root)) {
        if (/scrollIndicatorInsets=/.test(fs.readFileSync(file, 'utf8'))) {
          written.push(file.split(path.sep).join('/'));
        }
      }
    }
    expect(written).toEqual([]);
  });
});

describe('the rule itself', () => {
  // Required: the explicit insets alone only beat UIKit's guess by side
  // effect, and the flag is what makes it survive an RN upgrade.
  test('it turns the automatic adjustment OFF, not just sets a number', () => {
    expect(SCROLL_INDICATOR.automaticallyAdjustsScrollIndicatorInsets).toBe(false);
    expect(SCROLL_INDICATOR.scrollIndicatorInsets).toEqual({ right: 1 });
    // An override keeps `right` — the whole point is that the bar is in the
    // same place on every screen.
    expect(scrollIndicator({ bottom: 80 })).toEqual({
      automaticallyAdjustsScrollIndicatorInsets: false,
      scrollIndicatorInsets: { right: 1, bottom: 80 },
    });
  });
});
