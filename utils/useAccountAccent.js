/**
 * Keeps this phone's highlight colour and the account's the same one.
 *
 * ThemeProvider is mounted ABOVE ServerProvider (App.js), so it cannot fetch
 * anything itself — it owns the colour and AsyncStorage, nothing more. This
 * hook lives inside the authenticated tree, where there is an api, and adds
 * the two halves the provider cannot.
 *
 * ── The order, which is the whole design ─────────────────────────────────
 *   1. AsyncStorage has already painted the first frame. Nothing here blocks
 *      that; a colour must never wait on a network.
 *   2. Read `/me`. If the account holds a choice, ADOPT it — the account is
 *      the shared truth, and this is how a colour picked on the web arrives.
 *   3. Only then start pushing. From that point, whenever what is on screen
 *      stops matching what the account is known to hold, send it up. That is
 *      what carries a pick made HERE to every other device, and it covers the
 *      first run too: an account with nothing stored gets this phone's
 *      colour pushed to it a tick after the read comes back empty.
 *
 * A read that FAILS leaves pushing switched off for the session. That is
 * deliberate: a device that could not be told what the account holds is the
 * last thing that should be allowed to overwrite it.
 */
import { useEffect, useRef, useState } from 'react';
import { useServer } from '../context/ServerContext';
import { CUSTOM_ACCENT, useTheme } from '../context/ThemeContext';
import { accentPatch, accentSignature, readAccent } from './accountAccent';

export default function useAccountAccent() {
  const { api } = useServer();
  const { accent, customAccent, setAccent, setCustomAccent, isLoading } = useTheme();

  // What we know the account holds. Null until the read lands.
  const syncedRef = useRef(null);
  const [adopted, setAdopted] = useState(false);

  useEffect(() => {
    // Wait for the local load: adopting before it finishes would be undone a
    // moment later by AsyncStorage's own answer.
    if (isLoading || !api || typeof api.get !== 'function') return undefined;
    let live = true;
    api.get('/me')
      .then((me) => {
        if (!live) return;
        const stored = readAccent(me);
        if (stored) {
          syncedRef.current = accentSignature(stored);
          // Both setters persist to AsyncStorage, so an adopted colour
          // survives the next cold start with no network.
          if (stored.key === CUSTOM_ACCENT) setCustomAccent(stored.custom);
          else setAccent(stored.key);
        }
        setAdopted(true);
      })
      .catch(() => { /* pushing stays off — see the header */ });
    return () => { live = false; };
    // Deliberately not keyed on the setters: they are redefined every render
    // in ThemeContext, and depending on them would re-run this read forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, isLoading]);

  useEffect(() => {
    if (!adopted || !api || typeof api.patch !== 'function') return;
    const choice = { key: accent, custom: customAccent };
    const signature = accentSignature(choice);
    if (!signature || signature === syncedRef.current) return;
    syncedRef.current = signature;
    api.patch('/me/settings', accentPatch(choice)).catch(() => {
      // Let the next change try again rather than believing a failed write.
      syncedRef.current = null;
    });
  }, [adopted, accent, customAccent, api]);
}
