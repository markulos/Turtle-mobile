/**
 * BoardCreateSheet — "new board", as a card up from the bottom edge.
 *
 * The canvas is a map of a hierarchy, so the one thing this has to make
 * unambiguous is WHERE the board will land: it is created inside whichever
 * board you are currently standing in, and the subtitle says so by name (or
 * "at the top level" when you are at the root). Getting that wrong means a
 * board that appears to vanish — it exists, just one level away from where the
 * user was looking.
 *
 * Rendered as an IN-TREE absolute overlay, deliberately NOT a <Modal>: the
 * canvas already lives inside one (EdgeSwipePage), and on iOS a second sibling
 * Modal over an open one silently never appears — the same rule BoardTimeline
 * and AlbumActionsSheet follow.
 */
import React, { useCallback, useState } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Reanimated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { impactHaptic, tapHaptic } from '../../../utils/haptics';
import { useSheetPresentation } from '../../../utils/useSheetPresentation';

export default function BoardCreateSheet({
  visible,
  parentName = null,
  busy = false,
  error = null,
  onSubmit,
  onClose,
  bottomInset = 0,
  colors,
}) {
  const c = colors;
  const tint = c.accentInfo || c.primary || '#60A5FA';

  const keyboard = useAnimatedKeyboard();
  const keyboardLift = useAnimatedStyle(() => {
    'worklet';
    return { transform: [{ translateY: -Math.max(keyboard.height.value - bottomInset, 0) }] };
  });

  const [name, setName] = useState('');

  const sheet = useSheetPresentation({
    visible,
    onClose,
    height: 260,
    onOpen: useCallback(() => setName(''), []),
  });
  const { mounted, panHandlers } = sheet;

  const trimmed = name.trim();
  const canSubmit = !!trimmed && !busy;
  const submit = () => {
    if (!canSubmit) return;
    impactHaptic('medium');
    onSubmit?.(trimmed);
  };

  if (!mounted) return null;

  return (
    <View style={[StyleSheet.absoluteFill, styles.layer]} pointerEvents="box-none">
      <Animated.View
        pointerEvents={visible ? 'auto' : 'none'}
        style={[StyleSheet.absoluteFill, styles.scrim, sheet.scrimStyle]}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityLabel="Cancel new board"
          onPress={onClose}
        />
      </Animated.View>

      <Reanimated.View pointerEvents="box-none" style={[styles.cardAnchor, keyboardLift]}>
        <Animated.View
          {...panHandlers}
          testID="board-create-sheet"
          onLayout={sheet.onCardLayout}
          style={[styles.card, {
            backgroundColor: c.surfaceElevated,
            borderColor: c.border,
            paddingBottom: bottomInset + 12,
            transform: sheet.cardStyle.transform,
          }]}
        >
          <View style={styles.grabArea}>
            <View style={[styles.grabber, { backgroundColor: c.border }]} />
          </View>

          <View style={styles.headerRow}>
            <View style={[styles.badge, { backgroundColor: c.surfaceHighlight || c.surface, borderColor: c.border }]}>
              <Icon
                name={parentName ? 'file-tree-outline' : 'shape-outline'}
                size={20}
                color={tint}
              />
            </View>
            <View style={styles.headerText}>
              <Text style={[styles.title, { color: c.textPrimary }]} numberOfLines={1}>New board</Text>
              <Text style={[styles.subtitle, { color: c.textTertiary }]} numberOfLines={1}>
                {parentName ? `Inside “${parentName}”` : 'At the top level'}
              </Text>
            </View>
          </View>

          <View style={[styles.fieldRow, { borderTopColor: c.border }]}>
            <Icon name="pencil-outline" size={20} color={c.textSecondary} />
            <TextInput
              style={[styles.input, { color: c.textPrimary }]}
              placeholder="Board name"
              placeholderTextColor={c.textMuted}
              value={name}
              onChangeText={setName}
              autoFocus
              autoCapitalize="sentences"
              returnKeyType="done"
              onSubmitEditing={submit}
              testID="board-create-name"
              accessibilityLabel="Board name"
            />
          </View>

          {!!error && (
            <Text style={[styles.error, { color: c.accentError || '#F87171' }]}>{error}</Text>
          )}

          <View style={styles.actions}>
            <TouchableOpacity
              onPress={() => { tapHaptic(); onClose?.(); }}
              style={[styles.button, { borderColor: c.border }]}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={[styles.buttonText, { color: c.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={submit}
              disabled={!canSubmit}
              style={[
                styles.button,
                styles.primary,
                { backgroundColor: tint, borderColor: tint },
                !canSubmit && styles.disabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Create board"
            >
              <Text style={[styles.buttonText, styles.primaryText]}>
                {busy ? 'Creating…' : 'Create'}
              </Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </Reanimated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Above the canvas and its nodes, below the board timeline it can open.
  layer: { zIndex: 60, elevation: 60 },
  scrim: { backgroundColor: 'rgba(0,0,0,0.5)' },
  cardAnchor: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  card: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  grabArea: { alignItems: 'center', paddingTop: 8, paddingBottom: 6 },
  grabber: { width: 38, height: 4, borderRadius: 2 },
  headerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingBottom: 12,
  },
  headerText: { flex: 1 },
  badge: {
    width: 44, height: 44, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 15, fontWeight: '700' },
  subtitle: { fontSize: 12, marginTop: 1 },
  fieldRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 18, paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  // Inline field in an icon row: explicit height + zero vertical padding, or
  // the glyphs ride high against the icon. App-wide rule for inline inputs.
  input: {
    flex: 1, fontSize: 15, height: 34,
    paddingVertical: 0, textAlignVertical: 'center', includeFontPadding: false,
  },
  error: { fontSize: 12, paddingHorizontal: 18, paddingTop: 8 },
  actions: {
    flexDirection: 'row', gap: 10,
    paddingHorizontal: 16, paddingTop: 14,
  },
  button: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 11, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth,
  },
  primary: { borderWidth: 0 },
  disabled: { opacity: 0.45 },
  buttonText: { fontSize: 15, fontWeight: '700' },
  primaryText: { color: '#fff' },
});
