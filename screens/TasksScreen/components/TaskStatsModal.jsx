import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../context/ThemeContext';

// Local YYYY-MM-DD (local time, not UTC) so it lines up with how dueDate
// is stored / compared elsewhere in the calendar.
const toDateStr = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const pct = (done, total) => (total > 0 ? Math.round((done / total) * 100) : 0);

/**
 * TaskStatsModal — opened by tapping the header's completed/total countdown.
 *
 * Three readouts:
 *   • All time  — completed / total across EVERY task (filters ignored; this
 *     is the lifetime picture the user asked for).
 *   • Selected day — for the calendar's currently-selected date, how many
 *     tasks are scheduled (due that day) under the active project/tag filter,
 *     and how many of those are done.
 *   • By tag — per-tag-category completed / total, lifetime, so the user can
 *     see which areas they're clearing vs. piling up.
 */
export const TaskStatsModal = ({
  visible,
  onClose,
  tasks = [],
  selectedProject = 'All',
  selectedTags = [],
  tagFilterMode = 'any',
  selectedDate,
}) => {
  const { theme } = useTheme();
  const styles = createStyles(theme);

  // Project + tag filter test (deliberately NOT applying showIncompleteOnly,
  // since the whole point here is to count completed tasks too).
  const passesProjectTag = React.useCallback(
    (task) => {
      if (selectedProject !== 'All') {
        const matches =
          selectedProject === 'No Project'
            ? !task.project
            : (task.project || 'No Project') === selectedProject;
        if (!matches) return false;
      }
      if (selectedTags.length > 0) {
        const tt = task.tags || [];
        if (tagFilterMode === 'all') {
          if (!selectedTags.every((t) => tt.includes(t))) return false;
        } else if (!selectedTags.some((t) => tt.includes(t))) {
          return false;
        }
      }
      return true;
    },
    [selectedProject, selectedTags, tagFilterMode]
  );

  // ── All-time (every task, no filters) ──────────────────────────────────
  const allTime = React.useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter((t) => t.completed).length;
    return { total, completed };
  }, [tasks]);

  // ── Selected day (active filter applied) ───────────────────────────────
  const day = React.useMemo(() => {
    const date = selectedDate instanceof Date ? selectedDate : new Date();
    const dateStr = toDateStr(date);
    const scheduled = tasks.filter(
      (t) => t.dueDate === dateStr && passesProjectTag(t)
    );
    return {
      label: date.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      }),
      total: scheduled.length,
      completed: scheduled.filter((t) => t.completed).length,
    };
  }, [tasks, selectedDate, passesProjectTag]);

  // ── Per-tag breakdown (lifetime, all tasks) ────────────────────────────
  const byTag = React.useMemo(() => {
    const map = new Map(); // tag -> { total, completed }
    for (const task of tasks) {
      const tags = task.tags && task.tags.length ? task.tags : ['Untagged'];
      for (const tag of tags) {
        const entry = map.get(tag) || { total: 0, completed: 0 };
        entry.total += 1;
        if (task.completed) entry.completed += 1;
        map.set(tag, entry);
      }
    }
    return Array.from(map.entries())
      .map(([tag, v]) => ({ tag, ...v }))
      // Most-active categories first; 'Untagged' sinks to the bottom on ties.
      .sort((a, b) => b.total - a.total || (a.tag === 'Untagged' ? 1 : -1));
  }, [tasks]);

  // ── Per-project breakdown, with each project's tags separated UNDER it ───
  // One component per project (lifetime): the project's overall completed/total
  // plus a nested row per tag, so tags are grouped by the project they belong
  // to rather than pooled globally like "By tag" above.
  const byProject = React.useMemo(() => {
    const map = new Map(); // project -> { total, completed, tags: Map }
    for (const task of tasks) {
      const project = task.project || 'No Project';
      let p = map.get(project);
      if (!p) { p = { total: 0, completed: 0, tags: new Map() }; map.set(project, p); }
      p.total += 1;
      if (task.completed) p.completed += 1;
      const tags = task.tags && task.tags.length ? task.tags : ['Untagged'];
      for (const tag of tags) {
        const e = p.tags.get(tag) || { total: 0, completed: 0 };
        e.total += 1;
        if (task.completed) e.completed += 1;
        p.tags.set(tag, e);
      }
    }
    return Array.from(map.entries())
      .map(([project, v]) => ({
        project,
        total: v.total,
        completed: v.completed,
        tags: Array.from(v.tags.entries())
          .map(([tag, tv]) => ({ tag, ...tv }))
          .sort((a, b) => b.total - a.total || (a.tag === 'Untagged' ? 1 : -1)),
      }))
      .sort((a, b) => b.total - a.total || (a.project === 'No Project' ? 1 : -1));
  }, [tasks]);

  return (
    <Modal
      transparent
      visible={visible}
      onRequestClose={onClose}
      animationType="slide"
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={styles.sheet}>
          <View style={styles.handle} />

          <View style={styles.titleRow}>
            <Text style={styles.title}>Task Stats</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Icon name="close" size={22} color={theme.colors.textTertiary} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {/* All time */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>All time</Text>
              <View style={styles.bigStatRow}>
                <Text style={styles.bigNumber}>{allTime.completed}</Text>
                <Text style={styles.bigDivider}>/ {allTime.total}</Text>
                <Text style={styles.bigPct}>{pct(allTime.completed, allTime.total)}%</Text>
              </View>
              <View style={styles.bar}>
                <View
                  style={[
                    styles.barFill,
                    { width: `${pct(allTime.completed, allTime.total)}%` },
                  ]}
                />
              </View>
              <Text style={styles.caption}>tasks completed across everything</Text>
            </View>

            {/* Selected day */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{day.label}</Text>
              <View style={styles.dayRow}>
                <View style={styles.dayStat}>
                  <Text style={styles.dayNumber}>{day.total}</Text>
                  <Text style={styles.dayCaption}>scheduled</Text>
                </View>
                <View style={styles.dayStat}>
                  <Text style={[styles.dayNumber, { color: theme.colors.accentSuccess }]}>
                    {day.completed}
                  </Text>
                  <Text style={styles.dayCaption}>completed</Text>
                </View>
                <View style={styles.dayStat}>
                  <Text style={[styles.dayNumber, { color: theme.colors.accentWarning }]}>
                    {Math.max(0, day.total - day.completed)}
                  </Text>
                  <Text style={styles.dayCaption}>remaining</Text>
                </View>
              </View>
              {(selectedProject !== 'All' || selectedTags.length > 0) && (
                <Text style={styles.caption}>based on the active filter</Text>
              )}
            </View>

            {/* By project — each project is its own component, with that
                project's tags separated/nested underneath it. */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>By project</Text>
              {byProject.length === 0 ? (
                <Text style={styles.caption}>No tasks yet</Text>
              ) : (
                byProject.map((p) => (
                  <View key={p.project} style={styles.projectCard}>
                    <View style={styles.projectHead}>
                      <Text style={styles.projectName} numberOfLines={1}>{p.project}</Text>
                      <Text style={styles.projectCount}>{p.completed}/{p.total}</Text>
                    </View>
                    <View style={styles.projectBar}>
                      <View style={[styles.projectBarFill, { width: `${pct(p.completed, p.total)}%` }]} />
                    </View>
                    {/* Tags within this project */}
                    {p.tags.map(({ tag, total, completed }) => (
                      <View key={tag} style={styles.projectTagRow}>
                        <View style={styles.projectTagHead}>
                          <Text style={styles.projectTagName} numberOfLines={1}>{tag}</Text>
                          <Text style={styles.projectTagCount}>{completed}/{total}</Text>
                        </View>
                        <View style={styles.projectTagBar}>
                          <View style={[styles.projectTagBarFill, { width: `${pct(completed, total)}%` }]} />
                        </View>
                      </View>
                    ))}
                  </View>
                ))
              )}
            </View>

            {/* By tag */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>By tag</Text>
              {byTag.length === 0 ? (
                <Text style={styles.caption}>No tasks yet</Text>
              ) : (
                byTag.map(({ tag, total, completed }) => (
                  <View key={tag} style={styles.tagRow}>
                    <View style={styles.tagHead}>
                      <Text style={styles.tagName} numberOfLines={1}>
                        {tag}
                      </Text>
                      <Text style={styles.tagCount}>
                        {completed}/{total}
                      </Text>
                    </View>
                    <View style={styles.tagBar}>
                      <View
                        style={[styles.tagBarFill, { width: `${pct(completed, total)}%` }]}
                      />
                    </View>
                  </View>
                ))
              )}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const createStyles = (theme) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: theme.colors.background,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingHorizontal: 20,
      paddingBottom: 32,
      paddingTop: 10,
      maxHeight: '80%',
    },
    handle: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: theme.colors.border,
      marginBottom: 12,
    },
    titleRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 8,
    },
    title: {
      fontSize: 18,
      fontWeight: '700',
      color: theme.colors.textPrimary,
    },
    section: {
      marginTop: 18,
    },
    sectionTitle: {
      fontSize: theme.typography.body,
      fontWeight: '600',
      color: theme.colors.textSecondary,
      marginBottom: 10,
    },
    bigStatRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
    },
    bigNumber: {
      fontSize: 34,
      fontWeight: '800',
      color: theme.colors.textPrimary,
    },
    bigDivider: {
      fontSize: 20,
      fontWeight: '600',
      color: theme.colors.textTertiary,
      marginLeft: 6,
    },
    bigPct: {
      marginLeft: 'auto',
      fontSize: 20,
      fontWeight: '700',
      color: theme.colors.accentSuccess,
    },
    bar: {
      height: 6,
      borderRadius: 3,
      backgroundColor: theme.colors.surface,
      overflow: 'hidden',
      marginTop: 10,
      borderWidth: 0.5,
      borderColor: theme.colors.border,
    },
    barFill: {
      height: '100%',
      backgroundColor: theme.colors.accentSuccess,
      borderRadius: 3,
    },
    caption: {
      fontSize: 12,
      color: theme.colors.textMuted,
      marginTop: 8,
    },
    dayRow: {
      flexDirection: 'row',
    },
    dayStat: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 8,
      marginHorizontal: 4,
      backgroundColor: theme.colors.surface,
      borderRadius: 10,
      borderWidth: 0.5,
      borderColor: theme.colors.border,
    },
    dayNumber: {
      fontSize: 24,
      fontWeight: '800',
      color: theme.colors.textPrimary,
    },
    dayCaption: {
      fontSize: 11,
      color: theme.colors.textTertiary,
      marginTop: 2,
    },
    tagRow: {
      marginBottom: 12,
    },
    tagHead: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 5,
    },
    tagName: {
      flex: 1,
      fontSize: theme.typography.body,
      color: theme.colors.textPrimary,
      marginRight: 10,
    },
    tagCount: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.colors.textSecondary,
    },
    tagBar: {
      height: 5,
      borderRadius: 3,
      backgroundColor: theme.colors.surface,
      overflow: 'hidden',
    },
    tagBarFill: {
      height: '100%',
      backgroundColor: theme.colors.accentPrimary || theme.colors.accentSuccess,
      borderRadius: 3,
    },
    // Per-project card (its tags nested inside)
    projectCard: {
      backgroundColor: theme.colors.surface,
      borderRadius: 12,
      borderWidth: 0.5,
      borderColor: theme.colors.border,
      padding: 12,
      marginBottom: 12,
    },
    projectHead: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 8,
    },
    projectName: {
      flex: 1,
      fontSize: theme.typography.body,
      fontWeight: '700',
      color: theme.colors.textPrimary,
      marginRight: 10,
    },
    projectCount: {
      fontSize: 14,
      fontWeight: '700',
      color: theme.colors.textSecondary,
    },
    projectBar: {
      height: 6,
      borderRadius: 3,
      backgroundColor: theme.colors.background,
      overflow: 'hidden',
    },
    projectTagRow: {
      marginTop: 10,
      paddingLeft: 10,
      borderLeftWidth: 2,
      borderLeftColor: theme.colors.border,
    },
    projectTagHead: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 4,
    },
    projectTagName: {
      flex: 1,
      fontSize: 13,
      color: theme.colors.textSecondary,
      marginRight: 10,
    },
    projectTagCount: {
      fontSize: 12,
      fontWeight: '600',
      color: theme.colors.textTertiary,
    },
    projectTagBar: {
      height: 4,
      borderRadius: 2,
      backgroundColor: theme.colors.background,
      overflow: 'hidden',
    },
    projectTagBarFill: {
      height: '100%',
      backgroundColor: theme.colors.accentPrimary || theme.colors.accentSuccess,
      borderRadius: 2,
    },
    projectBarFill: {
      height: '100%',
      backgroundColor: theme.colors.accentSuccess,
      borderRadius: 3,
    },
  });
