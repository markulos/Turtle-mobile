import { finderDestination, KIND_SEP, FIELD_SEP, KIND_LABEL } from '../finderDestination';

describe('finderDestination', () => {
  test('reads KIND | day • board', () => {
    const d = finderDestination({ dateLabel: 'Wed, Sep 16', board: 'Ambarch' });
    expect(d.text).toBe('TO-DO | Wed, Sep 16 • Ambarch');
    // Pinned separately: the two separators are different ON PURPOSE — a pipe
    // to the kind, a bullet between the day and the board, which are peers.
    expect(KIND_SEP).toBe(' | ');
    expect(FIELD_SEP).toBe(' • ');
    expect(KIND_LABEL).toBe('TO-DO');
  });

  test.each([['All'], ['No Project'], ['all'], ['NO PROJECT'], [''], [null], [undefined]])(
    'says "All" rather than nothing when the board is %p',
    (board) => {
      const d = finderDestination({ dateLabel: 'Wed, Sep 16', board });
      expect(d.board).toBe('All');
      expect(d.filed).toBe(false);
      expect(d.text).toBe('TO-DO | Wed, Sep 16 • All');
    },
  );

  test('flags a real board so the caller can treat it differently', () => {
    expect(finderDestination({ dateLabel: 'Wed, Sep 16', board: 'Ambarch' }).filed).toBe(true);
  });

  test('drops the day cleanly rather than leaving a dangling separator', () => {
    expect(finderDestination({ board: 'Ambarch' }).text).toBe('TO-DO | Ambarch');
    expect(finderDestination({ dateLabel: '   ', board: 'Ambarch' }).text).toBe('TO-DO | Ambarch');
  });

  // The glyphs read as "vertical line" and "bullet" to a screen reader, which
  // helps nobody — speech gets commas instead.
  test('offers a spoken form without the glyphs', () => {
    const d = finderDestination({ dateLabel: 'Wed, Sep 16', board: 'Ambarch' });
    expect(d.speech).toBe('TO-DO, Wed, Sep 16, Ambarch');
    expect(d.speech).not.toContain('|');
    expect(d.speech).not.toContain('•');
  });

  test('trims what it is given', () => {
    expect(finderDestination({ dateLabel: '  Wed, Sep 16 ', board: ' Ambarch ' }).text)
      .toBe('TO-DO | Wed, Sep 16 • Ambarch');
  });

  test('takes a different kind when the caller has one', () => {
    expect(finderDestination({ dateLabel: 'Wed, Sep 16', board: 'All', kind: 'EVENT' }).text)
      .toBe('EVENT | Wed, Sep 16 • All');
  });
});

// A long board name is what gets cut off the header line — the + key beside it
// takes the width. Rather than guess at a character count (which cannot know
// the screen width or the user's type scale), the line reports what it managed
// to draw and the board drops to a subtitle when that is less than it was given.
describe('wasTruncated', () => {
  const { wasTruncated } = require('../finderDestination');

  test('a line that fitted reports back what it was given', () => {
    expect(wasTruncated('TO-DO | Thu, Sep 17 • All', 'TO-DO | Thu, Sep 17 • All')).toBe(false);
  });

  test('a cut line reports less, ellipsis and all', () => {
    expect(wasTruncated('TO-DO | Today · Thu, Sep 17 • AMB Archi…', 'TO-DO | Today · Thu, Sep 17 • AMB Architects')).toBe(true);
  });

  test('the ellipsis itself never counts as content', () => {
    // Otherwise a line cut by exactly one character would look like it fitted.
    expect(wasTruncated('abcde…', 'abcdef')).toBe(true);
  });

  test('says "not cut" rather than throwing when there is nothing to compare', () => {
    expect(wasTruncated(null, 'x')).toBe(false);
    expect(wasTruncated('x', null)).toBe(false);
    expect(wasTruncated('', '')).toBe(false);
    expect(wasTruncated(undefined, undefined)).toBe(false);
  });
});
