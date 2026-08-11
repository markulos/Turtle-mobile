import React, { useEffect, useState } from 'react';
import { InteractionManager, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { TaskCardSkeletonCluster } from './TaskCardSkeleton';

export const DAY_SECTION_BATCH = 20;
// How many cards a LAZY section paints on its very first frame. A section that
// mounts on a tap (the Pending strip's expand) is only as fast as its first
// render, and these cards are not cheap — so open with a screenful and let the
// rest stream in. Sized to overfill a phone viewport so the growth is never
// visible as a gap.
export const DAY_SECTION_FIRST_PAINT = 6;

export function TaskSectionFrontier({
  items,
  sectionLabel,
  renderItem,
  theme,
  // Cards painted before the first frontier. Default keeps the historical
  // one-shot 20 for sections that are already mounted and cheap.
  initialBatch = DAY_SECTION_BATCH,
  // Stream the remaining batches in by themselves, after each paint settles,
  // instead of waiting for a "Show more" tap. The button is dropped in this
  // mode — the skeletons ARE the affordance, the same way the tasks list's
  // recycler fills itself as you go.
  autoGrow = false,
  batchSize = DAY_SECTION_BATCH,
}) {
  const [limit, setLimit] = useState(initialBatch);
  const visibleItems = items.slice(0, limit);
  const remaining = items.length - visibleItems.length;

  // Grow AFTER interactions so the batch that makes the section appear (and the
  // tap animation that asked for it) always wins the frame. Each grow schedules
  // the next one, so a long backlog fills in over idle frames rather than
  // blocking the open.
  useEffect(() => {
    if (!autoGrow || remaining <= 0) return undefined;
    const handle = InteractionManager.runAfterInteractions(() => {
      setLimit((current) => Math.min(items.length, current + batchSize));
    });
    return () => handle.cancel();
  }, [autoGrow, remaining, items.length, batchSize]);

  return (
    <>
      {visibleItems.map(renderItem)}
      {remaining > 0 && autoGrow && (
        <View style={styles.frontier}>
          <TaskCardSkeletonCluster theme={theme} remaining={remaining} />
        </View>
      )}
      {remaining > 0 && !autoGrow && (
        <View style={styles.frontier}>
          <TaskCardSkeletonCluster theme={theme} remaining={remaining} />
          <TouchableOpacity
            style={[
              styles.moreButton,
              { borderColor: theme.colors.primary || theme.colors.textSecondary },
            ]}
            onPress={() => setLimit((current) => Math.min(items.length, current + DAY_SECTION_BATCH))}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Show more ${sectionLabel} tasks`}
            accessibilityHint={`${remaining} tasks remain hidden`}
          >
            <Text style={[styles.moreText, { color: theme.colors.primary || theme.colors.textSecondary }]}>
              Show {Math.min(DAY_SECTION_BATCH, remaining)} more
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  frontier: {
    paddingBottom: 4,
  },
  moreButton: {
    alignSelf: 'center',
    minHeight: 40,
    minWidth: 140,
    marginTop: 2,
    paddingHorizontal: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
