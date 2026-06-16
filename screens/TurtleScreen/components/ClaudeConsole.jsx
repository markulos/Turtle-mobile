import React, { useRef, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Linking,
  ActivityIndicator,
  Platform,
  Dimensions,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  FadeIn,
  FadeOut,
} from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../context/ThemeContext';

// The panel height is driven directly via Reanimated (LayoutAnimation snapped —
// it can't interpolate a switch between a fixed `height` and a content-driven
// `maxHeight`).
// Same curve the web side uses for its panels — a soft, weighted ease-out.
const RESIZE_EASING = Easing.bezier(0.32, 0.72, 0, 1);
const RESIZE_DURATION = 300;

// Compact card height (fits above the input like the pomodoro card)
// vs. the "full view" height — ~72% of the screen so the whole
// session transcript is readable without leaving the chat. Both are CEILINGS:
// the real height is whatever fits in the room above the keyboard (see the
// animated style), so the panel never grows tall enough to slide under the
// chat header or hide the composer.
const SCREEN_HEIGHT = Dimensions.get('window').height;
const COMPACT_MAX_HEIGHT = 280;
const EXPANDED_MAX_HEIGHT = Math.round(SCREEN_HEIGHT * 0.72);
// Never let the panel collapse below this, even if the keyboard leaves almost
// no room — a small scrollable panel beats a vanished one.
const MIN_PANEL_HEIGHT = 140;

/**
 * ClaudeConsole — a dedicated live panel for the `/claude` session.
 *
 * Renders the hook's `transcript` directly (not via the chat message list),
 * so streamed output always shows. Sits above the chat input like the
 * pomodoro timer card. Auto-scrolls to the newest line; surfaces a tappable
 * "Open sign-in page" button for the in-chat login URL.
 */
// ── Interactive approval card ────────────────────────────────────────────
// One per pending `claude:permission`. Shows what Claude wants to do (a tool
// call, or a plan via ExitPlanMode) and lets the user Approve / Deny with
// optional free-text feedback — mirroring the Claude GUI's plan-approval
// prompt. The feedback is sent back as the decision reason (most useful on
// Deny, e.g. "no — keep the API layer, just add a cache").
function PermissionCard({ perm, onRespond, theme, styles }) {
  const [feedback, setFeedback] = useState('');
  const tool = perm?.toolName || 'tool';
  const isPlan = /exitplanmode/i.test(tool);
  const detail = isPlan
    ? (perm?.input?.plan || perm?.summary || '')
    : (perm?.summary || '');
  const respond = (decision) => onRespond?.(perm.requestId, decision, feedback.trim());
  return (
    <View style={styles.permCard}>
      <View style={styles.permHeaderRow}>
        <Icon
          name={isPlan ? 'clipboard-text-outline' : 'shield-alert-outline'}
          size={15}
          color={theme.colors.accentWarning}
        />
        <Text style={styles.permTitle} numberOfLines={1}>
          {isPlan ? 'Review plan' : `Allow ${tool}?`}
        </Text>
      </View>
      {!!detail && (
        <Text style={styles.permDetail} numberOfLines={isPlan ? 10 : 3} selectable>
          {detail}
        </Text>
      )}
      <TextInput
        style={styles.permInput}
        placeholder="Optional feedback (sent to Claude)…"
        placeholderTextColor={theme.colors.textTertiary}
        value={feedback}
        onChangeText={setFeedback}
        multiline
      />
      <View style={styles.permActions}>
        <TouchableOpacity
          style={[styles.permBtn, styles.permDenyBtn]}
          onPress={() => respond('deny')}
          activeOpacity={0.85}
        >
          <Text style={styles.permDenyText}>{isPlan ? 'Keep planning' : 'Deny'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.permBtn, styles.permAllowBtn]}
          onPress={() => respond('allow')}
          activeOpacity={0.85}
        >
          <Text style={styles.permAllowText}>{isPlan ? 'Approve plan' : 'Approve'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Interactive question card (AskUserQuestion) ───────────────────────────
// One per pending `claude:question`. Renders each of the tool's questions with
// its options as tappable chips (single- or multi-select) plus an optional
// "Other" free-text field, mirroring the Claude GUI's option picker. On Submit
// the selections are sent back and fed to Claude as its answer. The server
// blocks the turn on this, so it sits pinned above the transcript.
function QuestionCard({ q, onRespond, theme, styles }) {
  const list = Array.isArray(q?.questions) ? q.questions : [];
  // Per-question state: { selected: string[], other: string }.
  const [answers, setAnswers] = useState(() => list.map(() => ({ selected: [], other: '' })));

  const toggle = (qi, label, multi) => {
    setAnswers((prev) => prev.map((a, i) => {
      if (i !== qi) return a;
      if (multi) {
        const has = a.selected.includes(label);
        return { ...a, selected: has ? a.selected.filter((s) => s !== label) : [...a.selected, label] };
      }
      // Single-select: tapping the active chip clears it, else replaces.
      return { ...a, selected: a.selected[0] === label ? [] : [label] };
    }));
  };
  const setOther = (qi, text) => {
    setAnswers((prev) => prev.map((a, i) => (i === qi ? { ...a, other: text } : a)));
  };

  // Every question needs at least one chip OR some "Other" text before submit.
  const ready = answers.every((a) => a.selected.length > 0 || a.other.trim().length > 0);

  return (
    <View style={styles.qCard}>
      <View style={styles.permHeaderRow}>
        <Icon name="comment-question-outline" size={15} color={theme.colors.accentInfo} />
        <Text style={styles.permTitle} numberOfLines={1}>
          {list.length === 1 ? 'Claude is asking' : `Claude has ${list.length} questions`}
        </Text>
      </View>
      {list.map((question, qi) => {
        const multi = !!question?.multiSelect;
        const opts = Array.isArray(question?.options) ? question.options : [];
        const a = answers[qi] || { selected: [], other: '' };
        return (
          <View key={`q${qi}`} style={styles.qBlock}>
            <Text style={styles.qPrompt}>{question?.question || question?.header || `Question ${qi + 1}`}</Text>
            {multi && <Text style={styles.qHint}>Choose all that apply</Text>}
            <View style={styles.qChips}>
              {opts.map((opt, oi) => {
                const label = typeof opt === 'string' ? opt : (opt?.label || '');
                if (!label) return null;
                const on = a.selected.includes(label);
                return (
                  <TouchableOpacity
                    key={`o${oi}`}
                    style={[styles.qChip, on && styles.qChipOn]}
                    onPress={() => toggle(qi, label, multi)}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.qChipText, on && styles.qChipTextOn]} numberOfLines={3}>{label}</Text>
                    {!!(opt && opt.description) && (
                      <Text style={[styles.qChipDesc, on && styles.qChipDescOn]} numberOfLines={2}>{opt.description}</Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
            <TextInput
              style={styles.permInput}
              placeholder="Other / custom answer…"
              placeholderTextColor={theme.colors.textTertiary}
              value={a.other}
              onChangeText={(t) => setOther(qi, t)}
              multiline
            />
          </View>
        );
      })}
      <TouchableOpacity
        style={[styles.permBtn, styles.qSubmitBtn, !ready && styles.qSubmitDisabled]}
        onPress={() => ready && onRespond?.(q.requestId, answers)}
        disabled={!ready}
        activeOpacity={0.85}
      >
        <Text style={[styles.qSubmitText, !ready && styles.qSubmitTextDisabled]}>Send answer</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function ClaudeConsole({ transcript = [], active, busy, live = true, onToggleLive, mode, admin, permissions = [], onRespondPermission, questions = [], onRespondQuestion, onStop, onClose, keyboard, spaceAbove = 0, spaceBelow = 0, tabBarHeight = 0 }) {
  const { theme } = useTheme();
  const styles = createStyles(theme);
  const scrollRef = useRef(null);
  // Whether the card is opened to its full-height view. Opens EXPANDED by
  // default the moment a session starts, so the whole transcript is visible
  // straight away; the user taps the collapse control to minimize it back to
  // the compact card. (Was compact-by-default, which meant manually expanding
  // every session — and that expand-while-keyboard-up was the janky moment.)
  const [expanded, setExpanded] = useState(true);

  // The panel height is driven ENTIRELY on the UI thread so it tracks the
  // keyboard frame-for-frame. TurtleScreen lifts the whole chat column above the
  // keyboard, carrying this panel up with it; rather than fight that lift with a
  // counter-shrink (the old, fragile approach), we simply size the panel to the
  // ROOM that's actually free between the chat header and the composer. Because
  // the height is re-derived from that room every frame, it can never exceed it
  // — so the top stays pinned just under the header with no overshoot or jump,
  // in BOTH the compact and expanded states.
  //
  // CRITICAL: the keyboard shared value is passed in from TurtleScreen — the
  // SAME instance that drives the column lift (and the header's counter-lift).
  // A second, local useAnimatedKeyboard() here would track the OS keyboard on
  // its own timeline; the two desync DURING an open animation (only when the
  // keyboard rises while the session is already open), so the panel's shrink
  // lagged the column's lift and its top slid up UNDER the fixed chat header.
  // One source of truth = the shrink and the lift are always the same frame.
  // 0 = compact, 1 = expanded. Animated on toggle; both endpoints are clamped to
  // the available room inside the worklet, so the open/close motion and the
  // keyboard shrink compose into one smooth resize.
  const expandProgress = useSharedValue(1);
  useEffect(() => {
    expandProgress.value = withTiming(expanded ? 1 : 0, {
      duration: RESIZE_DURATION,
      easing: RESIZE_EASING,
    });
  }, [expanded]);

  const animatedPanelStyle = useAnimatedStyle(() => {
    'worklet';
    const kb = keyboard ? keyboard.height.value : 0;
    // The dock (this panel + the composer) is lifted by TurtleScreen so it
    // tracks the keyboard. As it rises, the room between the chat header and the
    // composer shrinks — so cap the panel height to exactly that room every
    // frame, frame-locked to the lift (same keyboard shared value). The panel
    // top therefore stays pinned just under the header and never slides beneath
    // it. `belowFromBottom` = whatever sits below the panel (composer + banners)
    // resting on the keyboard's top edge when up, else above the tab bar.
    const belowFromBottom = Math.max(kb, tabBarHeight) + spaceBelow;
    const avail = SCREEN_HEIGHT - spaceAbove - belowFromBottom;
    const cap = Math.max(MIN_PANEL_HEIGHT, avail);
    const expandedH = Math.min(EXPANDED_MAX_HEIGHT, cap);
    const compactH = Math.min(COMPACT_MAX_HEIGHT, cap);
    // Interpolate compact → expanded by the toggle progress; both already fit
    // the room, so the keyboard shrink rides along for free.
    return { height: compactH + (expandedH - compactH) * expandProgress.value };
  });

  const toggleExpanded = () => setExpanded(prev => !prev);

  // Keep the newest line in view as output streams in. Re-runs on
  // expand too so opening the full view lands on the latest line. Skipped while
  // the live view is paused (the transcript is frozen, so there's nothing new
  // to chase — and the resume replay re-runs this once it catches up).
  useEffect(() => {
    if (!live) return;
    const id = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(id);
  }, [transcript.length, expanded, live]);

  const isLogin = mode === 'login';
  const paused = active && !isLogin && !live;
  const statusText = isLogin ? 'signing in…' : !active ? 'starting…' : paused ? 'paused' : busy ? 'working…' : 'live';
  const dotColor = paused
    ? theme.colors.accentWarning
    : (active || isLogin) ? theme.colors.accentSuccess : theme.colors.accentWarning;

  return (
    // OPAQUE panel (not a frosted blur). The whole console window is lifted with
    // the keyboard by TurtleScreen; a translucent blur would show the STATIC
    // chat list behind it shearing past as the window moves — that see-through
    // shear read as "the background sliding with an offset". A solid surface
    // slides cleanly over the fixed backdrop, and matches the composer below it
    // (which is already a solid bar in the same colour).
    <Animated.View style={[styles.panel, animatedPanelStyle]}>
      <View style={styles.header}>
        {/* Admin sessions show no leading icon — the title alone carries the
            mode. Login/standard sessions keep their icon. */}
        {!isLogin && admin ? null : (
          <Icon name={isLogin ? 'login-variant' : 'robot-outline'} size={16} color={theme.colors.accentInfo} />
        )}
        {/* Admin sessions get a two-weight title — "Claude x Turtle" hairline
            thin, then "| Admin" in a regular weight — so the elevated mode
            reads at a glance without a separate badge. Non-admin keeps the
            plain session label. */}
        {!isLogin && admin ? (
          <Text style={styles.title} numberOfLines={1}>
            <Text style={styles.titleThin}>Claude x Turtle </Text>
            <Text style={styles.titleAdmin}>| Admin</Text>
          </Text>
        ) : (
          <Text style={styles.title} numberOfLines={1}>{isLogin ? 'Claude sign-in' : 'Claude session'}</Text>
        )}
        <View style={styles.statusPill}>
          {busy && !isLogin && !paused
            ? <ActivityIndicator size="small" color={theme.colors.accentInfo} />
            : <View style={[styles.dot, { backgroundColor: dotColor }]} />}
          <Text style={styles.statusText}>{statusText}</Text>
        </View>
        {/* Live-view toggle. Pausing stops the per-chunk log stream (the session
            keeps running in the background, buffered server-side); going live
            replays the buffer to catch up. The off state is tinted so it's
            obvious the panel isn't updating. */}
        {active && !isLogin && onToggleLive && (
          <TouchableOpacity
            onPress={onToggleLive}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={[styles.liveBtn, !live && styles.liveBtnPaused]}
            accessibilityRole="button"
            accessibilityLabel={live ? 'Pause live log (Claude keeps working in the background)' : 'Resume live log and catch up'}
          >
            <Icon name={live ? 'pause' : 'play'} size={13} color={live ? theme.colors.accentSuccess : theme.colors.accentWarning} />
            <Text style={[styles.liveBtnText, { color: live ? theme.colors.accentSuccess : theme.colors.accentWarning }]}>
              {live ? 'Live' : 'Paused'}
            </Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={onStop} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={styles.stopBtn}>
          <Text style={styles.stopText}>{isLogin ? 'Cancel' : 'Stop'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={toggleExpanded}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.iconBtn}
          accessibilityRole="button"
          accessibilityLabel={expanded ? 'Collapse Claude session' : 'Expand Claude session to full view'}
        >
          <Icon name={expanded ? 'arrow-collapse' : 'arrow-expand'} size={16} color={theme.colors.textTertiary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={styles.iconBtn}>
          <Icon name="chevron-down" size={18} color={theme.colors.textTertiary} />
        </TouchableOpacity>
      </View>

      {/* Pending approval + question cards — pinned above the transcript so
          they're always in view, not scrolled away. */}
      {(permissions.length > 0 || questions.length > 0) && (
        <Animated.View
          entering={FadeIn.duration(220)}
          exiting={FadeOut.duration(160)}
          style={styles.permList}
        >
          {permissions.map((perm) => (
            <PermissionCard
              key={perm.requestId}
              perm={perm}
              onRespond={onRespondPermission}
              theme={theme}
              styles={styles}
            />
          ))}
          {questions.map((q) => (
            <QuestionCard
              key={q.requestId}
              q={q}
              onRespond={onRespondQuestion}
              theme={theme}
              styles={styles}
            />
          ))}
        </Animated.View>
      )}

      {/* Paused banner — the live stream is off; the session is still working
          server-side. Tap to go live and catch up. */}
      {paused && (
        <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(160)}>
          <TouchableOpacity activeOpacity={0.7} onPress={onToggleLive} style={styles.pausedBanner}>
            <Icon name="pause-circle-outline" size={14} color={theme.colors.accentWarning} />
            <Text style={styles.pausedText} numberOfLines={2}>
              Live log paused — Claude is still working in the background. Tap to go live & catch up.
            </Text>
          </TouchableOpacity>
        </Animated.View>
      )}

      <ScrollView
        ref={scrollRef}
        // ALWAYS flex:1. The panel now has a concrete Reanimated-driven height
        // in BOTH states, so the body must fill it every frame of the resize —
        // otherwise, on collapse, dropping flex:1 the instant `expanded` flips
        // would snap the transcript to ~0 height while the border animated down
        // around it (a two-part, janky motion). Filling the animated height
        // keeps it one smooth shrink/grow.
        style={[styles.body, styles.bodyExpanded]}
        contentContainerStyle={styles.bodyContent}
        keyboardShouldPersistTaps="handled"
      >
        {transcript.length === 0 ? (
          <Text style={styles.metaLine}>{isLogin ? 'Starting sign-in…' : 'Starting Claude…'}</Text>
        ) : transcript.map((line) => {
          const url = line.kind === 'login' ? (line.text.match(/https?:\/\/\S+/) || [])[0] : null;
          return (
            <View key={line.id} style={styles.lineRow}>
              {line.kind === 'banner' ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.bannerScroll}
                >
                  <Text style={styles.bannerLine}>{line.text}</Text>
                </ScrollView>
              ) : line.kind === 'user' ? (
                <Text style={styles.userLine} selectable>{`› ${line.text}`}</Text>
              ) : line.kind === 'assistant' ? (
                <Text style={styles.assistantLine} selectable>{line.text}</Text>
              ) : line.kind === 'tool' ? (
                <Text style={styles.toolLine} selectable>{`  ⚒ ${line.text}`}</Text>
              ) : line.kind === 'error' ? (
                <Text style={styles.errorLine} selectable>{`  ✗ ${line.text}`}</Text>
              ) : line.kind === 'result' ? (
                <Text style={styles.resultLine} selectable>{`  ✓ ${line.text}`}</Text>
              ) : (
                <Text style={styles.metaLine} selectable>{line.text}</Text>
              )}
              {url ? (
                <TouchableOpacity style={styles.linkBtn} onPress={() => Linking.openURL(url).catch(() => {})}>
                  <Icon name="open-in-new" size={13} color="#fff" />
                  <Text style={styles.linkBtnText}>Open sign-in page</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </Animated.View>
  );
}

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

const createStyles = (theme) => StyleSheet.create({
  panel: {
    marginHorizontal: 8,
    marginBottom: 8,
    // OPAQUE surface so the window slides cleanly over the fixed background when
    // it tracks the keyboard (a transparent/blur panel shears the static chat
    // behind it). Same colour as the composer bar below, so the session reads as
    // one solid window. overflow:hidden clips content to the rounded card.
    backgroundColor: theme.colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: 'hidden',
    // Height is driven inline by Reanimated (animatedPanelStyle) — it
    // interpolates between COMPACT_MAX_HEIGHT and the keyboard-capped expanded
    // height so collapse/expand AND the keyboard shrink are one smooth motion
    // (see expandProgress + useAnimatedKeyboard / RESIZE_*).
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.border,
    // Translucent so the frost shows through the header too (a fully
    // opaque surfaceElevated would block the blur).
    backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
  },
  title: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },
  // Two-weight admin title: "Claude x Turtle" in a hairline-thin weight, then
  // "| Admin" in bold. Nested <Text> inherits the base size/colour from
  // `title`; these only override the weight (and tint Admin with the warning
  // accent to echo the elevated mode).
  titleThin: {
    fontWeight: '200',
  },
  titleAdmin: {
    fontWeight: '400',
    color: theme.colors.accentWarning,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: theme.colors.surface,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 11, fontWeight: '600', color: theme.colors.textSecondary },
  stopBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: `${theme.colors.accentError}22`,
  },
  stopText: { fontSize: 12, fontWeight: '700', color: theme.colors.accentError },
  iconBtn: { padding: 2 },
  liveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: `${theme.colors.accentSuccess}1A`,
  },
  liveBtnPaused: {
    backgroundColor: `${theme.colors.accentWarning}26`,
  },
  liveBtnText: { fontSize: 11, fontWeight: '700' },
  pausedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: `${theme.colors.accentWarning}1A`,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${theme.colors.accentWarning}55`,
  },
  pausedText: { flex: 1, fontSize: 12, color: theme.colors.textSecondary, lineHeight: 16 },
  body: { paddingHorizontal: 12 },
  // The panel has a concrete (Reanimated-animated) height in BOTH states, so
  // the scroll body fills the remaining space (flex:1) in both — letting the
  // view occupy all its room even with little/no log, and keeping the body in
  // lockstep with the height during the resize. Always applied (see ScrollView).
  bodyExpanded: { flex: 1 },
  bodyContent: { paddingVertical: 10, gap: 6 },
  lineRow: {},
  bannerScroll: { marginVertical: 4 },
  bannerLine: { fontFamily: MONO, fontSize: 11, lineHeight: 14, color: theme.colors.accentInfo },
  userLine: { fontFamily: MONO, fontSize: 12.5, lineHeight: 18, color: theme.colors.textPrimary, fontWeight: '700' },
  assistantLine: { fontSize: 14, lineHeight: 20, color: theme.colors.textPrimary },
  toolLine: { fontFamily: MONO, fontSize: 12, lineHeight: 17, color: theme.colors.accentInfo },
  errorLine: { fontFamily: MONO, fontSize: 12.5, lineHeight: 18, color: theme.colors.accentError },
  resultLine: { fontFamily: MONO, fontSize: 12, lineHeight: 17, color: theme.colors.accentSuccess },
  metaLine: { fontFamily: MONO, fontSize: 11.5, lineHeight: 16, color: theme.colors.textTertiary },
  linkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: 8,
    marginBottom: 2,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: theme.colors.accentInfo,
  },
  linkBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  // Approval cards
  permList: {
    paddingHorizontal: 10,
    paddingTop: 10,
    gap: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.border,
    paddingBottom: 10,
  },
  permCard: {
    backgroundColor: theme.colors.surfaceElevated,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.accentWarning,
    padding: 10,
  },
  permHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  permTitle: { flex: 1, fontSize: 13, fontWeight: '700', color: theme.colors.textPrimary },
  permDetail: {
    fontFamily: MONO,
    fontSize: 12,
    lineHeight: 17,
    color: theme.colors.textSecondary,
    marginBottom: 8,
  },
  permInput: {
    minHeight: 36,
    maxHeight: 90,
    backgroundColor: theme.colors.surface,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 13,
    color: theme.colors.textPrimary,
    marginBottom: 8,
    textAlignVertical: 'top',
  },
  permActions: { flexDirection: 'row', gap: 8 },
  permBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: 8,
  },
  permDenyBtn: { backgroundColor: `${theme.colors.accentError}22` },
  permDenyText: { fontSize: 13, fontWeight: '700', color: theme.colors.accentError },
  permAllowBtn: { backgroundColor: theme.colors.accentSuccess },
  permAllowText: { fontSize: 13, fontWeight: '800', color: '#08270f' },

  // AskUserQuestion option-picker card
  qCard: {
    backgroundColor: theme.colors.surfaceElevated,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.accentInfo,
    padding: 10,
  },
  qBlock: { marginBottom: 10 },
  qPrompt: { fontSize: 13, fontWeight: '600', color: theme.colors.textPrimary, marginBottom: 2 },
  qHint: { fontSize: 11, color: theme.colors.textTertiary, marginBottom: 6 },
  qChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  qChip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    maxWidth: '100%',
  },
  qChipOn: {
    borderColor: theme.colors.accentInfo,
    backgroundColor: `${theme.colors.accentInfo}22`,
  },
  qChipText: { fontSize: 13, fontWeight: '600', color: theme.colors.textPrimary },
  qChipTextOn: { color: theme.colors.accentInfo },
  qChipDesc: { fontSize: 11, color: theme.colors.textTertiary, marginTop: 2 },
  qChipDescOn: { color: theme.colors.accentInfo },
  qSubmitBtn: { backgroundColor: theme.colors.accentInfo, marginTop: 2 },
  qSubmitDisabled: { backgroundColor: theme.colors.surface, borderWidth: 0.5, borderColor: theme.colors.border },
  qSubmitText: { fontSize: 13, fontWeight: '800', color: '#06212e' },
  qSubmitTextDisabled: { color: theme.colors.textTertiary },
});
