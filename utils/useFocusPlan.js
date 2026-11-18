/**
 * The account's focus plan on this phone: read it, save it, and keep the
 * count of sessions finished today.
 *
 * Same shape and the same two `users.settings` keys the desktop writes (see
 * utils/focusPlan), so a length set on either device is the length on both.
 *
 * Reads on mount and whenever the api identity changes — a plan changed on
 * the desktop has to reach a phone that was already open. A failed read
 * leaves the defaults standing rather than blanking anything; a failed write
 * leaves the value on screen, because the number you just typed is still
 * what you meant.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useServer } from '../context/ServerContext';
import {
  DEFAULT_PLAN, cyclePatch, localDay, normalisePlan, planPatch, plannedMinutes,
  readCycle, readPlan,
} from './focusPlan';

export default function useFocusPlan() {
  const { api } = useServer();
  const [plan, setPlan] = useState(DEFAULT_PLAN);
  const [done, setDone] = useState(0);
  // Read by minutesFor, which callers hold across renders — a changing
  // identity there would re-run their effects on every count change.
  const planRef = useRef(plan);
  planRef.current = plan;
  const doneRef = useRef(done);
  doneRef.current = done;

  useEffect(() => {
    if (!api || typeof api.get !== 'function') return undefined;
    let live = true;
    api.get('/me')
      .then((me) => {
        if (!live || !me) return;
        setPlan(readPlan(me));
        setDone(readCycle(me, localDay(new Date())));
      })
      .catch(() => { /* defaults stand */ });
    return () => { live = false; };
  }, [api]);

  const save = useCallback((next) => {
    const safe = normalisePlan(next);
    setPlan(safe); // shown first, saved behind it
    if (api && typeof api.patch === 'function') {
      api.patch('/me/settings', planPatch(safe)).catch(() => {});
    }
    return safe;
  }, [api]);

  /** One more focus session finished today, written through so devices agree. */
  const bump = useCallback(() => {
    const next = doneRef.current + 1;
    doneRef.current = next;
    setDone(next);
    if (api && typeof api.patch === 'function') {
      api.patch('/me/settings', cyclePatch(next, localDay(new Date()))).catch(() => {});
    }
  }, [api]);

  /** How long the next run of `mode` should be, long break included. */
  const minutesFor = useCallback(
    (mode) => plannedMinutes(mode === 'break' ? 'break' : 'focus', planRef.current, doneRef.current),
    [],
  );

  return { plan, done, save, bump, minutesFor };
}
