import React, { memo, useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Reanimated, {
  Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming,
} from 'react-native-reanimated';

import { useTheme } from '../context/ThemeContext';
import { SCREEN_TITLE_ROW_H } from '../utils/headerType';
import { dockOccupied } from './tabBarLayout';

/**
 * TabSkeleton — what a tab looks like in the moment before it exists.
 *
 * ── The problem it solves ──────────────────────────────────────────────────
 *
 * Tabs are lazy (App.js records why: a screen mounted hidden measures its
 * layouts against nothing), so the FIRST visit to a tab is the one that pays
 * for the whole screen — and these screens are thousands of lines each. Until
 * that mount commits, the old tab stayed on screen: you tapped, nothing moved,
 * and then the new page snapped in. Nothing was broken, and it felt broken.
 *
 * A template changes which of those two the user waits through. The frame of
 * the page — the header band, the shape of its rows — is knowable without any
 * data, so it can be on screen in one frame, and the mount then fills it in.
 * That is also what makes the dock's DRAG possible: a tab crossed by a thumb
 * paints its template and nothing else (see withTabSkeleton).
 *
 * ── Why shape-level, and not pixel-copied ──────────────────────────────────
 *
 * MusicWebResultSkeleton's rule — copy the geometry, never approximate it — is
 * about placeholders INSIDE a live list, where the real rows land next to the
 * fake ones and a few points of difference is a visible shift under the
 * reader's eye. This is the other case: nothing of the page is on screen yet,
 * and the whole page replaces the whole template in one commit. So the numbers
 * that matter here are the ones that would make the page JUMP as a block —
 * the safe-area inset, the header row's height (SCREEN_TITLE_ROW_H, shared with
 * the real headers), the list's 16pt gutter, the photo grid's column count.
 * Below that, these are shapes.
 *
 * ── Opacity only ───────────────────────────────────────────────────────────
 *
 * One slow breath on the whole template, on the UI thread, exactly as the music
 * skeleton does it: nothing here may move or resize, because the frames it
 * breathes in are the frames a real screen is mounting in, and a busy JS thread
 * must not be able to stutter it.
 */

/** Slow on purpose: a fast pulse reads as an error state. */
const BREATH_MS = 750;

// The note/task/password list gutter — all three sit their rows at 16.
const GUTTER = 16;

// MediaGallery's grid is edge-to-edge squares with a hairline seam
// (`cellSize={width / gridCols - 0.5}`), three across by default.
const GRID_COLS = 3;
const GRID_SEAM = 0.5;

function Bar({ w, h = 11, fill, style }) {
  return <View style={[{ width: w, height: h, borderRadius: h / 2, backgroundColor: fill }, style]} />;
}

function Key({ fill }) {
  // A header key's 36pt square — the size STYLE-RULES gives the icon keys that
  // set the header row's height.
  return <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: fill }} />;
}

/** The band every tab starts with: title on the left, keys on the right. */
function Header({ fill, top, keys = 2 }) {
  return (
    <View style={{ paddingTop: top }}>
      <View style={styles.headerRow}>
        <Bar w={120} h={16} fill={fill} />
        <View style={styles.spacer} />
        {Array.from({ length: keys }, (_, i) => <Key key={i} fill={fill} />)}
      </View>
      <View style={[styles.rule, { backgroundColor: fill }]} />
    </View>
  );
}

/** A list row: a leading square, a title line, a shorter second line. */
function ListRow({ fill, i, lines = 2 }) {
  return (
    <View style={styles.row}>
      <View style={[styles.rowIcon, { backgroundColor: fill }]} />
      <View style={styles.rowBody}>
        {/* Three widths, cycling: a column of identical bars reads as a broken
            table rather than as titles of different lengths. */}
        <Bar w={['78%', '62%', '70%'][i % 3]} h={12} fill={fill} />
        {lines > 1 ? <Bar w={['44%', '56%', '38%'][i % 3]} h={9} fill={fill} style={styles.rowSecond} /> : null}
      </View>
    </View>
  );
}

function Rows({ fill, count, lines }) {
  return (
    <View style={styles.list}>
      {Array.from({ length: count }, (_, i) => <ListRow key={i} fill={fill} i={i} lines={lines} />)}
    </View>
  );
}

function SectionedRows({ fill }) {
  // The Planner is sections of tasks, not a flat list — a header, a few rows,
  // the next header.
  return (
    <View style={styles.list}>
      {[0, 1].map((s) => (
        <View key={s}>
          <Bar w={92} h={10} fill={fill} style={styles.sectionLabel} />
          {[0, 1, 2].map((i) => <ListRow key={i} fill={fill} i={i + s} lines={1} />)}
        </View>
      ))}
    </View>
  );
}

function Grid({ fill, width, rows = 4 }) {
  const cell = width / GRID_COLS - GRID_SEAM;
  return (
    <View style={styles.grid}>
      {Array.from({ length: rows * GRID_COLS }, (_, i) => (
        <View key={i} style={{ width: cell, height: cell, marginRight: GRID_SEAM, marginBottom: GRID_SEAM, backgroundColor: fill }} />
      ))}
    </View>
  );
}

function Chat({ fill }) {
  // Alternating bubbles, widest at the top: a conversation read from the
  // bottom up, which is where the chat opens.
  const bubbles = [
    { w: '72%', h: 56, mine: false },
    { w: '54%', h: 38, mine: true },
    { w: '84%', h: 72, mine: false },
    { w: '46%', h: 38, mine: true },
  ];
  return (
    <View style={styles.list}>
      {bubbles.map((b, i) => (
        <View
          key={i}
          style={[styles.bubble, { width: b.w, height: b.h, backgroundColor: fill }, b.mine && styles.bubbleMine]}
        />
      ))}
    </View>
  );
}

function ProfileCard({ fill }) {
  return (
    <View style={styles.list}>
      <View style={styles.profileTop}>
        <View style={[styles.avatar, { backgroundColor: fill }]} />
        <View style={styles.rowBody}>
          <Bar w="56%" h={14} fill={fill} />
          <Bar w="34%" h={10} fill={fill} style={styles.rowSecond} />
        </View>
      </View>
      {[0, 1, 2, 3].map((i) => <ListRow key={i} fill={fill} i={i} lines={1} />)}
    </View>
  );
}

function LockCard({ fill }) {
  // The vault opens LOCKED far more often than it opens into a list, so its
  // template is the unlock card, not rows of entries.
  return (
    <View style={styles.centred}>
      <View style={[styles.lock, { backgroundColor: fill }]} />
      <Bar w={160} h={14} fill={fill} style={styles.lockLine} />
      <Bar w={220} h={44} fill={fill} style={styles.lockField} />
    </View>
  );
}

function Body({ kind, fill, width }) {
  switch (kind) {
    case 'tasks': return <SectionedRows fill={fill} />;
    case 'notes': return <Rows fill={fill} count={7} lines={2} />;
    case 'photos': return <Grid fill={fill} width={width} />;
    case 'turtle': return <Chat fill={fill} />;
    case 'profile': return <ProfileCard fill={fill} />;
    case 'vault': return <LockCard fill={fill} />;
    default: return <Rows fill={fill} count={6} lines={2} />;
  }
}

function TabSkeleton({ kind, live = true, testID = `tab-skeleton:${kind}` }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const breath = useSharedValue(0.45);

  // `live` is the tab's focus. A tab the thumb dragged PAST keeps its template
  // mounted until it is opened for real (withTabSkeleton), and a forever-repeat
  // on a screen nobody is looking at is a loop running for the rest of the
  // session — the same argument freezeOnBlur makes in App.js.
  useEffect(() => {
    if (!live) { cancelAnimation(breath); return undefined; }
    breath.value = withRepeat(
      withTiming(1, { duration: BREATH_MS, easing: Easing.inOut(Easing.quad) }),
      -1,   // forever
      true, // and back down, so there is no jump from full to dim
    );
    return () => cancelAnimation(breath);
  }, [breath, live]);

  const pulse = useAnimatedStyle(() => ({ opacity: breath.value }));
  const fill = theme.colors.surfaceElevated || theme.colors.border;

  return (
    <View
      style={[styles.page, { backgroundColor: theme.colors.background }]}
      testID={testID}
      // Announced as busy rather than as a pile of unlabelled boxes.
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
    >
      <Reanimated.View
        style={[styles.breathe, pulse, { paddingBottom: dockOccupied(insets.bottom) }]}
        // The real screen is one frame behind this; nothing here is pressable,
        // and a tap must not be swallowed by a page that is about to go.
        pointerEvents="none"
      >
        <Header fill={fill} top={insets.top} keys={kind === 'turtle' ? 3 : 2} />
        <Body kind={kind} fill={fill} width={width} />
      </Reanimated.View>
    </View>
  );
}

export default memo(TabSkeleton);

const styles = StyleSheet.create({
  page: { flex: 1 },
  breathe: { flex: 1 },
  headerRow: {
    height: SCREEN_TITLE_ROW_H,
    paddingHorizontal: GUTTER,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  spacer: { flex: 1 },
  rule: { height: StyleSheet.hairlineWidth, opacity: 0.6 },
  list: { paddingHorizontal: GUTTER, paddingTop: 8 },
  // Notes' own row: 14 above and below, a 22pt icon column, a 12pt gap.
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 14 },
  rowIcon: { width: 22, height: 22, borderRadius: 6 },
  rowBody: { flex: 1, minWidth: 0 },
  rowSecond: { marginTop: 6 },
  sectionLabel: { marginTop: 14, marginBottom: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingTop: 8 },
  bubble: { borderRadius: 18, marginTop: 14 },
  bubbleMine: { alignSelf: 'flex-end' },
  profileTop: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 18 },
  avatar: { width: 64, height: 64, borderRadius: 32 },
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  lock: { width: 56, height: 56, borderRadius: 16 },
  lockLine: { marginTop: 20 },
  lockField: { marginTop: 18, borderRadius: 12 },
});
