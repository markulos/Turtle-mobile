/**
 * FollowAlongTranscript — the transcript of the track that is playing, with
 * the line being spoken outlined as it is said.
 *
 * ─── What it is for ─────────────────────────────────────────────────────────
 *
 * A transcript you have to read while separately scrubbing the audio is two
 * things next to each other. This is one thing: the audio plays, the page
 * keeps its own place, and tapping any line takes the audio there. That last
 * part is the reason the whole feature is worth having — a transcript turns a
 * recording into something you can navigate by what was said.
 *
 * ─── The outline, and why an outline ────────────────────────────────────────
 *
 * The current line is marked with a BORDER, not a fill or a colour change.
 * Speaker names and timestamps already use colour here, and a highlighted fill
 * under running text is the one thing that reliably hurts to read at length.
 * A ring around the line is unambiguous at a glance and leaves the text alone.
 *
 * It softens (rather than vanishing) through the pauses between turns: see
 * utils/followAlong for why the line stays lit when nobody is talking.
 *
 * ─── Scrolling ──────────────────────────────────────────────────────────────
 *
 * The list follows the audio, but ONLY while the reader isn't driving: one
 * touch stands the auto-scroll down, and a "Jump to now" key brings it back.
 * Yanking the page out from under a thumb is the failure mode every
 * karaoke/lyrics view has, and it is worse here because the reason to scroll
 * away is usually to tap a line further down.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { followState, seekTargetFor } from '../utils/followAlong';
import { formatDuration } from '../utils/transcriptionOptions';
import { tapHaptic } from '../utils/haptics';

const at = (seconds) => formatDuration(seconds) || '0:00';

/**
 * One line. Memoized on the few things that actually change it — a transcript
 * is hundreds of rows and the position ticks twice a second, so an unmemoized
 * row re-renders the whole list every tick.
 */
const TurnRow = React.memo(function TurnRow({
  turn, active, spoken, showSpeaker, onSeek, colors, ink,
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={() => { tapHaptic(); onSeek(seekTargetFor(turn)); }}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${turn.speaker || 'Speaker'} at ${at(turn.start)}: ${turn.text}`}
      style={[
        styles.turn,
        {
          borderColor: active ? ink : 'transparent',
          // Through a pause the ring stays, a shade quieter — the line is
          // still where we are, it just isn't being said this instant.
          opacity: active && !spoken ? 0.72 : 1,
          backgroundColor: active ? (colors.surfaceElevated || 'transparent') : 'transparent',
        },
      ]}
    >
      {showSpeaker && (
        <Text style={[styles.head, { color: colors.textSecondary }]} numberOfLines={1}>
          <Text style={styles.speaker}>{turn.speaker || 'Speaker'}</Text>
          <Text style={[styles.time, { color: colors.textMuted }]}>{`  ${at(turn.start)}`}</Text>
        </Text>
      )}
      {/* Transcript text is untrusted and is rendered as text only. */}
      <Text
        style={[
          styles.text,
          { color: active ? colors.textPrimary : colors.textSecondary },
          active && styles.textActive,
        ]}
      >
        {turn.text}
      </Text>
    </TouchableOpacity>
  );
});

export default function FollowAlongTranscript({
  turns,
  position = 0,
  onSeek,
  loading = false,
  error = null,
  theme,
  contentInsetBottom = 0,
  testID,
}) {
  const c = theme?.colors || {};
  // The outline is BLACK on a light page and white on a dark one — "black" is
  // shorthand for the page's own ink, and a black ring on a black background
  // is no ring.
  const ink = theme?.mode === 'dark' ? '#FFFFFF' : '#000000';

  const listRef = useRef(null);
  // The reader has taken over. Sticky until they ask for the audio's place
  // back, deliberately: it should survive a scroll that ends mid-flick.
  const [detached, setDetached] = useState(false);

  const { index: activeIndex, spoken } = useMemo(
    () => followState(turns, position),
    [turns, position],
  );

  // Follow the audio. `viewPosition: 0.35` parks the live line a third of the
  // way down rather than at the very top, so the next few lines are already
  // readable — you follow a transcript slightly ahead of the voice.
  useEffect(() => {
    if (detached || activeIndex < 0 || !turns?.length) return;
    try {
      listRef.current?.scrollToIndex?.({
        index: activeIndex, animated: true, viewPosition: 0.35,
      });
    } catch {
      /* mid-layout, or an index the window hasn't measured — the next tick lands */
    }
  }, [activeIndex, detached, turns]);

  const jumpToNow = useCallback(() => {
    tapHaptic();
    setDetached(false);
    if (activeIndex >= 0) {
      try {
        listRef.current?.scrollToIndex?.({ index: activeIndex, animated: true, viewPosition: 0.35 });
      } catch { /* the effect above re-runs on the next tick anyway */ }
    }
  }, [activeIndex]);

  const renderItem = useCallback(({ item, index }) => (
    <TurnRow
      turn={item}
      active={index === activeIndex}
      spoken={spoken}
      // A run of lines by the same person is one person talking; repeating the
      // name on every line turns a conversation into a script.
      showSpeaker={index === 0 || turns[index - 1]?.speaker !== item.speaker}
      onSeek={onSeek}
      colors={c}
      ink={ink}
    />
  ), [activeIndex, spoken, turns, onSeek, c, ink]);

  if (loading) {
    return (
      <View style={styles.centre} testID={testID}>
        <ActivityIndicator color={c.textSecondary} />
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.centre} testID={testID}>
        <Icon name="text-box-remove-outline" size={34} color={c.textTertiary} />
        <Text style={[styles.empty, { color: c.textSecondary }]}>{error}</Text>
      </View>
    );
  }
  if (!turns?.length) {
    return (
      <View style={styles.centre} testID={testID}>
        <Icon name="text-box-outline" size={34} color={c.textTertiary} />
        <Text style={[styles.empty, { color: c.textSecondary }]}>
          This transcript came back empty.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }} testID={testID}>
      <FlatList
        ref={listRef}
        data={turns}
        keyExtractor={(turn, index) => `${turn.start}-${index}`}
        renderItem={renderItem}
        // The reader's touch wins over the audio's scrolling, from the first
        // drag until they hand it back.
        onScrollBeginDrag={() => setDetached(true)}
        // A line the window has never measured can't be scrolled to; land near
        // it and let the effect's next tick settle the rest.
        onScrollToIndexFailed={(info) => {
          listRef.current?.scrollToOffset?.({
            offset: Math.max(0, info.averageItemLength * info.index),
            animated: false,
          });
        }}
        contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: contentInsetBottom + 24, paddingTop: 6 }}
        // The active line's ring is drawn per row, so the rows must re-render
        // when it moves.
        extraData={`${activeIndex}:${spoken}:${ink}`}
      />

      {detached && (
        <TouchableOpacity
          onPress={jumpToNow}
          accessibilityRole="button"
          accessibilityLabel="Jump back to what is playing"
          style={[styles.jump, { backgroundColor: ink, bottom: contentInsetBottom + 16 }]}
        >
          <Icon name="target" size={15} color={theme?.mode === 'dark' ? '#000' : '#FFF'} />
          <Text style={[styles.jumpText, { color: theme?.mode === 'dark' ? '#000' : '#FFF' }]}>
            Jump to now
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  empty: { fontSize: 13.5, textAlign: 'center', lineHeight: 19 },
  turn: {
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 4,
    gap: 2,
  },
  head: { fontSize: 11.5 },
  speaker: { fontWeight: '700' },
  time: { fontVariant: ['tabular-nums'] },
  text: { fontSize: 15, lineHeight: 22 },
  textActive: { fontWeight: '600' },
  jump: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  jumpText: { fontSize: 12.5, fontWeight: '700' },
});
