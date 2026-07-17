import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Animated,
  Platform,
  Keyboard,
  Modal,
  LayoutAnimation,
  UIManager,
  Share,
  Alert,
  Vibration,
} from 'react-native';
import Reanimated, {
  useAnimatedKeyboard,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Contacts from 'expo-contacts';
import * as Haptics from 'expo-haptics';
// NOTE: expo-clipboard is resolved lazily at call time (see copyInviteLink) — it
// ships a native module that only exists in a dev build compiled after the dep
// was added, so a static top-level import crashes older binaries on load.
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { BlurView } from 'expo-blur';
import { frostBorderColor, FROST_OVERLAP, blurProps, frostOverlayColor } from '../../utils/frostedChat';
import { tapHaptic, impactHaptic, notifyHaptic } from '../../utils/haptics';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../../context/ThemeContext';
import { useServer } from '../../context/ServerContext';
import { useAuth } from '../../context/AuthContext';
import { useCommandBus } from '../../context/CommandBusContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { interceptAndSend } from '../../services/AICommandInterceptor';
import VaultOverlay from './components/VaultOverlay';
import TimerMessage from './components/TimerMessage';
import PomodoroSettings from './components/PomodoroSettings';
import MediaGallery from './components/MediaGallery';
import { usePomodoroSocket } from './hooks/usePomodoroSocket';
import { useClaudeSession } from './hooks/useClaudeSession';
import { useTerminalSession } from './hooks/useTerminalSession';
import ClaudeConsole from './components/ClaudeConsole';
import TerminalConsole from './components/TerminalConsole';
import FriendCard from './components/FriendCard';
import EdgeSwipePage from './components/EdgeSwipePage';
import ConversationsOverlay from './components/ConversationsOverlay';
import LinkDesktop from './components/LinkDesktop';
// SettingsScreen used to be its own tab. We surface it from inside
// the Turtle page now via the top-right gear icon — the tab bar
// shed a slot, and Settings reads more like a "preferences sheet"
// of the Turtle home than a peer destination.
import SettingsScreen from '../SettingsScreen';

const turtleIcon = require('../../assets/turtle-icon.png');
// The startup/brand turtle logo, reused as an extremely faint watermark behind
// the chat (WhatsApp-style background). Tinted to the theme's text colour so it
// reads as a subtle silhouette on both light and dark backgrounds.
const turtleLogo = require('../../assets/turtle-logo.png');

// A short confirm-buzz. Prefers an expo-haptics impact (a crisp tap); falls back
// to the always-available RN Vibration so it still buzzes on any build/device.
// Never throws — a missing haptics module or vibrator must not break the gesture.
function confirmBuzz() {
  try {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {
      try { Vibration.vibrate(20); } catch (e) { /* no vibrator */ }
    });
  } catch (e) {
    try { Vibration.vibrate(20); } catch (e2) { /* no vibrator */ }
  }
}

// Enable LayoutAnimation on Android so the chat's bottom inset eases smoothly
// when the bottom dock resizes (e.g. the Claude console expanding/collapsing)
// instead of snapping. (ClaudeConsole enables this too; the call is idempotent.)
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Regex to match /vault command (with optional quoted password)
const VAULT_COMMAND_REGEX = /^\/vault(?:\s+"([^"]*)")?$/;

// Default durations (in minutes)
const DEFAULT_FOCUS_MINUTES = 25;
const DEFAULT_BREAK_MINUTES = 5;

const HEADER_HEIGHT = 60;
const DEBUG_TOGGLE_HEIGHT = 44;
// Height of the chat header bar's content row (below the safe-area inset). Used
// both for the bar itself and as the inverted message list's visual-top inset
// so the oldest visible message clears the bar instead of hiding behind it.
const CHAT_HEADER_BAR_HEIGHT = 44;

// Format a completion epoch (ms) for the "finished" banner. Same-day shows just
// the clock time ("3:45 PM"); an older completion (e.g. finished while the app
// was closed) also shows the date so the timestamp isn't misleading.
function formatFinishedAt(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

// Claude models offered by the composer's long-press picker. `value` is the
// CLI `--model` alias (or null for the server/CLI default); aliases resolve to
// the latest of each tier server-side, so nothing here needs version bumps.
const CLAUDE_MODELS = [
  { value: null, label: 'Default', sub: "Server's configured model" },
  { value: 'opus', label: 'Opus', sub: 'Most capable' },
  { value: 'sonnet', label: 'Sonnet', sub: 'Balanced' },
  { value: 'haiku', label: 'Haiku', sub: 'Fastest' },
];

export default function TurtleScreen() {
  const { theme } = useTheme();
  const { api, isConnected, getBaseUrl, serverIP } = useServer();
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  // Measured height of the floating bottom dock (cards + frosted composer).
  // It's an absolute overlay over the full-height message list, so we inset
  // the list by this height — the newest message rests just clear of the dock
  // while older messages scroll UNDER the composer's blur (Telegram frosted
  // bar). Seeded so there's no first-frame overlap before onLayout measures.
  const [dockHeight, setDockHeight] = useState(72);
  // The Claude console sizes itself to the room left between the chat header and
  // the composer. To do that robustly it needs to know what ELSE the dock holds:
  // anything stacked ABOVE it (a pomodoro card) and BELOW it (queue/finished
  // banners + the composer). We measure those two groups and feed the heights
  // down, so the console always fits — no matter which cards happen to be up.
  const [dockAboveConsole, setDockAboveConsole] = useState(0);   // pomodoro card
  const [dockBelowConsole, setDockBelowConsole] = useState(120); // banners + composer
  // True while the keyboard is mid-show/hide. The dock's onLayout normally fires
  // a LayoutAnimation when its height changes (Claude console expand/collapse),
  // but during a keyboard transition the console height is ALREADY animating on
  // the UI thread (useAnimatedKeyboard, frame-synced with this column's lift) —
  // a competing JS-thread LayoutAnimation makes the panel jump. Gate it off
  // while the keyboard animates so the Reanimated motion runs alone.
  const kbAnimatingRef = useRef(false);
  // Last dock height measured WHILE the keyboard was animating. The Claude
  // console shrinks its height on the UI thread every keyboard frame, so the
  // dock's onLayout fires every frame too — pushing setDockHeight (→ FlashList
  // paddingBottom → a full JS-thread list relayout) on EVERY frame, which
  // stutters against the smooth Reanimated lift. We stash the value here and
  // skip the state update during the transition, then flush it once when the
  // keyboard settles (see the keyboard listener effect). null = nothing pending.
  const pendingDockHeightRef = useRef(null);
  // This screen sits inside the bottom tab navigator, so its container bottom
  // is ABOVE the tab bar. useAnimatedKeyboard reports height from the SCREEN
  // bottom, so the keyboard padding must subtract the tab-bar height — else
  // the composer floats a tab-bar's worth of empty space above the keyboard.
  const tabBarHeight = useBottomTabBarHeight();

  // Chat state
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  // "Scroll to latest" pill for the chat. The list is inverted, so offset 0 is
  // the newest message (visual bottom); we show the pill once the user has
  // scrolled a screenful up into history.
  const [showChatJump, setShowChatJump] = useState(false);

  // The chat list's data. Filtered live while the user is typing a `/search`
  // command, otherwise the full message set. Memoized so we don't rebuild the
  // array (and re-render the whole list) on every unrelated render — only when
  // messages or the search query actually change.
  const visibleMessages = useMemo(() => {
    const query = inputText.toLowerCase();
    if (!query.startsWith('/search ')) return messages;
    const searchStr = query.replace('/search ', '').trim();
    if (!searchStr) return messages;
    const searchTerms = searchStr.split(/\s+/);
    return messages.filter((msg) => {
      const messageText = (msg.text || '').toLowerCase();
      return searchTerms.every((term) => messageText.includes(term));
    });
  }, [messages, inputText]);

  // FlashList v2 dropped the `inverted` prop. We keep `messages` newest-first
  // internally (so every `[newMsg, ...prev]` prepend + history append still
  // works), and render a CHRONOLOGICAL copy (oldest → newest) so the newest
  // message sits at the BOTTOM like iMessage/Instagram. v2's
  // maintainVisibleContentPosition keeps this smooth (starts at the bottom,
  // auto-scrolls on new messages, holds position when older history loads up top).
  const chronologicalMessages = useMemo(
    () => visibleMessages.slice().reverse(),
    [visibleMessages],
  );

  // Toggle the "scroll to latest" pill. Chronological list → the newest message
  // is at the BOTTOM. Rules: (1) only once scrolled a LOT up into history (~a
  // full screen), and (2) only while the user is moving DOWN, toward the latest
  // — scrolling up into history keeps it hidden so it never sits in the way.
  const lastChatOffsetY = useRef(0);
  const chatJumpingRef = useRef(false); // true during a tap-to-latest animation
  const handleChatScroll = useCallback((e) => {
    const ne = e?.nativeEvent;
    const offsetY = ne?.contentOffset?.y ?? 0;
    const viewH = ne?.layoutMeasurement?.height ?? 0;
    const contentH = ne?.contentSize?.height ?? 0;
    const distanceFromBottom = contentH - viewH - offsetY;
    const delta = offsetY - lastChatOffsetY.current; // >0 = scrolling down (toward latest)
    lastChatOffsetY.current = offsetY;

    // While we're animating to the bottom from a tap, keep it hidden until we
    // arrive (otherwise the downward auto-scroll would re-trigger "show").
    if (chatJumpingRef.current) {
      if (distanceFromBottom < 80) chatJumpingRef.current = false;
      setShowChatJump((prev) => (prev === false ? prev : false));
      return;
    }

    const farEnough = distanceFromBottom > Math.max(viewH * 0.9, 450);
    let want;
    if (!farEnough) want = false;        // near the latest → hide
    else if (delta > 1) want = true;     // scrolling down toward latest → show
    else if (delta < -1) want = false;   // scrolling up into history → hide
    else return;                         // negligible movement → leave as-is
    setShowChatJump((prev) => (prev === want ? prev : want));
  }, []);

  // Smoothly fade the pill in/out instead of popping it. Stays mounted (with
  // taps disabled) while it fades to 0 so "no scroll → no button" reads as a
  // gentle fade-out, like a native messenger.
  const chatJumpAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(chatJumpAnim, {
      toValue: showChatJump ? 1 : 0,
      duration: showChatJump ? 200 : 160,
      useNativeDriver: true,
    }).start();
  }, [showChatJump, chatJumpAnim]);

  const scrollChatToLatest = useCallback(() => {
    chatJumpingRef.current = true; // suppress re-show during the downward animation
    try { scrollViewRef.current?.scrollToEnd?.({ animated: true }); } catch (e) { /* mid-layout */ }
    setShowChatJump(false);
  }, []);
  // Commands pushed from the global CommandConsole (long-press the Turtle tab).
  const { pending: pendingCommand, clear: clearPendingCommand } = useCommandBus();
  // Image queued for the NEXT Claude message (sent into the session as a
  // base64 block). { base64, mediaType, uri } | null.
  const [claudeImage, setClaudeImage] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const [debugLogs, setDebugLogs] = useState([]);
  const [encryptionKey, setEncryptionKey] = useState(null);
  
  // History pagination state
  const [historyOffset, setHistoryOffset] = useState(0);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  
  // Vault overlay state
  const [isVaultOpen, setIsVaultOpen] = useState(false);
  const [vaultPassword, setVaultPassword] = useState(null);
  
  // Photo Gallery state
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [galleryAutoUpload, setGalleryAutoUpload] = useState(false);
  
  // Server-as-source-of-truth pomodoro timer (mirrors web app). The hook
  // returns the active/ended state and exposes start/stop helpers — the
  // synthetic timer card below the chat list reads directly from `pomodoro.state`.
  const pomodoro = usePomodoroSocket(serverIP);

  // Collapse the running timer card to a thin "working" header (like the
  // Claude queue tab). Only meaningful while a session is active; a brand
  // new session (new startedAt) auto-expands so the user sees it start.
  const [timerMinimized, setTimerMinimized] = useState(false);
  const activeTimerStartedAt =
    pomodoro.state && pomodoro.state.status === 'active' ? pomodoro.state.startedAt : null;
  useEffect(() => {
    if (activeTimerStartedAt) setTimerMinimized(false);
  }, [activeTimerStartedAt]);

  // ── Claude Code CLI session ──────────────────────────────────────────
  // `/claude` opens a persistent Claude session (Max/Pro subscription) on
  // the server, running in the turtle-app dir. While claudeUiMode is set,
  // plain messages route to Claude instead of the chat AI.
  // The hook owns the streamed transcript; the dedicated ClaudeConsole
  // panel (rendered above the input) shows it directly, so live output
  // always appears instead of relying on the chat message list.
  const claude = useClaudeSession(serverIP, token);

  // Leaving the Turtle chat (tab blur / unmount) auto-suspends the Claude live
  // log: it pauses the per-chunk stream AND unloads the transcript from the
  // frontend, so a running session stops draining CPU/memory while you're on
  // another tab. The session keeps running + buffering server-side; returning
  // shows it paused, and tapping Live retrieves it from the buffer. suspend()
  // self-guards (no-op unless a session is live).
  const claudeSuspendRef = useRef(claude.suspend);
  claudeSuspendRef.current = claude.suspend;
  useFocusEffect(
    useCallback(() => () => { claudeSuspendRef.current?.(); }, []),
  );

  const {
    mode: claudeUiMode,        // null | 'session' | 'login'
    active: claudeActive,
    busy: claudeBusy,          // a turn is in flight
    model: claudeModel,        // selected model alias (null = CLI default)
    setModel: setClaudeModel,  // set by the long-press model picker
    send: claudeSend,
    start: claudeStart,
    startAdmin: claudeStartAdmin,
    stop: claudeStop,
    login: claudeLogin,
    loginInput: claudeLoginInput,
    loginStop: claudeLoginStop,
    close: claudeClose,
    queue: claudeQueue,         // server-side task queue (mirrored from sockets)
    completedQueue: claudeCompletedQueue, // finished queued tasks (+ finish time)
    clearQueue: clearClaudeQueue,
  } = claude;

  // Most-recently finished queued task, shown as a dismissable "✓ finished at …"
  // banner. Cleared when the user dismisses it or a new task starts working
  // (tracked by id so a fresh completion re-shows). null = nothing to show.
  const [dismissedDoneId, setDismissedDoneId] = useState(null);
  const lastCompleted = (claudeCompletedQueue && claudeCompletedQueue.length > 0)
    ? claudeCompletedQueue[claudeCompletedQueue.length - 1]
    : null;
  const showDoneBanner = !!lastCompleted
    && lastCompleted.id !== dismissedDoneId
    && !claudeBusy; // hide while a newer task is actively working

  // Long-press the robot icon to reveal this Claude model picker. Aliases map
  // to the latest of each tier server-side (the CLI resolves 'opus'/'sonnet'/
  // 'haiku'), so we never hardcode a version that could be retired.
  const [showModelPicker, setShowModelPicker] = useState(false);

  // ── To-do → Claude queue ─────────────────────────────────────────────
  // The queue now lives SERVER-SIDE: the server feeds the next task to the
  // session itself whenever a turn finishes, so pending tasks keep getting
  // worked even with the app closed. This screen just displays the queue
  // (mirrored via `claude.queue`) and offers Start/Clear — no client draining.

  // Remote shell on the server (PowerShell/bash). Same bridge pattern as
  // Claude; renders in the TerminalConsole panel.
  const terminal = useTerminalSession(serverIP, token);
  const {
    open: terminalOpen,
    send: terminalSend,
    start: terminalStart,
    stop: terminalStop,
    close: terminalClose,
  } = terminal;
  // The terminal opens full-screen (vintage CRT) by default; the expand/
  // collapse control toggles to a compact card.
  const [terminalFullscreen, setTerminalFullscreen] = useState(true);

  // Keyboard mode for the composer during a Claude / terminal session.
  // 'code'   → no auto-capitalize / auto-correct / spellcheck, so commands,
  //            code, and paths type exactly as written.
  // 'normal' → sentence-case + autocorrect (the everyday chat keyboard).
  // Defaults to 'code' because a coding session is the common case; the
  // user picks via the keyboard toggle next to the input.
  const [keyboardMode, setKeyboardMode] = useState('code');

  // ── Sticky-above-keyboard composer ───────────────────────────────────
  // We want the input pinned EXACTLY on the keyboard's top edge with no gap,
  // tracking it frame-by-frame — including the interactive swipe-down drag,
  // which the old keyboardWillShow/Hide timer couldn't follow. Reanimated's
  // useAnimatedKeyboard exposes the live keyboard height as a shared value,
  // so we drive the container's bottom padding straight from it on the UI
  // thread. When the keyboard is dismissed the padding eases back to rest on
  // the safe-area line — max() so the pill never dips under the home
  // indicator / gesture bar.
  //
  // Applied on BOTH platforms: under Expo SDK 54's mandatory edge-to-edge,
  // the window no longer auto-resizes for the keyboard (decorFitsSystemWindows
  // is false), and useAnimatedKeyboard consumes the IME inset itself — so
  // Android must move the composer via this padding too, not rely on
  // adjustResize. The inputArea below therefore contributes no bottom inset.
  const keyboard = useAnimatedKeyboard();
  // The resting gap under the composer — applied as the frosted BlurView's
  // own paddingBottom (see the inputArea render below), so the bar's blur+tint
  // fills the margin instead of leaving bare chat showing through. Static, so
  // it never animates and stays identical whether the keyboard is open or closed.
  const COMPOSER_MARGIN = 12;
  // True whenever the Claude console is on screen (a live session OR the login
  // flow).
  const inClaudeSession = !!claudeUiMode;
  // UI-thread mirror of inClaudeSession. The three keyboard-lift worklets below
  // are ALWAYS attached (never swapped against null in the JSX) and branch on
  // THIS shared value to decide which node carries the lift. Why: swapping an
  // animated style for `null` in a style array doesn't reliably clear the
  // last-committed transform — on minimize the dock kept its −K sessionDockLift
  // AND the column newly applied −K, leaving the composer stuck one keyboard
  // height too high. Reading a shared value inside the worklet (NOT a JS bool —
  // that's the stale-capture trap) flips both nodes in the SAME UI frame, so the
  // lift hands off atomically and the composer never moves. Updated in an effect
  // below so we never write a shared value mid-render.
  const sessionSV = useSharedValue(inClaudeSession);
  useEffect(() => { sessionSV.value = inClaudeSession; }, [inClaudeSession, sessionSV]);
  // ── Keyboard motion ───────────────────────────────────────────────────────
  // ONE shared value (useAnimatedKeyboard) drives everything; which worklet is
  // attached to which node is chosen in plain JS at the JSX style arrays (never
  // branched inside a worklet — that closes over a JS bool and Reanimated won't
  // reliably rebuild it: the stale-capture trap that broke an earlier attempt).
  //
  // • NORMAL CHAT: the whole column lifts (keyboardSpacerStyle) and the header
  //   counter-lifts to stay pinned (headerCounterStyle); the dock rides inside
  //   the column, so it takes no transform of its own.
  // • CLAUDE SESSION: the column + header DO NOT MOVE (background stays dead
  //   still — the fixed backdrop). ONLY the bottom dock — the console + composer
  //   window — lifts (sessionDockLift), tracking the keyboard frame-for-frame up
  //   AND down. The window is OPAQUE (see ClaudeConsole.panel) so it slides as a
  //   self-contained surface over the static background, with no see-through
  //   chat shearing behind the blur (that shear was the "background moves with an
  //   offset" bug). The console caps its own height to stay under the header.
  //
  // All three worklets are pure: each ALWAYS computes its live transform.
  const keyboardSpacerStyle = useAnimatedStyle(() => {
    'worklet';
    // Lift the whole column with a TRANSFORM, not by animating
    // paddingBottom/height. Animating a layout prop here would re-run Yoga
    // layout on the entire inverted FlatList every keyboard frame — that's
    // the stutter on open. translateY is compositor-only: the column slides
    // up rigidly with ZERO relayout, so it tracks the keyboard smoothly.
    //
    // Offset = how far the keyboard rises ABOVE the tab bar (the column
    // already sits above the tab bar; floor at 0 so a closed keyboard doesn't
    // shove it down). The static COMPOSER_MARGIN preserves the resting gap, so
    // the pill ends up exactly COMPOSER_MARGIN above the keyboard's top edge.
    // In a Claude session the column stays static (the dock lifts instead), so
    // this returns 0 there — handed off atomically via sessionSV.
    const lift = sessionSV.value ? 0 : Math.max(keyboard.height.value - tabBarHeight, 0);
    return {
      transform: [{ translateY: -lift }],
    };
  });

  // The chat header lives INSIDE the lifted column (it's an absolute overlay so
  // the message list scrolls beneath it). Without compensation it would ride up
  // and off the top of the screen with the column when the keyboard opens —
  // exactly the "header disappears, chat slides under the status bar" bug. We
  // cancel the column's lift with an equal-and-opposite translate, so the header
  // stays pinned at the very top while messages rise UNDER its opaque bar
  // (WhatsApp-style). It's the exact negation of keyboardSpacerStyle.
  // Counter-lift for the chat header (NORMAL CHAT only — attached in JSX). The
  // header is an absolute overlay inside the lifted column; without this it
  // would ride up off the top with the column. Exact negation of the column
  // lift, so the header stays pinned while messages rise UNDER it.
  const headerCounterStyle = useAnimatedStyle(() => {
    'worklet';
    // Exact negation of the column lift — but only when the column actually
    // lifts (normal chat). In a session the column is static, so no counter is
    // needed and this returns 0. Same sessionSV gate as the column, so the two
    // stay in lockstep.
    const lift = sessionSV.value ? 0 : Math.max(keyboard.height.value - tabBarHeight, 0);
    return {
      transform: [{ translateY: lift }],
    };
  });

  // CLAUDE SESSION only (attached in JSX when a session is open). Lifts just the
  // bottom dock — the opaque console window + composer — so it tracks the
  // keyboard up and down. Compositor-only translateY: it slides rigidly with the
  // keyboard, no relayout. Offset = how far the keyboard rises above the tab bar
  // (the dock already rests above the tab bar; floor at 0 when closed). The
  // background column does NOT move (it has no animated style in a session), so
  // the window glides over a fixed backdrop.
  const sessionDockLift = useAnimatedStyle(() => {
    'worklet';
    // The dock carries the lift ONLY in a session; in normal chat the column
    // lifts it instead, so this returns 0. Gated on the same sessionSV as the
    // column/header, so when the session is minimized the lift moves off the
    // dock and onto the column in the SAME frame — the composer's net position
    // is unchanged and it never jumps.
    const lift = sessionSV.value ? Math.max(keyboard.height.value - tabBarHeight, 0) : 0;
    return {
      transform: [{ translateY: -lift }],
    };
  });


  // Flag the keyboard-transition window so the dock's onLayout suppresses its
  // LayoutAnimation while the console height animates on the UI thread (see
  // kbAnimatingRef). Clear a beat after the reported duration so a quick toggle
  // right after the keyboard settles still animates normally.
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    let clearTimer = null;
    const mark = (e) => {
      kbAnimatingRef.current = true;
      if (clearTimer) clearTimeout(clearTimer);
      clearTimer = setTimeout(() => {
        kbAnimatingRef.current = false;
        // Apply the final dock height that the per-frame onLayouts deferred, in
        // ONE commit now that the keyboard has settled — so the chat list's
        // bottom inset matches the console's resting (shrunk/grown) height
        // without the per-frame relayout storm during the transition.
        const pending = pendingDockHeightRef.current;
        pendingDockHeightRef.current = null;
        if (pending != null) {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setDockHeight((prev) => (prev === pending ? prev : pending));
        }
      }, (e?.duration || 250) + 80);
    };
    const s = Keyboard.addListener(showEvt, mark);
    const h = Keyboard.addListener(hideEvt, mark);
    return () => { s.remove(); h.remove(); if (clearTimer) clearTimeout(clearTimer); };
  }, []);

  const [showSettings, setShowSettings] = useState(false);
  // Distinct from `showSettings` above (which gates PomodoroSettings).
  // `showAppSettings` controls the full Settings page that used to
  // live on its own tab — now reached via the gear icon top-right.
  const [showAppSettings, setShowAppSettings] = useState(false);
  // Friends (org members) overlay — list + lookup, reached from the chat's
  // top-left people icon. Loaded once on open; the search box filters locally.
  const [showFriends, setShowFriends] = useState(false);
  // Conversation boards — messenger-style inbox of per-board threads, reached
  // from the forum icon next to Friends. Sibling of the Friends page (only one
  // of the two Modals is ever open at a time).
  const [showConversations, setShowConversations] = useState(false);
  // "Link a desktop" QR scanner (approve a Turtle desktop app to sign in as you).
  const [showLinkDesktop, setShowLinkDesktop] = useState(false);
  const [friends, setFriends] = useState([]);
  // Tapped member → their profile card (avatar, name, number, stats). Stacks
  // over the Friends sheet; null = closed.
  const [selectedFriend, setSelectedFriend] = useState(null);
  const [pendingInvites, setPendingInvites] = useState([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [friendQuery, setFriendQuery] = useState('');
  // Reusable fetch so both the initial open AND a post-invite refresh
  // pull the same friends + pending lists without duplicating logic.
  const loadFriends = useCallback(async () => {
    setFriendsLoading(true);
    try {
      const r = await api.get('/friends');
      setFriends(Array.isArray(r?.friends) ? r.friends : []);
      setPendingInvites(Array.isArray(r?.pending) ? r.pending : []);
    } catch {
      setFriends([]);
      setPendingInvites([]);
    } finally {
      setFriendsLoading(false);
    }
  }, [api]);
  // Owner-gated: pull dev accounts + the fixed code from the invites endpoint
  // (requireOwner). Success → this user is the owner, show the block; 403 →
  // hide it. Never throws (swallowed) so a non-owner's Friends sheet is clean.
  const loadDevAccounts = useCallback(async () => {
    try {
      const r = await api.get('/auth/invites');
      setIsOwner(true);
      setDevAccounts(Array.isArray(r?.devAccounts) ? r.devAccounts : []);
      if (r?.devCode) setDevCode(String(r.devCode));
    } catch {
      setIsOwner(false);
      setDevAccounts([]);
    }
  }, [api]);
  const openFriends = useCallback(async () => {
    setShowFriends(true);
    setDevNote(null);
    await Promise.all([loadFriends(), loadDevAccounts()]);
  }, [loadFriends, loadDevAccounts]);

  const addDevAccount = useCallback(async (rawPhone) => {
    const phone = normalizePhone(rawPhone);
    if (!phone || phone.replace(/\D/g, '').length < 5) {
      setDevNote({ type: 'err', text: 'Enter a valid phone number.' });
      return;
    }
    setDevBusy(true);
    setDevNote(null);
    try {
      const r = await api.post('/auth/dev-accounts', { phone });
      setDevPhone('+1 ');
      setDevNote({ type: 'ok', text: `${phone} can sign in with code ${r?.code || devCode} — no SMS.` });
      await loadDevAccounts();
    } catch (e) {
      const m = e?.message || '';
      const forbidden = /\b403\b/.test(m) || /owner only/i.test(m);
      setDevNote({
        type: 'err',
        text: forbidden
          ? 'Only the pond owner can add developer accounts.'
          : (m.replace(/^API Error \d+:\s*/, '').slice(0, 140) || 'Could not add that developer account.'),
      });
    } finally {
      setDevBusy(false);
    }
  }, [api, normalizePhone, loadDevAccounts, devCode]);

  // Assign a developer account straight from a member's profile card (vs the
  // sheet's text field). Surfaces feedback via Alert since the card is its own
  // surface; refreshes the list so the card's isDevAccount prop flips.
  const assignDevFromCard = useCallback(async (phone) => {
    const norm = normalizePhone(phone);
    if (!norm) return;
    try {
      const r = await api.post('/auth/dev-accounts', { phone: norm });
      await loadDevAccounts();
      Alert.alert('Developer account', `${norm} can now sign in with code ${r?.code || devCode} — no SMS.`);
    } catch (e) {
      const m = e?.message || '';
      const forbidden = /\b403\b/.test(m) || /owner only/i.test(m);
      Alert.alert(
        'Developer account',
        forbidden
          ? 'Only the pond owner can add developer accounts.'
          : (m.replace(/^API Error \d+:\s*/, '').slice(0, 140) || 'Could not add that developer account.'),
      );
    }
  }, [api, normalizePhone, loadDevAccounts, devCode]);

  const removeDevAccount = useCallback((phone) => {
    Alert.alert(
      'Remove developer account',
      `${phone} will no longer be able to sign in with the developer code.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete('/auth/dev-accounts/' + encodeURIComponent(phone));
              await loadDevAccounts();
            } catch (e) {
              Alert.alert('Remove', e?.message || 'Could not remove that developer account.');
            }
          },
        },
      ],
    );
  }, [api, loadDevAccounts]);

  // Mint a Discord-style invite link (7-day default, unlimited uses) and hand
  // it to the OS share sheet. The deep link carries the SERVER ADDRESS too, so
  // a fresh install that taps it is fully configured — server + code in one
  // tap. Owner-only server-side; non-owners get the friendly note.
  const [inviteLinkBusy, setInviteLinkBusy] = useState(false);
  const shareInviteLink = useCallback(async () => {
    if (inviteLinkBusy) return;
    setInviteLinkBusy(true);
    try {
      const [link, orgResp] = await Promise.all([
        api.post('/auth/invite-links', {}),
        api.get('/org').catch(() => null),
      ]);
      const pondName = orgResp?.org?.name || 'my pond';
      // Prefer the server's http landing URL — tappable in every messenger,
      // and it fires the turtle:// deep link (server + code) itself.
      const joinUrl = link.joinUrl || `turtle://join/${link.code}?server=${serverIP}`;
      await Share.share({
        message:
          `Come join "${pondName}" on Turtle 🐢\n\n` +
          `Tap on your phone: ${joinUrl}\n\n` +
          `Invite code ${link.codePretty} · expires in 7 days.`,
      });
    } catch (e) {
      const msg = /403|owner only/i.test(String(e?.message))
        ? 'Only the pond owner can create invite links.'
        : (e?.message || 'Could not create the invite link.');
      Alert.alert('Invite link', msg);
    } finally {
      setInviteLinkBusy(false);
    }
  }, [api, serverIP, inviteLinkBusy]);

  // ── Invite a friend ──────────────────────────────────────────────
  // Two entry points feed the same POST /api/auth/invites: a manual
  // phone field and the device contact picker. Inviting is owner-only
  // server-side; a non-owner gets a friendly note rather than a crash.
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invitePhone, setInvitePhone] = useState('+1 '); // NA-only for now → prefill +1
  const [inviteBusy, setInviteBusy] = useState(false);
  // { type: 'ok' | 'err', text } — small inline banner under the field.
  const [inviteNote, setInviteNote] = useState(null);
  // { phone, joinUrl } for the last invite — surfaces a copy/share card so the
  // owner can send the link by hand when the auto-SMS doesn't land. Null hides it.
  const [inviteResult, setInviteResult] = useState(null);
  const [inviteCopied, setInviteCopied] = useState(false);

  // ── Developer accounts (owner-only) ──────────────────────────────
  // Owner-added phones that sign in with the fixed devCode and NO SMS —
  // for testing on numbers that can't receive OTP. Mirrors the web
  // OrgPanel block. Gated by simply trying GET /auth/invites: it's
  // requireOwner server-side, so a 200 means the current user is the
  // owner (and carries devAccounts + devCode); a 403 hides the block.
  const [isOwner, setIsOwner] = useState(false);
  const [devAccounts, setDevAccounts] = useState([]);
  const [devCode, setDevCode] = useState('11111');
  const [devPhone, setDevPhone] = useState('+1 ');
  const [devBusy, setDevBusy] = useState(false);
  const [devNote, setDevNote] = useState(null); // { type: 'ok'|'err', text }

  // Strip a contact/manual number down to the digits (and a single
  // leading +) the server stores. Keeps matching with invited_phones
  // / users.phone consistent regardless of how the contact app
  // formatted it ("(415) 555-0100" → "+4155550100" / "4155550100").
  const normalizePhone = useCallback((raw) => {
    const s = String(raw || '').trim();
    if (!s) return '';
    const plus = s.startsWith('+') ? '+' : '';
    return plus + s.replace(/[^\d]/g, '');
  }, []);

  const inviteByPhone = useCallback(async (rawPhone) => {
    const phone = normalizePhone(rawPhone);
    if (!phone || phone.replace(/\D/g, '').length < 5) {
      setInviteNote({ type: 'err', text: 'Enter a valid phone number.' });
      return;
    }
    setInviteBusy(true);
    setInviteNote(null);
    setInviteResult(null);
    setInviteCopied(false);
    try {
      // The endpoint adds them to the invite list AND returns a per-invitee
      // joinUrl (whether or not the auto-text landed) — we surface that link so
      // the owner can copy/send it by hand.
      const resp = await api.post('/auth/invites', { phone });
      const joinUrl = resp?.joinUrl || null;
      setInvitePhone('');
      setInviteNote({
        type: 'ok',
        text: resp?.smsSent
          ? `Invited ${phone} — they got a tap-to-join text.`
          : `Invited ${phone} — the auto-text didn't land. Copy the link below and send it yourself.`,
      });
      if (joinUrl) setInviteResult({ phone, joinUrl });
      // Surface them immediately in the pending list, then reconcile.
      setPendingInvites((prev) =>
        prev.some((p) => p.phone === phone) ? prev : [{ phone }, ...prev],
      );
      await loadFriends();
    } catch (e) {
      // requireOwner → 403 for non-owners. The api client folds the status
      // into the Error message ("API Error 403: …"), so match on that.
      const m = e?.message || '';
      const isForbidden = /\b403\b/.test(m) || /owner only/i.test(m);
      setInviteNote({
        type: 'err',
        text: isForbidden
          ? 'Only the pond owner can invite new turtles.'
          : 'Could not send that invite. Check the number and try again.',
      });
    } finally {
      setInviteBusy(false);
    }
  }, [api, normalizePhone, loadFriends]);

  // Copy the last invitee's join link to the clipboard so the owner can paste
  // it into iMessage/WhatsApp themselves. Brief "Copied!" confirmation.
  const copyInviteLink = useCallback(async () => {
    if (!inviteResult?.joinUrl) return;
    // Resolve expo-clipboard lazily: it's a NATIVE module that only exists in a
    // dev build compiled after the dep was added. Requiring it at call time (vs
    // a top-level import) lets a binary that predates it degrade to the OS share
    // sheet instead of crashing the whole app on load.
    let clip = null;
    try { clip = require('expo-clipboard'); } catch { /* not in this build */ }
    if (clip?.setStringAsync) {
      try {
        await clip.setStringAsync(inviteResult.joinUrl);
        setInviteCopied(true);
        setTimeout(() => setInviteCopied(false), 1800);
        return;
      } catch { /* clipboard present but failed — fall through to share */ }
    }
    // No clipboard module in this build: hand the link to the OS share sheet.
    try { await Share.share({ message: inviteResult.joinUrl }); } catch { /* dismissed */ }
  }, [inviteResult]);

  // Hand the invitee's join link to the OS share sheet (iMessage, WhatsApp, …).
  const shareInviteResult = useCallback(async () => {
    if (!inviteResult?.joinUrl) return;
    try {
      await Share.share({
        message: `You're invited to my Turtle pond 🐢 Tap to join: ${inviteResult.joinUrl}`,
      });
    } catch { /* user dismissed the sheet — nothing to do */ }
  }, [inviteResult]);

  // Open the native contact picker, pull the first phone number off
  // the chosen contact, and pre-fill it into the invite field (the
  // user confirms with the Invite button). presentContactPickerAsync
  // uses the OS picker, so we don't need full READ_CONTACTS up front;
  // we still request permission as a fallback for older platforms.
  const pickContactToInvite = useCallback(async () => {
    setInviteNote(null);
    try {
      // Native OS contact picker — iOS & Android. It manages its own
      // limited-access permission, so we don't need full READ_CONTACTS up
      // front. If the build somehow lacks it, tell the user rather than
      // guessing a contact for them.
      if (typeof Contacts.presentContactPickerAsync !== 'function') {
        setInviteNote({ type: 'err', text: 'Contact picker isn\'t available on this device — type the number instead.' });
        setInviteOpen(true);
        return;
      }
      const contact = await Contacts.presentContactPickerAsync();
      if (!contact) return; // user cancelled the picker
      const numbers = contact.phoneNumbers || [];
      const first = numbers.find((n) => n?.number || n?.digits);
      const number = first?.number || first?.digits;
      if (!number) {
        setInviteNote({ type: 'err', text: `${contact.name || 'That contact'} has no phone number.` });
        return;
      }
      setInviteOpen(true);
      setInvitePhone(normalizePhone(number));
    } catch (e) {
      setInviteNote({ type: 'err', text: 'Could not open contacts.' });
    }
  }, [normalizePhone]);
  // Resolve a member's avatar into a full URL. A server-relative path
  // ('/api/avatars/…') gets the server origin prepended; absolute URLs pass
  // through; null → caller falls back to the role glyph. Shared by the friend
  // rows and the profile card.
  const serverBase = (getBaseUrl() || '').replace(/\/api$/, '');
  const friendAvatarUri = (f) =>
    f?.avatarUrl ? (f.avatarUrl.startsWith('/') ? `${serverBase}${f.avatarUrl}` : f.avatarUrl) : null;

  const _fq = friendQuery.trim().toLowerCase();
  const filteredFriends = _fq
    ? friends.filter((f) => (f.displayName && f.displayName.toLowerCase().includes(_fq)) || (f.phone && f.phone.toLowerCase().includes(_fq)))
    : friends;
  const filteredPending = _fq
    ? pendingInvites.filter((p) => p.phone && p.phone.toLowerCase().includes(_fq))
    : pendingInvites;
  // Project sharing: tap a friend to open a picker of YOUR projects; sharing is
  // view-only (POST /api/shares). sharesOut tracks what you've already shared.
  const [shareTarget, setShareTarget] = useState(null);
  const [myProjects, setMyProjects] = useState([]);
  const [sharesOut, setSharesOut] = useState([]);
  const [shareBusy, setShareBusy] = useState(false);
  const refreshShares = useCallback(async () => {
    try { const sh = await api.get('/shares'); setSharesOut(Array.isArray(sh?.out) ? sh.out : []); } catch { /* keep last */ }
  }, [api]);
  const openShare = useCallback(async (friend) => {
    setShareTarget(friend);
    setShareBusy(true);
    try {
      const [pj, sh] = await Promise.all([api.get('/projects'), api.get('/shares')]);
      setMyProjects(Array.isArray(pj) ? pj.filter(Boolean) : []);
      setSharesOut(Array.isArray(sh?.out) ? sh.out : []);
    } catch {
      setMyProjects([]); setSharesOut([]);
    } finally {
      setShareBusy(false);
    }
  }, [api]);
  const doShare = useCallback(async (project) => {
    if (!shareTarget) return;
    setShareBusy(true);
    try { await api.post('/shares', { itemType: 'project', itemId: project, withUserId: shareTarget.id }); await refreshShares(); }
    catch { /* surfaced by no state change */ } finally { setShareBusy(false); }
  }, [api, shareTarget, refreshShares]);
  const unShare = useCallback(async (shareId) => {
    setShareBusy(true);
    try { await api.delete(`/shares/${shareId}`); await refreshShares(); }
    catch { /* keep */ } finally { setShareBusy(false); }
  }, [api, refreshShares]);
  const sharedWithTarget = shareTarget ? sharesOut.filter((s) => s.withUserId === shareTarget.id) : [];
  const durations = pomodoro.durations || { focus: DEFAULT_FOCUS_MINUTES, break: DEFAULT_BREAK_MINUTES };
  
  // Slash command autocomplete state
  const [slashCommands, setSlashCommands] = useState([]);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteSuggestions, setAutocompleteSuggestions] = useState([]);
  
  const inputRef = useRef(null);
  const scrollViewRef = useRef(null);

  // Fetch slash commands on mount
  useEffect(() => {
    const fetchSlashCommands = async () => {
      try {
        const response = await api.get('/turtle/commands');
        if (response.success) {
          setSlashCommands(response.commands || []);
        }
      } catch (error) {
        console.log('[Turtle] Failed to fetch slash commands:', error);
        // Fallback commands if server fails
        setSlashCommands([
          { command: '/note ', description: 'Save a quick note (#tag for board)' },
          { command: '/todo ', description: 'Add a todo (#tag for board)' },
          { command: '/pomodoro focus', description: 'Start 25m focus timer' },
          { command: '/pomodoro break', description: 'Start 5m break timer' },
          { command: '/pomodoro stop', description: 'Stop active timer' },
          { command: '/pomodoro stats', description: 'Show pomodoro stats' },
          { command: '/pomodoro settings', description: 'Adjust timer durations' },
          { command: '/photos', description: 'Open Photo Vault' },
          { command: '/photos upload', description: 'Upload photos to vault' },
          { command: '/vault', description: 'Open Password Vault' },
        ]);
      }
    };
    
    fetchSlashCommands();
  }, [api]);

  // Fetch chat history with lazy loading for inverted FlatList
  const fetchChatHistory = useCallback(async (isLoadMore = false) => {
    // Prevent overlapping fetches or fetching when we've hit the end
    if (isLoadingHistory || (!hasMoreHistory && isLoadMore)) return;

    try {
      setIsLoadingHistory(true);
      const currentOffset = isLoadMore ? historyOffset : 0;
      
      const res = await api.get(`/turtle/chat/history?limit=50&offset=${currentOffset}`);
      
      if (res && res.success) {
        // DO NOT .reverse() - Keep newest messages first for inverted list
        const formattedMessages = res.messages
          // Board-scoped conversation turns (source 'app' + a board) live in
          // their board thread (ConversationsOverlay), not the main chat.
          // Inbound SHARES keep their board and still show here — they're
          // notifications ("shared X to BoardY"), and their source is the
          // share channel, never 'app'.
          .filter(msg => !(msg.board && msg.source === 'app'))
          .map(msg => ({
          id: msg._id,
          text: msg.text,
          timestamp: msg.createdAt,
          sender: msg.user._id === 1 ? 'user' : 'assistant',
          isTelegram: msg.source === 'telegram'
        }));

        // APPEND older messages to the end of the array (visually the top of
        // the screen). Offset/hasMore track RAW server rows (pre-filter) so
        // paging never skips or stalls.
        setMessages(prev => isLoadMore ? [...prev, ...formattedMessages] : formattedMessages);
        setHistoryOffset(currentOffset + 50);
        setHasMoreHistory(res.messages.length === 50);
      }
    } catch (error) {
      console.error('[TurtleChat] Failed to load history:', error);
    } finally {
      setIsLoadingHistory(false);
    }
  }, [historyOffset, hasMoreHistory, isLoadingHistory, api]);

  // Pomodoro start/stop are emitted to the server; the synthetic timer card
  // (rendered below) reflects whatever the server reports for this session.
  // Since stop/complete acknowledgements come back through the socket, we
  // don't need to optimistically push system messages here.
  const handleStartTimer = useCallback((mode) => {
    pomodoro.start(mode);
  }, [pomodoro]);

  const handleStopTimer = useCallback(() => {
    pomodoro.stop();
  }, [pomodoro]);

  const handleCloseSettings = useCallback(() => {
    setShowSettings(false);
  }, []);

  const handleSaveSettings = useCallback(({ focusMinutes, breakMinutes }) => {
    pomodoro.updateDurations(focusMinutes, breakMinutes);
    const generateId = () => (Date.now() + Math.random()).toString();
    setMessages(prev => [{
      id: generateId(),
      text: `⚙️ Pomodoro settings updated: ${focusMinutes}m focus / ${breakMinutes}m break`,
      sender: 'system',
      timestamp: new Date().toISOString(),
    }, ...prev]);
  }, [pomodoro]);

  // Auto-hide the autocomplete whenever the input no longer starts with "/".
  // Covers every clear path (sending a slash command, manual erase, etc.)
  // without sprinkling setShowAutocomplete(false) at every site.
  useEffect(() => {
    if (!inputText.startsWith('/')) {
      setShowAutocomplete(false);
    }
  }, [inputText]);

  // Handle input changes for autocomplete
  const handleInputChange = (text) => {
    setInputText(text);
    
    // Show autocomplete when typing /
    if (text.startsWith('/')) {
      const query = text.toLowerCase();
      const suggestions = [];
      
      slashCommands.forEach(cmd => {
        // Match command (server returns flat list like "/pomodoro focus")
        if (cmd.command.toLowerCase().startsWith(query)) {
          suggestions.push({
            text: cmd.command,
            description: cmd.description,
          });
        }
      });
      
      setAutocompleteSuggestions(suggestions);
      setShowAutocomplete(suggestions.length > 0);
    } else {
      setShowAutocomplete(false);
    }
  };

  // Apply autocomplete suggestion
  const applySuggestion = (suggestion) => {
    setInputText(suggestion.text + ' ');
    setShowAutocomplete(false);
    inputRef.current?.focus();
  };

  // Initialize encryption key, then fetch history once on mount. Runs a SINGLE
  // time (empty deps): fetchChatHistory's identity changes after the first page
  // loads (its deps include historyOffset/hasMoreHistory), so depending on it
  // here previously re-fired a redundant page-0 refetch on every offset change.
  useEffect(() => {
    const DEV_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    setEncryptionKey(DEV_KEY);

    // Fetch real history from DB instead of a hardcoded welcome message
    fetchChatHistory(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addDebugLog = useCallback((stage, data) => {
    if (!debugMode) return;
    const logEntry = {
      id: Date.now().toString() + Math.random(),
      stage,
      data,
      timestamp: new Date().toLocaleTimeString(),
    };
    setDebugLogs(prev => [...prev, logEntry]);
    console.log(`[Turtle Debug] ${stage}:`, data);
  }, [debugMode]);

  const clearDebugLogs = () => setDebugLogs([]);

  // Handle opening vault with password
  const handleOpenVault = useCallback((password) => {
    console.log('[Turtle] Opening vault...');
    setVaultPassword(password);
    setIsVaultOpen(true);
  }, []);

  // Handle closing vault
  const handleCloseVault = useCallback(() => {
    console.log('[Turtle] Closing vault...');
    setIsVaultOpen(false);
    setVaultPassword(null);
  }, []);

  // Pick + attach an image to the next Claude message. Resizes to Claude's
  // recommended long-edge max (1568px) and JPEG-compresses so the base64
  // payload that rides the socket into the session stays small.
  const pickClaudeImage = useCallback(async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
      });
      if (res.canceled || !res.assets || !res.assets[0]) return;
      const asset = res.assets[0];
      const actions = asset.width && asset.width > 1568 ? [{ resize: { width: 1568 } }] : [];
      const out = await ImageManipulator.manipulateAsync(asset.uri, actions, {
        compress: 0.7,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: true,
      });
      if (out.base64) setClaudeImage({ base64: out.base64, mediaType: 'image/jpeg', uri: out.uri });
    } catch (e) {
      addDebugLog('Error', `Image pick failed: ${e.message}`);
    }
  }, [addDebugLog]);

  // Send message handler
  const sendMessage = useCallback(async (overrideText) => {
    const generateId = () => (Date.now() + Math.random()).toString();

    // overrideText (a string) lets the global CommandConsole inject a command
    // through this exact pipeline. The send button passes a press event (not a
    // string), so only honour a real string override; otherwise use the input.
    const injected = typeof overrideText === 'string' ? overrideText : null;
    const baseText = injected != null ? injected : inputText;

    // A Claude image with no caption is still sendable (image-only turn).
    const claudeImageReady = claudeUiMode === 'session' && !!claudeImage;
    if ((!baseText.trim() && !claudeImageReady) || !isConnected || !encryptionKey) {
      addDebugLog('Error', 'Missing Input, Connection, or Encryption Key');
      return;
    }

    const currentInput = baseText.trim();

    // Best-practice mobile chat UX: dismiss the keyboard the moment the user
    // sends so the response (or pomodoro card) is visible without manual tap.
    // Covers every command path below since they all go through this function.
    Keyboard.dismiss();
    setShowAutocomplete(false);
    
    // ===== COMMAND INTERCEPTION (BEFORE AI) =====

    // /terminal — open a remote shell on the server (PowerShell/bash) and
    // run commands. Output + the working dir stream into the TerminalConsole.
    //   /terminal stop  → close the shell
    const terminalCmd = currentInput.match(/^\/terminal\b\s*(.*)$/is);
    if (terminalCmd) {
      const rest = (terminalCmd[1] || '').trim();
      setInputText('');
      if (/^(stop|exit|quit|close|end)$/i.test(rest)) {
        terminalStop();
        return;
      }
      claudeClose(); // mutually exclusive panels — hide Claude if it's open
      setTerminalFullscreen(true); // open full-screen
      if (rest) terminalSend(rest); // lazily opens the shell server-side
      else terminalStart();
      return; // STOP HERE — handled by the Terminal console
    }

    // While the terminal is open, a plain message is a shell command.
    if (terminalOpen && !currentInput.startsWith('/')) {
      setInputText('');
      terminalSend(currentInput);
      return; // STOP HERE — run as a command, not the chat AI
    }

    // /claude — open or talk to a persistent Claude Code session running in
    // the turtle-app dir on your Max/Pro subscription. Subcommands:
    //   /claude login  → sign in from the chat
    //   /claude stop   → end the session (or cancel a sign-in)
    // While a session is open, plain messages route to Claude until stop.
    const claudeCmd = currentInput.match(/^\/claude\b\s*(.*)$/is);
    if (claudeCmd) {
      const rest = (claudeCmd[1] || '').trim();
      setInputText('');
      if (/^(stop|exit|quit|end)$/i.test(rest)) {
        if (claudeUiMode === 'login') claudeLoginStop();
        else claudeStop();
        return;
      }
      if (/^login$/i.test(rest)) {
        terminalClose();
        claudeLogin();          // streams the sign-in URL into the console
        return;
      }
      // /claude admin <password> — full-access session (password gate + JWT).
      const adminMatch = rest.match(/^admin\b\s*(.*)$/is);
      if (adminMatch) {
        terminalClose();
        claudeStartAdmin((adminMatch[1] || '').trim()); // password sent, not echoed
        return;
      }
      terminalClose();          // mutually exclusive panels — hide the terminal
      if (rest) { const img = claudeImage; setClaudeImage(null); claudeSend(rest, img); } // lazily opens the session
      else claudeStart();
      return; // STOP HERE — handled by the Claude console
    }

    // While signing in, a plain message is the pasted OAuth code.
    if (claudeUiMode === 'login' && !currentInput.startsWith('/')) {
      setInputText('');
      claudeLoginInput(currentInput);
      return; // STOP HERE — routed to the sign-in flow
    }

    // While a Claude session is open, plain messages go to it — with an
    // optional attached image, sent as a base64 block into the session.
    if (claudeUiMode === 'session' && !currentInput.startsWith('/')) {
      setInputText('');
      const img = claudeImage;
      setClaudeImage(null);
      claudeSend(currentInput, img);
      return; // STOP HERE — routed to Claude, not the chat AI
    }

    // Check for /vault command
    const vaultMatch = currentInput.match(VAULT_COMMAND_REGEX);
    if (vaultMatch) {
      const password = vaultMatch[1] || null;
      console.log('[Turtle] Vault command detected');
      
      setMessages(prev => [{
        id: generateId(),
        text: currentInput,
        sender: 'user',
        timestamp: new Date().toISOString(),
      }, ...prev]);
      
      setInputText('');
      handleOpenVault(password);
      
      setMessages(prev => [{
        id: generateId(),
        text: '🔐 Opening Password Vault...',
        sender: 'system',
        timestamp: new Date().toISOString(),
      }, ...prev]);
      
      return; // STOP HERE - don't send to AI
    }

    // Check for local /search command (don't send to AI)
    if (currentInput.toLowerCase().startsWith('/search')) {
      setInputText('');
      Keyboard.dismiss();
      return; 
    }

    // Check for /pomodoro commands
    if (currentInput === '/pomodoro focus' || currentInput.startsWith('/pomodoro focus ')) {
      console.log('[Turtle] Pomodoro focus command detected');
      
      setMessages(prev => [{
        id: generateId(),
        text: currentInput,
        sender: 'user',
        timestamp: new Date().toISOString(),
      }, ...prev]);
      
      setInputText('');
      handleStartTimer('focus');
      
      return; // STOP HERE - don't send to AI
    }
    
    if (currentInput === '/pomodoro break' || currentInput.startsWith('/pomodoro break ')) {
      console.log('[Turtle] Pomodoro break command detected');
      
      setMessages(prev => [{
        id: generateId(),
        text: currentInput,
        sender: 'user',
        timestamp: new Date().toISOString(),
      }, ...prev]);
      
      setInputText('');
      handleStartTimer('break');
      
      return; // STOP HERE - don't send to AI
    }
    
    if (currentInput === '/pomodoro stop') {
      console.log('[Turtle] Pomodoro stop command detected');
      
      setMessages(prev => [{
        id: generateId(),
        text: currentInput,
        sender: 'user',
        timestamp: new Date().toISOString(),
      }, ...prev]);
      
      setInputText('');
      handleStopTimer();
      
      return; // STOP HERE - don't send to AI
    }
    
    if (currentInput === '/pomodoro settings') {
      console.log('[Turtle] Pomodoro settings command detected');

      setMessages(prev => [{
        id: generateId(),
        text: currentInput,
        sender: 'user',
        timestamp: new Date().toISOString(),
      }, ...prev]);

      setInputText('');
      setShowSettings(true);

      setMessages(prev => [{
        id: generateId(),
        text: '⚙️ Opening Pomodoro settings...',
        sender: 'system',
        timestamp: new Date().toISOString(),
      }, ...prev]);

      return; // STOP HERE - don't send to AI
    }

    if (currentInput === '/pomodoro stats') {
      console.log('[Turtle] Pomodoro stats command detected');

      setMessages(prev => [{
        id: generateId(),
        text: currentInput,
        sender: 'user',
        timestamp: new Date().toISOString(),
      }, ...prev]);

      setInputText('');

      try {
        const stats = await api.get(
          `/pomodoro/stats?sessionId=${encodeURIComponent(pomodoro.sessionId)}&limit=200`
        );
        setMessages(prev => [{
          id: generateId(),
          type: 'stats',
          stats,
          sender: 'system',
          timestamp: new Date().toISOString(),
          text: '',
        }, ...prev]);
      } catch (err) {
        setMessages(prev => [{
          id: generateId(),
          text: `⚠️ Could not load stats: ${err && err.message ? err.message : err}`,
          sender: 'system',
          timestamp: new Date().toISOString(),
        }, ...prev]);
      }

      return; // STOP HERE - don't send to AI
    }
    
    // Check for /photos commands
    if (currentInput === '/photos') {
      console.log('[Turtle] Photos command detected');
      
      setMessages(prev => [{
        id: generateId(),
        text: currentInput,
        sender: 'user',
        timestamp: new Date().toISOString(),
      }, ...prev]);
      
      setInputText('');
      setIsLoading(false);
      setIsGalleryOpen(true);
      
      setMessages(prev => [{
        id: generateId(),
        text: '📸 Opening Photo Vault...',
        sender: 'system',
        timestamp: new Date().toISOString(),
      }, ...prev]);
      
      return; // STOP HERE - don't send to AI
    }
    
    // Check for /photos upload command - opens gallery in upload mode
    if (currentInput === '/photos upload') {
      console.log('[Turtle] Photos upload command detected');
      
      setMessages(prev => [{
        id: generateId(),
        text: currentInput,
        sender: 'user',
        timestamp: new Date().toISOString(),
      }, ...prev]);
      
      setInputText('');
      setIsLoading(false);
      // Open gallery and trigger upload immediately
      setGalleryAutoUpload(true);
      setIsGalleryOpen(true);
      
      setMessages(prev => [{
        id: generateId(),
        text: '📸 Opening Photo Vault for upload...',
        sender: 'system',
        timestamp: new Date().toISOString(),
      }, ...prev]);
      
      return; // STOP HERE - don't send to AI
    }
    
    // /note <text> — create a plain note via /api/turtle/note. The
    // server-side handler is shared with the web app's /note slash
    // command and the share extension (when text is shared without an
    // image). We support an optional project-tag suffix with `#tag`
    // patterns, matching the web command's syntax.
    // Examples:
    //   /note Buy more filament #3D PRINT
    //   /note Remember to email Sarah
    {
      const m = currentInput.match(/^\/note\s+(.+)$/i);
      if (m) {
        const raw = m[1].trim();
        // Pull out any #tag tokens. Stop at the first non-tag word so a
        // hashtag in the middle of a sentence isn't accidentally consumed.
        const tags = [];
        const content = raw.replace(/(^|\s)#([\w\-][\w\- ]*?)(?=$|\s#)/g, (full, lead, tag) => {
          tags.push(tag.trim());
          return '';
        }).trim();

        setMessages(prev => [{
          id: generateId(),
          text: currentInput,
          sender: 'user',
          timestamp: new Date().toISOString(),
        }, ...prev]);
        setInputText('');
        setIsLoading(false);

        try {
          const res = await api.post('/turtle/note', {
            content: content || raw,
            description: '',
            type: 'note',
            tags,
            done: false,
          });
          setMessages(prev => [{
            id: generateId(),
            text: res?.success === false
              ? `⚠️ Could not save: ${res?.error || 'unknown error'}`
              : `📝 Note saved${tags.length ? ` · tags: ${tags.join(', ')}` : ''}`,
            sender: 'system',
            timestamp: new Date().toISOString(),
          }, ...prev]);
        } catch (e) {
          setMessages(prev => [{
            id: generateId(),
            text: `⚠️ Could not save note: ${e.message || e}`,
            sender: 'system',
            timestamp: new Date().toISOString(),
          }, ...prev]);
        }
        return;
      }
    }

    // /todo <text> — same as /note but creates a todo (type='todo'),
    // surfaced separately in the NotesScreen filter. Same #tag suffix
    // support.
    {
      const m = currentInput.match(/^\/todo\s+(.+)$/i);
      if (m) {
        const raw = m[1].trim();
        const tags = [];
        const content = raw.replace(/(^|\s)#([\w\-][\w\- ]*?)(?=$|\s#)/g, (full, lead, tag) => {
          tags.push(tag.trim());
          return '';
        }).trim();

        setMessages(prev => [{
          id: generateId(),
          text: currentInput,
          sender: 'user',
          timestamp: new Date().toISOString(),
        }, ...prev]);
        setInputText('');
        setIsLoading(false);

        try {
          const res = await api.post('/turtle/note', {
            content: content || raw,
            description: '',
            type: 'todo',
            tags,
            done: false,
          });
          setMessages(prev => [{
            id: generateId(),
            text: res?.success === false
              ? `⚠️ Could not save: ${res?.error || 'unknown error'}`
              : `✅ Todo added${tags.length ? ` · tags: ${tags.join(', ')}` : ''}`,
            sender: 'system',
            timestamp: new Date().toISOString(),
          }, ...prev]);
        } catch (e) {
          setMessages(prev => [{
            id: generateId(),
            text: `⚠️ Could not save todo: ${e.message || e}`,
            sender: 'system',
            timestamp: new Date().toISOString(),
          }, ...prev]);
        }
        return;
      }
    }

    // ===== END COMMAND INTERCEPTION =====

    // Add user message to chat
    const userMessage = {
      id: generateId(),
      text: currentInput,
      sender: 'user',
      timestamp: new Date().toISOString(),
    };

    setMessages(prev => [userMessage, ...prev]);
    setInputText('');
    setIsLoading(true);
    clearDebugLogs();

    try {
      addDebugLog('AI Request', `Sending: "${currentInput}"`);
      
      // Prepare chat history
      const chatHistoryArray = messages
        .filter(msg => msg.sender === 'user' || msg.sender === 'assistant')
        .slice(0, 10) // Grab 10 newest
        .reverse() // Flip chronological for AI context
        .map(msg => ({
          role: msg.sender === 'user' ? 'user' : 'assistant',
          content: msg.text
        }));
      
      // Send to AI
      const aiResponse = await api.post('/turtle/chat', {
        message: currentInput,
        history: chatHistoryArray,
      });

      const { reply, intent } = aiResponse;

      // Add AI reply
      setMessages(prev => [{
        id: generateId(),
        text: reply || 'Command processed.',
        sender: 'assistant',
        timestamp: new Date().toISOString(),
      }, ...prev]);

      // Handle encrypted intent if present
      if (intent && typeof intent === 'object' && intent.payload) {
        const serverUrl = getBaseUrl();
        const result = await interceptAndSend(
          intent,
          encryptionKey,
          serverUrl,
          token,
          addDebugLog
        );

        if (result.success) {
          const executionResult = result.serverResponse?.data?.result;
          const resultText = typeof executionResult === 'string' 
            ? executionResult 
            : JSON.stringify(executionResult, null, 2);

          setMessages(prev => [{
            id: generateId(),
            text: `✅ Intent executed:\n${resultText}`,
            sender: 'system',
            timestamp: new Date().toISOString(),
          }, ...prev]);
        }
      }
    } catch (error) {
      console.error('[AI Chat] Error:', error);
      setMessages(prev => [{
        id: generateId(),
        text: `⚠️ ${error.message}`,
        sender: 'error',
        timestamp: new Date().toISOString(),
      }, ...prev]);
    } finally {
      setIsLoading(false);
    }
  }, [inputText, claudeImage, isConnected, encryptionKey, getBaseUrl, api, messages, token, debugMode, addDebugLog, handleOpenVault, handleStartTimer, handleStopTimer, durations, claudeUiMode, claudeSend, claudeStart, claudeStartAdmin, claudeStop, claudeLogin, claudeLoginInput, claudeLoginStop, claudeClose, terminalOpen, terminalSend, terminalStart, terminalStop, terminalClose]);

  // Consume a command pushed from the global CommandConsole. Fires once per
  // dispatch through the same send pipeline as typing it; waits for the
  // connection + encryption key so an early dispatch isn't dropped.
  useEffect(() => {
    if (pendingCommand && isConnected && encryptionKey) {
      sendMessage(pendingCommand);
      clearPendingCommand();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCommand, isConnected, encryptionKey]);

  const styles = createStyles(theme, insets);

  // Show Media Gallery overlay when open
  if (isGalleryOpen) {
    return (
      <View style={[styles.container, { flex: 1 }]}>
        <MediaGallery 
          onClose={() => {
            setIsGalleryOpen(false);
            setGalleryAutoUpload(false);
          }} 
          autoUpload={galleryAutoUpload}
        />
      </View>
    );
  }

  // Smoothly ease the chat layout whenever a top-of-chat element is added or
  // removed (the queued-task banner, the finished banner, or the pomodoro card).
  // Without this the messages list snaps to its new height the instant the
  // banner mounts, so the session view briefly collides with / is overset by the
  // absolute header. Diffing a signature DURING render schedules the animation
  // for THIS commit — a useEffect would fire one commit too late and miss the
  // first appearance (the exact case the user hit).
  const chatTopLayoutSig = `${claudeQueue.length > 0}|${showDoneBanner}|${!!pomodoro.state}`;
  const prevChatTopLayoutSig = useRef(chatTopLayoutSig);
  if (prevChatTopLayoutSig.current !== chatTopLayoutSig) {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    prevChatTopLayoutSig.current = chatTopLayoutSig;
  }

  return (
    <Reanimated.View
      // Column lift is ALWAYS attached; the worklet itself returns 0 in a Claude
      // session (where the background must stay static and the dock lifts
      // instead). Gating inside the worklet — not by swapping for null here —
      // avoids a stale transform sticking on the session→chat handoff.
      style={[styles.container, { flex: 1 }, keyboardSpacerStyle]}
    >
      {/* Faint turtle watermark — a WhatsApp-style chat backdrop. First child
          so it sits behind everything; the inverted message list above is
          transparent, so it shows through softly between bubbles. Tinted +
          extremely low opacity so it never competes with the messages. */}
      <View pointerEvents="none" style={styles.chatWatermarkWrap}>
        <Image
          source={turtleLogo}
          style={styles.chatWatermark}
          contentFit="contain"
          tintColor={theme.colors.textPrimary}
        />
      </View>

      {/* Chat header bar — Friends (left), the Turtle brand (centre) and
          Settings (right) on one solid bar pinned to the top. Replaces the
          old free-floating corner icons + bare safe-area tint strip: the two
          actions now read as a proper header. It overlays the inverted
          message list (WhatsApp-style — messages scroll beneath it); the list
          gets a matching top inset (CHAT_HEADER_BAR_HEIGHT) so the oldest
          visible message clears the bar. zIndex stays 101 (below the vault
          overlay at 200, so the vault still covers the header). */}
      <Reanimated.View style={[styles.chatHeader, { paddingTop: insets.top }, headerCounterStyle]}>
        {/* Left cluster: Friends + Conversations. Both side clusters share a
            fixed width (styles.headerSideWrap) so the flex:1 title between
            them stays dead-centre despite the uneven icon counts. */}
        <View style={[styles.headerSideWrap, { justifyContent: 'flex-start' }]}>
          <TouchableOpacity
            onPress={openFriends}
            hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
            style={styles.headerIconButton}
            accessibilityLabel="Open friends"
            accessibilityRole="button"
          >
            <Icon name="account-multiple-outline" size={22} color={theme.colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => { tapHaptic(); setShowConversations(true); }}
            hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
            style={styles.headerIconButton}
            accessibilityLabel="Open board conversations"
            accessibilityRole="button"
          >
            <Icon name="forum-outline" size={21} color={theme.colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.headerTitleWrap}
          activeOpacity={1}
          delayLongPress={400}
          onLongPress={() => {
            // Hidden power gesture: long-press the turtle to drop into the server
            // terminal. Buzz so the open is confirmed by feel.
            confirmBuzz();
            claudeClose();                 // mutually exclusive with the Claude panel
            setTerminalFullscreen(true);   // open full-screen
            terminalStart();               // lazily opens the shell server-side
          }}
          accessibilityRole="button"
          accessibilityLabel="Turtle"
          accessibilityHint="Long-press to open the server terminal"
        >
          <Image
            source={turtleLogo}
            style={styles.headerLogo}
            contentFit="contain"
            tintColor={theme.colors.textPrimary}
          />
          <Text style={styles.headerTitle}>Turtle</Text>
        </TouchableOpacity>

        <View style={[styles.headerSideWrap, { justifyContent: 'flex-end' }]}>
          <TouchableOpacity
            onPress={() => { tapHaptic(); setShowLinkDesktop(true); }}
            hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
            style={styles.headerIconButton}
            accessibilityLabel="Link a desktop"
            accessibilityRole="button"
          >
            <Icon name="monitor-cellphone" size={21} color={theme.colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setShowAppSettings(true)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={styles.headerIconButton}
            accessibilityLabel="Open settings"
            accessibilityRole="button"
          >
            <Icon name="cog-outline" size={22} color={theme.colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </Reanimated.View>

      {/* Friends — a pushed PAGE (slides in from the right; swipe the left edge
          to go back to the Turtle tab), org members + a search box + invites. */}
      <EdgeSwipePage visible={showFriends} onClose={() => setShowFriends(false)}>
        <View style={{ flex: 1 }}>
          <View style={[styles.settingsSheetHeader, { paddingTop: insets.top + 6, justifyContent: 'flex-start', alignItems: 'center' }]}>
            <TouchableOpacity
              onPress={() => setShowFriends(false)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={styles.settingsCloseButton}
              accessibilityLabel="Back"
            >
              <Icon name="chevron-left" size={28} color={theme.colors.textPrimary} />
            </TouchableOpacity>
            <Text style={{ fontSize: 17, fontWeight: '700', color: theme.colors.textPrimary }}>Friends</Text>
          </View>

          <View style={{ paddingHorizontal: 16, paddingBottom: 10, gap: 10 }}>
            {/* Prominent search — bigger, accent-ringed, with a clearer
                placeholder so looking someone up is the obvious first action. */}
            <View style={styles.friendSearchBox}>
              <Icon name="magnify" size={20} color={theme.colors.accentInfo} />
              <TextInput
                style={styles.friendSearchInput}
                placeholder="Search friends by name or number"
                placeholderTextColor={theme.colors.textTertiary}
                value={friendQuery}
                onChangeText={setFriendQuery}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {friendQuery.length > 0 && (
                <TouchableOpacity onPress={() => setFriendQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Icon name="close-circle" size={18} color={theme.colors.textTertiary} />
                </TouchableOpacity>
              )}
            </View>

            {/* Invite row — pick from the phone's contacts, or punch in a
                number by hand. Both feed POST /api/auth/invites (owner-only;
                non-owners get a friendly note). */}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity
                style={styles.inviteContactsBtn}
                onPress={pickContactToInvite}
                activeOpacity={0.85}
                accessibilityLabel="Invite a friend from your contacts"
              >
                <Icon name="account-box-multiple-outline" size={18} color="#fff" />
                <Text style={styles.inviteContactsText}>Invite from contacts</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.inviteManualBtn, inviteOpen && { borderColor: theme.colors.accentInfo }]}
                onPress={() => { setInviteOpen((v) => !v); setInviteNote(null); }}
                activeOpacity={0.7}
                accessibilityLabel="Invite by typing a phone number"
              >
                <Icon name="dialpad" size={18} color={theme.colors.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.inviteManualBtn, inviteLinkBusy && { opacity: 0.5 }]}
                onPressIn={() => tapHaptic()}
                onPress={shareInviteLink}
                disabled={inviteLinkBusy}
                activeOpacity={0.7}
                accessibilityLabel="Share an invite link"
              >
                <Icon name="link-variant" size={18} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Manual phone entry — revealed by the dialpad button. */}
            {inviteOpen && (
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <View style={[styles.friendSearchBox, { flex: 1, height: 44 }]}>
                  <Icon name="phone-plus-outline" size={18} color={theme.colors.textTertiary} />
                  <TextInput
                    style={styles.friendSearchInput}
                    placeholder="Phone, e.g. +1 415 555 0100"
                    placeholderTextColor={theme.colors.textTertiary}
                    value={invitePhone}
                    onChangeText={setInvitePhone}
                    keyboardType="phone-pad"
                    autoCorrect={false}
                    onSubmitEditing={() => inviteByPhone(invitePhone)}
                  />
                </View>
                <TouchableOpacity
                  style={[styles.inviteSendBtn, inviteBusy && { opacity: 0.6 }]}
                  disabled={inviteBusy}
                  onPressIn={() => impactHaptic('medium')}
                  onPress={() => inviteByPhone(invitePhone)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.inviteSendText}>{inviteBusy ? '…' : 'Invite'}</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Inline result banner — ok (green) or error (red). */}
            {inviteNote && (
              <View
                style={[
                  styles.inviteNote,
                  inviteNote.type === 'ok'
                    ? { backgroundColor: 'rgba(52,199,89,0.12)' }
                    : { backgroundColor: 'rgba(255,69,58,0.12)' },
                ]}
              >
                <Icon
                  name={inviteNote.type === 'ok' ? 'check-circle' : 'alert-circle'}
                  size={15}
                  color={inviteNote.type === 'ok' ? '#34c759' : '#ff453a'}
                />
                <Text style={[styles.inviteNoteText, { color: theme.colors.textSecondary }]}>{inviteNote.text}</Text>
              </View>
            )}

            {/* Copy/share the just-created invitee link — lets the owner send it
                by hand when the auto-text didn't land. */}
            {inviteResult && (
              <View style={styles.inviteLinkCard}>
                <Text style={[styles.inviteLinkLabel, { color: theme.colors.textTertiary }]}>
                  Invite link for {inviteResult.phone}
                </Text>
                <Text
                  style={[styles.inviteLinkUrl, { color: theme.colors.textSecondary }]}
                  numberOfLines={1}
                  ellipsizeMode="middle"
                >
                  {inviteResult.joinUrl}
                </Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  <TouchableOpacity
                    style={[styles.inviteSendBtn, { flex: 1, flexDirection: 'row', justifyContent: 'center', gap: 6 }, inviteCopied && { backgroundColor: '#34c759' }]}
                    onPressIn={() => tapHaptic()}
                    onPress={copyInviteLink}
                    activeOpacity={0.85}
                  >
                    <Icon name={inviteCopied ? 'check' : 'content-copy'} size={16} color="#fff" />
                    <Text style={styles.inviteSendText}>{inviteCopied ? 'Copied!' : 'Copy link'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.inviteManualBtn, { width: 'auto', paddingHorizontal: 14, flexDirection: 'row', gap: 6 }]}
                    onPress={shareInviteResult}
                    activeOpacity={0.7}
                  >
                    <Icon name="share-variant" size={16} color={theme.colors.textSecondary} />
                    <Text style={{ color: theme.colors.textSecondary, fontWeight: '600' }}>Share</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}>
            {friendsLoading ? (
              <Text style={styles.friendEmpty}>Loading…</Text>
            ) : filteredFriends.length === 0 && filteredPending.length === 0 ? (
              <Text style={styles.friendEmpty}>
                {friendQuery
                  ? 'No matches.'
                  : 'No turtles in your pond yet. The owner can invite people by phone in Settings → your Pond.'}
              </Text>
            ) : (
              <>
                {filteredFriends.map((f) => {
                  const uri = friendAvatarUri(f);
                  return (
                  <TouchableOpacity key={f.id} style={styles.friendRow} activeOpacity={0.6} onPress={() => setSelectedFriend(f)} accessibilityLabel={`Open ${f.displayName || f.phone || 'member'}'s profile`}>
                    <View style={styles.friendAvatar}>
                      {uri ? (
                        <Image source={{ uri }} style={styles.friendAvatarImg} contentFit="cover" transition={120} />
                      ) : (
                        <Icon
                          name={f.role === 'owner' ? 'crown-outline' : 'account'}
                          size={18}
                          color={f.role === 'owner' ? '#f5a623' : theme.colors.textSecondary}
                        />
                      )}
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.friendName} numberOfLines={1}>{f.displayName || f.phone || 'Member'}</Text>
                      <Text style={styles.friendSub} numberOfLines={1}>
                        {f.role === 'owner' ? 'Owner' : 'Member'}
                        {f.joined ? '' : ' · not signed in yet'}
                        {f.displayName && f.phone ? ` · ${f.phone}` : ''}
                      </Text>
                    </View>
                    <Icon name="chevron-right" size={20} color={theme.colors.textTertiary} />
                  </TouchableOpacity>
                  );
                })}
                {filteredPending.length > 0 && <Text style={styles.friendSectionLabel}>Invited (pending)</Text>}
                {filteredPending.map((p) => (
                  <TouchableOpacity
                    key={`pending-${p.phone}`}
                    style={styles.friendRow}
                    activeOpacity={0.6}
                    onPress={() => setSelectedFriend({ phone: p.phone, pending: true, invitedAt: p.invitedAt, joined: false, role: 'member' })}
                    accessibilityLabel={`Open invite status for ${p.phone}`}
                  >
                    <View style={styles.friendAvatar}>
                      <Icon name="clock-outline" size={18} color={theme.colors.textTertiary} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.friendName} numberOfLines={1}>{p.phone}</Text>
                      <Text style={styles.friendSub}>Invited — hasn't joined yet</Text>
                    </View>
                    <Icon name="chevron-right" size={20} color={theme.colors.textTertiary} />
                  </TouchableOpacity>
                ))}
              </>
            )}

            {/* Developer accounts — owner only. Phones that sign in with the
                fixed code + no SMS, for testing numbers that can't get OTP. */}
            {isOwner && (
              <View style={{ marginTop: 18 }}>
                <Text style={styles.friendSectionLabel}>Developer accounts</Text>
                <Text style={[styles.inviteNoteText, { color: theme.colors.textTertiary, marginLeft: 2, marginBottom: 10 }]}>
                  Test logins that sign in with code {devCode} and no SMS.
                </Text>

                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  <View style={[styles.friendSearchBox, { flex: 1, height: 44 }]}>
                    <Icon name="account-cog-outline" size={18} color={theme.colors.textTertiary} />
                    <TextInput
                      style={styles.friendSearchInput}
                      placeholder="Phone, e.g. +1 415 555 0100"
                      placeholderTextColor={theme.colors.textTertiary}
                      value={devPhone}
                      onChangeText={setDevPhone}
                      keyboardType="phone-pad"
                      autoCorrect={false}
                      onSubmitEditing={() => addDevAccount(devPhone)}
                    />
                  </View>
                  <TouchableOpacity
                    style={[styles.inviteSendBtn, devBusy && { opacity: 0.6 }]}
                    disabled={devBusy}
                    onPressIn={() => impactHaptic('medium')}
                    onPress={() => addDevAccount(devPhone)}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.inviteSendText}>{devBusy ? '…' : 'Add'}</Text>
                  </TouchableOpacity>
                </View>

                {devNote && (
                  <View
                    style={[
                      styles.inviteNote,
                      devNote.type === 'ok'
                        ? { backgroundColor: 'rgba(52,199,89,0.12)' }
                        : { backgroundColor: 'rgba(255,69,58,0.12)' },
                    ]}
                  >
                    <Icon
                      name={devNote.type === 'ok' ? 'check-circle' : 'alert-circle'}
                      size={15}
                      color={devNote.type === 'ok' ? '#34c759' : '#ff453a'}
                    />
                    <Text style={[styles.inviteNoteText, { color: theme.colors.textSecondary }]}>{devNote.text}</Text>
                  </View>
                )}

                {devAccounts.length === 0 ? (
                  <Text style={[styles.friendEmpty, { textAlign: 'left', paddingVertical: 12 }]}>
                    No developer accounts yet.
                  </Text>
                ) : (
                  devAccounts.map((d) => (
                    <View key={`dev-${d.phone}`} style={styles.friendRow}>
                      <View style={styles.friendAvatar}>
                        <Icon name="account-cog" size={18} color={theme.colors.accentInfo} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.friendName} numberOfLines={1}>{d.label || d.phone}</Text>
                        <Text style={styles.friendSub} numberOfLines={1}>
                          Developer · code {devCode}{d.label ? ` · ${d.phone}` : ''}
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPressIn={() => notifyHaptic('warning')}
                        onPress={() => removeDevAccount(d.phone)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        accessibilityLabel={`Remove developer account ${d.phone}`}
                      >
                        <Icon name="trash-can-outline" size={18} color={theme.colors.accentError} />
                      </TouchableOpacity>
                    </View>
                  ))
                )}
              </View>
            )}
          </ScrollView>

          {/* Member profile — a page that slides in OVER the friends list. It
              lives INSIDE the Friends page (overlay) on purpose: a second
              sibling Modal won't present over the first on iOS. */}
          <FriendCard
            friend={selectedFriend}
            serverBase={serverBase}
            onClose={() => setSelectedFriend(null)}
            onShare={(f) => openShare(f)}
            isOwner={isOwner}
            devCode={devCode}
            isDevAccount={
              !!selectedFriend?.phone &&
              devAccounts.some((d) => normalizePhone(d.phone) === normalizePhone(selectedFriend.phone))
            }
            onAssignDev={assignDevFromCard}
            onRemoveDev={removeDevAccount}
          />

          {/* Share-a-project — a page over the profile. Also an `overlay` nested
              in the Friends tree (a sibling Modal won't present over the others
              on iOS). Lists your projects; tap to share view-only / un-share. */}
          <EdgeSwipePage overlay visible={!!shareTarget} onClose={() => setShareTarget(null)}>
            <View style={{ flex: 1, paddingTop: insets.top + 6 }}>
              <View style={[styles.settingsSheetHeader, { justifyContent: 'flex-start', alignItems: 'center' }]}>
                <TouchableOpacity onPress={() => setShareTarget(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={styles.settingsCloseButton} accessibilityLabel="Back">
                  <Icon name="chevron-left" size={28} color={theme.colors.textPrimary} />
                </TouchableOpacity>
                <Text style={{ fontSize: 17, fontWeight: '700', color: theme.colors.textPrimary, flex: 1 }} numberOfLines={1}>
                  Share with {shareTarget?.displayName || shareTarget?.phone || 'friend'}
                </Text>
              </View>
              <Text style={[styles.friendSub, { paddingHorizontal: 20, marginBottom: 8 }]}>
                Pick a board to share, view-only. They'll see its tasks in their planner.
              </Text>
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}>
                {myProjects.length === 0 ? (
                  <Text style={styles.friendEmpty}>{shareBusy ? 'Loading…' : 'You have no boards to share yet.'}</Text>
                ) : (
                  myProjects.map((proj) => {
                    const shared = sharedWithTarget.find((s) => s.project === proj);
                    return (
                      <View key={proj} style={styles.friendRow}>
                        <View style={styles.friendAvatar}>
                          <Icon name="folder-outline" size={18} color={theme.colors.textSecondary} />
                        </View>
                        <Text style={[styles.friendName, { flex: 1 }]} numberOfLines={1}>{proj}</Text>
                        {shared ? (
                          <TouchableOpacity disabled={shareBusy} onPressIn={() => notifyHaptic('warning')} onPress={() => unShare(shared.id)} style={[styles.shareChip, { backgroundColor: theme.colors.surfaceElevated }]}>
                            <Icon name="check" size={15} color="#34c759" />
                            <Text style={[styles.shareChipText, { color: theme.colors.textSecondary }]}>Shared</Text>
                          </TouchableOpacity>
                        ) : (
                          <TouchableOpacity disabled={shareBusy} onPressIn={() => tapHaptic()} onPress={() => doShare(proj)} style={[styles.shareChip, { backgroundColor: theme.colors.primary || '#0a84ff' }]}>
                            <Icon name="account-plus-outline" size={15} color="#fff" />
                            <Text style={[styles.shareChipText, { color: '#fff' }]}>Share</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })
                )}
              </ScrollView>
            </View>
          </EdgeSwipePage>
        </View>
      </EdgeSwipePage>

      {/* Conversation boards — messenger inbox of per-board threads (list +
          board conversation with board-scoped Turtle AI). Sibling Modal of the
          Friends page; never open at the same time as it. */}
      <ConversationsOverlay visible={showConversations} onClose={() => setShowConversations(false)} />

      {/* Link a desktop — scan the QR the Turtle desktop app shows to sign it in. */}
      <LinkDesktop visible={showLinkDesktop} onClose={() => setShowLinkDesktop(false)} />

      {/* Full-screen Settings sheet — slides up from the bottom on
          tap of the gear above. Wrapping the screen in a Modal keeps
          its own scroll / safe-area handling intact and ensures the
          Turtle page underneath stays mounted (chat history, pomodoro
          socket, etc. aren't torn down when you dip into Settings). */}
      <Modal
        visible={showAppSettings}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowAppSettings(false)}
      >
        <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
          {/* iOS pageSheet already sits below the status bar, so the full
              safe-area inset here just bloated the top. Use a small fixed
              pad on iOS; Android renders the Modal full-screen so it still
              needs the real status-bar inset. */}
          <View style={[styles.settingsSheetHeader, { paddingTop: Platform.OS === 'android' ? insets.top + 6 : 12 }]}>
            <TouchableOpacity
              onPress={() => setShowAppSettings(false)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={styles.settingsCloseButton}
              accessibilityLabel="Close settings"
            >
              <Icon name="close" size={22} color={theme.colors.textPrimary} />
            </TouchableOpacity>
          </View>
          {/* `active` gates the Settings screen's live polling (e.g. the
              AI Sidecar status card) to only while this sheet is open, so
              we don't poll the server every 10 s for the app's whole life. */}
          <SettingsScreen active={showAppSettings} />
        </View>
      </Modal>

      {/* Messages (Inverted Physics) — FlashList for windowed, recycled rows.
          FlashList ignores a `style` prop, so the flex:1 sizing that used to
          live on the list now lives on this wrapper View. */}
      <View style={styles.messagesContainer}>
      <FlashList
        ref={scrollViewRef}
        contentContainerStyle={{
          // Chronological (non-inverted) list: paddingTop reserves room for the
          // chat header bar above; paddingBottom is clearance under the composer
          // dock so the newest message isn't hidden behind it.
          // (FlashList's contentContainerStyle only supports padding — the rest
          // of styles.messagesContent was just flexGrow + horizontal padding.)
          paddingHorizontal: theme.spacing.sm,
          paddingTop: insets.top + CHAT_HEADER_BAR_HEIGHT,
          paddingBottom: dockHeight,
        }}
        showsVerticalScrollIndicator={false}
        // FlashList v2 has no `inverted`; this keeps the newest message pinned to
        // the bottom like every messenger. Starts rendering from the bottom, and
        // auto-scrolls to the newest message when one arrives and the user is
        // already near the bottom (won't yank them up while reading history).
        maintainVisibleContentPosition={{
          startRenderingFromBottom: true,
          autoscrollToBottomThreshold: 0.2,
        }}
        // Instagram / iMessage-style keyboard handling:
        //   - "interactive" on iOS lets the keyboard slide down proportionally
        //     as the user drags the message list, then snap closed.
        //   - "on-drag" on Android dismisses on the first scroll gesture
        //     (Android doesn't support "interactive").
        //   - "handled" persistence ensures taps on TouchableOpacity (avatars,
        //     the autocomplete suggestions, etc.) still register, while taps
        //     on plain message background dismiss the keyboard.
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        keyboardShouldPersistTaps="handled"
        onScroll={handleChatScroll}
        scrollEventThrottle={16}
        data={chronologicalMessages}
        keyExtractor={(item) => item.id}
        // Older history lives at the TOP now, so load more when the user nears
        // the start of the list (MVCP holds their scroll position when it lands).
        onStartReached={() => {
          if (hasMoreHistory && !isLoadingHistory) fetchChatHistory(true);
        }}
        onStartReachedThreshold={0.5}
        ListFooterComponent={
          isLoading ? (
            <View style={styles.loadingBubble}>
              <Text style={styles.loadingText}>Turtle is typing...</Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Image source={turtleIcon} style={styles.watermarkImage} contentFit="contain" />
            <Text style={styles.emptyTitle}>Chat with Turtle</Text>
            <Text style={styles.emptyText}>Ask me anything about your tasks, passwords, or just chat!</Text>
            <Text style={styles.emptyHintLabel}>TRY A COMMAND</Text>
            <View style={styles.emptyHints}>
              {[
                { cmd: '/note', desc: 'Save a quick note' },
                { cmd: '/pomodoro focus', desc: 'Start a 25m focus timer' },
                { cmd: '/pomodoro stats', desc: 'See your focus stats' },
                { cmd: '/photos', desc: 'Open the photo vault' },
              ].map((h) => (
                <View style={styles.emptyHintRow} key={h.cmd}>
                  <Text style={styles.commandHint}>{h.cmd}</Text>
                  <Text style={styles.emptyHintDesc}>{h.desc}</Text>
                </View>
              ))}
            </View>
          </View>
        }
        renderItem={({ item: message }) => {
          let textToRender = message.text;
          let extractedImage = null;
          const match = message.text?.match(/\[IMG:(.+?)\]/);
          if (match) {
            extractedImage = match[1];
            textToRender = message.text.replace(match[0], '').trim();
          }

          if (message.type === 'stats' && message.stats) {
            return (
              <View style={styles.timerBubble}>
                <PomodoroStatsCard stats={message.stats} theme={theme} />
              </View>
            );
          }

          // (Claude session output is no longer interleaved here — it
          // renders in the dedicated ClaudeConsole panel above the input.)

          // Fix: Robust URL generation that handles trailing slashes and prevents double '/api'
          const buildImageUrl = (filename) => {
            const base = getBaseUrl().replace(/\/+$/, '').replace(/\/api$/, '');
            return `${base}/api/media/raw/${filename}`;
          };

          return (
            <View style={[
              styles.messageBubble,
              message.isWelcome ? styles.welcomeBubble : 
              message.sender === 'user' ? styles.userBubble : 
              message.sender === 'error' ? styles.errorBubble : styles.serverBubble,
              // Telegram Style: If there's an image, remove padding so it sits flush to the edges
              extractedImage && { paddingVertical: 4, paddingHorizontal: 4 }
            ]}>
              {extractedImage && (
                <Image 
                  source={{ uri: buildImageUrl(extractedImage) }} 
                  style={{ 
                    width: 240, 
                    aspectRatio: 1, 
                    borderRadius: 10, // Inner radius slightly tighter than outer bubble
                    marginBottom: textToRender ? 6 : 0, 
                    backgroundColor: 'rgba(0,0,0,0.1)' 
                  }} 
                  contentFit="cover" 
                  cachePolicy="memory-disk"
                />
              )}
              {textToRender ? (
                <Text style={[
                  styles.messageText, 
                  message.isWelcome ? styles.welcomeText : message.sender === 'user' ? styles.userText : styles.serverText,
                  // Re-inject padding for text if it was removed by the image container
                  extractedImage && { paddingHorizontal: 8, paddingBottom: 4 }
                ]}>
                  {textToRender}
                </Text>
              ) : null}
              {!message.isWelcome && (
                <Text style={[
                  styles.timestamp,
                  // Adjust timestamp position if inside a photo bubble
                  extractedImage && { paddingHorizontal: 8, paddingBottom: 2 }
                ]}>
                  {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
              )}
              {message.isTelegram && (
                <View style={{ backgroundColor: 'rgba(0, 136, 204, 0.8)', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2, marginTop: 6, alignSelf: 'flex-end', ...(extractedImage && { marginRight: 6, marginBottom: 4 }) }}>
                  <Text style={{ fontSize: 9, color: '#fff', fontWeight: 'bold' }}>TG</Text>
                </View>
              )}
            </View>
          );
        }}
      />
      </View>

      {/* Scroll-to-latest pill — floats just above the composer dock, bottom
          right, only once scrolled a long way up into history. Fades in/out with
          scroll (no scroll → fades away). Tapping animates back to the newest. */}
      <Animated.View
        pointerEvents={showChatJump ? 'auto' : 'none'}
        style={{
          position: 'absolute',
          bottom: dockHeight + 12,
          right: 16,
          opacity: chatJumpAnim,
          transform: [{ scale: chatJumpAnim.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }],
          zIndex: 40,
        }}
      >
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={scrollChatToLatest}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.colors.surfaceElevated,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
            shadowColor: '#000',
            shadowOpacity: 0.25,
            shadowRadius: 6,
            shadowOffset: { width: 0, height: 2 },
            elevation: 6,
          }}
        >
          <Icon name="chevron-double-down" size={22} color={theme.colors.textPrimary} />
        </TouchableOpacity>
      </Animated.View>

      {/* Bottom dock — the cards + the frosted composer, floated as ONE
          absolute overlay pinned to the bottom edge. The message list runs
          FULL height behind it, so chat reads through the composer's blur
          (true Telegram frosted bar). Its measured height insets the list. */}
      <Reanimated.View
        // In a Claude session the dock (the opaque console window + composer)
        // is the ONLY thing that tracks the keyboard — it lifts on its own while
        // the background stays still. In normal chat the whole column already
        // lifts the dock, so no transform of its own there.
        style={[styles.bottomDock, sessionDockLift]}
        onLayout={(e) => {
          const h = Math.round(e.nativeEvent.layout.height);
          if (h === dockHeight) return;
          // During a keyboard transition the console height animates on the UI
          // thread, firing this onLayout every frame. Updating dockHeight here
          // would relayout the FlashList on every frame (the stutter). The whole
          // column translates rigidly during the keyboard motion, so the list's
          // padding doesn't need to change mid-flight anyway — stash the latest
          // height and let the keyboard-settle handler apply it once at the end.
          if (kbAnimatingRef.current) {
            pendingDockHeightRef.current = h;
            return;
          }
          // The dock height feeds the inverted chat list's bottom inset
          // (contentContainerStyle paddingTop). When the dock resizes — most
          // notably the Claude console expanding/collapsing — animate that
          // inset so the messages slide in step with the panel instead of
          // snapping/"refreshing". BUT not during a keyboard transition: there
          // the console height is already animating on the UI thread in lockstep
          // with the column lift, and a competing JS LayoutAnimation makes the
          // panel jump (the "keyboard-open translation" bug). Let Reanimated own
          // that motion; only animate the inset for discrete resizes.
          if (!kbAnimatingRef.current) {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          }
          setDockHeight(h);
        }}
      >

      {/* Synthetic pomodoro timer card — driven by server state, sits above
          the input so it stays in view regardless of chat scroll. Wrapped in a
          measuring View (always mounted) so the Claude console knows how much
          room this card eats from ABOVE it — 0 when no timer is running. */}
      <View
        onLayout={(e) => {
          const h = Math.round(e.nativeEvent.layout.height);
          setDockAboveConsole((prev) => (prev === h ? prev : h));
        }}
      >
        {pomodoro.state && (
          <View style={styles.timerCardSlot}>
            <TimerMessage
              state={pomodoro.state}
              onStop={handleStopTimer}
              onDismiss={pomodoro.dismiss}
              theme={theme}
              minimized={timerMinimized}
              onToggleMinimize={() => setTimerMinimized((m) => !m)}
            />
          </View>
        )}
      </View>

      {/* Live Claude session console — renders the streamed transcript
          directly from hook state (reliable, unlike interleaving into the
          chat list). Sits above the input like the pomodoro card. */}
      {claudeUiMode && (
        <ClaudeConsole
          transcript={claude.transcript}
          active={claudeActive}
          busy={claude.busy}
          live={claude.live}
          onToggleLive={claude.toggleLive}
          mode={claudeUiMode}
          admin={claude.admin}
          permissions={claude.permissions}
          onRespondPermission={claude.respondPermission}
          questions={claude.questions}
          onRespondQuestion={claude.respondQuestion}
          onStop={() => { if (claudeUiMode === 'login') claudeLoginStop(); else claudeStop(); }}
          onClose={claudeClose}
          // Pass the SAME keyboard tracker that lifts the column, so the
          // console's height shrink stays frame-locked to that lift (a separate
          // useAnimatedKeyboard inside the console desynced during a mid-session
          // keyboard open, sliding its top under the chat header).
          keyboard={keyboard}
          // Room accounting so the console sizes itself to fit between the chat
          // header and the composer — never sliding under the header or hiding
          // the input, in any keyboard state. spaceAbove = status bar + chat
          // header + pomodoro card; spaceBelow = banners + composer.
          spaceAbove={insets.top + CHAT_HEADER_BAR_HEIGHT + dockAboveConsole}
          spaceBelow={dockBelowConsole}
          tabBarHeight={tabBarHeight}
        />
      )}

      {/* Live remote-shell console — shows the working dir + streamed output. */}
      {terminalOpen && (
        <TerminalConsole
          transcript={terminal.transcript}
          active={terminal.active}
          busy={terminal.busy}
          cwd={terminal.cwd}
          fullscreen={terminalFullscreen}
          onToggleFullscreen={() => setTerminalFullscreen((f) => !f)}
          onStop={terminalStop}
          onClose={terminalClose}
          onSend={terminalSend}
          insets={insets}
        />
      )}

      {/* Everything BELOW the Claude console — the queue/finished banners and
          the composer. Wrapped in one measuring View so the console knows how
          much room this group takes from below it (it rests on the keyboard when
          open), and can size itself to exactly the space that remains. */}
      <View
        onLayout={(e) => {
          const h = Math.round(e.nativeEvent.layout.height);
          setDockBelowConsole((prev) => (prev === h ? prev : h));
        }}
      >
      {/* Claude task queue banner — tasks pushed from the to-do list waiting
          to run. Drains automatically (one per turn) once a session is live
          and idle. Shows a Start button when no session is running yet, and
          a clear-all. */}
      {claudeQueue.length > 0 && (
        <View style={styles.claudeQueueBanner}>
          <Icon name="robot-outline" size={16} color={theme.colors.textPrimary} />
          <Text style={styles.claudeQueueBannerText} numberOfLines={1}>
            {claudeQueue.length} task{claudeQueue.length > 1 ? 's' : ''} queued
            {claudeBusy
              ? ' · Claude is working…'
              : claudeActive
                ? ' · sending…'
                : ' · Start (read/plan) or ⚡ Admin (run)'}
          </Text>
          {!claudeActive && (
            <>
              <TouchableOpacity
                onPressIn={() => tapHaptic()}
                onPress={() => claudeStart()}
                style={styles.claudeQueueStartBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.claudeQueueStartText}>Start</Text>
              </TouchableOpacity>
              {/* Admin = --dangerously-skip-permissions, so queued tasks can
                  actually edit/run with no approval gates (the gates aren't
                  approvable on mobile). Needs the admin password, so we just
                  prefill the existing /claude admin command and focus the
                  composer — the user finishes it and sends. Nothing stored. */}
              <TouchableOpacity
                onPress={() => {
                  setInputText('/claude admin ');
                  setTimeout(() => inputRef.current?.focus(), 0);
                }}
                style={styles.claudeQueueAdminBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.claudeQueueAdminText}>⚡ Admin</Text>
              </TouchableOpacity>
            </>
          )}
          <TouchableOpacity
            onPressIn={() => tapHaptic()}
            onPress={clearClaudeQueue}
            style={styles.claudeQueueClearBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Clear Claude queue"
          >
            <Icon name="close" size={16} color={theme.colors.textSecondary} />
          </TouchableOpacity>
        </View>
      )}

      {/* "Finished" banner — when Claude completes a queued task, show what it
          was and WHEN it finished (the timestamp the server stamps on each
          completion). Persists after the queue empties so you can see the last
          result; dismiss with the ✕. */}
      {showDoneBanner && (
        <View style={styles.claudeDoneBanner}>
          <Icon name="check-circle-outline" size={16} color="#4ADE80" />
          <Text style={styles.claudeDoneBannerText} numberOfLines={1}>
            Finished “{lastCompleted.label}” · {formatFinishedAt(lastCompleted.finishedAt)}
          </Text>
          <TouchableOpacity
            onPress={() => setDismissedDoneId(lastCompleted.id)}
            style={styles.claudeQueueClearBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Dismiss finished-task notice"
          >
            <Icon name="close" size={16} color={theme.colors.textSecondary} />
          </TouchableOpacity>
        </View>
      )}

      {/* Input Area — a Telegram-style frosted composer bar. It's a translucent
          blurred SURFACE (not the old solid bar): the chat messages slide UNDER
          it (FROST_OVERLAP) and read softly through the blur. Its rounded top
          corners lift it off the flat tab navbar below as a distinct bar, and
          the actual text field is a rounded pill floating inside it (inputWrapper).
          Shares its blur look with the Claude console via ../../utils/frostedChat
          so the two boxes match exactly.
            1) BlurView   — the frosted glass (blurs the chat behind it)
            2) frost tint — a translucent colour so it reads as a real surface
          Both are absolute layers behind the content; overflow:hidden +
          the rounded top corners clip them to the bar shape. */}
      <View style={[styles.inputArea, { marginBottom: COMPOSER_MARGIN }]}>
        <BlurView pointerEvents="none" style={StyleSheet.absoluteFill} {...blurProps(theme)} />
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: frostOverlayColor(theme) }]} />
        {/* Autocomplete Dropdown */}
        {showAutocomplete && (
          <View style={styles.autocompleteContainer}>
            <ScrollView 
              style={styles.autocompleteScroll}
              keyboardShouldPersistTaps="handled"
            >
              {autocompleteSuggestions.map((suggestion, index) => (
                <TouchableOpacity
                  key={index}
                  style={styles.autocompleteItem}
                  onPress={() => applySuggestion(suggestion)}
                >
                  <Text style={styles.autocompleteCommand}>{suggestion.text}</Text>
                  <Text style={styles.autocompleteDescription}>{suggestion.description}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* ── Composer card, reference-style ─────────────────────────────
            Three stacked zones inside the frosted card:
              1. top zone    — attached-image thumb (X badge) + the dashed
                               "bot slot" circle (= the Claude session toggle,
                               solid + tinted while a session is live)
              2. big input   — large bare text, no pill, like the reference
              3. actions row — circular buttons (attach / keyboard / boards /
                               commands) + the round send button on the right */}
        <View style={styles.composerTopZone}>
          {claudeImage && (
            <View style={{ position: 'relative' }}>
              <Image
                source={{ uri: claudeImage.uri }}
                style={styles.composerThumb}
                contentFit="cover"
              />
              <TouchableOpacity
                onPress={() => setClaudeImage(null)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={styles.composerThumbX}
                accessibilityLabel="Remove attached image"
              >
                <Icon name="close" size={14} color={theme.colors.textPrimary} />
              </TouchableOpacity>
            </View>
          )}
          {/* The bot slot — opens (or hides) the Claude session. While it's
              open, the composer types straight to Claude. Long-press → the
              Claude model picker (Opus / Sonnet / Haiku / Default). */}
          <TouchableOpacity
            style={[styles.botSlot, claudeUiMode === 'session' && styles.botSlotActive]}
            onPressIn={() => tapHaptic()}
            onPress={() => {
              if (claudeUiMode === 'session') {
                claudeClose();              // toggle off (keeps the session alive)
              } else {
                terminalClose();            // mutually exclusive with the terminal
                claudeStart();              // open the session → input routes to Claude
                setTimeout(() => inputRef.current?.focus(), 60);
              }
            }}
            onLongPress={() => setShowModelPicker(true)}
            delayLongPress={350}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={claudeUiMode === 'session' ? 'Hide Claude session' : 'Open Claude session'}
            accessibilityHint="Long-press to choose the Claude model"
          >
            <Icon
              name="robot-outline"
              size={26}
              color={claudeUiMode === 'session' ? theme.colors.accentInfo : theme.colors.textMuted}
            />
          </TouchableOpacity>
        </View>

        <TextInput
          ref={inputRef}
          style={styles.input}
          value={inputText}
          onChangeText={handleInputChange}
          placeholder={terminalOpen ? 'Run a command…' : claudeUiMode === 'login' ? 'Paste sign-in code…' : claudeUiMode === 'session' ? 'Message Claude…' : 'Message...'}
          placeholderTextColor={theme.colors.textMuted}
          multiline
          maxLength={500}
          editable={isConnected}
          autoComplete="off"
          textContentType="none"
          // Keyboard mode — only the coding contexts opt into the "Code"
          // keyboard; everyday chat keeps the OS defaults. Changing these
          // takes effect on the input's next focus.
          autoCapitalize={
            (claudeUiMode === 'session' || claudeUiMode === 'login' || terminalOpen) && keyboardMode === 'code'
              ? 'none'
              : 'sentences'
          }
          // Predictive/QuickType bar OFF: it slid in as a second keyboard
          // frame and made the composer jump up at the END of the open
          // animation. Disabling it gives a single-height keyboard that
          // opens in one smooth motion. (Code mode already had it off.)
          autoCorrect={false}
          spellCheck={false}
        />

        <View style={styles.composerActions}>
          {/* Attach image — only while a Claude session is open. */}
          {claudeUiMode === 'session' && (
            <TouchableOpacity
              style={styles.actionCircle}
              onPressIn={() => tapHaptic()}
              onPress={pickClaudeImage}
              accessibilityRole="button"
              accessibilityLabel="Attach an image to send to Claude"
            >
              <Icon name="image-outline" size={22} color={claudeImage ? '#4ADE80' : theme.colors.textPrimary} />
            </TouchableOpacity>
          )}
          {/* Keyboard chooser — coding contexts only (Code = no autocorrect). */}
          {(claudeUiMode === 'session' || claudeUiMode === 'login' || terminalOpen) && (
            <TouchableOpacity
              style={styles.actionCircle}
              onPress={() => setKeyboardMode((m) => (m === 'code' ? 'normal' : 'code'))}
              accessibilityRole="button"
              accessibilityLabel={`Keyboard: ${keyboardMode === 'code' ? 'Code' : 'Normal'}. Tap to switch.`}
            >
              <Icon
                name={keyboardMode === 'code' ? 'code-tags' : 'keyboard-outline'}
                size={20}
                color={keyboardMode === 'code' ? '#4ADE80' : theme.colors.textPrimary}
              />
            </TouchableOpacity>
          )}
          {/* @ — the board conversations inbox (the app's "mentions"). */}
          <TouchableOpacity
            style={styles.actionCircle}
            onPressIn={() => tapHaptic()}
            onPress={() => setShowConversations(true)}
            accessibilityRole="button"
            accessibilityLabel="Open board conversations"
          >
            <Icon name="at" size={22} color={theme.colors.textPrimary} />
          </TouchableOpacity>
          {/* # — slash-commands: prefill "/" so the autocomplete opens. */}
          <TouchableOpacity
            style={styles.actionCircle}
            onPressIn={() => tapHaptic()}
            onPress={() => {
              handleInputChange('/');
              setTimeout(() => inputRef.current?.focus(), 0);
            }}
            accessibilityRole="button"
            accessibilityLabel="Show commands"
          >
            <Icon name="pound" size={22} color={theme.colors.textPrimary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
          <TouchableOpacity
            style={[
              styles.sendCircle,
              ((inputText.trim() || (claudeUiMode === 'session' && claudeImage)) && isConnected) && styles.sendCircleArmed,
            ]}
            onPressIn={() => impactHaptic('medium')}
            onPress={sendMessage}
            disabled={(!inputText.trim() && !(claudeUiMode === 'session' && claudeImage)) || !isConnected}
            accessibilityRole="button"
            accessibilityLabel="Send"
          >
            <Icon
              name="arrow-up"
              size={26}
              color={
                (inputText.trim() || (claudeUiMode === 'session' && claudeImage)) && isConnected
                  // Armed = inverse ink on the filled circle.
                  ? (theme.mode === 'dark' ? '#111111' : '#FFFFFF')
                  : theme.colors.textMuted
              }
            />
          </TouchableOpacity>
        </View>
      </View>
      </View>{/* /below-console measuring wrapper */}
      </Reanimated.View>{/* /bottom dock */}

      {/* Vault Overlay — wrapped in EdgeSwipePage (overlay form: it's in-tree
          over the chat, and a sibling Modal wouldn't present on iOS anyway) so
          the standard left-edge back-swipe closes it like every pushed page.
          Closing this way only navigates back; the lock state is untouched.
          The zIndex-200 shell restores the vault's stacking: its own root's
          zIndex now lives INSIDE the wrapper subtree, so without this the
          chat header (zIndex 101) would paint (and steal touches) on top.
          box-none keeps the always-mounted shell from intercepting anything
          while the vault is closed. */}
      <View style={[StyleSheet.absoluteFill, { zIndex: 200, elevation: 200 }]} pointerEvents="box-none">
        <EdgeSwipePage overlay visible={isVaultOpen} onClose={handleCloseVault}>
          {isVaultOpen && (
            <VaultOverlay
              initialPassword={vaultPassword}
              onClose={handleCloseVault}
            />
          )}
        </EdgeSwipePage>
      </View>

      {/* Pomodoro Settings Modal */}
      <PomodoroSettings
        visible={showSettings}
        onClose={handleCloseSettings}
        onSave={handleSaveSettings}
        initialFocusMinutes={durations.focus}
        initialBreakMinutes={durations.break}
      />

      {/* Claude model picker — revealed by long-pressing the robot icon. */}
      <Modal
        visible={showModelPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowModelPicker(false)}
      >
        <TouchableOpacity
          style={styles.modelPickerBackdrop}
          activeOpacity={1}
          onPress={() => setShowModelPicker(false)}
        >
          {/* onStartShouldSetResponder absorbs taps on the card so they don't
              bubble to the backdrop and close it. */}
          <View style={styles.modelPickerCard} onStartShouldSetResponder={() => true}>
            <View style={styles.modelPickerHandle} />
            <Text style={styles.modelPickerTitle}>Claude model</Text>
            {CLAUDE_MODELS.map((m) => {
              const selected = (claudeModel || null) === m.value;
              return (
                <TouchableOpacity
                  key={m.label}
                  style={styles.modelRow}
                  activeOpacity={0.7}
                  onPress={() => {
                    setClaudeModel(m.value);
                    setShowModelPicker(false);
                    // Apply now if a non-admin session is live (restart with the
                    // new model). Admin needs the password, so it just takes
                    // effect the next time an admin session is opened.
                    if (claudeUiMode === 'session' && !claude.admin) {
                      claudeStop();
                      setTimeout(() => claudeStart(m.value), 200);
                    }
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modelRowLabel}>{m.label}</Text>
                    <Text style={styles.modelRowSub}>{m.sub}</Text>
                  </View>
                  {selected && <Icon name="check" size={18} color={theme.colors.accentInfo} />}
                </TouchableOpacity>
              );
            })}
            <Text style={styles.modelPickerHint}>
              Applies when a session starts. A running session restarts on the new
              model; admin sessions pick it up next time you open one.
            </Text>
          </View>
        </TouchableOpacity>
      </Modal>
    </Reanimated.View>
  );
}

const createStyles = (theme, insets) =>
  StyleSheet.create({
    // Light mode premium bezel override - ONLY for light mode
    // Dark mode premium bezel override - matches MediaGallery like/share container
    container: {
      flex: 1,
      // Chat surface: pure white on light, pure black on dark (rather than the
      // theme's off-white/near-black background). The faint turtle watermark +
      // transparent message list render on top, so this is the base colour the
      // whole chat reads against.
      backgroundColor: theme.mode === 'dark' ? '#000000' : '#FFFFFF',
    },
    // ── Claude model picker (long-press the robot icon) ──────────────────
    modelPickerBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'flex-end',
    },
    modelPickerCard: {
      backgroundColor: theme.colors.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 32,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
    },
    modelPickerHandle: {
      alignSelf: 'center',
      width: 38,
      height: 4,
      borderRadius: 2,
      backgroundColor: theme.colors.borderStrong,
      marginBottom: 12,
    },
    modelPickerTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: theme.colors.textPrimary,
      marginBottom: 4,
      paddingHorizontal: 4,
    },
    modelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 12,
      paddingHorizontal: 4,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
    modelRowLabel: {
      fontSize: 15,
      fontWeight: '600',
      color: theme.colors.textPrimary,
    },
    modelRowSub: {
      fontSize: 12,
      color: theme.colors.textTertiary,
      marginTop: 2,
    },
    modelPickerHint: {
      fontSize: 11,
      color: theme.colors.textMuted,
      marginTop: 12,
      paddingHorizontal: 4,
      lineHeight: 16,
    },
    // Faint chat backdrop — centers the turtle logo over the whole screen.
    chatWatermarkWrap: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chatWatermark: {
      width: '66%',
      aspectRatio: 1,
      // Extremely faint — barely perceptible, like WhatsApp's chat pattern.
      opacity: 0.05,
    },
    // Top chat header bar — Friends · Turtle brand · Settings, on one solid
    // surface pinned to the top. Overlays the inverted message list (the list
    // reserves a matching top inset). zIndex 101 keeps it above the chat but
    // below the vault overlay (200).
    chatHeader: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 101,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
      paddingBottom: 6,
      backgroundColor: theme.colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
    // Equal-width side clusters flanking the flex:1 title, so the brand stays
    // dead-centre even though the left holds two icons and the right one.
    headerSideWrap: {
      width: 80,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    // Soft translucent disc behind each header icon so it reads against either
    // theme — same treatment the old floating corner buttons used.
    headerIconButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: 'rgba(127,127,127,0.12)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Centred brand lockup (logo + wordmark). flex:1 between the two equal-width
    // (36px) side buttons, so it sits dead-centre without absolute positioning.
    headerTitleWrap: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    headerLogo: {
      width: 22,
      height: 22,
    },
    headerTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: theme.colors.textPrimary,
    },
    friendSearchBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 14,
      height: 50,
      borderRadius: 14,
      backgroundColor: theme.colors.surfaceElevated,
      borderWidth: 1.5,
      borderColor: theme.colors.accentInfo + '55',
    },
    friendSearchInput: {
      flex: 1,
      fontSize: 16,
      color: theme.colors.textPrimary,
      paddingVertical: 0,
    },
    inviteContactsBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
      height: 44,
      borderRadius: 12,
      backgroundColor: theme.colors.accentInfo,
    },
    inviteContactsText: {
      fontSize: 14,
      fontWeight: '700',
      color: '#fff',
    },
    inviteManualBtn: {
      width: 44,
      height: 44,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.surfaceElevated,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    inviteSendBtn: {
      paddingHorizontal: 18,
      height: 44,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.accentInfo,
    },
    inviteSendText: {
      fontSize: 14,
      fontWeight: '700',
      color: '#fff',
    },
    inviteNote: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      paddingHorizontal: 12,
      paddingVertical: 9,
      borderRadius: 10,
    },
    inviteNoteText: {
      flex: 1,
      fontSize: 12.5,
      lineHeight: 17,
    },
    inviteLinkCard: {
      backgroundColor: theme.colors.surfaceElevated,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 12,
      padding: 12,
    },
    inviteLinkLabel: {
      fontSize: 11,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.4,
      marginBottom: 4,
    },
    inviteLinkUrl: {
      fontSize: 13,
    },
    friendEmpty: {
      fontSize: 14,
      color: theme.colors.textTertiary,
      textAlign: 'center',
      marginTop: 32,
      lineHeight: 20,
      paddingHorizontal: 24,
    },
    friendSectionLabel: {
      fontSize: 12,
      fontWeight: '700',
      color: theme.colors.textSecondary,
      marginTop: 18,
      marginBottom: 6,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    friendRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 10,
      borderBottomWidth: 0.5,
      borderBottomColor: theme.colors.border,
    },
    friendAvatar: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.surfaceElevated,
      overflow: 'hidden',
    },
    friendAvatarImg: {
      width: 38,
      height: 38,
      borderRadius: 19,
    },
    friendName: {
      fontSize: 15,
      fontWeight: '600',
      color: theme.colors.textPrimary,
    },
    friendSub: {
      fontSize: 12,
      color: theme.colors.textTertiary,
      marginTop: 1,
    },
    shareChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 16,
    },
    shareChipText: {
      fontSize: 13,
      fontWeight: '600',
    },
    // Header strip inside the Settings modal — just holds the close
    // affordance. Keeps the page-sheet feeling like a sheet rather
    // than a hard-edged screen takeover.
    settingsSheetHeader: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      paddingHorizontal: 12,
      paddingBottom: 6,
      backgroundColor: theme.colors.background,
    },
    settingsCloseButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    watermarkImage: {
      width: 200,
      height: 200,
      opacity: 0.55,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: theme.spacing.md,
      paddingHorizontal: theme.spacing.lg,
      borderBottomWidth: 0.5,
      borderBottomColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      height: HEADER_HEIGHT,
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: '600',
      color: theme.colors.textPrimary,
      marginLeft: theme.spacing.xs,
    },
    messagesContainer: {
      flex: 1,
    },
    // The floating bottom dock: cards + frosted composer, pinned full-width to
    // the bottom edge so the message list runs behind it (chat shows through
    // the composer blur). Owns the below-composer gap that used to live on the
    // root's paddingBottom.
    bottomDock: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
    },
    messagesContent: {
      flexGrow: 1,
      paddingHorizontal: theme.spacing.sm,
      // Inverted list: paddingTop renders at the VISUAL BOTTOM (nearest the
      // composer). FROST_OVERLAP is the clearance that keeps the newest message
      // resting just clear of the full-width frosted composer bar (so it slides
      // under and reads through the blur, Telegram-style, without being cut off).
      paddingTop: FROST_OVERLAP,
    },
    emptyState: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: 100,
      // No transform — the list renders chronologically (not inverted), so the
      // empty state is naturally upright.
    },
    emptyTitle: {
      fontSize: 20,
      fontWeight: '600',
      color: theme.colors.textPrimary,
      marginBottom: theme.spacing.xs,
    },
    emptyText: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      textAlign: 'center',
      paddingHorizontal: theme.spacing.xl,
    },
    commandHint: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      backgroundColor: theme.colors.surfaceElevated,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
      color: theme.colors.textPrimary,
    },
    emptyHintLabel: {
      fontSize: 10,
      fontWeight: '600',
      letterSpacing: 1,
      color: theme.colors.textMuted,
      marginTop: theme.spacing.lg,
      marginBottom: theme.spacing.sm,
    },
    emptyHints: {
      alignSelf: 'center',
    },
    emptyHintRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 8,
    },
    emptyHintDesc: {
      fontSize: 12,
      color: theme.colors.textTertiary,
    },
    messageBubble: {
      maxWidth: '80%',
      paddingVertical: 8, // Tighter vertical padding
      paddingHorizontal: 12, // Tighter horizontal padding
      borderRadius: 14, // Modern, squarer Apple/Telegram radius
      marginBottom: theme.spacing.xs,
    },
    timerBubble: {
      alignSelf: 'flex-start',
      marginBottom: theme.spacing.sm,
    },
    timerCardSlot: {
      paddingHorizontal: theme.spacing.md,
      paddingTop: 4,
      paddingBottom: 4,
      alignItems: 'flex-start',
    },
    welcomeBubble: {
      alignSelf: 'center',
      backgroundColor: 'transparent',
      paddingVertical: theme.spacing.lg,
      paddingHorizontal: theme.spacing.md,
    },
    userBubble: {
      alignSelf: 'flex-end',
      backgroundColor: '#0084FF',
      borderBottomRightRadius: 4,
    },
    serverBubble: {
      alignSelf: 'flex-start',
      backgroundColor: theme.colors.surfaceElevated,
      borderBottomLeftRadius: 4,
    },
    errorBubble: {
      alignSelf: 'flex-start',
      backgroundColor: 'rgba(255, 69, 58, 0.2)',
      borderBottomLeftRadius: 4,
    },
    messageText: {
      fontSize: 15,
      lineHeight: 20,
    },
    welcomeText: {
      fontSize: 15,
      lineHeight: 20,
      color: theme.colors.textSecondary,
      textAlign: 'center',
      fontWeight: 'bold',
    },
    userText: {
      color: '#fff',
    },
    serverText: {
      color: theme.colors.textPrimary,
    },
    timestamp: {
      fontSize: 10,
      color: theme.colors.textMuted,
      marginTop: 4,
      alignSelf: 'flex-end',
    },
    loadingBubble: {
      alignSelf: 'flex-start',
      padding: theme.spacing.md,
      marginBottom: theme.spacing.sm,
    },
    loadingText: {
      fontSize: 14,
      color: theme.colors.textMuted,
      fontStyle: 'italic',
    },
    claudeQueueBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: 12,
      marginBottom: 6,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 12,
      backgroundColor: theme.colors.surfaceElevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
    },
    claudeQueueBannerText: {
      flex: 1,
      marginLeft: 8,
      fontSize: 13,
      color: theme.colors.textSecondary,
    },
    claudeQueueStartBtn: {
      paddingHorizontal: 12,
      paddingVertical: 5,
      borderRadius: 14,
      backgroundColor: '#4ADE80',
      marginLeft: 8,
    },
    claudeQueueStartText: {
      fontSize: 12,
      fontWeight: '700',
      color: '#0b3d1e',
    },
    claudeQueueAdminBtn: {
      paddingHorizontal: 12,
      paddingVertical: 5,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: '#facc15',
      marginLeft: 6,
    },
    claudeQueueAdminText: {
      fontSize: 12,
      fontWeight: '700',
      color: '#facc15',
    },
    claudeQueueClearBtn: {
      marginLeft: 8,
      padding: 2,
    },
    // "Finished" banner — mirrors the queue banner but with a green success
    // accent edge, so a completed task reads distinctly from pending ones.
    claudeDoneBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: 12,
      marginBottom: 6,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 12,
      backgroundColor: theme.colors.surfaceElevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      borderLeftWidth: 3,
      borderLeftColor: '#4ADE80',
    },
    claudeDoneBannerText: {
      flex: 1,
      marginLeft: 8,
      fontSize: 13,
      color: theme.colors.textSecondary,
    },
    inputArea: {
      // Telegram-style frosted composer: a TRANSPARENT container whose surface
      // is the BlurView + frost tint rendered behind it (absolute layers). The
      // chat scrolls under it and reads softly through the blur — the "see-
      // through" look. Rounded TOP corners lift it off the flat, opaque tab
      // navbar below so it reads as a distinct bar (the navbar shares the
      // screen bg + has no top border, so the frost contrast + this curve are
      // what separate the two).
      backgroundColor: 'transparent',
      // Reference-style FLOATING CARD: fully rounded (not an edge-to-edge
      // bar), lifted off the screen edges so the chat reads around it.
      marginHorizontal: 10,
      borderRadius: 28,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: frostBorderColor(theme),
      paddingTop: 6,
      // Clip the BlurView + tint to the rounded card shape.
      overflow: 'hidden',
      // The gap down to the navbar is applied inline at the render site as
      // COMPOSER_MARGIN (now a margin — it's OUTSIDE the floating card).
    },
    // ── Composer card zones (reference aesthetic) ─────────────────────
    // Top zone: attached-image thumb + the dashed bot slot, mirroring the
    // reference's header row.
    composerTopZone: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingHorizontal: 16,
      paddingTop: 10,
    },
    composerThumb: {
      width: 64,
      height: 64,
      borderRadius: 18,
      backgroundColor: theme.colors.surfaceElevated,
    },
    // X badge on the thumb — its own dark disc, like the reference.
    composerThumbX: {
      position: 'absolute',
      top: -6,
      right: -6,
      width: 24,
      height: 24,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.mode === 'dark' ? 'rgba(20,21,24,0.95)' : 'rgba(255,255,255,0.97)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: frostBorderColor(theme),
    },
    // The dashed "add a bot" circle — IS the Claude session toggle. Dashed
    // while idle, solid + tinted while a session is live.
    botSlot: {
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1.5,
      borderStyle: 'dashed',
      borderColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.22)',
    },
    botSlotActive: {
      borderStyle: 'solid',
      borderColor: theme.colors.accentInfo,
      backgroundColor: theme.mode === 'dark' ? 'rgba(96,165,250,0.12)' : 'rgba(59,130,246,0.08)',
    },
    // Bottom action row: circular buttons left, round send right.
    composerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 12,
      paddingTop: 8,
      paddingBottom: 12,
    },
    actionCircle: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)',
    },
    sendCircle: {
      width: 52,
      height: 52,
      borderRadius: 26,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)',
    },
    sendCircleArmed: {
      backgroundColor: theme.mode === 'dark' ? '#FFFFFF' : '#111111',
    },
    // The big bare input — large light type straight on the card (no pill),
    // like the reference's "Put me in a selfie with".
    input: {
      fontSize: 24,
      fontWeight: '600',
      lineHeight: 30,
      color: theme.colors.textPrimary,
      paddingHorizontal: 18,
      paddingTop: 12,
      paddingBottom: 4,
      maxHeight: 130,
      backgroundColor: 'transparent',
    },
    autocompleteContainer: {
      marginHorizontal: 12,
      marginBottom: 8,
      backgroundColor: theme.colors.surfaceElevated,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.border,
      maxHeight: 200,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -2 },
      shadowOpacity: 0.2,
      shadowRadius: 4,
      elevation: 5,
    },
    autocompleteScroll: {
      maxHeight: 200,
    },
    autocompleteItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 0.5,
      borderBottomColor: theme.colors.border,
    },
    autocompleteCommand: {
      fontSize: 15,
      fontWeight: '600',
      color: theme.colors.textPrimary,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    autocompleteDescription: {
      fontSize: 12,
      color: theme.colors.textMuted,
    },
  });

// ---------------------------------------------------------------------------
// PomodoroStatsCard — chat bubble that shows aggregated stats (today, week,
// all-time), a last-7-days focus bar chart, and the most recent sessions.
// A mobile-appropriate slice of the web PomodoroStatsScreen dashboard:
// plain Views for the chart (no SVG / native deps), touch-friendly (no hover).
// ---------------------------------------------------------------------------
const STATS_CHART_H = 56; // px — bar track height; shared by the height calc + style

function PomodoroStatsCard({ stats, theme }) {
  if (!stats) return null;
  const styles = createStatsStyles(theme);

  // ── Last-7-days focus chart + insights, derived from stats.recent ──
  // Each recent row carries { mode, status, startedAt, actualDuration };
  // bucket the trailing 7 days (ending today) by start date.
  const DAY3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const recent = Array.isArray(stats.recent) ? stats.recent : [];
  const startToday = new Date();
  startToday.setHours(0, 0, 0, 0);
  const windowStart = startToday.getTime() - 6 * 86400000;
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(windowStart + i * 86400000);
    days.push({ label: DAY3[d.getDay()], focusMin: 0 });
  }
  let last7Focus = 0;
  let last7Completed = 0;
  for (const s of recent) {
    if (s.mode !== 'focus') continue;
    const idx = Math.floor((s.startedAt - windowStart) / 86400000);
    if (idx < 0 || idx > 6) continue;
    days[idx].focusMin += (s.actualDuration || 0) / 60;
    last7Focus += 1;
    if (s.status === 'completed') last7Completed += 1;
  }
  const totalMin = Math.round(days.reduce((a, d) => a + d.focusMin, 0));
  const maxMin = Math.max(1, ...days.map((d) => d.focusMin));
  const peakIdx = days.reduce((mi, d, i) => (d.focusMin > days[mi].focusMin ? i : mi), 0);
  const completionRate = last7Focus > 0 ? Math.round((last7Completed / last7Focus) * 100) : 0;
  const avgMin = last7Completed > 0 ? Math.round(totalMin / last7Completed) : 0;
  const showChart = totalMin > 0;
  const accent = theme.colors.accentInfo || '#7dd3fc';

  const fmtDuration = (sec) => (sec >= 60 ? `${Math.round(sec / 60)} min` : `${sec}s`);
  const fmtRecent = (ms) =>
    new Date(ms).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });

  const renderBucket = (label, data) => (
    <View style={styles.bucket} key={label}>
      <Text style={styles.bucketLabel}>{label}</Text>
      <Text style={styles.bucketCount}>
        {data.focusCompleted}
        <Text style={styles.bucketTomato}> 🍅</Text>
      </Text>
      <Text style={styles.bucketSubline}>
        {data.focusMinutes} min focus
        {data.focusStopped > 0 ? ` · ${data.focusStopped} stopped` : ''}
      </Text>
      <Text style={styles.bucketSublineMuted}>
        {data.breakCompleted} breaks · {data.breakMinutes} min
      </Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerEmoji}>📊</Text>
        <Text style={styles.headerTitle}>Pomodoro stats</Text>
      </View>

      <View style={styles.bucketsRow}>
        {renderBucket('Today', stats.today)}
        {renderBucket('This week', stats.thisWeek)}
        {renderBucket('All time', stats.allTime)}
      </View>

      {showChart && (
        <View style={styles.chartSection}>
          <View style={styles.chartHeader}>
            <Text style={styles.recentLabel}>Last 7 days</Text>
            <Text style={styles.chartTotal}>{totalMin} min focus</Text>
          </View>
          <View style={styles.chartRow}>
            {days.map((d, i) => {
              const h =
                d.focusMin > 0
                  ? Math.max(4, Math.round((d.focusMin / maxMin) * STATS_CHART_H))
                  : 0;
              return (
                <View style={styles.chartCol} key={i}>
                  <View style={styles.chartBarTrack}>
                    {h > 0 && (
                      <View
                        style={[
                          styles.chartBar,
                          { height: h, backgroundColor: accent, opacity: i === peakIdx ? 1 : 0.4 },
                        ]}
                      />
                    )}
                  </View>
                  <Text style={styles.chartDayLabel}>{d.label}</Text>
                </View>
              );
            })}
          </View>
          <Text style={styles.insightLine}>
            {completionRate}% completed · avg {avgMin} min · peak {days[peakIdx].label}
          </Text>
        </View>
      )}

      {stats.recent && stats.recent.length > 0 ? (
        <View>
          <Text style={styles.recentLabel}>Recent sessions</Text>
          {stats.recent.slice(0, 6).map((s) => {
            const isCompleted = s.status === 'completed';
            return (
              <View style={styles.recentRow} key={s.id}>
                <Text style={styles.recentMode}>{s.mode === 'focus' ? '🍅' : '☕'}</Text>
                <View
                  style={[
                    styles.recentStatusPill,
                    {
                      backgroundColor: isCompleted ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)',
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.recentStatusText,
                      { color: isCompleted ? theme.colors.accentSuccess : theme.colors.accentError },
                    ]}
                  >
                    {isCompleted ? 'done' : 'stopped'}
                  </Text>
                </View>
                <Text style={styles.recentTime}>{fmtRecent(s.endedAt)}</Text>
                <Text style={styles.recentDuration}>{fmtDuration(s.actualDuration)}</Text>
              </View>
            );
          })}
        </View>
      ) : (
        <Text style={styles.emptyHint}>
          No sessions logged yet — start a focus timer with /pomodoro focus.
        </Text>
      )}
    </View>
  );
}

const createStatsStyles = (theme) =>
  StyleSheet.create({
    container: {
      backgroundColor: theme.colors.surfaceElevated,
      borderRadius: 16,
      padding: 14,
      minWidth: 240,
      maxWidth: 320,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 10,
    },
    headerEmoji: { fontSize: 18 },
    headerTitle: { fontWeight: '600', color: theme.colors.textPrimary, fontSize: 14 },
    bucketsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 14,
      marginBottom: 12,
    },
    bucket: {
      minWidth: 90,
    },
    bucketLabel: {
      fontSize: 10,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      color: theme.colors.textMuted,
      marginBottom: 2,
    },
    bucketCount: {
      fontSize: 22,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
      // mobile theme has no accentPrimary — use accentInfo (see memory)
      color: theme.colors.accentInfo || '#7dd3fc',
    },
    bucketTomato: { fontSize: 11, fontWeight: '400', color: theme.colors.textMuted },
    bucketSubline: { fontSize: 11, color: theme.colors.textPrimary, opacity: 0.85 },
    bucketSublineMuted: { fontSize: 11, color: theme.colors.textMuted, marginTop: 1 },
    recentLabel: {
      fontSize: 10,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      color: theme.colors.textMuted,
      marginBottom: 6,
    },
    recentRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 4,
      paddingHorizontal: 6,
      backgroundColor: 'rgba(255,255,255,0.03)',
      borderRadius: 6,
      marginBottom: 4,
    },
    recentMode: { fontSize: 14, width: 18 },
    recentStatusPill: {
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: 4,
    },
    recentStatusText: {
      fontSize: 10,
      fontWeight: '500',
    },
    recentTime: { flex: 1, fontSize: 12, color: theme.colors.textPrimary, opacity: 0.85 },
    recentDuration: {
      fontSize: 12,
      color: theme.colors.textMuted,
      fontVariant: ['tabular-nums'],
    },
    chartSection: { marginBottom: 12 },
    chartHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 6,
    },
    chartTotal: {
      fontSize: 11,
      fontWeight: '600',
      color: theme.colors.textPrimary,
      fontVariant: ['tabular-nums'],
    },
    chartRow: { flexDirection: 'row', alignItems: 'flex-end' },
    chartCol: { flex: 1, alignItems: 'center' },
    chartBarTrack: {
      height: STATS_CHART_H,
      width: '100%',
      justifyContent: 'flex-end',
      alignItems: 'center',
    },
    chartBar: { width: 14, borderRadius: 4 },
    chartDayLabel: { fontSize: 9, color: theme.colors.textMuted, marginTop: 4 },
    insightLine: {
      fontSize: 11,
      color: theme.colors.textSecondary,
      marginTop: 8,
      textAlign: 'center',
    },
    emptyHint: { fontSize: 12, color: theme.colors.textMuted },
  });
