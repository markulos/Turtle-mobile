/**
 * LaunchUpdateCheck — runs services/launchUpdate at the two moments it is for.
 *
 * Renders nothing. Shortly after launch, and on coming back to the foreground
 * when the last check is old, it asks the pond for a newer update and
 * downloads it in the background. Nothing is applied here: a downloaded
 * update launches the next time the app starts. See launchUpdate for why.
 */
import { useEffect } from 'react';
import { AppState } from 'react-native';
import {
  LAUNCH_DELAY_MS, checkAndDownload, lastLaunchCheckAt, shouldRecheck,
} from '../services/launchUpdate';

export default function LaunchUpdateCheck() {
  useEffect(() => {
    const first = setTimeout(() => { checkAndDownload(); }, LAUNCH_DELAY_MS);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && shouldRecheck(lastLaunchCheckAt(), Date.now())) checkAndDownload();
    });
    return () => {
      clearTimeout(first);
      sub?.remove?.();
    };
  }, []);
  return null;
}
