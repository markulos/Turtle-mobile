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
  DOCK_STYLES, DOCK_INKS, DOCK_INK_LABELS, DOCK_GLOWS, activeInk, dockSkin,
} from './dockSkins';
import AccentColorPicker from './AccentColorPicker';
import { DOCK_PALETTES, matchingPalette, paletteSkin } from './dockPalettes';
import {
  DOCK_THEMES, dockTheme as findTheme, themeIsIntact, themeSkin,
} from './dockThemes';
import DockLivePreview from './DockLivePreview';
import DockGlow from './DockGlow';
import { dockLight, glowStrength } from './dockLight';
import { impactHaptic } from '../utils/haptics';
import AppTextInput from './AppTextInput';
import { INPUT_FIELD } from '../utils/inputField';
import { inkOn } from '../utils/accentColor';
import { MAX_LOOKS, NAME_MAX, cleanName, wornLook } from './savedLooks';
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
// The spot, at the miniature's scale: about the real one's proportions
// against the line under it.
const MINI_SPOT_W = 34;
const MINI_SPOT_H = 20;
const MINI_ACTIVE = 1;

// The height every control in the naming row shares — the same 40 the search
// field at the top of Settings uses, so the two read as one family.
const FIELD_H = 40;

/** One miniature dock, drawn from a skin and an indicator treatment. */
export function DockPreview({
  skin, indicator, accent, ink, theme, glow, glowColor,
}) {
  const underline = indicator === 'underline';
  const dots = Array.from({ length: MINI_SLOTS }, (_, i) => i);
  // The same numbers the real dock lights itself with (dockLight), so a tile
  // offering "Strong" shows strong, and a tile offering a colour shows it —
  // the tiles used to stand in a flat blob for all of this.
  const light = dockLight({ glow, glowColor, accent });
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
          if (i !== MINI_ACTIVE) {
            return (
              <View key={i} style={styles.cell}>
                <View style={[styles.miniDot, { backgroundColor: skin.inactiveTint }]} />
              </View>
            );
          }
          // THE CHIP: the highlight colour, let through a little, exactly as
          // on the bar — see dockLight's chipFill.
          if (!underline) {
            return (
              <View key={i} style={styles.cell}>
                <View
                  testID="dock-preview-chip"
                  style={[styles.miniChip, { backgroundColor: light.chipFill }]}
                >
                  <View testID="dock-preview-glyph" style={[styles.miniDot, { backgroundColor: ink }]} />
                </View>
              </View>
            );
          }
          // THE UNDERLINE: the line, the pool of light standing on it, and
          // the glyph in its own ink — which with no chip under it is NOT
          // the highlight colour (it used to be drawn as if it were).
          return (
            <View key={i} style={styles.cell}>
              {light.strength > 0 ? (
                <View pointerEvents="none" testID="dock-preview-spot" style={styles.miniSpot}>
                  <DockGlow
                    id="dock-mini-spot"
                    width={MINI_SPOT_W}
                    height={MINI_SPOT_H}
                    color={light.spotColor}
                    peak={light.spotPeak}
                    cy={1}
                    ry={1}
                  />
                </View>
              ) : null}
              <View testID="dock-preview-glyph" style={[styles.miniDot, { backgroundColor: ink }]} />
              <View style={[styles.miniUnderline, { backgroundColor: accent }]} />
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
 * A saved look's capsule, and the ink on its chip.
 *
 * A look that was saved while a THEME was on keeps that theme's key, and a
 * theme may override fields no setting has a slot for — so the skin comes
 * from the theme when there is one and from the ordinary style + colour when
 * there is not. Without this a Godzilla-derived look would preview as a flat
 * approximation of itself and then apply as the real thing, which is the one
 * thing a preview must never do.
 */
const lookSkin = (look) => {
  const named = findTheme(look.themeKey);
  return named ? themeSkin(named) : dockSkin(look.style, look.color);
};

const lookInk = (look, skin) => activeInk(look.ink, look.accent, {
  underline: look.indicator === 'underline',
  darkDock: skin.blurTint === 'dark',
  custom: look.inkColor,
});

/**
 * YOUR LOOKS — the ones this person built and named.
 *
 * ── Why the naming happens INLINE and not in a dialog ──────────────────────
 *
 * `Alert.prompt` is iOS-only and AlbumActionsSheet already carries the note
 * about it silently vanishing on Android. A <Modal> is worse here than merely
 * unportable: this panel can itself be inside one (an EdgeSwipePage is a
 * Modal), and on iOS a second sibling Modal over an open one never appears —
 * which is the exact trap MusicVault's options button is written around. So
 * the field opens in place, in the card you are already looking at, and the
 * whole feature costs no new surface.
 *
 * ── Why there is no "update this look" ─────────────────────────────────────
 *
 * Saving under a name you already used replaces it (see savedLooks' addLook),
 * so updating one is: wear it, change it, save it under the same name. One
 * verb rather than two, and the one you would have reached for anyway.
 */
function SavedLooksRow({
  // Defaulted rather than assumed: this is a settings page, and a context
  // that is mid-load or partially stubbed must not take the whole card down
  // over a feature that has nothing to show yet.
  theme, looks = [], worn, canSave, onApply, onSave, onDelete,
}) {
  const c = theme.colors;
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState('');
  const name = cleanName(draft);
  const full = looks.length >= MAX_LOOKS;
  // Saving over a name already in use REPLACES it rather than failing, so the
  // button says which of the two is about to happen. Being told afterwards
  // that something was overwritten is the version of this that loses work.
  const replacing = looks.some((l) => l.name.toLowerCase() === name.toLowerCase());

  const commit = () => {
    if (!name) return;
    impactHaptic('light');
    onSave(name);
    setDraft('');
    setNaming(false);
  };

  return (
    <View testID="saved-looks">
      <Text style={[styles.rowTitle, { color: c.textSecondary, marginTop: 18 }]}>
        Your looks
      </Text>

      {looks.map((look) => {
        const selected = worn?.id === look.id;
        const skin = lookSkin(look);
        return (
          <View key={look.id} style={styles.savedRow}>
            <Tile
              testID={`saved-look-${look.id}`}
              label={look.name}
              selected={selected}
              theme={theme}
              style={styles.wideTile}
              onPress={() => onApply(look)}
            >
              <DockPreview
                skin={skin}
                indicator={look.indicator}
                accent={look.accent || c.accent}
                ink={lookInk(look, skin)}
                glow={look.glow}
                glowColor={look.glowColor}
                theme={theme}
              />
            </Tile>
            {/* Its own target, away from the tile: a look you spent twenty
                minutes on must not be one mis-aimed thumb from gone. */}
            <TouchableOpacity
              testID={`saved-look-delete-${look.id}`}
              accessibilityRole="button"
              accessibilityLabel={`Delete the look ${look.name}`}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              onPress={() => { impactHaptic('light'); onDelete(look.id); }}
              style={styles.savedDelete}
            >
              <Icon name="close" size={16} color={c.textTertiary} />
            </TouchableOpacity>
          </View>
        );
      })}

      {naming ? (
        <View style={styles.nameRow}>
          {/* The field is a FILL with a radius, not a bordered box — the same
              chrome as the search pill at the top of this screen. A hairline
              rectangle reads as a form; these two now read as one family. */}
          <View style={[styles.nameField, { backgroundColor: c.inputBackground }]}>
            <AppTextInput
              testID="saved-look-name"
              value={draft}
              onChangeText={setDraft}
              placeholder="Name this look"
              placeholderTextColor={c.textTertiary}
              maxLength={NAME_MAX}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={commit}
              style={[styles.nameInput, { color: c.inputText }]}
            />
          </View>
          <TouchableOpacity
            testID="saved-look-confirm"
            accessibilityRole="button"
            accessibilityLabel={replacing ? `Replace the look ${name}` : 'Save this look'}
            disabled={!name}
            onPress={commit}
            style={[
              styles.nameBtn,
              // Disabled takes a flat neutral rather than a faded accent: a
              // washed-out highlight colour looks like a rendering fault,
              // where a grey key plainly reads as "not yet".
              { backgroundColor: name ? c.accent : c.surfaceHighlight },
            ]}
          >
            <Text
              style={[
                styles.nameBtnText,
                { color: name ? inkOn(c.accent) : c.textTertiary },
              ]}
            >
              {replacing ? 'Replace' : 'Save'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="saved-look-cancel"
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            onPress={() => { setNaming(false); setDraft(''); }}
            style={styles.nameGhost}
          >
            <Text style={[styles.nameGhostText, { color: c.textSecondary }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          testID="saved-look-add"
          accessibilityRole="button"
          accessibilityLabel="Save the dock you are wearing as a named look"
          disabled={full || !canSave}
          onPress={() => { impactHaptic('light'); setNaming(true); }}
          style={[styles.saveBtn, { borderColor: c.border }, (full || !canSave) && styles.saveBtnOff]}
        >
          <Icon name="plus" size={16} color={c.textSecondary} />
          <Text style={[styles.saveBtnText, { color: c.textSecondary }]}>
            Save this look
          </Text>
        </TouchableOpacity>
      )}

      <Text style={[styles.blurb, { color: c.textTertiary }]}>
        {full
          ? `That is all ${MAX_LOOKS}. Delete one to keep another.`
          : looks.length === 0
            ? 'Build a dock you like below, then keep it here under a name of your own.'
            : canSave
              ? 'Saving a name you have used before replaces that look.'
              : `You are wearing “${worn?.name}”. Change something to save a new one.`}
      </Text>
    </View>
  );
}

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
    dockColor, setDockColor, dockInk, setDockInk, dockInkColor, setDockInkColor, dockGlow, setDockGlow, dockGlowColor, setDockGlowColor,
    accentColor, setCustomAccent, dockTheme, setDockTheme,
    savedLooks = [], saveLook, deleteLook,
  } = useTheme();
  const [colourOpen, setColourOpen] = useState(false);
  // …and the same sheet again, for the custom ICON colour.
  const [inkColourOpen, setInkColourOpen] = useState(false);
  const [glowColourOpen, setGlowColourOpen] = useState(false);
  const [highlightOpen, setHighlightOpen] = useState(false);
  const accent = theme.colors.accent;
  // The ink a preview's active glyph takes. It depends on what the glyph is
  // sitting on — the chip, or with the underline the bar itself — so every
  // tile asks with ITS OWN skin and indicator, exactly as App.js does for the
  // real dock. (They used to ask with neither, and drew the chip's answer
  // under an underline.)
  const inkFor = (mode, on, skin, ind = dockIndicator) => activeInk(mode, on, {
    underline: ind === 'underline',
    darkDock: skin.blurTint === 'dark',
    custom: dockInkColor,
  });

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
  // WHAT THE REAL DOCK IS WEARING, for the live preview — the same
  // call App.js makes, so the picture and the bar cannot disagree.
  const glowLevel = glowStrength(dockGlow);
  const liveInk = inkFor(dockInk, accent, current);

  // AUTO OR CUSTOM.
  //
  // Three things in this panel can be worked out from the look instead of
  // chosen: the active icon's ink, how strong the glow is, and what colour it
  // is. Auto is "work them out"; Custom shows the controls. A look's own ink
  // (a theme or palette writes one) counts as worked out — nobody chose it by
  // hand. The mode is not a stored setting: it is read from whether any of
  // the three has been set by hand, so there is nothing to get out of step.
  const inkByHand = dockInk !== 'auto' && !wearing && !palette;
  const byHand = inkByHand || !!dockGlowColor || Math.abs(glowLevel - 1) > 0.05;
  const [mode, setMode] = useState(byHand ? 'custom' : 'auto');
  const custom = mode === 'custom';
  const goCustom = () => {
    if (custom) return;
    impactHaptic('light');
    setMode('custom');
  };
  // Going back to Auto UNDOES the hand-set values — otherwise "Auto" would be
  // a label on a dock that is still wearing last week's custom glow.
  const goAuto = () => {
    if (!custom) return;
    impactHaptic('light');
    if (inkByHand) setDockInk('auto');
    if (Math.abs(glowLevel - 1) > 0.05) setDockGlow(1);
    if (dockGlowColor) setDockGlowColor(null);
    setMode('auto');
  };

  // WHICH saved look is on, worked out by comparing the settings rather than
  // remembered — the same rule a palette follows, and for the same reason:
  // nudge one control and you are no longer wearing what you saved, with
  // nothing needing to be cleared for that to become true.
  const wornSaved = wornLook(savedLooks, {
    dockIndicator, dockStyle, dockColor, dockInk, dockInkColor,
    dockGlow, dockGlowColor, dockTheme, accentColor,
  });

  /**
   * Wear a saved look. Every field it holds, including the theme key — a look
   * saved off Godzilla has to come back AS Godzilla or its overridden glyphs
   * and rim are quietly lost.
   *
   * setDockTheme first, so no intermediate state has a theme key pointing at
   * one look while the colours under it belong to another.
   */
  const applyLook = (look) => {
    if (wornSaved?.id === look.id) return;
    impactHaptic('light');
    setDockTheme(look.themeKey || '');
    setDockIndicator(look.indicator);
    setDockStyle(look.style);
    if (look.color) setDockColor(look.color);
    setDockInk(look.ink);
    if (look.inkColor) setDockInkColor(look.inkColor);
    setDockGlow(look.glow);
    setDockGlowColor(look.glowColor);
    if (look.accent) setCustomAccent(look.accent);
  };

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
      {/* THE WHOLE NAVBAR, LIVE. Every choice in this panel is drawn here the
          moment it is made, at the bar's real size — see DockLivePreview. */}
      <DockLivePreview
        skin={current}
        indicator={dockIndicator}
        accent={accent}
        ink={liveInk}
        glow={glowLevel}
        glowColor={dockGlowColor}
        theme={theme}
      />

      {/* AUTO OR CUSTOM. One lit key of two, like the status keys on Tasks. */}
      <View style={[styles.modeRow, { borderColor: theme.colors.border }]}>
        {[['auto', 'Auto', goAuto], ['custom', 'Custom', goCustom]].map(([key, label, go]) => {
          const on = mode === key;
          return (
            <TouchableOpacity
              key={key}
              testID={`dock-mode-${key}`}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${label} navbar appearance${on ? ', selected' : ''}`}
              activeOpacity={0.6}
              onPress={go}
              style={[styles.modeKey, on && { backgroundColor: theme.colors.textPrimary }]}
            >
              <Text
                numberOfLines={1}
                style={[
                  styles.modeLabel,
                  { color: on ? theme.colors.background : theme.colors.textSecondary },
                ]}
              >
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={[styles.blurb, { color: theme.colors.textTertiary }]}>
        {custom
          ? 'Set by hand: the active icon, the glow and the highlight colour, below.'
          : 'Pick a look. The active icon and the glow are worked out from it.'}
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
                ink={inkFor(dockInk, accent, current, key)}
                glow={glowLevel}
                glowColor={dockGlowColor}
                theme={theme}
              />
            </Tile>
          );
        })}
      </View>

      {custom ? (
        <>
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
                indicator={dockIndicator}
                accent={accent}
                ink={inkFor(key, accent, current)}
                glow={glowLevel}
                glowColor={dockGlowColor}
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

      {/* THE GLOW. The pool of light rising off the UNDERLINE. The chip has
          none: it is the highlight colour let through a little, over the real
          glass of the bar, which is depth rather than a drawing of it.
          Four steps, because the gap between two neighbouring strengths of a
          subtle effect is not something a slider can be set to by eye. */}
      <Text style={[styles.rowTitle, { color: theme.colors.textSecondary, marginTop: 18 }]}>
        Glow
      </Text>
      <View style={styles.row}>
        {DOCK_GLOWS.map((g) => {
          const selected = Math.abs((Number.isFinite(dockGlow) ? dockGlow : 1) - g.value) < 0.05;
          return (
            <Tile
              key={g.key}
              testID={`dock-glow-${g.key}`}
              label={g.label}
              selected={selected}
              theme={theme}
              onPress={choose(setDockGlow, g.value, selected)}
            >
              {/* Your own bar, at this step's strength. */}
              <DockPreview
                skin={current}
                indicator={dockIndicator}
                accent={accent}
                ink={inkFor(dockInk, accent, current)}
                glow={g.value}
                glowColor={dockGlowColor}
                theme={theme}
              />
            </Tile>
          );
        })}
      </View>
      <Text style={[styles.blurb, { color: theme.colors.textTertiary }]}>
        How much light the guide gives off. Off leaves just the line or the chip.
      </Text>

      {/* THE GLOW'S COLOUR. It follows the highlight colour unless one is
          picked — on light bars and dark ones alike. Custom is a mode AND a
          colour, exactly like the icon ink above: tapping it switches to it
          and opens the sheet, tapping it again reopens the sheet. */}
      <Text style={[styles.rowTitle, { color: theme.colors.textSecondary, marginTop: 18 }]}>
        Glow colour
      </Text>
      <View style={styles.row}>
        <Tile
          testID="dock-glow-colour-accent"
          label="Highlight"
          selected={!dockGlowColor}
          theme={theme}
          onPress={choose(setDockGlowColor, null, !dockGlowColor)}
        >
          <DockPreview
            skin={current}
            indicator={dockIndicator}
            accent={accent}
            ink={inkFor(dockInk, accent, current)}
            glow={glowLevel || 1}
            glowColor={null}
            theme={theme}
          />
        </Tile>
        <Tile
          testID="dock-glow-colour-custom"
          label="Custom"
          selected={!!dockGlowColor}
          theme={theme}
          onPress={() => {
            if (!dockGlowColor) {
              impactHaptic('light');
              if (dockTheme) setDockTheme('');
              // Starts from the colour it is already wearing, so opening the
              // sheet changes nothing until a slider moves.
              setDockGlowColor(accent);
            }
            setGlowColourOpen(true);
          }}
        >
          {/* Until one is picked, white: it has to differ from the tile
              beside it or the row offers the same thing twice. */}
          <DockPreview
            skin={current}
            indicator={dockIndicator}
            accent={accent}
            ink={inkFor(dockInk, accent, current)}
            glow={glowLevel || 1}
            glowColor={dockGlowColor || '#FFFFFF'}
            theme={theme}
          />
        </Tile>
      </View>
      <Text style={[styles.blurb, { color: theme.colors.textTertiary }]}>
        {dockGlowColor
          ? 'Set by hand. Change the highlight colour and the glow stays as you left it.'
          : 'The glow takes your highlight colour, and changes with it.'}
      </Text>


      {/* THE HIGHLIGHT COLOUR, here as well as on its own row above — it is
          the chip, the line and (unless one is picked) the glow, so a navbar
          panel without it is missing its main colour. Same setting, same
          sheet. */}
      <Text style={[styles.rowTitle, { color: theme.colors.textSecondary, marginTop: 18 }]}>
        Highlight colour
      </Text>
      <View style={styles.row}>
        <Tile
          testID="dock-highlight"
          label="Change colour"
          selected={false}
          theme={theme}
          onPress={() => setHighlightOpen(true)}
        >
          <DockPreview
            skin={current}
            indicator={dockIndicator}
            accent={accent}
            ink={inkFor(dockInk, accent, current)}
            glow={glowLevel}
            glowColor={dockGlowColor}
            theme={theme}
          />
        </Tile>
      </View>
      <Text style={[styles.blurb, { color: theme.colors.textTertiary }]}>
        Used across the whole app, not just the navbar.
      </Text>
        </>
      ) : null}

      {/* ── YOUR LOOKS ─────────────────────────────────────────────────────
          Above Themes on purpose: the ones you made are the ones you are
          looking for. Everything below this point is a way to BUILD a look;
          this is where they come back.

          Drawn as the same wide dock preview a theme gets, because a saved
          look IS a theme in every way that matters to the eye — and because
          a swatch cannot show an indicator, a glow or an ink. */}
      <SavedLooksRow
        theme={theme}
        looks={savedLooks}
        worn={wornSaved}
        canSave={!wornSaved}
        onApply={applyLook}
        onSave={saveLook}
        onDelete={deleteLook}
      />

      {/* THEMES, and wide. These are whole composed looks rather than a
          colour pairing — the tile is the width of the card because that is
          the only way to show one as a dock rather than as a swatch, and
          because there will not be many of them. */}
      <Text style={[styles.rowTitle, { color: theme.colors.textSecondary, marginTop: 18 }]}>
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
              ink={inkFor(t.ink, t.accent, themeSkin(t))}
              glow={glowLevel}
              glowColor={dockGlowColor}
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
                ink={inkFor(p.ink, p.accent, paletteSkin(p))}
                glow={glowLevel}
                glowColor={dockGlowColor}
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
                ink={inkFor(dockInk, accent, skin)}
                glow={glowLevel}
                glowColor={dockGlowColor}
                theme={theme}
              />
            </Tile>
          );
        })}
      </View>
      <Text style={[styles.blurb, { color: theme.colors.textTertiary }]}>
        {current.blurb}
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
        testID="highlight-sheet"
        visible={highlightOpen}
        initialColor={accent}
        onSelect={(hex) => {
          // A hand-made change, like any other: it drops the theme.
          if (dockTheme) setDockTheme('');
          setCustomAccent(hex);
        }}
        onClose={() => setHighlightOpen(false)}
      />
      <AccentColorPicker
        testID="glow-sheet"
        visible={glowColourOpen}
        initialColor={dockGlowColor || accent}
        onSelect={setDockGlowColor}
        onClose={() => setGlowColourOpen(false)}
      />
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
  // The Auto / Custom keys: one hairline pill holding two equal keys, the lit
  // one inverted against the card.
  modeRow: {
    flexDirection: 'row',
    marginTop: 12,
    padding: 3,
    borderRadius: 14,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  modeKey: {
    flex: 1,
    minHeight: 44,
    borderRadius: 11,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeLabel: { fontSize: 14, fontWeight: '600' },
  // Three to a line, so five palettes are 3 + 2 rather than a scroller. The
  // flexBasis is what makes the second line's two tiles stay the width of the
  // first line's three instead of stretching to half the row each.
  thirdTile: { flexGrow: 0, flexBasis: '31.5%' },
  // A theme gets the full width: it is a look, not a swatch, and a dock drawn
  // at a third of the card is a stripe.
  wideTile: { alignSelf: 'stretch' },

  // ── Your looks ───────────────────────────────────────────────────────
  // The tile takes the row and the delete key sits ON it, top-right: a
  // separate column would narrow every preview by 32pt to hold a control
  // you touch once in a month.
  savedRow: { position: 'relative', marginBottom: 8 },
  savedDelete: {
    position: 'absolute', top: 6, right: 6,
    width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  // One height for all three, and the ROW centres them — a field that
  // declares its own height alongside a row that centres it is how a caret
  // and its placeholder stop landing on the same line (see INPUT_FIELD).
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nameField: {
    flex: 1,
    height: FIELD_H,
    // Fully rounded: height/2, exactly as the search pill above. At this
    // height anything less reads as an accidental radius rather than a shape.
    borderRadius: FIELD_H / 2,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  nameInput: { ...INPUT_FIELD, flex: 1, height: FIELD_H, fontSize: 15 },
  nameBtn: {
    height: FIELD_H,
    paddingHorizontal: 18,
    borderRadius: FIELD_H / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameBtnText: { fontSize: 14, fontWeight: '700' },
  // Cancel is a word, not a key — but it still needs the row's height under
  // it so it is a target rather than a line of text to pinch at.
  nameGhost: { height: FIELD_H, paddingHorizontal: 6, justifyContent: 'center' },
  nameGhostText: { fontSize: 14, fontWeight: '600' },
  // An outline rather than a filled key: this is the quiet option on a card
  // where the tiles are the loud ones.
  // Dashed, which is this app's add-affordance (BoardManagerSheet,
  // PeoplePicker, CalendarPartners all use it) — and the SAME height and
  // radius as the naming row it swaps with, so tapping it does not make the
  // section jump a few points as one replaces the other.
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: FIELD_H, borderRadius: FIELD_H / 2,
    borderWidth: StyleSheet.hairlineWidth, borderStyle: 'dashed',
  },
  saveBtnOff: { opacity: 0.4 },
  saveBtnText: { fontSize: 13, fontWeight: '600' },
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
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Wider than its cell on purpose (the real spot is wider than its glyph);
  // centred, and clipped by the capsule like the real one.
  miniSpot: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 8,
    alignItems: 'center',
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
