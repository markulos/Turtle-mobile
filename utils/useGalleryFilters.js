// React binding for the vault browse model in galleryFilters.js.
//
// Splits cleanly in two: the pure model over there (URL building, chip
// derivation, validation) and the state/persistence plumbing here.
//
// What persists: how you browse — date basis, direction, grid density. What
// doesn't: search text, tag chips, scene, date range. Sort and density are
// standing preferences; a query is about this visit, and finding a board still
// filtered from last week is a bug, not a feature.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  DEFAULT_FILTERS,
  activeFilterChips,
  clearChipPatch,
  isDirty as isDirtyFilters,
  normalizeFilters,
  persistedSlice,
} from './galleryFilters';

const STORAGE_KEY = 'gallery.filters.v1';

export function useGalleryFilters() {
  const [filters, setFiltersState] = useState(DEFAULT_FILTERS);
  // Until the stored preferences land, callers should not fire requests with
  // the defaults — they'd be thrown away a frame later and the grid would
  // visibly reorder on every cold start.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (alive && raw) {
          const stored = JSON.parse(raw);
          setFiltersState((prev) => normalizeFilters({ ...prev, ...persistedSlice(normalizeFilters(stored)) }));
        }
      } catch {
        // A corrupt blob just means defaults — never a startup failure.
      } finally {
        if (alive) setHydrated(true);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Write-behind: the sheet changes these one tap at a time, and none of it is
  // worth blocking a render on.
  const persist = useCallback((next) => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(persistedSlice(next))).catch(() => {});
  }, []);

  // Bumped on every change. In-flight requests capture it and drop themselves
  // if it has moved on by the time they land — otherwise a slow page from the
  // superseded filter overwrites the new one.
  const epochRef = useRef(0);

  const setFilters = useCallback((patch) => {
    epochRef.current += 1;
    setFiltersState((prev) => {
      const next = normalizeFilters({ ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) });
      persist(next);
      return next;
    });
  }, [persist]);

  const setFilter = useCallback((key, value) => setFilters({ [key]: value }), [setFilters]);

  const toggleTag = useCallback((tag) => {
    setFilters((prev) => ({
      tag: prev.tag.includes(tag) ? prev.tag.filter((t) => t !== tag) : [...prev.tag, tag],
    }));
  }, [setFilters]);

  const clearChip = useCallback((key) => {
    setFilters((prev) => clearChipPatch(key, prev));
  }, [setFilters]);

  // Reset clears what you're looking at but KEEPS density: the user set that
  // with their fingers and never asked for it back.
  const reset = useCallback(() => {
    setFilters((prev) => ({ ...DEFAULT_FILTERS, cols: prev.cols }));
  }, [setFilters]);

  const chips = useMemo(() => activeFilterChips(filters), [filters]);
  const dirty = useMemo(() => isDirtyFilters(filters), [filters]);

  return {
    filters,
    hydrated,
    setFilter,
    setFilters,
    toggleTag,
    clearChip,
    reset,
    chips,
    isDirty: dirty,
    epochRef,
  };
}
