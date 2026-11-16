/**
 * updatePrompt — WHEN to offer the update that is already on the phone, and
 * what the one button does.
 *
 * ─── What was already true ─────────────────────────────────────────────────
 *
 * `services/launchUpdate` has checked for a newer update since 2026-11-13:
 * shortly after launch, and again on coming back after half an hour. It
 * DOWNLOADS what it finds and applies nothing — expo-updates launches a
 * downloaded update the next time the app starts, so a bad one heals in two
 * opens and a good one simply arrives.
 *
 * "The next time the app starts" is the part Mark could not see. An app left
 * resident for a week never cold-starts, so the update sat on the phone and
 * nothing said so except a dot on the Profile tab. 2026-11-16: "anytime the
 * app opens, have an autocheck if there is a new update with a prompt and if
 * there is prompt user to update now with just a button to update and restart."
 *
 * ─── The rules, which is all this file is ──────────────────────────────────
 *
 * The check and the download are unchanged. This decides whether to SAY so.
 *
 *  · Only on `ready` — the bytes are already here, so the button is a
 *    restart and not a download over a bad connection. Offering "update now"
 *    before the download finishes would put a spinner of unknown length
 *    behind a button that promised to be instant.
 *  · ONCE. Dismissed is dismissed for the life of this launch, and the
 *    re-check on foregrounding must not bring it back — that is the
 *    difference between a prompt and nagging. Nothing is lost by saying no:
 *    the update still applies on the next cold start, which is exactly what
 *    happened before this prompt existed.
 *  · Never in a dev client, where every Updates call throws, and never for
 *    an update this launch is already running.
 *
 * Kept out of the component so the rules can be tested without a native
 * module and without a renderer — the same reason launchUpdate is a service.
 */

/** The states `checkAndDownload` resolves to that mean "there is one here". */
export const READY = 'ready';

/**
 * Should the prompt be shown for this result?
 *
 * `seen` is the latch — the caller's record of having already offered this
 * launch, whether the answer was yes, no, or the sheet is open right now.
 */
export function shouldPrompt(result, { seen = false, isDev = false, enabled = true } = {}) {
  if (isDev || !enabled) return false;
  if (seen) return false;
  return result === READY;
}

/**
 * What the sheet says. One sentence of fact and one of consequence — a
 * prompt that only says "update available" makes the reader guess what the
 * button will do to the thing they were in the middle of.
 */
export const PROMPT_TITLE = 'A new version is ready';
export const PROMPT_BODY = 'It is already downloaded. Updating restarts the app — it takes a second, and anything you have typed but not sent will be lost.';
export const PROMPT_ACTION = 'Update & restart';
export const PROMPT_DISMISS = 'Not now';
/**
 * …and why there IS a dismiss, when the ask was for "just a button".
 *
 * A prompt with no way out is a trap, and this one can appear over a half
 * written message. Saying no costs nothing at all — the update is on the
 * phone and applies on the next cold start regardless — so the honest shape
 * is one prominent button and one quiet way past it.
 */
export const PROMPT_DISMISS_NOTE = 'It will be applied next time the app starts anyway.';

export default { shouldPrompt, READY };
