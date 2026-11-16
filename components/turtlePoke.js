/**
 * turtlePoke — how much poking the mark will take before he leaves.
 *
 * Mark, 2026-11-16: "on poking the svg icon of the turtle in the top right
 * instead of redirecting to profile let the turtle have a cute nudge
 * animation and if done too many times make him go off the ledge but come
 * back after a bit."
 *
 * The rules are here rather than in the component for the usual reason: they
 * are the part worth being sure about, and they can be checked without a
 * renderer, a native module or a clock.
 *
 * ── Why the pokes expire ──────────────────────────────────────────────────
 *
 * A plain counter would mean the fifth poke of the week sends him off the
 * ledge, which reads as a bug rather than as a reaction. The joke only works
 * if it is clearly a response to BEING PESTERED — several in quick
 * succession — so the count resets once you have left him alone for a
 * moment.
 */

/** How many pokes in a row he will put up with. The next one is too many. */
export const POKE_LIMIT = 5;
/**
 * Pokes further apart than this are not a pestering, they are two separate
 * hellos — the run starts again. Comfortably longer than a fast tap-tap-tap
 * and well short of "I came back later".
 */
export const POKE_WINDOW_MS = 1800;
/**
 * How long he stays gone. Long enough to read as a sulk and to be missed,
 * short enough that nobody thinks they have broken him — and the header
 * keeps its ridge and its title the whole time, so nothing looks absent
 * except him.
 */
export const SULK_MS = 4200;

/**
 * The next state after a poke.
 *
 * `state` is `{ count, lastAt }`; pass `now` so this is testable without a
 * clock. Returns the new state plus `flee`, true on the poke that is one too
 * many — and the count resets with it, so coming back he starts with a clean
 * slate rather than fleeing again on the first touch.
 */
export function nextPoke(state, now) {
  const { count = 0, lastAt = 0 } = state || {};
  // A poke after the window is the start of a new run, not the n+1th.
  const run = now - lastAt <= POKE_WINDOW_MS ? count + 1 : 1;
  if (run > POKE_LIMIT) return { count: 0, lastAt: now, flee: true };
  return { count: run, lastAt: now, flee: false };
}

/**
 * Which way he rocks. Alternating, so a run of pokes knocks him side to side
 * rather than nudging him the same way five times — which would read as a
 * glitch repeating rather than as him being jostled.
 */
export function pokeWay(count) {
  return count % 2 === 1 ? 1 : -1;
}

export default { nextPoke, pokeWay, POKE_LIMIT, POKE_WINDOW_MS, SULK_MS };
