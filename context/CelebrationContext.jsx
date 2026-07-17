/**
 * CelebrationContext — app-level "celebrate a completion" bus.
 *
 * Any screen calls celebrate({ points }) on a task tick or a pomodoro finish;
 * the provider fires a success haptic and renders a single shared
 * CelebrationOverlay (confetti + a floating "+N pts" badge) above the whole
 * app. Kept tiny and dependency-light — the visuals live in CelebrationOverlay.
 *
 * The default context value is a no-op, so calling useCelebration() outside the
 * provider (or before mount) is safe and simply does nothing.
 */
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import CelebrationOverlay from '../components/CelebrationOverlay';
import { notifyHaptic } from '../utils/haptics';

const CelebrationContext = createContext({ celebrate: () => {} });

export const useCelebration = () => useContext(CelebrationContext);

export function CelebrationProvider({ children }) {
  const [burst, setBurst] = useState(null); // { id, points, kind }
  const idRef = useRef(0);

  const celebrate = useCallback((opts = {}) => {
    const { points = 0, kind } = opts;
    idRef.current += 1;
    setBurst({ id: idRef.current, points, kind });
    try { notifyHaptic('success'); } catch { /* haptics best-effort */ }
  }, []);

  // Stable value → burst updates re-render ONLY the overlay (via its prop),
  // never the useCelebration() consumers (TasksScreen, pomodoro hook).
  const value = useMemo(() => ({ celebrate }), [celebrate]);

  return (
    <CelebrationContext.Provider value={value}>
      {children}
      <CelebrationOverlay burst={burst} />
    </CelebrationContext.Provider>
  );
}
