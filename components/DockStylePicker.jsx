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
 * THREE AXES, THREE ROWS. What the capsule is MADE OF (the skin), how it
 * MARKS the tab you are on (the indicator), and the INK on that tab's glyph
 * are independent, so they are separate rows rather than a dozen combined
 * options — and each row's previews are drawn with the OTHER axes set to what
 * you currently have, so every tile shows the dock you would actually get.
 *
 * The indicator choice had been shipped with no control at all: the setting
 * existed, persisted and was read by the dock, and there was no way to reach
 * it from the app. A preference nobody can see is not a preference.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { useTheme, DOCK_INDICATORS } from '../context/ThemeContext';
import {
  DOCK_STYLES, DOCK_INKS, DOCK_INK_LABELS, activeInk, dockSkin,
} from './dockSkins';
import AccentColorPicker from './AccentColorPicker';
import { DOCK_PALETTES, matchingPalette, paletteSkin } from './dockPalettes';
import { DOCK_THEMES, dockTheme as findTheme, themeIsIntact, themeSkin } from './dockThemes';
import { impactHaptic } from '../utils/haptics';
import {
  describeDockMotion, describeDockTouch, getDockMotionReport, onDockMotionReport,
} from './dockMotionProbe';

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
export function DockPreview({ skin, indicator, accent, ink, theme }) {
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
                  <View testID="dock-preview-glyph" style={[styles.miniDot, { backgroundColor: ink }]} />
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
function Tile({ label, selected, onPress, theme, children, testID, style }) {
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
        style,
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

/**
 * DockMotionReadout — the last tab change, in numbers and then in a sentence.
 *
 * Subscribed to the probe's store rather than reading it through context: the
 * report lands at the end of every tab change, and re-rendering the navigator's
 * subtree that often would be a measurement that causes the thing it measures.
 * Only this one line re-renders, and only while this card is on screen.
 */
function DockMotionReadout({ theme }) {
  const [report, setReport] = useState(() => getDockMotionReport());
  useEffect(() => onDockMotionReport(setReport), []);

  const ms = (n) => `${Math.round(n)}ms`;
  return (
    <View testID="dock-motion-readout">
      {report ? (
        <Text style={[styles.readout, { color: theme.colors.text }]}>
          {report.startLateMs < 0 ? 'no touch' : `left ${ms(report.startLateMs)} after the touch`}
          {`  ·  ${report.frames} frames, worst ${ms(report.worstMs)}`}
          {report.drops > 0 ? `  ·  ${report.drops} missing` : '  ·  none missing'}
        </Text>
      ) : null}
      <Text style={[styles.blurb, { color: theme.colors.textTertiary, marginTop: report ? 4 : 0 }]}>
        {describeDockMotion(report)}
      </Text>
      {/* The second question this card answers: a tap that did not change
          tabs. Only shown once there is something to say — see
          describeDockTouch for the two ways a dock touch goes missing and
          why they cannot be told apart from the outside. */}
      {describeDockTouch(report) ? (
        <Text style={[styles.blurb, { color: theme.colors.textTertiary, marginTop: 4 }]}>
          {describeDockTouch(report)}
        </Text>
      ) : null}
    </View>
  );
}

export default function DockStylePicker() {
  const {
    theme, dockStyle, setDockStyle, dockIndicator, setDockIndicator,
    dockColor, setDockColor, dockInk, setDockInk, dockInkColor, setDockInkColor,
    accentColor, setCustomAccent, dockTheme, setDockTheme,
  } = useTheme();
  const [colourOpen, setColourOpen] = useState(false);
  // …and the same sheet again, for the custom ICON colour.
  const [inkColourOpen, setInkColourOpen] = useState(false);
  const accent = theme.colors.accent;
  const ink = activeInk(dockInk, accent, { custom: dockInkColor });

  // WHICH named theme is on, if any — and only while the settings under it
  // still agree with it, because a theme you have edited is not that theme.
  const named = findTheme(dockTheme);
  const wearing = themeIsIntact(named, { dockStyle, dockColor, accentColor, dockInk })
    ? named.key : null;
  // A palette is recomputed rather than stored (see matchingPalette), and a
  // theme outranks one: its overrides are what you are looking at, so a
  // palette tile must not also claim you when the three colours line up.
  const palette = wearing ? null : matchingPalette({ dockStyle, dockColor, accentColor, dockInk });
  // The dock as it actually is, for every preview that is meant to show you
  // the bar you have rather than the one a tile is offering.
  const current = wearing ? themeSkin(named) : dockSkin(dockStyle, dockColor);

  // A theme writes the same four settings a palette does, PLUS its key — the
  // key is the only thing that can bring its skin overrides back.
  const applyTheme = (t) => () => {
    if (t.key === wearing) return;
    impactHaptic('light');
    setDockTheme(t.key);
    setDockStyle('custom');
    setDockColor(t.backdrop);
    setDockInk(t.ink);
    setCustomAccent(t.accent);
  };

  // One tap, four settings. The accent goes through setCustomAccent, which is
  // also what switches the app onto a custom highlight — a palette that set
  // the bar and left the highlight on the old preset would be half a look.
  const applyPalette = (p) => () => {
    if (p.key === palette) return;
    impactHaptic('light');
    if (dockTheme) setDockTheme('');
    setDockStyle('custom');
    setDockColor(p.backdrop);
    setDockInk(p.ink);
    setCustomAccent(p.accent);
  };

  const choose = (set, value, isCurrent) => () => {
    // Re-tapping the tile you are already on is not a change; firing a tick for
    // it makes the control feel like it did something when it did not.
    if (isCurrent) return;
    impactHaptic('light');
    // ANY hand-made change drops the theme. A theme's overrides are not
    // settings, so leaving the key on while you edit the colours under it
    // would paint a dock that matches nothing you can see in this card.
    if (dockTheme) setDockTheme('');
    set(value);
  };

  return (
    <View>
      {/* THEMES first, and wide. These are whole composed looks rather than a
          colour pairing — the tile is the width of the card because that is
          the only way to show one as a dock rather than as a swatch, and
          because there will not be many of them. */}
      <Text style={[styles.rowTitle, { color: theme.colors.textSecondary }]}>
        Themes
      </Text>
      {DOCK_THEMES.map((t) => {
        const selected = t.key === wearing;
        return (
          <Tile
            key={t.key}
            testID={`dock-theme-${t.key}`}
            label={t.name}
            selected={selected}
            theme={theme}
            style={styles.wideTile}
            onPress={applyTheme(t)}
          >
            <DockPreview
              skin={themeSkin(t)}
              indicator={dockIndicator}
              accent={t.accent}
              ink={activeInk(t.ink, t.accent)}
              theme={theme}
            />
          </Tile>
        );
      })}
      <Text style={[styles.blurb, { color: theme.colors.textTertiary }]}>
        {wearing ? named.tagline : DOCK_THEMES[0].tagline}
      </Text>

      {/* The quick way in: the three rows under these are the same decisions
          taken one at a time. Wrapped rather than scrolled — a horizontal
          scroller hides options, and five is few enough to show at once. */}
      <Text style={[styles.rowTitle, { color: theme.colors.textSecondary, marginTop: 18 }]}>
        Palettes
      </Text>
      <View style={[styles.row, styles.rowWrap]}>
        {DOCK_PALETTES.map((p) => {
          const selected = p.key === palette;
          return (
            <Tile
              key={p.key}
              testID={`dock-palette-${p.key}`}
              label={p.name}
              selected={selected}
              theme={theme}
              style={styles.thirdTile}
              onPress={applyPalette(p)}
            >
              <DockPreview
                skin={paletteSkin(p)}
                indicator={dockIndicator}
                accent={p.accent}
                ink={activeInk(p.ink, p.accent)}
                theme={theme}
              />
            </Tile>
          );
        })}
      </View>
      <Text style={[styles.blurb, { color: theme.colors.textTertiary }]}>
        A backdrop and the highlight that goes on it, paired. The highlight is
        used across the whole app, not just here — and everything below stays
        editable afterwards.
      </Text>

      <Text style={[styles.rowTitle, { color: theme.colors.textSecondary, marginTop: 18 }]}>
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
                ink={ink}
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
                ink={ink}
                theme={theme}
              />
            </Tile>
          );
        })}
      </View>

      <Text style={[styles.rowTitle, { color: theme.colors.textSecondary, marginTop: 18 }]}>
        Active icon
      </Text>
      <View style={styles.row}>
        {DOCK_INKS.map((key) => {
          const selected = key === dockInk;
          return (
            <Tile
              key={key}
              testID={`dock-ink-${key}`}
              label={DOCK_INK_LABELS[key]}
              selected={selected}
              theme={theme}
              // Custom is a mode AND a colour: tapping it switches to it and
              // opens the sheet, and tapping it again reopens the sheet to
              // change the colour.
              onPress={key === 'custom'
                ? () => {
                  if (!selected) setDockInk('custom');
                  setInkColourOpen(true);
                }
                : choose(setDockInk, key, selected)}
            >
              {/* Each tile draws the glyph in the ink it is offering, so the
                  one that LOOKS right is the one you tap. 'Auto' draws
                  whatever the contrast check currently answers for your
                  accent — which is why it is a preview and not a word. */}
              <DockPreview
                skin={current}
                indicator="chip"
                accent={accent}
                ink={activeInk(key, accent, { custom: dockInkColor })}
                theme={theme}
              />
            </Tile>
          );
        })}
      </View>
      <Text style={[styles.blurb, { color: theme.colors.textTertiary }]}>
        {dockInk === 'auto'
          ? 'Chosen for you — black or white, whichever reads better on the highlight colour (or on the bar itself, with the underline).'
          : 'Set by hand. Change the highlight colour and this stays as you left it.'}
      </Text>

      {/* HOW THE LAST MOVE WENT.
          Here rather than in a developer panel because this is the card you
          are on while you are tapping the dock to see whether the chip is
          right — and because "it still lags" and "it still stutters" are two
          different faults with two different fixes, which is what cost an
          afternoon of retiming a curve that was never the problem. See
          components/dockMotionProbe. */}
      <Text style={[styles.rowTitle, { color: theme.colors.textSecondary, marginTop: 18 }]}>
        Last move
      </Text>
      <DockMotionReadout theme={theme} />

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
      {/* The custom icon colour. Opens on the colour it is wearing. */}
      <AccentColorPicker
        testID="ink-sheet"
        visible={inkColourOpen}
        initialColor={dockInkColor}
        onSelect={setDockInkColor}
        onClose={() => setInkColourOpen(false)}
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
  rowWrap: { flexWrap: 'wrap' },
  // Three to a line, so five palettes are 3 + 2 rather than a scroller. The
  // flexBasis is what makes the second line's two tiles stay the width of the
  // first line's three instead of stretching to half the row each.
  thirdTile: { flexGrow: 0, flexBasis: '31.5%' },
  // A theme gets the full width: it is a look, not a swatch, and a dock drawn
  // at a third of the card is a stripe.
  wideTile: { alignSelf: 'stretch' },
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
  // The numbers themselves: tabular so the three figures do not shuffle
  // sideways as they change between one tab change and the next, which is
  // exactly the kind of movement that makes a readout hard to read.
  readout: {
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
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
