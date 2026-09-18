/**
 * useUpdateHeadline — "is there a new version, and what does it change?" for a
 * launcher that is NOT the updates panel itself.
 *
 * The profile's "Check for updates" card has to answer that before it is
 * tapped, which means two cheap reads:
 *
 *   • Updates.checkForUpdateAsync() — METADATA ONLY. One small manifest
 *     request; nothing is downloaded, nothing is applied. Same call the panel
 *     makes when it opens, and the same reason: a card that says "up to date"
 *     without having asked is a card that lies.
 *   • GET /mobile-updates/status — the pond's own record of every update it
 *     has built, including the publish MESSAGE. The Expo manifest never
 *     carries that note, so this is the only way to say what an update
 *     entails rather than quoting its id at someone.
 *
 * Owner-only, by design: /status is the release-steering route. A non-owner
 * (or a pond that predates it) simply gets no note, and the wording falls back
 * to the id and the date — hence `updates: []` rather than an error state.
 *
 * In a development client every Updates API throws, so nothing is called at
 * all; the summary says why.
 */
import { useCallback, useEffect, useState } from 'react';
import * as Updates from 'expo-updates';
import { useServer } from '../context/ServerContext';
import { describeBuild, summarizeLatest } from './updatesSummary';

export default function useUpdateHeadline({ active = true } = {}) {
  const { api, isConnected } = useServer();
  const build = describeBuild({
    isEnabled: Updates.isEnabled,
    isEmbeddedLaunch: Updates.isEmbeddedLaunch,
    updateId: Updates.updateId,
    createdAt: Updates.createdAt,
    isDev: typeof __DEV__ !== 'undefined' && __DEV__,
  });
  const canUpdate = build.mode !== 'dev-client';

  const [phase, setPhase] = useState('idle'); // idle | checking | current | available | error
  const [available, setAvailable] = useState(null);
  const [updates, setUpdates] = useState([]);

  const check = useCallback(async () => {
    if (!canUpdate) return;
    setPhase('checking');
    try {
      const r = await Updates.checkForUpdateAsync();
      if (r?.isAvailable) {
        setAvailable({ id: r.manifest?.id || null, createdAt: r.manifest?.createdAt || null });
        setPhase('available');
      } else {
        setAvailable(null);
        setPhase('current');
      }
    } catch {
      // The card is a launcher, not the panel — it names the failure in one
      // line and sends you to the panel, which keeps the real message.
      setPhase('error');
    }
  }, [canUpdate]);

  const loadNotes = useCallback(async () => {
    if (!canUpdate || !isConnected) return;
    try {
      const r = await api.get('/mobile-updates/status');
      setUpdates(Array.isArray(r?.updates) ? r.updates : []);
    } catch {
      setUpdates([]); // 403 not the owner / 404 older pond — no note, no noise
    }
  }, [api, isConnected, canUpdate]);

  useEffect(() => {
    if (!active) return;
    check();
    loadNotes();
  }, [active, check, loadNotes]);

  return {
    build,
    phase,
    refresh: useCallback(() => { check(); loadNotes(); }, [check, loadNotes]),
    summary: summarizeLatest({
      mode: build.mode,
      phase,
      availableId: available?.id,
      availableCreatedAt: available?.createdAt,
      runningId: Updates.updateId,
      runningCreatedAt: Updates.createdAt,
      updates,
    }),
  };
}
