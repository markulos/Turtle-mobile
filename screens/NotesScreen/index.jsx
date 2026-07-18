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
  Image,
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
  Linking,
  Modal,
} from 'react-native';
// expo-image for the link card's remote thumbnail (disk+memory cache + a soft
// fade-in), aliased so it doesn't clash with the RN <Image> used by NoteRow.
import { Image as ExpoImage } from 'expo-image';
// expo-video powers WhatsApp-style inline playback for shared DIRECT video links
// (.mp4/.mov/.webm). Embed-only sources (YouTube/Vimeo/TikTok) can't be streamed
// straight, so those open in their native app on tap instead.
import { useVideoPlayer, VideoView } from 'expo-video';
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
  withSpring,
  runOnJS,
  Easing as REasing,
} from 'react-native-reanimated';
// Composer pull-down-to-dismiss. The composer is IN-TREE (not a Modal), so the
// app's root GestureHandlerRootView already feeds this detector.
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../context/ThemeContext';
import { useServer } from '../../context/ServerContext';
import { useClaudeQueue } from '../../context/ClaudeQueueContext';
import { keyboardScrollProps } from '../../components/KeyboardSafeView';
import { tapHaptic, impactHaptic } from '../../utils/haptics';
// Tier-3 fuzzy fallback (trigram/Dice) for the header search — mirrors web.
import { fuzzyRank } from '../../utils/trigram';

const FILTER_ALL = 'all';
const FILTER_NOTE = 'note';
const FILTER_TODO = 'todo';
// Left-to-right page order for the swipeable tabs.
const FILTER_ORDER = [FILTER_ALL, FILTER_NOTE, FILTER_TODO];
// Sentinel topic for notes that carry no tags (shown as its own "Untagged" chip).
const UNTAGGED = '__untagged__';

// Composer modes. 'feedback' persists as a to-do but auto-stamps an app tag
// ("Turtle App" / "Turtle 3D") + a platform tag (Turtle App only) so the cue
// rides along when the to-do is handed to the Claude session.
const APP_TAGS = { 'turtle-app': 'Turtle App', 'turtle-3d': 'Turtle 3D' };
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

// The searchable board/topic universe: every tag PREFIX level gets its own
// entry ('a/b/c' yields 'a', 'a/b', 'a/b/c' — a note counts once per level it
// touches), then boards from the server's projects list that no note carries
// yet are merged in at count 0 (board = project = topic — interchangeable, so
// a brand-new board is still findable and selectable from Notes).
function buildSearchEntries(notes, boards) {
  const counts = new Map(); // full topic path -> notes touching it
  for (const n of notes) {
    const tags = Array.isArray(n.tags) ? n.tags : [];
    const seen = new Set();
    for (const tag of tags) {
      const parts = String(tag).split('/').map((s) => s.trim()).filter(Boolean);
      let path = '';
      for (const p of parts) {
        path = path ? `${path}/${p}` : p;
        if (seen.has(path)) continue;
        seen.add(path);
        counts.set(path, (counts.get(path) || 0) + 1);
      }
    }
  }
  const entries = Array.from(counts.entries())
    .map(([topic, count]) => ({ topic, count, sub: topic.includes('/') }));
  const have = new Set(entries.map((e) => e.topic.toLowerCase()));
  for (const b of Array.isArray(boards) ? boards : []) {
    const name = String(b || '').trim();
    if (name && !have.has(name.toLowerCase())) {
      have.add(name.toLowerCase());
      entries.push({ topic: name, count: 0, board: true });
    }
  }
  entries.sort((a, b) => a.topic.toLowerCase().localeCompare(b.topic.toLowerCase()));
  return entries;
}

// Everything-style instant matcher: case-insensitive, multi-term AND over
// headline + description + tags. Mirror of web matchesNoteSearch — this is
// Tier 1 (the client's already-loaded page of notes); Tier 2 is the server
// FTS merge and Tier 3 is the trigram fuzzy fallback, both wired below.
function matchesNoteSearch(n, query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const hay = `${n.content || ''} ${n.description || ''} ${(n.tags || []).join(' ')}`.toLowerCase();
  return terms.every((t) => hay.includes(t));
}

// ── Shared-link note helpers ────────────────────────────────
// A share-to-Turtle of a URL lands as a note whose `content` IS the bare URL
// (the server unfurls it asynchronously into title/description/thumbnail). We
// detect that shape here to render a rich media card instead of a plain row.
const URL_RE = /^https?:\/\/\S+$/i;
function isSingleUrl(s) {
  const t = String(s || '').trim();
  return URL_RE.test(t) && !/\s/.test(t);
}
// A note is a "link card" when it's a plain note (not a to-do — those keep their
// checkbox row) whose whole body is a single URL.
function isLinkNote(note) {
  return note && (note.type || 'note') !== 'todo' && isSingleUrl(note.content);
}
function hostOf(url) {
  try { return new URL(String(url)).hostname.replace(/^www\./, ''); } catch { return ''; }
}
// Classify the media behind a URL so the card knows whether to show a play
// affordance, and whether it can play inline (direct file) or must hand off to
// the source app (embed-only platforms).
function classifyMedia(url) {
  const u = String(url || '').toLowerCase();
  if (/\.(mp4|mov|webm|m4v)(\?|#|$)/.test(u)) return 'video-direct';
  if (/(youtube\.com\/(watch|shorts|embed)|youtu\.be\/)/.test(u)) return 'video';
  if (/vimeo\.com\/\d/.test(u)) return 'video';
  if (/(tiktok\.com\/|instagram\.com\/(reel|p|tv)\/)/.test(u)) return 'video';
  if (/(facebook\.com\/(reel|watch|share\/r|[^/]+\/videos)|fb\.watch\/)/.test(u)) return 'video';
  return 'link';
}
// A recognisable glyph for the source (drawn on the host chip).
function sourceIcon(url) {
  const u = String(url || '').toLowerCase();
  if (/youtube\.com|youtu\.be/.test(u)) return 'youtube';
  if (/vimeo\.com/.test(u)) return 'vimeo';
  if (/tiktok\.com/.test(u)) return 'music-note';
  if (/instagram\.com/.test(u)) return 'instagram';
  if (/(facebook\.com|fb\.watch)/.test(u)) return 'facebook';
  if (/(twitter\.com|x\.com)/.test(u)) return 'twitter';
  if (/spotify\.com/.test(u)) return 'spotify';
  return 'web';
}

// ── Sharer byline ───────────────────────────────────────────
// Avatar + name of who shared/created a note, shown automatically at the top
// of every card (the server stamps notes.user_id at creation and owner-
// backfills legacy rows, so every note carries a sharer). No avatar → the
// user's initial on their stable per-user colour (the same userId→hue hash the
// tasks calendar and FilterMenu swatches use, so a person's colour matches
// across surfaces).
const sharerColor = (userId) => {
  if (!userId) return '#888888';
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) % 360;
  return `hsl(${h}, 60%, 52%)`;
};
function SharedByLine({ note, style }) {
  const { theme } = useTheme();
  const { getBaseUrl } = useServer();
  const sharer = note && note.sharedBy;
  if (!sharer || (!sharer.name && !sharer.avatarUrl)) return null;
  // avatar_url is a relative server path (/api/avatars/<id>.jpg?v=…) — resolve
  // it to an absolute URI the same way the link thumbnails do.
  const avatarUri = sharer.avatarUrl
    ? (/^https?:\/\//i.test(sharer.avatarUrl)
        ? sharer.avatarUrl
        : `${getBaseUrl().replace('/api', '')}${sharer.avatarUrl}`)
    : null;
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 6 }, style]}>
      {avatarUri ? (
        <ExpoImage
          source={{ uri: avatarUri }}
          style={{ width: 18, height: 18, borderRadius: 9 }}
          contentFit="cover"
          transition={120}
        />
      ) : (
        <View
          style={{
            width: 18, height: 18, borderRadius: 9,
            backgroundColor: sharerColor(sharer.userId),
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>
            {String(sharer.name || '?').trim().charAt(0).toUpperCase()}
          </Text>
        </View>
      )}
      <Text
        numberOfLines={1}
        style={{ flexShrink: 1, fontSize: 11.5, fontWeight: '600', color: theme.colors.textSecondary }}
      >
        {sharer.name || 'Member'}
      </Text>
    </View>
  );
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
  // Board/topic search sheet (magnify chip at the head of the topic rail).
  const [topicSearchOpen, setTopicSearchOpen] = useState(false);
  // Boards from the server's projects list (board = project = topic), merged
  // into the search sheet so boards with no notes yet are still selectable.
  const [boards, setBoards] = useState([]);
  const [composerOpen, setComposerOpen] = useState(false);
  // The note currently being edited (null = the composer is in "create" mode).
  const [editingNote, setEditingNote] = useState(null);

  // Header search (top-right magnify → expandable bar). `search` drives the
  // 3-tier live filter below; `serverMatches` holds the Tier-2 FTS results for
  // the current query; `noteIndex` is the Tier-1/3 client-side index (id+text
  // over ALL notes, not just the loaded page) fetched once on mount.
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [serverMatches, setServerMatches] = useState([]);
  const noteIndex = useRef([]);
  const searchInputRef = useRef(null);

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

  // Boards fetch — on connect, because the rail now mirrors the tasks tab's
  // board list 1:1 (not just note-derived topics). Kept in the deps:
  // topicSearchOpen, so opening the sheet refreshes it; it's one tiny GET.
  useEffect(() => {
    if (!isConnected) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await api.get('/projects');
        if (!cancelled && Array.isArray(r)) {
          setBoards(r.filter((n) => typeof n === 'string' && n.trim()));
        }
      } catch { /* rail + sheet still work from note tags alone */ }
    })();
    return () => { cancelled = true; };
  }, [topicSearchOpen, isConnected, api]);

  // Tier 1 index (all notes' text, not just the loaded page) — instant client
  // filter across every note the account has, fetched once on mount.
  useEffect(() => {
    if (!isConnected) return;
    api.get('/turtle/notes/index')
      .then((r) => { noteIndex.current = r.index || []; })
      .catch(() => {});
  }, [isConnected, api]);

  // Tier 2 debounced server FTS — catches matches beyond the loaded page.
  useEffect(() => {
    const q = search.trim();
    if (!q) { setServerMatches([]); return; }
    // Don't fire a doomed request while disconnected — leave serverMatches
    // empty so the Tier-3 fuzzy fallback still gets a chance over the index.
    if (!isConnected) { setServerMatches([]); return; }
    const h = setTimeout(() => {
      api.get(`/turtle/notes/search?q=${encodeURIComponent(q)}`)
        .then((r) => setServerMatches(r.notes || []))
        .catch(() => setServerMatches([]));
    }, 300);
    return () => clearTimeout(h);
  }, [search, api, isConnected]);

  // Rail chips = note-derived topics MERGED with every server board (count 0
  // while no note carries it yet) — so the Notes rail lists the same boards
  // the tasks tab does, browsable before their first note.
  const railTopics = useMemo(() => {
    const have = new Set(topicTree.topics.map((t) => t.topic));
    const extras = boards
      .filter((b) => !have.has(b))
      .map((b) => ({ topic: b, count: 0 }));
    if (extras.length === 0) return topicTree.topics;
    return [...topicTree.topics, ...extras]
      .sort((a, b) => a.topic.toLowerCase().localeCompare(b.topic.toLowerCase()));
  }, [topicTree, boards]);

  // Create a board (project) from the topic search sheet. Optimistic: the
  // chip appears + filters immediately; the POST persists in the background
  // and rolls back on failure. '/' is refused — it's the sub-topic separator.
  const createBoardFromSearch = useCallback((name) => {
    const trimmed = String(name || '').trim();
    if (!trimmed || trimmed.includes('/')) return;
    setTopicSearchOpen(false);
    setBoards((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    setSelectedTopic(trimmed);
    api.post('/projects/add', { name: trimmed }).catch(() => {
      setBoards((prev) => prev.filter((b) => b !== trimmed));
      setSelectedTopic((cur) => (cur === trimmed ? null : cur));
    });
  }, [api]);

  // Full searchable universe for the sheet: tag prefixes + server boards.
  const searchEntries = useMemo(
    () => (topicSearchOpen ? buildSearchEntries(notes, boards) : []),
    [topicSearchOpen, notes, boards],
  );

  // Header search — Everything-style 3-tier live filter. No query → every
  // loaded note. Otherwise: Tier 1 (instant substring match over the loaded
  // page) UNION Tier 2 (server FTS results, which can include notes beyond the
  // loaded page/limit) deduped by id. If that union is empty, fall back to
  // Tier 3 — trigram/Dice fuzzy ranking over the full noteIndex, mapped back
  // to whatever note objects are on hand (loaded page first, then serverMatches).
  const visibleNotes = useMemo(() => {
    const q = search.trim();
    if (!q) return notes;
    const byId = new Map();
    for (const n of notes) if (matchesNoteSearch(n, q)) byId.set(n.id, n);
    for (const n of serverMatches) if (!byId.has(n.id)) byId.set(n.id, n);
    if (byId.size > 0) return Array.from(byId.values());
    // Tier 3 fallback. KNOWN LIMITATION: fuzzyRank ranks ids over the FULL
    // noteIndex (every note), but we can only RENDER a note we actually have
    // in hand — the loaded page + serverMatches. Tier 3 only runs when Tier 2
    // returned zero hits, so serverMatches is empty here too, making the pool
    // effectively just the loaded page (limit=200). A fuzzy candidate whose id
    // falls outside that page ranks but has no Note object to render, so it's
    // silently dropped. Left as-is rather than adding an id-fetch — acceptable
    // for the current small-notes quick-capture scale; revisit with an
    // id-fetch endpoint if notes volume grows large.
    const ids = new Set(fuzzyRank(q, noteIndex.current));
    if (ids.size === 0) return [];
    const pool = new Map();
    for (const n of notes) pool.set(n.id, n);
    for (const n of serverMatches) pool.set(n.id, n);
    return Array.from(ids).map((id) => pool.get(id)).filter(Boolean);
  }, [notes, search, serverMatches]);

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
  // Per-page list: search filter (Tier 1-3, see visibleNotes) + the type
  // filter + the active topic filter. Notes are few.
  const listFor = useCallback((filterKey) => {
    let list = visibleNotes;
    if (filterKey !== FILTER_ALL) list = list.filter((n) => (n.type || 'note') === filterKey);
    if (selectedTopic === UNTAGGED) {
      list = list.filter((n) => !Array.isArray(n.tags) || n.tags.length === 0);
    } else if (selectedTopic) {
      const sel = selectedTopic;
      list = list.filter((n) => Array.isArray(n.tags)
        && n.tags.some((t) => t === sel || String(t).startsWith(sel + '/')));
    }
    return list;
  }, [visibleNotes, selectedTopic]);
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
          isLinkNote(item) ? (
            // Shared-link / media note → the rich WhatsApp-style card. Tapping the
            // card opens the original; a pencil opens the composer to edit the
            // (auto-unfurled) description.
            <LinkNoteCard
              note={item}
              onEdit={openEditNote}
              onLongPress={showNoteActions}
              theme={theme}
              isDark={isDark}
            />
          ) : (
            <NoteRow
              note={item}
              onPress={openEditNote}
              onToggleDone={toggleDone}
              onLongPress={showNoteActions}
              onSendToClaude={sendTodoToClaude}
              theme={theme}
              isDark={isDark}
            />
          )
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
        {/* Breadcrumb: when a topic is selected, "Notes / <topic>" with the
            topic name in a hairline-thin weight next to the bold "Notes". */}
        {selectedTopic && (
          <Text style={styles.titleTopic} numberOfLines={1}>
            / {selectedTopic === UNTAGGED ? 'Untagged' : selectedTopic}
          </Text>
        )}
        <Text style={styles.titleCount}>{counts.all}</Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          onPress={() => {
            const next = !searchOpen;
            setSearchOpen(next);
            if (!next) setSearch('');
            else setTimeout(() => searchInputRef.current?.focus?.(), 50);
          }}
          accessibilityLabel="Search notes and to-dos"
          accessibilityRole="button"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.headerSearchBtn}
        >
          <Icon name="magnify" size={22} color={theme.colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Expandable search bar — Everything-style live filter over the current
          tab/topic view; see visibleNotes + matchesNoteSearch above. */}
      {searchOpen && (
        <View style={[styles.searchBar, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
          <Icon name="magnify" size={18} color={theme.colors.textMuted} />
          <TextInput
            ref={searchInputRef}
            style={[styles.searchInput, { color: theme.colors.textPrimary }]}
            value={search}
            onChangeText={setSearch}
            placeholder="Search notes & to-dos"
            placeholderTextColor={theme.colors.textMuted}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Icon name="close" size={18} color={theme.colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      )}

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
          tagged or untagged notes to browse. Tapping the active chip clears it.
          The magnify chip at the head opens the searchable board/topic picker. */}
      {(railTopics.length > 0 || topicTree.untagged > 0) && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.topicRailScroll}
          contentContainerStyle={styles.topicRail}
          keyboardShouldPersistTaps="handled"
        >
          <TouchableOpacity
            onPressIn={() => tapHaptic()}
            onPress={() => setTopicSearchOpen(true)}
            style={styles.topicSearchChip}
            accessibilityLabel="Search boards and topics"
            accessibilityRole="button"
          >
            <Icon name="magnify" size={16} color={theme.colors.accentInfo} />
          </TouchableOpacity>
          <TopicChip
            label="All Topics"
            active={selectedTopic === null}
            onPress={() => setSelectedTopic(null)}
            theme={theme}
            isDark={isDark}
          />
          {/* A picked sub-topic ('a/b') or notes-less board isn't a rail parent —
              surface the selection as its own clearable chip so it's never
              invisible. Parents highlight for their sub-topics too. */}
          {selectedTopic && selectedTopic !== UNTAGGED
            && !railTopics.some(({ topic }) => topic === selectedTopic) && (
            <TopicChip
              label={selectedTopic}
              active
              onPress={() => setSelectedTopic(null)}
              theme={theme}
              isDark={isDark}
            />
          )}
          {railTopics.map(({ topic, count }) => (
            <TopicChip
              key={topic}
              label={topic}
              // Hide the badge on note-less boards — the chip reads as just
              // the board name instead of a noisy "0".
              count={count || undefined}
              active={selectedTopic === topic || (selectedTopic || '').startsWith(topic + '/')}
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
        onPressIn={() => tapHaptic()}
        onPress={() => { setEditingNote(null); setComposerOpen(true); }}
        activeOpacity={0.85}
      >
        <Icon name="plus" size={28} color={isDark ? '#000' : '#fff'} />
      </TouchableOpacity>

      {/* Board/topic search — full-screen picker over every topic, sub-topic
          and server board; selecting filters the list like a rail chip tap. */}
      <TopicSearchSheet
        visible={topicSearchOpen}
        entries={searchEntries}
        totalNotes={notes.length}
        untagged={topicTree.untagged}
        selectedTopic={selectedTopic}
        onSelect={(topic) => { setSelectedTopic(topic); setTopicSearchOpen(false); }}
        onCreate={createBoardFromSearch}
        onClose={() => setTopicSearchOpen(false)}
        theme={theme}
        isDark={isDark}
      />

      {/* Composer — create OR edit (initialNote drives which). A new capture
          inherits the ACTIVE topic (board) as a pre-seeded, removable tag chip
          — app-wide rule: sub-elements created under an active board belong
          to it. */}
      <ComposerModal
        visible={composerOpen}
        initialNote={editingNote}
        activeTopic={selectedTopic && selectedTopic !== UNTAGGED ? selectedTopic : null}
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
  // Active = a soft accentInfo tint (mobile has NO accentPrimary; accentInfo is
  // the blue we use, kept distinct from the green accentSuccess on the type pills).
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 30,
    borderRadius: 15,
    backgroundColor: theme.colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  chipActive: {
    backgroundColor: theme.colors.accentInfo + (isDark ? '2E' : '1F'),
    borderColor: theme.colors.accentInfo + '66',
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
    color: theme.colors.textSecondary,
    maxWidth: 160,
  },
  labelActive: {
    color: theme.colors.accentInfo,
    fontWeight: '600',
  },
  count: {
    fontSize: 11,
    fontWeight: '600',
    color: theme.colors.textMuted,
  },
  countActive: {
    color: theme.colors.accentInfo,
  },
});

// ── Board/topic search sheet ────────────────────────────────
// Full-screen searchable picker over the whole board/topic universe: every
// tag prefix level (topics AND sub-topics, with live note counts) plus server
// boards that carry no notes yet. Top-anchored input, so the keyboard never
// covers it — no keyboard-sync machinery needed. Selecting behaves exactly
// like tapping a rail chip (prefix-matching filter), then the sheet closes.
function TopicSearchSheet({ visible, entries, totalNotes, untagged, selectedTopic, onSelect, onCreate, onClose, theme, isDark }) {
  const [q, setQ] = useState('');
  const s = useMemo(() => topicSearchStyles(theme, isDark), [theme, isDark]);
  // Inset via the hook, NOT <SafeAreaView>: the native SafeAreaView measures
  // the Modal's own window and resolves to 0 there, putting the search bar
  // under the notch. The hook reads the root provider through the React tree,
  // which stays correct inside Modals (same pattern as ConversationsOverlay).
  const insets = useSafeAreaInsets();

  // Fresh query every open — reopening shouldn't resurrect a stale filter.
  useEffect(() => { if (visible) setQ(''); }, [visible]);

  const needle = q.trim().toLowerCase();
  const matches = needle
    ? entries.filter((e) => e.topic.toLowerCase().includes(needle))
    : entries;
  const showAll = !needle || 'all topics'.includes(needle);
  const showUntagged = untagged > 0 && (!needle || 'untagged'.includes(needle));

  // "Create board" appears whenever the typed name isn't already a board or
  // topic (and is a legal board name — no '/', that's the sub-topic
  // separator). Selecting it creates the project optimistically upstream.
  const createName = q.trim();
  const canCreate = !!createName
    && !createName.includes('/')
    && !entries.some((e) => e.topic.toLowerCase() === createName.toLowerCase());

  const rows = [
    ...(showAll ? [{ key: '__all__', label: 'All Topics', icon: 'asterisk', count: totalNotes, value: null }] : []),
    ...matches.map((e) => ({
      key: e.topic,
      label: e.topic,
      icon: e.board ? 'folder-outline' : e.sub ? 'subdirectory-arrow-right' : 'pound',
      count: e.count,
      value: e.topic,
    })),
    ...(showUntagged ? [{ key: UNTAGGED, label: 'Untagged', icon: 'tag-off-outline', count: untagged, value: UNTAGGED }] : []),
    ...(canCreate ? [{ key: '__create__', label: `Create board "${createName}"`, icon: 'plus-circle-outline', count: '', create: true, name: createName }] : []),
  ];

  return (
    // pageSheet = native iOS card presentation: swipe the sheet down to close
    // (fires onRequestClose), exactly like every stock iOS modal. Android
    // renders it full-screen, so it keeps the real status-bar inset.
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={s.root}>
        <View style={[s.searchRow, { paddingTop: Platform.OS === 'android' ? insets.top + 14 : 14 }]}>
          <View style={s.searchBox}>
            <Icon name="magnify" size={20} color={theme.colors.accentInfo} />
            <TextInput
              style={s.searchInput}
              placeholder="Search boards & topics"
              placeholderTextColor={theme.colors.textMuted}
              value={q}
              onChangeText={setQ}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
            {q.length > 0 && (
              <TouchableOpacity onPress={() => setQ('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Icon name="close-circle" size={18} color={theme.colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
            <Text style={s.cancel}>Cancel</Text>
          </TouchableOpacity>
        </View>

        {rows.length === 0 ? (
          <View style={s.empty}>
            <Icon name="tag-search-outline" size={36} color={theme.colors.textMuted} />
            <Text style={s.emptyText}>No boards or topics match "{q.trim()}".</Text>
          </View>
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(r) => r.key}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={{ paddingBottom: 32 }}
            renderItem={({ item }) => {
              const active = !item.create && selectedTopic === item.value;
              return (
                <TouchableOpacity
                  onPressIn={() => tapHaptic()}
                  onPress={() => (item.create ? onCreate?.(item.name) : onSelect(item.value))}
                  style={[s.row, active && s.rowActive]}
                  accessibilityRole="button"
                  accessibilityLabel={item.create ? item.label : `Filter by ${item.label}`}
                >
                  <View style={[s.rowIcon, active && s.rowIconActive]}>
                    <Icon
                      name={item.icon}
                      size={16}
                      color={item.create ? theme.colors.accentInfo : active ? theme.colors.accentInfo : theme.colors.textSecondary}
                    />
                  </View>
                  <Text
                    style={[s.rowLabel, (active || item.create) && s.rowLabelActive]}
                    numberOfLines={1}
                  >
                    {item.label}
                  </Text>
                  <Text style={s.rowCount}>{item.count}</Text>
                  {active && <Icon name="check" size={18} color={theme.colors.accentInfo} />}
                </TouchableOpacity>
              );
            }}
          />
        )}
      </View>
    </Modal>
  );
}

const topicSearchStyles = (theme, isDark) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  // paddingTop comes inline: insets.top (notch clearance) + breathing room.
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    height: 42,
    borderRadius: 12,
    backgroundColor: theme.colors.surface,
    borderWidth: 1.5,
    borderColor: theme.colors.accentInfo + '55',
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: theme.colors.textPrimary,
    paddingVertical: 0,
  },
  cancel: {
    fontSize: 15,
    fontWeight: '500',
    color: theme.colors.accentInfo,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  rowActive: {
    backgroundColor: theme.colors.accentInfo + (isDark ? '14' : '0D'),
  },
  rowIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
  },
  rowIconActive: {
    backgroundColor: theme.colors.accentInfo + '22',
  },
  rowLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: theme.colors.textPrimary,
  },
  rowLabelActive: {
    color: theme.colors.accentInfo,
    fontWeight: '600',
  },
  rowCount: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.textMuted,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 32,
  },
  emptyText: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    textAlign: 'center',
  },
});

// ── Note row ────────────────────────────────────────────────
function NoteRowImpl({ note, onPress, onToggleDone, onLongPress, onSendToClaude, theme, isDark }) {
  const isTodo = note.type === 'todo';
  const isDone = !!note.done;
  const styles = noteRowStyles(theme, isDark);
  const { getBaseUrl } = useServer();
  // A shared-link note has a cached preview thumbnail (relative server path);
  // resolve it to an absolute URI — getBaseUrl() ends in /api, strip that first.
  const thumbUri = note.thumbUrl
    ? (/^https?:\/\//i.test(note.thumbUrl)
        ? note.thumbUrl
        : `${getBaseUrl().replace('/api', '')}${note.thumbUrl}`)
    : null;
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
          onPressIn={() => tapHaptic()}
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
        {/* Who shared it — automatic avatar + name at the top of the card. */}
        <SharedByLine note={note} style={{ marginBottom: 4 }} />
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
        {thumbUri ? (
          <Image source={{ uri: thumbUri }} style={styles.linkThumb} resizeMode="cover" />
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
          onPressIn={() => impactHaptic('medium')}
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
  // Cached link-preview thumbnail for a shared-link note.
  linkThumb: {
    marginTop: 6,
    width: '100%',
    height: 110,
    borderRadius: 8,
    backgroundColor: theme.colors.surfaceElevated,
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

// ── Link / media card ───────────────────────────────────────
// The "special card" for a shared-link note: a big thumbnail (with a play
// overlay for video sources), the unfurled headline + description, the source
// host, and two actions — open the original, or edit the description. This is
// the mobile answer to WhatsApp's rich link preview.
//
// Inline playback rules (best-effort, honest about platform limits):
//   • DIRECT video files (.mp4/.mov/.webm) → play right in the card via
//     expo-video when the play button is tapped.
//   • Embed-only sources (YouTube/Vimeo/TikTok/Instagram) can't be streamed
//     from their page URL, so tapping opens them in their native app — exactly
//     what WhatsApp does for a YouTube link.
function InlineVideo({ uri, style }) {
  // A dedicated component so useVideoPlayer only ever instantiates a decoder for
  // a card the user actually pressed play on (mounted on demand), never for the
  // whole list. Native controls give scrub / pause / fullscreen for free.
  const player = useVideoPlayer(uri, (p) => {
    try { p.loop = false; p.play(); } catch (_) { /* player may not be ready */ }
  });
  return (
    <VideoView style={style} player={player} contentFit="contain" nativeControls />
  );
}

function LinkNoteCardImpl({ note, onEdit, onLongPress, theme, isDark }) {
  const styles = linkCardStyles(theme, isDark);
  const { getBaseUrl } = useServer();
  const url = String(note.content || '').trim();
  const media = classifyMedia(url);
  // The backend resolves a shared link to a directly-playable video FILE
  // (note.videoUrl) whenever it can — that's what plays inline via expo-video.
  // An embed-only source (YouTube/Facebook, note.embedUrl) can't be streamed
  // without a WebView, so those hand off to the source app (as WhatsApp does on
  // mobile). A URL that merely *looks* like a video keeps the ▶ until the async
  // unfurl lands (or fails to find) a playable file.
  const playableFile = note.videoUrl || (media === 'video-direct' ? url : null);
  const isVideo = !!playableFile || note.mediaType === 'video' || media === 'video' || media === 'video-direct';
  const host = hostOf(url) || note.siteName || '';
  // Headline: prefer the unfurled og:title, then the site name, then the bare
  // host — never leave the card showing a naked URL as its title.
  const title = (note.title && note.title.trim())
    || (note.siteName && note.siteName.trim())
    || host
    || url;
  // Resolve the cached thumbnail (relative server path) to an absolute URI, the
  // same way NoteRow does — getBaseUrl() ends in /api, strip that first.
  const thumbUri = note.thumbUrl
    ? (/^https?:\/\//i.test(note.thumbUrl)
        ? note.thumbUrl
        : `${getBaseUrl().replace('/api', '')}${note.thumbUrl}`)
    : null;

  const [playing, setPlaying] = useState(false);

  const openOriginal = useCallback(() => {
    impactHaptic('light');
    Linking.openURL(url).catch(() => Alert.alert('Could not open link', url));
  }, [url]);

  // Tap the media: a playable file plays inline; anything else (embed-only video
  // or a plain link) opens the source app.
  const onMediaPress = useCallback(() => {
    if (playableFile) { impactHaptic('light'); setPlaying(true); return; }
    openOriginal();
  }, [playableFile, openOriginal]);

  return (
    <View style={styles.card}>
      {/* Who shared it — automatic avatar + name strip at the top of the card
          (above the media, like a social post header). */}
      <SharedByLine note={note} style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8 }} />
      {/* Media region — thumbnail, inline player, or a graceful fallback while
          the unfurl is still pending (no thumb yet). */}
      <TouchableOpacity
        activeOpacity={0.92}
        onPress={onMediaPress}
        onLongPress={() => onLongPress(note)}
        delayLongPress={350}
      >
        <View style={styles.mediaWrap}>
          {playing && playableFile ? (
            <InlineVideo uri={playableFile} style={styles.media} />
          ) : thumbUri ? (
            <ExpoImage
              source={{ uri: thumbUri }}
              style={styles.media}
              contentFit="cover"
              transition={160}
            />
          ) : (
            <View style={[styles.media, styles.mediaFallback]}>
              <Icon
                name={isVideo ? 'play-circle-outline' : 'link-variant'}
                size={34}
                color={theme.colors.textMuted}
              />
            </View>
          )}

          {/* Play overlay — shown for any video source until it's playing. */}
          {isVideo && !playing && (
            <View pointerEvents="none" style={styles.playOverlay}>
              <View style={styles.playBtn}>
                <Icon name="play" size={26} color="#fff" style={{ marginLeft: 2 }} />
              </View>
            </View>
          )}

          {/* Source chip — sits on the media, bottom-left, like a platform badge. */}
          {!!host && (
            <View pointerEvents="none" style={styles.hostChip}>
              <Icon name={sourceIcon(url)} size={11} color="#fff" />
              <Text style={styles.hostChipText} numberOfLines={1}>{host}</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>

      {/* Text region — headline + description; tapping opens the original. */}
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={openOriginal}
        onLongPress={() => onLongPress(note)}
        delayLongPress={350}
        style={styles.textWrap}
      >
        <Text style={styles.title} numberOfLines={2}>{title}</Text>
        {note.description ? (
          <Text style={styles.desc} numberOfLines={3}>{note.description}</Text>
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

        <View style={styles.footer}>
          <Text style={styles.timestamp}>{formatRelativeTime(note.createdAt)}</Text>
          <View style={styles.actions}>
            {/* Edit — opens the composer to add to / rewrite the description that
                was auto-created from the link's metadata. */}
            <TouchableOpacity
              onPressIn={() => tapHaptic()}
              onPress={() => onEdit(note)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={styles.actionBtn}
              accessibilityLabel="Edit description"
            >
              <Icon name="pencil-outline" size={17} color={theme.colors.textSecondary} />
            </TouchableOpacity>
            {/* Open the original link. */}
            <TouchableOpacity
              onPressIn={() => tapHaptic()}
              onPress={openOriginal}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={styles.actionBtn}
              accessibilityLabel="Open original"
            >
              <Icon name="open-in-new" size={17} color={theme.colors.accentInfo} />
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    </View>
  );
}

// Memoized on the same terms as NoteRow — re-render only when the note object or
// the colour scheme changes, not on every screen re-render.
const LinkNoteCard = React.memo(LinkNoteCardImpl, (prev, next) =>
  prev.note === next.note && prev.isDark === next.isDark,
);

const linkCardStyles = (theme, isDark) => StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    overflow: 'hidden',
  },
  mediaWrap: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: theme.colors.surfaceElevated,
    position: 'relative',
  },
  media: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  mediaFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBtn: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hostChip: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: '80%',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  hostChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#fff',
    letterSpacing: 0.2,
  },
  textWrap: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 12,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    lineHeight: 20,
  },
  desc: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    marginTop: 4,
    lineHeight: 18,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
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
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  timestamp: {
    fontSize: 10,
    color: theme.colors.textMuted,
    letterSpacing: 0.2,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionBtn: {
    padding: 6,
    borderRadius: 8,
  },
});

// ── Composer modal ──────────────────────────────────────────
function ComposerModal({ visible, initialNote, activeTopic = null, allTags = [], onClose, onSubmit, theme, isDark }) {
  const [content, setContent] = useState('');
  const [description, setDescription] = useState('');
  // Composer mode: 'note' | 'todo' | 'feedback'. To-do is the default for a new
  // capture; 'feedback' additionally reveals the platform selector below.
  const [mode, setMode] = useState('todo');
  const [app, setApp] = useState('turtle-app');
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
      setApp('turtle-app');
      setPlatform('web');
      // A fresh capture inherits the active topic (board) as a pre-selected
      // chip — visible and removable, so the inheritance is never silent.
      setTags(Array.isArray(initialNote?.tags)
        ? initialNote.tags.filter(Boolean)
        : (activeTopic ? [activeTopic] : []));
      setTagDraft('');
      setBusy(false);
    }
  }, [visible, initialNote, activeTopic]);

  // Open/close animation. Uses the iOS sheet-presentation curve
  // (cubic-bezier 0.32, 0.72, 0, 1) — the same deceleration the keyboard rises
  // on — so the card slide, the background fade, and the keyboard all feel like
  // one motion. Opening is a touch slower than closing, like a native sheet.
  const OPEN_EASING = REasing.bezier(0.32, 0.72, 0, 1);
  useEffect(() => {
    if (visible) {
      setMounted(true);
      reveal.value = 0;
      dragY.value = 0; // a previous pull-down must not offset the fresh open
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

  // Live pull-down offset (0 while parked). Folded into the same translateY as
  // the reveal + keyboard lift so all three motions share one compositor value.
  const dragY = useSharedValue(0);
  // Latest-close ref + stable trampoline so the (once-built) pan worklet never
  // captures a stale onClose.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const runComposerClose = useCallback(() => {
    Keyboard.dismiss();
    onCloseRef.current?.();
  }, []);
  // Pull the handle/header down to dismiss, iOS-sheet style. Commit past 100px
  // or a downward flick — the reveal close then takes over FROM the dragged
  // position (dragY deliberately isn't reset here; the open effect zeroes it).
  const handlePan = useMemo(() => Gesture.Pan()
    .activeOffsetY([-8, 8])
    .onUpdate((e) => {
      dragY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      // RNGH velocity is px/SECOND (PanResponder's vy is px/ms) — 600 here
      // ≈ the 0.6 px/ms flick threshold the PanResponder sheets use.
      if (e.translationY > 100 || e.velocityY > 600) {
        runOnJS(runComposerClose)();
      } else {
        dragY.value = withSpring(0, { damping: 22, stiffness: 220, mass: 0.9 });
      }
    }), [dragY, runComposerClose]);

  // Settled keyboard state on the JS thread — used ONLY to bound the scroll
  // area's height (below) so a long note can't shove the card's top (title,
  // mode toggles) off-screen with no way back. The smooth frame-for-frame lift
  // still rides the UI-thread shared value; this is just a height cap. iOS reads
  // the will* events so the cap is already in place as the sheet rises.
  const [kb, setKb] = useState({ visible: false, height: 0 });
  const kbVisibleRef = useRef(false);
  kbVisibleRef.current = kb.visible;
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s = Keyboard.addListener(showEvt, (e) => setKb({ visible: true, height: e.endCoordinates?.height || 0 }));
    const h = Keyboard.addListener(hideEvt, () => setKb({ visible: false, height: 0 }));
    return () => { s.remove(); h.remove(); };
  }, []);
  // Cap the scrollable body to the space left above the keyboard (minus a top
  // breathing gap and the fixed handle+header chrome). The body then SCROLLS its
  // full length inside that window instead of overflowing the card.
  const SHEET_CHROME = 96; // handle + header + sheet top padding, approx
  const TOP_GAP = 48;      // status bar + a little air above the card
  const scrollMaxHeight = Math.max(
    200,
    screenHeight - (kb.visible ? kb.height : 0) - TOP_GAP - SHEET_CHROME,
  );
  // Double-tap the card to TOGGLE the keyboard — closed → focus the note body,
  // open → dismiss. A quick, low-effort open/close that coexists with scrolling
  // (a scroll moves; a double-tap is stationary) and with the buttons (they
  // only need a single tap).
  const toggleKeyboard = useCallback(() => {
    if (kbVisibleRef.current) Keyboard.dismiss();
    else contentRef.current?.focus();
  }, []);
  const doubleTap = useMemo(() => Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(260)
    .onEnd(() => { 'worklet'; runOnJS(toggleKeyboard)(); }), [toggleKeyboard]);

  // The sheet's transform: closed slides it fully below the screen
  // ((1−reveal)·sheetHeight), and the keyboard lift raises it so its bottom edge
  // pins to the keyboard's top — both folded into ONE compositor-only translateY,
  // recomputed every keyboard frame on the UI thread. The live pull-down offset
  // rides on top.
  const sheetStyle = useAnimatedStyle(() => {
    'worklet';
    const lift = Math.max(keyboard.height.value - tabBarHeight, 0);
    return { transform: [{ translateY: (1 - reveal.value) * sheetH.value - lift + dragY.value }] };
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
      for (const t of [APP_TAGS[app], ...(app === 'turtle-app' ? [PLATFORM_TAGS[platform]] : [])]) {
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
        {/* Fixed drag zone: handle + title stay put (pull down here to close)
            while the body below scrolls independently. */}
        <GestureDetector gesture={handlePan}>
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
          </View>
        </GestureDetector>

        {/* Scrollable body — a long note scrolls its FULL length here instead of
            overflowing the card. Quick-scroll-down dismisses the keyboard
            (keyboardDismissMode); a double-tap toggles it; tapping empty space
            dismisses while still letting button taps through
            (keyboardShouldPersistTaps). */}
        <GestureDetector gesture={doubleTap}>
          <ScrollView
            style={{ maxHeight: scrollMaxHeight }}
            contentContainerStyle={styles.scrollBody}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            showsVerticalScrollIndicator={false}
          >
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

          {/* Feedback app — Turtle App vs Turtle 3D. Stamped as a tag so it cues
              the Claude session when the to-do is sent over. */}
          {mode === 'feedback' && (
            <View style={styles.typeToggle}>
              {[
                { key: 'turtle-app', label: 'Turtle App', icon: 'application' },
                { key: 'turtle-3d', label: 'Turtle 3D', icon: 'cube-outline' },
              ].map((opt) => {
                const active = app === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    onPress={() => setApp(opt.key)}
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

          {/* Platform sub-selector — only for the Turtle App (web vs mobile). */}
          {mode === 'feedback' && app === 'turtle-app' && (
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
                  nestedScrollEnabled
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
              onPressIn={() => impactHaptic('medium')}
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
          </ScrollView>
        </GestureDetector>
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
  // Scrollable body content — a hair of bottom padding so the Save row doesn't
  // sit flush against the sheet's bottom edge when the note is short.
  scrollBody: { paddingBottom: 4 },
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
  // Selected-topic breadcrumb next to the bold "Notes" — same size, hairline-
  // thin weight, softer colour; shrinks/ellipsizes so a long topic can't shove
  // the count off-screen.
  titleTopic: {
    flexShrink: 1,
    fontSize: 26,
    fontWeight: '200',
    color: theme.colors.textSecondary,
    letterSpacing: 0.2,
  },
  titleCount: {
    fontSize: 14,
    fontWeight: '500',
    color: theme.colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  // Top-right header search toggle (magnify → expandable bar below).
  headerSearchBtn: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 6, marginBottom: 4, paddingHorizontal: 12, height: 40, borderRadius: 12, borderWidth: 1 },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
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
  // Round magnify chip at the head of the rail — opens the board/topic search
  // sheet. Same height as the topic chips so the rail reads as one row.
  topicSearchChip: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.accentInfo + (isDark ? '24' : '16'),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.accentInfo + '55',
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
