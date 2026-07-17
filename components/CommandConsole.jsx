import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  ScrollView,
  Animated,
  Easing,
  Keyboard,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useCommandBus } from '../context/CommandBusContext';
import { tapHaptic } from '../utils/haptics';

// The iOS keyboard ease — Animated has no built-in "keyboard" curve, so this
// bezier matches it closely; the OS-reported duration is what really syncs the
// speed. Mirrors the constant in TerminalConsole.
const KB_EASING = Easing.bezier(0.17, 0.59, 0.4, 0.77);

// Exact palette of the web app's GlobalCommandConsole (Ctrl+/). The console
// is intentionally ALWAYS dark — theme-independent floating chrome — so these
// are fixed colors, not theme tokens, to match the web 1:1.
const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
const MINT = '#7ee9aa';

// The slash-command registry the chat understands (mirrors the chat's list).
const COMMANDS = [
  { command: '/pomodoro focus', description: 'Start focus timer' },
  { command: '/pomodoro break', description: 'Start break' },
  { command: '/pomodoro stop', description: 'Stop active timer' },
  { command: '/pomodoro stats', description: 'Show pomodoro stats' },
  { command: '/note', description: 'Quick-capture a note' },
  { command: '/todo', description: 'Quick-capture a to-do' },
  { command: '/photos', description: 'Open Photo Vault' },
  { command: '/vault', description: 'Open Password Vault' },
  { command: '/terminal', description: 'Open a server shell' },
];

// First words that mark a slash command (so a plain message to Turtle isn't
// turned into one). The "/" chip is a visual prompt; the user types the body.
const COMMAND_WORDS = new Set([
  'pomodoro', 'note', 'todo', 'photos', 'vault', 'terminal',
  'focus', 'tasks', 'settings', 'stats', 'feedback', 'notes',
]);

/**
 * CommandConsole — pixel-matches the web app's Ctrl+/ command bar: a Telegram-
 * style floating bar pinned to the bottom, a faint "/" prefix chip, a monospace
 * mint-caret input, an ESC chip, and a dark suggestion popover above it.
 * Opened by long-pressing the Turtle tab. Submitting delivers the text into
 * the Turtle chat (via CommandBus), which runs the exact same command pipeline.
 */
export default function CommandConsole({ visible, onClose }) {
  const { dispatch } = useCommandBus();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [value, setValue] = useState('');
  // Lift driven off the keyboard's own show/hide events: the bar rises in
  // lockstep with the keyboard (same duration + curve) instead of snapping to
  // its final spot via a one-frame paddingBottom change. Native driver → the
  // transform runs off the JS thread with no relayout.
  const kbY = useRef(new Animated.Value(0)).current;
  const inputRef = useRef(null);

  useEffect(() => {
    if (!visible) return;
    setValue('');
    const t = setTimeout(() => inputRef.current?.focus(), 90);
    return () => clearTimeout(t);
  }, [visible]);

  useEffect(() => {
    if (!visible) {
      kbY.setValue(0);
      return;
    }
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = (e) => {
      // The bar already rests at insets.bottom; only lift it by the part of the
      // keyboard that sits above that, so it lands just above the keyboard.
      const h = e?.endCoordinates?.height ?? 0;
      Animated.timing(kbY, {
        toValue: -Math.max(h - insets.bottom, 0),
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
    const s = Keyboard.addListener(showEvt, onShow);
    const h = Keyboard.addListener(hideEvt, onHide);
    return () => {
      s.remove();
      h.remove();
    };
  }, [visible, insets.bottom, kbY]);

  // Suggestions: empty input → the full list; typed → prefix-match (the "/" is
  // implied by the chip, so "pomo" matches "/pomodoro …"). Capped at 8.
  const suggestions = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return COMMANDS.slice(0, 8);
    const needle = '/' + q.replace(/^\//, '');
    const starts = COMMANDS.filter((c) => c.command.toLowerCase().startsWith(needle));
    if (starts.length) return starts.slice(0, 8);
    return COMMANDS.filter((c) => c.command.toLowerCase().includes(q)).slice(0, 8);
  }, [value]);

  const submit = () => {
    const body = value.trim();
    if (!body) return;
    const firstWord = body.replace(/^\//, '').split(/\s+/)[0].toLowerCase();
    const isCommand = body.startsWith('/') || COMMAND_WORDS.has(firstWord);
    const text = body.startsWith('/') ? body : isCommand ? `/${body}` : body;
    dispatch(text);
    navigation.navigate('Turtle');
    setValue('');
    onClose();
  };

  const applySuggestion = (cmd) => {
    // Fill the body (without the leading slash — the chip shows it) + a space,
    // mirroring the web's Tab-to-apply, then keep focus to finish typing.
    setValue(cmd.command.replace(/^\//, '') + ' ');
    inputRef.current?.focus();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.fill}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        <Animated.View
          style={[
            styles.column,
            { paddingBottom: insets.bottom + 10, transform: [{ translateY: kbY }] },
          ]}
          pointerEvents="box-none"
        >
          <View style={styles.cluster}>
            {/* Suggestions popover */}
            {suggestions.length > 0 && (
              <ScrollView
                style={styles.popover}
                contentContainerStyle={{ paddingVertical: 0 }}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {suggestions.map((s) => (
                  <TouchableOpacity
                    key={s.command}
                    style={styles.row}
                    onPressIn={() => tapHaptic()}
                    onPress={() => applySuggestion(s)}
                    activeOpacity={0.6}
                  >
                    <Text style={styles.rowCmd}>{s.command}</Text>
                    <Text style={styles.rowDesc} numberOfLines={1}>
                      {s.description}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            {/* The bar */}
            <View style={styles.bar}>
              <Text style={styles.slash} aria-hidden>
                /
              </Text>
              <TextInput
                ref={inputRef}
                style={styles.input}
                value={value}
                onChangeText={setValue}
                onSubmitEditing={submit}
                placeholder="type a command…"
                placeholderTextColor="rgba(255,255,255,0.35)"
                selectionColor={MINT}
                returnKeyType="go"
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
              />
              <TouchableOpacity onPress={onClose} style={styles.escChip} activeOpacity={0.7}>
                <Text style={styles.escText}>ESC</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  column: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  cluster: { width: '100%', maxWidth: 560 },

  // Suggestion popover — rgba(20,20,24,0.92), thin border, rounded 10.
  popover: {
    maxHeight: 260,
    marginBottom: 8,
    backgroundColor: 'rgba(20,20,24,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: 10,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  rowCmd: {
    fontFamily: MONO,
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 13,
  },
  rowDesc: {
    flex: 1,
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11,
  },

  // The bar — rgba(20,20,24,0.78), border rgba(255,255,255,0.14), rounded 12.
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(20,20,24,0.78)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.55,
    shadowRadius: 24,
    elevation: 16,
  },
  slash: {
    fontFamily: MONO,
    fontSize: 16,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.32)',
    paddingLeft: 4,
  },
  input: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 4,
    paddingHorizontal: 4,
    fontFamily: MONO,
    fontSize: 15,
    color: '#fff',
    padding: 0,
  },
  escChip: {
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 4,
  },
  escText: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.3,
    color: 'rgba(255,255,255,0.35)',
  },
});
