/**
 * DockStylePicker — Settings → Navigation's choices about the dock, each shown
 * as the thing it does rather than described in a sentence.
 *
 * WHY PREVIEWS AND NOT A LIST OF WORDS. "Smoked" and "Paper" are the names of
 * materials; nobody can pick between two materials from their names, and the
 * dock is at the bottom of the screen BEHIND this sheet while you choose. Each tile therefore draws a real miniature dock — the same skin
 * module the real one reads, over a scrap of page so the frost has something
 * to sit on — so the choice is made by looking at the answer.
 *
 * The previews are built from dockSkins and from the live accent, not from
 * copies of those values. A preview that can disagree with the dock is worse
 * than no preview, because it is believed. CUSTOM previews the colour you
 * chose for it, whether or not it is the skin you are on.
 *
 * TWO AXES, TWO ROWS. What the capsule is MADE OF (the skin) and how it MARKS
 * the tab you are on (the indicator) are independent, so they are separate
 * rows rather than four combined options — and each row's previews are drawn
 * with the OTHER axis set to what you currently have, so every tile shows the
 * dock you would actually get.
 *
 * The indicator choice had been shipped with no control at all: the setting
 * existed, persisted and was read by the dock, and there was no way to reach
 * it from the app. A preference nobody can see is not a preference.
 */
import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { useTheme, DOCK_INDICATORS } from '../context/ThemeContext';
import { DOCK_STYLES, dockSkin } from './dockSkins';
import AccentColorPicker from './AccentColorPicker';
import { impactHaptic } from '../utils/haptics';
import { inkOn } from '../utils/accentColor';

// The miniature. Not a scaled copy of the real geometry — at a third the size
// a scaled 57pt chip in a 67pt slot leaves sub-pixel gaps — but the same
// SHAPE: a capsule of fully-rounded ends, evenly spaced glyph dots, and one
// marked tab.
//
// Sized to STRETCH, not to a fixed width: three tiles across a phone leaves
// each one about 100pt, and a capsule laid out from fixed 30pt cells would
// overflow it. The capsule fills its tile and the cells divide what is there,
// so a fourth skin would not break the row either.
const MINI_H = 30;
const MINI_SLOTS = 3;
const MINI_CHIP = 22;
const MINI_DOT = 8;
const MINI_ACTIVE = 1;

/** One miniature dock, drawn from a skin and an indicator treatment. */
export function DockPreview({ skin, indicator, accent, theme }) {
  const underline = indicator === 'underline';
  const dots = Array.from({ length: MINI_SLOTS }, (_, i) => i);
  return (
    <View
      testID="dock-preview-page"
      style={[styles.page, { backgroundColor: theme.colors.surfaceElevated }]}
    >
      {/* A scrap of "page" under the capsule, so a translucent skin has
          something to be translucent against. Two tones rather than one: a
          flat backdrop cannot show that the dock is frosted. */}
      <LinearGradient
        pointerEvents="none"
        colors={[theme.colors.background, theme.colors.surfaceElevated]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View
        testID="dock-preview-capsule"
        style={[styles.capsule, { borderColor: skin.edge }]}
      >
        <LinearGradient
          pointerEvents="none"
          colors={skin.wash.colors}
          locations={skin.wash.locations}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        {!!skin.lip && (
          <View style={[styles.miniLip, { backgroundColor: skin.lip }]} />
        )}
        {dots.map((i) => {
          const active = i === MINI_ACTIVE;
          if (active && !underline) {
            return (
              <View key={i} style={styles.cell}>
                <View style={[styles.miniChip, { backgroundColor: accent }]}>
                  <View style={[styles.miniDot, { backgroundColor: inkOn(accent) }]} />
                </View>
              </View>
            );
          }
          return (
            <View key={i} style={styles.cell}>
              <View
                style={[
                  styles.miniDot,
                  { backgroundColor: active ? accent : skin.inactiveTint },
                ]}
              />
              {active && underline && (
                <View style={[styles.miniUnderline, { backgroundColor: accent }]} />
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** One tappable tile: a preview, a name, and whether it is the one you're on. */
function Tile({ label, selected, onPress, theme, children, testID }) {
  return (
    <TouchableOpacity
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      activeOpacity={0.85}
      onPress={onPress}
      style={[
        styles.tile,
        { borderColor: selected ? theme.colors.accent : theme.colors.border },
        selected && styles.tileSelected,
      ]}
    >
      {children}
      <View style={styles.tileFooter}>
        <Text
          numberOfLines={1}
          style={[
            styles.tileLabel,
            { color: selected ? theme.colors.textPrimary : theme.colors.textSecondary },
          ]}
        >
          {label}
        </Text>
        {selected && (
          <Icon name="check-circle" size={15} color={theme.colors.accent} />
        )}
      </View>
    </TouchableOpacity>
  );
}

const INDICATOR_LABELS = { chip: 'Chip', underline: 'Underline' };

export default function DockStylePicker() {
  const {
    theme, dockStyle, setDockStyle, dockIndicator, setDockIndicator,
    dockColor, setDockColor,
  } = useTheme();
  const [colourOpen, setColourOpen] = useState(false);
  const accent = theme.colors.accent;
  const current = dockSkin(dockStyle, dockColor);

  const choose = (set, value, isCurrent) => () => {
    // Re-tapping the tile you are already on is not a change; firing a tick for
    // it makes the control feel like it did something when it did not.
    if (isCurrent) return;
    impactHaptic('light');
    set(value);
  };

  return (
    <View>
      <Text style={[styles.rowTitle, { color: theme.colors.textSecondary }]}>
        Backdrop
      </Text>
      <View style={styles.row}>
        {DOCK_STYLES.map((key) => {
          const skin = dockSkin(key, dockColor);
          const selected = key === current.key;
          // The custom tile is a door as well as a choice: picking it has to
          // ask WHICH colour, and tapping it again is how you change your mind
          // later. Every other tile is just a choice.
          const press = key === 'custom'
            ? () => { if (!selected) { impactHaptic('light'); setDockStyle(key); } setColourOpen(true); }
            : choose(setDockStyle, key, selected);
          return (
            <Tile
              key={key}
              testID={`dock-skin-${key}`}
              label={skin.name}
              selected={selected}
              theme={theme}
              onPress={press}
            >
              <DockPreview
                skin={skin}
                indicator={dockIndicator}
                accent={accent}
                theme={theme}
              />
            </Tile>
          );
        })}
      </View>
      <Text style={[styles.blurb, { color: theme.colors.textTertiary }]}>
        {current.blurb}
      </Text>

      <Text style={[styles.rowTitle, { color: theme.colors.textSecondary, marginTop: 18 }]}>
        Active tab
      </Text>
      <View style={styles.row}>
        {DOCK_INDICATORS.map((key) => {
          const selected = key === dockIndicator;
          return (
            <Tile
              key={key}
              testID={`dock-indicator-${key}`}
              label={INDICATOR_LABELS[key] || key}
              selected={selected}
              theme={theme}
              onPress={choose(setDockIndicator, key, selected)}
            >
              <DockPreview
                skin={current}
                indicator={key}
                accent={accent}
                theme={theme}
              />
            </Tile>
          );
        })}
      </View>

      {/* The same sheet the highlight colour uses — three labelled sliders and
          a hex field, already built and already holding the edge-swipe guard
          so dragging a slider cannot close the Settings page underneath it.
          Opens on the colour the dock is wearing. */}
      <AccentColorPicker
        testID="accent-sheet"
        visible={colourOpen}
        initialColor={current.colour || dockColor}
        onSelect={setDockColor}
        onClose={() => setColourOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  rowTitle: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  // Equal halves with one gap: the tiles are a comparison, so neither may be
  // wider than the other.
  row: { flexDirection: 'row', gap: 8 },
  tile: {
    flex: 1,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  // The selected tile is ringed, not filled: a fill would sit behind the
  // preview and change the thing being previewed.
  tileSelected: { borderWidth: 2 },
  tileFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 8,
  },
  tileLabel: { fontSize: 12, fontWeight: '600' },
  blurb: { fontSize: 12, lineHeight: 17, marginTop: 8 },
  page: {
    height: 58,
    justifyContent: 'flex-end',
    alignItems: 'stretch',
    paddingBottom: 7,
    overflow: 'hidden',
  },
  capsule: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    marginHorizontal: 8,
    height: MINI_H,
    borderRadius: MINI_H / 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderCurve: 'continuous',
    overflow: 'hidden',
    paddingHorizontal: 3,
  },
  cell: {
    flex: 1,
    height: MINI_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniDot: { width: MINI_DOT, height: MINI_DOT, borderRadius: 2.5 },
  miniChip: {
    width: MINI_CHIP,
    height: MINI_CHIP,
    borderRadius: 8,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniUnderline: {
    position: 'absolute',
    bottom: 6,
    width: 14,
    height: 2,
    borderRadius: 1,
  },
  miniLip: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 1,
  },
});
