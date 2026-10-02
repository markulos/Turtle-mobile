/**
 * AnimalPicker — choose the animal on your own avatar.
 *
 * A grid of emoji on the house bottom sheet. Your current one is ringed in the
 * accent, and the first row offers the ASSIGNED animal back, so a choice is
 * never a one-way door.
 *
 * Two rules it obeys:
 *   - It ends ABOVE the home indicator (STYLE-RULES §3) via
 *     `panelBottomInset(insets.bottom, false)` — `false` because a Modal
 *     presents above the whole navigator, so the floating dock is not drawn
 *     over this and clearing it would leave a band of empty sheet.
 *   - Nothing oversets it: the grid wraps, and the tiles are a fixed size
 *     rather than a share of a width nobody measured.
 */
import React, { useMemo } from 'react';
import {
  Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { panelBottomInset } from './tabBarLayout';
import { depth } from '../utils/surfaceDepth';
import { inkOn } from '../utils/accentColor';
import { tapHaptic, selectionHaptic } from '../utils/haptics';
import { AVATAR_CHOICES, avatarAnimal, generatedName } from '../utils/avatar';

const TILE = 58;

export default function AnimalPicker({
  visible,
  onClose,
  /** The identity string the assigned animal is derived from. */
  identity,
  /** The currently chosen key, or null when the assigned one is in use. */
  chosen,
  /** (key | null) => void — null means "go back to the assigned one". */
  onChoose,
  theme,
  testID = 'animal-picker',
}) {
  const c = theme.colors;
  const insets = useSafeAreaInsets();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const accent = c.accent || c.accentInfo;

  const assigned = avatarAnimal(identity);
  // What the name will read as once this is saved — the reason the sheet says
  // it at all is that the picture and the generated handle move together.
  const preview = generatedName(identity, chosen);

  const pick = (key) => {
    selectionHaptic();
    onChoose?.(key);
  };

  return (
    <Modal transparent visible={!!visible} onRequestClose={onClose} animationType="fade" statusBarTranslucent>
      <View style={s.root}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
          accessibilityLabel="Close animal picker"
          testID={`${testID}-scrim`}
        />
        <View style={[s.sheet, { paddingBottom: panelBottomInset(insets.bottom, false) }]} testID={testID}>
          <View style={s.handleZone}><View style={s.handleBar} /></View>

          <View style={s.header}>
            <View style={s.headerText}>
              <Text style={s.title}>Your animal</Text>
              <Text numberOfLines={1} style={s.subtitle}>{preview}</Text>
            </View>
            <TouchableOpacity
              onPress={() => { tapHaptic(); onClose?.(); }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel="Done"
              testID={`${testID}-done`}
            >
              <Text style={[s.done, { color: accent }]}>Done</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={s.scroll}
            contentContainerStyle={s.grid}
            showsVerticalScrollIndicator
            scrollIndicatorInsets={{ right: 1 }}
          >
            {/* The way back. Drawn as the icon-font silhouette it really is, so
                it reads as "the one you were given" rather than as a 50th
                animal to choose between. */}
            <Pressable
              onPress={() => pick(null)}
              accessibilityRole="button"
              accessibilityLabel={`Use the animal you were given, ${assigned}`}
              accessibilityState={{ selected: !chosen }}
              style={[s.tile, !chosen && { borderColor: accent, backgroundColor: `${accent}1f` }]}
              testID={`${testID}-assigned`}
            >
              <Icon name={assigned} size={26} color={c.textSecondary} />
              <Text numberOfLines={1} style={s.tileLabel}>Assigned</Text>
            </Pressable>

            {AVATAR_CHOICES.map((a) => {
              const active = chosen === a.key;
              return (
                <Pressable
                  key={a.key}
                  onPress={() => pick(a.key)}
                  accessibilityRole="button"
                  accessibilityLabel={a.label}
                  accessibilityState={{ selected: active }}
                  style={[s.tile, active && { borderColor: accent, backgroundColor: `${accent}1f` }]}
                  testID={`${testID}-${a.key}`}
                >
                  <Text style={s.tileEmoji}>{a.emoji}</Text>
                  <Text numberOfLines={1} style={s.tileLabel}>{a.label}</Text>
                  {active && (
                    <View style={[s.tick, { backgroundColor: accent }]}>
                      <Icon name="check" size={11} color={inkOn(accent)} />
                    </View>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
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
      paddingHorizontal: 12,
      maxHeight: '78%',
      ...depth(theme, 'overlay'),
    },
    handleZone: { height: 22, alignItems: 'center', justifyContent: 'center' },
    handleBar: { width: 38, height: 4, borderRadius: 2, backgroundColor: c.border },

    header: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingHorizontal: 4, paddingBottom: 10,
    },
    // flexShrink so a long generated name narrows instead of pushing "Done"
    // off the edge of the sheet.
    headerText: { flex: 1, flexShrink: 1 },
    title: { fontSize: 17, fontWeight: '800', color: c.textPrimary },
    subtitle: { fontSize: 12.5, color: c.textTertiary, marginTop: 1 },
    done: { fontSize: 15.5, fontWeight: '700' },

    scroll: { flexGrow: 0 },
    grid: {
      flexDirection: 'row', flexWrap: 'wrap', gap: 8,
      paddingBottom: 6, justifyContent: 'flex-start',
    },
    tile: {
      width: TILE, height: TILE + 16,
      alignItems: 'center', justifyContent: 'center', gap: 2,
      borderRadius: 14, borderWidth: 1, borderColor: c.border,
      backgroundColor: c.surfaceElevated,
    },
    tileEmoji: { fontSize: 26, lineHeight: 32, textAlign: 'center' },
    tileLabel: { fontSize: 9.5, fontWeight: '600', color: c.textTertiary, maxWidth: TILE - 8 },
    tick: {
      position: 'absolute', top: -3, right: -3,
      width: 17, height: 17, borderRadius: 9,
      alignItems: 'center', justifyContent: 'center',
    },
  });
};
