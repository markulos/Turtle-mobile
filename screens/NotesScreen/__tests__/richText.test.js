import {
  URL_PLACEHOLDER, insertLink, isUrlish, normalizeSelection, normalizeUrl, wrapSelection,
} from '../richText';

/**
 * The three keys the note composer grew for Mark's "Hyperlink in notes".
 *
 * All of it is off-by-one arithmetic on a string plus the selection that
 * comes back, and the selection is the half that decides whether a key is
 * usable: one that leaves the caret somewhere arbitrary is a key you press
 * once and never again. None of that can be seen from a render test, and all
 * of it can be seen from here.
 */

const at = (n) => ({ start: n, end: n });

describe('wrapSelection', () => {
  test('wraps what is selected, AND KEEPS IT SELECTED', () => {
    // So a second key compounds: bold, then italic, on the same words.
    const r = wrapSelection('buy some milk', { start: 4, end: 8 }, '**');
    expect(r.text).toBe('buy **some** milk');
    expect(r.text.slice(r.selection.start, r.selection.end)).toBe('some');
  });

  test('with nothing selected it opens a pair and puts the caret INSIDE', () => {
    const r = wrapSelection('buy ', at(4), '**');
    expect(r.text).toBe('buy ****');
    expect(r.selection).toEqual(at(6));
  });

  test('IT IS A TOGGLE — pressing it again takes the markers off', () => {
    // `****bold****` is not something anybody meant.
    const once = wrapSelection('buy some milk', { start: 4, end: 8 }, '**');
    const twice = wrapSelection(once.text, once.selection, '**');
    expect(twice.text).toBe('buy some milk');
    expect(twice.text.slice(twice.selection.start, twice.selection.end)).toBe('some');
  });

  test('…including when the markers are inside the selection', () => {
    const r = wrapSelection('buy **some** milk', { start: 4, end: 12 }, '**');
    expect(r.text).toBe('buy some milk');
    expect(r.text.slice(r.selection.start, r.selection.end)).toBe('some');
  });

  test('italic is the same key with a different marker', () => {
    const r = wrapSelection('buy some milk', { start: 4, end: 8 }, '_');
    expect(r.text).toBe('buy _some_ milk');
  });

  test('a backwards or out-of-range selection is not a crash', () => {
    // A drag right-to-left reports start > end, and a stale selection ref can
    // point past a string the user has since deleted.
    expect(wrapSelection('abc', { start: 3, end: 1 }, '**').text).toBe('a**bc**');
    expect(wrapSelection('abc', { start: 99, end: 99 }, '**').text).toBe('abc****');
    expect(wrapSelection('', at(0), '**').text).toBe('****');
    expect(wrapSelection(null, null, '**').text).toBe('****');
  });

  test('no marker is no edit', () => {
    expect(wrapSelection('abc', at(1), '').text).toBe('abc');
  });
});

describe('isUrlish / normalizeUrl', () => {
  test('what is worth putting in a link', () => {
    expect(isUrlish('https://turtle.pond/x')).toBe(true);
    expect(isUrlish('turtle.pond')).toBe(true);
    expect(isUrlish('turtle.pond/notes?a=1')).toBe(true);
    expect(isUrlish('buy milk')).toBe(false);
    expect(isUrlish('milk')).toBe(false);
    expect(isUrlish('')).toBe(false);
    expect(isUrlish(null)).toBe(false);
  });

  test('a bare host gets a scheme, because it is a link either way', () => {
    expect(normalizeUrl('turtle.pond')).toBe('https://turtle.pond');
    expect(normalizeUrl('http://x.dev')).toBe('http://x.dev');
    expect(normalizeUrl('https://x.dev')).toBe('https://x.dev');
    expect(normalizeUrl('  x.dev  ')).toBe('https://x.dev');
    expect(normalizeUrl('')).toBe('');
  });
});

describe('insertLink', () => {
  test('TEXT SELECTED + A URL TO HAND is the one-tap case', () => {
    // Copy a link, select the words, press the key. Nothing left to type.
    const r = insertLink('see the notes', { start: 4, end: 13 }, 'turtle.pond/n');
    expect(r.text).toBe('see [the notes](https://turtle.pond/n)');
    expect(r.text.slice(r.selection.start, r.selection.end))
      .toBe('[the notes](https://turtle.pond/n)');
  });

  test('text selected, no url → the URL part is what is selected', () => {
    // So the next thing typed or pasted replaces the placeholder.
    const r = insertLink('see the notes', { start: 4, end: 13 }, null);
    expect(r.text).toBe('see [the notes](https://)');
    expect(r.text.slice(r.selection.start, r.selection.end)).toBe(URL_PLACEHOLDER);
  });

  test('nothing selected → the LABEL is where the caret goes', () => {
    // An empty label is the part you cannot leave empty; the url can wait.
    const r = insertLink('see ', at(4), 'turtle.pond');
    expect(r.text).toBe('see [](https://turtle.pond)');
    expect(r.selection).toEqual(at(5));
  });

  test('…and with neither, it is still the label first', () => {
    const r = insertLink('', at(0), null);
    expect(r.text).toBe('[](https://)');
    expect(r.selection).toEqual(at(1));
  });

  test('IT IS THE SHAPE THE RENDERER READS', () => {
    // The whole feature rests on this: what the key writes has to be what
    // markdownLite parses as a link. Asserted against the real parser.
    const { parseInline } = require('../../../utils/markdownLite');
    const r = insertLink('open the pond', { start: 5, end: 13 }, 'turtle.pond');
    const spans = parseInline(r.text);
    const link = spans.find((s) => s.link);
    expect(link).toBeTruthy();
    expect(link.text).toBe('the pond');
    expect(link.link).toBe('https://turtle.pond');
  });

  test('a backwards selection links the same words', () => {
    const r = insertLink('see the notes', { start: 13, end: 4 }, 'x.dev');
    expect(r.text).toBe('see [the notes](https://x.dev)');
  });
});

describe('normalizeSelection', () => {
  test('never backwards, never outside the text', () => {
    expect(normalizeSelection('abcde', { start: 4, end: 1 })).toEqual({ start: 1, end: 4 });
    expect(normalizeSelection('abcde', { start: -3, end: 99 })).toEqual({ start: 0, end: 5 });
    expect(normalizeSelection('abcde', null)).toEqual({ start: 0, end: 0 });
    expect(normalizeSelection('abcde', { start: 2 })).toEqual({ start: 2, end: 2 });
  });
});
