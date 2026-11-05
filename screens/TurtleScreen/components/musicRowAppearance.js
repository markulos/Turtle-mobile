/**
 * What a track row should look like, given its download state and whether
 * the pond can be reached.
 *
 * Pulled out of MusicVault because this is the actual decision — the JSX
 * around it only turns the answer into a background colour and a width —
 * and because the two states that matter most are the ones hardest to get
 * on screen in a test: a download half way through, and a phone with no
 * pond.
 */

/**
 * @param {object} status  from musicOfflineStore.statusOf()
 * @param {boolean} isConnected  can the POND be reached — not "are there
 *   bars". 5G with no route to the pond still cannot play a streamed track,
 *   and that is the case the greying exists for.
 */
export function rowOfflineAppearance(status, isConnected) {
  const state = status?.state || 'absent';
  const kept = state === 'done';
  return {
    state,
    kept,
    /** Row width taken by the progress fill, 0–100. Zero unless downloading. */
    fillPercent: state === 'downloading'
      ? Math.max(0, Math.min(100, Math.round((status?.progress || 0) * 100)))
      : 0,
    /**
     * No pond and no local copy: there is nothing to play. A download IN
     * FLIGHT is not playable yet either, but it is deliberately not greyed —
     * it is visibly doing something, and dimming the one row on screen that
     * is making progress would hide exactly the thing worth watching.
     */
    unreachable: !isConnected && !kept && state !== 'downloading',
  };
}
