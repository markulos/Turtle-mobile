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
  LayoutAnimation,
  UIManager,
  Keyboard,
} from 'react-native';
import { BlurView } from 'expo-blur';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../context/ThemeContext';
import { blurProps, frostOverlayColor } from '../../../utils/frostedChat';

// Enable LayoutAnimation on Android so the expand/collapse height
// change eases smoothly instead of snapping.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Compact card height (fits above the input like the pomodoro card)
// vs. the "full view" height — ~72% of the screen so the whole
// session transcript is readable without leaving the chat.
const SCREEN_HEIGHT = Dimensions.get('window').height;
const COMPACT_MAX_HEIGHT = 280;
const EXPANDED_MAX_HEIGHT = Math.round(SCREEN_HEIGHT * 0.72);
// Space to leave below the expanded panel for the composer (+ its safe-area
// padding) so the full view never grows tall enough to hide the input —
// especially once the keyboard is up. Subtracted from the room available
// above the keyboard.
const INPUT_RESERVE = 150;

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

export default function ClaudeConsole({ transcript = [], active, busy, live = true, onToggleLive, mode, admin, permissions = [], onRespondPermission, questions = [], onRespondQuestion, onStop, onClose }) {
  const { theme } = useTheme();
  const styles = createStyles(theme);
  const scrollRef = useRef(null);
  // Whether the card is opened to its full-height view. Opens EXPANDED by
  // default the moment a session starts, so the whole transcript is visible
  // straight away; the user taps the collapse control to minimize it back to
  // the compact card. (Was compact-by-default, which meant manually expanding
  // every session — and that expand-while-keyboard-up was the janky moment.)
  const [expanded, setExpanded] = useState(true);
  // Live keyboard height, so the expanded view can shrink to stay above the
  // keyboard instead of growing tall enough to cover the composer.
  const [kbHeight, setKbHeight] = useState(0);

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    // Shrink the panel on the keyboard's OWN curve/duration (LayoutAnimation's
    // built-in `keyboard` type), not the generic easeInEaseOut preset, so the
    // resize tracks the keyboard rise instead of drifting at its own pace.
    const syncToKeyboard = (e) => {
      LayoutAnimation.configureNext({
        duration: e?.duration || 250,
        update: { type: LayoutAnimation.Types.keyboard },
      });
    };
    const onShow = (e) => {
      syncToKeyboard(e);
      setKbHeight(e?.endCoordinates?.height || 0);
    };
    const onHide = (e) => {
      syncToKeyboard(e);
      setKbHeight(0);
    };
    const s = Keyboard.addListener(showEvt, onShow);
    const h = Keyboard.addListener(hideEvt, onHide);
    return () => { s.remove(); h.remove(); };
  }, []);

  // Full-view height, capped to whatever room is left above the keyboard so
  // the composer below the panel always stays visible. Never smaller than
  // the compact height (otherwise "expand" could paradoxically shrink it).
  const expandedHeight = Math.max(
    COMPACT_MAX_HEIGHT,
    Math.min(EXPANDED_MAX_HEIGHT, SCREEN_HEIGHT - kbHeight - INPUT_RESERVE),
  );

  const toggleExpanded = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(prev => !prev);
  };

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
    // Frosted-glass panel — same Telegram blur as the messaging composer
    // (shared via ../../../utils/frostedChat) so the two chat boxes match
    // exactly. The chat messages behind the panel read through the blur.
    <BlurView
      {...blurProps(theme)}
      style={[styles.panel, expanded ? { height: expandedHeight } : { maxHeight: COMPACT_MAX_HEIGHT }]}
    >
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: frostOverlayColor(theme) }]} />
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
        <View style={styles.permList}>
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
        </View>
      )}

      {/* Paused banner — the live stream is off; the session is still working
          server-side. Tap to go live and catch up. */}
      {paused && (
        <TouchableOpacity activeOpacity={0.7} onPress={onToggleLive} style={styles.pausedBanner}>
          <Icon name="pause-circle-outline" size={14} color={theme.colors.accentWarning} />
          <Text style={styles.pausedText} numberOfLines={2}>
            Live log paused — Claude is still working in the background. Tap to go live & catch up.
          </Text>
        </TouchableOpacity>
      )}

      <ScrollView
        ref={scrollRef}
        style={[styles.body, expanded && styles.bodyExpanded]}
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
    </BlurView>
  );
}

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

const createStyles = (theme) => StyleSheet.create({
  panel: {
    marginHorizontal: 8,
    marginBottom: 8,
    // Transparent: the BlurView + frostOverlayColor tint provide the
    // surface. overflow:hidden clips the blur to the rounded card.
    backgroundColor: 'transparent',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: 'hidden',
    // maxHeight is applied inline so it can switch between the compact
    // card and the full-height "open fully" view (see COMPACT/EXPANDED).
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
  // When expanded the panel is a FIXED height, so the scroll body fills the
  // remaining space (flex:1) — that's what lets the full view occupy all the
  // room even with little/no log, showing empty space below rather than
  // collapsing to fit the content. (Compact mode stays content-sized.)
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
