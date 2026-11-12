import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, ActivityIndicator, StyleSheet, Pressable, Alert,
  Animated, Keyboard, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { LinearGradient } from 'expo-linear-gradient';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useSharedValue } from 'react-native-reanimated';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../../../context/ThemeContext';
import { useMusicPlayer } from '../../../context/MusicPlayerContext';
import { useServer } from '../../../context/ServerContext';
import { titleOf, sourceOf, resolveMediaUrl } from '../../../services/musicTrackMapper';
import { TAP_ONLY } from '../../../utils/pressBehavior';
import { tapHaptic } from '../../../utils/haptics';
import { sendOrQueue, subscribe as subscribeOfflineQueue, loadQueue } from '../../../services/offlineQueue';
import TrackActionsSheet from './TrackActionsSheet';
import EdgeSwipePage from './EdgeSwipePage';
import TimelineScrubber from './TimelineScrubber';
import TranscriptionPanel from '../../../components/TranscriptionPanel';
import FaceStack from '../../../components/FaceStack';
import FollowAlongTranscript from '../../../components/FollowAlongTranscript';
import { getResult, statusOfError } from '../../../services/transcriptions';
import { getRecordings, loadRecordings, subscribeRecordings } from '../../../services/transcriptionStore';
import {
  TRANSCRIBED_PLAYLIST, pendingRowForMedia, transcribedMediaIds, transcriptRowForMedia,
} from '../../../utils/transcriptionRecordings';
import { captionAt } from '../../../utils/followAlong';
import {
  VOICE_RECORDINGS_LABEL, VOICE_RECORDINGS_TAG, recordingCountLabel, recordingPlaylistIndex,
  tagsWithVoiceRecording, tagsWithoutVoiceRecording, isVoiceRecording, audioTags,
} from '../../../utils/voiceRecordings';
// The vault's ONE search: the same pill, the same lift, the same result rows
// the Boards and Files tabs use. Music had no search at all, which meant the
// only route to a track was to scroll the whole library.
import { VaultResultRow, VaultSearchDock, useVaultSearch, PICKER_GAP } from './VaultSearchDock';
import { rankTracks, trackCountLabel } from './trackSearch';
// …and the same field's OTHER scope: the web. The library is still the
// default; see services/webMusicSearch for what a web result is and why it
// plays through the pond rather than from YouTube.
import SearchScopeToggle from './SearchScopeToggle';
import MusicWebResultRow from './MusicWebResultRow';
import MusicWebResultSkeleton from './MusicWebResultSkeleton';
import PreparingRing from './PreparingRing';
import { preparingLabel } from '../../../services/preparingProgress';
import {
  LIBRARY_SCOPE, WEB_SCOPE, WEB_DEBOUNCE_MS,
  createRowWarmer, enqueueWebDownload, pondMessage, searchWebMusic, shouldSearchWeb,
  warmWebMusic, webPreviewRow, webRowId, webSearchStatus,
} from '../../../services/webMusicSearch';
import { SCROLL_INDICATOR } from '../../../utils/scrollIndicator';
import { useOfflineMusic } from '../../../utils/useOfflineMusic';
import { formatBytes } from '../../../services/musicOfflineStore';
import { rowOfflineAppearance } from './musicRowAppearance';

// Tags double as playlists for audio: the vault already models "a named group of
// media" as a tag, so a music playlist is just a tag on an audio row.
//
// The parser itself lives in utils/voiceRecordings, which has to read the same
// column to answer "is this a recording" — two parsers for one JSON string is
// how the playlist a track shows and the section it lands in start disagreeing.
const tagsOf = audioTags;

// The music player's single tint. `accent` is the user's chosen highlight
// colour, folded into the palette by ThemeContext — so the player follows
// whatever the rest of the app is tinted with instead of being permanently
// green. accentInfo is the same value (ThemeContext repoints it) and is the
// fallback for any theme that predates `accent`.
const MUSIC_TINT = (c) => c.accent || c.accentInfo || c.primary;

// Outbox key for a track rename — one pending rename per track, newest wins.
const renameKey = (id) => `media:${id}:originalName`;

// The two halves of the search field. "My library" leads because it is both
// the default and the common errand; the web is the thing you reach for when
// the library has already failed you.
const SEARCH_SCOPES = [
  { value: LIBRARY_SCOPE, label: 'My library', accessibilityLabel: 'Search my music library' },
  { value: WEB_SCOPE, label: 'Web', accessibilityLabel: 'Search the web for music' },
];

// "No web search is happening", as ONE value rather than a fresh object each
// time. The reset below returns this identity when it is already current, so
// React bails out instead of re-rendering — and a re-render of this page is
// not free: useFocusEffect refetches the library on each one.
const NO_WEB_SEARCH = { results: [], loading: false, error: null, searched: '' };

/**
 * When a row counts as being looked at.
 *
 * Half a row visible is "on screen" — a row the thumb is holding at the very
 * bottom edge is the next one you read. How long a scroll settles before the
 * pond hears about it is createRowWarmer's business.
 */
const VISIBLE_ROWS = { itemVisiblePercentThreshold: 50 };
const clearedWebSearch = (prev) => (
  prev.results.length || prev.loading || prev.error || prev.searched ? NO_WEB_SEARCH : prev
);

const fmtTime = (sec) => {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * topInset — height to clear at the top. As a page of the vault's pager the
 * component sits UNDER that screen's absolutely-positioned header (title + the
 * Boards/Music picker), so the caller passes the header's measured height plus
 * the gap; without it the first track cards render behind the picker.
 *
 * onClose — only supplied when MusicVault is pushed as its own screen. In the
 * pager there is nothing to go back to and the vault header already names the
 * page, so the internal back/title row is omitted.
 */
/**
 * Track order inside a playlist: by TITLE, read the way a person reads it.
 *
 * `numeric` is the whole point — plain string order puts "No10" before "No9",
 * because '1' sorts before '9' one character at a time. With it, the run of
 * digits is compared as a number, so No01 … No09, No10, No11 come out in the
 * order the names obviously mean. `sensitivity: 'base'` so case and accents do
 * not split a run either.
 *
 * A playlist arrives in whatever order the library handed it over, which is
 * newest-first — right for a library, wrong for a CD whose tracks are numbered.
 */
const byTitleNatural = (a, b) => String(titleOf(a) || '')
  .localeCompare(String(titleOf(b) || ''), undefined, { numeric: true, sensitivity: 'base' });

export default function MusicVault({
  onClose, topInset = 0, bottomInset = 0, chromePx, chromeScrollAnim,
  // Search, on the same contract the Boards and Files pages use: the query is
  // the vault's (so it survives a swipe away and back), and searchTopInset is
  // the bare safe area left once the vault header has stood down — the
  // difference between the two insets is how far this page lifts.
  query = '', onQueryChange, searchTopInset, onSearchActiveChange,
}) {
  const { theme, isDark } = useTheme();
  const c = theme.colors;
  const insets = useSafeAreaInsets();
  const {
    tracks,
    // Audio filed OUT of the library: it is not in `tracks`, so it is not in
    // the play-all queue either (MusicPlayerContext says why that is the right
    // place for the rule). Named apart from the transcription `recordings`
    // state below, which is a list of JOBS and a different thing entirely.
    // Defaulted: this page is mounted against a mocked provider in tests, and
    // a consumer that hard-crashes on an older provider shape is a consumer
    // that cannot be dropped into one.
    recordings: voiceRecordings = [],
    loading,
    ready,
    error,
    setupError,
    activeTrack,
    isPlaying,
    preparing,
    preparingPct,
    position,
    duration,
    playMedia,
    playRows,
    togglePlayback,
    previous,
    next,
    seekTo,
    refreshLibrary,
    retrySetup,
  } = useMusicPlayer();
  const { api, getBaseUrl, getMediaBaseUrl, isConnected } = useServer();
  // Ids removed locally by a delete that hasn't round-tripped yet. Deleting is
  // optimistic (app-wide rule): the row leaves the list on the tap and only
  // comes back if the server rejects it.
  const [removedIds, setRemovedIds] = useState(() => new Set());
  // Locally-applied renames, id → new originalName. Same optimistic rule as the
  // delete above: the new name is on screen the instant it's typed, the PATCH
  // rides behind it. Entries stay after the refresh lands (they then match the
  // server value, so there's no flash); only a failed write clears one.
  const [renamedNames, setRenamedNames] = useState(() => new Map());
  const visibleTracks = useMemo(() => {
    let list = removedIds.size ? tracks.filter((t) => !removedIds.has(String(t.id))) : tracks;
    if (renamedNames.size) {
      list = list.map((t) => {
        const next = renamedNames.get(String(t.id));
        return next && next !== t.originalName ? { ...t, originalName: next } : t;
      });
    }
    return list;
  }, [tracks, removedIds, renamedNames]);

  // Renames that are still sitting in the offline outbox are re-applied here on
  // mount — that's what makes an offline edit survive an app restart: the queue
  // entry IS the record of it, and the vault paints from it until it lands.
  // Merge-only (never removes): an entry leaving the queue means it was SENT,
  // and dropping the override in that instant would flash the old name back
  // before the library refresh arrives.
  useEffect(() => {
    loadQueue().catch(() => {});
    return subscribeOfflineQueue((entries) => {
      const parked = [];
      const parkedDeletes = [];
      entries.forEach((e) => {
        const rename = /^media:(.+):originalName$/.exec(e?.key || '');
        if (rename && e?.body?.originalName) parked.push([rename[1], e.body.originalName]);
        const del = /^media:(.+):delete$/.exec(e?.key || '');
        if (del) parkedDeletes.push(del[1]);
      });
      if (parked.length) {
        setRenamedNames((prev) => {
          const fresh = parked.filter(([id, name]) => prev.get(id) !== name);
          if (!fresh.length) return prev;
          const next = new Map(prev);
          fresh.forEach(([id, name]) => next.set(id, name));
          return next;
        });
      }
      // A delete parked before the app was killed: keep the row hidden rather
      // than resurrecting it for the seconds between launch and flush.
      if (parkedDeletes.length) {
        setRemovedIds((prev) => {
          const fresh = parkedDeletes.filter((id) => !prev.has(id));
          if (!fresh.length) return prev;
          const next = new Set(prev);
          fresh.forEach((id) => next.add(id));
          return next;
        });
      }
    });
  }, []);
  /**
   * The web result currently being previewed, if any.
   *
   * Declared up here with the rest of the page's state because `nowTrack`
   * below needs it, and a `const` referenced above its declaration is a TDZ
   * crash rather than an undefined. Set by previewWeb, further down.
   */
  const [previewRow, setPreviewRow] = useState(null);
  const current = visibleTracks.findIndex(
    (item) => String(item.id) === String(activeTrack?.mediaId)
  );
  /**
   * What the transport bar is for.
   *
   * The library first, by INDEX, exactly as before. The fallback is a web
   * preview: it is deliberately not in `visibleTracks` (nothing is kept, so
   * there is no row to be in), which left the one thing playing with no
   * pause button on the page — only the lock screen's.
   */
  const previewing = !!previewRow && String(previewRow.id) === String(activeTrack?.mediaId);
  const nowTrack = current >= 0 ? visibleTracks[current] : (previewing ? previewRow : null);
  // Skip walks the QUEUE, and a preview's queue is one track long. Derived
  // rather than read off `current` directly: at -1 (nothing of mine playing)
  // "next" would otherwise test as enabled and skip into silence.
  const canPrev = ready && current > 0;
  const canNext = ready && current >= 0 && current < visibleTracks.length - 1;
  // The same sentence the tapped ROW shows — built in one place, so one wait
  // cannot read as two different numbers on the same screen.
  const waitingLabel = preparingLabel(preparingPct);
  const barWidthRef = useRef(1);

  // The track whose "⋯" was tapped (null = sheet closed). Held by ID and
  // re-resolved from the live list, so a library refresh mid-sheet can't leave
  // the sheet acting on a stale row.
  const [sheetId, setSheetId] = useState(null);
  const [sheetBusy, setSheetBusy] = useState(false);
  const sheetTrack = useMemo(
    // The library first, then the recordings: the ⋯ menu is reachable from
    // inside the Voice recordings folder, and those tracks are deliberately
    // NOT in the library. Resolving against the library alone is how that menu
    // silently opens nothing — which would make the folder a one-way trip,
    // since "Move back to music" lives in it.
    () => visibleTracks.find((t) => String(t.id) === String(sheetId))
      || voiceRecordings.find((t) => String(t.id) === String(sheetId))
      || null,
    [visibleTracks, voiceRecordings, sheetId]
  );
  const closeSheet = useCallback(() => setSheetId(null), []);

  // Measured height of the pinned transport bar, used as the list's bottom
  // padding so the last track can always scroll clear of it. MEASURED, not a
  // constant: the bar is seek strip + times + controls + a dock-clearing
  // paddingBottom that varies with the device's safe area, and the 150pt guess
  // this replaced was ~80pt short — the final row sat under the player with no
  // way to scroll it out.
  const [nowBarH, setNowBarH] = useState(0);

  // ── A–Z scrub rail ─────────────────────────────────────────────────────────
  // The rail used to belong to the Boards page only, so swiping to Music left
  // you with no way to move through a few hundred tracks except flicking. Music
  // now carries its own, driven by this list's own scroll.
  const listRef = useRef(null);
  const musicContentH = useRef(0);
  const musicLayoutH = useRef(0);
  const musicScrollY = useSharedValue(0);
  // ── The vault header goes up with the page ────────────────────────────────
  // A SECOND scroll value, RN Animated rather than Reanimated: musicScrollY
  // above drives the scrubber, but the header node it would have to share is
  // RN Animated's and the two libraries cannot drive one node. So the native
  // event feeds this one and keeps `handleMusicScroll` as its JS listener —
  // one scroll, two readers, neither reaching across libraries.
  const [dockH, setDockH] = useState(0);
  const chromeShift = useMemo(() => (chromePx && dockH > 0
    ? { transform: [{ translateY: chromePx.interpolate({ inputRange: [0, dockH], outputRange: [0, -dockH], extrapolate: 'clamp' }) }] }
    : null), [chromePx, dockH]);
  // The dock's measured height, reserved by every list as top padding so the
  // dock can float over them and leave without the rows jumping up.
  const listTopPad = dockH || (topInset + PICKER_GAP);
  const musicMaxScroll = useSharedValue(1);

  // Group the list into runs of the same initial. NOTE: `starts` must follow the
  // list's REAL order, which is newest-upload-first — not A→Z. That's why no
  // `yearMarks` are emitted: those paint fixed letter ticks down the rail, and
  // on a non-alphabetical list they'd read as a broken index. The rail is a
  // clean track with a bubble that names the letter you're currently over, which
  // is correct at any sort order.
  const musicScrubData = useMemo(() => {
    const total = visibleTracks.length;
    if (total < 2) return { starts: [], labels: [], countLabels: [], total: 0, yearMarks: [] };
    const letterOf = (row) => {
      const ch = String(titleOf(row) || '').trim().charAt(0).toUpperCase();
      return ch >= 'A' && ch <= 'Z' ? ch : '#';
    };
    const starts = []; const labels = []; const counts = [];
    let last = null;
    for (let i = 0; i < total; i++) {
      const L = letterOf(visibleTracks[i]);
      if (L !== last) {
        last = L;
        starts.push(i);
        labels.push(L);
        counts.push(0);
      }
      counts[counts.length - 1] += 1;
    }
    return {
      starts,
      labels,
      countLabels: counts.map((n) => `${n} track${n === 1 ? '' : 's'}`),
      total,
      yearMarks: [],
    };
  }, [visibleTracks]);

  // A rail over a handful of tracks is noise — same threshold the Boards rail uses.
  const musicScrubEnabled = visibleTracks.length >= 20;

  const handleMusicScroll = useCallback((e) => {
    const ne = e && e.nativeEvent;
    if (!ne) return;
    if (ne.contentSize?.height) musicContentH.current = ne.contentSize.height;
    if (ne.layoutMeasurement?.height) musicLayoutH.current = ne.layoutMeasurement.height;
    musicScrollY.value = (ne.contentOffset && ne.contentOffset.y) || 0;
    musicMaxScroll.value = Math.max(1, musicContentH.current - musicLayoutH.current);
  }, [musicScrollY, musicMaxScroll]);

  /**
   * The library list's scroll: drives the header natively AND keeps feeding the
   * scrubber through the JS listener. `chromeScroll` is the same event for the
   * other three lists, which have no scrubber to feed — attaching the listener
   * there would push the WRONG list's offsets into the scrubber's shared value.
   */
  const chromeScrollMain = useMemo(() => (chromeScrollAnim
    ? Animated.event([{ nativeEvent: { contentOffset: { y: chromeScrollAnim } } }], { useNativeDriver: true, listener: handleMusicScroll })
    : handleMusicScroll), [chromeScrollAnim, handleMusicScroll]);
  const chromeScroll = useMemo(() => (chromeScrollAnim
    ? Animated.event([{ nativeEvent: { contentOffset: { y: chromeScrollAnim } } }], { useNativeDriver: true })
    : undefined), [chromeScrollAnim]);

  // Plain top-down list, so the drag fraction maps straight to a scroll offset.
  const handleMusicScrubJump = useCallback((dataFrac) => {
    const f = Math.min(1, Math.max(0, dataFrac));
    const offset = f * Math.max(1, musicContentH.current - musicLayoutH.current);
    musicScrollY.value = offset;
    try {
      listRef.current?.scrollToOffset?.({ offset, animated: false });
    } catch (err) { /* mid-layout — the next jump lands */ }
  }, [musicScrollY]);

  // Playlists are derived from the AUDIO library's own tags, not the global
  // album list — so the picker offers music playlists rather than every photo
  // board in the vault. No extra request: the rows already carry their tags.
  // Built as name → tracks in ONE pass, because both consumers (the picker's
  // name list and the playlists page's rows) need it and walking the library
  // twice for the same data is wasteful on a 300-track page.
  const playlistIndex = useMemo(() => {
    const byName = new Map();
    for (const t of visibleTracks) {
      for (const tag of tagsOf(t)) {
        const list = byName.get(tag);
        if (list) list.push(t);
        else byName.set(tag, [t]);
      }
    }
    return byName;
  }, [visibleTracks]);
  // ── Transcription ──────────────────────────────────────────────────────────
  // The recordings list, subscribed to here because THREE things on this page
  // read it: the Transcribed playlist, the ⋯ menu's label for a track that
  // already has one (or is mid-job), and the follow-along under the transport.
  // Seeded from the store's CURRENT value rather than from []: subscribing
  // publishes immediately, and starting empty would mean a second render (and
  // a second library refresh, since this page refreshes on focus) for a list
  // that was already in memory.
  const [recordings, setRecordings] = useState(getRecordings);
  useEffect(() => {
    loadRecordings().catch(() => {});
    return subscribeRecordings(setRecordings);
  }, []);
  const transcribedIds = useMemo(() => transcribedMediaIds(recordings), [recordings]);
  const transcribeSubtitle = useMemo(() => {
    const running = recordings.filter((r) => !['completed', 'failed', 'cancelled'].includes(r.status));
    if (running.length === 1) return `${running[0].name} · in progress`;
    if (running.length > 1) return `${running.length} in progress`;
    if (transcribedIds.size) {
      return `${transcribedIds.size} track${transcribedIds.size === 1 ? '' : 's'} transcribed`;
    }
    return 'Turn a recording into text you can follow';
  }, [recordings, transcribedIds]);

  const playlists = useMemo(
    () => {
      const names = Array.from(playlistIndex.keys());
      // The Transcribed playlist is offered as soon as this phone has
      // transcribed something, without waiting for the tag write to land — and
      // it survives that write failing. The tag is still written (see
      // services/transcribedPlaylist) so the playlist is real on the pond too;
      // when both exist, this is the same name and the index below merges them.
      if (transcribedIds.size && !names.includes(TRANSCRIBED_PLAYLIST)) {
        names.push(TRANSCRIBED_PLAYLIST);
      }
      return names.sort((a, b) => a.localeCompare(b));
    },
    [playlistIndex, transcribedIds]
  );

  /** One playlist's tracks, with Transcribed unioned from the local list. */
  const tracksInPlaylist = useCallback((name) => {
    const tagged = playlistIndex.get(name) || [];
    // A NEW array — `playlistIndex`'s own is shared, and sorting in place would
    // reorder it under every other reader.
    if (name !== TRANSCRIBED_PLAYLIST) return tagged.slice().sort(byTitleNatural);
    const seen = new Set(tagged.map((t) => String(t.id)));
    const derived = visibleTracks.filter(
      (t) => transcribedIds.has(String(t.id)) && !seen.has(String(t.id)),
    );
    return (derived.length ? [...tagged, ...derived] : tagged.slice()).sort(byTitleNatural);
  }, [playlistIndex, visibleTracks, transcribedIds]);

  // ── Playlists page ─────────────────────────────────────────────────────────
  // Pushed over the library as an EdgeSwipePage (the app's push-page primitive),
  // so it arrives from the right and a left-edge swipe takes you back to all
  // songs — the same back gesture every other pushed page in the app uses.
  // `openPlaylist` is the second level: null = the list of playlists, a name =
  // that playlist's tracks.
  // ── Sharing a track inside the pond ──────────────────────────────────────
  // Two reads, both one-per-library rather than one-per-row: who has each of
  // MY tracks (keyed by track id, for the face stacks), and the tracks other
  // people have given ME.
  const [trackAccess, setTrackAccess] = useState(() => ({}));
  const [pondTracks, setPondTracks] = useState([]);
  const [sharedOpen, setSharedOpen] = useState(false);
  const refreshPondTracks = useCallback(async () => {
    const [mine, theirs] = await Promise.allSettled([
      api.get('/track-access/mine'),
      api.get('/shared-tracks'),
    ]);
    // Each half stands on its own: a failure must leave what was already drawn
    // rather than claim a track is shared with nobody.
    if (mine.status === 'fulfilled' && mine.value?.tracks && typeof mine.value.tracks === 'object') {
      setTrackAccess(mine.value.tracks);
    }
    if (theirs.status === 'fulfilled' && Array.isArray(theirs.value?.tracks)) {
      setPondTracks(theirs.value.tracks);
    }
  }, [api]);
  useEffect(() => { refreshPondTracks(); }, [refreshPondTracks]);

  // ── Kept on this device ────────────────────────────────────────────────
  // The store lives outside React (services/musicOfflineStore), so a download
  // keeps running when the vault unmounts; this is only the subscription.
  const offline = useOfflineMusic();
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  /**
   * Everything with a copy on the phone, drawn from all three lists.
   *
   * The library, the recordings folder and the tracks other people shared are
   * separate lists on purpose, but a download does not care which one it came
   * from — and a downloaded track that appeared in none of them would be bytes
   * on the phone with nothing on screen able to remove them.
   */
  const downloadedTracks = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const row of [...tracks, ...voiceRecordings, ...pondTracks]) {
      const id = String(row?.id);
      if (seen.has(id) || !offline.downloaded.has(id)) continue;
      seen.add(id);
      out.push(row);
    }
    return out;
  }, [tracks, voiceRecordings, pondTracks, offline.downloaded]);

  /**
   * A compact signature of everything the offline UI draws from.
   *
   * FlatList cells are pure: a download finishing, a percentage ticking, or
   * the pond going away repaints nothing unless the list is told the data
   * behind its rows has moved. Every list that draws tracks keys on this.
   * Progress is rounded to whole percents so the signature changes a hundred
   * times across a download, not thousands.
   */
  const offlineSignature = useMemo(() => {
    const parts = [isConnected ? 'on' : 'off', String(offline.downloaded.size)];
    for (const [id, v] of offline.inFlight) {
      parts.push(`${id}@${Math.round((v?.progress || 0) * 100)}`);
    }
    for (const id of offline.failed.keys()) parts.push(`${id}!`);
    return parts.join(',');
  }, [isConnected, offline.downloaded, offline.inFlight, offline.failed]);

  /**
   * Hold the offline slot open on every row, or on none of them.
   *
   * All-or-nothing rather than per-row: the slot exists to keep the duration
   * column straight, and a slot that appears only where there is a tick is
   * precisely what knocked it crooked. On a library with nothing downloaded
   * the rows give the 28pt back to the title instead.
   */
  const reserveOfflineSlot = offline.downloaded.size > 0
    || offline.inFlight.size > 0
    || offline.failed.size > 0;

  // Tapping the glyph on a row: the one control, cycling through the three
  // states rather than three separate buttons on a phone-width row.
  const toggleOffline = useCallback((row) => {
    tapHaptic();
    const status = offline.statusOf(row?.id);
    if (status.state === 'downloading') { offline.cancel(row?.id); return; }
    if (status.state === 'done') { offline.remove(row?.id); return; }
    offline.download(row);
  }, [offline]);

  // ── Playlists INSIDE Voice recordings ──────────────────────────────────
  //
  // A recording is an audio row carrying the `Voice recordings` tag (see
  // utils/voiceRecordings). Its OTHER tags are playlists, exactly as they are
  // for music — so organising recordings needs no new concept and no server
  // change, only a list built from the rows this folder already holds.
  //
  // Built from `voiceRecordings` and NOT from the library's playlistIndex,
  // which is deliberately computed from the music rows alone. The grouping
  // itself (and the reserved-tag exclusion) is in utils/voiceRecordings,
  // beside the rule that decides what a recording is.
  const recordingIndex = useMemo(
    () => recordingPlaylistIndex(voiceRecordings),
    [voiceRecordings]
  );

  const recordingPlaylists = useMemo(
    () => Array.from(recordingIndex.keys()).sort((a, b) => a.localeCompare(b)),
    [recordingIndex]
  );

  const recordingsInPlaylist = useCallback(
    // A new array: the index's own is shared, and sorting in place would
    // reorder it under every other reader.
    (name) => (recordingIndex.get(name) || []).slice().sort(byTitleNatural),
    [recordingIndex]
  );

  /** Which half of the Voice recordings page is showing. */
  const [recordingsTab, setRecordingsTab] = useState('recordings');
  /** Level 2 inside the Playlists tab: a name, or null for the list of them. */
  const [openRecordingPlaylist, setOpenRecordingPlaylist] = useState(null);
  const openRecordingPlaylistRows = openRecordingPlaylist
    ? recordingsInPlaylist(openRecordingPlaylist)
    : [];
  // A playlist whose last recording was moved back to music stops existing —
  // and leaving the page open on it would strand you on a list that can never
  // refill. Same reasoning as the music playlist page's own empty state.
  useEffect(() => {
    if (openRecordingPlaylist && !recordingIndex.has(openRecordingPlaylist)) {
      setOpenRecordingPlaylist(null);
    }
  }, [openRecordingPlaylist, recordingIndex]);

  // The Voice recordings section — a pushed page like Playlists, holding the
  // audio that is NOT in the library.
  const [recordingsOpen, setRecordingsOpen] = useState(false);
  const [playlistsOpen, setPlaylistsOpen] = useState(false);
  const [openPlaylist, setOpenPlaylist] = useState(null);
  const closePlaylists = useCallback(() => {
    setPlaylistsOpen(false);
    setOpenPlaylist(null);
  }, []);
  const openPlaylistTracks = openPlaylist ? tracksInPlaylist(openPlaylist) : [];

  // ── The transcription page ─────────────────────────────────────────────────
  // The panel (source picker + WhisperX options + the job list) lives behind
  // its own row in the library, pushed like Playlists is. `autoSendTrack` is
  // set when the page was opened FROM a track's ⋯ menu, which sends that track
  // as soon as the pond has said what its options are.
  const [transcribeOpen, setTranscribeOpen] = useState(false);
  const [autoSendTrack, setAutoSendTrack] = useState(null);
  const openTranscribe = useCallback((track = null) => {
    // The ⋯ menu is reachable from INSIDE a playlist, and an EdgeSwipePage is
    // a Modal: iOS silently never presents a second sibling Modal over an open
    // one, so the playlist pages stand down before this one comes up. (The
    // page underneath is the library, which is where Back should land anyway.)
    setOpenPlaylist(null);
    setPlaylistsOpen(false);
    setAutoSendTrack(track);
    setTranscribeOpen(true);
  }, []);
  const closeTranscribe = useCallback(() => {
    setTranscribeOpen(false);
    setAutoSendTrack(null);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshLibrary();
    }, [refreshLibrary])
  );

  // Play by ITEM, not by list index: the same row renderer serves the full
  // library and a playlist, and an index only means something in the list it
  // came from.
  const playTrack = useCallback(
    // `queue` is only passed for rows the player's own library does not hold —
    // the tracks other people have shared. Left out, playMedia builds the queue
    // from my library exactly as before.
    (item, queue) => {
      if (item?.id == null) return;
      if (queue) playRows(queue, String(item.id));
      else playMedia(String(item.id));
    },
    [playMedia, playRows]
  );

  /**
   * Hand a shared track back. The recipient's half of DELETE /track-access/:id
   * — the same endpoint, the same id, that the owner revokes with.
   */
  const leaveSharedTrack = useCallback((item) => {
    Alert.alert(
      `Leave “${titleOf(item)}”?`,
      `It will disappear from your music. ${item.ownerName || 'The owner'} can always share it again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            // Optimistic, with revert — the row goes on the tap.
            const before = pondTracks;
            setPondTracks((prev) => prev.filter((t) => t.shareId !== item.shareId));
            try {
              const res = await api.delete(`/track-access/${item.shareId}`);
              if (!res?.success) throw new Error(res?.error || 'Could not leave');
            } catch (e) {
              setPondTracks(before);
              Alert.alert('Could not leave', e?.message || 'Please try again.');
            }
          },
        },
      ],
    );
  }, [api, pondTracks]);

  // ── Track actions (the ⋯ sheet) ────────────────────────────────────────────

  // Play, or pause if this row is already the one playing — the sheet's first
  // row mirrors whatever the transport would do for this track.
  const sheetPlay = useCallback(() => {
    const item = sheetTrack;
    closeSheet();
    if (!item || !ready) return;
    if (String(item.id) === String(activeTrack?.mediaId)) togglePlayback();
    else playMedia(String(item.id));
  }, [sheetTrack, ready, activeTrack, togglePlayback, playMedia, closeSheet]);

  // Pull the audio file into the cache and hand it to the OS share sheet, then
  // drop the copy — same shape as the photo vault's share, so repeated shares
  // don't pile up duplicates in the cache directory.
  const sheetShare = useCallback(async () => {
    const item = sheetTrack;
    if (!item) return;
    const base = (getMediaBaseUrl ? getMediaBaseUrl() : getBaseUrl()).replace(/\/api$/, '');
    const url = resolveMediaUrl(item.rawUrl || item.url, base);
    if (!url) {
      Alert.alert('Share', 'That track has no downloadable file.');
      return;
    }
    setSheetBusy(true);
    let localUri = null;
    try {
      const safeName = (item.filename || `track_${item.id}.mp3`).replace(/[^\w.\-]/g, '_');
      localUri = `${FileSystem.cacheDirectory}shared_${item.id}_${safeName}`;
      const { uri } = await FileSystem.downloadAsync(url, localUri);
      closeSheet();
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { UTI: 'public.audio', mimeType: item.mimeType || 'audio/mpeg' });
      } else {
        Alert.alert('Share', 'Sharing is not available on this device.');
      }
    } catch (e) {
      console.warn('[MusicVault] share failed:', e?.message || e);
      Alert.alert('Share', 'Could not prepare that track.');
    } finally {
      setSheetBusy(false);
      if (localUri) FileSystem.deleteAsync(localUri, { idempotent: true }).catch(() => {});
    }
  }, [sheetTrack, getBaseUrl, getMediaBaseUrl, closeSheet]);

  // Rename = patch the row's originalName, which is the label titleOf() reads.
  // The file on disk is untouched (that's `filename`), so this is a pure
  // metadata edit. The extension is carried over from the old name because
  // titleOf strips a trailing extension for display — dropping it would make
  // "Take.Five" render as "Take" on the next load.
  // Offline-safe: sendOrQueue tries the PATCH now and parks it in the durable
  // outbox if the pond can't be reached, so a rename on the subway survives
  // both the dead network AND an app restart — it's replayed on reconnect. Only
  // a PERMANENT failure (a 4xx: gone, not yours) rejects and reverts.
  const sheetRename = useCallback(
    (name) => {
      const item = sheetTrack;
      const clean = String(name || '').trim();
      if (!item || !clean) return;
      const id = String(item.id);
      const prevName = item.originalName || item.filename || '';
      const ext = (String(prevName).match(/\.[a-z0-9]{2,5}$/i) || [''])[0];
      const nextName = clean.endsWith(ext) ? clean : `${clean}${ext}`;
      if (nextName === prevName) { closeSheet(); return; }

      closeSheet();
      setRenamedNames((prev) => new Map(prev).set(id, nextName));
      sendOrQueue(api, {
        method: 'patch',
        path: `/media/${id}`,
        body: { originalName: nextName },
        // Rename it three times offline and only the last one is sent.
        key: renameKey(id),
        label: `Rename “${clean}”`,
      })
        .then(({ queued }) => { if (!queued) refreshLibrary(); })
        .catch((e) => {
          console.warn('[MusicVault] rename failed:', e?.message || e);
          setRenamedNames((prev) => {
            const next = new Map(prev);
            next.delete(id);
            return next;
          });
          Alert.alert('Rename', 'Could not rename that track.');
        });
    },
    [sheetTrack, api, refreshLibrary, closeSheet]
  );

  // Playlists are tags, and the tags endpoint REPLACES the list — so send the
  // union of what the row already has plus the new name. Closes immediately and
  // persists in the background; offline it parks in the outbox, and only a
  // permanent failure alerts + refreshes the true state back.
  //
  // NOT keyed: each add carries the full tag list it computed at the time, so
  // collapsing two adds would silently drop the first playlist.
  const sheetAddToPlaylist = useCallback(
    (name) => {
      const item = sheetTrack;
      const clean = String(name || '').trim();
      if (!item || !clean) return;
      closeSheet();
      const next = Array.from(new Set([...tagsOf(item), clean]));
      sendOrQueue(api, {
        method: 'put',
        path: `/media/${item.id}/tags`,
        body: { tags: next },
        label: `Add to ${clean}`,
      })
        .then(({ queued }) => { if (!queued) refreshLibrary(); })
        .catch((e) => {
          console.warn('[MusicVault] playlist add failed:', e?.message || e);
          Alert.alert('Playlist', `Could not add “${titleOf(item)}” to ${clean}.`);
          refreshLibrary();
        });
    },
    [sheetTrack, api, refreshLibrary, closeSheet]
  );

  /**
   * ⋯ → Move to / out of Voice recordings.
   *
   * The same single write a playlist add is — the tags endpoint REPLACES the
   * list, so what goes up is the row's own tags with this one added or taken
   * off. What makes it more than a playlist is where the tag is read: the
   * library is built without these rows (MusicPlayerContext), so the move
   * takes the track out of the music list AND out of the play queue in one go.
   *
   * The refresh is what moves the row on screen, so there is no optimistic
   * copy to keep in step here: one list owns the answer.
   */
  const sheetToggleRecording = useCallback(() => {
    const item = sheetTrack;
    if (!item) return;
    const filed = isVoiceRecording(item);
    closeSheet();
    const next = filed ? tagsWithoutVoiceRecording(item) : tagsWithVoiceRecording(item);
    sendOrQueue(api, {
      method: 'put',
      path: `/media/${item.id}/tags`,
      body: { tags: next },
      label: filed ? 'Move back to music' : `Move to ${VOICE_RECORDINGS_LABEL}`,
    })
      .then(({ queued }) => { if (!queued) refreshLibrary(); })
      .catch((e) => {
        console.warn('[MusicVault] recordings move failed:', e?.message || e);
        Alert.alert(
          VOICE_RECORDINGS_LABEL,
          filed
            ? `Could not move “${titleOf(item)}” back to your music.`
            : `Could not move “${titleOf(item)}” to ${VOICE_RECORDINGS_LABEL}.`,
        );
        refreshLibrary();
      });
  }, [sheetTrack, api, refreshLibrary, closeSheet]);

  // ⋯ → Transcribe. Opens the transcription page with this track queued: the
  // options and the job list are the same ones the library's own Transcribe
  // row shows, so there is one place where a transcription is watched no
  // matter which door started it.
  // What the ⋯ menu's Transcribe row should say for THIS track: there is
  // nothing to do yet, one is running, or it already has one (which is a
  // re-transcribe — a bigger model, or speakers separated this time).
  const sheetTranscriptState = useMemo(() => {
    const id = sheetTrack?.id;
    if (!id) return 'none';
    if (pendingRowForMedia(recordings, id)) return 'running';
    return transcribedIds.has(String(id)) ? 'done' : 'none';
  }, [sheetTrack?.id, recordings, transcribedIds]);

  const sheetTranscribe = useCallback(() => {
    const item = sheetTrack;
    closeSheet();
    if (item) openTranscribe(item);
  }, [sheetTrack, closeSheet, openTranscribe]);

  const sheetDelete = useCallback(() => {
    const item = sheetTrack;
    if (!item) return;
    const id = String(item.id);
    Alert.alert(
      'Delete track',
      `Remove “${titleOf(item)}” from the vault? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            closeSheet();
            // Optimistic: hide it now, un-hide only if the server REFUSES it.
            // Offline is not a refusal — the delete parks in the outbox and the
            // row stays gone, which is what the user asked for.
            setRemovedIds((prev) => new Set(prev).add(id));
            sendOrQueue(api, {
              method: 'delete',
              path: `/media/${id}`,
              key: `media:${id}:delete`,
              label: `Delete “${titleOf(item)}”`,
            })
              .then(({ queued }) => { if (!queued) refreshLibrary(); })
              .catch((e) => {
                console.warn('[MusicVault] delete failed:', e?.message || e);
                setRemovedIds((prev) => {
                  const next = new Set(prev);
                  next.delete(id);
                  return next;
                });
                Alert.alert('Delete', 'Could not delete that track.');
              });
          },
        },
      ]
    );
  }, [sheetTrack, api, refreshLibrary, closeSheet]);

  // ── Follow-along ───────────────────────────────────────────────────────────
  // The transcript of whatever is PLAYING, fetched when the track changes to
  // one this phone has transcribed. Not persisted: a transcript can be large,
  // it lives on the pond, and the only moment it is wanted is this one. Kept
  // in a per-job cache so skipping back and forth between two transcribed
  // tracks doesn't re-fetch either of them.
  const nowRow = useMemo(
    () => transcriptRowForMedia(recordings, nowTrack?.id),
    [recordings, nowTrack?.id],
  );
  const [transcript, setTranscript] = useState(null);
  const [transcriptError, setTranscriptError] = useState(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [followOpen, setFollowOpen] = useState(false);
  const transcriptCache = useRef(new Map());

  useEffect(() => {
    const jobId = nowRow?.id;
    if (!jobId) { setTranscript(null); setTranscriptError(null); return undefined; }
    const cached = transcriptCache.current.get(jobId);
    if (cached) { setTranscript(cached); setTranscriptError(null); return undefined; }
    let cancelled = false;
    setTranscriptLoading(true);
    setTranscriptError(null);
    (async () => {
      try {
        const result = await getResult(api, jobId);
        const turns = (Array.isArray(result?.turns) ? result.turns : [])
          .filter((t) => t && String(t.text || '').trim());
        if (cancelled) return;
        transcriptCache.current.set(jobId, turns);
        setTranscript(turns);
      } catch (error) {
        if (cancelled) return;
        setTranscript(null);
        // A completed job whose artifact aged out is the expected version of
        // this, and it is not the same sentence as "something broke".
        setTranscriptError(statusOfError(error) === 404
          ? 'The pond no longer keeps this transcript.'
          : 'Could not read that transcript.');
      } finally {
        if (!cancelled) setTranscriptLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [nowRow?.id, api]);

  // The line being spoken, for the one-line caption on the transport bar.
  const caption = useMemo(
    () => (transcript ? captionAt(transcript, position) : ''),
    [transcript, position],
  );
  const hasFollowAlong = !!nowRow && (transcriptLoading || !!transcript || !!transcriptError);

  const seekFromFraction = useCallback(
    (fraction) => {
      if (!duration) return;
      seekTo(Math.max(0, Math.min(duration, fraction * duration)));
    },
    [duration, seekTo]
  );

  // Track-row styles hoisted out of renderTrack — the old inline objects
  // allocated five styles per row whenever the rows re-rendered (play/pause,
  // track change). Theme-keyed; active/idle title is a precomputed pair.
  const trackStyles = useMemo(() => {
    const accent = MUSIC_TINT(c);
    return StyleSheet.create({
      artTint: { backgroundColor: accent + '22' },
      body: { flex: 1 },
      titleActive: { fontSize: 15, fontWeight: '600', color: accent },
      titleIdle: { fontSize: 15, fontWeight: '600', color: c.textPrimary },
      source: { fontSize: 12, color: c.textTertiary, marginTop: 1 },
      // Durations line up as a column. Two things are needed and neither is
      // optional: a fixed width (so the left edges agree, not just the right
      // ones) and tabular figures (so "1:40" and "154:33" use the same digit
      // width). Sized for six characters — fmtTime is m:ss, so even a
      // ten-hour recording reads "600:00".
      duration: {
        fontSize: 12, color: c.textTertiary,
        width: 48, textAlign: 'right', fontVariant: ['tabular-nums'],
      },
      // A fixed slot, held open on EVERY row once anything in the library is
      // downloaded — not just the rows that have a tick. Rendering it only
      // where there is something to show is what made the durations ragged:
      // a row with a tick pushed its duration 28pt left of the rows without.
      offlineBtn: { width: 28, alignItems: 'center', justifyContent: 'center' },

      // ── Downloading, as the row filling up ────────────────────────────
      // The bar is the row's own background rather than a widget on it: the
      // thing being downloaded IS the row, and a progress element sitting in
      // the layout would have to push the title or the duration aside to find
      // room. Absolutely positioned and drawn first, so every later sibling
      // paints over it.
      progressFill: {
        position: 'absolute', left: 0, top: 0, bottom: 0,
        backgroundColor: accent + '2e',
      },
      // Finished, and the row keeps a tint so "kept" is legible at a glance
      // down a long list — in dark mode a LIGHTER wash, because a darker one
      // against a dark background is invisible.
      keptRow: { backgroundColor: isDark ? accent + '1f' : accent + '14' },
      // No pond, and no copy here: the row cannot play. Dimmed as a whole
      // rather than hidden — the library is still the library, and a track
      // that silently vanished would read as lost rather than out of reach.
      unreachableRow: { opacity: 0.38 },
    });
  }, [c, isDark]);

  // ── Search ────────────────────────────────────────────────────────────
  // What one track looks like to the matcher. Built here, not in trackSearch,
  // because only this file knows about the local rename overrides and that a
  // tag IS a playlist.
  const describeTrack = useCallback(
    (row) => ({ title: titleOf(row), source: sourceOf(row), tags: tagsOf(row) }),
    [],
  );
  const matchedTracks = useMemo(
    () => rankTracks(visibleTracks, query, describeTrack),
    [visibleTracks, query, describeTrack],
  );
  const lift = Math.max(0, topInset - (searchTopInset ?? topInset));
  const search = useVaultSearch({
    query,
    items: matchedTracks,
    onQueryChange: onQueryChange || (() => {}),
    onSearchActiveChange,
    lift,
  });
  const { searching, displayQuery, displayItems: displayTracks } = search;

  // ── …and the web ──────────────────────────────────────────────────────
  const [scope, setScope] = useState(LIBRARY_SCOPE);
  const webScope = scope === WEB_SCOPE;
  const [web, setWeb] = useState(NO_WEB_SEARCH);
  // videoId → 'sending' | 'queued' | 'failed'. Held HERE rather than in the
  // row so it survives the list re-rendering around it, and so a result that
  // scrolls away and back still reads as already on its way.
  const [webDownloads, setWebDownloads] = useState({});

  /**
   * Leaving search puts the scope back to the library.
   *
   * The scope is a property of the search you are doing, not a setting: coming
   * back to the Music tab tomorrow and finding the field pointed at YouTube —
   * with no results under it, because the query went too — would read as the
   * tab being broken rather than as a remembered preference.
   */
  useEffect(() => {
    if (searching) return;
    setScope(LIBRARY_SCOPE);
    setWeb(clearedWebSearch);
  }, [searching]);

  /**
   * The web search itself: debounced, and last-one-wins.
   *
   * A generation counter rather than an aborted request, because `api.get`
   * owns its own AbortController (for its timeout) and does not take a signal.
   * The effect of an abandoned reply is the same either way — it is dropped —
   * and the pond coalesces identical queries in flight, so the cost of not
   * cancelling is bounded there rather than guessed at here.
   */
  const webRunRef = useRef(0);
  // `displayQuery`, NOT `query`: cancelling empties the live query on the
  // first frame while the page is still gliding down (see useVaultSearch), and
  // keying off that would clear the results out from under an animation this
  // page goes to some length to keep still. The frozen copy does not change
  // during the glide, so the effect does not re-run at all.
  const typed = displayQuery.trim();
  useEffect(() => {
    if (!searching || !webScope) return undefined;
    if (!shouldSearchWeb(typed)) {
      setWeb(clearedWebSearch);
      return undefined;
    }
    const run = ++webRunRef.current;
    setWeb((prev) => ({ ...prev, loading: true, error: null }));
    const timer = setTimeout(async () => {
      try {
        const { results } = await searchWebMusic(api, typed);
        if (webRunRef.current !== run) return;
        setWeb({ results, loading: false, error: null, searched: typed });
      } catch (e) {
        if (webRunRef.current !== run) return;
        setWeb({
          results: [],
          loading: false,
          // The pond's own words where it has them — "this pond cannot search
          // the web" and "could not reach YouTube" are different problems and
          // only one of them is worth retrying. A 404 means this pond predates
          // the feature, which no amount of retyping will fix.
          error: /API 404/.test(e?.message || '')
            ? 'This pond needs an update before it can search the web.'
            : (pondMessage(e) || 'Could not search YouTube just now.'),
          searched: typed,
        });
      }
    }, WEB_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [api, searching, webScope, typed]);

  /**
   * ── Warming the rows you are looking at ──────────────────────────────────
   *
   * A web row cannot play until the pond has turned the video into a playable
   * URL, which takes a second or two and cannot be started by the phone. The
   * pond warms a search's first few rows by itself; past that it is guessing,
   * and this is the part that is not a guess — the rows on screen.
   *
   * Three things keep it from being chatter:
   *   • `askedRef` remembers what the pond has been told, for this result set.
   *     Scrolling fires a viewability change per row that crosses the line, and
   *     a row that crosses it four times is still one video;
   *   • a short timer coalesces a flick of the thumb into one request;
   *   • nothing is awaited and nothing is shown. It is a hint.
   */
  // `api` through a ref, and the warmer built once: FlatList refuses a new
  // onViewableItemsChanged after mount ("Changing onViewableItemsChanged on
  // the fly is not supported"), so the callback it is handed has to outlive
  // every render.
  const apiRef = useRef(api);
  apiRef.current = api;
  const warmerRef = useRef(null);
  if (!warmerRef.current) {
    warmerRef.current = createRowWarmer({ send: (ids) => warmWebMusic(apiRef.current, ids) });
  }
  const onRowsVisible = useRef((info) => warmerRef.current.onVisible(info)).current;

  useEffect(() => { warmerRef.current.reset(); }, [web.searched, web.results]);
  useEffect(() => () => warmerRef.current.cancel(), []);

  /**
   * Preview a result — play it, keeping nothing.
   *
   * `playRows` with a one-row queue, which is what a preview is: skip would
   * otherwise walk into my library from a track that is not in it. The row is
   * remembered so the transport bar can name what is playing (see nowTrack) —
   * the player knows the id `yt:…` and nothing else about it.
   */
  const previewWeb = useCallback((result) => {
    const row = webPreviewRow(result, getBaseUrl());
    if (!row) return;
    Keyboard.dismiss();
    setPreviewRow(row);
    playRows([row], row.id);
  }, [getBaseUrl, playRows]);

  /** Download a result: its ordinary watch URL, to the queue that has always
   *  taken shared links. The DownloadsPill reports the rest, app-wide. */
  const downloadWeb = useCallback(async (result) => {
    setWebDownloads((prev) => ({ ...prev, [result.videoId]: 'sending' }));
    try {
      await enqueueWebDownload(api, result);
      setWebDownloads((prev) => ({ ...prev, [result.videoId]: 'queued' }));
    } catch (e) {
      setWebDownloads((prev) => ({ ...prev, [result.videoId]: 'failed' }));
      Alert.alert('Could not start that download', pondMessage(e) || 'The pond did not take the link.');
    }
  }, [api]);

  /**
   * What a list on this page must keep clear at its foot.
   *
   * With a track loaded that is the TRANSPORT BAR, whose own measured height
   * already includes the padding lifting it over the floating dock — so
   * reserving the bar reserves both. With nothing playing there is no bar,
   * and the dock is what is left to clear.
   *
   * The `|| 150` covers the single frame before the bar's onLayout lands.
   */
  const listPadBottom = nowTrack
    ? (nowBarH || 150) + 16
    : Math.max(insets.bottom, bottomInset) + 24;

  /**
   * …and the LIBRARY list needs the lift on top of that.
   *
   * The lifting layer is permanently `lift` taller than the page — its
   * negative bottom margin is static, so the rise into search is a pure
   * transform. Any list inside it therefore hangs that far BELOW the screen,
   * and its last `lift` points of content can never be scrolled into view:
   * the end of the music list stuck behind the player and the dock, however
   * far you pulled. The Files page is built from this same template and has
   * always added it; this one never did.
   *
   * The pushed pages below are not in that layer and must NOT add it.
   */
  const libraryPadBottom = listPadBottom + lift;

  /**
   * One track row, for the library and for every page that lists tracks.
   *
   * `queue` is for a list the PLAYER does not own — the voice recordings,
   * which are deliberately not in its library (see MusicPlayerContext). Left
   * out, the queue is built from the library exactly as before, so a tap in
   * the library still walks the library.
   */
  const renderTrack = useCallback(({ item, queue, onOptions }) => {
    // Active is decided by the PLAYING id, not by list position, so the same row
    // highlights correctly in the library and inside a playlist.
    const active = String(item.id) === String(activeTrack?.mediaId);
    // A track with a transcript reads along as it plays, so the row says so —
    // otherwise the only way to find out is to play it and notice.
    const hasTranscript = transcribedIds.has(String(item.id));
    const offlineState = offline.statusOf(item.id);
    const look = rowOfflineAppearance(offlineState, isConnected);
    const { kept, unreachable } = look;
    return (
      <TouchableOpacity
        {...TAP_ONLY}
        activeOpacity={0.7}
        // Dimmed but NOT disabled, deliberately. `isConnected` is the pond's
        // last health check, and it starts false on a cold boot and goes
        // false on any blip — gating the tap on it would make the entire
        // library untappable for the moment before the first check lands, and
        // leave it that way on a false negative. Dimming is a hint about what
        // will probably happen; the player already says so properly when a
        // stream really cannot be reached.
        disabled={!ready}
        accessibilityHint={unreachable ? 'Not on this device, and the pond is not reachable' : undefined}
        onPress={() => playTrack(item, queue)}
        style={[
          styles.row,
          kept && trackStyles.keptRow,
          unreachable && trackStyles.unreachableRow,
        ]}
      >
        {/* The download, filling the row from the left. Drawn before anything
            else so the title, duration and buttons all paint over it. */}
        {look.fillPercent > 0 ? (
          <View
            testID={`music-progress-${item.id}`}
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[trackStyles.progressFill, { width: `${look.fillPercent}%` }]}
          />
        ) : null}
        <View style={[styles.art, trackStyles.artTint]}>
          <Icon
            name={active && isPlaying ? 'pause' : 'music-note'}
            size={20}
            color={active ? (MUSIC_TINT(c)) : c.textSecondary}
          />
        </View>
        <View style={trackStyles.body}>
          <Text style={active ? trackStyles.titleActive : trackStyles.titleIdle} numberOfLines={1}>
            {titleOf(item)}
          </Text>
          <Text style={trackStyles.source} numberOfLines={1}>
            {sourceOf(item) || 'Audio'}
          </Text>
        </View>
        {hasTranscript ? (
          <Icon
            name="text-box-check-outline"
            size={16}
            color={c.textTertiary}
            accessibilityLabel="Has a transcript"
          />
        ) : null}
        {/* Who this track is shared with, inside the pond. Same treatment as a
            photo board's caption — a stack that says "this left your library"
            without opening anything. Sized to a fixed slot so a long title
            cannot push it off the row. */}
        {(trackAccess[String(item.id)] || []).length ? (
          <FaceStack
            people={trackAccess[String(item.id)]}
            available={56}
            size={16}
            theme={theme}
            baseUrl={getBaseUrl?.()}
          />
        ) : null}
        {/* Kept on this device, to the LEFT of the duration — the duration is
            the column the eye runs down, so nothing variable belongs between
            it and the ⋯ button.

            The slot is held open on every row once anything is downloaded, so
            a row with a tick and a row without still agree on where the
            duration starts. No percentage here any more: the row itself is
            the progress bar, and a number beside a bar measuring the same
            thing is one of them too many. What stays is the stop target. */}
        {reserveOfflineSlot ? (
          offlineState.state === 'absent' ? (
            <View style={trackStyles.offlineBtn} />
          ) : (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={
                offlineState.state === 'done' ? `${titleOf(item)} is on this device. Remove it`
                  : offlineState.state === 'downloading'
                    ? `Downloading ${titleOf(item)}, ${Math.round((offlineState.progress || 0) * 100)} percent. Stop`
                    : `Download of ${titleOf(item)} failed. Try again`
              }
              hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
              onPress={() => toggleOffline(item)}
              style={trackStyles.offlineBtn}
            >
              <Icon
                name={offlineState.state === 'failed' ? 'alert-circle-outline'
                  : offlineState.state === 'downloading' ? 'close-circle-outline'
                  : 'check-circle'}
                size={16}
                color={offlineState.state === 'failed' ? (c.accentError || c.textTertiary) : MUSIC_TINT(c)}
              />
            </TouchableOpacity>
          )
        ) : null}

        {/* Always rendered, even with no duration to show: an empty slot keeps
            the column straight where a missing one would pull the rows below
            it out of line. */}
        <Text style={trackStyles.duration}>{item.duration ? fmtTime(item.duration) : ''}</Text>
        {/* Per-track options. Its own touchable so it doesn't start playback —
            hitSlop widens the 24pt glyph to a comfortable target without
            stealing the row's tap area. */}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`Options for ${titleOf(item)}`}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 8 }}
          // `onOptions` is for a row on a PUSHED page: the actions sheet is an
          // in-tree overlay on this screen, and an EdgeSwipePage is a Modal —
          // so a sheet opened from inside one renders underneath it and looks
          // like a dead button. The page stands down first instead (the same
          // move openTranscribe makes, for the same reason).
          onPress={() => (onOptions ? onOptions(String(item.id)) : setSheetId(String(item.id)))}
          style={styles.moreBtn}
        >
          <Icon name="dots-horizontal" size={22} color={c.textTertiary} />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  }, [c, trackStyles, activeTrack, isPlaying, playTrack, ready, transcribedIds, trackAccess, theme, getBaseUrl, offline, toggleOffline, isConnected, reserveOfflineSlot]);

  /**
   * One search result, in the vault's shared row.
   *
   * Rows, not the library's own cards, for the reason VaultResultRow
   * documents: while searching you are looking for ONE thing by name, and a
   * column of names is what you can run your eye down. The options key comes
   * along — renaming or filing a track is often exactly why you went looking
   * for it.
   */
  const renderSearchRow = useCallback(({ item }) => {
    const active = String(item.id) === String(activeTrack?.mediaId);
    const playlists = tagsOf(item);
    const meta = [
      sourceOf(item) || 'Audio',
      item.duration ? fmtTime(item.duration) : null,
      playlists.length ? playlists.slice(0, 2).join(' · ') : null,
    ].filter(Boolean).join(' · ');
    return (
      // ── Why the inset is HERE, and not in the shared row ──────────────
      // VaultResultRow is paddingHorizontal: 2, which is right: the other
      // nine surfaces that use it pad at the CONTAINER level instead
      // (FilesVault's styles.rows, the photo boards page's content, the
      // people picker's panel — all 16). Music is the odd one out, because
      // its search rows share one FlatList with the library rows, and those
      // carry their own 16. Padding that list would double-indent the
      // library; raising the shared row would double-indent the other nine.
      //
      // 14 here plus the row's own 2 is 16 — the same inset as a library
      // row, and the same as the hairline between them (styles.trackSep is
      // marginHorizontal: 16), which is what the rows were failing to line
      // up with.
      <View style={styles.searchRowInset}>
      <VaultResultRow
        theme={theme}
        name={titleOf(item)}
        meta={meta}
        accessibilityLabel={`Play ${titleOf(item)}`}
        onPress={() => { Keyboard.dismiss(); playTrack(item); }}
        leading={(
          <Icon
            name={active && isPlaying ? 'pause' : 'music-note'}
            size={22}
            color={active ? MUSIC_TINT(c) : c.textSecondary}
          />
        )}
        trailing={(
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`Options for ${titleOf(item)}`}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 8 }}
            onPress={() => setSheetId(String(item.id))}
            style={styles.moreBtn}
          >
            <Icon name="dots-horizontal" size={22} color={c.textTertiary} />
          </TouchableOpacity>
        )}
        />
      </View>
    );
  }, [theme, c, activeTrack, isPlaying, playTrack]);

  /** One web result. Tap previews, the key downloads — see MusicWebResultRow. */
  const renderWebRow = useCallback(({ item }) => {
    const active = webRowId(item.videoId) === String(activeTrack?.mediaId);
    return (
      <MusicWebResultRow
        result={item}
        theme={theme}
        tint={MUSIC_TINT(c)}
        playing={active}
        // Only the row that was actually tapped waits — see `preparing` in
        // MusicPlayerContext for what the player is doing while it does, and
        // preparingProgress.js for how much of the percentage is measured.
        preparing={active && preparing}
        // Only the waiting row gets the ticking number. Handing it to all
        // fifteen would re-render the whole list seven times a second for a
        // percentage fourteen of them do not draw — React.memo can only skip a
        // row whose props actually held still.
        preparingPct={active ? preparingPct : 0}
        downloadState={webDownloads[item.videoId] || 'idle'}
        onPreview={() => previewWeb(item)}
        onDownload={() => downloadWeb(item)}
      />
    );
  }, [theme, c, activeTrack, preparing, preparingPct, webDownloads, previewWeb, downloadWeb]);

  /**
   * The search header: the scope toggle, then one line about what is below it.
   *
   * Both scopes get the toggle — it is how you get BACK to your library as
   * much as how you leave it — and both get a status line in the same place,
   * so switching does not move the first row.
   */
  const searchHeader = useCallback(() => (
    <View style={styles.searchHeader}>
      <View style={styles.scopeToggle}>
        <SearchScopeToggle
          value={scope}
          options={SEARCH_SCOPES}
          onChange={setScope}
          theme={theme}
          testID="music-search-scope"
        />
      </View>
      {/* ONE line, always. "Searching YouTube for “<a long query>”…" wraps to
          two lines where "12 results on YouTube" does not, so without this the
          whole list below shifts up by a line at the exact moment the results
          arrive — the jump being designed out here. */}
      <Text style={[styles.resultCount, { color: c.textTertiary }]} numberOfLines={1}>
        {webScope
          ? webSearchStatus({
            query: displayQuery, loading: web.loading, error: web.error,
            results: web.results, searched: web.searched,
          })
          : trackCountLabel(displayTracks.length)}
      </Text>
    </View>
  ), [scope, theme, c, webScope, web, displayQuery, displayTracks.length]);

  // The library's two destination rows, pinned above the tracks: Playlists and
  // Transcribe. Not tracks — same row metrics so they read as part of the
  // list, with a chevron marking each as a push rather than a play.
  const headerRows = useCallback(() => (
    <>
      {/* ── Voice recordings ───────────────────────────────────────────────
          A FOLDER, not a playlist: what is in here is not in the library
          above it and not in the queue press-play builds, which is the whole
          point — your own voice should not turn up between two songs. The
          only way to it is this row.

          Always shown, even empty, unlike "Shared with you": this one is a
          destination you file things INTO, so it has to be visible before it
          has anything in it, and its subtitle says how to put something
          there. */}
      <TouchableOpacity
        {...TAP_ONLY}
        testID="music-voice-recordings-row"
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`${VOICE_RECORDINGS_LABEL}, ${voiceRecordings.length}`}
        onPress={() => { tapHaptic(); setRecordingsOpen(true); }}
        style={styles.row}
      >
        <View style={[styles.art, trackStyles.artTint]}>
          <Icon name="microphone" size={22} color={MUSIC_TINT(c)} />
        </View>
        <View style={trackStyles.body}>
          <Text style={trackStyles.titleIdle} numberOfLines={1}>{VOICE_RECORDINGS_LABEL}</Text>
          <Text style={trackStyles.source} numberOfLines={1}>
            {voiceRecordings.length === 0
              ? 'Empty — move one here from its ⋯ menu'
              : `${recordingCountLabel(voiceRecordings.length)} · kept out of your music`}
          </Text>
        </View>
        <Icon name="chevron-right" size={22} color={c.textTertiary} />
      </TouchableOpacity>

      {/* ── On this device ────────────────────────────────────────────────
          A destination like the two around it, and absent until something is
          kept — an empty "On this device" is a promise of a feature rather
          than a place to go, the same reasoning as "Shared with you" below.
          The subtitle carries the size, because the only question anyone asks
          of downloads is how much room they are taking. */}
      {offline.downloaded.size > 0 ? (
        <TouchableOpacity
          {...TAP_ONLY}
          testID="music-downloads-row"
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`On this device, ${offline.downloaded.size}`}
          onPress={() => { tapHaptic(); setDownloadsOpen(true); }}
          style={styles.row}
        >
          <View style={[styles.art, trackStyles.artTint]}>
            <Icon name="cloud-check-outline" size={22} color={MUSIC_TINT(c)} />
          </View>
          <View style={trackStyles.body}>
            <Text style={trackStyles.titleIdle} numberOfLines={1}>On this device</Text>
            <Text style={trackStyles.source} numberOfLines={1}>
              {`${offline.downloaded.size} track${offline.downloaded.size === 1 ? '' : 's'} · ${formatBytes(offline.totalBytes)} · plays with no pond`}
            </Text>
          </View>
          <Icon name="chevron-right" size={22} color={c.textTertiary} />
        </TouchableOpacity>
      ) : null}

      <TouchableOpacity
        {...TAP_ONLY}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`Playlists, ${playlists.length}`}
        onPress={() => { tapHaptic(); setPlaylistsOpen(true); }}
        style={styles.row}
      >
        <View style={[styles.art, trackStyles.artTint]}>
          <Icon name="playlist-music" size={22} color={MUSIC_TINT(c)} />
        </View>
        <View style={trackStyles.body}>
          <Text style={trackStyles.titleIdle} numberOfLines={1}>Playlists</Text>
          <Text style={trackStyles.source} numberOfLines={1}>
            {playlists.length === 0
              ? 'None yet — add a track from its ⋯ menu'
              : `${playlists.length} playlist${playlists.length === 1 ? '' : 's'}`}
          </Text>
        </View>
        <Icon name="chevron-right" size={22} color={c.textTertiary} />
      </TouchableOpacity>

      {/* Tracks other people gave me. A destination row like Playlists above,
          and ABSENT entirely when nobody has shared anything — an empty
          "Shared with you" on a pond where this has never happened is a
          promise of a feature rather than a place to go. */}
      {pondTracks.length ? (
        <TouchableOpacity
          {...TAP_ONLY}
          testID="music-shared-with-you"
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`Shared with you, ${pondTracks.length} ${pondTracks.length === 1 ? 'track' : 'tracks'}`}
          onPress={() => { tapHaptic(); setSharedOpen(true); }}
          style={styles.row}
        >
          <View style={[styles.art, trackStyles.artTint]}>
            <Icon name="account-music" size={22} color={MUSIC_TINT(c)} />
          </View>
          <View style={trackStyles.body}>
            <Text style={trackStyles.titleIdle} numberOfLines={1}>Shared with you</Text>
            <Text style={trackStyles.source} numberOfLines={1}>
              {`${pondTracks.length} track${pondTracks.length === 1 ? '' : 's'} from your pond`}
            </Text>
          </View>
          <Icon name="chevron-right" size={22} color={c.textTertiary} />
        </TouchableOpacity>
      ) : null}

      {/* Transcribe — the same panel Settings has, in the tab where the audio
          actually is. Its subtitle is the one thing worth saying about the
          jobs from out here: whether anything is running. */}
      <TouchableOpacity
        {...TAP_ONLY}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Transcribe audio"
        testID="music-transcribe-row"
        onPress={() => { tapHaptic(); openTranscribe(null); }}
        style={styles.row}
      >
        <View style={[styles.art, trackStyles.artTint]}>
          {/* A nib with a written stroke under it — a scribe taking it down,
              which is what this does. It also stays clear of the text-box
              family this screen uses for the transcript ITSELF (the caption
              strip, and the marker on a track that has one): the pen is the
              act, the page is the result.
              (`text-to-speech`, which this started as, was the wrong way
              round: that glyph is a mouth emitting sound.) */}
          <Icon name="signature-freehand" size={22} color={MUSIC_TINT(c)} />
        </View>
        <View style={trackStyles.body}>
          <Text style={trackStyles.titleIdle} numberOfLines={1}>Transcribe</Text>
          <Text style={trackStyles.source} numberOfLines={1}>
            {transcribeSubtitle}
          </Text>
        </View>
        <Icon name="chevron-right" size={22} color={c.textTertiary} />
      </TouchableOpacity>
    </>
  ), [c, trackStyles, playlists.length, openTranscribe, transcribeSubtitle, pondTracks.length,
    voiceRecordings.length, offline.downloaded.size, offline.totalBytes]);

  const renderPlaylistRow = useCallback(({ item }) => {
    // Through the same accessor the page below uses, so a playlist's count and
    // its contents can't disagree — Transcribed is partly derived from the
    // local jobs list rather than wholly from tags.
    const count = tracksInPlaylist(item).length;
    return (
      <TouchableOpacity
        {...TAP_ONLY}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`${item}, ${count} track${count === 1 ? '' : 's'}`}
        onPress={() => { tapHaptic(); setOpenPlaylist(item); }}
        style={styles.row}
      >
        <View style={[styles.art, trackStyles.artTint]}>
          <Icon name="playlist-music" size={22} color={MUSIC_TINT(c)} />
        </View>
        <View style={trackStyles.body}>
          <Text style={trackStyles.titleIdle} numberOfLines={1}>{item}</Text>
          <Text style={trackStyles.source} numberOfLines={1}>
            {count} track{count === 1 ? '' : 's'}
          </Text>
        </View>
        <Icon name="chevron-right" size={22} color={c.textTertiary} />
      </TouchableOpacity>
    );
  }, [c, trackStyles, tracksInPlaylist]);

  /**
   * One playlist of recordings. Its own row rather than reusing the music
   * one, because the count means something different — "4 recordings", not
   * "4 tracks" — and the folder's own glyph is what says you are still
   * inside Voice recordings and not in the music playlists.
   */
  const renderRecordingPlaylistRow = useCallback(({ item }) => {
    const count = recordingsInPlaylist(item).length;
    return (
      <TouchableOpacity
        {...TAP_ONLY}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`${item}, ${recordingCountLabel(count)}`}
        onPress={() => { tapHaptic(); setOpenRecordingPlaylist(item); }}
        style={styles.row}
      >
        <View style={[styles.art, trackStyles.artTint]}>
          <Icon name="playlist-music" size={22} color={MUSIC_TINT(c)} />
        </View>
        <View style={trackStyles.body}>
          <Text style={trackStyles.titleIdle} numberOfLines={1}>{item}</Text>
          <Text style={trackStyles.source} numberOfLines={1}>{recordingCountLabel(count)}</Text>
        </View>
        <Icon name="chevron-right" size={22} color={c.textTertiary} />
      </TouchableOpacity>
    );
  }, [c, trackStyles, recordingsInPlaylist]);

  /** The Recordings / Playlists switch at the top of the folder. */
  const renderRecordingsTabs = useCallback(() => (
    <View style={styles.tabBar}>
      {[
        { key: 'recordings', label: recordingCountLabel(voiceRecordings.length) },
        {
          key: 'playlists',
          label: `${recordingPlaylists.length} playlist${recordingPlaylists.length === 1 ? '' : 's'}`,
        },
      ].map((t) => {
        const on = recordingsTab === t.key;
        return (
          <TouchableOpacity
            key={t.key}
            {...TAP_ONLY}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t.key === 'recordings' ? 'Recordings' : 'Playlists'}
            onPress={() => { tapHaptic(); setRecordingsTab(t.key); }}
            style={[styles.tab, {
              borderColor: on ? MUSIC_TINT(c) : c.border || c.textTertiary,
              backgroundColor: on ? `${MUSIC_TINT(c)}1f` : 'transparent',
            }]}
          >
            {/* The COUNT is the label. "Recordings (12)" and a tab that says
                "Recordings" next to a page already titled Voice recordings is
                the same word three times; the number is the part that is
                actually worth reading. */}
            <Text style={[styles.tabLabel, { color: on ? MUSIC_TINT(c) : c.textSecondary }]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  ), [c, recordingsTab, voiceRecordings.length, recordingPlaylists.length]);

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
    {/* The lifting layer. Permanently `lift` taller than the page (the negative
        bottom margin is static), so the rise into search is a pure transform
        with nothing underneath it to re-lay out — same construction as the
        Boards page, on the same shared timings. */}
    <Animated.View style={[{ flex: 1, marginBottom: -lift }, search.liftStyle]}>
      {/* The dock, above the list rather than inside it: in the list's header
          the field would be a child of whichever list is mounted, and swapping
          the library rows for result rows would tear the focused TextInput out
          mid-keystroke. */}
      {/* Floating, so it can leave with the vault header. Absolute and opaque:
          the lists reserve its height as top padding, so at rest nothing has
          moved and the rows simply pass under it as it goes. NOT a translate on
          the wrapper — that would carry dock and list together and move content
          at 2x the scroll. */}
      <Animated.View
        pointerEvents="box-none"
        onLayout={(e) => {
          const h = Math.round(e.nativeEvent.layout.height);
          if (h > 0) setDockH((prev) => (Math.abs(prev - h) >= 1 ? h : prev));
        }}
        style={[styles.dockFloat, { paddingTop: topInset + PICKER_GAP, paddingHorizontal: 16, paddingBottom: 10, backgroundColor: c.background }, chromeShift]}
      >
        <VaultSearchDock
          search={search}
          theme={theme}
          placeholder="Search your music"
          accessibilityLabel="Search your music"
          cancelLabel="Cancel music search"
          clearLabel="Clear music search"
          // No "add" here — music arrives by sharing a link, not from a picker.
          // Refresh is the key this tab actually wants next to its field.
          trailingIcon="refresh"
          trailingLabel="Refresh the music library"
          onTrailingPress={refreshLibrary}
          onChangeText={onQueryChange}
          testIDPrefix="music-search"
        />
        {/* The dissolve under the dock. Rows do not stop at the dock's edge,
            they fade out into it — which is what makes the chrome read as
            sitting over the page rather than as a lid clamped on top of it.
            Ramps to the page's own colour: the vault carries no wash, so that
            is plainly theme.colors.background here (NOT pageColor, which is
            the Planner's washed black and would be a shade light on this page).
            #RRGGBBAA — the same colour at zero alpha, so it fades to nothing
            rather than through grey. */}
        <LinearGradient
          pointerEvents="none"
          colors={[c.background, `${c.background}00`]}
          style={styles.dockFade}
        />
      </Animated.View>
      {onClose ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: insets.top + 6, paddingBottom: 8, paddingHorizontal: 10 }}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel="Back">
            <Icon name="chevron-left" size={28} color={c.textPrimary} />
          </TouchableOpacity>
          <Text style={{ fontSize: 22, color: c.textPrimary }}>
            <Text style={{ fontWeight: '100' }}>Music </Text>
            <Text style={{ fontWeight: '400' }}>Vault</Text>
          </Text>
        </View>
      ) : null}

      {error ? (
        <View style={[styles.error, { borderColor: c.border, backgroundColor: c.surfaceElevated }]}>
          <Text style={{ color: c.textSecondary }}>{error}</Text>
          {setupError ? (
            <TouchableOpacity
              accessibilityRole="button"
              onPress={retrySetup}
              style={{ marginTop: 8, alignSelf: 'flex-start' }}
            >
              <Text style={{ color: MUSIC_TINT(c), fontWeight: '700' }}>
                Retry player
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {loading && visibleTracks.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={c.textSecondary} />
        </View>
      ) : visibleTracks.length === 0 && !searching ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <Icon name="music-off" size={40} color={c.textTertiary} />
          <Text style={{ color: c.textSecondary, marginTop: 12, textAlign: 'center' }}>
            No music yet. Share a track (SoundCloud etc.) to the Download board and it lands here.
          </Text>
        </View>
      ) : (
        <Animated.FlatList {...SCROLL_INDICATOR}
          ref={listRef}
          // Searching swaps BOTH the data and the row — the library's cards for
          // the vault's result rows. `displayItems` rather than the matches
          // directly: during a cancel it is the frozen copy, so the rows do not
          // change under a page that is still gliding back down.
          // Three cases now, not two: the library browsing, the library
          // searched, and the web searched. The web's rows are not media rows
          // and have no `id`, so the key comes off the video.
          data={searching ? (webScope ? web.results : displayTracks) : visibleTracks}
          keyExtractor={(t) => String(t.id ?? t.videoId)}
          renderItem={searching ? (webScope ? renderWebRow : renderSearchRow) : renderTrack}
          onScroll={chromeScrollMain}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          // While searching the scope toggle and the count replace the
          // Playlists row: they are the one thing worth saying about a result
          // set, and a destination row in the middle of matches is something
          // to tap by accident.
          ListHeaderComponent={searching ? searchHeader : headerRows}
          // Which rows are being looked at — the pond resolves those, so the
          // tap that follows plays at once. See warmRows. Both props are
          // mount-stable on purpose: FlatList will not take a new one.
          onViewableItemsChanged={onRowsVisible}
          viewabilityConfig={VISIBLE_ROWS}
          // Nothing to add in the WEB scope: the header's status line already
          // says which of "keep typing", "searching", "nothing found" and
          // "this pond needs an update" is true, and saying it twice over an
          // empty list reads as two different failures.
          // Three empties, not two. The WEB scope still says nothing when a
          // search has FINISHED and found nothing — the header's status line
          // covers that, and saying it twice reads as two failures — but while
          // the first search is in flight it shows placeholder rows, so the
          // list has the same shape before and after the results land.
          // (A refined search keeps the previous rows, so this is only ever
          // the first search of a session.)
          ListEmptyComponent={
            searching && webScope && web.loading ? (
              <MusicWebResultSkeleton theme={theme} />
            ) : searching && !webScope ? (
              <Text style={[styles.resultCount, { color: c.textTertiary }]}>
                Nothing matches “{displayQuery.trim()}”.
              </Text>
            ) : null
          }
          extraData={`${current}:${isPlaying}:${ready}:${playlists.length}:${searching}:${scope}:${offlineSignature}`}
          // The transport bar, the dock, AND the lift — see libraryPadBottom.
          // listTopPad is the FLOATING DOCK's room, and this is the only list
          // under it — the pushed pages (playlists, voice recordings, shared)
          // each carry their own back header and no dock, so reserving it
          // there was a screen of nothing under their titles.
          contentContainerStyle={{ paddingTop: listTopPad, paddingBottom: libraryPadBottom }}
          ItemSeparatorComponent={() => <View style={styles.trackSep} />}
        />
      )}
    </Animated.View>

      {/* The transport (play/pause, skip, scrub) is PINNED, so it must end
          above the floating tab bar — `bottomInset` carries that height from
          the vault. Falls back to the safe-area inset when there's no bar. */}
      {nowTrack && (
        <View
          onLayout={(e) => {
            const h = Math.round(e.nativeEvent.layout.height);
            setNowBarH((prev) => (prev === h ? prev : h));
          }}
          style={[styles.nowBar, { backgroundColor: c.surfaceElevated, borderTopColor: c.border, paddingBottom: Math.max(insets.bottom, bottomInset) + 8 }]}
        >
          {/* The live caption: the line being spoken, above the transport.
              Playing a transcribed track follows along WITHOUT being asked —
              this is the whole of it when the vault is what's on screen, and
              it opens the full transcript when there's more to read than one
              line. */}
          {hasFollowAlong && (
            <TouchableOpacity
              activeOpacity={0.75}
              onPress={() => { tapHaptic(); setFollowOpen(true); }}
              accessibilityRole="button"
              accessibilityLabel="Open the transcript and follow along"
              testID="follow-along-caption"
              style={[styles.captionRow, { borderBottomColor: c.border }]}
            >
              <Icon name="text-box-outline" size={15} color={MUSIC_TINT(c)} />
              <Text style={[styles.captionText, { color: c.textSecondary }]} numberOfLines={1}>
                {transcriptError
                  || (transcriptLoading ? 'Fetching the transcript…' : (caption || 'Transcript'))}
              </Text>
              <Icon name="chevron-up" size={18} color={c.textTertiary} />
            </TouchableOpacity>
          )}

          <Pressable
            disabled={!ready}
            onLayout={(e) => { barWidthRef.current = e.nativeEvent.layout.width || 1; }}
            onPress={(e) => seekFromFraction(e.nativeEvent.locationX / barWidthRef.current)}
            style={styles.seekHit}
          >
            <View style={[styles.seekTrack, { backgroundColor: c.border }]}>
              <View style={{ height: '100%', borderRadius: 2, width: `${duration ? Math.min(100, (position / duration) * 100) : 0}%`, backgroundColor: MUSIC_TINT(c) }} />
            </View>
          </Pressable>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, marginTop: 2 }}>
            <Text style={{ fontSize: 11, color: c.textTertiary }}>{fmtTime(position)}</Text>
            <Text style={{ fontSize: 11, color: c.textTertiary }}>{fmtTime(duration)}</Text>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 6, gap: 12 }}>
            <View style={[styles.art, trackStyles.artTint]}>
              <Icon name="music-note" size={20} color={MUSIC_TINT(c)} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: c.textPrimary }} numberOfLines={1}>{titleOf(nowTrack)}</Text>
              {/* The source line carries the wait. This bar is where the play
                  button is, so it is where someone decides the tap did not
                  work and presses it again — which only restarts the wait. */}
              <Text style={{ fontSize: 12, color: c.textTertiary }} numberOfLines={1}>
                {preparing ? waitingLabel : (sourceOf(nowTrack) || 'audio')}
              </Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Previous track"
              onPress={previous}
              disabled={!canPrev}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Icon name="skip-previous" size={30} color={canPrev ? c.textPrimary : c.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={preparing ? waitingLabel : isPlaying ? 'Pause' : 'Play'}
              onPress={togglePlayback}
              disabled={!ready}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              {/* Still tappable while preparing - it is how you call off a
                  wait you have changed your mind about - but it no longer
                  LOOKS like a play button that did nothing. */}
              {preparing
                ? (
                  <View style={styles.transportSpinner}>
                    <PreparingRing percent={preparingPct} tint={MUSIC_TINT(c)} track={c.border} />
                  </View>
                )
                : <Icon name={isPlaying ? 'pause-circle' : 'play-circle'} size={44} color={MUSIC_TINT(c)} />}
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Next track"
              onPress={next}
              disabled={!canNext}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Icon name="skip-next" size={30} color={canNext ? c.textPrimary : c.textMuted} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* A–Z scrub rail for the track list — the Music page's own, so the rail
          no longer vanishes when you swipe over from Boards. Bounded by the
          vault header above and the transport bar below, so the thumb can't run
          under either. */}
      {musicScrubEnabled && (
        <TimelineScrubber
          scrollY={musicScrollY}
          maxScroll={musicMaxScroll}
          data={musicScrubData}
          onJump={handleMusicScrubJump}
          inverted={false}
          topInset={topInset + 8}
          bottomInset={(nowBarH || Math.max(insets.bottom, bottomInset)) + 12}
          accent={MUSIC_TINT(c)}
          dark={theme.mode === 'dark'}
        />
      )}

      {/* Tracks other people gave me, pushed over the library like Playlists.
          Read-only: a track share is 'view', so the row plays and that is all
          — no rename, no playlist filing, no delete. Leave is the recipient's
          half of the same revoke the owner has. */}
      <EdgeSwipePage visible={sharedOpen} onClose={() => setSharedOpen(false)}>
        <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top + 6 }}>
          <View style={styles.pageHeader}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Back to all songs"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              onPress={() => { tapHaptic(); setSharedOpen(false); }}
              style={styles.pageBackBtn}
            >
              <Icon name="chevron-left" size={28} color={c.textPrimary} />
            </TouchableOpacity>
            <Text style={[styles.pageTitle, { color: c.textPrimary }]} numberOfLines={1}>
              Shared with you
            </Text>
          </View>

          <Animated.FlatList {...SCROLL_INDICATOR}
            onScroll={chromeScroll}
            scrollEventThrottle={16}
            data={pondTracks}
            keyExtractor={(t) => String(t.shareId)}
            contentContainerStyle={{ paddingBottom: listPadBottom }}
            ItemSeparatorComponent={() => <View style={styles.trackSep} />}
            extraData={`${current}:${isPlaying}:${ready}:${offlineSignature}`}
            ListEmptyComponent={(
              <View style={styles.pageEmpty}>
                <Icon name="account-music-outline" size={40} color={c.textTertiary} />
                <Text style={{ color: c.textSecondary, marginTop: 12, textAlign: 'center' }}>
                  Nothing yet. A track someone in your pond shares with you lands here.
                </Text>
              </View>
            )}
            renderItem={({ item }) => {
              const active = String(item.id) === String(activeTrack?.mediaId);
              return (
                <TouchableOpacity
                  {...TAP_ONLY}
                  testID={`shared-track-${item.shareId}`}
                  activeOpacity={0.7}
                  disabled={!ready}
                  // The whole list is the queue, so skip moves through the
                  // other shared tracks rather than jumping back into mine.
                  onPress={() => playTrack(item, pondTracks)}
                  style={styles.row}
                >
                  <View style={[styles.art, trackStyles.artTint]}>
                    <Icon
                      name={active && isPlaying ? 'pause' : 'music-note'}
                      size={20}
                      color={active ? MUSIC_TINT(c) : c.textSecondary}
                    />
                  </View>
                  <View style={trackStyles.body}>
                    <Text style={active ? trackStyles.titleActive : trackStyles.titleIdle} numberOfLines={1}>
                      {titleOf(item)}
                    </Text>
                    <Text style={trackStyles.source} numberOfLines={1}>
                      {`From ${item.ownerName}`}
                    </Text>
                  </View>
                  {item.duration ? <Text style={trackStyles.duration}>{fmtTime(item.duration)}</Text> : null}
                  <TouchableOpacity
                    testID={`shared-track-leave-${item.shareId}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Leave ${titleOf(item)}`}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 8 }}
                    onPress={() => leaveSharedTrack(item)}
                    style={styles.moreBtn}
                  >
                    <Icon name="exit-to-app" size={20} color={c.textTertiary} />
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </EdgeSwipePage>

      {/* ── Voice recordings, pushed over the library ───────────────────────
          The folder's own page, and the ONLY way to these tracks: they are not
          in the library list and not in the queue it plays. A tap here plays
          them as their own queue (`playRows` via renderTrack's `queue`), so
          Next walks the recordings and never wanders into the music.

          Each row keeps its ⋯ menu, which is where "Move back to music" is —
          a folder you cannot take something out of is a trap. */}
      {/* Everything kept on the phone. A page rather than a filter on the
          library, matching Voice recordings and Playlists — and it is the one
          list that still reads correctly with no pond at all. */}
      <EdgeSwipePage visible={downloadsOpen} onClose={() => setDownloadsOpen(false)}>
        <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top + 6 }}>
          <View style={styles.pageHeader}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Back to all songs"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              onPress={() => { tapHaptic(); setDownloadsOpen(false); }}
              style={styles.pageBackBtn}
            >
              <Icon name="chevron-left" size={28} color={c.textPrimary} />
            </TouchableOpacity>
            <Text style={[styles.pageTitle, { color: c.textPrimary }]} numberOfLines={1}>
              On this device
            </Text>
            {downloadedTracks.length ? (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Remove every download"
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                onPress={() => {
                  tapHaptic();
                  // Confirmed, because it is the only control here that can
                  // undo an hour of downloading in one tap. The wording says
                  // the tracks themselves are safe — this is the one place
                  // someone could reasonably fear it means "delete my music".
                  Alert.alert(
                    'Remove downloads?',
                    `${downloadedTracks.length} track${downloadedTracks.length === 1 ? '' : 's'} (${formatBytes(offline.totalBytes)}) will be removed from this phone. They stay in the pond.`,
                    [
                      { text: 'Keep them', style: 'cancel' },
                      { text: 'Remove', style: 'destructive', onPress: () => { offline.clear(); setDownloadsOpen(false); } },
                    ]
                  );
                }}
                style={styles.pageBackBtn}
              >
                <Icon name="delete-outline" size={22} color={c.textTertiary} />
              </TouchableOpacity>
            ) : null}
          </View>
          <Animated.FlatList {...SCROLL_INDICATOR}
            onScroll={chromeScroll}
            scrollEventThrottle={16}
            testID="music-downloads-list"
            data={downloadedTracks}
            keyExtractor={(t) => String(t.id)}
            renderItem={({ item }) => renderTrack({
              item,
              queue: downloadedTracks,
              onOptions: (id) => { setDownloadsOpen(false); setSheetId(id); },
            })}
            extraData={`${current}:${isPlaying}:${ready}:${downloadedTracks.length}:${offlineSignature}`}
            contentContainerStyle={{ paddingBottom: listPadBottom }}
            ItemSeparatorComponent={() => <View style={styles.trackSep} />}
            ListEmptyComponent={(
              <View style={styles.pageEmpty}>
                <Icon name="cloud-off-outline" size={40} color={c.textTertiary} />
                <Text style={{ color: c.textSecondary, marginTop: 12, textAlign: 'center' }}>
                  Nothing is kept here yet. Open a track's ⋯ menu and choose
                  “Keep on this device” — it will play with no pond to reach.
                </Text>
              </View>
            )}
          />
        </View>
      </EdgeSwipePage>

      {/* Voice recordings. Two views of ONE folder, switched by the tabs
          under the title: the flat list of everything filed here, and the
          same recordings grouped by their other tags. A playlist opens as a
          level-2 overlay, exactly as a music playlist does. */}
      <EdgeSwipePage
        visible={recordingsOpen}
        onClose={() => setRecordingsOpen(false)}
        // While a playlist is open on top, the parent's back-swipe must not
        // fire underneath it — one drag would otherwise close both levels.
        swipeEnabled={!openRecordingPlaylist}
      >
        <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top + 6 }}>
          <View style={styles.pageHeader}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Back to all songs"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              onPress={() => { tapHaptic(); setRecordingsOpen(false); }}
              style={styles.pageBackBtn}
            >
              <Icon name="chevron-left" size={28} color={c.textPrimary} />
            </TouchableOpacity>
            <Text style={[styles.pageTitle, { color: c.textPrimary }]} numberOfLines={1}>
              {VOICE_RECORDINGS_LABEL}
            </Text>
          </View>

          {/* Only once something is filed. An empty folder has one thing to
              say — how to put something in it — and a pair of tabs reading
              "0 recordings / 0 playlists" above that is noise. */}
          {voiceRecordings.length > 0 ? renderRecordingsTabs() : null}

          {recordingsTab === 'playlists' ? (
            <Animated.FlatList {...SCROLL_INDICATOR}
              onScroll={chromeScroll}
              scrollEventThrottle={16}
              testID="voice-recording-playlists-list"
              data={recordingPlaylists}
              keyExtractor={(name) => name}
              renderItem={renderRecordingPlaylistRow}
              extraData={`${recordingPlaylists.length}:${voiceRecordings.length}`}
              contentContainerStyle={{ paddingBottom: listPadBottom }}
              ItemSeparatorComponent={() => <View style={styles.trackSep} />}
              ListEmptyComponent={(
                <View style={styles.pageEmpty}>
                  <Icon name="playlist-music-outline" size={40} color={c.textTertiary} />
                  <Text style={{ color: c.textSecondary, marginTop: 12, textAlign: 'center' }}>
                    No playlists in here yet. Open a recording's ⋯ menu and use
                    “Add to playlist” — the name you give it becomes a group in
                    this folder, kept apart from your music playlists.
                  </Text>
                </View>
              )}
            />
          ) : (
            <Animated.FlatList {...SCROLL_INDICATOR}
              onScroll={chromeScroll}
              scrollEventThrottle={16}
              testID="voice-recordings-list"
              data={voiceRecordings}
              keyExtractor={(t) => String(t.id)}
              renderItem={({ item }) => renderTrack({
                item,
                queue: voiceRecordings,
                // Standing down to show the menu lands you in the library — which
                // is where the track itself goes if you pick "Move back to music",
                // so the two agree.
                onOptions: (id) => { setRecordingsOpen(false); setSheetId(id); },
              })}
              extraData={`${current}:${isPlaying}:${ready}:${voiceRecordings.length}:${offlineSignature}`}
              contentContainerStyle={{ paddingBottom: listPadBottom }}
              ItemSeparatorComponent={() => <View style={styles.trackSep} />}
              ListEmptyComponent={(
                <View style={styles.pageEmpty}>
                  <Icon name="microphone-outline" size={40} color={c.textTertiary} />
                  <Text style={{ color: c.textSecondary, marginTop: 12, textAlign: 'center' }}>
                    Nothing filed here yet. Open a track's ⋯ menu in your music and
                    move it to {VOICE_RECORDINGS_LABEL} — it leaves the library and
                    stops playing with everything else.
                  </Text>
                </View>
              )}
            />
          )}

          {/* Level 2: one playlist's recordings. An overlay page so the back
              swipe returns to the playlist list rather than all the way out,
              same as the music playlists page. */}
          <EdgeSwipePage overlay visible={!!openRecordingPlaylist} onClose={() => setOpenRecordingPlaylist(null)}>
            <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top + 6 }}>
              <View style={styles.pageHeader}>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Back to recording playlists"
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  onPress={() => { tapHaptic(); setOpenRecordingPlaylist(null); }}
                  style={styles.pageBackBtn}
                >
                  <Icon name="chevron-left" size={28} color={c.textPrimary} />
                </TouchableOpacity>
                <Text style={[styles.pageTitle, { color: c.textPrimary }]} numberOfLines={1}>
                  {openRecordingPlaylist || ''}
                </Text>
              </View>
              <Animated.FlatList {...SCROLL_INDICATOR}
                onScroll={chromeScroll}
                scrollEventThrottle={16}
                testID="voice-recording-playlist-tracks"
                data={openRecordingPlaylistRows}
                keyExtractor={(t) => String(t.id)}
                // The queue is THIS playlist, so skip walks the group you
                // opened rather than every recording you have.
                renderItem={({ item }) => renderTrack({
                  item,
                  queue: openRecordingPlaylistRows,
                  onOptions: (id) => { setOpenRecordingPlaylist(null); setRecordingsOpen(false); setSheetId(id); },
                })}
                extraData={`${current}:${isPlaying}:${ready}:${openRecordingPlaylistRows.length}:${offlineSignature}`}
                contentContainerStyle={{ paddingBottom: listPadBottom }}
                ItemSeparatorComponent={() => <View style={styles.trackSep} />}
              />
            </View>
          </EdgeSwipePage>
        </View>
      </EdgeSwipePage>

      {/* Playlists, pushed over the library. Level 1 lists the playlists; level
          2 lists one playlist's tracks. A left-edge swipe backs out — from a
          playlist to the playlist list, and from there to all songs — matching
          every other pushed page in the app. */}
      <EdgeSwipePage
        visible={playlistsOpen}
        onClose={closePlaylists}
        // While a playlist is open on top, the parent's back-swipe must not fire
        // underneath it — otherwise one drag would close BOTH levels at once.
        swipeEnabled={!openPlaylist}
      >
        <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top + 6 }}>
          <View style={styles.pageHeader}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Back to all songs"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              onPress={() => { tapHaptic(); closePlaylists(); }}
              style={styles.pageBackBtn}
            >
              <Icon name="chevron-left" size={28} color={c.textPrimary} />
            </TouchableOpacity>
            <Text style={[styles.pageTitle, { color: c.textPrimary }]} numberOfLines={1}>Playlists</Text>
          </View>

          <Animated.FlatList {...SCROLL_INDICATOR}
            onScroll={chromeScroll}
            scrollEventThrottle={16}
            data={playlists}
            keyExtractor={(name) => name}
            renderItem={renderPlaylistRow}
            contentContainerStyle={{ paddingBottom: listPadBottom }}
            ItemSeparatorComponent={() => <View style={styles.trackSep} />}
            ListEmptyComponent={(
              <View style={styles.pageEmpty}>
                <Icon name="playlist-music-outline" size={40} color={c.textTertiary} />
                <Text style={{ color: c.textSecondary, marginTop: 12, textAlign: 'center' }}>
                  No playlists yet. Open a track's ⋯ menu and add it to one.
                </Text>
              </View>
            )}
          />

          {/* One playlist's tracks — its OWN pushed page, nested INSIDE this one
              rather than being a second state of it. That's what makes the
              back-swipe work at this level too: a committed swipe animates the
              page off and calls onClose, so a level that shares its parent's
              page would animate out and then have nothing left to show.
              `overlay` is required for the nesting — iOS won't present a second
              sibling Modal over an open one. */}
          <EdgeSwipePage overlay visible={!!openPlaylist} onClose={() => setOpenPlaylist(null)}>
            <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top + 6 }}>
              <View style={styles.pageHeader}>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Back to playlists"
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  onPress={() => { tapHaptic(); setOpenPlaylist(null); }}
                  style={styles.pageBackBtn}
                >
                  <Icon name="chevron-left" size={28} color={c.textPrimary} />
                </TouchableOpacity>
                <Text style={[styles.pageTitle, { color: c.textPrimary }]} numberOfLines={1}>
                  {openPlaylist || ''}
                </Text>
              </View>
              <Animated.FlatList {...SCROLL_INDICATOR}
            onScroll={chromeScroll}
            scrollEventThrottle={16}
                data={openPlaylistTracks}
                keyExtractor={(t) => String(t.id)}
                // THE PLAYLIST IS THE QUEUE. Handed `renderTrack` bare, FlatList
                // calls it with {item, index} and no `queue` — so playTrack fell
                // through to playMedia, which builds the queue from the whole
                // library. Tapping track 3 of a CD then played the library from
                // track 3 onward and wandered out of the playlist at its end.
                // Voice recordings always passed its own rows for this reason;
                // this list is the one that did not.
                renderItem={({ item }) => renderTrack({ item, queue: openPlaylistTracks })}
                extraData={`${activeTrack?.mediaId}:${isPlaying}:${ready}:${offlineSignature}`}
                contentContainerStyle={{ paddingBottom: listPadBottom }}
                ItemSeparatorComponent={() => <View style={styles.trackSep} />}
              />
            </View>
          </EdgeSwipePage>
        </View>
      </EdgeSwipePage>

      {/* ── Transcribe, pushed over the library ─────────────────────────────
          The Settings card, verbatim, in the tab where the audio is: source
          picker, the pond's own WhisperX options (model, speakers, language),
          and the list of jobs. Opened from the library's Transcribe row, or
          from a track's ⋯ with that track already on its way. */}
      <EdgeSwipePage visible={transcribeOpen} onClose={closeTranscribe}>
        <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top + 6 }}>
          <View style={styles.pageHeader}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Back to all songs"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              onPress={() => { tapHaptic(); closeTranscribe(); }}
              style={styles.pageBackBtn}
            >
              <Icon name="chevron-left" size={28} color={c.textPrimary} />
            </TouchableOpacity>
            <Text style={[styles.pageTitle, { color: c.textPrimary }]} numberOfLines={1}>
              Transcribe
            </Text>
          </View>
          <ScrollView {...SCROLL_INDICATOR}
            contentContainerStyle={{ padding: 16, paddingBottom: listPadBottom + 8 }}
            keyboardShouldPersistTaps="handled"
          >
            <TranscriptionPanel
              active={transcribeOpen}
              autoSend={autoSendTrack}
              onAutoSendHandled={() => setAutoSendTrack(null)}
            />
          </ScrollView>
        </View>
      </EdgeSwipePage>

      {/* ── Follow along ────────────────────────────────────────────────────
          The playing track's transcript, with the line being spoken outlined
          as it is said. Tapping a line seeks there. */}
      <EdgeSwipePage visible={followOpen} onClose={() => setFollowOpen(false)}>
        <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top + 6 }}>
          <View style={styles.pageHeader}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Back to all songs"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              onPress={() => { tapHaptic(); setFollowOpen(false); }}
              style={styles.pageBackBtn}
            >
              <Icon name="chevron-left" size={28} color={c.textPrimary} />
            </TouchableOpacity>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.pageTitle, { color: c.textPrimary }]} numberOfLines={1}>
                {nowTrack ? titleOf(nowTrack) : 'Transcript'}
              </Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
              onPress={togglePlayback}
              disabled={!ready}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={styles.pageBackBtn}
            >
              <Icon name={isPlaying ? 'pause-circle' : 'play-circle'} size={32} color={MUSIC_TINT(c)} />
            </TouchableOpacity>
          </View>
          <FollowAlongTranscript
            turns={transcript}
            position={position}
            onSeek={seekTo}
            loading={transcriptLoading}
            error={transcriptError}
            theme={theme}
            contentInsetBottom={Math.max(insets.bottom, bottomInset)}
            testID="follow-along"
          />
        </View>
      </EdgeSwipePage>

      {/* Per-track options, as a card that rises from the bottom edge. Rendered
          LAST so it stacks over the list and the transport bar; it's an in-tree
          overlay rather than a Modal because the vault itself can be inside one
          (a second sibling Modal silently never shows on iOS). */}
      <TrackActionsSheet
        visible={!!sheetTrack}
        track={sheetTrack}
        title={sheetTrack ? titleOf(sheetTrack) : ''}
        subtitle={sheetTrack ? (sourceOf(sheetTrack) || 'Audio') : ''}
        isActive={!!sheetTrack && String(sheetTrack.id) === String(activeTrack?.mediaId)}
        isPlaying={isPlaying}
        // A recording is offered the playlists that exist INSIDE its folder,
        // not the music ones. Tags are global, so either list would "work" —
        // but suggesting your albums while filing a sermon is how a recording
        // ends up tagged into a music playlist it can never be seen in (the
        // library's playlist index is built from music rows only).
        playlists={sheetTrack && isVoiceRecording(sheetTrack) ? recordingPlaylists : playlists}
        // The reserved tag is never a playlist. Left in, it would show as one
        // the recording is "already on" — and the sheet draws those as a tick,
        // one tap from a write that silently moves the recording back into the
        // music library. That is what "Move back to music" is for, with a
        // label saying so.
        currentPlaylists={sheetTrack
          ? tagsOf(sheetTrack).filter((t) => String(t).trim().toLowerCase() !== VOICE_RECORDINGS_TAG.toLowerCase())
          : []}
        busy={sheetBusy}
        transcriptState={sheetTranscriptState}
        onPlay={sheetPlay}
        onShare={sheetShare}
        onRename={sheetRename}
        onAddToPlaylist={sheetAddToPlaylist}
        onToggleRecording={sheetToggleRecording}
        isRecording={!!sheetTrack && isVoiceRecording(sheetTrack)}
        onTranscribe={sheetTranscribe}
        onToggleOffline={sheetTrack ? () => toggleOffline(sheetTrack) : undefined}
        offlineState={sheetTrack ? offline.statusOf(sheetTrack.id).state : 'absent'}
        offlineProgress={sheetTrack ? (offline.statusOf(sheetTrack.id).progress || 0) : 0}
        onDelete={sheetDelete}
        onClose={closeSheet}
        bottomInset={Math.max(insets.bottom, bottomInset)}
        colors={c}
        api={api}
        baseUrl={getBaseUrl?.()}
        // A grant or a revoke changes the face count on the row behind — and
        // the strip of tracks OTHER people have shared, if that just changed
        // hands too.
        onPondChanged={refreshPondTracks}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // The floating search dock. zIndex so it paints over the lists it is
  // stacked with rather than relying on tree order.
  dockFloat: { position: 'absolute', left: 0, right: 0, top: 0, zIndex: 5 },
  // Hangs BELOW the dock (negative bottom) so it dissolves the page under it
  // without eating into the dock's own room.
  dockFade: { position: 'absolute', left: 0, right: 0, bottom: -14, height: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  // Hairline grey rule, inset EQUALLY on both sides so it sits centred between
  // rows rather than hanging off the artwork's left edge (row padding is 16).
  trackSep: { height: StyleSheet.hairlineWidth, marginHorizontal: 16, backgroundColor: 'rgba(142,142,147,0.4)' },
  // "6 tracks" / "Nothing matches …", above the result rows.
  resultCount: { fontSize: 12, fontWeight: '700', paddingHorizontal: 18, paddingTop: 2, paddingBottom: 10 },
  // The search header: the scope toggle, then the status line. 16 to line the
  // toggle's box up with the rows beneath it and the dock's field above.
  searchHeader: { paddingTop: 2 },
  scopeToggle: { paddingHorizontal: 16, paddingBottom: 8 },
  moreBtn: { paddingLeft: 2, paddingVertical: 2 },
  // 14 + the shared result row's own 2 = 16, the inset every other row and
  // hairline on this screen uses. See the note in renderSearchRow for why
  // this lives here rather than on the row or the list.
  searchRowInset: { paddingHorizontal: 14 },
  pageHeader: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingBottom: 10 },
  pageBackBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  pageTitle: { flex: 1, fontSize: 22, fontWeight: '600' },
  pageEmpty: { alignItems: 'center', justifyContent: 'center', padding: 32, paddingTop: 80 },
  // The Recordings / Playlists switch. A segmented control rather than two
  // pushed pages: these are two views of the SAME folder, and making one of
  // them a destination you navigate into would imply it holds different
  // things. Inset 16 to sit on the rows' own left edge.
  tabBar: { flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingBottom: 10 },
  tab: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tabLabel: { fontSize: 13, fontWeight: '700' },
  art: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  // The size of the play glyph it stands in for, so the transport's spacing
  // does not shift when a track starts loading.
  transportSpinner: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  error: { marginHorizontal: 16, marginBottom: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  nowBar: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8 },
  seekHit: { paddingVertical: 8, paddingHorizontal: 16 },
  seekTrack: { height: 4, borderRadius: 2, overflow: 'hidden' },
  // The live transcript line, across the top of the transport bar.
  captionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
    marginBottom: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  captionText: { flex: 1, minWidth: 0, fontSize: 12.5, fontStyle: 'italic' },
});
