/**
 * MusicWebResultSkeleton — placeholder rows while the first web search runs.
 *
 * ── Why rows and not a spinner ──────────────────────────────────────────
 * A refined search keeps the previous results on screen (MusicVault's effect
 * only flips `loading`, it does not clear `results`), so the list is only ever
 * EMPTY on the first search of a session. That was the one moment the page
 * went blank under the status line and then snapped a full screen of rows into
 * existence. Placeholder rows mean the list is the same shape before and
 * after, so the arrival is a fill rather than a jolt.
 *
 * ── The geometry is copied, not approximated ────────────────────────────
 * Every number here is read off VaultSearchDock's `row` styles: a 46pt cover
 * (ROW_COVER), 8pt of padding above and below, a 12pt gap, and two text lines
 * whose heights come from rowName (19) and rowMeta (17 + 1 margin). If those
 * change, these have to change with them — a skeleton that is a few points off
 * is worse than none, because the list then shifts by exactly that much at the
 * moment the user is reading it.
 *
 * ── Why the pulse is opacity only ───────────────────────────────────────
 * Nothing here may move or resize. A shimmer that sweeps, or bars that grow,
 * is motion in the same frames the results are landing in, which is precisely
 * the "jumping around" this exists to remove. One slow opacity breath on the
 * whole row says "working" and changes no layout at all — and on Reanimated it
 * runs on the UI thread, so a busy JS thread cannot make it stutter.
 */
import React, { memo, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Reanimated, {
  Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming, cancelAnimation,
} from 'react-native-reanimated';
import { ROW_COVER } from './VaultSearchDock';

/** Slow on purpose: a fast pulse reads as an error state. */
const BREATH_MS = 750;

/** Enough to fill a phone screen. The list grows past this when the real
 *  results land, which happens BELOW the fold and so is not a jump. */
export const SKELETON_ROWS = 8;

function MusicWebResultSkeleton({ theme, rows = SKELETON_ROWS, testID = 'music-web-skeleton' }) {
  const c = theme.colors;
  const breath = useSharedValue(0.45);

  useEffect(() => {
    breath.value = withRepeat(
      withTiming(1, { duration: BREATH_MS, easing: Easing.inOut(Easing.quad) }),
      -1,   // forever
      true, // and back down, so there is no jump from full to dim
    );
    return () => cancelAnimation(breath);
  }, [breath]);

  const pulse = useAnimatedStyle(() => ({ opacity: breath.value }));
  const fill = c.surfaceElevated || c.border;

  return (
    <View style={styles.wrap} testID={testID} accessibilityLabel="Searching YouTube">
      {Array.from({ length: rows }, (_, i) => (
        <Reanimated.View key={i} style={[styles.row, pulse]}>
          <View style={[styles.cover, { backgroundColor: fill }]} />
          <View style={styles.text}>
            {/* Three widths, cycling: a column of identical bars reads as a
                broken table rather than as titles of different lengths. */}
            <View style={[styles.name, { backgroundColor: fill, width: ['78%', '62%', '70%'][i % 3] }]} />
            <View style={[styles.meta, { backgroundColor: fill }]} />
          </View>
        </Reanimated.View>
      ))}
    </View>
  );
}

export default memo(MusicWebResultSkeleton);

const styles = StyleSheet.create({
  // 14 to match MusicWebResultRow's own inset, so a placeholder and the row
  // that replaces it start at the same x.
  wrap: { paddingHorizontal: 14 },
  // Mirrors VaultSearchDock's `row` exactly — see the header.
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 2 },
  cover: { width: ROW_COVER, height: ROW_COVER, borderRadius: 10 },
  text: { flex: 1, minWidth: 0 },
  // 11 inside rowName's 19pt line, 9 inside rowMeta's 17 — a bar the full
  // height of its line box reads as a filled field, not as waiting text.
  name: { height: 11, borderRadius: 5.5, marginVertical: 4 },
  meta: { height: 9, borderRadius: 4.5, marginTop: 5, width: '34%' },
});
