/**
 * The sync arithmetic under the transcript reader. Pinned because each rule
 * here is invisible when it holds and a flicker or a lag when it does not:
 * the lead, the stickiness between words, and "nothing lit" before the first.
 */
const {
  FOLLOW_ANCHOR,
  LEAD_SECONDS,
  activeTurnIndex,
  activeWordIndex,
  scrollTargetOffset,
  summaryLine,
  turnsFromResult,
  voicesIn,
} = require('../transcriptSync');

const words = [
  { word: 'Hello', start: 0.5, end: 0.8 },
  { word: 'there', start: 0.9, end: 1.2 },
  { word: 'friend', start: 2.0, end: 2.4 },
];

describe('activeWordIndex', () => {
  it('lights nothing before the first word starts', () => {
    expect(activeWordIndex(words, 0)).toBe(-1);
    expect(activeWordIndex(words, 0.3)).toBe(-1);
  });

  it('runs a lead ahead of the reported position, so the word lights with the sound', () => {
    // 0.5 − 0.12 = 0.38: the first word is lit before its own start.
    expect(activeWordIndex(words, 0.39)).toBe(0);
    expect(activeWordIndex(words, 0.37)).toBe(-1);
    expect(LEAD_SECONDS).toBeCloseTo(0.12);
  });

  it('is sticky: between words the last one stays lit', () => {
    // 1.2..2.0 is a gap; the second word holds until the third starts.
    expect(activeWordIndex(words, 1.5)).toBe(1);
    expect(activeWordIndex(words, 1.87)).toBe(1);
    expect(activeWordIndex(words, 1.88)).toBe(2);
  });

  it('holds the last word after the end of the list', () => {
    expect(activeWordIndex(words, 99)).toBe(2);
  });

  it('answers -1 for nothing to search or a position the player has not reported', () => {
    expect(activeWordIndex([], 1)).toBe(-1);
    expect(activeWordIndex(null, 1)).toBe(-1);
    expect(activeWordIndex(words, NaN)).toBe(-1);
    expect(activeWordIndex(words, undefined)).toBe(-1);
  });

  it('is a binary search: finds the right word in a long list', () => {
    const many = Array.from({ length: 5000 }, (_, i) => ({ word: `w${i}`, start: i * 0.3, end: i * 0.3 + 0.2 }));
    expect(activeWordIndex(many, 900.0)).toBe(3000);
    expect(activeWordIndex(many, 900.05)).toBe(3000);
    expect(activeWordIndex(many, 900.2)).toBe(3001); // 900.2 + 0.12 ≥ 900.3
  });

  it('accepts a custom lead', () => {
    expect(activeWordIndex(words, 0.4, { lead: 0 })).toBe(-1);
    expect(activeWordIndex(words, 0.5, { lead: 0 })).toBe(0);
  });
});

describe('activeTurnIndex', () => {
  const turns = [
    { start: 0, end: 4 },
    { start: 5, end: 9 },
    { start: 12, end: 20 },
  ];

  it('picks the turn that has started most recently, holding through gaps', () => {
    expect(activeTurnIndex(turns, 0)).toBe(0);
    expect(activeTurnIndex(turns, 4.5)).toBe(0);   // between turns: sticky
    expect(activeTurnIndex(turns, 5)).toBe(1);
    expect(activeTurnIndex(turns, 11.9)).toBe(2);  // the lead reaches 12
    expect(activeTurnIndex(turns, 30)).toBe(2);
  });

  it('lights nothing before the first turn when it starts late', () => {
    expect(activeTurnIndex([{ start: 3 }, { start: 8 }], 1)).toBe(-1);
  });
});

describe('turnsFromResult', () => {
  it('reads the wire into turns with words, sorted, and words always an array', () => {
    const turns = turnsFromResult({
      turns: [
        { speaker: 'Mark', start: 5, end: 9, text: 'Second line', words: [{ word: 'Second', start: 5, end: 5.4 }, { word: 'line', start: 5.5, end: 5.9 }] },
        { speaker: 'Anna', start: 0, end: 4, text: 'First line' },
      ],
    });
    expect(turns.map((t) => t.speaker)).toEqual(['Anna', 'Mark']);
    expect(turns[0].words).toEqual([]);
    expect(turns[1].words).toHaveLength(2);
    expect(turns[1]).toMatchObject({ start: 5, end: 9, text: 'Second line' });
  });

  it('drops a word without timings and sorts the rest by start', () => {
    const [turn] = turnsFromResult({
      turns: [{
        start: 0, end: 3, text: 'b a',
        words: [
          { word: 'b', start: 1, end: 1.5 },
          { word: '.', start: null, end: null },
          { word: 'a', start: 0.2, end: 0.5, score: 0.9 },
          { word: '', start: 0.1, end: 0.2 },
        ],
      }],
    });
    expect(turn.words.map((w) => w.word)).toEqual(['a', 'b']);
    expect(turn.words[0].score).toBe(0.9);
    expect(turn.words[1].score).toBeUndefined();
  });

  it('coerces strings off the wire and never lets an end precede its start', () => {
    const [turn] = turnsFromResult({ turns: [{ start: '2.5', end: '1', text: 'x', words: [{ word: 'x', start: '2.5', end: '2.4' }] }] });
    expect(turn.start).toBe(2.5);
    expect(turn.end).toBe(2.5);
    expect(turn.words[0].end).toBe(2.5);
  });

  it('keeps a turn that has text but no timing of its own, after the previous one', () => {
    const turns = turnsFromResult({
      turns: [
        { start: 0, end: 4, text: 'timed' },
        { text: 'untimed' },
        { start: 10, end: 12, text: 'later' },
      ],
    });
    expect(turns.map((t) => t.text)).toEqual(['timed', 'untimed', 'later']);
    expect(turns[1].start).toBe(4);
  });

  it('takes the timing from the words when the turn has none, and the text too', () => {
    const [turn] = turnsFromResult({ turns: [{ words: [{ word: 'only', start: 3, end: 3.5 }, { word: 'words', start: 3.6, end: 4 }] }] });
    expect(turn).toMatchObject({ start: 3, end: 4, text: 'only words', speaker: 'Speaker' });
  });

  it('survives junk', () => {
    expect(turnsFromResult(null)).toEqual([]);
    expect(turnsFromResult({ turns: 'nope' })).toEqual([]);
    expect(turnsFromResult({ turns: [null, 7, { text: '' }] })).toEqual([]);
  });
});

describe('scrollTargetOffset', () => {
  it('puts the item a third of the way down the viewport', () => {
    expect(FOLLOW_ANCHOR).toBeCloseTo(0.35);
    expect(scrollTargetOffset({ itemOffset: 1000, viewportHeight: 600, contentHeight: 5000 })).toBe(1000 - 210);
  });

  it('never scrolls above the top or past the end', () => {
    expect(scrollTargetOffset({ itemOffset: 100, viewportHeight: 600, contentHeight: 5000 })).toBe(0);
    expect(scrollTargetOffset({ itemOffset: 4900, viewportHeight: 600, contentHeight: 5000 })).toBe(4400);
  });

  it('is zero when the content fits the viewport', () => {
    expect(scrollTargetOffset({ itemOffset: 300, viewportHeight: 600, contentHeight: 400 })).toBe(0);
  });

  it('accepts a different anchor and tolerates junk', () => {
    expect(scrollTargetOffset({ itemOffset: 1000, viewportHeight: 600, contentHeight: 5000, anchor: 0.5 })).toBe(700);
    expect(scrollTargetOffset({ itemOffset: 'x', viewportHeight: null, contentHeight: undefined })).toBe(0);
  });
});

describe('voicesIn', () => {
  it('prefers what diarization reported, then the speakers list, then the labels', () => {
    expect(voicesIn({ detectedSpeakers: 3 }, [])).toBe(3);
    expect(voicesIn({ speakers: ['a', 'b'] }, [])).toBe(2);
    expect(voicesIn({}, [{ speaker: 'Mark' }, { speaker: 'Anna' }, { speaker: 'Mark' }])).toBe(2);
    expect(voicesIn(null, null)).toBe(0);
  });
});

describe('summaryLine', () => {
  it('joins only what is known', () => {
    expect(summaryLine({ speakers: 2, language: 'en', durationSeconds: 754 })).toBe('2 voices · EN · 12:34');
    expect(summaryLine({ speakers: 1, durationSeconds: 61 })).toBe('1 voice · 1:01');
    expect(summaryLine({})).toBe('');
  });
});
