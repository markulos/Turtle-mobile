import React, { useRef, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Modal,
  Platform,
  Animated,
  Keyboard,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { impactHaptic, notifyHaptic } from '../../../utils/haptics';
import { EASE } from '../../../utils/motion';

/**
 * TerminalConsole — a vintage green-phosphor terminal for the `/terminal`
 * remote shell.
 *
 * Two sizes:
 *   • fullscreen — a full-height/width Modal with its OWN command input (so
 *     it's usable while it covers the chat). Opens like this by default.
 *   • card — a compact panel above the chat input; commands come from the
 *     normal chat input.
 *
 * Shows the live working directory + streamed output from the hook's
 * transcript. Auto-scrolls; CRT-ish glow + blinking cursor for flavour.
 */

// Fixed vintage palette — a terminal is green-on-black regardless of app theme.
const VT = {
  bg: '#070b07',
  panel: '#0c120c',
  border: '#163a1f',
  green: '#5cff8f',     // primary phosphor
  greenDim: '#2f9c54',  // prompts / meta
  greenBright: '#9affc0',
  amber: '#ffc24b',     // errors / stderr
  glow: 'rgba(92,255,143,0.45)',
};
const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
// The classic iOS keyboard ease — Animated has no built-in "keyboard" curve, so
// this bezier matches it closely; what really syncs the speed is the OS-reported
// duration. Module-scope so it's a stable reference (no listener re-subscribe),
// and now shared from utils/motion so the consoles can't drift apart.
const KB_EASING = EASE.keyboard;

export default function TerminalConsole({
  transcript = [],
  active,
  busy,
  cwd,
  fullscreen,
  onToggleFullscreen,
  onClose,
  onStop,
  onSend,
  insets = { top: 0, bottom: 0 },
}) {
  const scrollRef = useRef(null);
  const [cmd, setCmd] = useState('');
  const blink = useRef(new Animated.Value(1)).current;

  // Keyboard-follow motion. The chat composer uses Reanimated's
  // useAnimatedKeyboard, but THIS view is a fullscreen <Modal> (its own native
  // window), and useAnimatedKeyboard tracks the keyboard off the ROOT window —
  // so inside the modal it never follows smoothly. Instead we drive the lift
  // from the keyboard's own show/hide events and animate with the SAME duration
  // (and curve) iOS reports for the keyboard, so the input column rises in
  // lockstep with it — matching the chat's open speed. Native driver = the
  // transform runs off the JS thread, no relayout. (iOS gets the pre-animation
  // `keyboardWillShow` + a real duration; Android only has `keyboardDidShow`,
  // so we fall back to a short default there.)
  const kbY = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!fullscreen) { kbY.setValue(0); return undefined; }
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = (e) => {
      Animated.timing(kbY, {
        toValue: -(e?.endCoordinates?.height ?? 0),
        duration: e?.duration || 250,
        easing: KB_EASING,
        useNativeDriver: true,
      }).start();
    };
    const onHide = (e) => {
      Animated.timing(kbY, {
        toValue: 0,
        duration: e?.duration || 220,
        easing: KB_EASING,
        useNativeDriver: true,
      }).start();
    };
    const subShow = Keyboard.addListener(showEvt, onShow);
    const subHide = Keyboard.addListener(hideEvt, onHide);
    return () => { subShow.remove(); subHide.remove(); };
  }, [fullscreen, kbY]);

  // Auto-scroll to the newest line.
  useEffect(() => {
    const id = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(id);
  }, [transcript.length, fullscreen]);

  // Blinking block cursor.
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(blink, { toValue: 0, duration: 530, useNativeDriver: true }),
        Animated.timing(blink, { toValue: 1, duration: 530, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [blink]);

  const shortCwd = (p) => {
    if (!p) return '';
    const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/);
    return parts.length > 2 ? `…\\${parts.slice(-2).join('\\')}` : p;
  };

  const submit = () => {
    const c = cmd.trim();
    if (!c) return;
    onSend?.(c);
    setCmd('');
  };

  // ── Transcript ────────────────────────────────────────────────────────
  const Lines = (
    <ScrollView
      ref={scrollRef}
      style={[styles.body, fullscreen ? styles.bodyFull : styles.bodyCard]}
      contentContainerStyle={styles.bodyContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {transcript.length === 0 ? (
        <Text style={styles.meta}>{active ? 'ready.' : 'booting shell…'}</Text>
      ) : transcript.map((line) => {
        if (line.kind === 'command') {
          return (
            <Text key={line.id} style={styles.cmdLine} selectable>
              <Text style={styles.prompt}>{`${shortCwd(line.cwd)} > `}</Text>
              {line.text}
            </Text>
          );
        }
        if (line.kind === 'error') return <Text key={line.id} style={styles.errLine} selectable>{line.text || ' '}</Text>;
        if (line.kind === 'meta') return <Text key={line.id} style={styles.meta} selectable>{line.text}</Text>;
        return <Text key={line.id} style={styles.outLine} selectable>{line.text || ' '}</Text>;
      })}
      {/* blinking ready-cursor at the end */}
      <Animated.Text style={[styles.cursorBlock, { opacity: blink }]}>▮</Animated.Text>
    </ScrollView>
  );

  const Header = (
    <View style={styles.header}>
      <Icon name="console-line" size={16} color={VT.green} style={styles.glowIcon} />
      <Text style={styles.title}>TURTLE TERMINAL</Text>
      <View style={styles.cwdWrap}>
        <Text style={styles.cwdText} numberOfLines={1} ellipsizeMode="head">{cwd || '~'}</Text>
      </View>
      <View style={[styles.dot, { backgroundColor: busy ? VT.amber : (active ? VT.green : VT.greenDim) }]} />
      {fullscreen && onStop ? (
        <TouchableOpacity onPressIn={() => notifyHaptic('warning')} onPress={onStop} hitSlop={HIT} style={styles.hbtn} accessibilityLabel="Kill shell">
          <Icon name="flash-off" size={16} color={VT.amber} />
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity onPress={onToggleFullscreen} hitSlop={HIT} style={styles.hbtn} accessibilityLabel={fullscreen ? 'Collapse' : 'Expand'}>
        <Icon name={fullscreen ? 'fullscreen-exit' : 'fullscreen'} size={18} color={VT.green} />
      </TouchableOpacity>
      <TouchableOpacity onPress={onClose} hitSlop={HIT} style={styles.hbtn} accessibilityLabel="Close terminal">
        <Icon name="close" size={18} color={VT.green} />
      </TouchableOpacity>
    </View>
  );

  // ── Full-screen ───────────────────────────────────────────────────────
  if (fullscreen) {
    return (
      <Modal visible animationType="fade" onRequestClose={onToggleFullscreen} statusBarTranslucent>
        <View style={[styles.screen, { paddingTop: insets.top }]}>
          {/* faint scanline / vignette wash */}
          <View pointerEvents="none" style={styles.scan} />
          {Header}
          <Animated.View style={[styles.flex, { transform: [{ translateY: kbY }] }]}>
            {Lines}
            <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
              <Text style={styles.inputPrompt}>{`${shortCwd(cwd)} >`}</Text>
              <TextInput
                style={styles.input}
                value={cmd}
                onChangeText={setCmd}
                onSubmitEditing={submit}
                placeholder="type a command…"
                placeholderTextColor={VT.greenDim}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="send"
                blurOnSubmit={false}
                cursorColor={VT.green}
                selectionColor={VT.glow}
              />
              <TouchableOpacity onPressIn={() => impactHaptic('medium')} onPress={submit} hitSlop={HIT} style={styles.runBtn}>
                <Icon name="play" size={18} color={VT.bg} />
              </TouchableOpacity>
            </View>
          </Animated.View>
        </View>
      </Modal>
    );
  }

  // ── Card ──────────────────────────────────────────────────────────────
  return (
    <View style={styles.card}>
      <View pointerEvents="none" style={styles.scan} />
      {Header}
      {Lines}
    </View>
  );
}

const HIT = { top: 8, bottom: 8, left: 8, right: 8 };

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: VT.bg },
  card: {
    marginHorizontal: 8,
    marginBottom: 8,
    maxHeight: 320,
    backgroundColor: VT.bg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: VT.border,
    overflow: 'hidden',
  },
  // A whisper-faint green wash to suggest CRT glow.
  scan: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(92,255,143,0.025)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: VT.border,
    backgroundColor: VT.panel,
  },
  glowIcon: { textShadowColor: VT.glow, textShadowRadius: 6 },
  title: {
    fontFamily: MONO,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2,
    color: VT.green,
    textShadowColor: VT.glow,
    textShadowRadius: 6,
  },
  cwdWrap: { flex: 1, minWidth: 0 },
  cwdText: { fontFamily: MONO, fontSize: 11, color: VT.greenDim },
  dot: { width: 7, height: 7, borderRadius: 4 },
  hbtn: { paddingHorizontal: 4, paddingVertical: 2 },
  body: { paddingHorizontal: 12 },
  bodyFull: { flex: 1 },
  bodyCard: { maxHeight: 240 },
  bodyContent: { paddingVertical: 10 },
  cmdLine: { fontFamily: MONO, fontSize: 13, lineHeight: 20, color: VT.greenBright, marginTop: 5 },
  prompt: { color: VT.greenDim },
  outLine: { fontFamily: MONO, fontSize: 13, lineHeight: 19, color: VT.green },
  errLine: { fontFamily: MONO, fontSize: 13, lineHeight: 19, color: VT.amber },
  meta: { fontFamily: MONO, fontSize: 12, lineHeight: 17, color: VT.greenDim, fontStyle: 'italic' },
  cursorBlock: { fontFamily: MONO, fontSize: 13, lineHeight: 18, color: VT.green, marginTop: 2 },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: VT.border,
    backgroundColor: VT.panel,
  },
  inputPrompt: { fontFamily: MONO, fontSize: 13, color: VT.greenDim, maxWidth: '38%' },
  input: {
    flex: 1,
    fontFamily: MONO,
    fontSize: 14,
    color: VT.greenBright,
    paddingVertical: Platform.OS === 'ios' ? 8 : 4,
  },
  runBtn: {
    width: 30,
    height: 30,
    borderRadius: 6,
    backgroundColor: VT.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
