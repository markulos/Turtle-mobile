import {
  ECHO_WINDOW_MS, byTime, isEchoed, mergeThread, optimisticMessage,
  timeLabel, startsNewDay, dayLabel,
} from '../friendMessages';

const srv = (over = {}) => ({
  id: 'm1', content: 'hello', createdAt: 1_000, mine: false, readAt: null, ...over,
});

describe('ordering', () => {
  test('oldest first — a thread reads downwards', () => {
    const out = [srv({ id: 'b', createdAt: 20 }), srv({ id: 'a', createdAt: 10 })].sort(byTime);
    expect(out.map((m) => m.id)).toEqual(['a', 'b']);
  });

  // Two rows stamped the same millisecond must not swap places between
  // renders — a bubble that moves while you read it looks like a new message.
  test('equal stamps keep a stable order', () => {
    const a = srv({ id: 'a', createdAt: 5 });
    const b = srv({ id: 'b', createdAt: 5 });
    expect([b, a].sort(byTime).map((m) => m.id)).toEqual(['a', 'b']);
    expect([a, b].sort(byTime).map((m) => m.id)).toEqual(['a', 'b']);
  });
});

describe('recognising your own message coming back', () => {
  // The headline case: our own `message:new` ping triggers a refetch that beats
  // the POST's reply home. Without this the sender sees the bubble twice.
  test('an optimistic bubble is echoed by the server row it became', () => {
    const local = optimisticMessage('on my way', { now: 1_000 });
    const rows = [srv({ id: 'real', content: 'on my way', createdAt: 1_400, mine: true })];
    expect(isEchoed(local, rows)).toBe(true);
    expect(mergeThread(rows, [local]).map((m) => m.id)).toEqual(['real']);
  });

  test('the same words from the FRIEND are a different message', () => {
    const local = optimisticMessage('same here', { now: 1_000 });
    const theirs = [srv({ id: 'theirs', content: 'same here', createdAt: 1_200, mine: false })];
    expect(isEchoed(local, theirs)).toBe(false);
    expect(mergeThread(theirs, [local])).toHaveLength(2);
  });

  test('the same words much later are a different message', () => {
    const local = optimisticMessage('ok', { now: 0 });
    const rows = [srv({ id: 'old', content: 'ok', createdAt: ECHO_WINDOW_MS + 1, mine: true })];
    expect(isEchoed(local, rows)).toBe(false);
  });

  test('clock drift between the phone and the pond is tolerated either way', () => {
    const local = optimisticMessage('hi', { now: 100_000 });
    const behind = [srv({ id: 'r', content: 'hi', createdAt: 100_000 - 5_000, mine: true })];
    const ahead = [srv({ id: 'r', content: 'hi', createdAt: 100_000 + 5_000, mine: true })];
    expect(isEchoed(local, behind)).toBe(true);
    expect(isEchoed(local, ahead)).toBe(true);
  });

  test('whitespace is not a difference', () => {
    const local = optimisticMessage('  hey  ', { now: 10 });
    expect(isEchoed(local, [srv({ content: 'hey', createdAt: 12, mine: true })])).toBe(true);
  });

  test('an empty bubble never matches anything', () => {
    expect(isEchoed(optimisticMessage('   '), [srv({ content: '', mine: true })])).toBe(false);
  });
});

describe('mergeThread', () => {
  test('a still-unsent bubble is kept, in its place in time', () => {
    const rows = [srv({ id: 'a', createdAt: 10 })];
    const local = optimisticMessage('later', { now: 50 });
    expect(mergeThread(rows, [local]).map((m) => m.id)).toEqual(['a', local.id]);
  });

  // A failed send is the ONLY record that it did not land. Dropping it because
  // the words match something would tell someone their message got through.
  test('a FAILED bubble survives even when the words are echoed', () => {
    const local = { ...optimisticMessage('did this send?', { now: 1_000 }), failed: true };
    const rows = [srv({ id: 'real', content: 'did this send?', createdAt: 1_100, mine: true })];
    const out = mergeThread(rows, [local]);
    expect(out).toHaveLength(2);
    expect(out.some((m) => m.failed)).toBe(true);
  });

  test('junk in does not throw and does not invent rows', () => {
    expect(mergeThread(null, null)).toEqual([]);
    expect(mergeThread([null, srv()], [undefined])).toHaveLength(1);
    expect(mergeThread()).toEqual([]);
  });
});

describe('labels', () => {
  test('a bubble carries a clock time, not a relative one', () => {
    // Built from a local-time constructor so the assertion does not depend on
    // the machine's zone.
    const ts = new Date(2026, 2, 12, 9, 4).getTime();
    expect(timeLabel(ts, { locale: 'en-US' })).toMatch(/9:04/);
  });

  test('a bad stamp is empty, never "Invalid Date"', () => {
    expect(timeLabel(NaN)).toBe('');
    expect(timeLabel(null)).toBe('');
    expect(dayLabel(NaN)).toBe('');
  });

  test('the first message always opens a day', () => {
    expect(startsNewDay(srv(), null)).toBe(true);
  });

  test('a day breaks where the people in it think it broke', () => {
    const lateNight = new Date(2026, 2, 12, 23, 50).getTime();
    const afterMidnight = new Date(2026, 2, 13, 0, 10).getTime();
    expect(startsNewDay({ createdAt: afterMidnight }, { createdAt: lateNight })).toBe(true);
    expect(startsNewDay({ createdAt: lateNight }, { createdAt: lateNight - 60_000 })).toBe(false);
  });

  test('today and yesterday are named, older days are dated', () => {
    const now = new Date(2026, 2, 12, 12, 0).getTime();
    expect(dayLabel(new Date(2026, 2, 12, 8, 0).getTime(), { now })).toBe('Today');
    expect(dayLabel(new Date(2026, 2, 11, 8, 0).getTime(), { now })).toBe('Yesterday');
    expect(dayLabel(new Date(2026, 2, 1, 8, 0).getTime(), { now, locale: 'en-GB' })).toMatch(/Mar/);
  });
});

/**
 * A message with PHOTOS has to settle the same way a message with words does.
 *
 * Matching on text alone could never recognise a photo sent on its own in the
 * server's answer, so that bubble stayed on screen twice — once as an optimistic
 * copy that can never settle, once as the real row.
 */
describe('photos count as identity', () => {
  const now = 1_700_000_000_000;
  const attach = (ids) => ids.map((mediaId) => ({ type: 'media', mediaId }));

  test('a photo-only bubble settles into its server row', () => {
    const local = optimisticMessage('', { now, seq: 1, attachments: attach(['m1']) });
    const serverRow = {
      id: 'srv1', mine: true, content: '', attachments: attach(['m1']), createdAt: now + 400,
    };
    expect(isEchoed(local, [serverRow])).toBe(true);
    // And so the thread draws it ONCE.
    expect(mergeThread([serverRow], [local]).map((m) => m.id)).toEqual(['srv1']);
  });

  test('two different photo-only messages seconds apart are NOT confused', () => {
    // The thing text matching could never do: tell apart two messages that both
    // say nothing. Vault ids are unique, so this is a sharper match, not a looser one.
    const local = optimisticMessage('', { now, seq: 1, attachments: attach(['m2']) });
    const other = {
      id: 'srv1', mine: true, content: '', attachments: attach(['m1']), createdAt: now + 400,
    };
    expect(isEchoed(local, [other])).toBe(false);
    expect(mergeThread([other], [local])).toHaveLength(2);
  });

  test('a caption with photos has to match on BOTH halves', () => {
    const local = optimisticMessage('look at this', { now, seq: 1, attachments: attach(['m1']) });
    const sameWords = {
      id: 'srv1', mine: true, content: 'look at this', attachments: [], createdAt: now + 400,
    };
    expect(isEchoed(local, [sameWords])).toBe(false);
    expect(isEchoed(local, [{ ...sameWords, attachments: attach(['m1']) }])).toBe(true);
  });

  test('a plain text message is unaffected by rows that carry no attachments field', () => {
    // An older pond does not send one at all; that must still read as "none".
    const local = optimisticMessage('on my way', { now, seq: 1 });
    expect(isEchoed(local, [{ id: 'srv1', mine: true, content: 'on my way', createdAt: now }])).toBe(true);
  });

  test('a bubble with neither words nor photos is still never matched', () => {
    expect(isEchoed(optimisticMessage('', { now, seq: 1 }), [
      { id: 'srv1', mine: true, content: '', createdAt: now },
    ])).toBe(false);
  });
});
