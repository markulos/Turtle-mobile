import React, { useState, useEffect, useLayoutEffect, useCallback, useContext, useRef, useMemo } from 'react';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Dimensions,
  Modal,
  Animated,
  Pressable,
  ScrollView,
  Platform,
  Easing,
  InteractionManager,
  PanResponder,
  TextInput,
  Keyboard,
  InputAccessoryView,
  KeyboardAvoidingView,
  StatusBar,
  // RN's own Share — the only one that can hand the OS a URL rather than a
  // file. expo-sharing shares files exclusively, which is exactly the thing a
  // link is meant to avoid.
  Share as RNShareSheet,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
// The viewer's media-cell layer (video cell, progressive image, zoomable image
// cell) — extracted verbatim; see viewerMedia.jsx.
import { FullScreenVideoPlayer, ImageViewer } from './viewerMedia';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { sweepTransientCaches } from '../../../utils/cacheManager';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { LinearGradient } from 'expo-linear-gradient';
import { impactHaptic } from '../../../utils/haptics';
// Dev-only responsiveness watchdog — every call below compiles to an immediate
// return in a release build (see utils/gestureProbe).
import gestureProbe from '../../../utils/gestureProbe';
import { buildBucketsUrl, buildGalleryUrl } from '../../../utils/galleryFilters';
// DEV-ONLY commit timer — names the tree that owned the JS thread when the probe
// reports a stall. Identity function outside __DEV__. See components/DevProfiler.
import DevProfiler from '../../../components/DevProfiler';
import { useGalleryFilters } from '../../../utils/useGalleryFilters';
import GalleryFilterSheet from './GalleryFilterSheet';
// Public capability links for one item — the "send a link that plays in the
// chat" half of the share sheet. See services/mediaShareLinks.js for why a
// video's link has to wait on a conversion before it can be handed out.
import { prepareShareLink } from '../../../services/mediaShareLinks';

// react-native-share (unlike expo-sharing) can hand the OS a whole ARRAY of
// files in ONE share sheet — so sharing many vault photos matches the native
// iOS Photos experience (one sheet, all photos) instead of one sheet per photo.
// Loaded LAZILY + defensively (like utils/haptics): its native module only
// exists in a build that bundled it, so a dev build made BEFORE it was added
// would crash the whole runtime on a top-level import. Absent → we fall back to
// the sequential expo-sharing path below, which still works (just one sheet per
// photo) until the app is rebuilt.
let _rnShareChecked = false;
let _RNShare = null;
const getRNShare = () => {
  if (_rnShareChecked) return _RNShare;
  _rnShareChecked = true;
  try {
    // react-native-share's codegen spec runs `TurboModuleRegistry.getEnforcing`
    // at module load, so `require('react-native-share')` itself THROWS in a
    // binary that lacks the native module — this try/catch turns that into a
    // clean null (→ per-photo fallback) instead of a crash. When the native side
    // IS present (after a build that bundled it), require succeeds and we return
    // the class; the call site still guards `.open()` in its own try/catch as
    // defense-in-depth. NOTE: installing the npm package is NOT enough — the app
    // must be natively rebuilt (EAS build / expo prebuild) for require to succeed.
    const mod = require('react-native-share');
    _RNShare = mod?.default || mod || null;
    if (_RNShare && typeof _RNShare.open !== 'function') _RNShare = null;
  } catch (e) {
    _RNShare = null;
  }
  return _RNShare;
};
// Context hooks — these used to live mid-file (lines 41 + 137 historical),
// which triggered an `import/first` warning on every Fast Refresh and
// was the recurring console noise the user was seeing. Consolidated here.
import { useServer } from '../../../context/ServerContext';
import { FlashList } from '@shopify/flash-list';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedKeyboard,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import TimelineScrubber from './TimelineScrubber';
import { dockOccupied } from '../../../components/tabBarLayout';
import MusicVault from './MusicVault';
import EdgeSwipePage from './EdgeSwipePage';
import { useVaultUploadActions, useVaultUploadLifecycle } from '../../../context/VaultUploadContext';
import { useMediaVersion } from '../../../context/DownloadsContext';
import { useTheme } from '../../../context/ThemeContext';
import PhotoVaultBoardsPage from './PhotoVaultBoardsPage';
import AlbumShareSheet from './AlbumShareSheet';
import AlbumActionsSheet from './AlbumActionsSheet';
import ShareInsightsPage from './ShareInsightsPage';
import {
  buildPhotoVaultBoards,
  formatBoardMetadata,
  normalizeAlbumsPayload,
} from '../../../utils/photoVaultBoards';

// Create an animated version of FlashList to match our existing architecture
const AnimatedFlashList = Animated.createAnimatedComponent(FlashList);

// ── Streaming media upload ───────────────────────────────────────────────────
// The whole upload pipeline (streaming uploader + two-phase watchdog + retries
// + duplicate skipping + cross-session persistence) lives in
// context/VaultUploadContext.jsx now — app-level, so batches keep running with
// a global progress pill while the user leaves this screen, and resume on the
// next launch if the app is killed mid-batch. This screen only PICKS the
// assets and enqueues them (see executeUpload).

// Master kill-switch for the Instagram-style grid video autoplay preview.
// Flip to false to fully disable (cells fall back to the static thumbnail).
const GRID_VIDEO_PREVIEW = true;
// "Jump to latest" pill: how long after scrolling STOPS before it fades away on
// its own (a motionless grid sheds the pill). Kept short — a "very brief" idle.
const GRID_JUMP_IDLE_MS = 1500;

// Constants for hitSlop to prevent re-renders
const HIT_SLOP_10 = { top: 10, bottom: 10, left: 10, right: 10 };
// Breathing room between the vault header (title + Boards/Music picker) and the
// content of whichever page is showing. Both pager pages use it so they start on
// the same line; PhotoVaultBoardsPage applies the same value internally.
const VAULT_PICKER_GAP = 14;
const HIT_SLOP_15 = { top: 15, bottom: 15, left: 15, right: 15 };
const HIT_SLOP_20 = { top: 20, bottom: 20, left: 20, right: 20 };
// Biggest video we'll speculatively pull to disk so its share sheet is instant.
// Above this the share path downloads on demand behind the progress overlay.
const VIDEO_SHARE_WARM_MAX_BYTES = 60 * 1024 * 1024;

/**
 * Alert.alert as something you can await.
 *
 * The share-link flow has two "this works, but not how you'd expect" moments
 * that have to be answered before the OS sheet is presented — and a callback
 * Alert in the middle of an async function means either dropping the rest of
 * it into the callback or racing the sheet against the user's tap.
 *
 * @returns {Promise<boolean>} true if the user chose to continue
 */
function confirmAsync(title, message, confirmLabel) {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: confirmLabel, onPress: () => resolve(true) },
      ],
      // Android's back button / outside tap dismisses without either handler,
      // and an unresolved promise here would hang the share for good.
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

// ── Slot model for the grid ─────────────────────────────────────────────────
// A loading tile is NOT a different thing from a loaded tile — it's the same
// SLOT before its data arrives. Slot objects are cached by index so their
// references stay stable across rebuilds of the virtual array: memoized cells
// skip re-rendering for slots that didn't change, and a landing page becomes
// an in-place image fade on an already-mounted cell instead of an
// unmount/remount (the old skeleton→cell identity swap was the "popcorn"
// pop-in the user disliked). The old per-cell pulsing/shimmering skeleton
// components are gone with it — resting tiles are quiet static surfaces,
// matching how iCloud / Google Photos grids sit while content streams in.
const SLOT_CACHE = [];
const slotAt = (i) => SLOT_CACHE[i] || (SLOT_CACHE[i] = { id: `vskel-${i}`, isSkeleton: true });

// Format seconds to MM:SS (null when no duration). Module-level so the video
// cell + the detail view share one copy.
const formatDuration = (seconds) => {
  if (!seconds) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
};

const { width, height } = Dimensions.get('window');
// The vault is deliberately haptic-free: touch feedback on the grid, the
// board cards, the pinch column step and the toolbar buttons was removed on
// request. Don't reintroduce per-tap buzzes here.

// Albums hidden from the Boards (albums) tab. "Audio" isn't a photo/video
// album — it's the drop box the audio-download flow tags its files with, and
// MusicVault already surfaces that content. Showing it here just puts an
// always-empty (kind="visual") card in the photo grid. Compared lowercased.
const HIDDEN_ALBUMS = new Set(['audio']);

// Month/year from a 'YYYY-MM' bucket key → "June 2026".
const MONTH_NAMES =['January','February','March','April','May','June','July','August','September','October','November','December'];
const labelFromMonthKey = (key) => {
  if (!key || key === 'unknown') return 'Undated';
  const [y, m] = String(key).split('-');
  const mi = parseInt(m, 10) - 1;
  return mi >= 0 && mi < 12 ? `${MONTH_NAMES[mi]} ${y}` : y;
};

// Best available date for a media item (asset creation time, else upload time).
const dateOf = (item) => {
  const raw = item && (item.originalDate || item.uploadDate);
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
};
// "March 2024" label for the scrubber bubble.
const monthLabelOf = (item) => {
  const d = dateOf(item);
  return d ? d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '';
};

// Parse an item's tags ONCE per item object. The tag dictionary, search
// filter, and bulk editors all walk thousands of items, and re-running
// JSON.parse on identical strings dominated those rebuilds (every pagination
// append re-parsed the whole list). WeakMap keys on the item object itself:
// refreshed arrays carry new objects so they re-parse naturally, and evicted
// items GC away with their cache entry.
const parsedTagsCache = new WeakMap();
const tagsOf = (item) => {
  if (!item || typeof item !== 'object') return [];
  let t = parsedTagsCache.get(item);
  if (t !== undefined) return t;
  try { t = JSON.parse(item.tags || '[]'); } catch (e) { t = []; }
  if (!Array.isArray(t)) t = [];
  parsedTagsCache.set(item, t);
  return t;
};

const THUMBNAIL_SIZE = width / 3 - 0.5;
// The black gutter between pager pages. iOS Photos uses ~20–24pt; 15 read as
// the photos almost touching. Every piece of the paging model derives from
// ITEM_WIDTH (getItemLayout, snapToInterval, the open-offset, index math), so
// changing GAP here changes all of them consistently — the historical
// "clipped right edge" bug came from mixed alignment assumptions, not from
// this constant.
const GAP = 24;
const ITEM_WIDTH = width + GAP;

// How long after the pager's last scroll frame a single-tap is still treated
// as part of the swipe rather than a chrome toggle. Long enough to cover the
// gap between finger-up and the first momentum frame (~1 frame) plus the
// snap settle; short enough that a deliberate tap after a swipe still lands.
const PAGER_TAP_QUIET_MS = 300;


// Static overlay styles for the local-sync picker cell (no theme dependency).
const localCellStyles = StyleSheet.create({
  relative: { position: 'relative' },
  check: {
    position: 'absolute', bottom: 4, right: 4, width: 24, height: 24, borderRadius: 12,
    backgroundColor: '#000', justifyContent: 'center', alignItems: 'center',
  },
  videoBadge: { position: 'absolute', top: 4, left: 4 },
});

// One cell of the device-photo sync picker. React.memo so a selection tap only
// re-renders (and re-decodes) the ONE cell whose isSelected changed — the
// FlatList's extraData={selectedLocalAssets} + a stable renderItem make the
// memo effective. cachePolicy="memory" (not "none"): device-local ph:// URIs
// shouldn't be disk-cached, but the in-memory cache makes remounts instant.
const LocalAssetCell = React.memo(function LocalAssetCell({ item, isSelected, onToggle, styles, themeColors }) {
  return (
    <TouchableOpacity
      style={[styles.thumbnailContainer, localCellStyles.relative]}
      onPress={() => onToggle(item.id)}
      activeOpacity={0.8}
    >
      <Image source={{ uri: item.uri }} style={styles.thumbnail} contentFit="cover" cachePolicy="memory" />
      {isSelected && (
        <View style={localCellStyles.check}>
          <Icon name="check" size={16} color="#fff" />
        </View>
      )}
      {item.mediaType === 'video' && (
        <View style={localCellStyles.videoBadge}>
          <Icon name="video" size={16} color={themeColors.background} style={{ textShadowColor: '#000', textShadowRadius: 4 }} />
        </View>
      )}
    </TouchableOpacity>
  );
});

/**
 * MediaGallery - Photo/Video vault gallery grid with Phone Uploads / Turtle Base toggle
 *
 * Props:
 * - onClose: () => void - Called when user wants to close the gallery (optional for tab usage)
 * - autoUpload: boolean - If true, immediately opens image picker on mount (for /photos upload command)
 */
export default function MediaGallery({ onClose, autoUpload = false, kind = null }) {
  // Media-kind scope for the Media Vault split. null = all (back-compat with
  // the chat /photos usage). The Photos & Video view passes 'visual' so audio
  // rows never appear in the photo grid.
  // (The old `kindParam` string-concat is gone: every request now goes through
  // buildGalleryUrl / buildBucketsUrl, which take `kind` as an option.)
  const { theme } = useTheme();
  const { api, getBaseUrl, getMediaBaseUrl } = useServer();
  const insets = useSafeAreaInsets();
  // Height of the FLOATING tab bar this screen runs underneath. Fixed controls
  // (the bulk-select console, the jump pill, the scrubber rail, the music
  // transport) must clear it: unlike the photo grid — which you can scroll out
  // from under the bar — a pinned control covered by the bar is simply
  // unreachable. Read from the CONTEXT rather than useBottomTabBarHeight()
  // because this component also renders outside a tab (the share target and the
  // chat's /vault page), where the hook throws; absent ⇒ 0, nothing reserved.
  const navBarH = useContext(BottomTabBarHeightContext) ?? 0;
  // How much room the floating dock actually occupies: card + float gap + safe
  // area. Preferred over the navigator's reported height, which does not
  // describe a margin-based floating card (it left the chat composer a whole
  // card-height too high). Zero when this screen renders outside a tab — the
  // share target and the chat's /vault page — where there is no dock at all.
  const tabBarH = navBarH > 0 ? dockOccupied(insets.bottom) : 0;

  // === TAB & DATA STATE ===
  // The pager holds Boards and Music. The photo grid is NOT a pager page any
  // more: it's a page pushed over the pager (slide in from the right, left-edge
  // swipe to close), opened by tapping a board.
  const [pagerTab, setPagerTab] = useState('albums');   // 'albums' | 'music'
  const [photosOpen, setPhotosOpen] = useState(false);
  // Derived, not stored. Roughly forty guards below read
  // `activeTab === 'uploads'` to mean "the photo grid is on screen" — fetching,
  // video preview, scroll bookkeeping, viewability. Deriving it keeps every one
  // of those correct now that the grid is a pushed page instead of a tab.
  const activeTab = photosOpen ? 'uploads' : pagerTab;
  // "Jump to newest" pill — shown once the uploads grid is scrolled a screenful
  // away from the newest item (offset 0 = newest, since the grid is scaleY(-1)).
  // Toggled from handleGridScroll with a functional updater so we only re-render
  // on the threshold crossing, not every scroll frame.
  const [showGridJump, setShowGridJump] = useState(false);
  // Fade the jump pill in/out instead of popping it. Stays mounted (taps off)
  // while it fades to 0, so "no scroll → no button" reads as a gentle fade-out.
  const gridJumpAnim = useRef(new Animated.Value(0)).current;
  // Direction tracking: the grid is scaleY(-1) mirrored so offset 0 = newest
  // (visual bottom). Moving TOWARD the newest = offset DECREASING = a downward
  // visual swipe; that's the only direction that reveals the pill.
  const gridJumpLastY = useRef(0);
  const gridJumpingRef = useRef(false); // true during a tap-to-latest animation
  const gridJumpIdleTimer = useRef(null); // idle auto-hide: fades the pill once the grid stops moving
  const scrubTailFrame = useRef(0); // throttles handleGridScroll's JS-only tail (pill/idle/prefetch) to every 4th frame
  // The pill's fade lives lower down (see `gridJumpVisible`): besides the scroll
  // intent it also folds in "is an overlay covering the grid?", and those
  // overlay states (viewer / select mode / upload sheet) are declared further below.

  // Data state
  const [uploadItems, setUploadItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isPaginating, setIsPaginating] = useState(false); // Prevents overlapping fetch calls
  // Vault uploads run APP-LEVEL (VaultUploadContext): this screen only picks
  // assets and enqueues; the global pill shows live progress everywhere, the
  // queue persists across app restarts, and duplicates are skipped up front.
  // `uploadBusy` mirrors "a batch is in flight" for buttons that must not
  // double-fire (one batch at a time keeps the percentage meaningful).
  // Actions (stable) + lifecycle (status/finishedAt only) — NOT the full state,
  // so the per-% upload ticks no longer re-render this screen.
  const vaultActions = useVaultUploadActions();
  const vaultLifecycle = useVaultUploadLifecycle();
  const uploadBusy = !!vaultLifecycle.status && vaultLifecycle.status !== 'done';
  const [refreshing, setRefreshing] = useState(false);
  
  // === LOCAL SYNC GALLERY STATE ===
  const [localPickerVisible, setLocalPickerVisible] = useState(false);
  const [localAssets, setLocalAssets] = useState([]);
  const [selectedLocalAssets, setSelectedLocalAssets] = useState(new Set());
  const [localHasNextPage, setLocalHasNextPage] = useState(true);
  const [localEndCursor, setLocalEndCursor] = useState(null);
  const [isLoadingLocal, setIsLoadingLocal] = useState(false);
  
  // === PAGINATION STATE ===
  const [hasMoreUploads, setHasMoreUploads] = useState(true);
  const [uploadOffset, setUploadOffset] = useState(0);
  const [globalUploadsTotal, setGlobalUploadsTotal] = useState(0);
  const LIMIT = 60; // Micro-batching for zero-stutter appends

  // === VIEWER STATE ===
  const [selectedMedia, setSelectedMedia] = useState(null);

  // ── Viewer load-progress bar ────────────────────────────────────
  //
  // A 3px-tall progress indicator at the top of the fullscreen viewer
  // tracks Layer 2 (high-res) bytes-in-flight. The user asked for
  // explicit feedback on tap-thumbnail loads since the high-res
  // download can take a few seconds for HEIC originals.
  //
  // Two animated values:
  //   • viewerProgressAnim — interpolated to translateX of an inner bar
  //                        clipped by an overflow:hidden parent. Trick
  //                        avoids width animation (which can't use the
  //                        native driver) — translateX with native
  //                        driver stays at 60fps even under load.
  //   • viewerProgressOpacityAnim — visibility. Hidden while no load is in
  //                        flight; faded in when progress events start
  //                        arriving; faded out after onLoad fires.
  //
  // A 150ms show-delay swallows the visual flicker on cache hits
  // (where load completes in <150ms and we'd otherwise flash a bar
  // that adds nothing). Real loads (multi-second HEIC fetches) clear
  // the timer the moment the first progress event arrives.
  const viewerProgressAnim = useRef(new Animated.Value(0)).current;
  const viewerProgressOpacityAnim = useRef(new Animated.Value(0)).current;
  const viewerProgressShowTimerRef = useRef(null);
  // No shimmer / gradient / decorative animation — the only motion
  // on the bar is the fill itself growing with progress (the
  // translateX of the inner View, driven by viewerProgressAnim).
  // Matches the web app's restrained aesthetic: hairline track,
  // solid white fill, fade in/out, nothing extra.

  // ── Albums-tab loading bar ──────────────────────────────────
  //
  // Separate from the viewer's progress bar above because the album
  // fetch is INDETERMINATE — we don't have a byte-level progress
  // event for an XHR; we just know "in flight" vs "done." The
  // standard pattern for indeterminate progress is a fixed-width
  // segment that slides across the track in a loop.
  //
  // Visual: same 3px solid white as the viewer bar, but instead of
  // the bar GROWING from 0→100%, a ~35%-wide segment translates
  // from off-screen-left to off-screen-right in a 1.2s loop. Stops
  // the moment fetchAlbums resolves.
  const [isAlbumsLoading, setIsAlbumsLoading] = useState(false);
  const albumsLoadingAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!isAlbumsLoading) return;
    albumsLoadingAnim.setValue(0);
    const loop = Animated.loop(
      Animated.timing(albumsLoadingAnim, {
        toValue: 1,
        duration: 1200,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => { loop.stop(); };
  }, [isAlbumsLoading, albumsLoadingAnim]);

  // The bar stays hidden. Under the HD-manager model there is no in-view
  // network load left to narrate: cells swap to a display variant that the
  // manager has ALREADY prefetched into the disk cache, so the "load" a bar
  // would track is over before the swap happens. The show-delay timer this
  // effect used to arm was fed completion by cell callbacks that no longer
  // exist — kept armed, it would surface an empty bar and strand it at 0%.
  useEffect(() => {
    viewerProgressOpacityAnim.setValue(0);
    viewerProgressAnim.setValue(0);
  }, [selectedMedia?.id, viewerProgressAnim, viewerProgressOpacityAnim]);

  // (The old handleLoadProgress/handleLoadComplete pair lived here. They fed
  // the bar from cell load callbacks; under the HD-manager model cells never
  // load into the view over the network, so both went with their feed.)
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const [infoVisible, setInfoVisible] = useState(true);
  const infoOpacityAnim = useRef(new Animated.Value(1)).current;
  const [zoomScale, setZoomScale] = useState(1); // Track zoom level for close prevention
  // Mirror for the gesture callbacks. `swipeResponder` below is built once in a
  // useRef, so it closes over the FIRST render's `zoomScale` forever: reading
  // the state directly there meant the "don't dismiss while zoomed" guard
  // always compared against 1 and never fired. The ref is read live.
  //
  // There is deliberately NO "is a gesture in flight" flag here. The first cut
  // had one, raised on pinch start and lowered on gesture finalize, to freeze
  // the pager before a pinch could nudge it. Pinch and pan finalize in either
  // order, so the two gestures fought over the single boolean: it flapped
  // mid-pinch (pager scroll cancelling and re-enabling under the fingers — the
  // jitter) and could latch ON after the cell deactivated, which froze paging
  // altogether. The pager now keys off the settled zoom state alone.
  const zoomScaleRef = useRef(1);
  // Chrome opacity while zoomed, as an ANIMATED value. The chrome used to be
  // `opacity: zoomScale > 1.05 ? 0 : <Animated chain>` — a hard cut on a state
  // flip (and a swap between a plain number and an Animated node, which
  // rebinds the native prop). iOS fades the chrome away as the zoom engages;
  // 150ms matches its feel.
  const zoomChromeAnim = useRef(new Animated.Value(1)).current;
  const reportZoomScale = useCallback((z) => {
    zoomScaleRef.current = z;
    // Dev probe attribution. A zoom flip is the one viewer interaction that
    // writes GALLERY state without any respond()/mark() of its own, so a stall
    // it causes was being filed under whatever the last labelled gesture was —
    // "grid:openPhoto blocks for 254ms" was this commit, long after the open.
    // Naming it here makes the next finding say what actually blocked.
    gestureProbe.mark('viewer:zoom');
    setZoomScale(z);
    Animated.timing(zoomChromeAnim, {
      toValue: z > 1.05 ? 0 : 1,
      duration: 150,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [zoomChromeAnim]);

  // "A pager swipe is in flight" — a hand-rolled store rather than state, and
  // deliberately so: the only consumers are the image cells (they stand their
  // HD layer down for the duration), and routing it through gallery state would
  // re-render a 6000-line component on the frame the swipe starts. Identity is
  // stable for the component's life, so nothing downstream re-renders either.
  const pagerDragStoreRef = useRef(null);
  if (pagerDragStoreRef.current === null) {
    const listeners = new Set();
    let dragging = false;
    pagerDragStoreRef.current = {
      get: () => dragging,
      set: (next) => {
        if (next === dragging) return;
        dragging = next;
        listeners.forEach((l) => l(next));
      },
      subscribe: (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    };
  }
  const pagerDragStore = pagerDragStoreRef.current;

  // ── Viewer HD manager ────────────────────────────────────────────────────
  // ALL of the viewer's HD orchestration, in one place. Cells used to run
  // their own dwell timers, commit latches, drag subscriptions and cancel
  // effects — React state that could (and did, measured at a 150ms median JS
  // block) fire on the exact frame a finger landed. Now a cell only reads a
  // per-photo "HD is warm" flag from this store; everything below is about
  // making sure that flag can never flip at a bad moment.
  //
  // Two invariants:
  //   1. WARMING IS INVISIBLE. Image.prefetch pulls the ~1600px display
  //      variant into expo-image's disk cache without touching any view, so
  //      it can run during anything — including mid-swipe — at zero frame
  //      cost. The cell's later URI swap decodes from that warm cache.
  //   2. FLIPS LAND ON QUIET FRAMES ONLY. A finished prefetch queues its id;
  //      the queue drains through InteractionManager, and never while the
  //      pager drag flag is up (drag release drains it). So the one re-render
  //      a photo cell takes after mount happens on an idle frame, always.
  //
  // The flag is per-PHOTO and never unset: swiping away and back shows HD
  // instantly (iOS behaviour), and a recycled cell asking about a different
  // photo simply reads that photo's own answer.
  const viewerHdStoreRef = useRef(null);
  if (viewerHdStoreRef.current === null) {
    const ready = new Set();
    const listeners = new Set();
    viewerHdStoreRef.current = {
      get: (id) => ready.has(id),
      subscribe: (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
      // Broadcasts the id that flipped so cells can ignore other photos
      // without a state write.
      mark: (id) => { if (ready.has(id)) return; ready.add(id); listeners.forEach((l) => l(id)); },
    };
  }
  const viewerHdStore = viewerHdStoreRef.current;
  const hdInFlightRef = useRef(new Set());
  const hdPendingMarkRef = useRef(new Set());

  const flushHdMarks = useCallback(() => {
    if (pagerDragStore.get()) return; // drag release will drain us
    const pending = hdPendingMarkRef.current;
    if (pending.size === 0) return;
    const ids = [...pending];
    pending.clear();
    InteractionManager.runAfterInteractions(() => {
      ids.forEach((id) => viewerHdStore.mark(id));
    });
  }, [pagerDragStore, viewerHdStore]);

  const ensureViewerHd = useCallback((item) => {
    if (!item?.id || item.isSkeleton || item.type === 'video') return;
    const id = item.id;
    if (viewerHdStore.get(id) || hdInFlightRef.current.has(id)) return;
    hdInFlightRef.current.add(id);
    Image.prefetch(getFullUrl(`/api/media/display/${id}`), { cachePolicy: 'disk' })
      .then((ok) => {
        // A failed prefetch (missing variant, offline) simply never marks:
        // the cell stays on the compressed image, which is degraded, not
        // broken — and nothing retries in a loop.
        if (ok) { hdPendingMarkRef.current.add(id); flushHdMarks(); }
      })
      .catch(() => {})
      .finally(() => { hdInFlightRef.current.delete(id); });
  }, [viewerHdStore, getFullUrl, flushHdMarks]);

  // WHICH PAGE IS ACTIVE — same store pattern, same reason. selectedMedia (the
  // gallery state) re-renders the entire component, chrome and all, and that
  // used to happen in the pager's settle frame on EVERY page change — with the
  // touch pipeline being JS-bound, a swipe landing during that storm went dead
  // ("massive non-responsive period", worst right after an HD load piled its
  // own state flips on top). The cells now read activity from THIS store (two
  // cells re-render per page change, nothing else), and the selectedMedia
  // adoption is deferred until interactions finish (see syncSelectedFromOffset).
  const viewerActiveStoreRef = useRef(null);
  if (viewerActiveStoreRef.current === null) {
    const listeners = new Set();
    let activeId = null;
    viewerActiveStoreRef.current = {
      get: () => activeId,
      set: (next) => {
        if (next === activeId) return;
        activeId = next;
        listeners.forEach((l) => l(next));
      },
      subscribe: (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    };
  }
  const viewerActiveStore = viewerActiveStoreRef.current;

  // === PULL-TO-DISMISS (iOS Photos style) ===
  // dragY follows the finger on a downward drag of the open photo. The image
  // translates with it, scales down slightly, and the black backdrop fades —
  // release past DISMISS_DY (or with enough downward velocity) flings it the
  // rest of the way and closes; otherwise it springs back home.
  const dragY = useRef(new Animated.Value(0)).current;
  // ...and dragX with it. iOS Photos tracks the finger in BOTH axes once the
  // dismiss drag has been claimed — the photo goes where your thumb goes, not
  // just straight down a rail. Sideways motion is pure follow: it never commits
  // the dismiss on its own (that stays a vertical/velocity decision).
  const dragX = useRef(new Animated.Value(0)).current;
  // Photo shrinks toward 0.7 across the first ~55% of a pull — matching the
  // amount iOS Photos shrinks a photo before it lets go of it.
  const dragScale = dragY.interpolate({
    inputRange: [0, height * 0.55],
    outputRange: [1, 0.7],
    extrapolate: 'clamp',
  });
  // Backdrop fades from solid to clear over the first ~45% of a pull, so the
  // grid behind reads through as the photo lifts away.
  const dragBackdropOpacity = dragY.interpolate({
    inputRange: [0, height * 0.45],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  // Chrome gets out of the way the moment the photo starts moving (iOS hides
  // every control for the duration of the drag). Interpolated rather than
  // state-driven so it costs nothing and reverses for free on a spring-back.
  const dragChromeOpacity = dragY.interpolate({
    inputRange: [0, 60],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  // === ORIGIN-ANCHORED OPEN/CLOSE (grid → viewer continuity) ===
  // The viewer pops FROM the tapped cell's screen position instead of the dead
  // centre: originDX/DY hold the tap point's offset from screen centre (set at
  // open), and popProgress rides the existing scaleAnim (0.85 → 1) so the
  // translate decays to zero exactly as the pop settles. Close reverses
  // scaleAnim, so the photo retreats toward the same spot. Pure native-driver
  // math (multiply of a Value by an interpolation) — no measurement pass, no
  // snapshot layer, and a plain centre pop when no origin is known (origin 0).
  const originDX = useRef(new Animated.Value(0)).current;
  const originDY = useRef(new Animated.Value(0)).current;
  const popProgress = scaleAnim.interpolate({
    inputRange: [0.85, 1],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  const originTranslateX = Animated.multiply(originDX, popProgress);
  const originTranslateY = Animated.multiply(originDY, popProgress);
  
  // === DRAWER STATE & PHYSICS ===
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const drawerY = useRef(new Animated.Value(height)).current;
  // The swipeResponder below is built once (useRef), so its closures freeze the
  // first render's state. Mirror isDrawerOpen into a ref it can read live —
  // otherwise it always sees `false` and routes every release to dismiss.
  const isDrawerOpenRef = useRef(false);
  useEffect(() => { isDrawerOpenRef.current = isDrawerOpen; }, [isDrawerOpen]);

  const openMetadataDrawer = useCallback(() => {
    setIsDrawerOpen(true);
    Animated.spring(drawerY, { toValue: height * 0.45, useNativeDriver: true, tension: 65, friction: 10 }).start();
  }, [drawerY]);

  const closeMetadataDrawer = useCallback(() => {
    Animated.timing(drawerY, { toValue: height, duration: 250, easing: Easing.out(Easing.ease), useNativeDriver: true }).start(() => setIsDrawerOpen(false));
  }, [drawerY]);
  
  // === ALBUM & TAG STATE ===
  const [globalAlbums, setGlobalAlbums] = useState(['Phone Uploads']);
  const [albumCovers, setAlbumCovers] = useState({});
  const [albumCounts, setAlbumCounts] = useState({});
  const [albumLatestDates, setAlbumLatestDates] = useState({});
  const [boardSortMode, setBoardSortMode] = useState('recent');
  const [albumsLoadError, setAlbumsLoadError] = useState(null);
  const [hasLoadedAlbums, setHasLoadedAlbums] = useState(false);
  const [albumSearchQuery, setAlbumSearchQuery] = useState(''); // Album search filter
  const searchInputRef = useRef(null);
  // === BROWSE MODEL ===
  // Every knob the "Filter & arrange" sheet offers — date basis, direction,
  // media type, tags, scene, date range, search text, grid density — lives in
  // one object with one URL builder (utils/galleryFilters.js). These used to be
  // eight separate useStates with five call sites hand-writing their own query
  // strings, which had already drifted apart.
  const {
    filters,
    setFilter,
    setFilters,
    toggleTag,
    clearChip,
    reset: resetFilters,
    chips: filterChips,
    isDirty: filtersDirty,
  } = useGalleryFilters();
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);
  const [filterSheetFocusSearch, setFilterSheetFocusSearch] = useState(false);
  const [facets, setFacets] = useState({ buckets: [], sceneCounts: {}, tagCounts: {} });

  // Aliases. The rest of this file reads these names in ~40 places; keeping
  // them means the browse model swaps in without touching the grid, the
  // scrubber, the viewer or the pinch handoff.
  const uploadsSearchQuery = filters.q;
  const setUploadsSearchQuery = useCallback((q) => setFilter('q', typeof q === 'string' ? q : ''), [setFilter]);
  // Grid date basis: 'original' = when the photo was TAKEN (capture date,
  // Google-Photos style, the default) | 'upload' = when it was ADDED to
  // Turtle (shared/uploaded/ingested). Both dates live on every media row —
  // this only switches which one drives the ORDER BY + timeline buckets.
  const sortMode = filters.sortBy;
  const sortModeRef = useRef(sortMode);
  sortModeRef.current = sortMode;
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  // A stable string for everything the SERVER cares about. `filters` is a new
  // object per keystroke; this only moves when a request would actually differ,
  // so effects keyed on it don't thrash while the user types.
  const filterSignature = [
    filters.sortBy, filters.direction, filters.mediaType,
    filters.tag.join(','), filters.sceneType ?? '', filters.from ?? '', filters.to ?? '',
  ].join('|');
  const [isUploadsSearchVisible, setIsUploadsSearchVisible] = useState(false);
  // The magnify icon is gone — search lives in the filter sheet now. The
  // inline bar still earns its place as the live query readout under the
  // header (and it carries the tag "Jump" affordance), so it follows the
  // query rather than a button.
  useEffect(() => {
    setIsUploadsSearchVisible(!!(filters.q || '').trim());
  }, [filters.q]);
  const uploadsSearchAnim = useRef(new Animated.Value(0)).current;

  // Animate the Photos search bar. Uses the iOS
  // Spotlight / sheet-presentation curve (cubic-bezier 0.32, 0.72, 0, 1) so the
  // bar drops in with the same smooth deceleration the keyboard rises on.
  useEffect(() => {
    const isVisible = isUploadsSearchVisible;
    Animated.timing(uploadsSearchAnim, {
      toValue: isVisible ? 1 : 0,
      duration: isVisible ? 320 : 220,
      easing: Easing.bezier(0.32, 0.72, 0, 1),
      useNativeDriver: true,
    }).start();
  }, [isUploadsSearchVisible, uploadsSearchAnim]);

  // Server FTS search. The instant client-side filter below only sees LOADED
  // items — in the sparse virtual library that's a small fraction of the
  // collection — so a debounced /media/search (FTS5 over filename, tags, AI
  // labels, OCR text, and summaries; same row shape as /gallery) supplies the
  // authoritative result set for the whole library. The client filter still
  // paints instantly and covers the debounce gap + offline. Audio rows are
  // dropped (they belong to the Music slice, not the photo vault).
  const [serverSearch, setServerSearch] = useState(null); // { query, items } | null
  useEffect(() => {
    const q = uploadsSearchQuery.trim();
    if (q.length < 2) { setServerSearch(null); return undefined; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        // buildGalleryUrl routes to /media/search whenever the model carries a
        // query, so the sheet's media-type and tag choices narrow search
        // results exactly as they narrow the browse grid.
        const r = await api.get(buildGalleryUrl(filtersRef.current, {
          limit: 200, offset: 0, album: selectedAlbumRef.current, kind,
        }));
        if (cancelled) return;
        const items = (Array.isArray(r?.items) ? r.items : []).filter((it) => it.type !== 'audio');
        setServerSearch({ query: q, items });
      } catch (e) {
        // Offline / older server — the client filter keeps working on its own.
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
    // filterSignature: narrowing to Videos (say) must re-run the search, not
    // leave the previous, wider result set on screen.
  }, [uploadsSearchQuery, filterSignature, api, kind]);
  
  const [uploadModalVisible, setUploadModalVisible] = useState(false);
  const [pendingAssets, setPendingAssets] = useState([]);
  const [selectedTags, setSelectedTags] = useState([]);
  
  // Album currently open in the public "share to the web" sheet (null = closed).
  const [shareAlbumName, setShareAlbumName] = useState(null);
  // Album whose "⋯" menu (share / rename / delete) is open (null = closed).
  const [albumMenuName, setAlbumMenuName] = useState(null);
  // Album whose share-analytics page is pushed (null = closed). Reached by
  // tapping the SHARED badge on a board card.
  const [insightsAlbumName, setInsightsAlbumName] = useState(null);

  // Lower-cased names of the boards that currently have a LIVE public link, so
  // the board header can say "on the web" without opening the menu to find out.
  // A board being public is invisible state otherwise — easy to forget you left
  // one published. Refreshed whenever a share sheet closes, since that is the
  // only place a link is created or revoked.
  const [liveAlbums, setLiveAlbums] = useState(() => new Set());
  const refreshLiveAlbums = useCallback(async () => {
    try {
      const res = await api.get('/album-shares');
      const now = Date.now();
      const live = (res?.shares || []).filter(
        (s) => !s.revokedAt && !(s.expiresAt && s.expiresAt < now),
      );
      setLiveAlbums(new Set(live.map((s) => String(s.album || '').toLowerCase())));
    } catch {
      // Never claim a board is private on a failed lookup — keep what we had.
    }
  }, [api]);
  useEffect(() => { refreshLiveAlbums(); }, [refreshLiveAlbums]);

  // === BULK SELECTION STATE ===
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedGridItems, setSelectedGridItems] = useState(new Set());
  // "Section Select" sub-mode: tap the FIRST photo, then the LAST, and every
  // photo between them (in data order) is selected — for grabbing big runs
  // without dragging. Coexists with tap-to-toggle and drag-select.
  const [rangeSelectMode, setRangeSelectMode] = useState(false);
  const [rangeAnchorIdx, setRangeAnchorIdx] = useState(null); // drives the hint label

  // Jump-to-latest pill visibility: the scroll logic wants it (showGridJump)
  // AND nothing is covering the grid — the full-screen viewer (selectedMedia),
  // select mode's bottom action bar (isSelectMode), or the upload sheet
  // (uploadModalVisible). Fades between states; the pill's pointerEvents uses the
  // same flag so a faded-out pill is never tappable.
  const gridJumpVisible = showGridJump && !selectedMedia && !isSelectMode && !uploadModalVisible;
  useEffect(() => {
    Animated.timing(gridJumpAnim, {
      toValue: gridJumpVisible ? 1 : 0,
      duration: gridJumpVisible ? 200 : 160,
      useNativeDriver: true,
    }).start();
  }, [gridJumpVisible, gridJumpAnim]);
  // Clear any pending idle-hide timer on unmount.
  useEffect(() => () => { if (gridJumpIdleTimer.current) clearTimeout(gridJumpIdleTimer.current); }, []);

  // ── Drag-to-select (uploads grid, select mode) ──────────────────────────
  // Touch a photo and drag SIDEWAYS to range-select; vertical swipes still
  // scroll. The mapping is fully RELATIVE to the touched cell — finger deltas
  // → row/col deltas → index — so it needs no header/scroll-offset
  // bookkeeping, and it stays valid because the responder owns the touch
  // while selecting (the grid can't scroll mid-drag). The grid is
  // scaleY(-1)-inverted, so finger UP = higher index (rowDelta uses start-cur).
  const isSelectModeRef = useRef(isSelectMode);
  isSelectModeRef.current = isSelectMode;
  const selectedGridItemsRef = useRef(selectedGridItems);
  selectedGridItemsRef.current = selectedGridItems;
  const uploadItemsForDragRef = useRef([]); // synced after uploadDisplayItems memo
  const bulkShareBusyRef = useRef(false);   // re-entrancy guard for the batch share
  const dragTouchRef = useRef(null);  // { index, x, y } — last touch-down on a cell
  const dragBaseRef = useRef(null);   // selection Set snapshot at drag start
  const dragLastIdxRef = useRef(-1);

  // ── Pinch-to-change-columns (iOS Photos) ───────────────────────────────
  // The grid's column count is live state: pinch OUT (fingers apart) = bigger
  // cells = fewer columns, pinch IN = more; steps commit MID-GESTURE and one
  // continuous pinch can walk multiple steps (see the morph block below).
  // Every piece of column-dependent math (drag-select ranges, sparse-region
  // windows, cell sizing) reads gridColsRef so stable callbacks never see a
  // stale count.
  const GRID_COL_MIN = 2;
  const GRID_COL_MAX = 5;
  // Density lives in the browse model so the pinch gesture and the sheet's
  // stepper are the same value read two ways — and so it survives a restart.
  const gridCols = filters.cols;
  const setGridCols = useCallback((n) => setFilter('cols', n), [setFilter]);
  const gridColsRef = useRef(3);
  gridColsRef.current = gridCols;
  // Cell pitch = one cell + its margins; derived per-call from the live count.
  const cellPitch = () => width / gridColsRef.current;
  // ── Pinch animation (iOS Photos: continuous morph, no blink) ───────────
  // The gesture is a pure UI-thread worklet. The grid scales live about the
  // pinch focal point, and when the stretch crosses a step threshold the
  // column count commits IMMEDIATELY — mid-gesture, iOS-style — with a
  // SCALE-CONTINUITY HANDOFF: the display scale is rebased in the same frame
  // so the incoming layout appears at exactly the on-screen cell size the
  // fingers imply. No fade-out/fade-in, no blank frame (the previous design
  // faded the grid to invisible around the swap, which read as a blink on
  // device). Rebasing also makes one gesture MULTI-STEP: keep pinching and the
  // grid walks 5→…→2 in one continuous motion, a haptic tick per step.
  // Release springs the display scale home; the layout is already committed.
  const pinchScale = useSharedValue(1);    // displayed scale = handoff × rebased raw
  const pinchBase = useSharedValue(1);     // e.scale at the last commit (rebase divisor)
  const pinchHandoff = useSharedValue(1);  // continuity factor carried across commits
  const pinchFocalX = useSharedValue(0);
  const pinchFocalY = useSharedValue(0);
  // Column count mirrored into a shared value so the worklet can clamp and
  // compute pitch ratios without reaching into JS state. Stepped optimistically
  // in the worklet at commit time; the layout effect below re-syncs it.
  const gridColsSv = useSharedValue(3);
  // Rebased stretch that commits a step (≈ iOS Photos' feel: a deliberate
  // pinch, not a twitch). Downward step is the exact reciprocal so the
  // gesture is symmetric.
  const PINCH_STEP_UP = 1.30;
  const PINCH_STEP_DOWN = 1 / 1.30;
  // Scroll offset to apply once the new column layout is committed.
  const pendingAnchorOffsetRef = useRef(null);

  // Keep the cell under the fingers in place across the column change. Without
  // this the grid keeps its pixel offset, so a taller/shorter layout slides the
  // photo you were pinching off-screen.
  // Offset that keeps the cell under the fingers in place across the column
  // change. Without it the grid holds its pixel offset, so a taller/shorter
  // layout slides the photo you were pinching off-screen.
  const anchorOffsetForColumnChange = useCallback((oldCols, newCols, focalY) => {
    const oldPitch = width / oldCols;
    const newPitch = width / newCols;
    const contentY = (scrubLastY.current || 0) + focalY;   // content-space y under the fingers
    const itemIndex = (contentY / oldPitch) * oldCols;      // fractional index at that point
    return Math.max(0, (itemIndex / newCols) * newPitch - focalY);
  }, [width]);

  // JS side of a step commit: haptic tick, stash the scroll anchor, swap the
  // column count. The anchor is applied in the layout effect (scrolling before
  // the relayout would land in the OLD layout's coordinate space).
  const commitPinchColumns = useCallback((dir, focalY) => {
    const cols = gridColsRef.current;
    const next = Math.max(GRID_COL_MIN, Math.min(GRID_COL_MAX, cols + dir));
    if (next === cols) return; // worklet clamps too; belt-and-braces
    impactHaptic('light');
    pendingAnchorOffsetRef.current = anchorOffsetForColumnChange(cols, next, focalY);
    setGridCols(next);
  }, [anchorOffsetForColumnChange]);

  // The swap frame: re-sync the worklet's column mirror and restore the scroll
  // anchor so the cell under the fingers stays put. The display scale is NOT
  // touched here — the worklet's handoff already has the incoming layout at
  // the visually-continuous size, which is the whole trick.
  useLayoutEffect(() => {
    gridColsSv.value = gridCols;
    if (pendingAnchorOffsetRef.current != null) {
      gridRef.current?.scrollToOffset({ offset: pendingAnchorOffsetRef.current, animated: false });
      pendingAnchorOffsetRef.current = null;
    }
    // Shared values and refs are stable; this must run only on a column change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridCols]);

  const gridPinch = useMemo(() => (
    Gesture.Pinch()
      .onStart((e) => {
        'worklet';
        pinchBase.value = 1;
        pinchHandoff.value = 1;
        pinchFocalX.value = e.focalX;
        pinchFocalY.value = e.focalY;
      })
      .onUpdate((e) => {
        'worklet';
        pinchFocalX.value = e.focalX;
        pinchFocalY.value = e.focalY;
        // Stretch since the last commit (or gesture start).
        let raw = e.scale / pinchBase.value;
        const atMin = gridColsSv.value <= GRID_COL_MIN;  // biggest cells already
        const atMax = gridColsSv.value >= GRID_COL_MAX;  // smallest cells already
        if (raw > PINCH_STEP_UP && !atMin) {
          // Commit mid-gesture (iOS): fewer columns. Handoff keeps the
          // on-screen cell size continuous through the relayout — the new
          // layout's bigger cells appear scaled DOWN to exactly what the old
          // layout showed at the threshold, then grow to rest as the fingers
          // keep spreading. Rebase makes the next step relative from here.
          const oldCols = gridColsSv.value;
          const newCols = oldCols - 1;
          pinchHandoff.value = pinchHandoff.value * raw * (newCols / oldCols);
          pinchBase.value = e.scale;
          gridColsSv.value = newCols; // optimistic; layout effect re-syncs
          runOnJS(commitPinchColumns)(-1, e.focalY);
          raw = 1;
        } else if (raw < PINCH_STEP_DOWN && !atMax) {
          const oldCols = gridColsSv.value;
          const newCols = oldCols + 1;
          pinchHandoff.value = pinchHandoff.value * raw * (newCols / oldCols);
          pinchBase.value = e.scale;
          gridColsSv.value = newCols;
          runOnJS(commitPinchColumns)(1, e.focalY);
          raw = 1;
        } else if ((raw > 1 && atMin) || (raw < 1 && atMax)) {
          // Rubber-band past the ends — the grid gives a little and returns,
          // signalling there's no further step (never stretches into one it
          // won't take).
          raw = 1 + (raw - 1) * 0.25;
        }
        pinchScale.value = Math.max(0.7, Math.min(1.45, pinchHandoff.value * raw));
      })
      .onEnd(() => {
        'worklet';
        // Steps landed mid-gesture, so there's nothing to commit here — just
        // settle the display scale home on an iOS-feel spring.
        pinchHandoff.value = 1;
        pinchBase.value = 1;
        pinchScale.value = withSpring(1, { damping: 20, stiffness: 260, mass: 0.7 });
      })
  ), [commitPinchColumns, pinchScale, pinchBase, pinchHandoff, pinchFocalX, pinchFocalY, gridColsSv]);

  // Scale about the pinch focal point rather than the container's centre, so the
  // grid grows out of the fingers instead of sliding under them.
  const gridPinchStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: pinchFocalX.value * (1 - pinchScale.value) },
      { translateY: pinchFocalY.value * (1 - pinchScale.value) },
      { scale: pinchScale.value },
    ],
  }));

  // ── Section Select (tap first + tap last) ──────────────────────────────
  const rangeSelectModeRef = useRef(rangeSelectMode);
  rangeSelectModeRef.current = rangeSelectMode;
  const rangeAnchorRef = useRef(null); // anchor data-index of the first tap

  // ── Edge auto-scroll while drag-selecting ──────────────────────────────
  // When the finger nears the top/bottom of the grid mid-drag, scroll the
  // list under it so the range can span past the visible window — faster the
  // deeper into the edge zone (so long runs "slide" quickly). The selection
  // math below is scroll-aware (it folds the offset delta into the index), so
  // the range keeps extending as content slides by even with a still finger.
  const EDGE_ZONE = 110;        // px from a grid edge that arms auto-scroll
  const MAX_AUTOSCROLL = 28;    // px/frame at the very edge (≈1680px/s @60fps)
  const gridWrapRef = useRef(null);
  const gridWinTop = useRef(0);          // grid's window-Y (for edge detection)
  const autoScrollRaf = useRef(null);
  const autoScrollSpeedRef = useRef(0);  // signed px/frame applied to the offset
  const lastDragRef = useRef({ x: 0, y: 0 });
  // Cancel any in-flight drag-select auto-scroll rAF on unmount so the loop
  // can't keep rescheduling / calling setState after the gallery is gone.
  useEffect(() => () => { if (autoScrollRaf.current != null) cancelAnimationFrame(autoScrollRaf.current); }, []);

  const onCellTouchDown = useCallback((index, pageX, pageY) => {
    if (!isSelectModeRef.current || typeof index !== 'number') return;
    dragTouchRef.current = { index, x: pageX, y: pageY, scroll: scrubLastY.current };
    // Cache the grid's window-top so a drag can measure finger-to-edge distance
    // (for auto-scroll) without a measure() on every move frame.
    gridWrapRef.current?.measureInWindow?.((x, y, w, h) => {
      gridWinTop.current = y;
      if (h) gridLayoutH.current = h;
    });
  }, []);

  const applyDragRange = useCallback((curX, curY) => {
    const start = dragTouchRef.current;
    const items = uploadItemsForDragRef.current;
    if (!start || !items.length) return;
    lastDragRef.current = { x: curX, y: curY };
    // inverted grid: finger UP = older = +rows. Auto-scroll moves the content
    // under the finger, so fold the scroll-offset delta in too: offset grows
    // toward the OLDEST (= higher data index), same sign as finger-up.
    const cols = gridColsRef.current;
    const pitch = cellPitch();
    const fingerRows = Math.round((start.y - curY) / pitch);
    const scrollRows = Math.round((scrubLastY.current - start.scroll) / pitch);
    const startCol = start.index % cols;
    // scaleX(-1)-mirrored grid: visual LEFT = higher data column, so finger
    // moving RIGHT (curX up) maps to a LOWER data index — negate the X delta.
    const col = Math.max(0, Math.min(cols - 1, startCol - Math.round((curX - start.x) / pitch)));
    let cur = start.index + (fingerRows + scrollRows) * cols + (col - startCol);
    cur = Math.max(0, Math.min(items.length - 1, cur));
    if (cur === dragLastIdxRef.current) return; // same cell — skip the re-set
    dragLastIdxRef.current = cur;
    const next = new Set(dragBaseRef.current);
    const [a, b] = start.index <= cur ? [start.index, cur] : [cur, start.index];
    for (let i = a; i <= b; i++) {
      const it = items[i];
      if (it && !it.isSkeleton) next.add(it.id);
    }
    setSelectedGridItems(next);
  }, []);

  // rAF loop: nudge the scroll offset while the finger sits in an edge zone,
  // then re-run the range math against the new offset so the selection grows.
  const stepAutoScroll = useCallback(() => {
    autoScrollRaf.current = null;
    const v = autoScrollSpeedRef.current;
    if (!v || !dragTouchRef.current) return; // drag ended or finger left the edge
    const max = Math.max(1, (gridContentH.current || 1) - (gridLayoutH.current || 1));
    const next = Math.max(0, Math.min(max, scrubLastY.current + v));
    if (next !== scrubLastY.current) {
      scrubLastY.current = next;
      scrollYSv.value = next;
      try { gridRef.current?.scrollToOffset?.({ offset: next, animated: false }); } catch (e) { /* mid-layout */ }
      applyDragRange(lastDragRef.current.x, lastDragRef.current.y);
    }
    autoScrollRaf.current = requestAnimationFrame(stepAutoScroll);
    // scrollYSv/gridRef/scrubLastY are stable refs/shared-values declared
    // later in the component — read at runtime (not render), so not deps here.
  }, [applyDragRange]);

  // Arm/disarm + scale auto-scroll from the finger's distance into an edge
  // zone. Quadratic ramp → gentle near the boundary, fast at the very edge.
  // Top edge → grow toward OLDEST (offset up); bottom edge → toward NEWEST.
  const updateAutoScroll = useCallback((curY) => {
    const h = gridLayoutH.current || height;
    const relY = curY - gridWinTop.current;
    let speed = 0;
    if (relY < EDGE_ZONE) {
      const depth = Math.min(1, (EDGE_ZONE - relY) / EDGE_ZONE);
      speed = MAX_AUTOSCROLL * depth * depth;
    } else if (relY > h - EDGE_ZONE) {
      const depth = Math.min(1, (relY - (h - EDGE_ZONE)) / EDGE_ZONE);
      speed = -MAX_AUTOSCROLL * depth * depth;
    }
    autoScrollSpeedRef.current = speed;
    if (speed !== 0 && autoScrollRaf.current == null) {
      autoScrollRaf.current = requestAnimationFrame(stepAutoScroll);
    }
  }, [stepAutoScroll]);

  const endDrag = useCallback(() => {
    dragTouchRef.current = null;
    dragBaseRef.current = null;
    dragLastIdxRef.current = -1;
    autoScrollSpeedRef.current = 0;
    if (autoScrollRaf.current != null) { cancelAnimationFrame(autoScrollRaf.current); autoScrollRaf.current = null; }
  }, []);

  const gridDragResponder = useRef(
    PanResponder.create({
      // Every fresh touch clears any stale cell anchor BEFORE the cell's own
      // onPressIn re-sets it (capture phase runs parent-first), so a drag
      // that starts on the header/gaps can never select from an old anchor.
      onStartShouldSetPanResponderCapture: () => { dragTouchRef.current = null; return false; },
      // Claim horizontal-dominant drags that started on a cell; let
      // vertical-dominant movement through to the list (= scroll).
      onMoveShouldSetPanResponderCapture: (evt, gs) => {
        if (!isSelectModeRef.current || !dragTouchRef.current) return false;
        const adx = Math.abs(gs.dx), ady = Math.abs(gs.dy);
        if (adx < 12 && ady < 12) return false; // not yet decisive
        if (adx <= ady) { if (ady > 16) dragTouchRef.current = null; return false; }
        dragBaseRef.current = new Set(selectedGridItemsRef.current);
        dragLastIdxRef.current = -1;
        return true;
      },
      onPanResponderMove: (evt) => {
        const { pageX, pageY } = evt.nativeEvent;
        applyDragRange(pageX, pageY);
        updateAutoScroll(pageY);
      },
      onPanResponderTerminationRequest: () => false, // don't let the list steal mid-drag
      onPanResponderRelease: endDrag,
      onPanResponderTerminate: endDrag,
    })
  ).current;

  const toggleGridSelection = useCallback((id) => {
    setSelectedGridItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Cell-tap router: in Section Select the first tap drops an anchor, the
  // second selects every photo between anchor and tap (data order, inclusive)
  // then re-arms for the next run. Otherwise it's a plain toggle.
  const handleSelectPress = useCallback((id, index) => {
    if (!rangeSelectModeRef.current || typeof index !== 'number') { toggleGridSelection(id); return; }
    const anchor = rangeAnchorRef.current;
    if (anchor == null) {
      rangeAnchorRef.current = index;
      setRangeAnchorIdx(index);
      setSelectedGridItems(prev => { const n = new Set(prev); n.add(id); return n; });
      return;
    }
    const items = uploadItemsForDragRef.current;
    const [a, b] = anchor <= index ? [anchor, index] : [index, anchor];
    setSelectedGridItems(prev => {
      const n = new Set(prev);
      for (let i = a; i <= b; i++) { const it = items[i]; if (it && !it.isSkeleton) n.add(it.id); }
      return n;
    });
    rangeAnchorRef.current = null;
    setRangeAnchorIdx(null);
  }, [toggleGridSelection]);

  const toggleRangeSelect = useCallback(() => {
    rangeAnchorRef.current = null;
    setRangeAnchorIdx(null);
    setRangeSelectMode(prev => !prev);
  }, []);

  const [isBulkTagging, setIsBulkTagging] = useState(false);

  const executeBulkTagSave = useCallback((uiTagsOverride) => {
    try {
      // 1. What tags are CURRENTLY sitting in the UI input box? (Caller may pass
      // the already-resolved set so this doesn't depend on closure state after
      // the editor has been closed.)
      let currentUiTags = Array.isArray(uiTagsOverride)
        ? [...uiTagsOverride]
        : (() => { const t = [...editingTags]; if (tagInputValue.trim()) t.push(tagInputValue.trim()); return t; })();
      currentUiTags = Array.from(new Set(currentUiTags));

      // Resolve selected items against the FULL displayed set (loaded prefix +
      // sparse virtual-library pages), NOT just `uploadItems` (the prefix).
      // Without this, photos selected from deep in the timeline aren't found,
      // so the common-tags + add/remove math silently ignore them — the core
      // "tagging is broken/finicky for a big library" bug.
      const displayItems = uploadItemsForDragRef.current || [];
      const byId = new Map();
      for (const di of displayItems) if (di && di.id && !di.isSkeleton) byId.set(di.id, di);
      // Apply a tag map (id → tags JSON) onto items that live ONLY in the
      // sparse virtual-library cache, so an optimistic bulk update is reflected
      // for off-screen selections too (the prefix is handled by setUploadItems).
      const patchSparse = (tagsById) => {
        const m = sparsePagesRef.current;
        if (!m || m.size === 0) return;
        let touched = false;
        for (const [pageIdx, arr] of m) {
          if (!Array.isArray(arr)) continue;
          let pageTouched = false;
          const next = arr.map(it => {
            if (it && it.id && tagsById[it.id] != null) { pageTouched = true; return { ...it, tags: tagsById[it.id] }; }
            return it;
          });
          if (pageTouched) { m.set(pageIdx, next); touched = true; }
        }
        if (touched) setSparseVersion(v => v + 1);
      };

      // 2. What were the ORIGINAL common tags before the user started typing?
      let originalCommonTags = null;
      Array.from(selectedGridItems).forEach(id => {
        const item = byId.get(id);
        if (item) {
          const itemTags = tagsOf(item);
          if (originalCommonTags === null) {
            originalCommonTags = [...itemTags];
          } else {
            originalCommonTags = originalCommonTags.filter(t => itemTags.includes(t));
          }
        }
      });
      originalCommonTags = originalCommonTags || [];

      // 3. Determine exact user intent
      // Tags they typed in that weren't there originally
      const explicitAdditions = currentUiTags.filter(t => !originalCommonTags.includes(t));
      // Original tags they clicked the 'X' on to delete
      const explicitRemovals = originalCommonTags.filter(t => !currentUiTags.includes(t));

      // 4. Compute each item's final tag set locally (non-destructive: ONLY add
      // what's new, ONLY remove what was explicitly X'd out) — then ship the
      // whole batch as ONE request. The old path issued a PUT per item, so
      // tagging 200 selected photos meant 200 parallel HTTP round-trips; the
      // bulk route applies the same add/remove semantics in a single SQLite
      // transaction.
      const ids = Array.from(selectedGridItems);
      const finalById = {};
      ids.forEach(id => {
        const targetItem = byId.get(id);
        if (!targetItem) return;
        let safeTags = [...tagsOf(targetItem)];
        explicitAdditions.forEach(t => { if (!safeTags.includes(t)) safeTags.push(t); });
        safeTags = safeTags.filter(t => !explicitRemovals.includes(t));
        finalById[id] = safeTags;
      });

      // 5. OPTIMISTIC: apply the grid update + exit select mode INSTANTLY, with
      // a snapshot kept for rollback. The network write happens afterwards in
      // the background so the UI never waits on it.
      const updatesMap = {};
      const snapshot = {};
      Object.entries(finalById).forEach(([id, tags]) => { updatesMap[id] = JSON.stringify(tags); });
      ids.forEach(id => { const it = byId.get(id); if (it) snapshot[id] = it.tags || '[]'; });

      setUploadItems(prevList => prevList.map(item =>
        updatesMap[item.id] ? { ...item, tags: updatesMap[item.id] } : item
      ));
      patchSparse(updatesMap);
      if (explicitAdditions.length > 0) {
        setGlobalAlbums(prev => Array.from(new Set([...prev, ...explicitAdditions])).sort());
      }
      setIsSelectMode(false);
      setIsBulkTagging(false);
      setSelectedGridItems(new Set());

      // 6. Persist in the background. Bulk route first; fall back to per-item
      // PUTs if the server doesn't have it. Revert the grid only if EVERYTHING
      // fails (the optimistic state already mirrors the intended result).
      (async () => {
        try {
          const res = await api.put('/media/tags/bulk', { ids, add: explicitAdditions, remove: explicitRemovals });
          if (!res || !res.success) throw new Error(res?.error || 'bulk tag route unavailable');
        } catch (e) {
          try {
            const entries = Object.entries(finalById);
            for (let i = 0; i < entries.length; i += 6) {
              await Promise.all(entries.slice(i, i + 6).map(([id, tags]) =>
                api.put(`/media/${id}/tags`, { tags })
              ));
            }
          } catch (e2) {
            console.error('[MediaGallery] Bulk tag save failed, reverting:', e2?.message);
            setUploadItems(prevList => prevList.map(item =>
              snapshot[item.id] != null ? { ...item, tags: snapshot[item.id] } : item
            ));
            patchSparse(snapshot);
            Alert.alert('Tags not saved', 'The bulk tag update failed and was reverted.');
          }
        }
      })();
    } catch(e) {
      Alert.alert('Error', `Failed to update tags: ${e.message}`);
    }
  }, [editingTags, tagInputValue, selectedGridItems, uploadItems, api]);

  const openBulkTagEditor = useCallback(() => {
    // 1. Calculate common tags across all selected items. Resolve against the
    // FULL displayed set (prefix + sparse virtual-library pages), not just
    // `uploadItems` (the prefix) — otherwise photos picked from deep in the
    // timeline are missed and the editor shows the wrong "common" tags.
    let commonTags = null;
    const displayItems = uploadItemsForDragRef.current || [];
    const byId = new Map();
    for (const di of displayItems) if (di && di.id && !di.isSkeleton) byId.set(di.id, di);
    Array.from(selectedGridItems).forEach(id => {
      const item = byId.get(id);
      if (item) {
        const itemTags = tagsOf(item);
        if (commonTags === null) {
          commonTags = [...itemTags];
        } else {
          // Keep only tags that exist in all selected items
          commonTags = commonTags.filter(t => itemTags.includes(t));
        }
      }
    });
    
    setEditingTags(commonTags || []);
    setTagInputValue('');
    setEditTagsVisible(true);
    Animated.timing(tagFadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }, [selectedGridItems, uploadItems, tagFadeAnim]);
  
  // Progress/percentage/minimize/delete-offer UI all moved to the global
  // VaultUploadContext + VaultUploadPill. The gallery's remaining job on
  // completion: pull the fresh uploads into the grid the moment a batch
  // finishes (whether it finished while this screen was open or not).
  const lastFinishedAtRef = useRef(null);
  useEffect(() => {
    const finishedAt = vaultLifecycle.finishedAt || null;
    if (finishedAt && finishedAt !== lastFinishedAtRef.current) {
      lastFinishedAtRef.current = finishedAt;
      fetchUploads(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultLifecycle.finishedAt]);

  // Tag editor state
  // === TAG EDITOR STATE & ANIMATION ===
  const [editTagsVisible, setEditTagsVisible] = useState(false);
  const [editingTags, setEditingTags] = useState([]);
  const [tagInputValue, setTagInputValue] = useState('');
  const tagFadeAnim = useRef(new Animated.Value(0)).current;

  const openTagEditor = useCallback(() => {
    try { setEditingTags(JSON.parse(selectedMedia.tags || '[]')); } catch(e){ setEditingTags([]); }
    setTagInputValue('');
    setEditTagsVisible(true);
    Animated.timing(tagFadeAnim, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [selectedMedia, tagFadeAnim]);

  const closeTagEditor = useCallback(() => {
    Animated.timing(tagFadeAnim, {
      toValue: 0,
      duration: 150,
      useNativeDriver: true,
    }).start(() => {
      setEditTagsVisible(false);
    });
  }, [tagFadeAnim]);
  
  // Scroll position for parallax effect
  const scrollX = useRef(new Animated.Value(0)).current;
  
  // === REFS ===
  // Grid ref for scroll-to-bottom (iOS Photos style)
  const gridRef = useRef(null);

  // ── Timeline scrubber + virtual library (uploads grid) ────────────────────
  // The grid is scaleY(-1)-inverted + newest-first: contentOffset.y = 0 is the
  // NEWEST item; increasing y is OLDER. The scrubber itself is worklet-driven
  // (TimelineScrubber.jsx) and reads these shared values; this component only
  // feeds them from the JS scroll handler — no React renders per frame.
  const gridContentH = useRef(0);   // total scrollable content height
  const gridLayoutH = useRef(0);    // viewport height
  const scrubLastY = useRef(0);     // latest scroll offset (rAF reads this)
  const scrollYSv = useSharedValue(0);
  const maxScrollSv = useSharedValue(1);

  // ── Albums A→Z scrubber ───────────────────────────────────────────────────
  // The SAME TimelineScrubber drives the albums grid (top-down, not inverted):
  // its parameters just switch from month/year buckets to alphabetical letter
  // groups when the Albums tab is active. These shared values are fed by the
  // albums FlatList's scroll the same way scrollYSv/maxScrollSv are fed by the
  // photos grid; the rail itself lives as one fixed overlay (see render) so it
  // stays put across the Photos↔Albums swipe.
  const albumsRef = useRef(null);
  const albumsContentH = useRef(0);
  const albumsLayoutH = useRef(0);
  const albumsScrollYSv = useSharedValue(0);
  const albumsMaxScrollSv = useSharedValue(1);
  // Full month/year timeline from /media/buckets (sortBy=original), newest-first
  // with cumulative start indices — drives the scrubber's labels + year ticks
  // across the WHOLE library and sizes the virtual grid. { months:[{monthKey,
  // count, start, label, year}], total }.
  const [uploadTimeline, setUploadTimeline] = useState({ months: [], total: 0 });
  const uploadTotalRef = useRef(0);
  uploadTotalRef.current = uploadTimeline.total;

  // ── Sparse page loader ─────────────────────────────────────────────────
  // The virtual grid spans the WHOLE library (timeline.total items): indices
  // past the contiguous newest prefix render as skeletons until their page is
  // fetched by RANDOM ACCESS (offset paging) around wherever the viewport is.
  // This is what makes a scrub-jump to 2019 land instantly instead of pulling
  // hundreds of sequential pages. Pages are LRU-evicted far from the viewport.
  const SPARSE_PAGE = LIMIT;          // match the server page size
  const SPARSE_MAX_PAGES = 64;        // ≈ 3,800 items of metadata in memory, max
  const sparsePagesRef = useRef(new Map());     // pageIdx -> items[]
  const sparseInflightRef = useRef(new Set());  // pageIdx fetches in flight
  const prefixLenRef = useRef(0);               // contiguous newest-prefix length
  const virtualEnabledRef = useRef(false);
  const sparseRaf = useRef(null);
  const [sparseVersion, setSparseVersion] = useState(0); // bumps when pages land
  // Bumped whenever the sparse cache is reset (sort/album/search change) —
  // in-flight page fetches compare against it and drop stale responses.
  const sparseEpochRef = useRef(0);
  // Same idea for the main gallery list: bumped by the sort/album cold-reload
  // effects so an in-flight fetchUploads from the OLD context can't merge into
  // (or clobber the offset of) the new list.
  const galleryEpochRef = useRef(0);
  // Thumbnail image-prefetch: warm expo-image's memory/disk cache for the
  // pages around the viewport as they land (and as a fling decelerates onto
  // them), so each cell paints from cache the instant it mounts instead of
  // kicking off its own server round-trip. Without this there are TWO serial
  // network hops after a scroll lands — page metadata, THEN each thumbnail —
  // and the second one only starts when the cell enters drawDistance, which is
  // the "thumbnails pop in late" lag. prefetchThumbsRef is late-bound because
  // the real fn needs getFullUrl (declared much further down this component).
  const sparseThumbsPrefetchedRef = useRef(new Set()); // pageIdx → thumbs warmed
  const prefetchThumbsRef = useRef(null);
  // Measured height of the floating vault header (insets + title row + any
  // extra strips). The timeline scrubber anchors BELOW it — measured, not
  // hardcoded, so search bars / context rows can't overlap the rail.
  const [vaultHeaderH, setVaultHeaderH] = useState(0);

  // ── Self-draining, viewport-prioritized page loader ─────────────────────
  // The old loader fetched inline and `break`-ed when the concurrency cap was
  // full — silently DROPPING regions. After a scrub-jump (which emits no
  // momentum events), nothing re-requested them, so the viewport sat on
  // skeletons "until you touch the screen". This design separates WANTING a
  // page from FETCHING it:
  //   • ensureSparseRegion registers interest (cheap, never drops),
  //   • pumpSparseQueue drains the wanted-set, ALWAYS nearest-to-viewport
  //     first, and re-pumps itself as each fetch settles — so once interest
  //     is registered the queue self-drains to completion, zero further
  //     scroll events required.
  const SPARSE_CONCURRENCY = 5;
  const SPARSE_WANTED_CAP = 24;            // a fast fling can't queue the whole library
  const sparseWantedRef = useRef(new Set()); // pageIdx wanted but not yet fetched
  const sparseCenterRef = useRef(0);         // page index the viewport centers on

  // Coalesce page-land commits into ONE state update per frame. With 5
  // concurrent fetches resolving within milliseconds of each other, the old
  // per-page setSparseVersion produced a burst of full virtual-array rebuilds
  // and tiles popping in at slightly staggered moments; batched, a region
  // resolves together as a single wave.
  const sparseCommitRafRef = useRef(null);
  const commitSparsePages = useCallback(() => {
    if (sparseCommitRafRef.current != null) return;
    sparseCommitRafRef.current = requestAnimationFrame(() => {
      sparseCommitRafRef.current = null;
      setSparseVersion((v) => v + 1);
    });
  }, []);
  useEffect(() => () => {
    if (sparseCommitRafRef.current != null) cancelAnimationFrame(sparseCommitRafRef.current);
  }, []);

  const pumpSparseQueue = useCallback(() => {
    if (!virtualEnabledRef.current) { sparseWantedRef.current.clear(); return; }
    while (
      sparseInflightRef.current.size < SPARSE_CONCURRENCY &&
      sparseWantedRef.current.size > 0
    ) {
      // Pick the wanted page nearest the CURRENT viewport center — the user's
      // latest position always wins over stale fling debris.
      const center = sparseCenterRef.current;
      let best = null;
      let bestD = Infinity;
      for (const p of sparseWantedRef.current) {
        if (sparsePagesRef.current.has(p) || sparseInflightRef.current.has(p)) {
          sparseWantedRef.current.delete(p);
          continue;
        }
        const d = Math.abs(p - center);
        if (d < bestD) { bestD = d; best = p; }
      }
      if (best == null) return;
      sparseWantedRef.current.delete(best);
      sparseInflightRef.current.add(best);
      const startedAt = Date.now();
      // Epoch guard: a sort/album/search change mid-flight resets the sparse
      // cache — a stale response must NOT repopulate it (wrong photos under
      // the new headers + duplicate FlashList keys).
      const epoch = sparseEpochRef.current;
      // q dropped: this is the BROWSE path. buildGalleryUrl would otherwise
      // route a live query to FTS, and the sparse cache is page-indexed
      // against the browse ordering.
      api.get(buildGalleryUrl({ ...filtersRef.current, q: '' }, {
        limit: SPARSE_PAGE, offset: best * SPARSE_PAGE, album: selectedAlbumRef.current, kind,
      }))
        .then((res) => {
          if (epoch === sparseEpochRef.current && res && res.success && Array.isArray(res.items)) {
            sparsePagesRef.current.set(best, res.items);
            if (sparsePagesRef.current.size > SPARSE_MAX_PAGES) {
              const keys = Array.from(sparsePagesRef.current.keys())
                .sort((a, b) => Math.abs(b - sparseCenterRef.current) - Math.abs(a - sparseCenterRef.current));
              const drop = keys.slice(0, sparsePagesRef.current.size - SPARSE_MAX_PAGES);
              // Evicting a page's metadata also forgets it was warmed, so a
              // later return to that region re-prefetches its thumbnails.
              for (const k of drop) { sparsePagesRef.current.delete(k); sparseThumbsPrefetchedRef.current.delete(k); }
            }
            commitSparsePages();
            // Warm this just-landed region's thumbnails (if it's near the
            // viewport) so the cells paint instantly instead of each firing a
            // fresh request when it scrolls in.
            prefetchThumbsRef.current && prefetchThumbsRef.current();
          }
          const ms = Date.now() - startedAt;
          if (ms > 400) console.log(`[vault] slow page fetch: page ${best} took ${ms}ms`);
        })
        .catch(() => {
          // Transient failure: re-register interest so the self-pump (or the
          // next settle trigger) retries — a failed page can no longer strand
          // skeletons forever. (Unless the sort/album context changed — then
          // this page number belongs to a dead result set.)
          if (epoch === sparseEpochRef.current) sparseWantedRef.current.add(best);
        })
        .finally(() => {
          sparseInflightRef.current.delete(best);
          pumpSparseQueue(); // ← self-draining: each settled fetch pulls the next
        });
    }
  }, [api, commitSparsePages]);

  const ensureSparseRegion = useCallback((firstIdx, lastIdx, centerIdx) => {
    if (!virtualEnabledRef.current) return;
    const total = uploadTotalRef.current;
    if (!total) return;
    const lastPageIdx = Math.max(0, Math.ceil(total / SPARSE_PAGE) - 1);
    const firstPage = Math.min(lastPageIdx, Math.max(0, Math.floor(Math.max(0, firstIdx) / SPARSE_PAGE)));
    const lastPage = Math.min(lastPageIdx, Math.max(firstPage, Math.floor(Math.max(0, lastIdx) / SPARSE_PAGE)));
    sparseCenterRef.current = Math.floor(Math.max(0, (centerIdx ?? firstIdx)) / SPARSE_PAGE);
    for (let p = firstPage; p <= lastPage; p++) {
      if ((p + 1) * SPARSE_PAGE <= prefixLenRef.current) continue;        // prefix covers it
      if (sparsePagesRef.current.has(p) || sparseInflightRef.current.has(p)) continue;
      sparseWantedRef.current.add(p);                                     // never dropped, only queued
    }
    // Bound the queue: keep only the pages nearest the current center.
    if (sparseWantedRef.current.size > SPARSE_WANTED_CAP) {
      const keep = Array.from(sparseWantedRef.current)
        .sort((a, b) => Math.abs(a - sparseCenterRef.current) - Math.abs(b - sparseCenterRef.current))
        .slice(0, SPARSE_WANTED_CAP);
      sparseWantedRef.current = new Set(keep);
    }
    pumpSparseQueue();
  }, [pumpSparseQueue]);

  // === UPLOAD MODAL DRAG PHYSICS ===
  const uploadModalY = useRef(new Animated.Value(0)).current;

  // === UPLOAD MODAL KEYBOARD LIFT ===
  // Same technique as the Turtle chat composer: ONE useAnimatedKeyboard shared
  // value drives a translateY on the UI thread, so the card tracks the keyboard
  // frame-for-frame — including the interactive swipe-down dismiss, which the
  // old KeyboardAvoidingView couldn't follow. KAV animates a LAYOUT prop
  // (padding/height) from the JS thread on its own timeline, which is why the
  // card used to jump and settle a beat behind the keyboard.
  //
  // It rides on a WRAPPER around the card, not the card itself: the card's
  // transform belongs to the RN Animated drag/dismiss, and an RN Animated value
  // and a Reanimated style can't share one node.
  const uploadKeyboard = useAnimatedKeyboard();
  // Measured card height, so the lift can be exact instead of a guess. Shared
  // value (not state) — it's read inside the worklet every frame.
  const uploadCardH = useSharedValue(0);
  const uploadKeyboardLift = useAnimatedStyle(() => {
    'worklet';
    const kb = uploadKeyboard.height.value;
    const cardH = uploadCardH.value;
    if (kb <= 0 || cardH <= 0) return { transform: [{ translateY: 0 }] };
    // The card is CENTERED in the overlay, so it isn't lifted by the full
    // keyboard height the way the bottom-pinned composer is — it re-centres in
    // the space that's left above the keyboard. Clamped so a tall card on a
    // small screen slides under the status bar rather than off the top.
    const restingTop = (height - cardH) / 2;
    const targetTop = Math.max(insets.top + 8, (height - kb - cardH) / 2);
    return { transform: [{ translateY: -Math.max(0, restingTop - targetTop) }] };
  });

  // Reset modal position when it opens - CRITICAL: stop any running animation first
  useEffect(() => {
    if (uploadModalVisible) {
      uploadModalY.stopAnimation();
      uploadModalY.setValue(0);
      // Also reset any animated value flattening issues
      uploadModalY.flattenOffset();
    }
  }, [uploadModalVisible, uploadModalY]);

  const dismissUploadModal = useCallback(() => {
    Keyboard.dismiss();
    uploadModalY.stopAnimation();
    Animated.timing(uploadModalY, {
      toValue: height, // Slide it off the bottom of the screen
      duration: 250,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start(() => {
      setUploadModalVisible(false);
      setPendingAssets([]);
    });
  }, [uploadModalY]);

  const uploadPanResponder = useRef(
    PanResponder.create({
      // Only capture the drag if it's a distinct vertical swipe down (protects horizontal chip scrolling)
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return gestureState.dy > 10 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx);
      },
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0) { // Only allow dragging downwards
          uploadModalY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > 120 || gestureState.vy > 1.5) {
          // User dragged far enough or fast enough -> dismiss
          dismissUploadModal();
        } else {
          // Snap back to center
          Animated.spring(uploadModalY, {
            toValue: 0,
            useNativeDriver: true,
            friction: 8,
            tension: 40,
          }).start();
        }
      },
    })
  ).current;

  // === DERIVED DATA ===
  // Get current items based on active tab
  // Only the Photos (uploads) grid is data-backed now; the Albums tab renders
  // album folders, not a media grid.
  const currentItems = uploadItems;
  const currentHasMore = hasMoreUploads;
  
  // Filter state
  const [selectedAlbum, setSelectedAlbum] = useState('All');
  // Read by the debounced FTS effect, which is declared above this and would
  // otherwise close over a stale board name.
  const selectedAlbumRef = useRef(selectedAlbum);
  selectedAlbumRef.current = selectedAlbum;

  // Does the open board have a live public link? Drives the header's "on the
  // web" cue. Declared here, after selectedAlbum — liveAlbums is filled far
  // above, but reading selectedAlbum before this line is a TDZ crash.
  const selectedAlbumIsLive = selectedAlbum !== 'All'
    && liveAlbums.has(String(selectedAlbum || '').toLowerCase());

  // === O(1) HASH MAP FILTERING ===
  // 1. Build the O(1) Dictionary ONCE when data loads (MUST be before pinnedAlbums)
  const tagDictionary = useMemo(() => {
    const dict = { 'All': currentItems };
    currentItems.forEach(item => {
      // tagsOf caches the parse per item object — this rebuild runs on every
      // pagination append, and re-JSON.parsing thousands of unchanged items
      // was the dominant cost of each append.
      tagsOf(item).forEach(tag => {
        if (!dict[tag]) dict[tag] = [];
        dict[tag].push(item);
      });
    });
    return dict;
  }, [currentItems]);

  // Intercept global albums to forcefully pin "Favourites" to the beginning of the list
  // Also filter by search query for albums tab
  // Intercept global albums and merge with locally discovered tags for instant UI updates
  // PRECOMPUTED ALBUM INDEX (built ONCE per album-set change, NOT per keystroke):
  // each album name paired with a normalized key (lowercased, separators
  // stripped). The realtime search then only scans these precomputed keys —
  // O(n) substring tests over a few hundred short strings = instant, "Everything"
  // -app responsiveness, with no per-keystroke re-normalization.
  const albumIndex = useMemo(() => {
    const localTags = Object.keys(tagDictionary).filter(k => k !== 'All' && k !== 'image' && k !== 'video');
    const names = Array.from(new Set([...globalAlbums, ...localTags]))
      .filter(name => !HIDDEN_ALBUMS.has(String(name).toLowerCase()));
    return names.map(name => ({ name, norm: name.toLowerCase().replace(/[-_\s]/g, '') }));
  }, [globalAlbums, tagDictionary]);

  const pinnedAlbums = useMemo(() => {
    const q = (activeTab === 'albums' ? albumSearchQuery : '').toLowerCase().replace(/[-_\s]/g, '');

    let result;
    if (q) {
      // Filter to matches, ranked Everything-style: exact → prefix → earliest
      // substring → alphabetical. Only one indexOf per album (precomputed norm).
      result = albumIndex
        .map(({ name, norm }) => {
          const at = norm.indexOf(q);
          if (at < 0) return null;
          const rank = norm === q ? 0 : at === 0 ? 1 : 2;
          return { name, rank, at };
        })
        .filter(Boolean)
        .sort((a, b) => a.rank - b.rank || a.at - b.at || a.name.localeCompare(b.name))
        .map(s => s.name);
    } else {
      result = albumIndex.map(a => a.name).sort((a, b) => a.localeCompare(b));
    }

    // Pin 'Favourites' to the front whenever it's in the (filtered) result.
    const favIndex = result.indexOf('Favourites');
    if (favIndex > 0) {
      result = ['Favourites', ...result.slice(0, favIndex), ...result.slice(favIndex + 1)];
    }
    return result;
  }, [albumIndex, albumSearchQuery, pagerTab]);

  const boardModels = useMemo(() => buildPhotoVaultBoards({
    names: albumIndex.map((album) => album.name),
    coversByName: albumCovers,
    countsByName: albumCounts,
    latestDatesByName: albumLatestDates,
    query: pagerTab === 'albums' ? albumSearchQuery : '',
    sortMode: boardSortMode,
    // Boards published to the web wear a LIVE badge in the grid, so you can
    // see what is public without opening a single board menu.
    liveAlbumNames: liveAlbums,
  }), [
    albumIndex,
    albumCovers,
    albumCounts,
    albumLatestDates,
    albumSearchQuery,
    boardSortMode,
    pagerTab,
    liveAlbums,
  ]);

  // "All Photos" — the whole library presented as a board, pinned above the
  // user's own on the Boards page. Its covers are the newest loaded thumbnails
  // (no extra request; the timeline has already fetched them) and its count is
  // the server's true total, not the number currently in memory.
  const allPhotosBoard = useMemo(() => {
    const covers = [];
    // The hero pane is ~65% of a full-width card — roughly 720px of real
    // pixels @3x — so the grid-sized thumbnail that fills the two small panes
    // is visibly soft blown up that large. The hero (and ONLY the hero) also
    // gets the second-tier `thumbnailLgUrl`, which the card layers OVER the
    // small one as a lazy upgrade: the cheap thumb is already cached from the
    // timeline, so it paints instantly and the big file swaps in when it
    // arrives. One extra request per boards page, not four.
    let heroHiRes = null;
    for (const item of uploadItems) {
      if (!item || item.isSkeleton) continue;
      const path = item.thumbnailUrl || item.url;
      if (!path) continue;
      if (!covers.length) heroHiRes = item.thumbnailLgUrl || item.compressedUrl || null;
      covers.push(path);
      if (covers.length === 3) break;
    }
    return {
      name: 'All Photos',
      covers,
      heroHiRes,
      count: globalUploadsTotal,
      metadata: formatBoardMetadata(globalUploadsTotal, 0),
    };
  }, [uploadItems, globalUploadsTotal]);



  // 2. Derive dropdown list instantly from the dictionary + global DB
  const availableAlbums = useMemo(() => {
    const loadedTags = Object.keys(tagDictionary).filter(k => k !== 'All');
    const allUnique = new Set([...pinnedAlbums, ...loadedTags]);
    const sortedUnique = Array.from(allUnique).sort();
    return ['All', ...sortedUnique];
  }, [tagDictionary, pinnedAlbums]);

  // 3. The server natively filters the payload, so the "filtered" list IS the
  // current list — these were two pass-through useMemos wrapping an identity.
  const filteredItems = currentItems || [];
  const displayItems = filteredItems;

  // Solo override: a far-jumped photo that somehow isn't in the pager's
  // source array gets opened on its own so the tap still works. With
  // `viewerSourceItems` (defined below) now matching the grid's rendered set,
  // this should essentially never trigger for a normal tap — it's a safety net.
  const [viewerSoloItem, setViewerSoloItem] = useState(null);
  // NOTE: `viewerItems` (the array the full-screen pager walks) is defined
  // below, AFTER `uploadDisplayItems`, because it derives from it. Defining it
  // here would hit the temporal-dead-zone for that const.

  // Independent lists for simultaneous rendering.
  //
  // VIRTUAL LIBRARY: on the unfiltered "All" view, the grid's data spans the
  // ENTIRE library (timeline.total): the contiguous newest prefix (uploadItems)
  // renders real thumbnails, sparse-loaded pages fill in wherever the user
  // scrolls/jumps, and everything else is a skeleton cell. FlashList virtualizes
  // the length, so a 47k-item array is just cheap metadata — and a scrub-jump to
  // any year lands instantly on skeletons that resolve as their page arrives.
  const uploadDisplayItems = useMemo(() => {
    if (loading && uploadItems.length === 0) {
      return Array.from({ length: 21 }, (_, i) => slotAt(i));
    }

    // Filter by search query. Once the server FTS round-trip for THIS query
    // lands it becomes the display set (whole-library coverage: filename, tags,
    // AI labels, OCR, summaries); until then — and on failure — the instant
    // client-side tag filter over loaded items stands in.
    let filtered = uploadItems || [];
    const trimmedQuery = uploadsSearchQuery.trim();
    if (trimmedQuery) {
      if (serverSearch && serverSearch.query === trimmedQuery) {
        filtered = serverSearch.items;
      } else {
        const query = trimmedQuery.toLowerCase().replace(/[-_\s]/g, '');
        filtered = filtered.filter(item =>
          tagsOf(item).some(tag =>
            tag.toLowerCase().replace(/[-_\s]/g, '').includes(query)
          )
        );
      }
    }

    prefixLenRef.current = filtered.length;
    // Virtual mode maps month buckets onto page offsets assuming the server's
    // default DESCENDING order, and it is a whole-library device — any active
    // filter or an ascending sort breaks that mapping. Fall back to plain
    // pagination rather than rewrite the bucket math.
    const virtual = selectedAlbum === 'All'
      && !uploadsSearchQuery.trim()
      && filters.direction === 'desc'
      && filters.mediaType === 'all'
      && filters.tag.length === 0
      && !filters.sceneType
      && filters.from == null
      && filters.to == null
      && uploadTimeline.total > filtered.length;
    virtualEnabledRef.current = virtual;
    if (!virtual) return filtered;

    const total = uploadTimeline.total;
    // Guard against an id appearing in both the prefix and a sparse page
    // (counts can shift between the buckets fetch and a page fetch) — a
    // duplicate key would crash FlashList's keyExtractor contract.
    const prefixIds = new Set();
    for (let i = 0; i < filtered.length; i++) prefixIds.add(filtered[i].id);
    const out = new Array(total);
    for (let i = 0; i < filtered.length; i++) out[i] = filtered[i];
    for (let i = filtered.length; i < total; i++) {
      const page = sparsePagesRef.current.get(Math.floor(i / SPARSE_PAGE));
      const it = page ? page[i % SPARSE_PAGE] : null;
      out[i] = (it && it.id && !prefixIds.has(it.id))
        ? it
        : slotAt(i);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadItems, loading, uploadsSearchQuery, serverSearch, selectedAlbum, uploadTimeline.total, sparseVersion]);
  // Keep the drag-select range math reading the SAME array the grid renders.
  uploadItemsForDragRef.current = uploadDisplayItems;

  // ── Data-driven scrubber extent (Instagram-style index bar) ─────────────
  // The rail/thumb/jump math used to depend ONLY on measured layout
  // (onContentSizeChange/onLayout), so until the first real layout pass the
  // scrubber ran against maxScroll=1 — a stubby, wrong-length index bar on a
  // fresh mount. But every grid cell is a fixed square (pitch = width/cols),
  // so the content height is fully KNOWN from the data: seed the extent
  // analytically the moment the rendered count or column count changes. The
  // measured values still overwrite when layout lands (they add the list
  // header's height, which the estimate omits) — the seed just guarantees the
  // index bar is full-length and jumpable instantly, layout or not.
  const scrubExtentKeyRef = useRef('');
  useEffect(() => {
    const len = uploadDisplayItems.length;
    if (!len) return;
    const key = `${len}:${gridCols}`;
    // Re-seed only when the grid's shape actually changed — never fight a
    // real measurement while the shape is stable.
    if (scrubExtentKeyRef.current === key && gridContentH.current > 0) return;
    scrubExtentKeyRef.current = key;
    const pitch = width / gridCols;
    // Paddings must mirror the grid's contentContainerStyle exactly, tab-bar
    // reservation included, or the analytic extent drifts from the real one.
    const expected = Math.ceil(len / gridCols) * pitch
      + (insets.top + 90)
      + Math.max(insets.bottom + 16, tabBarH + 16);
    gridContentH.current = expected;
    maxScrollSv.value = Math.max(1, expected - (gridLayoutH.current || height));
  }, [uploadDisplayItems, gridCols, insets.top, insets.bottom, tabBarH, maxScrollSv]);

  // The array the full-screen pager walks. It MUST be the same set the grid
  // renders, or a tapped photo won't be found in it and the pager collapses to
  // a single, un-swipeable item (the regression that broke left/right swipe).
  // For uploads that's the REAL (non-skeleton) items of the virtual library —
  // the loaded prefix plus any sparse pages already fetched; skeletons are
  // dropped so you never swipe onto a blank placeholder. Other tabs use the
  // plain filtered list.
  const viewerSourceItems = useMemo(() => {
    const base = activeTab === 'uploads'
      ? (uploadDisplayItems || []).filter((it) => it && !it.isSkeleton)
      : (displayItems || []);
    // ── PAGER SWIPE DIRECTION — DEVICE-CONFIRMED; do NOT "fix" back
    //    (see memory note photo-viewer-swipe-direction) ───────────────────
    // RULE: swipe-RIGHT → LATEST, swipe-LEFT → OLDEST (English reading order,
    // matching the grid: oldest top-left → newest bottom-right).
    //
    // The REVERSED array is what produces this on device. The user verified it
    // with a fresh viewer open: without the `.reverse()` the swipe is inverted
    // (swipe-right → oldest), WITH it the swipe is correct (swipe-right →
    // latest). This is the settled answer — it has been tested both ways on the
    // actual phone. Do NOT remove `.reverse()`, and do NOT re-derive it from the
    // index math (that reasoning has been wrong here repeatedly; the device wins).
    //
    // openViewer / initialScrollIndex / momentum / parallax all index into THIS
    // reversed array, so the tapped photo still opens correctly; only traversal
    // flips. VIEWER-ONLY — the grid array (uploadDisplayItems) is never reversed.
    return base.slice().reverse();
  }, [activeTab, uploadDisplayItems, displayItems]);
  // Mirror for openViewer to read without depending on (and thus re-creating
  // on) this frequently-changing array — keeps openViewer/renderItem stable so
  // the grid doesn't re-render every cell as sparse pages land mid-scroll.
  const viewerSourceItemsRef = useRef(viewerSourceItems);
  viewerSourceItemsRef.current = viewerSourceItems;
  const viewerItems = useMemo(
    () => (viewerSoloItem ? [viewerSoloItem] : viewerSourceItems),
    [viewerSourceItems, viewerSoloItem],
  );

  // ── Timeline scrubber wiring ─────────────────────────────────────────────
  // The scrubber itself (rail, thumb, bubble, haptics) is the worklet-driven
  // TimelineScrubber component; this side only prepares its data + handles the
  // two JS-thread jobs: jumping the list and sparse-loading what's visible.

  // Show on the main uploads view once there's a real timeline to navigate.
  const scrubEnabled = activeTab === 'uploads'
    && selectedAlbum === 'All'
    && !isSelectMode
    && (uploadTimeline.total >= 30 || uploadDisplayItems.length >= 30);

  // Album / search / sort-basis context change → the sparse cache describes
  // a different result set (or a different ORDER BY); drop it AND orphan any
  // in-flight page fetches (epoch bump) so they can't repopulate it.
  useEffect(() => {
    sparseEpochRef.current += 1;
    sparsePagesRef.current.clear();
    sparseInflightRef.current.clear();
    sparseThumbsPrefetchedRef.current.clear();
    setSparseVersion((v) => v + 1);
  }, [selectedAlbum, uploadsSearchQuery, sortMode]);

  // Scrubber data: cumulative month starts + labels + per-month counts + year
  // marks, from the full-library buckets — falling back to the loaded items
  // until the buckets arrive. `frac` on a year mark is the VISUAL fraction
  // (0 = rail top = oldest … 1 = bottom = newest).
  // SPLIT MEMOS — performance-critical. The display array rebuilds on EVERY
  // sparse page-land; if scrubberData depended on it while the timeline
  // exists, the scrubber would get a NEW data object (→ re-render + worklet
  // reaction re-init) for every page that arrives mid-scrub. Timeline data
  // depends ONLY on the buckets, so its reference stays stable through an
  // entire scrubbing session; the loaded-items fallback (pre-buckets only)
  // short-circuits to null the moment the timeline exists.
  const timelineScrubData = useMemo(() => {
    const { months, total } = uploadTimeline;
    if (!(months && months.length > 0 && total > 1)) return null;
    const starts = months.map((m) => m.start);
    const labels = months.map((m) => m.label);
    const countLabels = months.map((m) => `${(m.count || 0).toLocaleString()} item${m.count === 1 ? '' : 's'}`);
    const yearMarks = [];
    const seen = new Set();
    for (const m of months) {
      if (!m.year || seen.has(m.year)) continue;
      seen.add(m.year);
      yearMarks.push({ year: m.year, frac: 1 - m.start / (total - 1) });
    }
    return { starts, labels, countLabels, total, yearMarks };
  }, [uploadTimeline]);

  // Sort-basis-aware date: under 'upload' sort the grid orders by uploadDate,
  // so the fallback scrubber must key its months on the SAME date or its
  // labels/marks drift from the actual scroll order.
  const dateOfSorted = useCallback((item) => {
    const raw = item && (sortMode === 'upload' ? item.uploadDate : (item.originalDate || item.uploadDate));
    if (!raw) return null;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }, [sortMode]);

  const fallbackScrubData = useMemo(() => {
    if (timelineScrubData) return null; // buckets arrived — skip the 25k-item walk entirely
    const items = (uploadDisplayItems || []).filter((it) => it && !it.isSkeleton);
    const n = items.length;
    if (n < 2) return { starts: [], labels: [], countLabels: [], total: 0, yearMarks: [] };
    const starts = []; const labels = []; const countLabels = [];
    const yearMarks = []; const seenY = new Set();
    let lastKey = '';
    for (let i = 0; i < n; i++) {
      const d = dateOfSorted(items[i]);
      if (!d) continue;
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (key !== lastKey) {
        lastKey = key;
        starts.push(i);
        labels.push(d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }));
        countLabels.push('');
      }
      const y = String(d.getFullYear());
      if (!seenY.has(y)) { seenY.add(y); yearMarks.push({ year: y, frac: 1 - i / (n - 1) }); }
    }
    return { starts, labels, countLabels, total: n, yearMarks };
  }, [timelineScrubData, uploadDisplayItems, dateOfSorted]);

  const scrubberData = timelineScrubData || fallbackScrubData;

  // Native scroll → feed the scrubber's shared values + sparse-load the
  // viewport's region (rAF-throttled). No setState here — the scrubber
  // animates on the UI thread.
  // Register interest for whatever is in (and around) the viewport RIGHT NOW.
  // Called from scroll frames (rAF-throttled), from the settle triggers below,
  // and after scrub jumps — the "load once the scroll stops moving" behavior.
  const ensureVisibleRegionNow = useCallback(() => {
    if (!virtualEnabledRef.current) return;
    const cols = gridColsRef.current;
    const pitch = cellPitch();
    const rowFirst = Math.floor(scrubLastY.current / pitch);
    const rowsVisible = Math.ceil((gridLayoutH.current || height) / pitch);
    // One viewport behind + two ahead in index space — generous prefetch so
    // flung scrolling lands on already-loading pages.
    const first = Math.max(0, (rowFirst - rowsVisible) * cols);
    const last = (rowFirst + rowsVisible * 2) * cols;
    ensureSparseRegion(first, last, rowFirst * cols);
    // Warm thumbnails for whatever loaded pages now sit around the viewport.
    // Runs on every (rAF-throttled) scroll frame incl. momentum, so as a fling
    // decelerates onto already-loaded pages their images request immediately —
    // dedup'd so each page is only ever prefetched once.
    prefetchThumbsRef.current && prefetchThumbsRef.current();
  }, [ensureSparseRegion]);

  // ── Grid video preview (Instagram-style) ────────────────────────────
  // A single muted, looping preview plays at a time: the centermost video in
  // the visible region. It's driven LIVE by viewability so it keeps playing
  // untouched while it stays on screen — only when it scrolls OUT of the
  // visible region (or none was playing yet) do we hand the one live decoder
  // to the next centermost video. We deliberately do NOT pause/reset on scroll:
  // remounting the preview reloads it from frame 0, which was the "video
  // restarts on every scroll" bug. The active id is read in renderItem via a
  // ref and re-renders only the two affected cells via gridSelectionExtra.
  const [activeVideoId, setActiveVideoId] = useState(null);
  const activeVideoIdRef = useRef(null);
  activeVideoIdRef.current = activeVideoId;
  // The centermost viewable video on the last viewability pass — a backstop the
  // settle handler can seed from if nothing is playing yet.
  const viewableVideoRef = useRef(null);
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 65 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    const items = viewableItems || [];
    // Median index of the viewable window ≈ screen centre (works regardless of
    // the scaleY(-1) flip — it's about WHICH items are on screen, not pixels).
    const midIdx = items.length ? (items[Math.floor(items.length / 2)]?.index ?? null) : null;
    const active = activeVideoIdRef.current;
    let best = null, bestDist = Infinity, activeStillVisible = false;
    for (const v of items) {
      const it = v.item;
      if (!it || it.isSkeleton || it.type !== 'video') continue;
      if (it.id === active) activeStillVisible = true;
      const d = midIdx == null ? 0 : Math.abs((v.index ?? 0) - midIdx);
      if (d < bestDist) { bestDist = d; best = it.id; }
    }
    viewableVideoRef.current = best;
    if (!GRID_VIDEO_PREVIEW) return;
    // Keep the current preview playing as long as it's STILL on screen — a
    // scroll that leaves it visible must not remount it (remount = reload from
    // 0). Only once the active video has scrolled out of the visible region (or
    // none is active) do we commit the centermost visible video as the new one.
    // Guarded so an identical commit never triggers a re-render.
    if (active && activeStillVisible) return;
    if (active !== best) setActiveVideoId(best);
  }).current;

  // Leaving the uploads grid (album swipe / tab change) must release the
  // decoder so it never plays off-screen.
  useEffect(() => {
    if (activeTab !== 'uploads' && activeVideoIdRef.current !== null) setActiveVideoId(null);
  }, [activeTab]);

  const handleGridScroll = useCallback((e) => {
    const ne = e && e.nativeEvent;
    if (!ne) return;
    // No pause-on-scroll: viewability keeps the centermost video playing while
    // it stays on screen and only hands off when it scrolls out (see
    // onViewableItemsChanged), so scrolling past a visible video never reloads it.
    scrubLastY.current = (ne.contentOffset && ne.contentOffset.y) || 0;
    if (ne.contentSize && ne.contentSize.height) gridContentH.current = ne.contentSize.height;
    if (ne.layoutMeasurement && ne.layoutMeasurement.height) gridLayoutH.current = ne.layoutMeasurement.height;
    scrollYSv.value = scrubLastY.current;
    maxScrollSv.value = Math.max(1, gridContentH.current - gridLayoutH.current);
    // The scrubber SVs above track EVERY frame (smooth thumb). Everything below
    // is JS-only UI bookkeeping (jump-pill visibility, idle re-arm, sparse
    // prefetch) that doesn't need 60Hz — running it per frame was the dominant
    // per-frame JS cost on this handler (incl. a clearTimeout+setTimeout churn
    // ~60×/s). Throttle it to every 4th frame; at 1500ms idle the ~64ms
    // granularity is imperceptible.
    scrubTailFrame.current = (scrubTailFrame.current + 1) & 3;
    if (scrubTailFrame.current !== 0) return;
    // Reveal the "jump to newest" pill only when (1) scrolled a LOT from the
    // newest — ~1.5 screens — and (2) moving TOWARD the newest (offset
    // decreasing = downward swipe in this mirrored grid). Scrolling up into
    // older keeps it hidden so it's never in the way.
    const y = scrubLastY.current;
    const delta = y - gridJumpLastY.current;
    gridJumpLastY.current = y;
    if (gridJumpingRef.current) {
      // Animating to newest from a tap — stay hidden until we arrive.
      if (y < 80) gridJumpingRef.current = false;
      setShowGridJump((prev) => (prev === false ? prev : false));
    } else {
      const farEnough = y > (gridLayoutH.current || 600) * 1.5;
      let wantJump;
      if (!farEnough) wantJump = false;       // near newest → hide
      else if (delta < -1) wantJump = true;   // toward newest (down) → show
      else if (delta > 1) wantJump = false;   // into older (up) → hide
      // Functional updater → React bails out when the flag is unchanged.
      if (wantJump !== undefined) setShowGridJump((prev) => (prev === wantJump ? prev : wantJump));
    }
    // Idle auto-hide: re-arm so the timer only fires once the grid goes still
    // (no more frames), fading the pill out a brief moment later.
    if (gridJumpIdleTimer.current) clearTimeout(gridJumpIdleTimer.current);
    gridJumpIdleTimer.current = setTimeout(() => {
      setShowGridJump((prev) => (prev === false ? prev : false));
    }, GRID_JUMP_IDLE_MS);
    if (!virtualEnabledRef.current || sparseRaf.current != null) return;
    sparseRaf.current = requestAnimationFrame(() => {
      sparseRaf.current = null;
      ensureVisibleRegionNow();
    });
  }, [ensureVisibleRegionNow, scrollYSv, maxScrollSv]);

  // Settle triggers: the moment a drag releases or a fling's momentum dies,
  // resolve exactly what the user is looking at — no touch required.
  const handleGridScrollSettled = useCallback(() => {
    ensureVisibleRegionNow();
    // Hand-off happens live in onViewableItemsChanged; this is only a backstop —
    // if nothing is previewing but a video is centred at rest, seed it. Guarded
    // so it never restarts a preview that's already playing.
    if (GRID_VIDEO_PREVIEW && activeVideoIdRef.current == null && viewableVideoRef.current) {
      setActiveVideoId(viewableVideoRef.current);
    }
  }, [ensureVisibleRegionNow]);

  // Scrubber drag → jump the grid to a data fraction (0 = newest … 1 = oldest)
  // and pre-load that region. With the virtual full-length grid, offset math is
  // exact — no clamping to the loaded slice, no sequential page-pulling.
  // Debounced "the thumb stopped here" trigger: scrub jumps are programmatic
  // scrolls that emit NO momentum events, so without this a held-still thumb
  // would leave its region to the whims of the next touch. 160ms after the
  // last jump, resolve whatever the viewport actually rests on.
  const scrubSettleTimer = useRef(null);

  const handleScrubJump = useCallback((dataFrac) => {
    const f = Math.min(1, Math.max(0, dataFrac));
    const max = Math.max(1, gridContentH.current - gridLayoutH.current);
    const offset = f * max;
    scrubLastY.current = offset; // keep the settle math in sync with the jump
    scrollYSv.value = offset;
    try {
      if (gridRef.current && gridRef.current.scrollToOffset) {
        gridRef.current.scrollToOffset({ offset, animated: false });
      }
    } catch (err) { /* mid-layout — the next jump lands */ }
    const total = uploadTotalRef.current;
    if (total > 0) {
      const idx = Math.round(f * (total - 1));
      ensureSparseRegion(Math.max(0, idx - 90), idx + 90, idx);
    }
    if (scrubSettleTimer.current) clearTimeout(scrubSettleTimer.current);
    scrubSettleTimer.current = setTimeout(() => {
      scrubSettleTimer.current = null;
      ensureVisibleRegionNow();
    }, 160);
  }, [ensureSparseRegion, ensureVisibleRegionNow, scrollYSv]);

  // ── Albums A→Z scrubber data + jump ───────────────────────────────────────
  // Group the (already alphabetically-sorted) album list into first-letter
  // buckets so the shared rail can index them like the photos timeline indexes
  // months. `starts` = the album index each letter group begins at (ascending,
  // matching top-down scroll), `labels`/`countLabels` feed the bubble, and
  // `yearMarks` carries the letters as VISUAL fractions (frac = start/total, so
  // 'A' sits at the rail top). Non-letters (e.g. "Favourites" pinned first, or
  // numeric names) fold into a leading '#' group.
  const albumsScrubData = useMemo(() => {
    const names = boardModels.map((board) => board.name);
    const total = names.length;
    if (total < 2) return { starts: [], labels: [], countLabels: [], total: 0, yearMarks: [] };
    // "Favourites" is pinned to the front out of alphabetical order; give it a
    // star group so it never collides with a real 'F'. Other non-letters fold
    // into '#'.
    const letterOf = (name) => {
      if (name === 'Favourites') return '★';
      const c = String(name || '').trim().charAt(0).toUpperCase();
      return c >= 'A' && c <= 'Z' ? c : '#';
    };
    const starts = []; const labels = []; const counts = []; const marks = [];
    let last = null;
    for (let i = 0; i < total; i++) {
      const L = letterOf(names[i]);
      if (L !== last) {
        last = L;
        starts.push(i);
        labels.push(L);
        counts.push(0);
        // Only real A–Z letters get a tick on the rail, so the pinned ★/# group
        // can't crowd the top with an out-of-order label — but it still drives
        // the bubble (starts/labels) when you scrub onto it.
        if (L >= 'A' && L <= 'Z') marks.push({ year: L, frac: i / Math.max(1, total - 1) });
      }
      counts[counts.length - 1] += 1;
    }
    const countLabels = counts.map((n) => `${n} board${n === 1 ? '' : 's'}`);
    return { starts, labels, countLabels, total, yearMarks: marks };
  }, [boardModels]);

  // Worth showing only once the album list overflows a couple of screens — an
  // A→Z rail on a handful of albums is noise. Off while searching: those results
  // are relevance-ranked, not alphabetical, so letter groups wouldn't be ordered.
  // pagerTab, not activeTab: the A-Z rail belongs to the Boards page, which
  // stays mounted underneath while the photos page is pushed over it.
  const albumsScrubEnabled = pagerTab === 'albums'
    && boardSortMode === 'alphabetical'
    && !albumSearchQuery.trim()
    && boardModels.length >= 20;

  // Albums grid is a plain top-down FlatList: a jump maps the fraction straight
  // to a scroll offset (0 = top = 'A' … 1 = bottom = 'Z').
  const handleAlbumsScrubJump = useCallback((dataFrac) => {
    const f = Math.min(1, Math.max(0, dataFrac));
    const max = Math.max(1, albumsContentH.current - albumsLayoutH.current);
    const offset = f * max;
    albumsScrollYSv.value = offset;
    try {
      // Animated.FlatList: modern RN puts the list node on ref.current directly;
      // older RN nests it behind getNode(). Resolve the real node, then scroll.
      const node = albumsRef.current;
      const inner = (node && typeof node.getNode === 'function') ? node.getNode() : node;
      if (inner && inner.scrollToOffset) inner.scrollToOffset({ offset, animated: false });
    } catch (err) { /* mid-layout — the next jump lands */ }
  }, [albumsScrollYSv]);

  // Boards scroll → feed the shared rail values. Reads contentSize/layoutMeasurement off the scroll event so the
  // rail has a live max without a separate measure pass.
  const handleAlbumsScroll = useCallback((e) => {
    const ne = e && e.nativeEvent;
    if (!ne) return;
    if (ne.contentSize?.height) albumsContentH.current = ne.contentSize.height;
    if (ne.layoutMeasurement?.height) albumsLayoutH.current = ne.layoutMeasurement.height;
    albumsScrollYSv.value = (ne.contentOffset && ne.contentOffset.y) || 0;
    albumsMaxScrollSv.value = Math.max(1, albumsContentH.current - albumsLayoutH.current);
  }, [albumsScrollYSv, albumsMaxScrollSv]);

  // ── Tag×time "jump" ──────────────────────────────────────────────────
  // The tag SEARCH filters the grid in place (and turns OFF the virtual timeline +
  // scrubber). The JUMP is the opposite move: leave the filter and scroll the FULL
  // timeline to where this tag clusters in time, so you see it in context. Backed
  // by GET /media/tag-distribution (the precomputed tag×month index) which returns
  // a `suggestedDataFrac` in the SAME 0=newest…1=oldest space handleScrubJump uses.
  // We stash the fraction, clear the search (re-enabling the virtual grid), and let
  // onContentSizeChange fire the jump once the full timeline's height is measured —
  // so the fraction maps to a real scroll offset, not the short filtered height.
  // NOTE: never mutates the search filter logic itself — purely additive.
  const pendingJumpRef = useRef(null);
  const pendingJumpClearRef = useRef(null);   // safety timer that voids a never-consumed jump
  const [jumpBusy, setJumpBusy] = useState(false);
  const handleLocateTag = useCallback(async () => {
    const q = uploadsSearchQuery.trim();
    if (!q || jumpBusy) return;
    setJumpBusy(true);
    try {
      // sortBy so the returned suggestedDataFrac is computed in the SAME date
      // space (capture vs added) the scrubber is currently scrolling in.
      const res = await api.get(`/media/tag-distribution?tag=${encodeURIComponent(q)}&sortBy=${sortModeRef.current}`);
      if (res?.success && res.found && typeof res.suggestedDataFrac === 'number') {
        pendingJumpRef.current = res.suggestedDataFrac;
        // REDUNDANCY: if the jump is never consumed (e.g. the virtual timeline
        // doesn't re-engage on a tiny library), void the pending target after a
        // short window so a much-later content-size change can't fire a surprise
        // jump. Cleared the instant the jump actually lands (onContentSizeChange).
        if (pendingJumpClearRef.current) clearTimeout(pendingJumpClearRef.current);
        pendingJumpClearRef.current = setTimeout(() => {
          pendingJumpRef.current = null;
          pendingJumpClearRef.current = null;
        }, 4000);
        // Leave filter mode → the virtual timeline + scrubber come back; the jump
        // lands from onContentSizeChange once that layout's height is known.
        setUploadsSearchQuery('');
        setIsUploadsSearchVisible(false);
        Keyboard.dismiss();
      }
      // No-data case (untagged / too sparse / endpoint not yet mounted): leave the
      // filtered matches on screen untouched — the search still did its job.
    } catch (e) {
      // Network/permission hiccup — keep the working filter exactly as it is.
    } finally {
      setJumpBusy(false);
    }
  }, [uploadsSearchQuery, jumpBusy, api]);

  // Memoized — these previously ran .filter() over the full arrays on EVERY
  // render of this (large) component, including renders triggered by sparse
  // page-lands and upload progress ticks.
  const { photoCount, videoCount } = useMemo(() => {
    let v = 0;
    for (const it of filteredItems) if (it.type === 'video') v++;
    return { photoCount: filteredItems.length - v, videoCount: v };
  }, [filteredItems]);

  // Trigger a full server fetch when the selected album filter changes.
  // Skips the mount run — the initial-load Promise.all below already fetches
  // page 0; without the skip this effect double-fetched AND blanked the grid
  // while racing it.
  const albumEffectFirstRun = useRef(true);
  useEffect(() => {
    if (albumEffectFirstRun.current) { albumEffectFirstRun.current = false; return; }
    // 1. Orphan any in-flight fetches from the previous album context
    galleryEpochRef.current += 1;
    // 2. Immediately trigger the premium loading skeleton
    setLoading(true);
    // 3. Clear the old grid
    setUploadItems([]);

    // 4. Fetch the new album and drop the loading flag when done
    fetchUploads(true).finally(() => {
      setLoading(false);
    });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAlbum]);

  // Any filter change → the grid AND the timeline buckets now describe a
  // different set or a different ordering; cold-reload both (same skeleton
  // treatment as an album switch). Epoch bump orphans in-flight stale fetches.
  //
  // Keyed on filterSignature (defined up with the browse model), which
  // deliberately excludes the search query: queries are served by the
  // debounced FTS overlay above, and cold-reloading the browse grid on every
  // keystroke would throw away the user's scroll position for nothing.
  const filterFirstRun = useRef(true);
  useEffect(() => {
    if (filterFirstRun.current) { filterFirstRun.current = false; return; }
    galleryEpochRef.current += 1;
    // The sparse/virtual cache is keyed by page index against one ordering —
    // a filter change invalidates every page it holds.
    sparseEpochRef.current += 1;
    setLoading(true);
    setUploadItems([]);
    // Drop the old month frame so the scrubber doesn't show stale months until
    // fetchBuckets() returns the new timeline.
    setUploadTimeline({ months: [], total: 0 });
    Promise.all([fetchUploads(true), fetchBuckets()]).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterSignature]);

  // === API CALLS ===
  // Fetch uploads from database with strict deduplication
  const fetchUploads = useCallback(async (isRefresh = false) => {
    // Prevent simultaneous pagination fetches
    if (!isRefresh && isPaginating) return;
    
    try {
      if (!isRefresh) setIsPaginating(true);
      
      const currentOffset = isRefresh ? 0 : uploadOffset;
      const epoch = galleryEpochRef.current;
      // sortBy=original orders by the photo's TAKEN date (Google-Photos style),
      // so the month/year timeline spans the real capture history instead of
      // the upload date (which clusters at import time for a bulk-uploaded
      // library — the "everything shows 2026" symptom). Every parameter now
      // comes from the one browse model, so this page, the sparse pages, the
      // scrubber buckets and the facets can never disagree about what's shown.
      // q dropped — the browse grid never routes to FTS; the debounced search
      // overlay owns queries.
      const response = await api.get(buildGalleryUrl({ ...filters, q: '' }, {
        limit: LIMIT, offset: currentOffset, album: selectedAlbum, kind,
      }));
      // Sort/album context changed while this was in flight — its rows belong
      // to a dead ordering; merging them would corrupt the new list and
      // clobber uploadOffset. (finally still clears isPaginating.)
      if (epoch !== galleryEpochRef.current) return;

      if (response.success) {
        // Safely capture the true total count from the server response
        setGlobalUploadsTotal(response.pagination?.total || response.total || response.items?.length || 0);
        
        if (isRefresh) {
          // Pure refresh - just set the items
          setUploadItems(response.items || []);
          setUploadOffset(LIMIT);
        } else {
          // Pagination - merge and strictly deduplicate by ID to prevent jumping
          setUploadItems(prev => {
            const combined = [...(response.items || []), ...prev];
            // Use Map to ensure absolute uniqueness by ID
            const uniqueMap = new Map();
            combined.forEach(item => {
              if (item && item.id) uniqueMap.set(item.id, item);
            });
            
            // Convert back to array and maintain chronological sort (newest
            // first for inverted list), by whichever date basis is active so
            // it matches the server's ORDER BY and the scrubber's timeline:
            // 'original' = TAKEN date (originalDate, uploadDate fallback),
            // 'upload' = date ADDED to Turtle.
            const dateOf = sortMode === 'upload'
              ? (m) => new Date(m.uploadDate)
              : (m) => new Date(m.originalDate || m.uploadDate);
            // Match the server's direction too — an ascending page merged with
            // a hardcoded descending sort would scramble the timeline.
            const sign = filters.direction === 'asc' ? -1 : 1;
            return Array.from(uniqueMap.values()).sort((a, b) => sign * (dateOf(b) - dateOf(a)));
          });
          setUploadOffset(currentOffset + LIMIT);
        }
        setHasMoreUploads(response.pagination?.hasMore || false);
      }
    } catch (error) {
      console.error('[MediaGallery] Fetch uploads error:', error);
    } finally {
      if (!isRefresh) setIsPaginating(false);
    }
  }, [api, uploadOffset, selectedAlbum, isPaginating, sortMode, filters, kind]);

  // Fetch the month/year timeline for the scrubber (full library, by taken
  // date). Builds cumulative start indices so a scrub fraction maps to a month
  // label AND an item index for scrollToIndex. The same response carries the
  // tag and scene facet counts the filter sheet's chips are built from.
  const fetchBuckets = useCallback(async () => {
    try {
      const res = await api.get(buildBucketsUrl(filters, { album: selectedAlbum, kind }));
      if (!res || !res.success || !Array.isArray(res.buckets)) return;
      setFacets({
        buckets: res.buckets,
        sceneCounts: res.sceneCounts || {},
        tagCounts: res.tagCounts || {},
      });
      let cum = 0;
      const months = res.buckets.map((b) => {
        const start = cum;
        cum += (b.count || 0);
        const label = labelFromMonthKey(b.monthKey);
        const year = b.monthKey && b.monthKey !== 'unknown' ? String(b.monthKey).slice(0, 4) : '';
        return { monthKey: b.monthKey, count: b.count || 0, start, label, year };
      });
      setUploadTimeline({ months, total: cum });
    } catch (e) {
      // Non-fatal — the scrubber just falls back to loaded-items labels.
    }
  }, [api, sortMode, filters, selectedAlbum, kind]);

  // Load the Photos (uploads) grid. The PC/server-files tab was removed, so
  // there's no server-files fetch to branch on anymore. (Albums refresh is
  // handled directly in handleRefresh.)
  const loadData = useCallback(async (isRefresh = false) => {
    if (isPaginating) return; // Prevent overlapping calls
    setLoading(true);
    await fetchUploads(isRefresh);
    setLoading(false);
  }, [fetchUploads, isPaginating]);

  // Windowed soft reload for socket-driven refreshes (mediaVersion bumps on
  // media:added/removed/updated). loadData(true) TRUNCATES the loaded pages
  // back to page 0 (items = first LIMIT, offset reset) — right for a manual
  // pull-to-refresh, but a remote upload batch would collapse a deep-scrolled
  // grid once per event and yank the open viewer's pager out from under it.
  // This instead refetches the user's ENTIRE loaded window in one request:
  // scroll position, pagination depth, and viewer indices survive, while
  // additions, deletions, and in-place updates are all reflected. No loading
  // flag — no skeleton flash.
  const uploadCountRef = useRef(0);
  uploadCountRef.current = uploadItems.length;
  const softReloadGallery = useCallback(async () => {
    try {
      const win = Math.max(LIMIT, Math.ceil(uploadCountRef.current / LIMIT) * LIMIT);
      // Read the browse model via the ref (a debounced timer can fire this
      // with a stale closure right after a change) and drop the response if
      // ANY filter moved while the request was in flight — not just the sort
      // basis, which is all this used to check.
      const filtersAtRequest = filtersRef.current;
      const r = await api.get(buildGalleryUrl({ ...filtersAtRequest, q: '' }, {
        limit: win, offset: 0, album: selectedAlbum, kind,
      }));
      if (filtersRef.current !== filtersAtRequest) return;
      if (r?.success) {
        setGlobalUploadsTotal(r.pagination?.total || r.total || r.items?.length || 0);
        setUploadItems(r.items || []);
        setUploadOffset(win);
        setHasMoreUploads(r.pagination?.hasMore || false);
      }
    } catch (e) {
      // Best-effort — the next event or a manual refresh catches up.
    }
    // filters deliberately NOT a dep — read via filtersRef so a pending
    // debounce timer never runs a stale-filter closure.
  }, [api, selectedAlbum, kind]);

  // Initial load - Fetch EVERYTHING simultaneously to prepare the off-screen slider pages
  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchUploads(true),
      fetchAlbums(),
      fetchBuckets()
    ]).finally(() => setLoading(false));
    
    if (autoUpload) {
      const timer = setTimeout(() => { handleUpload(); }, 500);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoUpload]); // <-- STRIPPED DEPS TO PREVENT RESET LOOPS
  
  // Fetch global albums
  const fetchAlbums = useCallback(async () => {
    setIsAlbumsLoading(true);
    try {
      const res = await api.get('/media/albums');
      if (!res?.success) throw new Error(res?.error || 'Unable to load boards');
      const normalized = normalizeAlbumsPayload(res);
      setGlobalAlbums(normalized.names);
      setAlbumCovers(normalized.coversByName);
      setAlbumCounts(normalized.countsByName);
      setAlbumLatestDates(normalized.latestDatesByName);
      setHasLoadedAlbums(true);
      setAlbumsLoadError(null);
    } catch (e) {
      setAlbumsLoadError(e?.message || 'Unable to load boards');
    } finally {
      setIsAlbumsLoading(false);
    }
  }, [api]);

  // Re-fetch albums when the tab changes. Mount is skipped — the initial-load
  // Promise.all already fetches them once; this effect used to duplicate that
  // request at startup.
  const albumsTabEffectFirstRun = useRef(true);
  useEffect(() => {
    if (albumsTabEffectFirstRun.current) { albumsTabEffectFirstRun.current = false; return; }
    // Only when the Boards page is what you're actually looking at. Keying this
    // on activeTab meant every board OPEN refetched the albums (activeTab flips
    // to 'uploads') and every close refetched them again — two wasted requests
    // per visit. Closing the photos page still refetches, which is wanted: the
    // counts may have changed while you were in there.
    if (pagerTab !== 'albums' || photosOpen) return;
    fetchAlbums();
  }, [pagerTab, photosOpen, fetchAlbums]);

  // Handle pull-to-refresh — refresh albums on the Albums tab, otherwise the
  // Photos grid.
  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    const job = activeTab === 'albums' ? fetchAlbums() : loadData(true);
    Promise.resolve(job).then(() => setRefreshing(false));
  }, [activeTab, fetchAlbums, loadData]);

  const handleLoadMore = useCallback(() => {
    if (currentHasMore && !loading && !refreshing && !isPaginating && activeTab === 'uploads') {
      fetchUploads(false);
    }
  }, [currentHasMore, loading, refreshing, isPaginating, activeTab, fetchUploads]);

  // Live-refresh the grid when a media item lands in the vault (e.g. a
  // ghost-download finished, broadcast as media:added). A burst of media:added
  // (a playlist ingest) is DEBOUNCED into one reload; if we're not on the
  // uploads tab the reload is deferred until we return.
  // Narrow context: only bumps when the vault actually changes — the jobs
  // list (which churns per progress tick) no longer re-renders this screen.
  const { mediaVersion } = useMediaVersion();
  const mediaVersionFirst = useRef(true);
  const mediaRefreshTimer = useRef(null);
  const pendingMediaRefresh = useRef(false);
  useEffect(() => {
    if (mediaVersionFirst.current) { mediaVersionFirst.current = false; return; }
    if (activeTab !== 'uploads') { pendingMediaRefresh.current = true; return undefined; }
    if (mediaRefreshTimer.current) clearTimeout(mediaRefreshTimer.current);
    mediaRefreshTimer.current = setTimeout(() => { softReloadGallery(); }, 600);
    return () => { if (mediaRefreshTimer.current) clearTimeout(mediaRefreshTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaVersion]);
  useEffect(() => {
    if (activeTab === 'uploads' && pendingMediaRefresh.current) {
      pendingMediaRefresh.current = false;
      softReloadGallery();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Open full-screen viewer with animation and large file warning. `origin`
  // (optional) is the tap point in window coords ({x, y}) — the pop then
  // originates from the tapped cell instead of the screen centre.
  const openViewer = useCallback((item, origin) => {
    // Dev probe: the tap-to-open path is the most latency-visible in the app.
    gestureProbe.respond('grid:openPhoto');
    const executeOpen = () => {
      // Anchor the pop at the tap point (offset from screen centre). No origin
      // (e.g. programmatic open) ⇒ 0/0 ⇒ the old centre pop.
      originDX.setValue(origin ? origin.x - width / 2 : 0);
      originDY.setValue(origin ? origin.y - height / 2 : 0);
      // Index into the SAME array the pager walks (and the grid renders), so
      // the tapped photo is found and left/right swipe works across the whole
      // loaded set. Only fall back to the solo viewer if it's genuinely absent.
      // Read via ref (not the closed-over value) so this callback stays STABLE
      // as the list grows — otherwise its identity changed on every sparse page
      // land, which changed renderItem and re-rendered every visible grid cell
      // during scroll (the source of the laggy taps / select delay).
      const index = viewerSourceItemsRef.current.findIndex(i => i.id === item.id);
      setViewerSoloItem(index !== -1 ? null : item);
      scrollX.setValue(index !== -1 ? index * ITEM_WIDTH : 0);

      // Open at 1x, ALWAYS. zoomScale drives scrollEnabled on the pager, and it
      // has exactly one writer: a cell reporting its zoom, which is gated on
      // that cell being ACTIVE. A cell that goes inactive while still zoomed
      // therefore never reports the way back down - ZoomableView resets itself,
      // but the shell is never told - and the stale value leaves the pager with
      // scrollEnabled=false. That is "swiping is completely dead", surviving
      // until something else happens to zoom. Re-arming here costs nothing and
      // makes the freeze unreachable: a fresh viewer cannot inherit a zoom.
      zoomScaleRef.current = 1;
      setZoomScale(1);
      zoomChromeAnim.setValue(1);

      setSelectedMedia(item);
      // Reset and start animations
      scaleAnim.setValue(0.85);
      opacityAnim.setValue(0);
      
      Animated.parallel([
        Animated.timing(scaleAnim, {
          toValue: 1,
          duration: 200, // 🚀 Faster pop
          easing: Easing.bezier(0.05, 0.7, 0.1, 1), // 💎 Instant pop, smooth settle
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 120, // 🚀 Near-instant background blackout
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ]).start();
    };

    const LARGE_FILE_MB = 100; // 100MB threshold
    const sizeMB = item.size ? item.size / (1024 * 1024) : 0;

    if (sizeMB > LARGE_FILE_MB) {
      Alert.alert(
        'Large File Warning',
        `This file is ${sizeMB.toFixed(1)} MB. Loading it may take a moment or use significant memory. Proceed?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open', onPress: executeOpen }
        ]
      );
    } else {
      executeOpen();
    }
  }, [scaleAnim, opacityAnim, scrollX, originDX, originDY]);

  // Close full-screen viewer.
  // (A zoom-guard branch used to live here, but `zoomScale` was never written
  // after init — frozen at 1 — and the branch referenced a `scrollRef` that
  // only exists inside ImageViewer's scope: a latent ReferenceError shielded
  // only by the always-false condition. Removed; behavior is identical.)
  // Tear down viewer state + reset transient anims. Shared by the scale-pop
  // close and the pull-to-dismiss slide-out so both leave a clean slate.
  const resetViewerState = useCallback(() => {
    setSelectedMedia(null);
    setViewerSoloItem(null);
    setInfoVisible(true);
    infoOpacityAnim.setValue(1);
    dragY.setValue(0);
    dragX.setValue(0);
    scaleAnim.setValue(0.85);
    reportZoomScale(1); // fresh viewer session starts unzoomed (guards read this)
  }, [infoOpacityAnim, dragY, scaleAnim, reportZoomScale]);

  const closeViewer = useCallback(() => {
    gestureProbe.respond('viewer:close');
    Animated.parallel([
      Animated.timing(scaleAnim, {
        toValue: 0.85,
        duration: 150, // 🚀 Rapid exit
        easing: Easing.bezier(0.3, 0.0, 0.8, 0.15), // 💎 Accelerating exit curve
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: 100, // 🚀 Instant background reveal
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    ]).start(resetViewerState);
  }, [scaleAnim, opacityAnim, resetViewerState]);

  // Pull-to-dismiss commit. iOS Photos does NOT throw the photo off the bottom
  // of the screen — it flies it back into the grid thumbnail it came from,
  // shrinking and fading on the way. That is exactly what the origin-anchored
  // close already does: as scaleAnim retreats 1 → 0.85, originTranslate pulls
  // the photo toward the tapped cell. So the dismiss is: unwind the drag offset
  // and run that same retreat, from wherever the finger let go.
  const dismissByDrag = useCallback((velocityX = 0, velocityY = 0) => {
    Animated.parallel([
      Animated.spring(dragX, {
        toValue: 0, velocity: velocityX, useNativeDriver: true, tension: 90, friction: 14,
      }),
      Animated.spring(dragY, {
        toValue: 0, velocity: velocityY, useNativeDriver: true, tension: 90, friction: 14,
      }),
      Animated.timing(scaleAnim, {
        toValue: 0.85,
        duration: 200,
        easing: Easing.bezier(0.3, 0.0, 0.8, 0.15),
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: 180,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    ]).start(resetViewerState);
  }, [dragX, dragY, scaleAnim, opacityAnim, resetViewerState]);

  // Spring the photo home when a pull didn't go far enough to commit. Carries
  // the release velocity into the spring so a quick flick-and-hold settles the
  // way iOS does, instead of restarting from zero.
  const cancelDrag = useCallback((velocityX = 0, velocityY = 0) => {
    Animated.parallel([
      Animated.spring(dragX, {
        toValue: 0, velocity: velocityX, useNativeDriver: true, tension: 80, friction: 12,
      }),
      Animated.spring(dragY, {
        toValue: 0, velocity: velocityY, useNativeDriver: true, tension: 80, friction: 12,
      }),
    ]).start();
  }, [dragX, dragY]);

  // Toggle info visibility on tap - fade out smooth, fade in fast
  const toggleInfoVisibility = useCallback(() => {
    const newValue = !infoVisible;
    setInfoVisible(newValue);
    
    if (newValue) {
      // Fade in fast with bezier easing
      Animated.timing(infoOpacityAnim, {
        toValue: 1,
        duration: 200,
        easing: Easing.bezier(0.4, 0.0, 0.2, 1),
        useNativeDriver: true,
      }).start();
    } else {
      // Fade out smoothly
      Animated.timing(infoOpacityAnim, {
        toValue: 0,
        duration: 200,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start();
    }
  }, [infoVisible, infoOpacityAnim]);

  // Stable handle on the toggle for the viewer cells. `toggleInfoVisibility`
  // takes a new identity on every chrome flip; handing THAT to renderViewerItem
  // would re-render every mounted pager page each time the chrome is tapped.
  const toggleInfoRef = useRef(toggleInfoVisibility);
  toggleInfoRef.current = toggleInfoVisibility;

  // ── Pager-quiet guard for the chrome toggle ───────────────────────────────
  // A tap that arrives DURING pager motion is never a request to toggle the
  // chrome: it's a failed swipe, or a finger catching a moving page. Two ways
  // such a tap still reached the toggle:
  //   • a flick lifts before the scroll claims the touch, so the tap gesture
  //     legitimately succeeds at finger-up while the page is about to move;
  //   • catching a page mid-momentum reads as a clean tap to the recognizer.
  // Each one flipped the overlay, so a run of quick swipes strobed it on/off.
  // The gesture-side fix is maxDistance on the tap (ZoomableView); this is the
  // shell side: the scrollX listener below stamps a quiet window on EVERY
  // pager scroll frame, so taps are swallowed while the pager moves and for
  // PAGER_TAP_QUIET_MS after its last frame. Stamping per-frame (rather than
  // latching between begin/end events) means the guard can never stick shut —
  // it decays on its own even if a settle event is lost to an unmount.
  const pagerQuietUntilRef = useRef(0);
  const handleViewerSingleTap = useCallback(() => {
    if (pagerDragStore.get()) return;
    if (Date.now() < pagerQuietUntilRef.current) return;
    gestureProbe.respond('viewer:chromeToggle');
    toggleInfoRef.current?.();
  }, [pagerDragStore]);

  // Unified swipe responder. Three independent gestures handled here:
  //   • Vertical down on the photo → dismiss the viewer.
  //   • Vertical up on the photo  → open the metadata drawer.
  //   • Horizontal right from the LEFT EDGE → iPhone-style swipe-back
  //     to close the viewer. Matches the system gesture every other
  //     iOS app responds to when you swipe in from the bezel.
  //
  // The edge-back gesture is recognised separately from the vertical
  // gestures because:
  //   1. The touch must START within the first ~24px of the screen's
  //      left edge — anything further in is a normal in-canvas pan.
  //   2. The drag must be primarily rightward (dx > 8 and dominant
  //      over dy). This keeps a vertical-then-slightly-right wiggle
  //      from being misread as a back swipe.
  // When both conditions hit, we claim the gesture and commit on
  // release if the user has dragged far enough or fast enough.
  const EDGE_BACK_ZONE_PX = 24;
  const EDGE_BACK_COMMIT_DX = 80;
  const EDGE_BACK_COMMIT_VX = 0.5;
  const swipeResponder = useRef(
    PanResponder.create({
      // Dev probe arm-point. The viewer is a Modal — its own native root — so
      // the app-level touch sniff in App.js never sees these touches. Capture
      // phase + `return false`: observe, never claim.
      onStartShouldSetPanResponderCapture: () => {
        gestureProbe.touchStart('photo viewer');
        return false;
      },
      // Second half of the dev probe's arm-point, same capture-and-decline
      // contract: the probe times a swipe from the first MOVE, because a finger
      // resting on a photo before it travels is dwell, not lag. Capture phase so
      // it still sees moves after the pager's ScrollView has claimed the
      // responder — the bubble-phase handler below stops being consulted then.
      onMoveShouldSetPanResponderCapture: () => {
        gestureProbe.touchMove();
        return false;
      },
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        // Read through the refs: this responder is built once, so state read
        // here would be frozen at the first render's values.
        if (zoomScaleRef.current > 1.05) return false;

        // Edge-back: touch started near the left bezel + dominant
        // rightward motion. Take priority over the vertical gestures.
        const startX = evt.nativeEvent.pageX - gestureState.dx;
        if (
          startX < EDGE_BACK_ZONE_PX &&
          gestureState.dx > 8 &&
          Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.5
        ) {
          return true;
        }

        // Vertical drag for dismiss / drawer — but only when vertical is the
        // DOMINANT axis. The old factor (dy > dx * 0.5) claimed swipes whose
        // horizontal travel was twice the vertical, so a slightly diagonal
        // page-swipe got hijacked: the native pager scroll was cancelled
        // mid-flight (a visible jump under the finger) and the photo started
        // dragging toward dismiss instead of paging. iOS resolves this by
        // dominant axis; the 1.2 bias means a true diagonal stays with the
        // pager, which is the gesture people mean far more often.
        return Math.abs(gestureState.dy) > 10 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx) * 1.2;
      },
      onPanResponderMove: (evt, gestureState) => {
        if (isDrawerOpenRef.current) {
          // Drawer is up: a downward drag pulls it back toward closed.
          if (gestureState.dy > 0) drawerY.setValue((height * 0.45) + gestureState.dy);
          return;
        }
        // iOS Photos pull-to-dismiss: the open photo tracks the finger 1:1 in
        // BOTH axes (dragScale, dragBackdropOpacity and dragChromeOpacity all
        // react to dragY in the render; dragX is pure follow).
        if (gestureState.dy > 0) {
          dragY.setValue(gestureState.dy);
          dragX.setValue(gestureState.dx);
        }
      },
      onPanResponderRelease: (evt, gestureState) => {
        // Edge-back commit — checked FIRST so a fast left-edge swipe
        // closes the viewer cleanly even if the gesture wiggled
        // vertically partway through.
        const startX = evt.nativeEvent.pageX - gestureState.dx;
        if (
          startX < EDGE_BACK_ZONE_PX &&
          (gestureState.dx > EDGE_BACK_COMMIT_DX || gestureState.vx > EDGE_BACK_COMMIT_VX)
        ) {
          closeViewer();
          return;
        }

        if (isDrawerOpenRef.current) {
          if (gestureState.dy > 50 || gestureState.vy > 1) closeMetadataDrawer();
          else openMetadataDrawer();
          return;
        }

        // Commit the dismiss if pulled far enough OR flicked down fast (iOS
        // commits around 100px, or on a downward flick from much shorter);
        // a strong upward swipe opens the metadata drawer; anything short
        // springs the photo home carrying the release velocity.
        if (gestureState.dy > 100 || (gestureState.dy > 30 && gestureState.vy > 0.7)) {
          dismissByDrag(gestureState.vx, gestureState.vy);
        } else if (gestureState.dy < -50) {
          cancelDrag(gestureState.vx, gestureState.vy);
          openMetadataDrawer();
        } else {
          cancelDrag(gestureState.vx, gestureState.vy);
        }
      },
    })
  ).current;

  // Rename album (updates all photos with the old tag). The name comes from the
  // rename PAGE inside AlbumActionsSheet — this used to be an Alert.prompt,
  // which is iOS-only and looked nothing like the app.
  const commitAlbumRename = useCallback(async (oldName, newName) => {
    const trimmedName = (newName || '').trim();
    if (oldName === 'All' || oldName === 'Favourites') {
      Alert.alert('Cannot Rename', 'System albums cannot be renamed.');
      return;
    }
    if (!trimmedName || trimmedName === oldName) return;

    // Optimistic: the board carries its new name now, the write follows.
    setGlobalAlbums(prev => prev.map(a => a === oldName ? trimmedName : a));
    if (selectedAlbum === oldName) setSelectedAlbum(trimmedName);

    try {
      const res = await api.put('/media/album/rename', {
        oldTag: oldName,
        newTag: trimmedName
      });
      if (!res.success) throw new Error(res.error || 'rename failed');
      fetchAlbums();
      // The server carries any public link over to the new name — re-read so
      // the header's published cue follows it instead of going quiet.
      refreshLiveAlbums();
    } catch (error) {
      console.error('[MediaGallery] Failed to rename album:', error);
      // Roll the optimistic edit back — the tag is still the old one.
      setGlobalAlbums(prev => prev.map(a => a === trimmedName ? oldName : a));
      if (selectedAlbum === oldName) setSelectedAlbum(oldName);
      Alert.alert('Error', 'Failed to rename album');
    }
  }, [api, fetchAlbums, refreshLiveAlbums, selectedAlbum, setGlobalAlbums, setSelectedAlbum]);

  // Delete album (removes tag from all photos)
  const deleteAlbum = useCallback(async (albumName) => {
    if (albumName === 'All' || albumName === 'Favourites') {
      Alert.alert('Cannot Delete', 'System albums cannot be deleted.');
      return;
    }
    
    Alert.alert(
      'Delete Album',
      `Delete "${albumName}"?\n\nPhotos will remain in "All" but this album tag will be removed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive',
          onPress: async () => {
            try {
              const res = await api.delete(`/media/album/${encodeURIComponent(albumName)}`);
              if (res.success) {
                setGlobalAlbums(prev => prev.filter(a => a !== albumName));
                fetchAlbums();
                // Deleting the board revokes its public link server-side.
                refreshLiveAlbums();

                // The board we were inside just disappeared — close the pushed
                // photos page and fall back to the Boards list behind it.
                if (selectedAlbum === albumName) {
                  setSelectedAlbum('All');
                  setPhotosOpen(false);
                }
              }
            } catch (error) {
              console.error('[MediaGallery] Failed to delete album:', error);
              Alert.alert('Error', 'Failed to delete album');
            }
          }
        }
      ]
    );
  }, [api, fetchAlbums, refreshLiveAlbums, selectedAlbum, setGlobalAlbums, setSelectedAlbum]);

  // Board menu — the board header's "⋯" and a long-press on a board card both
  // land here. Opens the themed AlbumActionsSheet rather than an OS alert.
  const showAlbumOptions = useCallback((albumName) => {
    if (albumName === 'All' || albumName === 'Favourites') {
      Alert.alert(albumName, 'System albums cannot be modified.');
      return;
    }
    setAlbumMenuName(albumName);
  }, []);

  // Placeholder for expo-image-manipulator UI integration
  const openImageEditor = useCallback(() => {
    if (!selectedMedia || selectedMedia.type === 'video') return;
    Alert.alert(
      "Edit Image",
      "Image Editor coming soon! This will trigger the crop/rotate UI.",
      [{ text: "OK", style: "cancel" }]
    );
  }, [selectedMedia]);

  // Upload photos/videos - Unlocked Selection Limit
  const handleUpload = useCallback(async () => {
    try {
      // Request permissions
      const { status: pickerStatus } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (pickerStatus !== 'granted') {
        Alert.alert('Permission Required', 'Please allow access to photos and videos to upload.');
        return;
      }

      // Open image picker - unlocked limit for enterprise queue
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'], // Updated API - array of MediaType strings
        allowsMultipleSelection: true,
        selectionLimit: 0, // 0 = UNLIMITED SELECTION
        orderedSelection: true,
        quality: 0.8,
        // Hand over the ORIGINAL asset file instead of an iOS export. Without
        // this, PHPicker RE-ENCODES every selected video (HEVC→H.264) before
        // returning: a silent, minutes-long export with no progress that
        // failed/hung on anything longer than ~a minute — the "can't upload
        // videos over 1 minute" wall — plus bloated files and lost quality.
        // Passthrough returns instantly; the uploader then STREAMS the file
        // from disk as-is (no size limit). Android ignores this flag.
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode?.Current ?? 'current',
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      // Show pre-upload modal with album selection
      setPendingAssets(result.assets);
      // Preset the current album as a tag if inside a specific album
      setSelectedTags(selectedAlbum !== 'All' ? [selectedAlbum] : []);
      setUploadModalVisible(true);
    } catch (error) {
      console.error('[MediaGallery] Upload error:', error);
      Alert.alert('Error', 'Failed to open image picker.');
    }
  }, [selectedAlbum]);

  // === SMART SYNC FUNCTIONS ===
  const fetchLocalMedia = useCallback(async (loadMore = false) => {
    if (isLoadingLocal || (!localHasNextPage && loadMore)) return;
    
    try {
      setIsLoadingLocal(true);
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Needed', 'We need access to your camera roll to sync photos.');
        return;
      }

      const options = {
        first: 90,
        sortBy: [[MediaLibrary.SortBy.creationTime, false]],
        mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
      };
      if (loadMore && localEndCursor) options.after = localEndCursor;

      const result = await MediaLibrary.getAssetsAsync(options);
      
      setLocalAssets(prev => loadMore ? [...prev, ...result.assets] : result.assets);
      setLocalHasNextPage(result.hasNextPage);
      setLocalEndCursor(result.endCursor);
    } catch (error) {
      console.error('Failed to load local media:', error);
    } finally {
      setIsLoadingLocal(false);
    }
  }, [localEndCursor, localHasNextPage, isLoadingLocal]);

  const openLocalSyncGallery = useCallback(() => {
    setLocalPickerVisible(true);
    if (localAssets.length === 0) fetchLocalMedia();
  }, [localAssets.length, fetchLocalMedia]);

  const toggleLocalAssetSelection = useCallback((assetId) => {
    setSelectedLocalAssets(prev => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  }, []);

  // Stable renderItem for the local-sync grid — pairs with extraData +
  // LocalAssetCell's React.memo so a tap re-renders only the toggled cell.
  const renderLocalAsset = useCallback(({ item }) => (
    <LocalAssetCell
      item={item}
      isSelected={selectedLocalAssets.has(item.id)}
      onToggle={toggleLocalAssetSelection}
      styles={styles}
      themeColors={theme.colors}
    />
  ), [selectedLocalAssets, toggleLocalAssetSelection, styles, theme.colors]);

  const handleSelectAllLocal = useCallback(() => {
    if (selectedLocalAssets.size === localAssets.length) {
      setSelectedLocalAssets(new Set()); 
    } else {
      setSelectedLocalAssets(new Set(localAssets.map(a => a.id))); 
    }
  }, [localAssets, selectedLocalAssets.size]);

  // Maps MediaLibrary format to match ImagePicker format so executeUpload doesn't break
  const queueSelectedForUpload = useCallback(() => {
    const assetsToUpload = localAssets
      .filter(a => selectedLocalAssets.has(a.id))
      .map(a => ({
        ...a,
        assetId: a.id,
        uri: a.uri,
        fileName: a.filename,
        type: a.mediaType === 'photo' ? 'image' : 'video'
      }));
      
    setPendingAssets(assetsToUpload);
    setLocalPickerVisible(false);
    setSelectedLocalAssets(new Set());
    // Preset the current album as a tag if inside a specific album
    setSelectedTags(selectedAlbum !== 'All' ? [selectedAlbum] : []);
    setUploadModalVisible(true); 
  }, [localAssets, selectedLocalAssets, selectedAlbum]);

  // Execute upload after modal confirmation: hand the confirmed batch to the
  // app-level queue and get out of the way. The modal closes INSTANTLY; from
  // here the global pill carries the live percentage anywhere in the app, the
  // queue checkpoints itself after every item (an interrupted batch resumes on
  // the next launch), duplicates are fingerprint-checked and skipped before
  // any bytes move, and the finish stats + delete-originals offer (uploaded +
  // duplicates) surface in the pill.
  const executeUpload = useCallback(() => {
    if (pendingAssets.length === 0) return;

    const tags = selectedTags.length > 0 ? selectedTags : ['Phone Uploads'];
    const started = vaultActions.enqueue({
      assets: pendingAssets.map((asset) => ({
        assetId: asset.assetId || null,
        uri: asset.uri || null,
        fileName: asset.fileName || (asset.uri ? String(asset.uri).split('/').pop() : null),
        mimeType: asset.mimeType || null,
        type: asset.mediaType === 'video' || asset.type === 'video' ? 'video' : 'image',
        duration: asset.duration || null,
        width: asset.width || null,
        height: asset.height || null,
      })),
      tags,
    });
    if (!started) {
      Alert.alert('Upload in progress', 'Another vault upload is still running — let it finish (or dismiss it from the pill) first.');
      return;
    }

    // Make this batch's tags available INSTANTLY everywhere globalAlbums is
    // read (the upload-modal quick-select + the tag autocomplete) without a
    // reload — the same optimistic merge commitTags does for edits. A tag
    // whose uploads all failed is harmless: it just filters to nothing and
    // clears on the next load.
    if (selectedTags.length > 0) {
      setGlobalAlbums(prev => Array.from(new Set([...prev, ...selectedTags])).sort());
    }

    setPendingAssets([]);
    setUploadModalVisible(false);
  }, [pendingAssets, selectedTags, vaultActions, setUploadModalVisible, setGlobalAlbums]);

  // Delete photo/video (only for uploads)
  const handleDelete = useCallback((id) => {
    if (activeTab !== 'uploads') return;
    
    Alert.alert(
      'Delete Media',
      'Are you sure you want to delete this item?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            // Optimistic: remove from the grid instantly, persist in the
            // background, and re-insert at its original spot if the delete fails.
            const prevList = uploadItemsForDragRef.current || [];
            const removedIdx = prevList.findIndex(it => it && it.id === id);
            const removed = removedIdx >= 0 ? prevList[removedIdx] : null;
            setUploadItems(prev => prev.filter(item => item.id !== id));
            api.delete(`/media/${id}`).catch((error) => {
              console.error('[MediaGallery] Delete error:', error);
              if (removed) {
                setUploadItems(prev => {
                  if (prev.some(it => it && it.id === id)) return prev; // already back
                  const next = prev.slice();
                  next.splice(Math.min(Math.max(removedIdx, 0), next.length), 0, removed);
                  return next;
                });
              }
              Alert.alert('Error', 'Failed to delete media — it has been restored.');
            });
          },
        },
      ]
    );
  }, [api, activeTab]);

  // Commit ONE photo's tags OPTIMISTICALLY: update local state instantly,
  // persist to the server in the BACKGROUND, and roll back only if the write
  // fails. The UI must NEVER block on the round-trip — this is the app-wide
  // pattern for every mutation (see the optimistic-by-default principle).
  const commitTags = useCallback((mediaId, finalTags) => {
    if (!mediaId) return;
    const tags = Array.from(new Set(finalTags));
    const newTagsString = JSON.stringify(tags);
    // Snapshot prior tags so a failed write can be rolled back.
    // Resolve against the full displayed set (loaded prefix + sparse
    // virtual-library pages), not just the prefix, so tagging a photo opened
    // from deep in the timeline snapshots the right rollback baseline instead
    // of treating it as untagged.
    const prevItem = (uploadItemsForDragRef.current || []).find(it => it && it.id === mediaId);
    const prevTagsString = prevItem ? (prevItem.tags || '[]') : '[]';

    // 1. Instant local update — viewer item, grid item, and the album list.
    setSelectedMedia(prev => (prev && prev.id === mediaId ? { ...prev, tags: newTagsString } : prev));
    setUploadItems(prevList => {
      // Viewing a single album and the photo no longer carries it → drop it.
      if (selectedAlbum !== 'All' && !tags.includes(selectedAlbum)) {
        return prevList.filter(item => item.id !== mediaId);
      }
      return prevList.map(item => item.id === mediaId ? { ...item, tags: newTagsString } : item);
    });
    setGlobalAlbums(prev => Array.from(new Set([...prev, ...tags])).sort());

    // 2. Persist in the background; revert the tags string on failure.
    api.put(`/media/${mediaId}/tags`, { tags })
      .then(res => { if (!res || !res.success) throw new Error(res?.error || 'rejected'); })
      .catch(err => {
        console.error('[MediaGallery] Tag save failed, reverting:', err?.message);
        setSelectedMedia(prev => (prev && prev.id === mediaId ? { ...prev, tags: prevTagsString } : prev));
        setUploadItems(prevList => prevList.map(item => item.id === mediaId ? { ...item, tags: prevTagsString } : item));
        Alert.alert('Tags not saved', 'That change could not be saved and was reverted.');
      });
  }, [api, selectedAlbum, uploadItems, setSelectedMedia, setUploadItems, setGlobalAlbums]);

  // Optimistic UI Toggle for Quick Favourites
  const toggleFavourite = useCallback(async () => {
    gestureProbe.respond('viewer:favourite');
    if (!selectedMedia) return;
    
    try {
      const currentTags = JSON.parse(selectedMedia.tags || '[]');
      const isFav = currentTags.includes('Favourites');
      
      // Toggle logic
      const newTags = isFav 
        ? currentTags.filter(t => t !== 'Favourites') 
        : [...currentTags, 'Favourites'];
        
      const newTagsString = JSON.stringify(newTags);

      // 1. Optimistically update the UI instantly
      setSelectedMedia(prev => ({ ...prev, tags: newTagsString }));
      
      const updateItemInList = (prevList) => 
        prevList.map(item => item.id === selectedMedia.id ? { ...item, tags: newTagsString } : item);
      
      setUploadItems(updateItemInList);

      // 2. Add 'Favourites' to global dropdown immediately if it's the first time
      if (!isFav) {
        setGlobalAlbums(prev => Array.from(new Set([...prev, 'Favourites'])).sort());
      }

      // 3. Send payload to server in the background (handler only reads `tags`)
      await api.put(`/media/${selectedMedia.id}/tags`, { tags: newTags });

      // 4. NO full-library refetch — the optimistic updates above already
      // mirror the server state, and the old `fetchUploads(true)` here reset
      // the loaded prefix to page 0 on EVERY heart-tap (collapsing scroll
      // position and re-downloading data). The one case that needs more is
      // un-favoriting while looking at the Favourites album: the item should
      // leave the grid — handled surgically.
      if (selectedAlbum === 'Favourites' && isFav) {
        setUploadItems(prev => prev.filter(item => item.id !== selectedMedia.id));
      }

    } catch(e) {
      console.error('[MediaGallery] Favourites toggle failed:', e);
    }
  }, [selectedMedia, api, selectedAlbum]);

  // Helper to construct a full MEDIA url. Built off the media origin (HTTP/2 when
  // the device can reach + trust :3443, probed in ServerContext; else the plain
  // http origin), so the grid's many small thumbnail GETs can multiplex over one
  // HTTP/2 stream when available. Falls back to getBaseUrl if an older provider
  // doesn't expose getMediaBaseUrl yet.
  const getFullUrl = useCallback((path) => {
    const base = (getMediaBaseUrl ? getMediaBaseUrl() : getBaseUrl());
    const baseUrl = base.replace(/\/api$/, '');
    return `${baseUrl}${path}`;
  }, [getMediaBaseUrl, getBaseUrl]);

  // Warm expo-image's cache for the loaded pages immediately around the
  // viewport (±1 page ≈ the current screen + its neighbours). Called as pages
  // land and on every rAF-throttled scroll frame; the per-page `prefetched`
  // set makes repeat calls O(1) no-ops, so it's safe to fire often. Only pages
  // that already have metadata are warmed — during a fast fling the pages
  // ahead aren't loaded yet, so nothing is wasted until the fling decelerates
  // onto a loaded region (exactly the "load when it slows down" behaviour).
  // Matches GridItem's smUrl (getFullUrl(thumbnailUrl || url)) so the warmed
  // bytes are the exact ones each cell will request → instant paint.
  const prefetchNearbyThumbs = useCallback(() => {
    if (!virtualEnabledRef.current) return;
    const center = sparseCenterRef.current;
    const urls = [];
    for (let p = center - 1; p <= center + 1; p++) {
      if (p < 0 || sparseThumbsPrefetchedRef.current.has(p)) continue;
      const page = sparsePagesRef.current.get(p);
      if (!page) continue; // not loaded yet — warmed later, on its land
      sparseThumbsPrefetchedRef.current.add(p);
      for (const it of page) {
        const u = it && getFullUrl(it.thumbnailUrl || it.url);
        if (u) urls.push(u);
      }
    }
    if (urls.length) Image.prefetch(urls, { cachePolicy: 'memory-disk' }).catch(() => {});
  }, [getFullUrl]);
  // Late-bind so the sparse loader / scroll handler (defined above getFullUrl)
  // can call the latest implementation without a declaration-order cycle.
  prefetchThumbsRef.current = prefetchNearbyThumbs;

  // Share quality chooser. `shareChooser` holds the media snapshot whose
  // share sheet we're about to offer (null = closed). `sharePreparing` shows
  // the "gathering full-resolution data" overlay while the original downloads.
  const [shareChooser, setShareChooser] = useState(null);
  const [sharePreparing, setSharePreparing] = useState(false);
  // Label for the gather overlay — the single full-res share and the bulk share
  // want different copy ("full-resolution image" vs "8 photos"). null = default.
  const [sharePrepLabel, setSharePrepLabel] = useState(null);
  // 0..1 while a share download reports progress (videos are big enough that a
  // bare spinner reads as "hung"); null = indeterminate.
  const [shareProgress, setShareProgress] = useState(null);
  // Cancel handle for the in-flight share download, so the overlay's Cancel
  // button can abort a multi-hundred-MB video pull instead of stranding the user.
  const shareCancelRef = useRef(null);

  // Full-resolution PREFETCH for sharing. The OS share sheet can only be handed
  // a file that ALREADY EXISTS on disk — there's no way to present the sheet
  // first and fill the attachment in afterwards (that needs a native
  // UIActivityItemProvider). So "instant sheet" is bought by starting the
  // download EARLIER: tapping share on a photo is the intent signal, so the
  // original starts pulling the moment the quality chooser opens, in the
  // background, while the user is still reading the two options. By the time
  // "Full resolution" is tapped the bytes are usually already down and the
  // sheet opens with no gather overlay at all.
  //
  // Map: media id → { promise, uri, failed }. The entry survives the share so a
  // second share of the same photo is instant; the file itself is swept by
  // sweepTransientCaches (the `full_` prefix) on unmount/background.
  const fullShareCacheRef = useRef(new Map());
  const prefetchFullForShare = useCallback((media) => {
    if (!media) return null;
    const key = media.id ?? media.rawUrl ?? media.url;
    if (!key) return null;
    const cache = fullShareCacheRef.current;
    const hit = cache.get(key);
    if (hit && !hit.failed) return hit;
    // Extension by media TYPE when the row has no filename: a video saved as
    // ".jpg" makes iOS infer an image UTI and silently drop it from the sheet.
    const fallbackName = `shared_media_${media.id || 'item'}${media.type === 'video' ? '.mp4' : '.jpg'}`;
    const safeName = (media.filename || fallbackName).replace(/[^\w.\-]/g, '_');
    const localUri = `${FileSystem.cacheDirectory}full_${safeName}`;
    const entry = { uri: null, failed: false, promise: null, localUri, cancelled: false };
    // Resumable (not downloadAsync) purely for the progress callback — a video
    // original is tens/hundreds of MB, and a spinner with no percentage is
    // indistinguishable from a hang. The overlay's Cancel calls entry.cancel().
    const task = FileSystem.createDownloadResumable(
      getFullUrl(media.rawUrl || media.url),
      localUri,
      {},
      ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
        // ONLY while this exact download is the one the overlay is waiting on.
        // A background warm-up must not re-render this 6000-line component on
        // every progress tick. Whole percent steps only, same reason.
        if (shareCancelRef.current !== entry.cancel || totalBytesExpectedToWrite <= 0) return;
        const pct = Math.min(1, totalBytesWritten / totalBytesExpectedToWrite);
        setShareProgress((prev) => (prev != null && Math.abs(pct - prev) < 0.01 && pct < 1 ? prev : pct));
      },
    );
    entry.cancel = async () => {
      entry.cancelled = true;
      entry.failed = true;
      try { await task.cancelAsync(); } catch (e) { /* already finished */ }
      cache.delete(key); // a cancelled entry must not be reused as a "hit"
      try { await FileSystem.deleteAsync(localUri, { idempotent: true }); } catch (e) { /* ignore */ }
    };
    // Resolves to null instead of rejecting: nothing awaits this when the user
    // backs out of the chooser, and an unawaited rejection is a redbox.
    entry.promise = task.downloadAsync()
      .then((res) => {
        // downloadAsync does NOT throw on 4xx/5xx — it writes the error body to
        // disk. Sharing that hands the OS a few bytes of JSON named ".mp4".
        if (!res || (res.status && res.status >= 400)) {
          throw new Error(`HTTP ${res?.status} for ${media.rawUrl || media.url}`);
        }
        entry.uri = res.uri;
        return res.uri;
      })
      .catch((e) => {
        if (!entry.cancelled) console.warn('[MediaGallery] Full-res share prefetch failed:', e?.message || e);
        entry.failed = true;
        return null;
      });
    cache.set(key, entry);
    return entry;
  }, [getFullUrl]);

  // Download a media item at the chosen quality and hand it to the OS share
  // sheet. 'regular' uses the compressed tier the viewer already shows (small,
  // usually already cached → instant); 'full' reuses the chooser's background
  // prefetch — already finished means the sheet opens with NO overlay, still
  // in flight means we await that same download (never a second one) behind the
  // gather overlay, which is dismissed BEFORE the native sheet appears.
  const doShare = useCallback(async (media, quality) => {
    if (!media) return;
    const isFull = quality === 'full';
    let localUri = null; // tracked so we can delete the cached copy afterward
    let uri = null;
    try {
      if (isFull) {
        // Joins the in-flight prefetch, or starts one now (videos, which skip
        // the chooser, land here).
        const entry = prefetchFullForShare(media);
        if (entry?.uri) {
          uri = entry.uri;
        } else if (entry) {
          setSharePrepLabel(media.type === 'video' ? 'Preparing video…' : null);
          setShareProgress(0);
          shareCancelRef.current = entry.cancel || null;
          setSharePreparing(true);
          uri = await entry.promise;
          shareCancelRef.current = null;
          setSharePreparing(false);
          setShareProgress(null);
          setSharePrepLabel(null);
          if (entry.cancelled) return;      // user aborted — no sheet, no alert
          if (!uri) {                        // download genuinely failed
            Alert.alert('Error', 'Could not download this item to share.');
            return;
          }
        }
        localUri = uri;
      }

      if (!uri) {
        // 'regular', or the prefetch failed — download the chosen tier now.
        const srcPath = isFull
          ? (media.rawUrl || media.url)
          : (media.compressedUrl || media.thumbnailLgUrl || media.rawUrl || media.url);
        const url = getFullUrl(srcPath);
        const safeName = (media.filename || `shared_media_${media.id || 'item'}.jpg`)
          .replace(/[^\w.\-]/g, '_');
        localUri = `${FileSystem.cacheDirectory}${isFull ? 'full_' : 'reg_'}${safeName}`;
        if (isFull) setSharePreparing(true);
        ({ uri } = await FileSystem.downloadAsync(url, localUri));
        // Hide the gather overlay before presenting the OS sheet so the spinner
        // doesn't sit underneath it for the whole share interaction.
        if (isFull) setSharePreparing(false);
      }

      if (await Sharing.isAvailableAsync()) {
        // Let the gather overlay actually leave the screen first. It's an
        // in-tree View (not a Modal — see below), so one committed frame is
        // enough; presenting in the same tick as a teardown is how the sheet
        // used to silently never appear.
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        await Sharing.shareAsync(uri, {
          UTI: media.type === 'video' ? 'public.movie' : 'public.image',
          mimeType: media.type === 'video' ? 'video/mp4' : 'image/jpeg',
        });
      } else {
        Alert.alert('Error', 'Sharing is not available on this device');
      }
    } catch (error) {
      console.error('[MediaGallery] Share error:', error);
      Alert.alert('Error', 'Could not share this item.');
    } finally {
      if (isFull) {
        setSharePreparing(false);
        setShareProgress(null);
        setSharePrepLabel(null);
        shareCancelRef.current = null;
      }
      // The cached copy existed only to feed the share sheet — drop it now so
      // shares don't pile up GBs of duplicates in the cache directory. The
      // prefetch entry goes with it: keeping a uri that points at a deleted
      // file would make the NEXT share of this photo hand the sheet nothing.
      if (localUri) {
        const key = media.id ?? media.rawUrl ?? media.url;
        if (key) fullShareCacheRef.current.delete(key);
        try { await FileSystem.deleteAsync(localUri, { idempotent: true }); } catch (e) { /* ignore */ }
      }
    }
  }, [getFullUrl, prefetchFullForShare]);

  // ── Sharing a LINK instead of the bytes ───────────────────────────────────
  // The counterpart to doShare. Nothing leaves the phone: the server mints a
  // capability URL, and the recipient's chat app unfurls it into a preview —
  // a playing video, for a video. What this has to get right is the WAITING:
  // an unfurler caches whatever it finds on first sight, so the URL must not
  // reach the share sheet until the server's MP4 exists. See
  // services/mediaShareLinks.js.
  //
  // Warned once per session, not per share: a tailnet-only link is invisible
  // to everyone outside the tailnet, and there is no way to discover that from
  // the link itself — but someone deliberately sending to a family device
  // shouldn't have to dismiss the same alert every time.
  const tailnetWarnedRef = useRef(false);
  const doShareLink = useCallback(async (media) => {
    if (!media) return;
    const isVideo = media.type === 'video';
    let cancelled = false;
    try {
      setSharePrepLabel(isVideo ? 'Making it play in chat…' : 'Making a link…');
      setShareProgress(null);
      shareCancelRef.current = () => { cancelled = true; };
      setSharePreparing(true);

      const share = await prepareShareLink(api, media.id, {
        onProgress: (p) => setShareProgress(p),
        isCancelled: () => cancelled,
      });

      setSharePreparing(false);
      setShareProgress(null);
      setSharePrepLabel(null);
      shareCancelRef.current = null;
      if (cancelled || share.cancelled) return;

      // Both of these are "the link works, but not the way you'd assume".
      // Neither is a failure worth throwing away the work over, so each asks
      // rather than deciding.
      if (share.prepareFailed) {
        const send = await confirmAsync(
          'It won’t play inline',
          isVideo
            ? 'This video couldn’t be converted, so chat apps will show a link instead of a player. It still opens fine in a browser.'
            : 'This link still works, but it may show without a preview.',
          'Send anyway',
        );
        if (!send) return;
      }
      if (share.reach === 'tailnet' && !tailnetWarnedRef.current) {
        tailnetWarnedRef.current = true;
        const send = await confirmAsync(
          'Only works on your Tailscale network',
          'Turtle can’t see a public address right now, so anyone outside your tailnet will get a dead link. Turn on Tailscale Funnel to send this to the world.',
          'Send anyway',
        );
        if (!send) return;
      }

      // Same iOS trap the file path documents below: dismissing an overlay and
      // presenting the share sheet in one tick means the sheet never appears.
      // Let the overlay's removal commit first.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      // iOS treats `url` as a first-class URL item, which is what makes
      // Messages insert it as a rich link. Android's sheet only reads
      // `message`, so the URL goes there instead — sending both on iOS
      // duplicates it in the bubble.
      await RNShareSheet.share(
        Platform.OS === 'ios'
          ? { url: share.url }
          : { message: share.url },
      );
    } catch (error) {
      console.error('[MediaGallery] Share-link error:', error);
      Alert.alert('Error', 'Could not create a link for this item.');
    } finally {
      setSharePreparing(false);
      setShareProgress(null);
      setSharePrepLabel(null);
      shareCancelRef.current = null;
    }
  }, [api]);

  // Tapping share opens the chooser — for videos too, now. They used to skip
  // straight to downloading the original, which is why the only thing a video
  // share could ever be was a multi-hundred-megabyte upload from the phone.
  // The chooser also doubles as the intent signal that starts pulling a
  // photo's original in the background while the options are being read.
  const handleShare = useCallback(() => {
    if (!selectedMedia) return;
    setShareChooser(selectedMedia);
    // Videos have no compressed tier to choose between, and their warm-up is
    // already handled by the dwell effect below — no point starting a second.
    if (selectedMedia.type !== 'video') prefetchFullForShare(selectedMedia);
  }, [selectedMedia, prefetchFullForShare]);

  // INSTANT-SHEET WARM-UP FOR VIDEOS.
  // The OS sheet can only be handed a file that already exists on disk, so
  // "instant" is always bought by starting the download earlier. Photos buy it
  // with the quality chooser (the original pulls while the user reads the two
  // options). A video has no compressed tier and no chooser, so the only
  // earlier signal is "the user is sitting on this video" — after a 1.2s dwell
  // we HEAD the original and, if it's a normal clip (<= 60MB), pull it in the
  // background. Tapping Share then finds the bytes already down and the sheet
  // opens with no overlay at all. Bigger files are left alone (a 500MB
  // speculative download on cellular is worse than a progress bar) — those
  // still download on demand behind the overlay, with a Cancel.
  // Swiping away cancels a warm-up the user never asked for.
  //
  // Keyed on a FIELD SNAPSHOT, not on selectedMedia itself: tagging or
  // favouriting the open video replaces that object, and re-running the effect
  // on it would cancel and re-issue the very download we're warming.
  const warmVideoTarget = useMemo(() => (
    selectedMedia?.type === 'video'
      ? {
          id: selectedMedia.id,
          type: 'video',
          rawUrl: selectedMedia.rawUrl,
          url: selectedMedia.url,
          filename: selectedMedia.filename,
        }
      : null
  ), [selectedMedia?.id, selectedMedia?.type, selectedMedia?.rawUrl, selectedMedia?.url, selectedMedia?.filename]);
  useEffect(() => {
    const media = warmVideoTarget;
    if (!media) return undefined;
    const key = media.id ?? media.rawUrl ?? media.url;
    if (!key || fullShareCacheRef.current.has(key)) return undefined;
    let cancelled = false;
    let started = null;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(getFullUrl(media.rawUrl || media.url), { method: 'HEAD' });
        const len = Number(res.headers.get('content-length') || 0);
        if (cancelled || !res.ok || !len || len > VIDEO_SHARE_WARM_MAX_BYTES) return;
        started = prefetchFullForShare(media);
        if (cancelled) started?.cancel?.();
      } catch (e) {
        // Offline, or HEAD not answered — the on-demand path still works.
      }
    }, 1200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      // Leave it alone if a share is actively awaiting this very download.
      if (started && !started.uri && shareCancelRef.current !== started.cancel) started.cancel?.();
    };
  }, [warmVideoTarget, getFullUrl, prefetchFullForShare]);


  // === GARBAGE COLLECTION ===
  // Leaving the gallery sweeps the throwaway temp dirs, leaked share files and
  // the RAM cache (the persistent disk cache is governed separately, on app
  // background — see utils/cacheManager). Centralized so there's one source of
  // truth for what's safe to delete.
  useEffect(() => {
    return () => { sweepTransientCaches(); };
  }, []);

  // Preload images for smoother scrolling
  const preloadThumbnails = useCallback((items) => {
    items.forEach(item => {
      if (item.thumbnailUrl) {
        const url = getFullUrl(item.thumbnailUrl);
        Image.prefetch(url).catch(() => {
          // Silently fail prefetch errors
        });
      }
    });
  }, [getFullUrl]);

  // Preload the first screenfuls ONCE per session. This used to re-run on
  // every currentItems change — every pagination append re-queued 150 native
  // prefetch calls for thumbnails the grid had long since cached, contending
  // bandwidth with the cells actually on screen.
  const prefetchedOnceRef = useRef(false);
  useEffect(() => {
    if (prefetchedOnceRef.current || currentItems.length === 0) return;
    prefetchedOnceRef.current = true;
    preloadThumbnails(currentItems.slice(0, 30));
  }, [currentItems, preloadThumbnails]);

  // Render grid item using memoized component
  // === RENDERERS ===
  // PERFORMANCE CONTRACT with the FlashLists below:
  //   • This callback must stay referentially STABLE through selection
  //     changes — it reads the selection via selectedGridItemsRef (synced
  //     every render) instead of depending on the Set. A new renderItem
  //     identity makes FlashList re-render EVERY visible cell; combined with
  //     the old per-cell `() => toggleGridSelection(id)` closures (which
  //     defeated GridItem's React.memo), that was the multi-select lag.
  //   • The lists pass `extraData={gridSelectionExtra}` so visible cells
  //     re-run when selection state changes; GridItem's memo then limits the
  //     actual re-renders to cells whose `isSelected` flipped.
  const renderItem = useCallback(({ item, index }) => {
    // One path for slots AND loaded items — GridItem renders both shapes
    // (see its UNIFIED CELL note), so a resolving slot is a re-render of the
    // same mounted cell, never a component swap.
    // The per-cell counter-flip MUST live on this wrapper View (not on GridItem's
    // root) — FlashList v2 renders the cell such that moving the flip onto the
    // TouchableOpacity inverts the grid (newest ended up at the top). Keep the
    // wrapper; styles.cellFlip is a hoisted constant so there's still no per-cell
    // {transform:[...]} allocation.
    return (
      <View style={styles.cellFlip}>
        <GridItem
          item={item}
          activeTab={activeTab}
          openViewer={openViewer}
          handleDelete={handleDelete}
          getFullUrl={getFullUrl}
          getBaseUrl={getBaseUrl}
          styles={styles}
          theme={theme}
          isSelectMode={isSelectMode}
          isSelected={selectedGridItemsRef.current.has(item.id)}
          onToggleSelect={handleSelectPress}
          gridIndex={index}
          onTouchDown={onCellTouchDown}
          isActiveVideo={GRID_VIDEO_PREVIEW && activeVideoIdRef.current === item.id}
          // Pinch-to-zoom columns: cell edge tracks the live column count.
          cellSize={width / gridCols - 0.5}
        />
      </View>
    );
  }, [activeTab, openViewer, handleDelete, getFullUrl, getBaseUrl, styles, theme, isSelectMode, handleSelectPress, onCellTouchDown, gridCols]);

  // Identity changes exactly when selection state does — drives the lists'
  // extraData (see the contract on renderItem above). gridCols rides along so a
  // pinch column change re-renders every visible cell at its new size.
  const gridSelectionExtra = useMemo(
    () => ({ isSelectMode, selectedGridItems, activeVideoId, gridCols }),
    [isSelectMode, selectedGridItems, activeVideoId, gridCols],
  );

  // Render empty state
  // Render empty state (Inverted grids need scaleY: -1 to render right-side up)
  const renderEmpty = () => (
    <View style={[styles.emptyContainer, styles.cellFlip]}>
      <Icon name={uploadsSearchQuery.trim() ? 'magnify-close' : 'image-off'} size={64} color={theme.colors.textMuted} />
      <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
        {uploadsSearchQuery.trim() ? `No matches for “${uploadsSearchQuery.trim()}”` : 'No uploads yet'}
      </Text>
      {activeTab === 'uploads' && !uploadsSearchQuery.trim() && (
        <Text style={[styles.emptySubtext, { color: theme.colors.textMuted }]}>
          Tap "Upload Photos" to add photos and videos
        </Text>
      )}
    </View>
  );

  // Live mirror of selectedMedia (+ the active-id store). The mirror exists so
  // the pager sync below can hand the freshest item to actions IMMEDIATELY
  // while the expensive state adoption is deferred; the effect keeps it (and
  // the store) truthful for every other way selectedMedia changes — open,
  // close, tag/favourite spreads.
  const selectedMediaRef = useRef(null);
  useEffect(() => {
    selectedMediaRef.current = selectedMedia;
    viewerActiveStore.set(selectedMedia?.id ?? null);
  }, [selectedMedia, viewerActiveStore]);

  // Adopt whatever the pager last settled on into gallery state. Idempotent —
  // multiple schedules may fire, latest item wins.
  //
  // THE COMMIT ONLY LANDS AT REST. setSelectedMedia re-renders the whole
  // 6,000-line gallery, and no deferral constant can dodge a human: the old
  // 400ms belt landed the commit exactly when a natural browsing rhythm
  // starts the NEXT swipe, which is why swiping still hitched "at times" —
  // it was timing-dependent, colliding once per settle. So instead of firing
  // after a fixed delay, adoption checks whether the user is (or moments ago
  // was) driving the pager — finger down (pagerDragStore, set at raw
  // touch-start) or inside the per-frame quiet horizon the scroll listener
  // stamps — and RESCHEDULES itself until both are clear. The pager itself
  // never waits on this: cells key off the active-id store, which flipped at
  // settle; only the chrome (filename, meta, sheets) rides behind, and chrome
  // catching up when the finger rests IS the async-lazy contract. During an
  // unbroken swipe-run it simply keeps deferring — the run ends, one commit
  // lands.
  const adoptRetryRef = useRef(null);
  const adoptPendingSelected = useCallback(() => {
    const latest = selectedMediaRef.current;
    if (!latest) return;
    if (pagerDragStore.get() || Date.now() < pagerQuietUntilRef.current) {
      if (adoptRetryRef.current) clearTimeout(adoptRetryRef.current);
      adoptRetryRef.current = setTimeout(adoptPendingSelected, PAGER_TAP_QUIET_MS);
      return;
    }
    // Dev trail marker. This call only SCHEDULES the whole-gallery re-render —
    // the cost lands in the commit that follows, which the Profiler above
    // measures. Logging the schedule is what lets the two be lined up: an
    // "adopt scheduled" immediately followed by a long `render:gallery update`
    // is the deferred adoption landing mid-swipe.
    if (__DEV__) console.log('[probe] adopt scheduled');
    setSelectedMedia((prev) => (prev?.id === latest.id ? prev : latest));
  }, [pagerDragStore]);
  useEffect(() => () => { if (adoptRetryRef.current) clearTimeout(adoptRetryRef.current); }, []);

  // Resolve which photo is centred from a (left-aligned, ITEM_WIDTH-strided)
  // scroll offset. SINGLE source of truth for "which photo is on screen".
  //
  // Split into a CHEAP now and an EXPENSIVE later:
  //   now   — the active-id store flips (re-renders exactly the two affected
  //           cells: HD dwell re-arms, video pauses) and selectedMediaRef
  //           updates, so anything acting on "the current photo" is truthful
  //           immediately.
  //   later — setSelectedMedia re-renders the WHOLE gallery (chrome, meta,
  //           sheets). Running that in the settle frame was the swipe-eating
  //           stall, so it waits for interactions to finish. The 400ms timeout
  //           is the starvation belt: InteractionManager can be held off
  //           indefinitely by chained animations (Animated timings register
  //           interaction handles by default), and chrome meta lagging beats
  //           chrome meta never arriving mid-run.
  const syncSelectedFromOffset = useCallback((offsetX) => {
    const index = Math.round(offsetX / ITEM_WIDTH);
    const item = viewerItems[index];
    if (!item || item.isSkeleton || item.id === viewerActiveStore.get()) return;
    gestureProbe.mark('viewer:pageSettle');
    viewerActiveStore.set(item.id);
    selectedMediaRef.current = item;
    InteractionManager.runAfterInteractions(adoptPendingSelected);
    setTimeout(adoptPendingSelected, 400);
  }, [viewerItems, viewerActiveStore, adoptPendingSelected]);

  // Mirror the live scroll offset into a ref so a drag-end (which fires BEFORE
  // the snap settles) can read the FINAL resting offset a beat later.
  const lastViewerOffsetX = useRef(0);
  useEffect(() => {
    const id = scrollX.addListener(({ value }) => {
      lastViewerOffsetX.current = value;
      // Feed the chrome-toggle guard (see handleViewerSingleTap): any pager
      // motion pushes the tap-quiet horizon out past this frame.
      pagerQuietUntilRef.current = Date.now() + PAGER_TAP_QUIET_MS;
    });
    return () => scrollX.removeListener(id);
  }, [scrollX]);
  const dragSettleTimer = useRef(null);

  // Swipe start/finish bracket the HD stand-down (see pagerDragStore). Cleared
  // on momentum end AND on the drag-settle path below, because a slow release
  // snaps without ever producing a momentum phase.
  const handleScrollBeginDrag = useCallback(() => {
    // The headline measurement: finger-down → the pager actually starting to
    // move. When this reads slow, swiping "went dead".
    gestureProbe.respond('viewer:swipe');
    pagerDragStore.set(true);
  }, [pagerDragStore]);

  // FINGER-DOWN, not drag-recognition, is what stands the HD load down.
  //
  // onScrollBeginDrag only fires once the ScrollView has DECIDED the touch is a
  // drag. That decision is itself late when the main thread is busy decoding a
  // full-resolution image — which is precisely the moment being complained
  // about ("it lags when the file is mid load for HD"). Cancelling from there
  // arrives after the damage is done.
  //
  // A raw touch fires immediately, before any recognition, so the expensive
  // work is dropped before it can eat the gesture. Cancelling costs nothing
  // visible: an uncommitted HD layer is not on screen yet, so reverting to the
  // fast source changes no pixels, and a LOADED HD texture is never cancelled.
  const handleTouchStart = useCallback(() => {
    // A new touch supersedes any pending settle — otherwise a timer armed by
    // the previous gesture could clear the flag mid-way through this one.
    if (dragSettleTimer.current) { clearTimeout(dragSettleTimer.current); dragSettleTimer.current = null; }
    pagerDragStore.set(true);
  }, [pagerDragStore]);

  const handleMomentumScrollEnd = useCallback((event) => {
    if (dragSettleTimer.current) { clearTimeout(dragSettleTimer.current); dragSettleTimer.current = null; }
    pagerDragStore.set(false);
    syncSelectedFromOffset(event.nativeEvent.contentOffset.x);
    // The pager just went quiet — drain any HD flags that finished warming
    // during the swipe, so they apply now instead of waiting for the next one.
    flushHdMarks();
  }, [syncSelectedFromOffset, pagerDragStore, flushHdMarks]);

  // THE TAG-MISMATCH FIX: a slow drag-release can snap to the next photo via
  // snapToInterval WITHOUT any momentum phase, so onMomentumScrollEnd never
  // fires and selectedMedia would stay on the PREVIOUS photo — then tagging /
  // favouriting silently hits the wrong pic. onScrollEndDrag fires pre-snap, so
  // we re-read the settled offset shortly after to adopt the photo that's
  // actually on screen. (Momentum swipes clear this timer in the handler above.)
  const handleScrollEndDrag = useCallback(() => {
    if (dragSettleTimer.current) clearTimeout(dragSettleTimer.current);
    dragSettleTimer.current = setTimeout(() => {
      dragSettleTimer.current = null;
      pagerDragStore.set(false);
      syncSelectedFromOffset(lastViewerOffsetX.current);
      flushHdMarks(); // pager quiet — apply any HD that warmed mid-gesture
    }, 180);
  }, [syncSelectedFromOffset, pagerDragStore, flushHdMarks]);
  useEffect(() => () => { if (dragSettleTimer.current) clearTimeout(dragSettleTimer.current); }, []);

  // HD warming, driven by where the viewer is parked. This effect is the HD
  // manager's scheduler: it decides WHEN photos warm (active first, ±1
  // neighbors a beat later, so the photo on screen wins the bandwidth race);
  // ensureViewerHd decides HOW (prefetch to disk cache, flag flipped only on
  // quiet frames). Fire-and-forget on back-out — bytes in the cache stay
  // useful next time.
  useEffect(() => {
    if (!selectedMedia?.id || !Array.isArray(viewerItems) || viewerItems.length === 0) return;
    const idx = viewerItems.findIndex(it => it && it.id === selectedMedia.id);
    if (idx < 0) return;
    // The ACTIVE photo warms immediately — a prefetch touches no view, so
    // there is nothing to defer for. There is no dwell any more: the dwell
    // existed to avoid loading HD into a VIEW during a pass-by, and the
    // manager's quiet-frame commit gives that guarantee for free (a pass-by
    // never gets a quiet frame on that photo, so the flag simply flips later,
    // for a cell that is by then showing a different photo — harmlessly).
    ensureViewerHd(viewerItems[idx]);
    // Neighbors (±1) warm a beat later so the active photo's request wins the
    // race for bandwidth. They mark ready as they land, which is what makes
    // swiping onto them show HD instantly — the iOS behaviour — instead of
    // paying a dwell + fetch after arrival.
    const neighbors = [
      viewerItems[idx - 1],
      viewerItems[idx + 1],
    ].filter(Boolean);
    const NEIGHBOR_PREFETCH_DELAY_MS = 250;
    const handle = setTimeout(() => {
      neighbors.forEach(ensureViewerHd); // skeleton/video filtering lives inside
    }, NEIGHBOR_PREFETCH_DELAY_MS);
    return () => clearTimeout(handle);
    // Key on selectedMedia?.id (not the full object) so tag/favorite
    // mutations that spread `setSelectedMedia(prev => ({...prev,tags}))`
    // don't re-fire the prefetch unnecessarily — they change the
    // reference but not the underlying photo.
  }, [selectedMedia?.id, viewerItems, ensureViewerHd]);

  // Render individual viewer item with pinch-to-zoom.
  //
  // Deliberately knows NOTHING about which page is active: cells read that
  // from viewerActiveStore themselves. That keeps this callback (and so every
  // mounted cell's props) stable across page changes AND across gallery
  // re-renders — the memoized cells simply never re-render from the parent.
  const renderViewerItem = useCallback(({ item, index }) => {
    const isVideo = item.type === 'video';
    const fullResUrl = getFullUrl(item.rawUrl || item.url || '');

    // NO parallax. iOS Photos moves each page 1:1 with the pager and lets the
    // gutter do the work. The old 15% counter-translate meant a full-bleed
    // photo's edge visibly detached from the gutter mid-swipe (a black slice
    // chasing it inside the clipping mask) — a flourish that read as jank next
    // to the app being imitated. Removing it also removes a per-page Animated
    // interpolation from the swipe's hot path.
    return (
      // 1. THE OUTER BOUNDARY: screen width + the gutter
      <View style={styles.viewerItemContainer}>

        {/* 2. THE CLIPPING MASK: bounds the visible area to exactly the screen
            width so the image can never bleed into the gutter. */}
        <View style={{ width: width, height: '100%', overflow: 'hidden' }}>

          <View style={{ width: width, height: '100%' }}>
            {isVideo ? (
              <FullScreenVideoPlayer sourceUrl={fullResUrl} mediaId={item.id} activeStore={viewerActiveStore} styles={styles} insets={insets} />
            ) : (
              <ImageViewer
                fullResUrl={fullResUrl}
                mediaId={item.id}
                activeStore={viewerActiveStore}
                // The per-photo "HD is warm" flag — the ONLY thing that can
                // change what a mounted photo cell renders, and the manager
                // only flips it on quiet frames.
                hdStore={viewerHdStore}
                item={item}
                styles={styles}
                getFullUrl={getFullUrl}
                // Zoom reports drive the shell's chrome-hide + pull-dismiss
                // lockout; the cell itself only speaks when active
                // (handleZoomedChange gates on its store-derived isActive).
                onZoomScaleChange={reportZoomScale}
                // The zoom surface swallows taps, so the chrome toggle has to
                // be routed through it (it fires only after the double-tap
                // zoom has been ruled out).
                onSingleTap={handleViewerSingleTap}
                // iOS Photos: pinching a fit-to-screen photo in drops back to
                // the grid.
                onPinchDismiss={closeViewer}
              />
            )}
          </View>

        </View>
      </View>
    );
  }, [getFullUrl, styles, insets, reportZoomScale, handleViewerSingleTap, closeViewer, viewerActiveStore, viewerHdStore]);

  // Get layout for initialScrollIndex
  const getItemLayout = useCallback((data, index) => ({
    length: ITEM_WIDTH,
    offset: ITEM_WIDTH * index,
    index,
  }), []);

  // === SMART SYNC GALLERY RENDERER ===
  const renderLocalSyncGallery = () => (
    // pageSheet = native iOS card presentation with swipe-down-to-close (fires
    // onRequestClose). Android renders full-screen, so only it keeps the
    // status-bar inset (the iOS card already starts below the status bar).
    <Modal visible={localPickerVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setLocalPickerVisible(false)}>
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <View style={[styles.header, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border, paddingTop: Platform.OS === 'android' ? insets.top : 0, paddingBottom: 12 }]}>
          <TouchableOpacity onPress={() => setLocalPickerVisible(false)} style={styles.closeButton}>
            <Icon name="chevron-left" size={28} color={theme.colors.textPrimary} />
          </TouchableOpacity>
          <View style={styles.headerTitleContainer}>
            <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>
              {selectedLocalAssets.size} Selected
            </Text>
          </View>
          <TouchableOpacity onPress={handleSelectAllLocal}>
            <Text style={{ color: theme.colors.primary, fontSize: 16, fontWeight: '600' }}>
              {selectedLocalAssets.size === localAssets.length && localAssets.length > 0 ? 'Deselect All' : 'Select All'}
            </Text>
          </TouchableOpacity>
        </View>

        <FlatList
          data={localAssets}
          keyExtractor={(item) => item.id}
          numColumns={3}
          onEndReached={() => fetchLocalMedia(true)}
          onEndReachedThreshold={0.5}
          extraData={selectedLocalAssets}
          renderItem={renderLocalAsset}
        />

        <View style={[styles.bottomContainer, { paddingBottom: insets.bottom + 16, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border }]}>
          <TouchableOpacity
            style={[styles.uploadButton, { backgroundColor: selectedLocalAssets.size > 0 ? theme.colors.primary : theme.colors.surface }]}
            disabled={selectedLocalAssets.size === 0}
            onPress={queueSelectedForUpload}
          >
            <Icon name="cloud-upload" size={20} color={selectedLocalAssets.size > 0 ? theme.colors.background : theme.colors.textMuted} />
            <Text style={[styles.uploadButtonText, { color: selectedLocalAssets.size > 0 ? theme.colors.background : theme.colors.textMuted }]}>
              Sync {selectedLocalAssets.size} Items to Server
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );

  // Full-screen viewer with swipeable paging
  // Full-screen viewer with swipeable paging
  const renderFullScreenViewer = () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [displayMeta, setDisplayMeta] = useState(selectedMedia);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const metaFadeAnim = useRef(new Animated.Value(1)).current;

    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
      if (selectedMedia && selectedMedia.id !== displayMeta?.id) {
        // Fast fade out -> Swap data -> Smooth Bezier fade in
        Animated.timing(metaFadeAnim, { toValue: 0, duration: 100, useNativeDriver: true }).start(() => {
          setDisplayMeta(selectedMedia);
          Animated.timing(metaFadeAnim, { 
            toValue: 1, duration: 300, easing: Easing.bezier(0.4, 0.0, 0.2, 1), useNativeDriver: true 
          }).start();
        });
      } else if (!selectedMedia) {
        setDisplayMeta(null);
      }
    }, [selectedMedia, displayMeta?.id, metaFadeAnim]);

    if (!selectedMedia) return null;
    
    // Fallback while crossfading
    const activeMeta = displayMeta || selectedMedia;

    // Find the initial index in the SAME array the pager renders
    // (viewerSourceItems), so initialScrollIndex lands on the tapped photo.
    // A solo open is a single-item list, so its index is always 0.
    const initialIndex = viewerSoloItem
      ? 0
      : viewerSourceItems.findIndex(item => item.id === selectedMedia.id);
    const viewerInitialIndex = initialIndex >= 0 ? initialIndex : 0;

    // Render metadata drawer for swipe-up gesture
    const renderMetadataDrawer = () => {
      if (!selectedMedia) return null;
      const activeTags = [];
      try {
        const parsed = JSON.parse(selectedMedia.tags || '[]');
        if (Array.isArray(parsed)) parsed.forEach(t => activeTags.push(t));
      } catch(e) {}

      const sizeMB = selectedMedia.size ? (selectedMedia.size / (1024 * 1024)).toFixed(2) : 'Unknown';

      return (
        <Animated.View style={[styles.metadataDrawer, { transform: [{ translateY: drawerY }] }]}>
          <View style={styles.drawerHandle} />
          <Text style={[styles.drawerTitle, { color: theme.colors.textPrimary }]}>File Information</Text>
          <ScrollView style={{ flex: 1, width: '100%' }} showsVerticalScrollIndicator={false}>
            
            <View style={styles.infoRow}>
              <Icon name="file-outline" size={20} color={theme.colors.textSecondary} />
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>Filename</Text>
                <Text style={{ color: theme.colors.textPrimary, fontSize: 14, fontWeight: '500' }}>{selectedMedia.filename}</Text>
              </View>
            </View>

            <View style={styles.infoRow}>
              <Icon name="harddisk" size={20} color={theme.colors.textSecondary} />
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>Size & Resolution</Text>
                <Text style={{ color: theme.colors.textPrimary, fontSize: 14, fontWeight: '500' }}>
                  {sizeMB} MB {selectedMedia.width && `• ${selectedMedia.width}x${selectedMedia.height}`}
                </Text>
              </View>
            </View>

            <Text style={[styles.drawerTitle, { color: theme.colors.textPrimary, marginTop: 24, fontSize: 15 }]}>Tags & Albums</Text>
            <View style={styles.chipInputContainer}>
              {activeTags.length > 0 ? activeTags.map((tag, i) => (
                <View key={i} style={[styles.chip, { backgroundColor: theme.colors.primary }]}>
                  <Text style={styles.chipText}>{tag}</Text>
                </View>
              )) : <Text style={{ color: theme.colors.textMuted }}>No tags assigned</Text>}
            </View>

          </ScrollView>
        </Animated.View>
      );
    };

    return (
      <Modal
        visible={selectedMedia !== null}
        transparent={true}
        animationType="none"
        onRequestClose={closeViewer}
      >
        {/* A Modal renders into its own native view tree, OUTSIDE the
            GestureHandlerRootView at the app root — Gesture Handler needs a
            root inside it or the photo's pinch/pan/tap gestures silently never
            fire (Android especially). */}
        <GestureHandlerRootView style={{ flex: 1 }}>
        {/* No onPress here — the chrome toggle is owned by the photo cell's
            gesture surface (ZoomableView routes a single tap only after the
            double-tap has been ruled out). When this container ALSO toggled on
            press, a tap fired twice: once on finger-up (here, immediately) and
            once ~260ms later (the gesture), so the chrome flipped and flipped
            back — "tapping does nothing" — and the first tap of every
            double-tap-zoom flashed the chrome for free. */}
        <Pressable
          style={styles.viewerContainer}
          {...swipeResponder.panHandlers}
        >
          {/* Status bar folds away with the chrome (iOS Photos): visible while
              the info layer shows, gone in the immersive state. */}
          <StatusBar hidden={!infoVisible} animated />
          {/* Black background — also fades as the photo is pulled down so the
              grid behind reads through (iOS Photos dismiss). */}
          <Animated.View
            style={[
              styles.viewerBackground,
              { opacity: Animated.multiply(opacityAnim, dragBackdropOpacity) }
            ]}
          />
          
          {/* Date/Resolution overlays moved inside ViewerItem for proper positioning */}

          {/* Gradient chrome header (iOS Photos). A soft black-to-transparent
              wash behind the top controls so white icons stay legible over a
              bright photo without a hard bar. box-none so taps that miss the
              back arrow still fall through to the chrome toggle, and it fades
              with the same opacity the rest of the chrome uses. */}
          <Animated.View
            // box-none: only the back button is a target, the rest of the
            // gradient band passes touches through to the pager. When zoomed
            // the chrome is faded out (zoomChromeAnim) — 'none' so an
            // invisible back button can't eat taps/pans.
            pointerEvents={zoomScale > 1.05 ? 'none' : 'box-none'}
            style={{
              position: 'absolute', top: 0, left: 0, right: 0,
              height: insets.top + 68,
              // dragChromeOpacity: chrome clears out as soon as a pull-to-
              // dismiss starts moving the photo, iOS-style.
              opacity: Animated.multiply(zoomChromeAnim, Animated.multiply(opacityAnim, dragChromeOpacity)),
              zIndex: 5,
            }}
          >
            <LinearGradient
              pointerEvents="none"
              colors={['rgba(0,0,0,0.62)', 'rgba(0,0,0,0.26)', 'transparent']}
              locations={[0, 0.55, 1]}
              style={StyleSheet.absoluteFillObject}
            />
            <TouchableOpacity
              onPress={closeViewer}
              hitSlop={HIT_SLOP_15}
              activeOpacity={0.6}
              accessibilityRole="button"
              accessibilityLabel="Back"
              style={{
                position: 'absolute', left: 8, top: insets.top + 6,
                width: 44, height: 44, alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Icon name="chevron-left" size={32} color="#fff" style={{ textShadowColor: 'rgba(0,0,0,0.45)', textShadowRadius: 4 }} />
            </TouchableOpacity>
          </Animated.View>

          {/* Top Right Actions: Edit, Tags */}
          <Animated.View
            style={[
              styles.viewerCloseButton,
              {
                zIndex: 6,
                top: insets.top + 16,
                opacity: Animated.multiply(zoomChromeAnim, Animated.multiply(opacityAnim, dragChromeOpacity)),
                flexDirection: 'row',
                alignItems: 'center',
                gap: 20, // Clean spacing between action icons
                borderRadius: 30,
                paddingHorizontal: 16,
                paddingVertical: 8,
              }
            ]}
            // box-none, not 'auto': 'auto' made the WHOLE pill (padding and
            // the 20px gaps between icons) swallow touches, so a swipe
            // starting there never reached the pager — one of the overlay
            // dead zones behind "swiping goes dead". The icons are their own
            // targets; everything between them scrolls the pager.
            pointerEvents={zoomScale > 1.05 ? 'none' : 'box-none'}
          >
            {/* Only show Edit button for Images, not Videos */}
            {selectedMedia?.type !== 'video' && (
              <TouchableOpacity
                onPress={openImageEditor}
                hitSlop={HIT_SLOP_15}
                accessibilityRole="button"
                accessibilityLabel="Edit image"
              >
                <Icon name="pencil" size={26} color="#fff" style={{ textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4 }} />
              </TouchableOpacity>
            )}

            <TouchableOpacity
              onPress={openTagEditor}
              hitSlop={HIT_SLOP_15}
              accessibilityRole="button"
              accessibilityLabel="Edit tags"
            >
              <Icon name="tag-multiple" size={26} color="#fff" style={{ textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4 }} />
            </TouchableOpacity>
          </Animated.View>

          {/* Global Bottom Action Bar (Immune to FlatList Swipes & Pointer Traps) */}
          <Animated.View 
            style={[
              { 
                position: 'absolute', 
                left: 24, 
                right: 24, 
                // Clears the floating tab card (which reserves no space) rather
                // than just the safe area.
                bottom: tabBarH + 20,
                flexDirection: 'row', 
                justifyContent: 'space-between', 
                alignItems: 'flex-end',
                // Animated.multiply so the bar fades with the IMAGE on close
                // (opacityAnim→0). infoOpacityAnim alone left the heart/share
                // lingering after the photo had gone; opacityAnim sits at 1 during
                // normal viewing so the single-tap info toggle still works.
                opacity: Animated.multiply(zoomChromeAnim, Animated.multiply(Animated.multiply(opacityAnim, infoOpacityAnim), dragChromeOpacity)),
                zIndex: 10,
              }
            ]}
            pointerEvents={zoomScale > 1.05 || !infoVisible ? 'none' : 'box-none'} // Disable when zoomed or hidden
          >
            {/* Left Side: Date & Resolution (Animated Crossfade) */}
            <Animated.View style={{ flex: 1, opacity: metaFadeAnim }} pointerEvents="none">
              <Text style={[styles.viewerInfoDate, { textAlign: 'left', marginBottom: 4 }]} numberOfLines={1}>
                {activeMeta.originalDate 
                  ? new Date(activeMeta.originalDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                  : activeMeta.uploadDate 
                    ? new Date(activeMeta.uploadDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
                    : ''
                }
              </Text>
              {activeMeta.width && activeMeta.height && (
                <Text style={[styles.viewerInfoResolution, { textAlign: 'left' }]}>
                  {activeMeta.width} × {activeMeta.height}
                  {activeMeta.type === 'video' && ' • Video'}
                </Text>
              )}
            </Animated.View>
            
            {/* Right Side: Share & Favourites inside a Premium Pill.
                box-none — the buttons (with their hitSlop) are the targets;
                the pill's own padding shouldn't be a swipe dead zone. */}
            <View style={[styles.premiumBezel, { flexDirection: 'row', gap: 20, alignItems: 'center', borderRadius: 30, paddingHorizontal: 20, paddingVertical: 10 }]} pointerEvents="box-none">
              <TouchableOpacity 
                onPress={handleShare}
                hitSlop={HIT_SLOP_20}
                activeOpacity={0.6}
              >
                <Icon name="share-variant" size={28} color="#fff" style={{ textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4 }} />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={toggleFavourite}
                hitSlop={HIT_SLOP_20}
                activeOpacity={0.6}
              >
                <Icon
                  name={selectedMedia?.tags?.includes('Favourites') ? "heart" : "heart-outline"}
                  size={30}
                  color={selectedMedia?.tags?.includes('Favourites') ? "#ef4444" : "#ffffff"}
                  style={{ textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4 }}
                />
              </TouchableOpacity>
            </View>

            {/* Share chooser — a link, or the bytes.

                These are genuinely different things, not two routes to one
                action, so the sheet names what each one costs. The link is
                first because it's the cheap one: nothing leaves the phone, the
                original stays full quality, and a video plays inside the
                conversation instead of arriving as a blue link.

                Modal portals above the viewer, so where it sits in the tree
                has no layout effect. */}
            <Modal
              visible={!!shareChooser}
              transparent
              animationType="fade"
              onRequestClose={() => setShareChooser(null)}
            >
              <Pressable style={styles.shareSheetBackdrop} onPress={() => setShareChooser(null)}>
                <Pressable style={styles.shareSheetCard} onPress={() => {}}>
                  <Text style={styles.shareSheetTitle}>
                    {shareChooser?.type === 'video' ? 'Share video' : 'Share photo'}
                  </Text>

                  <TouchableOpacity
                    style={styles.shareSheetOption}
                    activeOpacity={0.7}
                    onPress={() => { const m = shareChooser; setShareChooser(null); doShareLink(m); }}
                  >
                    <Icon name="link-variant" size={22} color={theme.colors.primary} />
                    <View style={styles.shareSheetOptionText}>
                      <Text style={styles.shareSheetOptionTitle}>Send a link</Text>
                      <Text style={styles.shareSheetOptionSub}>
                        {shareChooser?.type === 'video'
                          ? 'Plays right inside iMessage & WhatsApp · nothing uploads'
                          : 'Shows as a preview card · nothing uploads'}
                      </Text>
                    </View>
                  </TouchableOpacity>

                  {/* A video has no compressed tier to choose between — its
                      only file option is the original. */}
                  {shareChooser?.type !== 'video' && (
                    <TouchableOpacity
                      style={styles.shareSheetOption}
                      activeOpacity={0.7}
                      onPress={() => { const m = shareChooser; setShareChooser(null); doShare(m, 'regular'); }}
                    >
                      <Icon name="image-outline" size={22} color={theme.colors.accentInfo} />
                      <View style={styles.shareSheetOptionText}>
                        <Text style={styles.shareSheetOptionTitle}>Regular</Text>
                        <Text style={styles.shareSheetOptionSub}>Smaller file · sends instantly</Text>
                      </View>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity
                    style={styles.shareSheetOption}
                    activeOpacity={0.7}
                    onPress={() => { const m = shareChooser; setShareChooser(null); doShare(m, 'full'); }}
                  >
                    <Icon
                      name={shareChooser?.type === 'video' ? 'movie-outline' : 'image-size-select-actual'}
                      size={22}
                      color={theme.colors.primary}
                    />
                    <View style={styles.shareSheetOptionText}>
                      <Text style={styles.shareSheetOptionTitle}>
                        {shareChooser?.type === 'video' ? 'Send the file' : 'Full resolution'}
                      </Text>
                      <Text style={styles.shareSheetOptionSub}>
                        {shareChooser?.type === 'video'
                          ? 'The original itself · uploads from here'
                          : `Original quality${shareChooser?.width && shareChooser?.height ? ` · ${shareChooser.width}×${shareChooser.height}` : ''}`}
                      </Text>
                    </View>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.shareSheetCancel} activeOpacity={0.7} onPress={() => setShareChooser(null)}>
                    <Text style={styles.shareSheetCancelText}>Cancel</Text>
                  </TouchableOpacity>
                </Pressable>
              </Pressable>
            </Modal>

          </Animated.View>

          {/* ── 3px load-progress bar ────────────────────────────────
              Pinned just below the iOS safe-area inset at the top of
              the viewer. Tracks Layer 2 (high-res) bytes-in-flight for
              the currently active photo. Animates via translateX of a
              full-width inner bar clipped by an overflow:hidden parent
              — this lets the animation stay on the native driver
              (translateX is GPU-cheap; animating `width` would force
              a layout pass per frame).
              pointerEvents='none' so it never intercepts the viewer's
              tap-to-toggle-info gesture. */}
          <Animated.View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: insets.top,
              left: 0,
              right: 0,
              height: 3,
              backgroundColor: 'rgba(255,255,255,0.10)',
              overflow: 'hidden',
              zIndex: 1000,
              opacity: viewerProgressOpacityAnim,
            }}
          >
            {/* Filled portion — solid white. The translateX driven by
                viewerProgressAnim slides the full-width bar in from
                the left as the load progresses: progress=0 → fully
                off-screen, progress=1 → flush with the track. That
                slide IS the only animation on the bar. No gradient,
                no shimmer, no extra decoration. */}
            <Animated.View
              style={{
                height: 3,
                width: '100%',
                backgroundColor: 'rgba(255,255,255,0.95)',
                transform: [{
                  translateX: viewerProgressAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-width, 0],
                  }),
                }],
              }}
            />
          </Animated.View>

          {/* Horizontal swipeable FlatList wrapped in GPU-bound Animated.View */}
          <Animated.View
            style={[
              styles.viewerFlatListContainer,
              {
                transform: [
                  // Origin-anchored pop: translate decays to 0 as scaleAnim
                  // settles, so open grows OUT of the tapped cell and close
                  // retreats back toward it. dragY stacks on top for the
                  // pull-to-dismiss track.
                  { translateX: Animated.add(dragX, originTranslateX) },
                  { translateY: Animated.add(dragY, originTranslateY) },
                  { scale: Animated.multiply(scaleAnim, dragScale) },
                ],
                opacity: opacityAnim,
              },
            ]}
          >
            <DevProfiler id="viewerPager">
            <Animated.FlatList
              data={viewerItems}
              renderItem={renderViewerItem}
              keyExtractor={(item) => item.id}
              horizontal={true}
              showsHorizontalScrollIndicator={false}
              // Freeze paging while the photo is zoomed: a zoomed photo's
              // horizontal drag belongs to the photo. Keyed off the settled
              // zoom state ONLY — toggling this mid-gesture cancels an in-flight
              // native scroll, which is a visible jump under the fingers.
              scrollEnabled={zoomScale <= 1.05}

              // --- 🛑 STRICT 1-ITEM SWIPE PHYSICS 🛑 ---
              pagingEnabled={false} // CRITICAL: Turn off native paging because we have a 4px gap
              snapToInterval={ITEM_WIDTH} // Snap exactly to our custom width + gap
              // START (not center): every other piece of the paging math —
              // getItemLayout (offset = ITEM_WIDTH*index), scrollX.setValue on
              // open, the parallax inputRange, and handleMomentumScrollEnd's
              // round(offset/ITEM_WIDTH) — assumes LEFT-aligned offsets. With
              // "center" the list settled half-a-GAP off those positions, so
              // the image rested off-centre and the index/parallax were
              // miscalibrated (the "doesn't centre properly" bug). "start"
              // keeps the entire model consistent → the image rests dead-centre.
              snapToAlignment="start"
              disableIntervalMomentum={true} // MAGIC BULLET: Prevents momentum from skipping past the next adjacent item
              decelerationRate="fast" // Snaps instantly instead of drifting slowly
              // ----------------------------------------
              
              initialNumToRender={3}
              // 3, not 5: each mounted cell holds a full-screen texture, and
              // ±2 pages of standby textures bought nothing the ±1 prefetch
              // cache doesn't — while costing native memory and making every
              // store broadcast fan wider. ±1 is exactly what a single swipe
              // can reach.
              windowSize={3}
              maxToRenderPerBatch={3}
              removeClippedSubviews={false}
              getItemLayout={getItemLayout}
              initialScrollIndex={viewerInitialIndex}
              onScroll={Animated.event(
                [{ nativeEvent: { contentOffset: { x: scrollX } } }],
                { useNativeDriver: true }
              )}
              scrollEventThrottle={16}
              // Touch-down suppresses the HD load before the pager has even
              // decided this is a drag; touch-end hands it back through the
              // SAME settle path a drag uses, so a fling that is still
              // travelling after the finger lifts stays suppressed until it
              // lands (onMomentumScrollEnd clears sooner when there is a
              // momentum phase at all).
              onTouchStart={handleTouchStart}
              onTouchEnd={handleScrollEndDrag}
              onTouchCancel={handleScrollEndDrag}
              onScrollBeginDrag={handleScrollBeginDrag}
              onMomentumScrollEnd={handleMomentumScrollEnd}
              onScrollEndDrag={handleScrollEndDrag}
            />
            </DevProfiler>
          </Animated.View>



          {/* Inline Tag Editor Overlay (Animated & Chip UI) */}
          {editTagsVisible && (
            <Animated.View style={[StyleSheet.absoluteFillObject, { zIndex: 100, opacity: tagFadeAnim }]}>
              {/* Background Dismiss Handler - closes modal and dismisses keyboard */}
              <Pressable 
                style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.7)' }]}
                onPress={() => {
                  Keyboard.dismiss();
                  closeTagEditor();
                }}
              >
                {/* Keyboard avoidance: for a vertically-centered card, the KAV's
                    padding/height shrinks the area so the card re-centers in the
                    space ABOVE the keyboard (lifts ~half the keyboard height),
                    riding the OS keyboard curve. Fixes the card being half-covered. */}
                <KeyboardAvoidingView
                  style={{ flex: 1 }}
                  behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                >
                {/* Scrollable Modal Container - adjusts for keyboard */}
                <ScrollView
                  contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center' }}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="on-drag"
                >
                  {/* Inner Modal Container - intercepts touches so background doesn't trigger */}
                  <Pressable 
                    style={[styles.uploadModalContent, { backgroundColor: theme.colors.surfaceElevated, width: width * 0.9, maxHeight: height * 0.8 }]}
                    onPress={(e) => {
                      e.stopPropagation();
                      Keyboard.dismiss();
                    }}
                  >
                    {/* Modal Header */}
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <Text style={[styles.uploadModalTitle, { color: theme.colors.textPrimary, marginBottom: 0 }]}>Edit Tags</Text>
                      <TouchableOpacity onPress={closeTagEditor} style={{ padding: 4 }}>
                        <Icon name="close" size={24} color={theme.colors.textSecondary} />
                      </TouchableOpacity>
                    </View>
                    
                    <Text style={[styles.uploadModalLabel, { color: theme.colors.textSecondary }]}>Assigned Tags:</Text>
                  
                    {/* Dynamic Chip Input Box */}
                    <View style={[styles.chipInputContainer, { borderColor: theme.colors.border }]}>
                    {editingTags.map((tag, index) => (
                      <View key={index} style={[styles.chip, { backgroundColor: theme.colors.primary }]}>
                        <Text style={styles.chipText}>{tag}</Text>
                        <TouchableOpacity onPress={() => setEditingTags(prev => prev.filter((_, i) => i !== index))}>
                          <Icon name="close-circle" size={16} color={theme.colors.background} />
                        </TouchableOpacity>
                      </View>
                    ))}
                    <TextInput
                      style={[styles.chipTextInput, { color: theme.colors.textPrimary }]}
                      value={tagInputValue}
                      onChangeText={(text) => {
                        // Auto-box when a comma is typed
                        if (text.includes(',')) {
                          const newTags = text.split(',').map(t => t.trim()).filter(Boolean);
                          if (newTags.length > 0) {
                            setEditingTags(prev => Array.from(new Set([...prev, ...newTags])));
                          }
                          setTagInputValue('');
                        } else {
                          setTagInputValue(text);
                        }
                      }}
                      onKeyPress={({ nativeEvent }) => {
                        // Backspace deletes the last chip if input is empty
                        if (nativeEvent.key === 'Backspace' && tagInputValue === '' && editingTags.length > 0) {
                          setEditingTags(prev => prev.slice(0, -1));
                        }
                      }}
                      onSubmitEditing={() => {
                        // Submit with return key adds the tag
                        if (tagInputValue.trim()) {
                          setEditingTags(prev => Array.from(new Set([...prev, tagInputValue.trim()])));
                          setTagInputValue('');
                        }
                        Keyboard.dismiss();
                      }}
                      placeholder={editingTags.length === 0 ? "Type tags, comma or return to add..." : ""}
                      placeholderTextColor={theme.colors.textMuted}
                      autoCapitalize="words"
                      returnKeyType="done"
                      blurOnSubmit={true}
                    />
                  </View>

                  {/* Autocomplete suggestions - show matching tags with active ones pinned to front */}
                  {tagInputValue.length > 0 && (
                    <View style={styles.tagAutocompleteContainer}>
                      <Text style={[styles.tagAutocompleteLabel, { color: theme.colors.textMuted }]}>
                        Matching tags:
                      </Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" style={styles.tagAutocompleteScroll}>
                        {pinnedAlbums
                          .filter(album => album.toLowerCase().includes(tagInputValue.toLowerCase()))
                          .sort((a, b) => {
                            // Pin active tags to the front
                            const aActive = editingTags.includes(a);
                            const bActive = editingTags.includes(b);
                            if (aActive && !bActive) return -1;
                            if (!aActive && bActive) return 1;
                            return a.localeCompare(b);
                          })
                          .map(album => (
                            <TouchableOpacity
                              key={album}
                              activeOpacity={0.6}
                              style={[
                                styles.tagAutocompleteChip,
                                editingTags.includes(album) && { backgroundColor: theme.colors.primary }
                              ]}
                              onPress={() => {
                                // Functional + idempotent: a stale closure or a
                                // rapid double-tap can't duplicate the tag.
                                setEditingTags(prev => prev.includes(album) ? prev : [...prev, album]);
                                setTagInputValue('');
                              }}
                            >
                              <Text style={[
                                styles.tagAutocompleteChipText,
                                editingTags.includes(album) && { color: theme.colors.background }
                              ]}>
                                {album}
                              </Text>
                            </TouchableOpacity>
                          ))}
                      </ScrollView>
                    </View>
                  )}

                  <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" style={styles.quickSelectScroll}>
                    {pinnedAlbums.map(album => (
                      <TouchableOpacity
                        key={album}
                        style={[styles.quickSelectChip, editingTags.includes(album) && { backgroundColor: theme.colors.primary }]}
                        onPress={() => {
                          // Functional toggle: atomic + dedup-safe under lag.
                          setEditingTags(prev => prev.includes(album) ? prev.filter(t => t !== album) : [...prev, album]);
                        }}
                      >
                        <Text style={[styles.quickSelectText, editingTags.includes(album) && { color: theme.colors.background }]}>{album}</Text>
                      </TouchableOpacity>
                    ))}
                </ScrollView>
                
                  <View style={styles.uploadModalButtons}>
                    <TouchableOpacity 
                      style={[styles.uploadModalButton, { backgroundColor: theme.colors.surface }]}
                      onPress={closeTagEditor}
                    >
                      <Text style={{ color: theme.colors.textPrimary }}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.uploadModalButton, { backgroundColor: theme.colors.primary }]}
                      onPress={() => {
                        // Resolve the tag set (chips + whatever's still typed),
                        // then close the editor INSTANTLY. Persistence runs in
                        // the background via the optimistic commit helpers.
                        let finalTags = [...editingTags];
                        if (tagInputValue.trim()) finalTags.push(tagInputValue.trim());
                        finalTags = Array.from(new Set(finalTags));

                        closeTagEditor();
                        if (isSelectMode) {
                          executeBulkTagSave(finalTags);
                        } else if (selectedMedia) {
                          commitTags(selectedMedia.id, finalTags);
                        }
                      }}
                    >
                      <Text style={{ color: theme.colors.background, fontWeight: 'bold' }}>Save</Text>
                    </TouchableOpacity>
                  </View>
                </Pressable>
                </ScrollView>
                </KeyboardAvoidingView>
              </Pressable>
            </Animated.View>
          )}

          {/* iOS-style Metadata Drawer */}
          {renderMetadataDrawer()}

          {/* "Gathering data" overlay while the original downloads, then the OS
              share sheet takes over.

              IN-TREE View, NOT a Modal — and a direct child of the viewer, not
              of the (absolutely positioned, chrome-faded) bottom action bar. A
              second Modal over the open viewer Modal is the documented iOS
              trap: dismiss it and present UIActivityViewController in the same
              tick and the share sheet silently never appears. Videos hit that
              EVERY time — they skip the quality chooser, so their download is
              always still in flight when the sheet is asked for. That was the
              "sharing a video never prompts" bug. */}
          {sharePreparing && (
            // Pressable, not View: an in-tree overlay's taps would otherwise
            // bubble to the viewer's own tap handler (toggle chrome / dismiss)
            // underneath it. The Modal used to swallow them for us.
            <Pressable
              onPress={() => {}}
              style={[StyleSheet.absoluteFillObject, styles.sharePreparingBackdrop, { zIndex: 300 }]}
              testID="share-preparing-overlay"
            >
              <View style={styles.sharePreparingCard}>
                <ActivityIndicator size="large" color={theme.colors.primary} />
                <Text style={styles.sharePreparingText}>
                  {sharePrepLabel || 'Preparing full-resolution image…'}
                  {shareProgress != null ? `  ${Math.round(shareProgress * 100)}%` : ''}
                </Text>
                {!!shareCancelRef.current && (
                  <TouchableOpacity
                    onPress={() => { const c = shareCancelRef.current; shareCancelRef.current = null; c?.(); }}
                    activeOpacity={0.7}
                    hitSlop={HIT_SLOP_20}
                  >
                    <Text style={styles.shareSheetCancelText}>Cancel</Text>
                  </TouchableOpacity>
                )}
              </View>
            </Pressable>
          )}
        </Pressable>
        </GestureHandlerRootView>
      </Modal>
    );
  };

  // === NATIVE 1:1 SWIPE PAGINATION & UNDERLINE INDICATOR ===
  const tabWidth = (width - 32) / 2;
  const pagesScrollRef = useRef(null);
  const pageScrollX = useRef(new Animated.Value(0)).current;
  const TABS = useMemo(() => ['albums', 'music'], []);

  // Push / pop the photos page. Opening sets the board first so the grid's
  // fetches start against the right filter on its first render.
  const openPhotosPage = useCallback((boardName) => {
    setSelectedAlbum(boardName || 'All');
    setPhotosOpen(true);
  }, []);
  const closePhotosPage = useCallback(() => {
    setPhotosOpen(false);
    setSelectedAlbum('All');
    setIsSelectMode(false);
    setIsUploadsSearchVisible(false);
    setUploadsSearchQuery('');
  }, []);
  // 'All' is the unfiltered library, which is exactly what the All Photos board
  // is. Declared here rather than beside allPhotosBoard so it sits AFTER
  // openPhotosPage — a const referenced before its declaration would throw.
  const openAllPhotos = useCallback(() => openPhotosPage('All'), [openPhotosPage]);

  // Pinterest-style underline: a bar the width of the ACTIVE label that slides
  // from title to title. Label widths are measured once by onLayout (text width
  // depends on font metrics and the user's font scale, so it can't be computed).
  // Until both are measured, fall back to a proportion of the tab slot so the
  // bar is never zero-width on first paint.
  const [tabLabelWidths, setTabLabelWidths] = useState({});
  const measureTabLabel = useCallback((tab, w) => {
    const next = Math.round(w);
    if (!next) return;
    // Functional update + no-op guard: onLayout fires on every re-measure
    // (rotation, font scale), and an unconditional setState here would loop.
    setTabLabelWidths((prev) => (prev[tab] === next ? prev : { ...prev, [tab]: next }));
  }, []);

  const fallbackLabelWidth = Math.min(tabWidth * 0.45, 72);
  const labelWidthFor = (tab) => tabLabelWidths[tab] || fallbackLabelWidth;

  // The bar's WIDTH is a plain style, not an animated one: pageScrollX is fed by
  // an Animated.event with useNativeDriver, and the native animated module only
  // handles transforms and opacity — interpolating `width` off it throws
  // "Style property 'width' is not supported by native animated module".
  // scaleX would be native-safe but scales the 2pt border radius with it, so the
  // rounded ends would smear into a lens. A single fixed width sized to the
  // widest label, moved by translateX, keeps both the native driver and the caps.
  const tabUnderlineWidth = Math.max(...TABS.map(labelWidthFor));
  const tabUnderlineX = pageScrollX.interpolate({
    inputRange: [0, width],
    outputRange: [
      tabWidth * 0.5 - tabUnderlineWidth / 2,          // centred under tab 0
      tabWidth * 1.5 - tabUnderlineWidth / 2,          // centred under tab 1
    ],
    extrapolate: 'clamp',
  });

  // IMPERATIVE TAB PRESS: We tell the ScrollView to move. 
  // Because the underline is bound to pageScrollX, the indicator slides automatically!
  const handleTabPress = useCallback((tab) => {
    const index = TABS.indexOf(tab);
    if (index < 0) return;

    // Re-tapping the active tab does nothing: both pages are lists that own
    // their own scroll, and the grid is no longer one of them.
    if (tab === pagerTab) return;

    // Native paging slide — starts instantly and runs buttery-smooth on the UI
    // thread (no JS-thread per-frame work to stutter it). Fire it FIRST and on
    // its own tick; the tab's heavier state work (grid active-tab gating +
    // fetchAlbums) is deferred to runAfterInteractions so the synchronous
    // re-render can't hold the scroll command back from flushing to native —
    // that hold-back was the "delay on press". Both pages are already mounted,
    // so nothing blanks: the destination just slides in, then its data work
    // runs once the slide has settled.
    if (pagesScrollRef.current) {
      pagesScrollRef.current.scrollTo({ x: index * width, animated: true });
    }
    InteractionManager.runAfterInteractions(() => {
      setPagerTab(tab);
    });
  }, [TABS, pagerTab, width]);

  // SWIPE END: The ScrollView tells React it finished moving.
  const commitTab = useCallback((index) => {
    const newTab = TABS[Math.max(0, Math.min(TABS.length - 1, index))];
    if (newTab && newTab !== pagerTab) setPagerTab(newTab);
  }, [pagerTab, TABS]);

  const handlePageSwipeEnd = useCallback((event) => {
    commitTab(Math.round(event.nativeEvent.contentOffset.x / width));
  }, [commitTab, width]);

  // Snappier loads: commit the landing tab the instant the finger LIFTS, rather
  // than waiting for the paging animation to settle (onMomentumScrollEnd). That
  // fires the new tab's work — fetchAlbums / the grid's active-tab gating —
  // ~one animation early, so the content is already arriving as the page slides
  // in. We predict the snap target from the release velocity (a flick that
  // hasn't crossed the half-way line still lands on the next page); momentum end
  // then re-commits authoritatively (idempotent — a no-op if we guessed right).
  const handlePageSwipeDragEnd = useCallback((event) => {
    const { contentOffset, velocity } = event.nativeEvent;
    const x = contentOffset.x;
    const v = (velocity && velocity.x) || 0;
    let index = Math.round(x / width);
    if (v > 0.1) index = Math.ceil(x / width);
    else if (v < -0.1) index = Math.floor(x / width);
    commitTab(index);
  }, [commitTab, width]);

  // === MEMOIZED STYLES ===
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <DevProfiler id="gallery">
    <View style={styles.container}>
      {/* Full-screen viewer & Modals */}
      <DevProfiler id="viewer">{renderFullScreenViewer()}</DevProfiler>
      {renderLocalSyncGallery()}

      {/* Same gather overlay, grid side. The viewer's copy lives inside the
          viewer Modal and so can't paint over the grid — bulk share runs with
          the viewer CLOSED, which is why multi-select downloads used to churn
          for minutes with no feedback at all. */}
      {sharePreparing && !selectedMedia && (
        <Pressable
          onPress={() => {}}
          style={[StyleSheet.absoluteFillObject, styles.sharePreparingBackdrop, { zIndex: 300 }]}
          testID="share-preparing-overlay-grid"
        >
          <View style={styles.sharePreparingCard}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
            <Text style={styles.sharePreparingText}>
              {sharePrepLabel || 'Preparing full-resolution image…'}
            </Text>
          </View>
        </Pressable>
      )}

      {/* Expanding Inline Bulk Console */}
      {isSelectMode && (
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'position' : undefined}
          // Sits ABOVE the floating tab bar — these are the bulk actions
          // (share / tag / delete) and they can't be scrolled out from under it.
          style={{ position: 'absolute', bottom: Math.max(insets.bottom + 24, tabBarH + 12), left: 16, right: 16, zIndex: 50 }}
          pointerEvents="box-none"
        >
          {!isBulkTagging ? (
            <View style={{ alignItems: 'center', gap: 10 }}>
            {/* Section Select toggle — tap first photo, tap last, fill between */}
            <TouchableOpacity
              testID="gallery-section-select"
              onPress={toggleRangeSelect}
              activeOpacity={0.8}
              style={[styles.selectBezel, {
                flexDirection: 'row', alignItems: 'center', gap: 8,
                paddingHorizontal: 16, paddingVertical: 9, borderRadius: 22,
                borderWidth: rangeSelectMode ? 1.5 : StyleSheet.hairlineWidth,
                borderColor: rangeSelectMode ? theme.colors.primary : (theme.mode === 'dark' ? 'rgba(255,255,255,0.15)' : theme.colors.border),
              }]}
            >
              <Icon name="unfold-more-horizontal" size={18} color={rangeSelectMode ? theme.colors.primary : theme.colors.textSecondary} />
              <Text style={{ color: rangeSelectMode ? theme.colors.primary : theme.colors.textSecondary, fontWeight: '600', fontSize: 13 }}>
                {rangeSelectMode
                  ? (rangeAnchorIdx == null ? 'Tap the first photo' : 'Now tap the last photo')
                  : 'Section Select'}
              </Text>
            </TouchableOpacity>

            <Animated.View style={[styles.selectBezel, {
              alignSelf: 'center', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 30, gap: 8,
            }]}>
              {/* Live selection count — the bar's actions read against it. */}
              <View style={{
                minWidth: 26, height: 26, borderRadius: 13, paddingHorizontal: 7,
                alignItems: 'center', justifyContent: 'center',
                backgroundColor: selectedGridItems.size > 0 ? theme.colors.primary : (theme.mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'),
                marginRight: 4,
              }}>
                <Text style={{
                  fontSize: 13, fontWeight: '700',
                  color: selectedGridItems.size > 0 ? theme.colors.background : theme.colors.textMuted,
                }}>
                  {selectedGridItems.size}
                </Text>
              </View>
              <View style={{ width: 1, height: 20, backgroundColor: theme.colors.borderStrong, marginHorizontal: 4 }} />
              <TouchableOpacity
                testID="gallery-share-button"
                accessibilityLabel="Share selected photos"
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, opacity: selectedGridItems.size === 0 ? 0.5 : 1 }}
                disabled={selectedGridItems.size === 0}
                onPress={async () => {
                  // Match native iOS Photos multi-share: download the selected
                  // originals to cache, then present ONE share sheet with ALL of
                  // them. expo-sharing can only take a single file (which forced
                  // an N-sheet slog — one sheet per photo); react-native-share's
                  // `urls` array hands the whole selection to a single OS sheet.
                  if (bulkShareBusyRef.current) return; // ignore double-taps
                  const selectedIds = Array.from(selectedGridItems);
                  if (selectedIds.length === 0) return;
                  bulkShareBusyRef.current = true;

                  const local = []; // cached copies to clean up after sharing
                  // Gather overlay while the originals download — the sheet only
                  // appears once everything's ready, so it opens fully populated.
                  setSharePrepLabel(selectedIds.length > 1 ? `Preparing ${selectedIds.length} photos…` : null);
                  setSharePreparing(true);
                  try {
                    // Resolve each selected id → its media object. Start with what's
                    // resident in the virtualized grid, then backfill anything the
                    // LRU page cache has evicted (a photo selected, then scrolled
                    // far past) from the server — so nothing silently drops.
                    const _disp = uploadItemsForDragRef.current || [];
                    const _byId = new Map();
                    for (const di of _disp) if (di && di.id && !di.isSkeleton) _byId.set(di.id, di);
                    let items = selectedIds.map((id) => _byId.get(id)).filter(Boolean);
                    if (items.length < selectedIds.length) {
                      const haveIds = new Set(items.map((it) => it.id));
                      const missing = selectedIds.filter((id) => !haveIds.has(id));
                      try {
                        const resp = await api.post('/media/by-ids', { ids: missing });
                        if (Array.isArray(resp?.items)) items = items.concat(resp.items);
                      } catch (e) {
                        console.warn('[MediaGallery] by-ids backfill failed:', e?.message || e);
                      }
                    }
                    if (items.length === 0) {
                      Alert.alert('Error', 'Could not prepare the selected items');
                      return;
                    }

                    // Download originals in parallel batches of 4 → local file URIs.
                    // Each download retries ONCE so a transient network blip on one
                    // photo doesn't silently drop it from the batch.
                    const downloadOne = async (item) => {
                      const url = getFullUrl(item.rawUrl || item.url);
                      // Default the extension by media TYPE so a video with no stored
                      // filename isn't saved as ".jpg" — that makes iOS infer an image
                      // UTI and share the wrong thing (or silently drop the video).
                      const fallbackName = `shared_${item.id}${item.type === 'video' ? '.mp4' : '.jpg'}`;
                      const safeName = (item.filename || fallbackName).replace(/[^\w.\-]/g, '_');
                      // 'shared_' prefix + id: leaked copies get swept by the
                      // cacheManager background sweep, and two items with the
                      // same filename can't clobber each other's download.
                      const dest = `${FileSystem.cacheDirectory}shared_${item.id}_${safeName}`;
                      for (let attempt = 0; attempt < 2; attempt++) {
                        try {
                          const { uri } = await FileSystem.downloadAsync(url, dest);
                          return { uri, item };
                        } catch (e) {
                          if (attempt === 1) {
                            console.warn('[MediaGallery] download failed for', item.id, e?.message || e);
                            return null;
                          }
                        }
                      }
                      return null;
                    };
                    for (let i = 0; i < items.length; i += 4) {
                      const chunk = items.slice(i, i + 4);
                      const got = await Promise.all(chunk.map(downloadOne));
                      local.push(...got.filter(Boolean));
                    }
                    // Drop the overlay BEFORE presenting the sheet so the spinner
                    // doesn't sit under the native share UI — and let it actually
                    // leave the screen (two committed frames) before the native
                    // presentation, which otherwise can be swallowed.
                    setSharePreparing(false);
                    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

                    if (local.length === 0) {
                      Alert.alert('Error', 'Could not prepare the selected items');
                      return;
                    }

                    // Prefer ONE native share sheet for the whole selection via
                    // react-native-share. We TRY it and only fall back to the
                    // per-photo path if the native module is genuinely missing
                    // (build predates the lib) — so a wrong native-probe can't
                    // strand us on the slow path when the single sheet is usable.
                    let singleSheetDone = false;
                    const RNShare = getRNShare();
                    if (RNShare) {
                      try {
                        // failOnCancel false → a user dismiss resolves quietly
                        // (no throw), so cancelling does NOT trigger the fallback.
                        // Multiple local file:// URIs → ONE OS sheet with all of them.
                        await RNShare.open({
                          urls: local.map((entry) => entry.uri),
                          failOnCancel: false,
                        });
                        singleSheetDone = true;
                      } catch (e) {
                        // Native side unavailable at call time (getEnforcing throw)
                        // or the sheet failed — fall through to per-photo below.
                        console.warn('[MediaGallery] single-sheet share failed, falling back to per-photo:', e?.message || e);
                      }
                    } else if (local.length > 1) {
                      // The ONLY reason a multi-select still prompts once-per-photo:
                      // react-native-share's native module isn't in THIS build. It's
                      // in package.json + autolinkable, so a fresh dev-client build
                      // (EAS) enables the single sheet. Logged so the cause is obvious.
                      console.warn('[MediaGallery] react-native-share native module missing from this build → per-photo fallback. Rebuild the dev client (eas build -p ios --profile development) to enable single-sheet multi-share.');
                    }
                    if (!singleSheetDone) {
                      // Fallback: one expo-sharing sheet per photo. Works, just not
                      // seamless. Present until a build includes react-native-share.
                      for (const entry of local) {
                        await Sharing.shareAsync(entry.uri, {
                          UTI: entry.item.type === 'video' ? 'public.movie' : 'public.image',
                          mimeType: entry.item.type === 'video' ? 'video/mp4' : 'image/jpeg',
                          dialogTitle: local.length > 1 ? `Share (${local.indexOf(entry) + 1} of ${local.length})` : 'Share',
                        });
                      }
                    }
                  } catch (error) {
                    // A real failure (not a dismiss) — worth a line, not an alert.
                    console.warn('[MediaGallery] bulk share failed:', error?.message || error);
                  } finally {
                    bulkShareBusyRef.current = false;
                    setSharePreparing(false);
                    setSharePrepLabel(null);
                    // Delete the cached copies we downloaded just for the share
                    // sheet — otherwise every bulk share leaks originals to disk.
                    for (const entry of local) {
                      try { await FileSystem.deleteAsync(entry.uri, { idempotent: true }); } catch (e) { /* ignore */ }
                    }
                  }
                }}
              >
                <Icon name="share-variant" size={20} color={theme.colors.primary} />
                <Text style={{ color: theme.colors.primary, fontWeight: 'bold', fontSize: 15 }}>
                  Share
                </Text>
              </TouchableOpacity>
              
              <View style={{ width: 1, height: 20, backgroundColor: theme.colors.borderStrong, marginHorizontal: 8 }} />
              
              <TouchableOpacity 
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, opacity: selectedGridItems.size === 0 ? 0.5 : 1 }}
                disabled={selectedGridItems.size === 0}
                onPress={() => {
                  // Calculate exact tag intersection across selected items
                  let commonTags = null;
                  const _disp = uploadItemsForDragRef.current || [];
                  const _byId = new Map();
                  for (const di of _disp) if (di && di.id && !di.isSkeleton) _byId.set(di.id, di);
                  Array.from(selectedGridItems).forEach(id => {
                    const item = _byId.get(id);
                    if (item) {
                      const itemTags = tagsOf(item);
                      if (commonTags === null) commonTags = [...itemTags];
                      else commonTags = commonTags.filter(t => itemTags.includes(t));
                    }
                  });
                  setEditingTags(commonTags || []);
                  setTagInputValue('');
                  setIsBulkTagging(true);
                }}
              >
                <Icon name="tag-multiple" size={20} color={theme.colors.primary} />
                <Text style={{ color: theme.colors.primary, fontWeight: 'bold', fontSize: 15 }}>
                  Tag
                </Text>
              </TouchableOpacity>
              
              <View style={{ width: 1, height: 20, backgroundColor: theme.colors.borderStrong, marginHorizontal: 8 }} />
              
              <TouchableOpacity 
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, opacity: selectedGridItems.size === 0 ? 0.5 : 1 }}
                disabled={selectedGridItems.size === 0}
                onPress={() => {
                  Alert.alert(
                    'Delete Selected',
                    `Delete ${selectedGridItems.size} selected items?`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { 
                        text: 'Delete',
                        style: 'destructive',
                        onPress: () => {
                          // Optimistic bulk delete: clear the items + selection
                          // from the UI instantly, then fire the deletes (6 in
                          // flight) in the background. Any that fail are restored
                          // to their original positions.
                          const ids = Array.from(selectedGridItems);
                          const idSet = new Set(ids);
                          const prevList = uploadItemsForDragRef.current || [];
                          const removed = []; // { item, idx } for rollback
                          prevList.forEach((it, idx) => { if (it && idSet.has(it.id)) removed.push({ item: it, idx }); });

                          setUploadItems(prev => prev.filter(item => !idSet.has(item.id)));
                          setIsSelectMode(false);
                          setSelectedGridItems(new Set());
                          setRangeSelectMode(false);
                          setRangeAnchorIdx(null);
                          rangeAnchorRef.current = null;

                          (async () => {
                            const failed = [];
                            for (let i = 0; i < ids.length; i += 6) {
                              const batch = ids.slice(i, i + 6);
                              const results = await Promise.all(batch.map(id =>
                                api.delete(`/media/${id}`).then(() => null).catch(() => id)
                              ));
                              for (const r of results) if (r) failed.push(r);
                            }
                            if (failed.length) {
                              const failedSet = new Set(failed);
                              const toRestore = removed
                                .filter(r => failedSet.has(r.item.id))
                                .sort((a, b) => a.idx - b.idx);
                              setUploadItems(prev => {
                                const next = prev.slice();
                                for (const { item, idx } of toRestore) {
                                  if (next.some(it => it && it.id === item.id)) continue;
                                  next.splice(Math.min(Math.max(idx, 0), next.length), 0, item);
                                }
                                return next;
                              });
                              Alert.alert('Some items not deleted', `${failed.length} item(s) could not be deleted and were restored.`);
                            }
                          })();
                        }
                      }
                    ]
                  );
                }}
              >
                <Icon name="trash-can-outline" size={20} color="#DC2626" />
                <Text style={{ color: '#DC2626', fontWeight: 'bold', fontSize: 15 }}>
                  Delete
                </Text>
              </TouchableOpacity>
            </Animated.View>
            </View>
          ) : (
            <Animated.View style={[styles.selectBezel, {
              borderRadius: 20, padding: 16, width: '100%',
            }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <TouchableOpacity onPress={() => setIsBulkTagging(false)}>
                  <Icon name="close" size={24} color={theme.colors.textSecondary} />
                </TouchableOpacity>
                <Text style={{ color: theme.colors.primary, fontWeight: '600' }}>Tagging {selectedGridItems.size} Items</Text>
                <TouchableOpacity onPress={executeBulkTagSave}>
                  <Text style={{ color: theme.colors.primary, fontWeight: 'bold', fontSize: 16 }}>Save</Text>
                </TouchableOpacity>
              </View>

              <View style={[styles.chipInputContainer, { borderColor: theme.colors.border, minHeight: 44, marginBottom: 8 }]}>
                {editingTags.map((tag, index) => (
                  <View key={index} style={[styles.chip, { backgroundColor: theme.colors.primary, paddingVertical: 4 }]}>
                    <Text style={styles.chipText}>{tag}</Text>
                    <TouchableOpacity onPress={() => setEditingTags(prev => prev.filter((_, i) => i !== index))}>
                      <Icon name="close-circle" size={16} color={theme.colors.background} />
                    </TouchableOpacity>
                  </View>
                ))}
                <TextInput
                  style={[styles.chipTextInput, { color: theme.colors.textPrimary, paddingVertical: 0, margin: 0, height: 28 }]}
                  value={tagInputValue}
                  onChangeText={(text) => {
                    if (text.includes(',')) {
                      const newTags = text.split(',').map(t => t.trim()).filter(Boolean);
                      if (newTags.length > 0) setEditingTags(prev => Array.from(new Set([...prev, ...newTags])));
                      setTagInputValue('');
                    } else { setTagInputValue(text); }
                  }}
                  onKeyPress={({ nativeEvent }) => {
                    if (nativeEvent.key === 'Backspace' && tagInputValue === '' && editingTags.length > 0) {
                      setEditingTags(prev => prev.slice(0, -1));
                    }
                  }}
                  onSubmitEditing={() => {
                    if (tagInputValue.trim()) {
                      setEditingTags(prev => Array.from(new Set([...prev, tagInputValue.trim()])));
                      setTagInputValue('');
                    }
                  }}
                  placeholder={editingTags.length === 0 ? "Type tag..." : ""}
                  placeholderTextColor={theme.colors.textMuted}
                  returnKeyType="done"
                  autoCapitalize="words"
                />
              </View>

              {tagInputValue.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" style={styles.scrollHorizontal}>
                  {globalAlbums.filter(a => a.toLowerCase().includes(tagInputValue.toLowerCase())).map(album => (
                    <TouchableOpacity
                      key={album} style={[styles.quickSelectChip, { borderWidth: 1, borderColor: theme.colors.border }]}
                      onPress={() => {
                        setEditingTags(prev => prev.includes(album) ? prev : [...prev, album]);
                        setTagInputValue('');
                      }}
                    >
                      <Text style={{ color: theme.colors.textPrimary }}>{album}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" style={styles.scrollHorizontal}>
                  {pinnedAlbums.map(album => (
                    <TouchableOpacity
                      key={album} style={[styles.quickSelectChip, editingTags.includes(album) && { backgroundColor: theme.colors.primary }]}
                      onPress={() => {
                        setEditingTags(prev => prev.includes(album) ? prev.filter(t => t !== album) : [...prev, album]);
                      }}
                    >
                      <Text style={[styles.quickSelectText, editingTags.includes(album) && { color: theme.colors.background }]}>{album}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
            </Animated.View>
          )}
        </KeyboardAvoidingView>
      )}

      {/* Pre-Upload Album Selection Modal (Draggable Bottom-Sheet Style) */}
      <Modal 
        visible={uploadModalVisible}
        transparent={true}
        animationType="none"
        onShow={() => {
          // Ensure modal is reset when shown
          uploadModalY.stopAnimation();
          uploadModalY.setValue(0);
        }}
      >
        {/* Plain View, not KeyboardAvoidingView: the card lifts clear of the
            keyboard via uploadKeyboardLift on the wrapper below — the same
            UI-thread, frame-locked motion the Turtle chat composer uses. */}
        <View style={styles.uploadModalOverlay}>
          {/* Background dimmer - tap to dismiss */}
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={dismissUploadModal}
          />
          {/* Keyboard-lift wrapper. box-none so it only catches touches on the
              card itself and the dimmer behind stays tappable. */}
          <Reanimated.View pointerEvents="box-none" style={uploadKeyboardLift}>
          <Animated.View
            onLayout={(e) => { uploadCardH.value = e.nativeEvent.layout.height; }}
            style={[
              styles.uploadModalContent,
              {
                backgroundColor: theme.colors.surfaceElevated,
                transform: [{ translateY: uploadModalY }]
              }
            ]}
            {...uploadPanResponder.panHandlers}
          >
            <View style={{ width: 40, height: 5, backgroundColor: theme.colors.border, borderRadius: 3, alignSelf: 'center', marginBottom: 16 }} />

            <Text style={[styles.uploadModalTitle, { color: theme.colors.textPrimary, marginTop: 0 }]}>
              Upload {pendingAssets.length} Item{pendingAssets.length > 1 ? 's' : ''}
            </Text>
            
            <Text style={[styles.uploadModalLabel, { color: theme.colors.textSecondary }]}>Save to Album:</Text>
            
            <View style={[styles.chipInputContainer, { borderColor: theme.colors.border }]}>
              {selectedTags.map((tag, index) => (
                <View key={index} style={[styles.chip, { backgroundColor: theme.colors.primary }]}>
                  <Text style={styles.chipText}>{tag}</Text>
                  <TouchableOpacity onPress={() => setSelectedTags(selectedTags.filter((_, i) => i !== index))}>
                    <Icon name="close-circle" size={16} color={theme.colors.background} />
                  </TouchableOpacity>
                </View>
              ))}
              <TextInput
                style={[styles.chipTextInput, { color: theme.colors.textPrimary }]}
                value={tagInputValue}
                onChangeText={(text) => {
                  if (text.includes(',')) {
                    const newTags = text.split(',').map(t => t.trim()).filter(Boolean);
                    if (newTags.length > 0) {
                      setSelectedTags(prev => Array.from(new Set([...prev, ...newTags])));
                    }
                    setTagInputValue('');
                  } else {
                    setTagInputValue(text);
                  }
                }}
                onKeyPress={({ nativeEvent }) => {
                  if (nativeEvent.key === 'Backspace' && tagInputValue === '' && selectedTags.length > 0) {
                    setSelectedTags(prev => prev.slice(0, -1));
                  }
                }}
                placeholder={selectedTags.length === 0 ? "Type tags, comma to add..." : ""}
                placeholderTextColor={theme.colors.textMuted}
                autoCapitalize="words"
                blurOnSubmit={true}
                onSubmitEditing={() => Keyboard.dismiss()}
                inputAccessoryViewID="uploadTagInputAccessory"
              />
            </View>

            {tagInputValue.length > 0 && (
              <View style={styles.tagAutocompleteContainer}>
                <Text style={[styles.tagAutocompleteLabel, { color: theme.colors.textMuted }]}>
                  Matching tags:
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" style={styles.tagAutocompleteScroll}>
                  {globalAlbums
                    .filter(album => album.toLowerCase().includes(tagInputValue.toLowerCase()))
                    .sort((a, b) => {
                      const aActive = selectedTags.includes(a);
                      const bActive = selectedTags.includes(b);
                      if (aActive && !bActive) return -1;
                      if (!aActive && bActive) return 1;
                      return a.localeCompare(b);
                    })
                    .map(album => (
                      <TouchableOpacity 
                        key={album} 
                        style={[
                          styles.tagAutocompleteChip,
                          selectedTags.includes(album) && { backgroundColor: theme.colors.primary }
                        ]}
                        onPress={() => {
                          // Keep the keyboard up so the user can keep typing the
                          // next tag; selection is instant local state.
                          setSelectedTags(prev => prev.includes(album) ? prev : [...prev, album]);
                          setTagInputValue('');
                        }}
                      >
                        <Text style={[
                          styles.tagAutocompleteChipText,
                          selectedTags.includes(album) && { color: theme.colors.background }
                        ]}>
                          {album}
                        </Text>
                      </TouchableOpacity>
                    ))}
                </ScrollView>
              </View>
            )}

            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" style={styles.quickSelectScroll}>
              {globalAlbums.map(album => (
                <TouchableOpacity
                  key={album}
                  style={[styles.quickSelectChip, selectedTags.includes(album) && { backgroundColor: theme.colors.primary }]}
                  onPress={() => {
                    setSelectedTags(prev => prev.includes(album) ? prev.filter(t => t !== album) : [...prev, album]);
                  }}
                >
                  <Text style={[styles.quickSelectText, selectedTags.includes(album) && { color: theme.colors.background }]}>{album}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            
            <View style={styles.uploadModalButtons}>
              <TouchableOpacity
                style={[styles.uploadModalButton, { backgroundColor: theme.colors.surface }]}
                onPress={dismissUploadModal}
              >
                <Text style={{ color: theme.colors.textPrimary }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.uploadModalButton, { backgroundColor: theme.colors.primary, opacity: uploadBusy ? 0.6 : 1 }]}
                onPress={executeUpload}
                disabled={uploadBusy}
              >
                <Text style={{ color: theme.colors.background, fontWeight: 'bold' }}>
                  {uploadBusy ? 'Upload running…' : 'Upload Now'}
                </Text>
              </TouchableOpacity>
            </View>
            {/* Progress, the run-in-background pill, and the delete-originals
                prompt all live in the GLOBAL VaultUploadPill now — confirming
                here closes this modal instantly and the pill takes over. */}
          </Animated.View>
          </Reanimated.View>
        </View>
      </Modal>

      {/* Keyboard Dismiss Button (iOS only) */}
      {Platform.OS === 'ios' && (
        <InputAccessoryView nativeID="uploadTagInputAccessory">
          <View style={[styles.keyboardAccessoryContainer, { backgroundColor: theme.colors.surfaceElevated }]}>
            <TouchableOpacity onPress={() => Keyboard.dismiss()} style={styles.keyboardAccessoryButton}>
              <Text style={[styles.keyboardAccessoryText, { color: theme.colors.primary }]}>Done</Text>
            </TouchableOpacity>
          </View>
        </InputAccessoryView>
      )}

      {/* 1. Main Content Area - Native Swipeable Pages */}
      <View style={StyleSheet.absoluteFill}>
        <Animated.ScrollView
          ref={pagesScrollRef}
          horizontal
          pagingEnabled
          bounces={false}
          showsHorizontalScrollIndicator={false}
          // The pager only ever holds Boards and Music now, and the photos page
          // covers it when open, so paging is always free here.
          scrollEnabled
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { x: pageScrollX } } }],
            { useNativeDriver: true }
          )}
          scrollEventThrottle={16}
          onScrollEndDrag={handlePageSwipeDragEnd}
          onMomentumScrollEnd={handlePageSwipeEnd}
          style={{ flex: 1, flexDirection: 'row' }}
        >
          

          {/* PAGE 1: BOARDS */}
          <View style={{ width, height: '100%' }}>
            {/* Indeterminate loading bar — a 3px monotone segment slides across
                in a loop since the album fetch has no byte-level progress to
                drive. Monochrome, keyed to the theme (white on dark, black on
                light) so it stays visible in both — the old hardcoded white
                vanished against the light background. Pinned just below the
                safe-area inset; only mounted while a fetch is in flight. */}
            {isAlbumsLoading && (
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  top: insets.top,
                  left: 0,
                  right: 0,
                  height: 3,
                  backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)',
                  overflow: 'hidden',
                  zIndex: 1000,
                }}
              >
                <Animated.View
                  style={{
                    height: 3,
                    width: '35%',
                    backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.85)',
                    transform: [{
                      translateX: albumsLoadingAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [-width * 0.35, width],
                      }),
                    }],
                  }}
                />
              </View>
            )}
            <PhotoVaultBoardsPage
              ref={albumsRef}
              boards={boardModels}
              allPhotos={allPhotosBoard}
              onOpenAllPhotos={openAllPhotos}
              loading={isAlbumsLoading}
              error={albumsLoadError}
              hasLoadedAlbums={hasLoadedAlbums}
              query={albumSearchQuery}
              sortMode={boardSortMode}
              theme={theme}
              topInset={vaultHeaderH || insets.top + 90}
              resolveCoverUrl={getFullUrl}
              onQueryChange={setAlbumSearchQuery}
              onSortModeChange={setBoardSortMode}
              onAdd={handleUpload}
              onRetry={fetchAlbums}
              onOpenBoard={openPhotosPage}
              onLongPressBoard={showAlbumOptions}
              onOpenShareInsights={setInsightsAlbumName}
              onScroll={handleAlbumsScroll}
              onContentSizeChange={(w, h) => {
                albumsContentH.current = h;
                albumsMaxScrollSv.value = Math.max(1, h - (albumsLayoutH.current || 1));
              }}
              onLayout={(event) => {
                albumsLayoutH.current = event.nativeEvent.layout.height;
                albumsMaxScrollSv.value = Math.max(
                  1,
                  (albumsContentH.current || 1) - albumsLayoutH.current,
                );
              }}
            />
          </View>

          {/* PAGE 2: MUSIC — the audio slice of the same vault. It used to be a
              destination on a chooser screen; as a pager page it's one swipe
              from Boards. No onClose: there's nothing to go back to from a tab. */}
          <View style={{ width, height: '100%' }}>
            {/* Clear the vault header by its MEASURED height plus the same gap
                the Boards page leaves under the picker, so the two pages start
                at the same line and no track card slides under the tabs. */}
            <MusicVault
              topInset={(vaultHeaderH || insets.top + 90) + VAULT_PICKER_GAP}
              bottomInset={tabBarH}
            />
          </View>

        </Animated.ScrollView>

        {/* Boards A-Z rail. The photo timeline's rail lives on the photos page
            itself (it is covered by that page when open), so this instance is
            always the alphabetical, top-down Boards one. */}
        {albumsScrubEnabled && (
          <TimelineScrubber
            scrollY={albumsScrollYSv}
            maxScroll={albumsMaxScrollSv}
            data={albumsScrubData}
            onJump={handleAlbumsScrubJump}
            inverted={false}
            topInset={(vaultHeaderH || insets.top + 54) + 8}
            bottomInset={Math.max(insets.bottom + 64, tabBarH + 24)}
            accent={theme.colors.primary}
            dark={theme.mode === 'dark'}
          />
        )}

      </View>

      {/* PHOTOS PAGE — the board's contents as a pushed page over the pager.
          overlay mode (not the Modal form) is required: the grid opens the
          viewer, the local picker and the share sheet as Modals, and iOS will
          not present a sibling Modal over an already-open one.

          The zIndex is load-bearing. The vault header (zIndex 20) and the notch
          shield (zIndex 30) are LATER siblings in this same container, so
          without it they paint over the page: you'd see the base header sitting
          on top of the page with the page's own header buried under it.
          box-none on the wrapper so that, when the page is closed and
          EdgeSwipePage renders nothing, this full-screen View doesn't swallow
          taps meant for the pager beneath. */}
      <View style={[StyleSheet.absoluteFillObject, { zIndex: 40 }]} pointerEvents="box-none">
      <EdgeSwipePage overlay visible={photosOpen} onClose={closePhotosPage} swipeEnabled={!isSelectMode}>
        <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
          {/* Photos page header — the board title, its edit menu and the photo
              actions that used to sit in the vault header. Same styling; the
              left slot is now the page-back affordance for this pushed page. */}
          <View
            style={[
              styles.floatingHeaderContainer,
              {
                paddingTop: insets.top,
                backgroundColor: theme.colors.background,
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: theme.colors.border,
                zIndex: 20,
              },
            ]}
          >
          {/* Top Row: Title & Actions (Compact) */}
          <View style={[styles.header, { height: 44, paddingHorizontal: 16 }]}>
            {/* Back out of the pushed page — the tap equivalent of the
                left-edge swipe EdgeSwipePage provides. Deliberately NOT in the
                fixed 70pt headerLeft slot: that slot exists to keep a centred
                title centred, and it would strand the caret far from the board
                name. Here the caret reads as part of the title. */}
            <TouchableOpacity
              onPress={closePhotosPage}
              style={styles.headerBackInline}
              hitSlop={HIT_SLOP_10}
              accessibilityRole="button"
              accessibilityLabel="Back to boards"
            >
              <Icon name="chevron-left" size={28} color={theme.colors.textPrimary} />
            </TouchableOpacity>
  
            {/* Title — the open board's name, sitting directly after the caret.
                Falls back to "All Photos" for the unfiltered library. */}
            <View style={styles.headerTitleSlot}>
              {selectedAlbum !== 'All' ? (
                // Board detail header: name + live metadata (count / latest) with
                // the board's edit menu (rename / delete) one tap away — the same
                // context menu the Boards overview uses on long-press.
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ flexShrink: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                      <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]} numberOfLines={1}>
                        {selectedAlbum}
                      </Text>
                      {/* Published-state cue. Deliberately a small tinted globe
                          rather than a badge or a pill: it must be noticeable
                          when you look for it and silent when you don't. Tapping
                          it opens the same board menu, where the link lives. */}
                      {selectedAlbumIsLive && (
                        <TouchableOpacity
                          onPress={() => showAlbumOptions(selectedAlbum)}
                          hitSlop={HIT_SLOP_10}
                          accessibilityRole="button"
                          accessibilityLabel={`${selectedAlbum} is live on the web. Open board options`}
                        >
                          <Icon
                            name="web"
                            size={14}
                            color={theme.colors.accentSuccess || theme.colors.accentInfo}
                          />
                        </TouchableOpacity>
                      )}
                    </View>
                    {!!albumCounts[selectedAlbum] && (
                      <Text style={{ fontSize: 11.5, color: theme.colors.textTertiary, marginTop: 1 }} numberOfLines={1}>
                        {/* While filtered, the count says so — otherwise a
                            board that shows 12 of its 87 photos looks broken. */}
                        {filtersDirty && uploadDisplayItems.length !== albumCounts[selectedAlbum]
                          ? `${uploadDisplayItems.length} of ${albumCounts[selectedAlbum]} items`
                          : `${albumCounts[selectedAlbum]} item${albumCounts[selectedAlbum] === 1 ? '' : 's'}`}
                        {albumLatestDates[selectedAlbum]
                          ? ` · ${new Date(albumLatestDates[selectedAlbum]).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`
                          : ''}
                        {selectedAlbumIsLive ? ' · ' : ''}
                        {selectedAlbumIsLive ? (
                          <Text style={{ color: theme.colors.accentSuccess || theme.colors.accentInfo }}>
                            on the web
                          </Text>
                        ) : null}
                      </Text>
                    )}
                  </View>
                  <TouchableOpacity
                    onPress={() => showAlbumOptions(selectedAlbum)}
                    hitSlop={HIT_SLOP_10}
                    accessibilityLabel={`Edit board ${selectedAlbum}`}
                  >
                    <Icon name="dots-horizontal-circle-outline" size={20} color={theme.colors.textMuted} />
                  </TouchableOpacity>
                </View>
              ) : (
                // Reached by opening the unfiltered library rather than a named
                // board — it's still a board's page, so it gets a board's title.
                <Text style={[styles.headerTitleLarge, { color: theme.colors.textPrimary }]} numberOfLines={1}>
                  <Text style={{ fontWeight: '100' }}>All </Text>
                  <Text style={{ fontWeight: '400' }}>Photos</Text>
                </Text>
              )}
            </View>
  
            <View style={[styles.headerRight, { justifyContent: 'center' }]}>
              {/* Uploads Action: Search & Select Buttons */}
              {/* Plain View, not Animated: these used to cross-fade with the
                  pager because the grid was a pager page. On its own page they
                  are simply always present. */}
              <View style={{
                position: 'absolute', right: 0,
                flexDirection: 'row', alignItems: 'center', gap: 16,
              }}>
                {/* Filter & arrange. This replaced a bare icon that flipped
                    between a camera and a clock: it changed the grid's order
                    with no word anywhere saying so, and read as a camera
                    button. Search folded in with it — one control for "what am
                    I looking at", rather than three unlabelled glyphs.
                    Long-press lands straight in the search field, so the most
                    common action still costs one gesture. */}
                <TouchableOpacity
                  testID="gallery-filter-toggle"
                  onPress={() => { setFilterSheetFocusSearch(false); setIsFilterSheetOpen(true); }}
                  onLongPress={() => { impactHaptic('medium'); setFilterSheetFocusSearch(true); setIsFilterSheetOpen(true); }}
                  delayLongPress={280}
                  hitSlop={HIT_SLOP_10}
                  accessibilityRole="button"
                  accessibilityLabel={filtersDirty
                    ? 'Filter and arrange. Filters are active. Long-press to search.'
                    : 'Filter and arrange. Long-press to search.'}
                >
                  <View>
                    <Icon
                      name="tune-variant"
                      size={24}
                      color={filtersDirty ? theme.colors.primary : theme.colors.textPrimary}
                    />
                    {/* Active-state dot. Density changes deliberately don't
                        light it — badging a viewing preference cries wolf. */}
                    {filtersDirty && (
                      <View style={{
                        position: 'absolute', top: -1, right: -2,
                        width: 7, height: 7, borderRadius: 4,
                        backgroundColor: theme.colors.primary,
                        borderWidth: 1.5, borderColor: theme.colors.background,
                      }} />
                    )}
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="gallery-select-toggle"
                  onPress={() => {
                    if (isSelectMode) { setIsSelectMode(false); setIsBulkTagging(false); setSelectedGridItems(new Set()); setRangeSelectMode(false); setRangeAnchorIdx(null); rangeAnchorRef.current = null; }
                    else { setIsSelectMode(true); }
                  }}
                  hitSlop={HIT_SLOP_10}
                >
                  <Text style={{ color: theme.colors.primary, fontWeight: '600', fontSize: 15, letterSpacing: -0.3 }}>
                    {isSelectMode ? 'Cancel' : 'Select'}
                  </Text>
                </TouchableOpacity>
              </View>

            </View>
          </View>
  
          {/* Photos search */}
          <Animated.View style={{
            height: isUploadsSearchVisible ? 'auto' : 0,
            opacity: uploadsSearchAnim,
            overflow: 'hidden',
            marginHorizontal: 16,
            marginBottom: isUploadsSearchVisible ? 8 : 0,
            transform: [{
              translateY: uploadsSearchAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [-20, 0]
              })
            }]
          }}>
            <View style={[styles.searchContainer, { 
              backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
              borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, flexDirection: 'row', alignItems: 'center' 
            }]}>
              <Icon name="magnify" size={18} color={theme.colors.textMuted} />
              <TextInput
                ref={searchInputRef}
                style={{ flex: 1, marginLeft: 6, color: theme.colors.textPrimary, fontSize: 15, padding: 0 }}
                value={uploadsSearchQuery}
                onChangeText={setUploadsSearchQuery}
                placeholder="Search photos, tags, text…"
                placeholderTextColor={theme.colors.textMuted}
                // Never steals focus: this bar now appears BECAUSE a query
                // exists, and the query is usually being typed in the sheet.
                autoFocus={false}
              />
              {/* Jump — leave the filter and scroll the full timeline to where this
                  tag clusters in time (uploads tab only, when a tag is typed). */}
              {activeTab === 'uploads' && uploadsSearchQuery.trim() !== '' && (
                <TouchableOpacity
                  onPress={handleLocateTag}
                  disabled={jumpBusy}
                  hitSlop={HIT_SLOP_10}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginRight: 8 }}
                  accessibilityLabel={`Jump to where ${uploadsSearchQuery.trim()} clusters in the timeline`}
                >
                  {jumpBusy ? (
                    <ActivityIndicator size="small" color={theme.colors.primary} />
                  ) : (
                    <>
                      <Icon name="calendar-search" size={16} color={theme.colors.primary} />
                      <Text style={{ color: theme.colors.primary, fontSize: 12, fontWeight: '700' }}>Jump</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => {
                setUploadsSearchQuery('');
                setIsUploadsSearchVisible(false);
              }}>
                <Icon name="close-circle" size={18} color={theme.colors.textMuted} />
              </TouchableOpacity>
            </View>
          </Animated.View>
  
          </View>

            <Animated.View
              style={{ width, height: '100%' }}
            >
              {/* Drag-select responder wraps ONLY the uploads grid: horizontal
                  drags (in select mode, started on a cell) range-select;
                  vertical swipes pass through and scroll normally. The
                  GestureDetector adds two-finger pinch → column count (needs two
                  pointers, so it never fights the one-finger pan/scroll). */}
              <GestureDetector gesture={gridPinch}>
              {/* overflow:hidden clips the grid while it's scaled past the
                  viewport — without it the enlarged cells paint over the header
                  and the tab bar mid-pinch. */}
              <View ref={gridWrapRef} style={{ flex: 1, overflow: 'hidden' }} {...gridDragResponder.panHandlers}>
              <Reanimated.View style={[{ flex: 1 }, gridPinchStyle]}>
              <AnimatedFlashList
                ref={gridRef}
                data={uploadDisplayItems}
                // Stable reference + extraData (see renderItem's performance
                // contract). The old inline arrow handed FlashList a NEW
                // renderItem on every render of this component — every page
                // land, progress tick, or selection toggle re-rendered every
                // visible cell. (Its injected activeTab prop was never read.)
                renderItem={renderItem}
                extraData={gridSelectionExtra}
                // SLOT KEYS: in the virtual library a key identifies the
                // POSITION (the i-th newest photo) — a fixed slot in a
                // fixed-length array — not the item that fills it. When a sparse
                // page lands, the mounted cell keeps its key and re-renders with
                // its image fading in over the quiet tile; with id-keys it was
                // unmounted and replaced (the erratic pop-in). Outside virtual
                // mode (album filter / tag search) items keep id keys.
                // (The old getItemType skel/thumb pool split is gone: it existed
                // because the skeleton early-returned ABOVE GridItem's hooks —
                // the unified cell has one unconditional shape, one pool.)
                keyExtractor={(item, index) => ((virtualEnabledRef.current || item.isSkeleton) ? `i${index}` : item.id)}
                numColumns={gridCols}
                // Mount + start loading cells ~1.5 screens beyond the viewport so
                // tiles resolve BEFORE they scroll into view (the iCloud feel),
                // instead of FlashList's default ~250px overdraw.
                drawDistance={Math.round(height * 1.5)}
                // Drag-to-dismiss the keyboard when scrolling the grid
                // while the per-tab search input is up.
                keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
                keyboardShouldPersistTaps="handled"
                // --- DOUBLE-FLIP WORKAROUND ---
                // scaleY(-1): inverts vertically so newest sits at the BOTTOM
                // (load-newest-first pagination, scroll up for older — standard
                // photo-app vertical order).
                // scaleX(-1): ALSO mirror horizontally so within each row reading
                // goes OLD→NEW left-to-right and the newest photo lands
                // BOTTOM-RIGHT — i.e. the whole grid reads in English order
                // (oldest top-left → newest bottom-right), like every other photo
                // app. Each cell + the header/footer carry a matching scaleX(-1)
                // counter-flip (see renderItem / ListHeader / ListFooter) so only
                // the cell POSITIONS mirror, not their contents. The drag-select
                // column math (applyDragRange) negates its X delta to match.
                style={{ flex: 1, transform: [{ scaleX: -1 }, { scaleY: -1 }] }}
                // ------------------------------
                // FlashList v2 turns on maintainVisibleContentPosition by DEFAULT
                // (a chat-style feature). On this scaleY(-1)-inverted grid its
                // re-anchor math runs in un-flipped coords while the view is
                // visually flipped — so when a thumbnail finishes loading and the
                // cell re-measures, MVCP shoves the item the WRONG way and it
                // lands offset, overlapping its neighbours. A photo grid never
                // needs MVCP → disable it to kill the load-time offset.
                maintainVisibleContentPosition={{ disabled: true }}
                // Inverted grid: paddingTop is the VISUAL BOTTOM. It reserves the
                // floating tab bar's height so the newest row can be scrolled
                // clear of the bar — a photo permanently pinned under it could
                // never be tapped, which is the whole point of the underlay
                // being allowed only on scrollable content.
                contentContainerStyle={[styles.gridContent, { paddingBottom: insets.top + 90, paddingTop: Math.max(insets.bottom + 16, tabBarH + 16) }]}
                showsVerticalScrollIndicator={false}
                onRefresh={handleRefresh}
                refreshing={refreshing}
                onEndReached={handleLoadMore}
                onEndReachedThreshold={2.5}
                // Feed the timeline scrubber: thumb position, month/year bubble,
                // and the scroll range it maps drags onto.
                onScroll={handleGridScroll}
                // Settle triggers — resolve the resting viewport the moment
                // motion ends (drag release or momentum death), instead of
                // waiting for the next touch to generate a scroll event.
                onScrollEndDrag={handleGridScrollSettled}
                onMomentumScrollEnd={handleGridScrollSettled}
                scrollEventThrottle={16}
                // Track the centermost video for the autoplay preview (committed
                // on settle by handleGridScrollSettled).
                onViewableItemsChanged={onViewableItemsChanged}
                viewabilityConfig={viewabilityConfig}
                onContentSizeChange={(w, h) => {
                  gridContentH.current = h;
                  maxScrollSv.value = Math.max(1, h - (gridLayoutH.current || 1));
                  // Consume a pending tag-jump now that the FULL timeline has laid
                  // out (this fires with the virtual content height, so the fraction
                  // maps to a real offset). virtualEnabledRef guards against firing
                  // while still filtered; defer the scroll one frame so it runs
                  // cleanly outside the layout pass.
                  if (pendingJumpRef.current != null && virtualEnabledRef.current) {
                    const frac = pendingJumpRef.current;
                    pendingJumpRef.current = null;
                    if (pendingJumpClearRef.current) { clearTimeout(pendingJumpClearRef.current); pendingJumpClearRef.current = null; }
                    requestAnimationFrame(() => handleScrubJump(frac));
                  }
                }}
                onLayout={(e) => {
                  const lh = e.nativeEvent.layout.height;
                  gridLayoutH.current = lh;
                  maxScrollSv.value = Math.max(1, (gridContentH.current || 1) - lh);
                }}
                ListEmptyComponent={(!loading && !isPaginating && !refreshing) ? renderEmpty : null}
                ListHeaderComponent={
                  <View style={{ transform: [{ scaleX: -1 }, { scaleY: -1 }] }}>
                    <View style={[styles.bottomContainer, { paddingBottom: 16 }]}>
                    <View style={styles.countContainer}>
                      <Text style={[styles.countText, { color: theme.colors.textSecondary }]}>
                        {activeTab === 'uploads' && globalUploadsTotal > 0
                          ? `${globalUploadsTotal.toLocaleString()} Items`
                          : photoCount > 0 && videoCount > 0
                            ? `${photoCount} Photos, ${videoCount} Videos`
                            : photoCount > 0 ? `${photoCount} ${photoCount === 1 ? 'Photo' : 'Photos'}`
                            : videoCount > 0 ? `${videoCount} ${videoCount === 1 ? 'Video' : 'Videos'}`
                            : '—'
                        }
                      </Text>
                    </View>
                    <View style={{ alignItems: 'center', width: '100%', marginTop: 8 }}>
                      <View style={{ flexDirection: 'row', gap: 12, width: '100%' }}>
                        <TouchableOpacity style={[styles.actionButton, { flex: 1, backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)' }]} onPress={handleUpload} disabled={uploadBusy} activeOpacity={0.7}>
                          <View style={[styles.actionButtonIcon, { backgroundColor: theme.colors.primary + '20' }]}><Icon name="image-plus" size={18} color={theme.colors.primary} /></View>
                          <Text style={[styles.actionButtonText, { color: theme.colors.textPrimary }]}>Upload</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.actionButton, { flex: 1, backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)' }]} onPress={openLocalSyncGallery} disabled={uploadBusy} activeOpacity={0.7}>
                          <View style={[styles.actionButtonIcon, { backgroundColor: theme.colors.primary + '20' }]}><Icon name="folder-sync" size={18} color={theme.colors.primary} /></View>
                          <Text style={[styles.actionButtonText, { color: theme.colors.textPrimary }]}>Smart Sync</Text>
                        </TouchableOpacity>
                      </View>
                      {/* Live progress lives in the global VaultUploadPill. */}
                    </View>
                  </View>
                  </View>
                }
                ListFooterComponent={
                  <View style={{ transform: [{ scaleX: -1 }, { scaleY: -1 }] }}>
                    <View style={{ paddingTop: 16 }}>
                      {isPaginating && hasMoreUploads && (
                        <View style={styles.phantomSkeletonContainer}>
                          {[...Array(6)].map((_, i) => <ShimmerSkeleton key={`header-skel-${i}`} styles={styles} theme={theme} />)}
                        </View>
                      )}
                    </View>
                  </View>
                }
              />
              </Reanimated.View>
              </View>
              </GestureDetector>
  
            </Animated.View>
          {/* Photos scrubber — the base tree keeps its own instance for the
              Boards A-Z rail; this page is covered by the overlay, so it needs
              its own rail wired to the grid's shared values. */}
          {scrubEnabled && (
            <TimelineScrubber
              scrollY={scrollYSv}
              maxScroll={maxScrollSv}
              data={scrubberData}
              onJump={handleScrubJump}
              inverted
              topInset={(vaultHeaderH || insets.top + 54) + 8}
              // The rail's grab area has to end above the tab bar, or its lowest
              // stretch (newest photos) is untouchable.
              bottomInset={Math.max(insets.bottom + 64, tabBarH + 24)}
              accent={theme.colors.primary}
              dark={theme.mode === 'dark'}
            />
          )}

          {/* Jump-to-newest pill — bottom-CENTRE so it clears the right-edge
              scrubber. Only on the Photos tab; fades IN once scrolled a long way
              from the newest item and fades OUT when back near it (no abrupt pop).
              Tapping animates back to offset 0 (the visual bottom). */}
          {activeTab === 'uploads' && (
            <Animated.View
              pointerEvents={gridJumpVisible ? 'auto' : 'none'}
              style={{
                position: 'absolute',
                // Clears the floating tab bar — a pinned control under it can't
                // be tapped and can't be scrolled away from.
                bottom: Math.max(insets.bottom + 24, tabBarH + 12),
                alignSelf: 'center',
                opacity: gridJumpAnim,
                transform: [{ scale: gridJumpAnim.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }],
                zIndex: 60,
              }}
            >
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => {
                gridJumpingRef.current = true; // suppress re-show during the animation
                if (gridJumpIdleTimer.current) { clearTimeout(gridJumpIdleTimer.current); gridJumpIdleTimer.current = null; }
                try { gridRef.current?.scrollToOffset?.({ offset: 0, animated: true }); } catch (e) { /* mid-layout */ }
                setShowGridJump(false);
              }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingVertical: 9,
                paddingHorizontal: 16,
                borderRadius: 22,
                backgroundColor: theme.colors.primary,
                shadowColor: '#000',
                shadowOpacity: 0.3,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 3 },
                elevation: 6,
              }}
            >
              <Icon name="chevron-double-down" size={18} color={theme.colors.background} />
              <Text style={{ color: theme.colors.background, fontSize: 13, fontWeight: '700' }}>Latest</Text>
            </TouchableOpacity>
            </Animated.View>
          )}

          {/* Filter & arrange. IN-TREE, inside the photos page — a sibling
              <Modal> over this already-presented EdgeSwipePage overlay renders
              nothing at all on iOS. */}
          <GalleryFilterSheet
            visible={isFilterSheetOpen}
            theme={theme}
            filters={filters}
            chips={filterChips}
            isDirty={filtersDirty}
            facets={facets}
            resultCount={uploadDisplayItems.length}
            totalCount={selectedAlbum === 'All'
              ? (uploadTimeline.total || globalUploadsTotal)
              : albumCounts[selectedAlbum]}
            autoFocusSearch={filterSheetFocusSearch}
            // Clear the floating dock, not just the home indicator. This was
            // reserving insets.bottom only, so the dock sat over the tail of
            // the sheet and ate the LAYOUT row. tabBarH is dockOccupied() —
            // card + float gap + inset — and is 0 outside a tab (share target,
            // /vault), where insets.bottom is the right floor instead. The
            // extra 12 lifts the last row clear of the dock rather than
            // leaving it flush against its top edge.
            bottomInset={Math.max(tabBarH, insets.bottom) + 12}
            onChange={setFilters}
            onToggleTag={toggleTag}
            onClearChip={clearChip}
            onReset={resetFilters}
            onClose={() => { setIsFilterSheetOpen(false); setFilterSheetFocusSearch(false); }}
          />
        </View>
      </EdgeSwipePage>
      </View>

      {/* Notch Shield */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top, backgroundColor: theme.colors.background, zIndex: 30 }} />

      {/* 2. Compact Static Header */}
      <View
        onLayout={(e) => {
          const h = Math.round(e.nativeEvent.layout.height);
          if (h > 0 && h !== vaultHeaderH) setVaultHeaderH(h);
        }}
        style={[
          styles.floatingHeaderContainer,
          {
            paddingTop: insets.top,
            // Solid, not frosted. The header floats over the grid, and a blur
            // here meant photos smeared through the title and tab picker as
            // they scrolled under it — busy behind an area that has to stay
            // legible. The tab bar keeps its blur; that one sits over far less
            // content and reads as chrome.
            backgroundColor: theme.colors.background,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: theme.colors.border,
            zIndex: 20,
          }
        ]}
      >
        {/* Upload progress bar relocated to the bottom (just above the navbar) —
            see the root-level bar near the end of this render. */}

        {/* Top Row: the vault title. The board title, its edit menu and the
            photo actions live on the pushed photos page now, not here. */}
        <View style={[styles.header, { height: 44, paddingHorizontal: 16 }]}>
          {/* Only when the vault was opened as an overlay (from the Turtle
              chat), which passes onClose. As a tab there is nothing to go back
              to, so the title sits flush against the padding instead. */}
          {onClose ? (
            <TouchableOpacity
              onPress={onClose}
              style={styles.headerBackInline}
              hitSlop={HIT_SLOP_10}
              accessibilityRole="button"
              accessibilityLabel="Close the vault"
            >
              <Icon name="arrow-left" size={24} color={theme.colors.textPrimary} />
            </TouchableOpacity>
          ) : null}
          <View style={styles.headerTitleSlot}>
            <Text style={[styles.headerTitleLarge, { color: theme.colors.textPrimary }]} numberOfLines={1}>
              <Text style={{ fontWeight: '100' }}>Media </Text>
              <Text style={{ fontWeight: '400' }}>Vault</Text>
            </Text>
          </View>
        </View>

        {/* Bottom Row: Pinterest-style underline tabs. No track, no pill — just
            the labels with a short bar that slides from title to title. The bar
            is sized to the ACTIVE label (measured via onLayout) and interpolated
            off the same pageScrollX as before, so it still tracks the pager 1:1
            through a swipe instead of snapping at the end. */}
        <View style={{ marginHorizontal: 16, marginBottom: 8, height: 34, flexDirection: 'row', position: 'relative' }}>
          {/* Animated Underline */}
          <Animated.View style={{
            position: 'absolute', bottom: 0, left: 0, height: 3,
            width: tabUnderlineWidth,
            backgroundColor: theme.colors.textPrimary,
            borderRadius: 2,
            transform: [{ translateX: tabUnderlineX }],
          }} />

          {TABS.map((tab, index) => {
            // Calculate exact opacity based on 1:1 scroll physics
            const inputRange = [(index - 1) * width, index * width, (index + 1) * width];
            const activeOp = pageScrollX.interpolate({ inputRange, outputRange: [0, 1, 0], extrapolate: 'clamp' });
            const inactiveOp = pageScrollX.interpolate({ inputRange, outputRange: [1, 0, 1], extrapolate: 'clamp' });
            
            const label = tab === 'albums' ? 'Boards' : 'Music';

            return (
              <TouchableOpacity
                key={tab}
                style={{ flex: 1, justifyContent: 'center', alignItems: 'center', zIndex: 1 }}
                onPress={() => handleTabPress(tab)}
              >
                {/* Active Bold Text — also the width source for the underline.
                    Measured on the ACTIVE copy because it's the bolder of the
                    two, so the bar never ends up narrower than the text it
                    sits under. */}
                <Animated.Text
                  onLayout={(e) => measureTabLabel(tab, e.nativeEvent.layout.width)}
                  style={{
                    position: 'absolute', fontSize: 15, fontWeight: '700',
                    color: theme.colors.textPrimary, opacity: activeOp,
                  }}
                >
                  {label}
                </Animated.Text>

                {/* Inactive Regular Text */}
                <Animated.Text style={{
                  fontSize: 15, fontWeight: '500',
                  color: theme.colors.textSecondary, opacity: inactiveOp
                }}>
                  {label}
                </Animated.Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Upload progress lives in the app-root VaultUploadPill — shown on every
          screen, and when the user hides it, it COLLAPSES to a small chip
          (still visible here in the vault) rather than disappearing. So there's
          no separate vault strip to overlap the bulk-select console or jump on
          reveal. */}

      {/* Board menu — share / rename / delete. Both sheets are in-tree overlays,
          NOT Modals (the vault is already inside one, and a sibling Modal over
          an open Modal silently fails to appear on iOS), which means the
          floating dock draws over them: each reserves `tabBarH`. */}
      {/* SHARE INSIGHTS — pushed by the SHARED badge on a board card. Same
          overlay treatment and zIndex band as the photos page (it sits over the
          pager and under the two sheets, which are later siblings), and
          box-none so a closed page never eats taps meant for the grid. */}
      <View style={[StyleSheet.absoluteFillObject, { zIndex: 45 }]} pointerEvents="box-none">
        <ShareInsightsPage
          visible={!!insightsAlbumName}
          albumName={insightsAlbumName}
          api={api}
          theme={theme}
          topInset={insets.top + 6}
          bottomInset={tabBarH}
          onManageLinks={(name) => {
            setInsightsAlbumName(null);
            setShareAlbumName(name);
          }}
          onClose={() => {
            setInsightsAlbumName(null);
            // A link may have been revoked from the page's Manage action — the
            // badge must not keep claiming the board is shared.
            refreshLiveAlbums();
          }}
        />
      </View>

      <AlbumActionsSheet
        visible={!!albumMenuName}
        albumName={albumMenuName}
        subtitle={
          albumCounts[albumMenuName]
            ? `${albumCounts[albumMenuName]} item${albumCounts[albumMenuName] === 1 ? '' : 's'}`
            : 'Board'
        }
        colors={theme.colors}
        api={api}
        bottomInset={tabBarH}
        onShare={() => {
          const name = albumMenuName;
          setAlbumMenuName(null);
          setShareAlbumName(name);
        }}
        onRename={(newName) => {
          const oldName = albumMenuName;
          setAlbumMenuName(null);
          commitAlbumRename(oldName, newName);
        }}
        onDelete={() => {
          const name = albumMenuName;
          setAlbumMenuName(null);
          deleteAlbum(name);
        }}
        onClose={() => setAlbumMenuName(null)}
      />

      {/* "Share to the web" for a board. */}
      <AlbumShareSheet
        visible={!!shareAlbumName}
        albumName={shareAlbumName}
        api={api}
        theme={theme}
        bottomInset={tabBarH}
        onClose={() => {
          setShareAlbumName(null);
          // Creating or revoking a link happens only in here — re-read so the
          // board header's published cue matches what just changed.
          refreshLiveAlbums();
        }}
      />

    </View>
    </DevProfiler>
  );
}

// Memoized grid item component for performance
// === GRID ITEM COMPONENT (Memoized) ===
// === PREMIUM SEAMLESS SWEEPING SHIMMER SKELETON ===
const ShimmerSkeleton = React.memo(({ theme }) => {
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  // Calculate dynamic size: Exact width divided by columns, no internal margins
  // Ensure numColumns matches what is used in your FlatList (defaulting to 3 here)
  const numColumns = 3; 
  const tileSize = width / numColumns; 

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(shimmerAnim, {
        toValue: 1,
        duration: 1200,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [shimmerAnim]);

  // Translate beam width needs to match the tileSize for full sweep coverage
  const translateX = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-tileSize, tileSize]
  });

  // Frosted glass base and light beam colors based on theme
  const baseColor = theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.03)';
  const shineColor = theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)';

  return (
    <View style={{ 
      width: tileSize, 
      aspectRatio: 1, // Keep squares perfectly symmetrical
      backgroundColor: baseColor, 
      overflow: 'hidden',
      margin: 0, // RIGIDLY enforce zero margin for seamless tiling
      padding: 0, // Ensure no internal padding shifts the image
    }}>
      <Animated.View
        style={[
          StyleSheet.absoluteFillObject,
          { transform: [{ translateX }] }
        ]}
      >
        <LinearGradient
          colors={['transparent', shineColor, 'transparent']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFillObject}
        />
      </Animated.View>
    </View>
  );
});

// Once-per-session guards for GridItem's self-healing fetches. Without these,
// EVERY mount/recycle of an untagged cell fired /media/tags/sync (and every
// duration-less video cell fired /media/duration) — scrolling a few thousand
// untagged items hammered the server with thousands of requests and kept the
// radio awake. One attempt per media id per app session is plenty for an
// opportunistic background heal.
const tagHealAttempted = new Set();
const durationHealAttempted = new Set();

// ── Grid video preview cell (Instagram-style) ────────────────────────
// Mounted ONLY for the single centermost video once scrolling settles (see
// GRID_VIDEO_PREVIEW + the viewability wiring in MediaGallery). Because it
// mounts on exactly one cell at a time, only ONE expo-video decoder is ever
// alive in the grid — muted, looping — so it stays cool. The static thumbnail
// underneath remains as an instant poster; this fades over it and is wrapped
// pointer-transparent so taps still open the viewer / toggle selection.
// Unmounts (releasing the decoder) the instant the active id moves or the
// user starts scrolling.
const GridVideoPreview = ({ uri }) => {
  // Fade the video up over its poster thumbnail (matches the photo crossfade
  // aesthetic) so first-frame readiness never shows as a hard cut. Native
  // driver → free; only ever one of these is mounted at a time.
  const fade = useRef(new Animated.Value(0)).current;
  const player = useVideoPlayer(uri, (p) => {
    try {
      p.loop = true;
      p.muted = true;
      // Silent autoplay preview: never claim the audio session, or scrolling
      // the grid would stop the music player (expo-video's default 'auto'
      // mixing mode takes the session even for a muted player).
      p.audioMixingMode = 'mixWithOthers';
      p.play();
    } catch (_) {}
  });
  useEffect(() => {
    const anim = Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [fade]);
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]} pointerEvents="none">
      <VideoView
        style={StyleSheet.absoluteFill}
        player={player}
        contentFit="cover"
        nativeControls={false}
      />
    </Animated.View>
  );
};

const GridItem = React.memo(({ item, openViewer, handleDelete, getFullUrl, getBaseUrl, activeTab, styles, theme, isSelectMode, isSelected, onToggleSelect, gridIndex, onTouchDown, isActiveVideo, cellSize }) => {
  // UNIFIED CELL: a slot renders the SAME component before and after its data
  // arrives — no early-return into a separate skeleton component. The old
  // early return also sat ABOVE the hooks (conditional hooks!), which is the
  // only reason the lists needed getItemType pool-splitting; with one
  // unconditional shape, one recycle pool serves everything and a resolving
  // slot is just a re-render whose image fades in over the resting tile.
  const isSkeleton = !!item.isSkeleton;
  const isVideo = !isSkeleton && item.type === 'video';
  const [duration, setDuration] = useState(item.duration);
  const [hasFailed, setHasFailed] = useState(false);
  const [localTags, setLocalTags] = useState(item.tags || []);

  // ── State reset on FlashList recycle ─────────────────────────
  // FlashList recycles this component when a cell scrolls off-screen
  // and a new item takes its place. `useState(initial)` initializers
  // only run on the FIRST mount, so without this reset the recycled
  // cell carries the previous item's state (stale hasFailed /
  // duration / tags) into the new render. That's why the OLD
  // image stays visible at full opacity for a beat after scroll, then
  // crossfades to the new one — exactly the "supersede" symptom we
  // were chasing.
  //
  // Pattern: track the most recent item id in a ref; if it changes,
  // call all the relevant setters during render. React queues a
  // single re-render with the new initial values — no useEffect lag,
  // no flash of stale state.
  const prevItemIdRef = useRef(item.id);
  const prevTagsRef = useRef(item.tags);
  if (prevItemIdRef.current !== item.id) {
    prevItemIdRef.current = item.id;
    prevTagsRef.current = item.tags;
    setHasFailed(false);
    setDuration(item.duration);
    setLocalTags(item.tags || []);
  } else if (prevTagsRef.current !== item.tags) {
    // SAME cell, tags changed in place — e.g. a bulk-tag assignment updated THIS
    // item (same id, new tags JSON). Without re-syncing here, localTags stays at
    // the pre-assignment value, so the self-heal below still treats the item as
    // "untagged" and can overwrite the freshly-assigned tags with the file's
    // EXIF keywords (the "my tags don't stick / silently revert" bug).
    prevTagsRef.current = item.tags;
    setLocalTags(item.tags || []);
  }
  
  
  // Self-healing: Fetch missing duration independently without parent re-render
  useEffect(() => {
    let isMounted = true;
    
    // Trigger if it's a video, has no duration, has ANY valid identifier,
    // and hasn't already been asked about this session (recycled cells re-run
    // this effect constantly — the guard caps it at one request per id).
    if (isVideo && !duration && (item.filename || item.id) && !durationHealAttempted.has(item.id)) {
      durationHealAttempted.add(item.id);
      const fetchMissingInfo = async () => {
        try {
          // Send filename if it exists, otherwise rely on the ID
          const fileNameParam = item.filename ? `&filename=${encodeURIComponent(item.filename)}` : '';
          const idParam = item.id ? `&id=${item.id}` : '';
          
          const url = `${getBaseUrl()}/media/duration?tab=${activeTab}${fileNameParam}${idParam}`;
          
          const res = await fetch(url);
          const data = await res.json();
          if (data.success && data.duration && isMounted) {
            setDuration(data.duration);
          }
        } catch (err) {
          // Duration fetch failed silently
        }
      };
      fetchMissingInfo();
    }
    
    return () => { isMounted = false; };
  }, [isVideo, duration, item, activeTab, getBaseUrl]);

  // Self-Healing Tag Check - lazy background sync for missing tags
  useEffect(() => {
    let isMounted = true;
    
    // Only for uploads tab, with missing tags, and has filename
    const hasMissingTags = !localTags || (Array.isArray(localTags) && localTags.length === 0) || localTags === '[]';
    
    if (activeTab === 'uploads' && hasMissingTags && item.filename && !tagHealAttempted.has(item.id)) {
      const healTags = async () => {
        // Claim at fire time (not arm time) so a timer cancelled by recycle
        // doesn't burn the id's single attempt.
        if (tagHealAttempted.has(item.id)) return;
        if (tagHealAttempted.size > 5000) tagHealAttempted.clear(); // bound this process-lifetime guard set
        tagHealAttempted.add(item.id);
        try {
          const url = `${getBaseUrl()}/media/tags/sync?id=${item.id}&filename=${encodeURIComponent(item.filename)}`;
          const res = await fetch(url);
          const data = await res.json();
          
          if (data.success && data.tags?.length > 0 && isMounted) {
            setLocalTags(data.tags);
          }
        } catch (err) {
          // Silent fail - this is a lazy background check
          // Tag sync failed silently
        }
      };
      
      // Lazy delay - let grid settle before checking
      const timer = setTimeout(healTags, 1000);
      return () => { isMounted = false; clearTimeout(timer); };
    }
    
    return () => { isMounted = false; };
  }, [item.id, item.filename, localTags, activeTab, getBaseUrl]);
  
  // ONE thumbnail per cell (sm ≈ 200px WebP), loaded in place. We removed the
  // separate hi-res (lg) overlay tier: it mounted on an idle timer and, under
  // FlashList recycling, would fade an absolutely-positioned image over
  // whichever item the recycled cell currently held — a random, offset overlay
  // landing on the wrong index. At this grid's cell size (~⅓ screen width) the
  // 200px sm is already retina-dense, so lg cost bandwidth + glitches for no
  // visible gain. Falls back to the raw/local url when an item has no generated
  // thumbnail (local device assets).
  const smUrl = isSkeleton ? null : getFullUrl(item.thumbnailUrl || item.url);

  // Quiet static base — the resting tile IS the placeholder (Google Photos
  // style): no shimmer, no pulsing overlay, no extra animated views. Images
  // fade in over it; unresolved slots simply stay quiet.
  const cellBase = theme.mode === 'dark' ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.04)';

  return (
    <TouchableOpacity
      disabled={isSkeleton}
      // Stable hook for the batch-share E2E flow (.maestro/batch-share.yaml).
      testID={isSkeleton ? undefined : `gallery-cell-${gridIndex}`}
      style={[
        styles.thumbnailContainer,
        // Dynamic pinch-column size; falls back to the stylesheet's 3-col size.
        cellSize != null && { width: cellSize, height: cellSize },
        { backgroundColor: cellBase },
        isSelectMode && isSelected && { opacity: 0.8 },
      ]}
      onPress={(e) => isSelectMode
        ? onToggleSelect(item.id, gridIndex)
        // Tap point (window coords) anchors the viewer's pop at this cell.
        // pageX/pageY are physical screen coords, so the mirrored grid
        // transform doesn't distort them.
        : openViewer(item, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
      onPressIn={(e) => onTouchDown?.(gridIndex, e.nativeEvent.pageX, e.nativeEvent.pageY)}
      onLongPress={() => !isSelectMode && handleDelete(item.id)}
      activeOpacity={0.8}
    >
      {/* Selection Checkmark Overlay */}
      {isSelectMode && !isSkeleton && (
        <View style={{
          position: 'absolute', bottom: 6, right: 6, width: 22, height: 22, borderRadius: 11,
          backgroundColor: isSelected ? theme.colors.primary : 'rgba(0,0,0,0.3)',
          borderWidth: 1.5, borderColor: isSelected ? theme.colors.primary : '#fff',
          justifyContent: 'center', alignItems: 'center', zIndex: 10
        }}>
          {isSelected && <Icon name="check" size={14} color={theme.colors.background} />}
        </View>
      )}
      
      {hasFailed ? (
        // Fallback for failed images
        <View style={[styles.thumbnail, styles.failedThumbnail]}>
          <Icon 
            name={isVideo ? 'video-off' : 'image-off'} 
            size={32} 
            color="#888" 
          />
          <Text style={styles.failedText}>
            {isVideo ? 'Video' : 'Image'}
          </Text>
        </View>
      ) : !isSkeleton && (
        /* The single thumbnail. expo-image paints the blurhash placeholder
           instantly (zero network) and cross-fades to the loaded image over
           `transition` ms — blur-up, in place, over the quiet tile.
           recyclingKey makes a recycled cell drop the old texture so the
           fade is always placeholder→image, never stale→fresh. 120ms keeps
           the reveal uniform and snappy across a whole landing page. */
        <Image
          source={{ uri: smUrl }}
          style={styles.thumbnail}
          contentFit="cover"
          recyclingKey={item.id}
          transition={120}
          cachePolicy="memory-disk"
          placeholder={item.blurhash ? { blurhash: item.blurhash } : null}
          placeholderContentFit="cover"
          onError={() => setHasFailed(true)}
        />
      )}
      {/* Centermost video auto-plays a muted, looping preview over its poster
          thumbnail once the grid settles (one decoder at a time). */}
      {isActiveVideo && isVideo && !isSkeleton && !hasFailed && smUrl && (
        <GridVideoPreview uri={getFullUrl(item.rawUrl || item.url)} />
      )}
      {item.size && item.size > 100 * 1024 * 1024 && (
        <View style={styles.largeFileBadge}>
          <Icon name="alert-circle-outline" size={10} color="#fff" />
          <Text style={styles.largeFileText}>{(item.size / (1024 * 1024)).toFixed(0)}MB</Text>
        </View>
      )}
      {isVideo && (
        <View style={styles.durationBadge}>
          {duration ? (
            <Text style={styles.durationText}>{formatDuration(duration)}</Text>
          ) : (
            <Icon name="play" size={12} color="#fff" />
          )}
        </View>
      )}
      {item.type === 'document' && (
        <View style={styles.documentOverlay}>
          <Icon name="file-document" size={32} color="#888" />
        </View>
      )}
    </TouchableOpacity>
  );
});

const createStyles = (theme) =>
  StyleSheet.create({
    // ── Share quality chooser + "gathering full-res" overlay ──
    shareSheetBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      justifyContent: 'flex-end',
      padding: 14,
    },
    shareSheetCard: {
      backgroundColor: theme.colors.surfaceElevated || theme.colors.surface,
      borderRadius: 18,
      padding: 10,
      paddingTop: 14,
    },
    shareSheetTitle: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.colors.textSecondary,
      textAlign: 'center',
      marginBottom: 8,
    },
    shareSheetOption: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingVertical: 12,
      paddingHorizontal: 12,
      borderRadius: 12,
    },
    shareSheetOptionText: { flex: 1 },
    shareSheetOptionTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: theme.colors.textPrimary,
    },
    shareSheetOptionSub: {
      fontSize: 12,
      color: theme.colors.textTertiary,
      marginTop: 1,
    },
    shareSheetCancel: {
      marginTop: 6,
      paddingVertical: 12,
      borderRadius: 12,
      alignItems: 'center',
      backgroundColor: theme.colors.surface,
    },
    shareSheetCancelText: {
      fontSize: 15,
      fontWeight: '600',
      color: theme.colors.textSecondary,
    },
    sharePreparingBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    sharePreparingCard: {
      backgroundColor: theme.colors.surfaceElevated || theme.colors.surface,
      borderRadius: 16,
      paddingVertical: 24,
      paddingHorizontal: 32,
      alignItems: 'center',
      gap: 14,
    },
    sharePreparingText: {
      fontSize: 14,
      color: theme.colors.textPrimary,
      fontWeight: '500',
    },
    premiumBezel: {
      backgroundColor: 'rgba(30, 30, 32, 0.85)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255, 255, 255, 0.15)',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 5,
    },
    // Like premiumBezel but THEME-AWARE — for floating chrome that sits over the
    // app's own surface (the grid), not over a photo. The dark premiumBezel is
    // correct over images (white icons), but unreadable in light mode over the
    // light grid; this matches the app's elevated surfaces in both modes.
    selectBezel: {
      // Pure monochrome, theme-adaptive: full black-on-white in light, full
      // white-on-black in dark. background is pure #000/#FFF; the hairline edge
      // keeps the pill separated from same-tone content behind it.
      backgroundColor: theme.colors.background,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.18)' : 'rgba(0, 0, 0, 0.18)',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: theme.mode === 'dark' ? 0.3 : 0.14,
      shadowRadius: 8,
      elevation: 5,
    },
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 0,
      paddingBottom: 8,
      borderBottomWidth: 0,
      backgroundColor: 'transparent',
    },
    headerLeft: {
      width: 70,
      alignItems: 'flex-start',
      justifyContent: 'center',
    },
    headerRight: {
      width: 70, // Equal width to headerLeft for true centering
      alignItems: 'flex-end',
      justifyContent: 'center',
    },
    iconButton: {
      width: 36,
      height: 36,
      borderRadius: 10,
      justifyContent: 'center',
      alignItems: 'center',
    },
    closeButton: {
      padding: 8,
      marginLeft: -8,
      width: 40,
    },
    headerTitle: {
      fontSize: 17,
      fontWeight: '700',
      letterSpacing: -0.3,
    },
    // Left-aligned title slot — fills the space between the (optional) back
    // button and the right-hand actions, anchoring the title to the left.
    headerTitleSlot: {
      flex: 1,
      alignItems: 'flex-start',
      justifyContent: 'center',
    },
    // Back caret on the photos page: sits immediately before the board name
    // rather than in the fixed-width headerLeft slot, so the two read as one
    // unit. Negative margin pulls it back to the container's padding edge.
    headerBackInline: {
      width: 30,
      height: 36,
      marginLeft: -8,
      marginRight: 2,
      alignItems: 'flex-start',
      justifyContent: 'center',
    },
    // Root vault heading — larger, hairline display weight to read as a
    // chapter heading rather than UI chrome. Per-word weights are applied
    // inline (Photos = 100, Vault = 400).
    headerTitleLarge: {
      fontSize: 26,
      letterSpacing: -0.5,
    },
    headerTitleContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    floatingHeaderContainer: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      paddingBottom: 8,
    },
    countContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 16,
      backgroundColor: 'transparent',
    },
    countText: {
      fontSize: 13,
      fontWeight: '500',
      textAlign: 'center',
      letterSpacing: 0.5,
    },
    gridContent: {
      padding: 0,
      paddingBottom: 0,
    },
    // Per-cell counter-flip for the scaleX(-1)+scaleY(-1) mirrored grid (see the
    // grid list's DOUBLE-FLIP note). Hoisted to a StyleSheet constant so it's one
    // shared reference instead of a fresh {transform:[...]} object+array allocated
    // per cell per render in the hottest scroll path.
    cellFlip: { transform: [{ scaleX: -1 }, { scaleY: -1 }] },
    thumbnailContainer: {
      width: THUMBNAIL_SIZE,
      height: THUMBNAIL_SIZE,
      margin: 0.25,
      borderRadius: 0,
      overflow: 'hidden',
      backgroundColor: theme.colors.surfaceElevated,
      borderWidth: 0,
    },
    thumbnail: {
      width: '100%',
      height: '100%',
    },
    failedThumbnail: {
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: theme.colors.surfaceElevated,
    },
    failedText: {
      fontSize: 10,
      color: theme.colors.textMuted,
      marginTop: 4,
    },
    durationBadge: {
      position: 'absolute',
      bottom: 4,
      right: 4,
      backgroundColor: 'rgba(0,0,0,0.7)',
      paddingHorizontal: 5,
      paddingVertical: 2,
      borderRadius: 4,
      justifyContent: 'center',
      alignItems: 'center',
    },
    durationText: {
      color: '#fff',
      fontSize: 10,
      fontWeight: '600',
      letterSpacing: 0.5,
    },
    documentOverlay: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: theme.colors.surfaceElevated,
    },
    emptyContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: 100,
    },
    emptyText: {
      fontSize: 18,
      fontWeight: '600',
      marginTop: 16,
    },
    emptySubtext: {
      fontSize: 14,
      marginTop: 8,
      textAlign: 'center',
      paddingHorizontal: 32,
    },
    bottomContainer: {
      paddingHorizontal: 16,
      paddingVertical: 0,
      paddingBottom: 0,
      backgroundColor: 'transparent',
      borderTopWidth: 0,
    },
    phantomSkeletonContainer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      paddingHorizontal: 0,
      marginBottom: 16,
    },
    uploadButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 14,
      borderRadius: 12,
      gap: 8,
    },
    uploadButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '600',
    },
    // New Action Button Styles (Premium)
    actionButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-start',
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 14,
      gap: 12,
    },
    actionButtonIcon: {
      width: 36,
      height: 36,
      borderRadius: 10,
      justifyContent: 'center',
      alignItems: 'center',
    },
    actionButtonText: {
      fontSize: 15,
      fontWeight: '600',
    },
    searchContainer: {
      // Search container styles applied inline
    },
    // Full-screen viewer styles
    viewerContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    viewerBackground: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: '#000',
    },
    viewerCloseButton: {
      position: 'absolute',
      right: 16,
      zIndex: 10,
    },

    viewerFlatListContainer: {
      width: width,
      height: height * 0.85,
    },
    viewerItemContainer: {
      width: width + GAP,
      height: height * 0.85,
      justifyContent: 'center',
      // flex-start (not center): the cell is GAP px wider than the screen so
      // the trailing GAP becomes the separation between photos. Centering the
      // screen-width content inside the wider cell pushed every image GAP/2 px
      // to the right (and clipped its right edge) once the list snaps to the
      // left-aligned ITEM_WIDTH*index offset. Left-align so the visible
      // viewport [0, width] maps exactly onto the image — dead-centre on screen.
      alignItems: 'flex-start',
    },
    // (viewerScrollContent lived here for the old zoom ScrollView's
    // contentContainer. ZoomableView transforms in place, so it is gone.)
    viewerImage: {
      width: width,
      height: height * 0.85,
    },
    viewerVideo: {
      width: width,
      height: height * 0.85,
    },
    viewerVideoContainer: {
      width: width,
      height: height * 0.85,
      justifyContent: 'center',
      alignItems: 'center',
    },
    viewerInfoDate: {
      color: 'rgba(255,255,255,0.5)',
      fontSize: 14,
      fontWeight: '300',
      textAlign: 'center',
      letterSpacing: 0.5,
    },
    viewerInfoResolution: {
      color: 'rgba(255,255,255,0.8)',
      fontSize: 12,
      fontWeight: '300',
      textAlign: 'center',
      letterSpacing: 0.5,
    },
    muteButton: {
      position: 'absolute',
      bottom: 20,
      right: 20,
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    // Upload modal styles
    uploadModalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    uploadModalContent: {
      width: width * 0.85,
      padding: 24,
      borderRadius: 16,
      elevation: 5,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 4,
    },
    uploadModalTitle: {
      fontSize: 18,
      fontWeight: 'bold',
      marginBottom: 16,
      textAlign: 'center',
    },
    uploadModalLabel: {
      fontSize: 14,
      marginBottom: 8,
    },
    quickSelectScroll: {
      flexGrow: 0,
      marginBottom: 16,
    },
    tagAutocompleteContainer: {
      marginBottom: 16,
      paddingVertical: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
    },
    tagAutocompleteLabel: {
      fontSize: 11,
      fontWeight: '500',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 8,
    },
    tagAutocompleteScroll: {
      flexGrow: 0,
      maxHeight: 44,
    },
    tagAutocompleteChip: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 16,
      backgroundColor: theme.colors.surfaceElevated,
      marginRight: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    tagAutocompleteChipText: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.colors.textPrimary,
    },
    quickSelectChip: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 16,
      backgroundColor: 'rgba(0,0,0,0.05)',
      marginRight: 8,
    },
    quickSelectText: {
      fontSize: 13,
      color: theme.colors.textPrimary,
    },
    uploadModalButtons: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 12,
    },
    uploadModalButton: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 8,
      alignItems: 'center',
    },
    // Keyboard Accessory Styles (iOS)
    keyboardAccessoryContainer: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: 'rgba(0,0,0,0.1)',
    },
    keyboardAccessoryButton: {
      paddingHorizontal: 12,
      paddingVertical: 4,
    },
    keyboardAccessoryText: {
      fontSize: 16,
      fontWeight: '600',
    },
    // Progress Bar Styles
    // Chip Input Styles for Tag Editor
    chipInputContainer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      borderWidth: 1,
      borderRadius: 10,
      padding: 8,
      minHeight: 52,
      marginBottom: 16,
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 16,
      marginRight: 6,
      marginBottom: 6,
      gap: 4,
    },
    chipText: {
      color: theme.colors.background,
      fontSize: 13,
      fontWeight: '600',
    },
    chipTextInput: {
      flex: 1,
      minWidth: 100,
      fontSize: 15,
      paddingVertical: 6,
      marginBottom: 6,
    },
    tagAutocompleteContainer: {
      marginBottom: 12,
    },
    tagAutocompleteLabel: {
      fontSize: 11,
      fontWeight: '500',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 6,
    },
    tagAutocompleteScroll: {
      flexGrow: 0,
      maxHeight: 44,
    },
    tagAutocompleteChip: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 16,
      backgroundColor: theme.colors.surfaceElevated,
      marginRight: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    tagAutocompleteChipText: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.colors.textPrimary,
    },
    // Large file warning badge
    largeFileBadge: {
      position: 'absolute',
      top: 4,
      left: 4,
      backgroundColor: 'rgba(220, 38, 38, 0.85)', // Red warning background
      paddingHorizontal: 4,
      paddingVertical: 2,
      borderRadius: 4,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
    },
    largeFileText: {
      color: '#fff',
      fontSize: 9,
      fontWeight: 'bold',
      letterSpacing: 0.5,
    },
    // Reusable layout patterns (extracted from inline JSX)
    scrollHorizontal: {
      flexGrow: 0,
      maxHeight: 40,
    },
    // Metadata Drawer Styles
    metadataDrawer: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      height: height * 0.55,
      backgroundColor: theme.mode === 'dark' ? 'rgba(30, 30, 32, 0.95)' : 'rgba(252, 252, 255, 0.98)',
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingHorizontal: 20,
      paddingTop: 12,
      paddingBottom: 34,
      zIndex: 100,
    },
    drawerHandle: {
      width: 40,
      height: 5,
      borderRadius: 3,
      backgroundColor: theme.colors.border,
      alignSelf: 'center',
      marginBottom: 16,
    },
    drawerTitle: {
      fontSize: 18,
      fontWeight: '700',
      marginBottom: 16,
    },
    infoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
  });
