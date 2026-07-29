import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { TaskCardSkeletonCluster } from './TaskCardSkeleton';

export const DAY_SECTION_BATCH = 20;

export function TaskSectionFrontier({
  items,
  sectionLabel,
  renderItem,
  theme,
}) {
  const [limit, setLimit] = useState(DAY_SECTION_BATCH);
  const visibleItems = items.slice(0, limit);
  const remaining = items.length - visibleItems.length;

  return (
    <>
      {visibleItems.map(renderItem)}
      {remaining > 0 && (
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
