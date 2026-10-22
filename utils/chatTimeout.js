/**
 * How long the phone waits for one chat turn.
 *
 * This is the fix for "network request timeout" on a chat question. RN's fetch
 * has no JS-level deadline, so the abort came from iOS instead — NSURLSession
 * gives up at 60s with its own wording, which tells the user nothing and
 * throws away the reply the server was still writing.
 *
 * The number has to sit in a window, and both edges are real:
 *
 *   • ABOVE the server's own cap. The chat answers on the `claude` CLI, which
 *     the server kills at 50s and reports as a sentence ("took longer than
 *     50s. Ask for one piece of it…"). Aborting before that lands would
 *     replace a useful message with a generic one.
 *   • BELOW the platform's 60s. Measured turns reached 61s, which is exactly
 *     how the platform ended up answering for us.
 *
 * 55s leaves the server's answer room to arrive and still beats iOS to it, so
 * whatever the user reads is a sentence this app chose.
 */
export const CHAT_TIMEOUT_MS = 55000;

export default CHAT_TIMEOUT_MS;
