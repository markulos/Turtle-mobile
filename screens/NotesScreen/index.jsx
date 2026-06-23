/**
 * NotesScreen — mobile parity for the web NotesScreen + chat /note /todo
 *
 * The Turtle data model treats notes and todos as the same `notes` table
 * with a `type` discriminator ('note' | 'todo') and a `done` flag. This
 * screen surfaces both kinds in a single timeline, with:
 *   • A 3-way filter pill: All / Notes / Todos
 *   • Type-aware row rendering (todos get a tappable checkbox + strike
 *     through when done; plain notes get a paragraph icon)
 *   • A floating ＋ FAB that opens a slide-up composer modal
 *   • Long-press → delete confirm
 *
 * The aesthetic intentionally matches the rest of mobile (flat-black
 * surface cards, hairline borders, golden-ratio spacing) rather than
 * porting the web app's glass treatment wholesale — mobile reads more
 * cleanly with flat fills at typical viewing distance + brightness.
 *
 * Server endpoints (from web NotesScreen + /api/turtle/note(s)):
 *   GET    /turtle/notes?limit=&offset=
 *   POST   /turtle/note     { content, description?, tags?, type?, done? }
 *   PATCH  /turtle/notes/:id  { content?, description?, tags?, type?, done? }
 *   DELETE /turtle/notes/:id
 *
 * No optimistic merging yet — every mutation refreshes via refetch.
 * Notes are a low-traffic surface; the simpler code path wins.
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  FlatList,
  ScrollView,
  Animated,
  useWindowDimensions,
  StyleSheet,
  Platform,
  ActivityIndicator,
  Alert,
  Keyboard,
} from 'react-native';
// Reanimated drives the composer's keyboard-synced lift the SAME way the Turtle
// Claude session dock does (useAnimatedKeyboard → a compositor-only translateY
// worklet). This is why the composer is an in-tree overlay and NOT a <Modal>:
// useAnimatedKeyboard tracks the root window only, so it can't see the keyboard
// from inside a Modal's separate native window. See keyboard-sync-patterns.
import Reanimated, {
  useAnimatedKeyboard,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  runOnJS,
  Easing as REasing,
} from 'react-native-reanimated';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../context/ThemeContext';
import { useServer } from '../../context/ServerContext';
import { useClaudeQueue } from '../../context/ClaudeQueueContext';
import { keyboardScrollProps } from '../../components/KeyboardSafeView';

const FILTER_ALL = 'all';
const FILTER_NOTE = 'note';
const FILTER_TODO = 'todo';
// Left-to-right page order for the swipeable tabs.
const FILTER_ORDER = [FILTER_ALL, FILTER_NOTE, FILTER_TODO];
// Sentinel topic for notes that carry no tags (shown as its own "Untagged" chip).
const UNTAGGED = '__untagged__';

// Composer modes. 'feedback' persists as a to-do but auto-stamps the Turtle 3D
// tag + a platform tag so the cue rides along when the to-do is handed to the
// Claude session (formatNoteForClaude already emits the Tags line).
const FEEDBACK_TAG = 'TURTLE 3D';
const PLATFORM_TAGS = { web: 'Web app', mobile: 'Mobile app' };

// Derive browsable "topics" from note tags, mirroring the web NotesScreen: a
// topic is the segment BEFORE the first '/', so `moodboard/wedding` lives under
// the `moodboard` topic. A note counts once per distinct topic it touches.
// Selecting a topic later matches that topic AND its sub-topics. Pure JS.
function buildTopics(notes) {
  const map = new Map(); // topic -> number of notes touching it
  let untagged = 0;
  for (const n of notes) {
    const tags = Array.isArray(n.tags) ? n.tags : [];
    if (tags.length === 0) { untagged += 1; continue; }
    const seen = new Set();
    for (const tag of tags) {
      const root = String(tag).split('/')[0].trim();
      if (!root || seen.has(root)) continue;
      seen.add(root);
      map.set(root, (map.get(root) || 0) + 1);
    }
  }
  const topics = Array.from(map.entries())
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => a.topic.toLowerCase().localeCompare(b.topic.toLowerCase()));
  return { topics, untagged };
}

export default function NotesScreen() {
  const { theme, isDark } = useTheme();
  const { api, isConnected } = useServer();
  const { enqueueNote } = useClaudeQueue();
  const styles = useMemo(() => createStyles(theme, isDark), [theme, isDark]);

  // ── Data ────────────────────────────────────────────────
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // ── UI state ────────────────────────────────────────────
  const [filter, setFilter] = useState(FILTER_ALL);
  // Topic browsing — null = all topics. Mirrors the web Topics sidebar; ANDs with
  // the type filter above. A topic = the parent segment of a `parent/child` tag.
  const [selectedTopic, setSelectedTopic] = useState(null);
  const [composerOpen, setComposerOpen] = useState(false);
  // The note currently being edited (null = the composer is in "create" mode).
  const [editingNote, setEditingNote] = useState(null);

  // ── Fetch list ──────────────────────────────────────────
  // Newest-first: the server's GET /notes already orders DESC by
  // createdAt so we render exactly what comes back.
  const refresh = useCallback(async () => {
    if (!isConnected) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/turtle/notes?limit=200');
      if (res?.success && Array.isArray(res.notes)) {
        setNotes(res.notes);
      }
    } catch (e) {
      setError(e.message || 'Failed to load notes');
    } finally {
      setLoading(false);
    }
  }, [api, isConnected]);

  useEffect(() => { void refresh(); }, [refresh]);

  // ── Mutations ───────────────────────────────────────────
  const createNote = async ({ content, description, type, tags }) => {
    if (!content.trim()) return false;
    try {
      const res = await api.post('/turtle/note', {
        // Send BOTH field names: the server's POST handler historically reads
        // `note` (the web chat /note path), so sending only `content` made it
        // reject with "content required". `content` is kept for forward-compat
        // with the updated server that accepts either.
        note: content.trim(),
        content: content.trim(),
        description: description?.trim() || '',
        type: type || 'note',
        tags: tags || [],
        done: false,
      });
      if (res?.success !== false) {
        await refresh();
        return true;
      }
      return false;
    } catch (e) {
      Alert.alert('Could not create note', e.message || String(e));
      return false;
    }
  };

  // Edit an existing note/todo via PATCH. The PATCH handler reads `content`
  // (consistent with what we send here), so no dual-field dance is needed.
  const editNote = async (id, { content, description, type, tags }) => {
    if (!content.trim()) return false;
    try {
      const res = await api.patch(`/turtle/notes/${id}`, {
        content: content.trim(),
        description: description?.trim() || '',
        type: type || 'note',
        tags: tags || [],
      });
      if (res?.success !== false) {
        await refresh();
        return true;
      }
      return false;
    } catch (e) {
      Alert.alert('Could not update note', e.message || String(e));
      return false;
    }
  };

  const toggleDone = async (note) => {
    // Optimistic flip: update local state before the network call so the
    // checkbox feels responsive. On error, roll back THIS note functionally
    // (no stale `notes` closure — so a memoized NoteRow holding an old handler
    // still rolls back correctly, and we don't clobber other concurrent edits).
    setNotes((cur) => cur.map((n) => (n.id === note.id ? { ...n, done: !n.done } : n)));
    try {
      await api.patch(`/turtle/notes/${note.id}`, { done: !note.done });
    } catch (e) {
      setNotes((cur) => cur.map((n) => (n.id === note.id ? { ...n, done: note.done } : n)));
      Alert.alert('Could not update', e.message || String(e));
    }
  };

  // Raw delete (no confirm) — the action sheet below is the deliberate step.
  const performDelete = async (note) => {
    try {
      await api.delete(`/turtle/notes/${note.id}`);
      setNotes((cur) => cur.filter((n) => n.id !== note.id));
    } catch (e) {
      Alert.alert('Delete failed', e.message || String(e));
    }
  };

  // Single tap → open the note/todo straight in the editor composer.
  const openEditNote = useCallback((note) => {
    setEditingNote(note);
    setComposerOpen(true);
  }, []);

  // Long-press menu: choose to Edit or Delete the note/todo.
  const showNoteActions = (note) => {
    Alert.alert(
      note.type === 'todo' ? 'Todo' : 'Note',
      note.content?.slice(0, 80) || '',
      [
        { text: 'Edit', onPress: () => { setEditingNote(note); setComposerOpen(true); } },
        { text: 'Delete', style: 'destructive', onPress: () => performDelete(note) },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  };

  // Push a todo to the Claude queue (drained from the Turtle tab's Claude
  // session). Lives here on the Notes page rather than the Tasks/calendar
  // screen, per the workflow.
  const sendTodoToClaude = useCallback(async (note) => {
    try {
      await enqueueNote(note);
      Alert.alert(
        'Queued for Claude',
        `"${(note.content || 'Todo').slice(0, 60)}" was added to the Claude queue. It runs once a Claude session is active — and keeps going even if you close the app.`,
      );
    } catch (e) {
      Alert.alert('Could not queue', e?.message || 'Failed to reach the server.');
    }
  }, [enqueueNote]);

  // ── Filtering ───────────────────────────────────────────
  // Topics derived from tags (parent of `parent/child`); drives the topic rail.
  const topicTree = useMemo(() => buildTopics(notes), [notes]);

  // Visible list ANDs the type filter (All/Notes/Todos) with the topic filter.
  // Topic match is "exact topic OR a sub-topic of it" (e.g. selecting `moodboard`
  // also shows `moodboard/wedding`) — same predicate as the web NotesScreen.
  const visible = useMemo(() => {
    let list = notes;
    if (filter !== FILTER_ALL) list = list.filter((n) => (n.type || 'note') === filter);
    if (selectedTopic === UNTAGGED) {
      list = list.filter((n) => !Array.isArray(n.tags) || n.tags.length === 0);
    } else if (selectedTopic) {
      const sel = selectedTopic;
      list = list.filter((n) => Array.isArray(n.tags)
        && n.tags.some((t) => t === sel || String(t).startsWith(sel + '/')));
    }
    return list;
  }, [notes, filter, selectedTopic]);

  const counts = useMemo(() => {
    const c = { all: notes.length, note: 0, todo: 0 };
    for (const n of notes) {
      const t = n.type || 'note';
      if (t === 'todo') c.todo += 1;
      else c.note += 1;
    }
    return c;
  }, [notes]);

  // Unique tags already used across all notes/todos, so the composer can offer
  // them as tap-to-select chips (rather than making the user retype/remember a
  // tag's exact spelling). Sorted case-insensitively for a stable list.
  const allTags = useMemo(() => {
    const set = new Set();
    for (const n of notes) {
      if (!Array.isArray(n.tags)) continue;
      for (const t of n.tags) {
        const s = (t || '').trim();
        if (s) set.add(s);
      }
    }
    return Array.from(set).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }, [notes]);

  // ── Swipeable tabs ──────────────────────────────────────
  // Same mechanism as the photo vault: a horizontal paging ScrollView whose
  // scroll offset (pageScrollX) drives BOTH the pages and the pill indicator
  // 1:1, so swiping and the pill slide stay perfectly in sync.
  const { width: screenW } = useWindowDimensions();
  const pageScrollX = useRef(new Animated.Value(0)).current;
  const pagerRef = useRef(null);
  const segW = (screenW - 32) / 3; // track is inset 16px each side; 3 segments
  const tabIndicatorX = pageScrollX.interpolate({
    inputRange: [0, screenW, screenW * 2],
    outputRange: [0, segW, segW * 2],
    extrapolate: 'clamp',
  });
  const goToPage = useCallback((index) => {
    pagerRef.current?.scrollTo({ x: index * screenW, animated: true });
    setFilter(FILTER_ORDER[index]);
  }, [screenW]);
  const onPagerEnd = useCallback((e) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / screenW);
    const f = FILTER_ORDER[idx];
    if (f && f !== filter) setFilter(f);
  }, [screenW, filter]);
  // Per-page list: type filter + the active topic filter. Notes are few.
  const listFor = useCallback((filterKey) => {
    let list = notes;
    if (filterKey !== FILTER_ALL) list = list.filter((n) => (n.type || 'note') === filterKey);
    if (selectedTopic === UNTAGGED) {
      list = list.filter((n) => !Array.isArray(n.tags) || n.tags.length === 0);
    } else if (selectedTopic) {
      const sel = selectedTopic;
      list = list.filter((n) => Array.isArray(n.tags)
        && n.tags.some((t) => t === sel || String(t).startsWith(sel + '/')));
    }
    return list;
  }, [notes, selectedTopic]);
  const renderPageBody = (filterKey) => {
    const data = listFor(filterKey);
    if (data.length === 0) {
      return (
        <View style={styles.center}>
          <Icon
            name={filterKey === FILTER_TODO ? 'checkbox-blank-outline' : 'note-text-outline'}
            size={36}
            color={theme.colors.textMuted}
          />
          <Text style={styles.emptyTitle}>
            {filterKey === FILTER_TODO ? 'No todos yet' : filterKey === FILTER_NOTE ? 'No notes yet' : 'Nothing here yet'}
          </Text>
          <Text style={styles.emptyHint}>
            Tap ＋ to add one, or use /note · /todo in Turtle chat.
          </Text>
        </View>
      );
    }
    return (
      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        style={{ flex: 1 }}
        contentContainerStyle={styles.list}
        refreshing={loading}
        onRefresh={refresh}
        {...keyboardScrollProps}
        renderItem={({ item }) => (
          <NoteRow
            note={item}
            onPress={openEditNote}
            onToggleDone={toggleDone}
            onLongPress={showNoteActions}
            onSendToClaude={sendTodoToClaude}
            theme={theme}
            isDark={isDark}
          />
        )}
      />
    );
  };

  // ── Header ──────────────────────────────────────────────
  // Layered subtle gradient under the header — borrows the web app's
  // "accent glow at the top" idiom and adapts it to mobile (single
  // linear gradient, small accent alpha, fades to background).
  const headerGradient = isDark
    ? ['rgba(74,222,128,0.06)', 'rgba(74,222,128,0.02)', 'transparent']
    : ['rgba(34,197,94,0.06)', 'rgba(34,197,94,0.02)', 'transparent'];

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <LinearGradient
        colors={headerGradient}
        style={styles.headerGradient}
        pointerEvents="none"
      />

      <View style={styles.header}>
        <Text style={styles.title}>Notes</Text>
        <Text style={styles.titleCount}>{counts.all}</Text>
      </View>

      {/* Swipeable segmented control — the pill slides 1:1 with the pager. */}
      <View style={styles.tabTrack}>
        <Animated.View
          style={[styles.tabPill, { width: segW - 4, transform: [{ translateX: tabIndicatorX }] }]}
        />
        {FILTER_ORDER.map((fk, index) => {
          const inputRange = [(index - 1) * screenW, index * screenW, (index + 1) * screenW];
          const activeOp = pageScrollX.interpolate({ inputRange, outputRange: [0, 1, 0], extrapolate: 'clamp' });
          const inactiveOp = pageScrollX.interpolate({ inputRange, outputRange: [1, 0, 1], extrapolate: 'clamp' });
          const label = fk === FILTER_ALL ? 'All' : fk === FILTER_NOTE ? 'Notes' : 'Todos';
          const count = fk === FILTER_ALL ? counts.all : fk === FILTER_NOTE ? counts.note : counts.todo;
          return (
            <TouchableOpacity
              key={fk}
              style={styles.tabSeg}
              onPress={() => goToPage(index)}
              activeOpacity={0.8}
            >
              <Animated.Text style={[styles.tabSegActive, { opacity: activeOp }]}>
                {`${label}  ${count}`}
              </Animated.Text>
              <Animated.Text style={[styles.tabSegInactive, { opacity: inactiveOp }]}>
                {`${label}  ${count}`}
              </Animated.Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Topic rail — browse by topic (parent tag). Horizontally scrollable so a
          long tag list never crowds the type filter. Hidden when there are no
          tagged or untagged notes to browse. Tapping the active chip clears it. */}
      {(topicTree.topics.length > 0 || topicTree.untagged > 0) && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.topicRailScroll}
          contentContainerStyle={styles.topicRail}
          keyboardShouldPersistTaps="handled"
        >
          <TopicChip
            label="All Topics"
            active={selectedTopic === null}
            onPress={() => setSelectedTopic(null)}
            theme={theme}
            isDark={isDark}
          />
          {topicTree.topics.map(({ topic, count }) => (
            <TopicChip
              key={topic}
              label={topic}
              count={count}
              active={selectedTopic === topic}
              onPress={() => setSelectedTopic((cur) => (cur === topic ? null : topic))}
              theme={theme}
              isDark={isDark}
            />
          ))}
          {topicTree.untagged > 0 && (
            <TopicChip
              label="Untagged"
              count={topicTree.untagged}
              active={selectedTopic === UNTAGGED}
              onPress={() => setSelectedTopic((cur) => (cur === UNTAGGED ? null : UNTAGGED))}
              theme={theme}
              isDark={isDark}
            />
          )}
        </ScrollView>
      )}

      {/* Body — swipeable pager (one page per filter); the pill tracks scroll */}
      {error ? (
        <View style={styles.center}>
          <Icon name="cloud-off-outline" size={32} color={theme.colors.textMuted} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={refresh} style={styles.retryBtn}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : loading && notes.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : (
        <Animated.ScrollView
          ref={pagerRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { x: pageScrollX } } }],
            { useNativeDriver: true },
          )}
          onMomentumScrollEnd={onPagerEnd}
          style={{ flex: 1 }}
        >
          {FILTER_ORDER.map((fk) => (
            <View key={fk} style={{ width: screenW }}>
              {renderPageBody(fk)}
            </View>
          ))}
        </Animated.ScrollView>
      )}

      {/* FAB */}
      <TouchableOpacity
        accessibilityLabel="Add note"
        style={styles.fab}
        onPress={() => { setEditingNote(null); setComposerOpen(true); }}
        activeOpacity={0.85}
      >
        <Icon name="plus" size={28} color={isDark ? '#000' : '#fff'} />
      </TouchableOpacity>

      {/* Composer — create OR edit (initialNote drives which). */}
      <ComposerModal
        visible={composerOpen}
        initialNote={editingNote}
        allTags={allTags}
        onClose={() => { setComposerOpen(false); setEditingNote(null); }}
        onSubmit={async (payload) => {
          const ok = editingNote
            ? await editNote(editingNote.id, payload)
            : await createNote(payload);
          if (ok) { setComposerOpen(false); setEditingNote(null); }
        }}
        theme={theme}
        isDark={isDark}
      />
    </SafeAreaView>
  );
}

// ── Filter pill ────────────────────────────────────────────
function FilterPill({ label, active, count, onPress, theme, isDark }) {
  // Build the style set once per render (was 8× StyleSheet.create per pill).
  const ps = pillStyles(theme, isDark);
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={[ps.pill, active && ps.pillActive]}
    >
      <Text style={[ps.pillLabel, active && ps.pillLabelActive]} numberOfLines={1}>
        {label}
      </Text>
      <View style={[ps.pillCount, active && ps.pillCountActive]}>
        <Text style={[ps.pillCountText, active && ps.pillCountTextActive]} numberOfLines={1}>
          {count}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const pillStyles = (theme, isDark) => StyleSheet.create({
  pill: {
    // Equal-width fixed segments (1/3 each) so the row never overflows or
    // reflows: large counts / the active bold weight can't squish neighbours
    // or shift them around. Mirrors the web PillToggle's equal-slot idiom.
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 100,
    backgroundColor: theme.colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  pillActive: {
    backgroundColor: theme.colors.surfaceHighlight,
    borderColor: theme.colors.borderStrong,
  },
  pillLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: theme.colors.textSecondary,
  },
  pillLabelActive: {
    color: theme.colors.textPrimary,
    fontWeight: '600',
  },
  pillCount: {
    minWidth: 18,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 9,
    backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillCountActive: {
    backgroundColor: theme.colors.accentSuccess,
  },
  pillCountText: {
    fontSize: 10,
    fontWeight: '600',
    color: theme.colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  pillCountTextActive: {
    color: isDark ? '#0a0a0a' : '#fff',
  },
});

// ── Topic chip (horizontal rail) ────────────────────────────
function TopicChip({ label, count, active, onPress, theme, isDark }) {
  const s = topicChipStyles(theme, isDark);
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.75} style={[s.chip, active && s.chipActive]}>
      <Text style={[s.label, active && s.labelActive]} numberOfLines={1}>{label}</Text>
      {typeof count === 'number' && (
        <Text style={[s.count, active && s.countActive]}>{count}</Text>
      )}
    </TouchableOpacity>
  );
}

const topicChipStyles = (theme, isDark) => StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 100,
    backgroundColor: theme.colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  // Active = a soft accentInfo tint (mobile has NO accentPrimary; accentInfo is
  // the blue we use, kept distinct from the green accentSuccess on the type pills).
  chipActive: {
    backgroundColor: isDark ? 'rgba(96,165,250,0.16)' : 'rgba(59,130,246,0.12)',
    borderColor: theme.colors.accentInfo,
  },
  label: {
    fontSize: 12.5,
    fontWeight: '600',
    color: theme.colors.textSecondary,
    maxWidth: 150,
  },
  labelActive: { color: theme.colors.accentInfo },
  count: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  countActive: { color: theme.colors.accentInfo },
});

// ── Note row ────────────────────────────────────────────────
function NoteRowImpl({ note, onPress, onToggleDone, onLongPress, onSendToClaude, theme, isDark }) {
  const isTodo = note.type === 'todo';
  const isDone = !!note.done;
  const styles = noteRowStyles(theme, isDark);
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      // Single tap opens the note/todo for editing right away. Long-press still
      // opens the action sheet (kept as the path to Delete).
      onPress={() => onPress(note)}
      onLongPress={() => onLongPress(note)}
      delayLongPress={350}
      style={styles.row}
    >
      {/* Leading icon — checkbox (todo) or note glyph */}
      {isTodo ? (
        <TouchableOpacity
          onPress={() => onToggleDone(note)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={[styles.checkbox, isDone && styles.checkboxDone]}
        >
          {isDone && <Icon name="check" size={14} color={isDark ? '#0a0a0a' : '#fff'} />}
        </TouchableOpacity>
      ) : (
        <View style={styles.noteIcon}>
          <Icon name="text" size={14} color={theme.colors.textMuted} />
        </View>
      )}

      <View style={styles.body}>
        <Text
          numberOfLines={2}
          style={[
            styles.content,
            isDone && styles.contentDone,
          ]}
        >
          {note.content}
        </Text>
        {note.description ? (
          <Text numberOfLines={2} style={styles.description}>
            {note.description}
          </Text>
        ) : null}
        {Array.isArray(note.tags) && note.tags.length > 0 && (
          <View style={styles.tagRow}>
            {note.tags.slice(0, 4).map((t) => (
              <View key={t} style={styles.tag}>
                <Text style={styles.tagText} numberOfLines={1}>{t}</Text>
              </View>
            ))}
            {note.tags.length > 4 && (
              <Text style={styles.moreTags}>+{note.tags.length - 4}</Text>
            )}
          </View>
        )}
        <Text style={styles.timestamp}>
          {formatRelativeTime(note.createdAt)}
        </Text>
      </View>

      {/* Send-to-Claude — todos only. Queues this item for the Turtle-tab
          Claude session to work through. */}
      {isTodo && onSendToClaude && (
        <TouchableOpacity
          onPress={() => onSendToClaude(note)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.sendBtn}
          accessibilityLabel="Send to Claude"
        >
          <Icon name="robot-outline" size={18} color={theme.colors.accentInfo} />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

// Memoized so a row re-renders only when its own note data or the light/dark
// mode changes — not on every NotesScreen re-render (filter taps, composer
// open/close, etc.). Callback props are recreated each render but behaviorally
// identical (Notes uses functional setState, so there's no stale-closure risk).
const NoteRow = React.memo(NoteRowImpl, (prev, next) =>
  prev.note === next.note && prev.isDark === next.isDark,
);

const noteRowStyles = (theme, isDark) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: theme.colors.surface,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: theme.colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxDone: {
    backgroundColor: theme.colors.accentSuccess,
    borderColor: theme.colors.accentSuccess,
  },
  noteIcon: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: theme.colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  sendBtn: {
    alignSelf: 'flex-start',
    marginTop: 2,
    marginLeft: 8,
    padding: 4,
  },
  body: { flex: 1, minWidth: 0 },
  content: {
    fontSize: 15,
    fontWeight: '500',
    color: theme.colors.textPrimary,
    lineHeight: 20,
  },
  contentDone: {
    color: theme.colors.textMuted,
    textDecorationLine: 'line-through',
  },
  description: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    marginTop: 4,
    lineHeight: 18,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: isDark ? 'rgba(96,165,250,0.12)' : 'rgba(59,130,246,0.10)',
  },
  tagText: {
    fontSize: 10,
    fontWeight: '500',
    color: isDark ? '#93c5fd' : '#1d4ed8',
    letterSpacing: 0.2,
  },
  moreTags: {
    fontSize: 10,
    color: theme.colors.textMuted,
    alignSelf: 'center',
  },
  timestamp: {
    fontSize: 10,
    color: theme.colors.textMuted,
    marginTop: 6,
    letterSpacing: 0.2,
  },
});

// ── Composer modal ──────────────────────────────────────────
function ComposerModal({ visible, initialNote, allTags = [], onClose, onSubmit, theme, isDark }) {
  const [content, setContent] = useState('');
  const [description, setDescription] = useState('');
  // Composer mode: 'note' | 'todo' | 'feedback'. To-do is the default for a new
  // capture; 'feedback' additionally reveals the platform selector below.
  const [mode, setMode] = useState('todo');
  const [platform, setPlatform] = useState('web');
  // Tags are now a selected SET (chips) plus a draft for the tag being typed,
  // instead of one comma-separated string — so existing tags can be tapped to
  // add, and selected ones tapped to remove.
  const [tags, setTags] = useState([]);
  const [tagDraft, setTagDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const styles = composerStyles(theme, isDark);
  const isEditing = !!initialNote;
  const { height: screenHeight } = useWindowDimensions();

  // The live keyboard height as a UI-thread shared value — the SAME primitive the
  // Turtle session dock rides. Driving the sheet's translateY straight off this
  // (a compositor-only transform, no relayout) is what makes the composer track
  // the keyboard frame-for-frame, in perfect lockstep, exactly like the session
  // card — including the interactive swipe-down dismiss.
  const keyboard = useAnimatedKeyboard();
  // The sheet rests above the tab bar, while the keyboard rises from the window
  // bottom — so the lift it needs is (keyboardHeight − tabBarHeight), floored at
  // 0. Identical offset to the session dock's sessionDockLift.
  const tabBarHeight = useBottomTabBarHeight();

  // Drives the open/close reveal: 0 = fully closed, 1 = fully open. The backdrop
  // dim and the sheet's slide both read off this one shared value so they move
  // in perfect lockstep.
  const reveal = useSharedValue(0);
  // Sheet height (captured onLayout) so the card slides up from exactly its own
  // height — no guessing, no clipped peek. A shared value so the slide worklet
  // reads it on the UI thread; seeded at ~60% of the screen until first layout.
  const sheetH = useSharedValue(Math.round(screenHeight * 0.6));
  // Keep the overlay mounted through the *exit* animation: the parent flips
  // `visible` to false immediately, but we linger until the slide-down finishes,
  // then unmount.
  const [mounted, setMounted] = useState(visible);
  // Imperative focus: autoFocus fires on mount (before the card has slid in),
  // which pops the keyboard early and ruins the "rise together" feel. We focus
  // on the next frame instead so the keyboard rises in step with the card.
  const contentRef = useRef(null);

  // On open, prefill from the note being edited (or clear for a new one), so
  // a cancelled draft never leaks into the next open.
  useEffect(() => {
    if (visible) {
      setContent(initialNote?.content || '');
      setDescription(initialNote?.description || '');
      // Editing keeps the note's real kind; a fresh capture defaults to to-do.
      setMode(initialNote ? (initialNote.type === 'todo' ? 'todo' : 'note') : 'todo');
      setPlatform('web');
      setTags(Array.isArray(initialNote?.tags) ? initialNote.tags.filter(Boolean) : []);
      setTagDraft('');
      setBusy(false);
    }
  }, [visible, initialNote]);

  // Open/close animation. Uses the iOS sheet-presentation curve
  // (cubic-bezier 0.32, 0.72, 0, 1) — the same deceleration the keyboard rises
  // on — so the card slide, the background fade, and the keyboard all feel like
  // one motion. Opening is a touch slower than closing, like a native sheet.
  const OPEN_EASING = REasing.bezier(0.32, 0.72, 0, 1);
  useEffect(() => {
    if (visible) {
      setMounted(true);
      reveal.value = 0;
      reveal.value = withTiming(1, { duration: 340, easing: OPEN_EASING });
      // Auto-focus ONLY for a fresh capture — a new note is a "start typing now"
      // action, so the keyboard rising in step with the slide is the right feel.
      // OPENING AN EXISTING NOTE is a "read it first" action: just slide the card
      // up with NO keyboard, and let the user tap the title or description field
      // to bring the keyboard up when they actually want to edit.
      if (!initialNote) {
        requestAnimationFrame(() => contentRef.current?.focus());
      }
    } else if (mounted) {
      Keyboard.dismiss();
      reveal.value = withTiming(0, { duration: 240, easing: OPEN_EASING }, (finished) => {
        'worklet';
        if (finished) runOnJS(setMounted)(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // The sheet's transform: closed slides it fully below the screen
  // ((1−reveal)·sheetHeight), and the keyboard lift raises it so its bottom edge
  // pins to the keyboard's top — both folded into ONE compositor-only translateY,
  // recomputed every keyboard frame on the UI thread.
  const sheetStyle = useAnimatedStyle(() => {
    'worklet';
    const lift = Math.max(keyboard.height.value - tabBarHeight, 0);
    return { transform: [{ translateY: (1 - reveal.value) * sheetH.value - lift }] };
  });
  // Backdrop dim deepens exactly as the sheet rises (reads the same shared value).
  const dimStyle = useAnimatedStyle(() => {
    'worklet';
    return { opacity: reveal.value * 0.45 };
  });

  // Add a tag (typed or tapped), de-duped and trimmed; clears the draft.
  const addTag = (raw) => {
    const t = (raw || '').trim();
    if (!t) return;
    setTags((cur) => (cur.includes(t) ? cur : [...cur, t]));
    setTagDraft('');
  };
  const removeTag = (t) => setTags((cur) => cur.filter((x) => x !== t));

  // Existing tags not already selected — the tap-to-add suggestions.
  const suggestions = (allTags || []).filter((t) => !tags.includes(t));

  const handleSubmit = async () => {
    if (!content.trim()) return;
    setBusy(true);
    // Fold any half-typed tag still in the draft into the selection so it's
    // not silently dropped on Save.
    const finalTags = [...tags];
    const pending = tagDraft.trim();
    if (pending && !finalTags.includes(pending)) finalTags.push(pending);
    // Feedback persists as a to-do and gets the Turtle 3D + platform tags
    // (case-insensitive dedupe so we don't double-stamp).
    if (mode === 'feedback') {
      for (const t of [FEEDBACK_TAG, PLATFORM_TAGS[platform]]) {
        if (!finalTags.some((x) => x.toLowerCase() === t.toLowerCase())) finalTags.push(t);
      }
    }
    const type = mode === 'note' ? 'note' : 'todo';
    await onSubmit({ content, description, type, tags: finalTags });
    setBusy(false);
  };

  if (!mounted) return null;
  return (
    // In-tree overlay (NOT a Modal) so useAnimatedKeyboard can see the keyboard
    // — that's the whole reason this matches the session card. Fills the screen
    // above the tab bar; box-none lets taps reach the backdrop / sheet below.
    <View style={styles.backdrop} pointerEvents="box-none">
      {/* Background fade — same shared value driving the card's slide, so the dim
          deepens exactly as the sheet rises. */}
      <Reanimated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }, dimStyle]}
      />
      {/* Tap the dim backdrop above the sheet to dismiss everything; matches the
          iOS sheet idiom and gives an obvious "out" if the keyboard feels stuck. */}
      <TouchableWithoutFeedback onPress={onClose} accessible={false}>
        <View style={{ flex: 1 }} />
      </TouchableWithoutFeedback>
      <Reanimated.View
        onLayout={(e) => {
          const h = Math.round(e.nativeEvent.layout.height);
          if (h > 0) sheetH.value = h;
        }}
        style={[styles.sheet, sheetStyle]}
      >
        {/* Tapping anywhere on the sheet that isn't an input dismisses the
            keyboard. The sheet stays open; only the dim backdrop closes it. */}
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <View>
            <View style={styles.handle} />
          <View style={styles.headerRow}>
            <Text style={styles.title}>
              {isEditing
                ? (mode === 'note' ? 'Edit note' : 'Edit todo')
                : (mode === 'feedback' ? 'New feedback' : mode === 'todo' ? 'New todo' : 'New note')}
            </Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Icon name="close" size={22} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Mode toggle — note / todo / feedback */}
          <View style={styles.typeToggle}>
            {[
              { key: 'note', label: 'Note', icon: 'text' },
              { key: 'todo', label: 'Todo', icon: 'checkbox-marked-circle-outline' },
              { key: 'feedback', label: 'Feedback', icon: 'message-text-outline' },
            ].map((opt) => {
              const active = mode === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  onPress={() => setMode(opt.key)}
                  style={[styles.typeOpt, active && styles.typeOptActive]}
                >
                  <Icon name={opt.icon} size={14} color={active ? (isDark ? '#0a0a0a' : '#fff') : theme.colors.textSecondary} />
                  <Text style={[styles.typeOptText, active && styles.typeOptTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Feedback platform — which app the feedback is about. Stamped as a
              tag so it cues the Claude session when the to-do is sent over. */}
          {mode === 'feedback' && (
            <View style={styles.typeToggle}>
              {[
                { key: 'web', label: PLATFORM_TAGS.web, icon: 'web' },
                { key: 'mobile', label: PLATFORM_TAGS.mobile, icon: 'cellphone' },
              ].map((opt) => {
                const active = platform === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    onPress={() => setPlatform(opt.key)}
                    style={[styles.typeOpt, active && styles.typeOptActive]}
                  >
                    <Icon name={opt.icon} size={14} color={active ? (isDark ? '#0a0a0a' : '#fff') : theme.colors.textSecondary} />
                    <Text style={[styles.typeOptText, active && styles.typeOptTextActive]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          <TextInput
            ref={contentRef}
            placeholder={mode === 'note' ? 'Anything to remember' : mode === 'feedback' ? 'Feedback for Claude' : 'Buy milk'}
            placeholderTextColor={theme.colors.textPlaceholder}
            value={content}
            onChangeText={setContent}
            style={styles.input}
            multiline
          />

          <TextInput
            placeholder="Description (optional)"
            placeholderTextColor={theme.colors.textPlaceholder}
            value={description}
            onChangeText={setDescription}
            style={[styles.input, styles.inputDescription]}
            multiline
          />

          {/* Tags — selected chips + inline new-tag input, then a row of the
              existing tags to tap and add. */}
          <View style={styles.tagBox}>
            <View style={styles.tagChipsWrap}>
              {tags.map((t) => (
                <TouchableOpacity
                  key={t}
                  onPress={() => removeTag(t)}
                  activeOpacity={0.7}
                  style={styles.selectedTag}
                  accessibilityLabel={`Remove tag ${t}`}
                >
                  <Text style={styles.selectedTagText} numberOfLines={1}>{t}</Text>
                  <Icon name="close" size={12} color={isDark ? '#93c5fd' : '#1d4ed8'} />
                </TouchableOpacity>
              ))}
              <TextInput
                placeholder={tags.length ? 'Add tag' : 'Tags'}
                placeholderTextColor={theme.colors.textPlaceholder}
                value={tagDraft}
                // A trailing comma commits the tag (matches the old comma
                // convention); otherwise it's just the in-progress draft.
                onChangeText={(text) => (text.endsWith(',') ? addTag(text.slice(0, -1)) : setTagDraft(text))}
                onSubmitEditing={() => addTag(tagDraft)}
                style={styles.tagInput}
                autoCapitalize="none"
                returnKeyType="done"
                // Keep focus after committing so several tags can be added in
                // a row without re-tapping the field.
                blurOnSubmit={false}
              />
            </View>

            {suggestions.length > 0 && (
              <>
                <Text style={styles.tagSuggestLabel}>Existing tags</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={styles.tagSuggestRow}
                >
                  {suggestions.map((t) => (
                    <TouchableOpacity
                      key={t}
                      onPress={() => addTag(t)}
                      activeOpacity={0.7}
                      style={styles.suggestChip}
                      accessibilityLabel={`Add tag ${t}`}
                    >
                      <Icon name="plus" size={12} color={theme.colors.textMuted} />
                      <Text style={styles.suggestChipText} numberOfLines={1}>{t}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            )}
          </View>

          <View style={styles.submitRow}>
            {/* Dismiss button — for the multiline content/description
                inputs the system Return key inserts a newline, so this
                explicit button is the user's path to closing the
                keyboard without saving. Hidden when the keyboard isn't
                relevant (no inputs focused). */}
            <TouchableOpacity
              onPress={Keyboard.dismiss}
              style={styles.dismissBtn}
              accessibilityLabel="Dismiss keyboard"
            >
              <Icon name="keyboard-close" size={18} color={theme.colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { Keyboard.dismiss(); handleSubmit(); }}
              disabled={busy || !content.trim()}
              style={[
                styles.submit,
                (!content.trim() || busy) && styles.submitDisabled,
              ]}
            >
              {busy ? (
                <ActivityIndicator color={isDark ? '#0a0a0a' : '#fff'} />
              ) : (
                <Text style={styles.submitText}>
                  Save
                </Text>
              )}
            </TouchableOpacity>
          </View>
            </View>
          </TouchableWithoutFeedback>
        </Reanimated.View>
      </View>
  );
}

const composerStyles = (theme, isDark) => StyleSheet.create({
  // Full-screen in-tree overlay (the composer is no longer a Modal). Absolutely
  // fills the NotesScreen above the tab bar; flex-end anchors the sheet to the
  // bottom so its keyboard lift reads as rising off the bottom edge. The dim is
  // a separate animated layer (fades in with the card), not a static fill.
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    zIndex: 100,
  },
  sheet: {
    backgroundColor: theme.colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    // Bottom gap below the Save row. When the keyboard is up the sheet's
    // bottom edge pins to the keyboard top, so this is the visual margin
    // between the Save button and the keyboard — kept tight but enough to
    // breathe (was 36, which read as too airy).
    paddingBottom: 22,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    borderBottomWidth: 0,
  },
  handle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.borderStrong,
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },
  typeToggle: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  typeOpt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 100,
    backgroundColor: theme.colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  typeOptActive: {
    backgroundColor: theme.colors.accentSuccess,
    borderColor: theme.colors.accentSuccess,
  },
  typeOptText: {
    fontSize: 13,
    fontWeight: '500',
    color: theme.colors.textSecondary,
  },
  typeOptTextActive: {
    color: isDark ? '#0a0a0a' : '#fff',
    fontWeight: '600',
  },
  input: {
    backgroundColor: theme.colors.surface,
    color: theme.colors.textPrimary,
    fontSize: 15,
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    marginBottom: 10,
    minHeight: 44,
  },
  inputDescription: { minHeight: 60 },
  // Tag editor — a bordered box holding the selected-tag chips + the inline
  // new-tag input, with the existing-tag suggestions scrolling underneath.
  tagBox: {
    backgroundColor: theme.colors.surface,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 10,
  },
  tagChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    minHeight: 28,
  },
  selectedTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: isDark ? 'rgba(96,165,250,0.16)' : 'rgba(59,130,246,0.12)',
    maxWidth: 160,
  },
  selectedTagText: {
    fontSize: 12,
    fontWeight: '500',
    color: isDark ? '#93c5fd' : '#1d4ed8',
    letterSpacing: 0.2,
  },
  tagInput: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 90,
    fontSize: 14,
    color: theme.colors.textPrimary,
    paddingVertical: 2,
  },
  tagSuggestLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: theme.colors.textMuted,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginTop: 10,
    marginBottom: 6,
  },
  tagSuggestRow: {
    flexDirection: 'row',
    gap: 8,
    paddingRight: 4,
  },
  suggestChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 100,
    backgroundColor: theme.colors.surfaceElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    maxWidth: 160,
  },
  suggestChipText: {
    fontSize: 12,
    fontWeight: '500',
    color: theme.colors.textSecondary,
  },
  submitRow: { marginTop: 6, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 8 },
  dismissBtn: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 100,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  submit: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 100,
    backgroundColor: theme.colors.accentSuccess,
  },
  submitDisabled: {
    opacity: 0.4,
  },
  submitText: {
    color: isDark ? '#0a0a0a' : '#fff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});

// ── Time helper ─────────────────────────────────────────────
function formatRelativeTime(ms) {
  if (typeof ms !== 'number') return '';
  const delta = Date.now() - ms;
  if (delta < 60_000) return 'just now';
  const min = Math.floor(delta / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(ms).toLocaleDateString();
}

// ── Outer styles ────────────────────────────────────────────
const createStyles = (theme, isDark) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  headerGradient: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: 200,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    // 16px matches the tab control + note rows so the title isn't over-indented.
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 10,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: theme.colors.textPrimary,
    letterSpacing: 0.2,
  },
  titleCount: {
    fontSize: 14,
    fontWeight: '500',
    color: theme.colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  // Swipeable segmented control — same look as the photo vault's tab switcher.
  tabTrack: {
    marginHorizontal: 16,
    marginBottom: 12,
    height: 34,
    borderRadius: 8,
    flexDirection: 'row',
    position: 'relative',
    backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
  },
  tabPill: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    left: 2,
    borderRadius: 6,
    backgroundColor: isDark ? '#333333' : '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  tabSeg: { flex: 1, justifyContent: 'center', alignItems: 'center', zIndex: 1 },
  tabSegActive: {
    position: 'absolute',
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.textPrimary,
  },
  tabSegInactive: {
    fontSize: 13,
    fontWeight: '500',
    color: theme.colors.textSecondary,
  },
  // A horizontal ScrollView with no explicit style stretches to fill the
  // parent column's free vertical space — combined with the rail's
  // alignItems:'center', that floats the short chip row in a tall band with
  // equal gaps above and below. flexGrow:0 makes the rail hug its content
  // height so it sits snugly under the type pills.
  topicRailScroll: {
    flexGrow: 0,
  },
  // Horizontal topic rail (a ScrollView contentContainerStyle). Shares the
  // filter row's gutter; bottom padding separates it from the list.
  topicRail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: theme.colors.textSecondary,
  },
  emptyHint: {
    fontSize: 12,
    color: theme.colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },
  errorText: {
    fontSize: 13,
    color: theme.colors.accentError,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 6,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 100,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  retryBtnText: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    fontWeight: '500',
  },
  fab: {
    position: 'absolute',
    right: 18,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.colors.accentSuccess,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: isDark ? 0.5 : 0.18,
    shadowRadius: 8,
    elevation: 6,
  },
});
