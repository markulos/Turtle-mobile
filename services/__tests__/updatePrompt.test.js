import {
  PROMPT_ACTION, PROMPT_BODY, PROMPT_DISMISS, PROMPT_DISMISS_NOTE, PROMPT_TITLE,
  READY, shouldPrompt,
} from '../updatePrompt';

/**
 * WHEN the app may interrupt you to offer an update.
 *
 * The check and the download have run since 2026-11-13 and applied nothing;
 * all that is new is saying so. These are the rules for that, away from the
 * renderer and the native module — the same reason launchUpdate is a service.
 */

describe('shouldPrompt', () => {
  test('only once the bytes are HERE', () => {
    // The button promises a restart. Offering it on `available` would put a
    // download of unknown length behind a button that said it was instant —
    // and on a bad connection that is a spinner with no end in sight.
    expect(shouldPrompt(READY)).toBe(true);
    for (const other of ['available', 'current', 'error', 'skipped', undefined, null]) {
      expect(shouldPrompt(other)).toBe(false);
    }
  });

  test('ONCE — a second check in the same launch says nothing', () => {
    // The foreground re-check runs every half hour and resolves `ready` every
    // time, because the update is still sitting on the phone. Without the
    // latch this is a prompt that reappears all day, which is the difference
    // between asking and nagging.
    expect(shouldPrompt(READY, { seen: false })).toBe(true);
    expect(shouldPrompt(READY, { seen: true })).toBe(false);
  });

  test('never in a dev client, where every Updates call throws', () => {
    expect(shouldPrompt(READY, { isDev: true })).toBe(false);
  });

  test('…and an explicit off switch, for a caller that has its own reason', () => {
    expect(shouldPrompt(READY, { enabled: false })).toBe(false);
  });

  test('the copy says what the button DOES, not just that there is an update', () => {
    // "Update available" makes the reader guess what happens to the thing
    // they were in the middle of. This one says it restarts, and that unsent
    // typing goes with it.
    expect(PROMPT_ACTION).toMatch(/restart/i);
    expect(PROMPT_BODY).toMatch(/restart/i);
    expect(PROMPT_BODY).toMatch(/downloaded/i);
    expect(PROMPT_TITLE).toMatch(/ready/i);
  });

  test('…and saying no is spelled out as free, because it is', () => {
    // The ask was "just a button", and a prompt with no way out is a trap —
    // this one can land over a half-written message. The dismissal costs
    // nothing at all, so the note says so rather than leaving it to be
    // guessed.
    expect(PROMPT_DISMISS).toBeTruthy();
    expect(PROMPT_DISMISS_NOTE).toMatch(/next time|anyway/i);
  });
});
