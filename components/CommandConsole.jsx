import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  ScrollView,
  Animated,
  Easing,
  Keyboard,
  Platform,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useCommandBus } from '../context/CommandBusContext';
import { useTheme } from '../context/ThemeContext';
import { blurProps, frostOverlayColor, frostBorderColor } from '../utils/frostedChat';
import ChatComposer, { ComposerAction } from './ChatComposer';
import { tapHaptic } from '../utils/haptics';

// The iOS keyboard ease — Animated has no built-in "keyboard" curve, so this
// bezier matches it closely; the OS-reported duration is what really syncs the
// speed. Mirrors the constant in TerminalConsole.
const KB_EASING = Easing.bezier(0.17, 0.59, 0.4, 0.77);

// Command names stay monospace — that is the one typographic cue this list
// shares with the chat's own slash-command dropdown, and it is what makes a
// command read as a command rather than as prose.
const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

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
// turned into one). The "/" button is a visual prompt; the user types the body.
const COMMAND_WORDS = new Set([
  'pomodoro', 'note', 'todo', 'photos', 'vault', 'terminal',
  'focus', 'tasks', 'settings', 'stats', 'feedback', 'notes',
]);

/**
 * CommandConsole — the command bar behind a long-press on the Turtle tab.
 *
 * It used to be a pixel-copy of the WEB app's Ctrl+/ console: a permanently
 * dark slab with hard-coded greys, a monospace body, a boxed "ESC" chip and a
 * separate popover floating above it. On a phone, next to the app's own chat,
 * that read as a different application — theme-blind in light mode, square
 * where everything else is round, and carrying a keyboard affordance ("ESC")
 * that no phone has.
 *
 * So it is now the SAME composer the Turtle tab uses: ChatComposer in `bare`
 * mode inside one frosted card, with the suggestion list riding above the input
 * exactly the way the chat's slash-command dropdown does. Round send button,
 * circular actions, the shared frost — one input, two entry points. Submitting
 * still delivers the text into the Turtle chat (via CommandBus), which runs the
 * exact same command pipeline.
 */
export default function CommandConsole({ visible, onClose }) {
  const { dispatch } = useCommandBus();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const [value, setValue] = useState('');
  // Lift driven off the keyboard's own show/hide events: the bar rises in
  // lockstep with the keyboard (same duration + curve) instead of snapping to
  // its final spot via a one-frame paddingBottom change. Native driver → the
  // transform runs off the JS thread with no relayout.
  const kbY = useRef(new Animated.Value(0)).current;
  const inputRef = useRef(null);
  const styles = useMemo(() => makeStyles(theme), [theme]);

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
  // implied by the button, so "pomo" matches "/pomodoro …"). Capped at 8.
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
    // Fill the body (without the leading slash — the "/" button shows it) + a
    // space, mirroring the web's Tab-to-apply, then keep focus to finish typing.
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
          {/* ONE frosted card: suggestions above, composer below — the same
              shape the chat's inputArea has, where the slash dropdown lives
              inside the frost rather than floating over it as a second slab. */}
          <View style={styles.card}>
            <BlurView pointerEvents="none" style={StyleSheet.absoluteFill} {...blurProps(theme)} />
            <View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, { backgroundColor: frostOverlayColor(theme) }]}
            />

            {suggestions.length > 0 && (
              <ScrollView
                style={styles.suggestions}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                scrollIndicatorInsets={{ right: 1 }}
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

            <ChatComposer
              bare
              theme={theme}
              inputRef={inputRef}
              value={value}
              onChangeText={setValue}
              onSend={submit}
              placeholder="Type a command…"
              multiline={false}
              maxLength={200}
              inputProps={{
                returnKeyType: 'go',
                onSubmitEditing: submit,
                autoCapitalize: 'none',
                autoCorrect: false,
                spellCheck: false,
              }}
              actions={
                <>
                  {/* The "/" the user doesn't have to type — same circular
                      button shape as the chat's @ and # actions. */}
                  <ComposerAction
                    theme={theme}
                    icon="slash-forward"
                    onPress={() => inputRef.current?.focus()}
                    accessibilityLabel="Slash command"
                  />
                  {/* Replaces the old boxed "ESC" chip: a phone has no escape
                      key, and the chip was the most obviously desktop-borrowed
                      piece of this bar. */}
                  <ComposerAction
                    theme={theme}
                    icon="close"
                    onPress={onClose}
                    accessibilityLabel="Close command bar"
                  />
                </>
              }
            />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  column: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  // Same frosted card as ChatComposer's default shell (radius 28, hairline
  // border, blur + tint), just wide enough to host the suggestion list too.
  card: {
    width: '100%',
    maxWidth: 560,
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: frostBorderColor(theme),
    overflow: 'hidden',
    backgroundColor: 'transparent',
    // The console floats over whatever screen you were on, so unlike the chat's
    // seated composer it keeps a drop shadow to lift it off the page.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: theme.mode === 'dark' ? 0.45 : 0.18,
    shadowRadius: 20,
    elevation: 14,
  },
  suggestions: {
    maxHeight: 260,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: frostBorderColor(theme),
  },
  rowCmd: {
    fontFamily: MONO,
    fontSize: 15,
    fontWeight: '600',
    color: theme.colors.textPrimary,
  },
  rowDesc: {
    flexShrink: 1,
    textAlign: 'right',
    fontSize: 12,
    color: theme.colors.textMuted,
  },
});
