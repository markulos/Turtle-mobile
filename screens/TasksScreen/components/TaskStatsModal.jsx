import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../context/ThemeContext';
import EdgeSwipePage from '../../TurtleScreen/components/EdgeSwipePage';

// Local YYYY-MM-DD (local time, not UTC) so it lines up with how dueDate
// is stored / compared elsewhere in the calendar.
const toDateStr = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
const pct = (done, total) => (total > 0 ? Math.round((done / total) * 100) : 0);
const prettyBoard = (name) => (name === 'No Project' ? 'No Board' : name);

const TODAY_STR = toDateStr(new Date());

/**
 * TaskStatsModal — a full-screen, Instagram-profile-style STATS PAGE (edge-swipe
 * back to close), not a bottom sheet. Tapping a board pushes ANOTHER page (a
 * nested EdgeSwipePage overlay — iOS won't present a sibling modal over the
 * first) that details that board's tasks: completion, its tags, and the actual
 * task list split into to-do / done.
 *
 * Props unchanged from the old sheet: visible, onClose, tasks, selectedProject,
 * selectedTags, tagFilterMode, selectedDate.
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
  const insets = useSafeAreaInsets();
  const styles = createStyles(theme);
  const [board, setBoard] = React.useState(null); // drilled-in board name

  // Close the drill-down whenever the whole page closes.
  React.useEffect(() => { if (!visible) setBoard(null); }, [visible]);

  const passesProjectTag = React.useCallback(
    (task) => {
      if (selectedProject !== 'All') {
        const matches = selectedProject === 'No Project'
          ? !task.project
          : (task.project || 'No Project') === selectedProject;
        if (!matches) return false;
      }
      if (selectedTags.length > 0) {
        const tt = task.tags || [];
        if (tagFilterMode === 'all') {
          if (!selectedTags.every((t) => tt.includes(t))) return false;
        } else if (!selectedTags.some((t) => tt.includes(t))) return false;
      }
      return true;
    },
    [selectedProject, selectedTags, tagFilterMode],
  );

  const allTime = React.useMemo(() => ({
    total: tasks.length,
    completed: tasks.filter((t) => t.completed).length,
  }), [tasks]);

  const day = React.useMemo(() => {
    const date = selectedDate instanceof Date ? selectedDate : new Date();
    const dateStr = toDateStr(date);
    const scheduled = tasks.filter((t) => t.dueDate === dateStr && passesProjectTag(t));
    return {
      label: date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      total: scheduled.length,
      completed: scheduled.filter((t) => t.completed).length,
    };
  }, [tasks, selectedDate, passesProjectTag]);

  const byTag = React.useMemo(() => {
    const map = new Map();
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
      .sort((a, b) => b.total - a.total || (a.tag === 'Untagged' ? 1 : -1));
  }, [tasks]);

  const byProject = React.useMemo(() => {
    const map = new Map();
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

  const boardDetail = React.useMemo(() => {
    if (!board) return null;
    const p = byProject.find((x) => x.project === board);
    const isNo = board === 'No Project';
    const boardTasks = tasks.filter((t) => (isNo ? !t.project : (t.project || 'No Project') === board));
    const byDue = (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
    return {
      name: board,
      total: p?.total || boardTasks.length,
      completed: p?.completed || boardTasks.filter((t) => t.completed).length,
      tags: p?.tags || [],
      pending: boardTasks.filter((t) => !t.completed).sort(byDue),
      done: boardTasks.filter((t) => t.completed).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)),
    };
  }, [board, byProject, tasks]);

  const overallPct = pct(allTime.completed, allTime.total);

  return (
    <EdgeSwipePage visible={visible} onClose={onClose}>
      <View style={[styles.page, { paddingTop: insets.top }]}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} style={styles.backBtn}>
            <Icon name="chevron-left" size={28} color={theme.colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.topTitle}>Task Stats</Text>
          <View style={{ width: 28 }} />
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}>
          {/* Hero — all-time completion, profile-style */}
          <View style={styles.hero}>
            <Text style={styles.heroPct}>{overallPct}%</Text>
            <Text style={styles.heroSub}>{allTime.completed} of {allTime.total} tasks completed, all time</Text>
            <View style={styles.heroBar}>
              <View style={[styles.heroBarFill, { width: `${overallPct}%` }]} />
            </View>
          </View>

          {/* Selected day */}
          <Section title={day.label} styles={styles}>
            <View style={styles.dayRow}>
              <DayStat n={day.total} label="scheduled" styles={styles} />
              <DayStat n={day.completed} label="completed" color={theme.colors.accentSuccess} styles={styles} />
              <DayStat n={Math.max(0, day.total - day.completed)} label="remaining" color={theme.colors.accentWarning} styles={styles} />
            </View>
            {(selectedProject !== 'All' || selectedTags.length > 0) && (
              <Text style={styles.caption}>based on the active filter</Text>
            )}
          </Section>

          {/* By board — TAPPABLE, drills into per-board detail */}
          <Section title="By board" styles={styles}>
            {byProject.length === 0 ? (
              <Text style={styles.caption}>No tasks yet</Text>
            ) : (
              byProject.map((p) => (
                <TouchableOpacity key={p.project} activeOpacity={0.7} onPress={() => setBoard(p.project)} style={styles.boardCard}>
                  <View style={styles.projectHead}>
                    <Text style={styles.projectName} numberOfLines={1}>{prettyBoard(p.project)}</Text>
                    <Text style={styles.projectCount}>{p.completed}/{p.total}</Text>
                    <Icon name="chevron-right" size={20} color={theme.colors.textTertiary} style={{ marginLeft: 4 }} />
                  </View>
                  <View style={styles.projectBar}>
                    <View style={[styles.projectBarFill, { width: `${pct(p.completed, p.total)}%` }]} />
                  </View>
                </TouchableOpacity>
              ))
            )}
          </Section>

          {/* By tag */}
          <Section title="By tag" styles={styles}>
            {byTag.length === 0 ? (
              <Text style={styles.caption}>No tasks yet</Text>
            ) : (
              byTag.map(({ tag, total, completed }) => (
                <View key={tag} style={styles.tagRow}>
                  <View style={styles.tagHead}>
                    <Text style={styles.tagName} numberOfLines={1}>{tag}</Text>
                    <Text style={styles.tagCount}>{completed}/{total}</Text>
                  </View>
                  <View style={styles.tagBar}>
                    <View style={[styles.tagBarFill, { width: `${pct(completed, total)}%` }]} />
                  </View>
                </View>
              ))
            )}
          </Section>
        </ScrollView>
      </View>

      {/* Nested board-detail page (overlay so iOS renders it over the stats page). */}
      <EdgeSwipePage overlay visible={!!board} onClose={() => setBoard(null)}>
        {boardDetail && (
          <BoardDetail detail={boardDetail} onClose={() => setBoard(null)} insets={insets} styles={styles} theme={theme} />
        )}
      </EdgeSwipePage>
    </EdgeSwipePage>
  );
};

const Section = ({ title, children, styles }) => (
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {children}
  </View>
);

const DayStat = ({ n, label, color, styles }) => (
  <View style={styles.dayStat}>
    <Text style={[styles.dayNumber, color ? { color } : null]}>{n}</Text>
    <Text style={styles.dayCaption}>{label}</Text>
  </View>
);

/** Per-board detail: completion, tag breakdown, and the actual task list. */
const BoardDetail = ({ detail, onClose, insets, styles, theme }) => {
  const p = pct(detail.completed, detail.total);
  const TaskRow = ({ t, done }) => {
    const overdue = !done && t.dueDate && t.dueDate < TODAY_STR;
    return (
      <View style={styles.taskRow}>
        <Icon
          name={done ? 'check-circle' : overdue ? 'alert-circle-outline' : 'circle-outline'}
          size={18}
          color={done ? theme.colors.accentSuccess : overdue ? theme.colors.accentError : theme.colors.textTertiary}
        />
        <Text style={[styles.taskTitle, done && styles.taskDone]} numberOfLines={1}>{t.title || 'Untitled'}</Text>
        {t.dueDate ? (
          <Text style={[styles.taskMeta, overdue && { color: theme.colors.accentError }]}>
            {t.dueDate === TODAY_STR ? 'Today' : t.dueDate.slice(5)}{t.time ? ` · ${t.time}` : ''}
          </Text>
        ) : <Text style={styles.taskMeta}>—</Text>}
      </View>
    );
  };
  return (
    <View style={[styles.page, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} style={styles.backBtn}>
          <Icon name="chevron-left" size={28} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topTitle} numberOfLines={1}>{prettyBoard(detail.name)}</Text>
        <View style={{ width: 28 }} />
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}>
        <View style={styles.hero}>
          <Text style={styles.heroPct}>{p}%</Text>
          <Text style={styles.heroSub}>{detail.completed} of {detail.total} done in this board</Text>
          <View style={styles.heroBar}><View style={[styles.heroBarFill, { width: `${p}%` }]} /></View>
        </View>

        {detail.tags.length > 0 && (
          <Section title="Tags in this board" styles={styles}>
            {detail.tags.map(({ tag, total, completed }) => (
              <View key={tag} style={styles.tagRow}>
                <View style={styles.tagHead}>
                  <Text style={styles.tagName} numberOfLines={1}>{tag}</Text>
                  <Text style={styles.tagCount}>{completed}/{total}</Text>
                </View>
                <View style={styles.tagBar}><View style={[styles.tagBarFill, { width: `${pct(completed, total)}%` }]} /></View>
              </View>
            ))}
          </Section>
        )}

        <Section title={`To do · ${detail.pending.length}`} styles={styles}>
          {detail.pending.length === 0
            ? <Text style={styles.caption}>Nothing left — all clear.</Text>
            : detail.pending.map((t) => <TaskRow key={t.id} t={t} done={false} />)}
        </Section>

        <Section title={`Completed · ${detail.done.length}`} styles={styles}>
          {detail.done.length === 0
            ? <Text style={styles.caption}>None yet.</Text>
            : detail.done.map((t) => <TaskRow key={t.id} t={t} done />)}
        </Section>
      </ScrollView>
    </View>
  );
};

const createStyles = (theme) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.colors.background, paddingHorizontal: 18 },
    topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, marginBottom: 4 },
    backBtn: { width: 28, alignItems: 'flex-start' },
    topTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: theme.colors.textPrimary },
    hero: { alignItems: 'center', paddingVertical: 18 },
    heroPct: { fontSize: 56, fontWeight: '900', color: theme.colors.textPrimary, letterSpacing: -2 },
    heroSub: { fontSize: 13, color: theme.colors.textSecondary, marginTop: 4 },
    heroBar: { width: '100%', height: 8, borderRadius: 4, backgroundColor: theme.colors.surface, overflow: 'hidden', marginTop: 14, borderWidth: 0.5, borderColor: theme.colors.border },
    heroBarFill: { height: '100%', backgroundColor: theme.colors.accentSuccess, borderRadius: 4 },
    section: { marginTop: 22 },
    sectionTitle: { fontSize: theme.typography.body, fontWeight: '600', color: theme.colors.textSecondary, marginBottom: 10 },
    caption: { fontSize: 12, color: theme.colors.textMuted, marginTop: 8 },
    dayRow: { flexDirection: 'row' },
    dayStat: { flex: 1, alignItems: 'center', paddingVertical: 10, marginHorizontal: 4, backgroundColor: theme.colors.surface, borderRadius: 10, borderWidth: 0.5, borderColor: theme.colors.border },
    dayNumber: { fontSize: 24, fontWeight: '800', color: theme.colors.textPrimary },
    dayCaption: { fontSize: 11, color: theme.colors.textTertiary, marginTop: 2 },
    tagRow: { marginBottom: 12 },
    tagHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 },
    tagName: { flex: 1, fontSize: theme.typography.body, color: theme.colors.textPrimary, marginRight: 10 },
    tagCount: { fontSize: 13, fontWeight: '600', color: theme.colors.textSecondary },
    tagBar: { height: 5, borderRadius: 3, backgroundColor: theme.colors.surface, overflow: 'hidden' },
    tagBarFill: { height: '100%', backgroundColor: theme.colors.accentPrimary || theme.colors.accentSuccess, borderRadius: 3 },
    boardCard: { backgroundColor: theme.colors.surface, borderRadius: 12, borderWidth: 0.5, borderColor: theme.colors.border, padding: 12, marginBottom: 12 },
    projectHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
    projectName: { flex: 1, fontSize: theme.typography.body, fontWeight: '700', color: theme.colors.textPrimary, marginRight: 10 },
    projectCount: { fontSize: 14, fontWeight: '700', color: theme.colors.textSecondary },
    projectBar: { height: 6, borderRadius: 3, backgroundColor: theme.colors.background, overflow: 'hidden' },
    projectBarFill: { height: '100%', backgroundColor: theme.colors.accentSuccess, borderRadius: 3 },
    taskRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
    taskTitle: { flex: 1, fontSize: 14, color: theme.colors.textPrimary },
    taskDone: { color: theme.colors.textTertiary, textDecorationLine: 'line-through' },
    taskMeta: { fontSize: 12, color: theme.colors.textTertiary },
  });
