/**
 * MessageActionsSheet — the options a held message offers.
 *
 * Copy the message, and when it carries a link, copy or open that link. A
 * small bottom sheet on the house shape (`Modal transparent`, scrim that
 * closes on press, grab handle, rows) so it reads like every other sheet in
 * the app rather than like a borrowed menu.
 *
 * Two rules it has to obey and one it does not:
 *
 *   - It ENDS ABOVE the home indicator (STYLE-RULES §3) via
 *     `panelBottomInset(insets.bottom, false)`. `false` because a Modal
 *     presents above the whole navigator, so the floating dock is not drawn
 *     over this and clearing it would leave a band of empty sheet.
 *   - A row NARROWS rather than overhanging: a message quoted in the header
 *     line is `numberOfLines`-capped, and a label never wraps the sheet wider.
 *   - It does NOT need a long-press slop check of its own. react-native's
 *     Pressable already cancels `onLongPress` once the finger travels, which
 *     is the platform doing what `utils/pressBehavior` spells out by hand for
 *     taps — so a scroll through the thread raises nothing.
 */
import React, { useMemo } from 'react';
import {
  Modal, Pressable, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { panelBottomInset } from './tabBarLayout';
import { depth } from '../utils/surfaceDepth';
import { tapHaptic } from '../utils/haptics';

export default function MessageActionsSheet({
  visible,
  onClose,
  /** The message being held — only its text is used. */
  message,
  /** Rows: [{ key, label, icon, onSelect, destructive }] */
  actions = [],
  theme,
  testID = 'message-actions',
}) {
  const c = theme.colors;
  const insets = useSafeAreaInsets();
  const s = useMemo(() => makeStyles(theme), [theme]);

  return (
    <Modal transparent visible={!!visible} onRequestClose={onClose} animationType="fade" statusBarTranslucent>
      <View style={s.root}>
        {/* The scrim. A press anywhere off the sheet closes it. */}
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
          accessibilityLabel="Close message options"
          testID={`${testID}-scrim`}
        />
        <View style={[s.sheet, { paddingBottom: panelBottomInset(insets.bottom, false) }]} testID={testID}>
          <View style={s.handleZone}><View style={s.handleBar} /></View>

          {/* Which message this is about. Held the wrong bubble in a fast-moving
              thread, this is how you can tell before pressing Copy. */}
          {!!message?.content && (
            <Text numberOfLines={2} style={s.quote}>{message.content}</Text>
          )}

          {actions.map((a) => (
            <Pressable
              key={a.key}
              onPressIn={() => tapHaptic()}
              onPress={() => { a.onSelect?.(); onClose?.(); }}
              accessibilityRole="button"
              accessibilityLabel={a.label}
              style={({ pressed }) => [s.row, pressed && s.rowPressed]}
              testID={`${testID}-${a.key}`}
            >
              <Icon
                name={a.icon}
                size={20}
                color={a.destructive ? (c.accentError || '#e5484d') : c.textSecondary}
              />
              <Text
                numberOfLines={1}
                style={[s.rowLabel, a.destructive && { color: c.accentError || '#e5484d' }]}
              >
                {a.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (theme) => {
  const c = theme.colors;
  return StyleSheet.create({
    root: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
    sheet: {
      backgroundColor: c.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingHorizontal: 10,
      ...depth(theme, 'overlay'),
    },
    handleZone: { height: 22, alignItems: 'center', justifyContent: 'center' },
    handleBar: { width: 38, height: 4, borderRadius: 2, backgroundColor: c.border },
    quote: {
      fontSize: 12.5, lineHeight: 17, color: c.textTertiary,
      paddingHorizontal: 12, paddingBottom: 10, marginBottom: 4,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border,
    },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: 14,
      paddingHorizontal: 12, height: 52, borderRadius: 12,
    },
    rowPressed: { backgroundColor: c.surfaceElevated },
    // flexShrink so a long label ellipsizes instead of widening the sheet.
    rowLabel: { flex: 1, flexShrink: 1, fontSize: 15.5, fontWeight: '600', color: c.textPrimary },
  });
};
