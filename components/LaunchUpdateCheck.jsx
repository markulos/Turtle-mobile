/**
 * LaunchUpdateCheck — runs services/launchUpdate at the two moments it is for,
 * and offers what it finds.
 *
 * Shortly after launch, and on coming back to the foreground when the last
 * check is old, it asks the pond for a newer update and downloads it in the
 * background. Nothing is applied behind your back: a downloaded update
 * launches the next time the app starts. See launchUpdate for why.
 *
 * WHAT IS NEW (2026-11-16): once the download is done it SAYS so, with one
 * button that restarts into it. "The next time the app starts" is a long time
 * on a phone that never cold-starts, and the only thing announcing a waiting
 * update was a dot on the Profile tab. Mark asked for the prompt; the rules
 * for when it may appear are in services/updatePrompt, and the sheet itself
 * is UpdateReadyPrompt.
 *
 * ONCE PER LAUNCH, whether it was taken or dismissed. The foreground re-check
 * must not bring it back — that is the line between a prompt and nagging —
 * and nothing is lost by saying no, because the update still applies on the
 * next cold start exactly as it did before this existed.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  LAUNCH_DELAY_MS, checkAndDownload, lastLaunchCheckAt, shouldRecheck,
} from '../services/launchUpdate';
import { shouldPrompt } from '../services/updatePrompt';
import UpdateReadyPrompt from './UpdateReadyPrompt';

export default function LaunchUpdateCheck() {
  const [offering, setOffering] = useState(false);
  /**
   * The latch.
   *
   * A REF, not state: it is read inside the AppState listener, which closes
   * over the render that registered it. A stale `false` in there would
   * re-offer on every foreground, which is the exact behaviour this is meant
   * to prevent.
   */
  const offeredRef = useRef(false);

  const offer = useCallback((result) => {
    if (!shouldPrompt(result, { seen: offeredRef.current })) return;
    offeredRef.current = true;
    setOffering(true);
  }, []);

  useEffect(() => {
    const first = setTimeout(() => { checkAndDownload().then(offer, () => {}); }, LAUNCH_DELAY_MS);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && shouldRecheck(lastLaunchCheckAt(), Date.now())) {
        checkAndDownload().then(offer, () => {});
      }
    });
    return () => {
      clearTimeout(first);
      sub?.remove?.();
    };
  }, [offer]);

  return <UpdateReadyPrompt visible={offering} onDismiss={() => setOffering(false)} />;
}
