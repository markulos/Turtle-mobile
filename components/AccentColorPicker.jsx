/**
 * AccentColorPicker — the sheet behind Settings → Appearance's custom swatch.
 *
 * Built in JS over `expo-linear-gradient` (already in the app) rather than any
 * of the native colour-picker packages: a native module changes the runtime
 * fingerprint, so it cannot ship over the air and every phone would need a new
 * build to get a colour picker.
 *
 * THREE SLIDERS, NOT A SQUARE. The usual saturation/value rectangle with a hue
 * strip under it needs a 2-D gesture on a small target, and "make this pink
 * lighter" becomes a diagonal drag. Hue · Saturation · Lightness are three
 * 1-D drags, each labelled with the word for what it does, and each track is
 * PAINTED with its own outcome — the lightness track runs black → the colour →
 * white, so the slider shows you the choice before you make it.
 *
 * The hex field is the other half: it is how a colour gets IN (a brand colour,
 * something pasted from a screenshot) rather than found by dragging. Both write
 * the same one state, so the sliders follow a typed hex and the field follows a
 * drag.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Pressable,
  Animated,
  PanResponder,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import AppTextInput from './AppTextInput';
import { panelBottomInset } from './tabBarLayout';
import { useTheme } from '../context/ThemeContext';
import { useSheetDismiss } from '../utils/useSheetDismiss';
import useKeyboardHeight from '../utils/useKeyboardHeight';
import { depth } from '../utils/surfaceDepth';
import { impactHaptic, markGesture } from '../utils/haptics';
import {
  hexToHsl,
  hslToHex,
  inkOn,
  legibilityNote,
  normalizeHex,
} from '../utils/accentColor';

const { height: SCREEN_H } = Dimensions.get('window');

const THUMB = 28;
// The track's own height. The ROW is 44 (§3) — the grab area is the row, not
// this — and the thumb overhangs it either side, which is what makes a 14 pt
// ribbon aimable.
const TRACK_H = 14;
const ROW_H = 44;

const HUE_STOPS = ['#FF0000', '#FFFF00', '#00FF00', '#00FFFF', '#0000FF', '#FF00FF', '#FF0000'];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Where a touch at `x` lands on a track `width` wide, as 0–1.
 *
 * Exported and pure because this is the one line that decides whether the
 * colour under the thumb is the colour under the finger, and a zero width (the
 * frame before onLayout reports) must read as 0 rather than as NaN — a NaN
 * reaches `left` and RN silently drops the thumb out of the row.
 */
export const fractionAt = (x, width) => (width > 0 ? clamp(x / width, 0, 1) : 0);

/**
 * One labelled track.
 *
 * The gesture is relative — where the finger went DOWN plus how far it has
 * travelled — so it never has to measure the track's position on the screen.
 * `measureInWindow` is async and, for a node it cannot resolve, never calls
 * back at all (the same trap the people popover hit), which here would be a
 * slider that ignores the first drag after opening.
 */
function ColorSlider({ label, value, max, colors, thumbColor, onChange, theme, styles }) {
  const [width, setWidth] = useState(0);
  // Read by the responder, which is built once: state would be captured stale.
  const widthRef = useRef(0);
  const startRef = useRef(0);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const maxRef = useRef(max);
  maxRef.current = max;

  const emit = useCallback((x) => {
    const frac = fractionAt(x, widthRef.current);
    onChangeRef.current?.(Math.round(frac * maxRef.current));
  }, []);

  const responder = useMemo(
    () =>
      PanResponder.create({
        // A tap anywhere on the track moves the thumb there: this control has no
        // "press" of its own, so claiming on touch-down costs nothing and makes
        // the whole ribbon usable instead of just the 28 pt knob.
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          const x = clamp(e.nativeEvent.locationX, 0, widthRef.current);
          startRef.current = x;
          emit(x);
        },
        onPanResponderMove: (_e, g) => {
          // §3: nothing may buzz while a finger is travelling. Stamping the gate
          // here silences any press-in haptic the sheet's own keys would fire if
          // the drag happens to end over one.
          markGesture();
          emit(startRef.current + g.dx);
        },
      }),
    [emit],
  );

  const frac = max > 0 ? clamp(value / max, 0, 1) : 0;

  return (
    <View style={styles.sliderBlock}>
      <View style={styles.sliderHead}>
        <Text style={styles.sliderLabel} numberOfLines={1}>{label}</Text>
        <Text style={styles.sliderValue}>{Math.round(value)}</Text>
      </View>
      <View
        style={styles.sliderRow}
        onLayout={(e) => {
          const w = e.nativeEvent.layout.width;
          widthRef.current = w;
          setWidth(w);
        }}
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min: 0, max, now: Math.round(value) }}
        {...responder.panHandlers}
      >
        <LinearGradient
          colors={colors}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={styles.track}
        />
        <View
          pointerEvents="none"
          style={[
            styles.thumb,
            { left: frac * width - THUMB / 2, backgroundColor: thumbColor },
          ]}
        />
      </View>
    </View>
  );
}

/**
 * Props:
 *   visible      — show/hide
 *   initialColor — '#RRGGBB' the sheet opens on (the live accent)
 *   onSelect     — (hex) => void, on "Use this colour"
 *   onClose      — () => void
 */
export default function AccentColorPicker({ visible, initialColor, onSelect, onClose }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const keyboardH = useKeyboardHeight();
  const styles = useMemo(() => createStyles(theme), [theme]);

  // ONE colour, two ways in. `hex` is the answer; `hsl` is the same colour in
  // the numbers the sliders speak. Both are stored rather than derived from each
  // other, because a round trip through HSL rounds — a typed #F97316 would come
  // back a point off and the field would appear to correct what was just typed.
  const [hsl, setHsl] = useState({ h: 0, s: 0, l: 50 });
  const [hex, setHex] = useState('#FFFFFF');
  // What the field shows. Diverges from `hex` only while a half-typed hex is in
  // it ('#F9' is not a colour yet, and must not be rewritten under the caret).
  const [draft, setDraft] = useState('#FFFFFF');

  const backdrop = useRef(new Animated.Value(0)).current;
  const sheetY = useRef(new Animated.Value(SCREEN_H)).current;
  const lift = useRef(new Animated.Value(0)).current;

  // Seed from the live accent on every open, and slide up.
  useEffect(() => {
    if (!visible) return;
    const seed = normalizeHex(initialColor) || '#F97316';
    setHex(seed);
    setDraft(seed);
    setHsl(hexToHsl(seed));

    backdrop.setValue(0);
    sheetY.setValue(SCREEN_H);
    Animated.parallel([
      Animated.timing(backdrop, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.spring(sheetY, { toValue: 0, useNativeDriver: true, damping: 22, stiffness: 240, mass: 0.9 }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialColor]);

  // §4: no KeyboardAvoidingView. The card lifts by the keyboard's height on a
  // native-driver transform — it is short enough that clearing the keyboard
  // entirely leaves everything reachable, so there is nothing to scroll.
  useEffect(() => {
    Animated.timing(lift, {
      toValue: keyboardH > 0 ? -keyboardH : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [keyboardH, lift]);

  const animateOut = useCallback(
    (after) => {
      Animated.parallel([
        Animated.timing(backdrop, { toValue: 0, duration: 180, useNativeDriver: true }),
        Animated.timing(sheetY, { toValue: SCREEN_H, duration: 220, useNativeDriver: true }),
      ]).start(() => after && after());
    },
    [backdrop, sheetY],
  );

  const handleCancel = useCallback(() => animateOut(() => onClose?.()), [animateOut, onClose]);

  const handleUse = useCallback(() => {
    impactHaptic('light');
    animateOut(() => {
      onSelect?.(hex);
      onClose?.();
    });
  }, [hex, animateOut, onSelect, onClose]);

  // A slider moved: the sliders own the colour, so the field follows them.
  const applyHsl = useCallback((patch) => {
    setHsl((prev) => {
      const next = { ...prev, ...patch };
      const nextHex = hslToHex(next);
      setHex(nextHex);
      setDraft(nextHex);
      return next;
    });
  }, []);

  // The field was typed in: only a complete colour moves the sliders.
  const handleDraft = useCallback((text) => {
    setDraft(text);
    const resolved = normalizeHex(text);
    if (resolved) {
      setHex(resolved);
      setHsl(hexToHsl(resolved));
    }
  }, []);

  const { panHandlers, noDragProps, sheetDragStyle } = useSheetDismiss(handleCancel, visible);

  const satStops = useMemo(
    () => [hslToHex({ ...hsl, s: 0 }), hslToHex({ ...hsl, s: 100 })],
    [hsl],
  );
  const lightStops = useMemo(
    () => ['#000000', hslToHex({ ...hsl, l: 50 }), '#FFFFFF'],
    [hsl],
  );
  // What the chosen colour will be asked to do — draw link text and small
  // labels on the page — is the thing it can fail at, so the sheet says so
  // rather than letting it be discovered later on a screen of unreadable links.
  const faint = legibilityNote(hex, theme.colors.background);
  const draftIsColour = !!normalizeHex(draft);

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={handleCancel} statusBarTranslucent>
      <View style={styles.root}>
        <Animated.View style={[styles.backdrop, { opacity: backdrop }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={handleCancel} />
        </Animated.View>

        <Animated.View
          {...panHandlers}
          style={[
            styles.sheet,
            // A true full-screen Modal presents above the navigator, so the
            // floating dock is not over this sheet: the inset is the home
            // indicator plus a breath, never the dock's height.
            { paddingBottom: panelBottomInset(insets.bottom, false) },
            { transform: [{ translateY: sheetY }, { translateY: lift }, ...sheetDragStyle.transform] },
          ]}
        >
          <View>
            <View style={styles.grabber} />
            <View style={styles.header}>
              <TouchableOpacity onPress={handleCancel} hitSlop={HIT} style={styles.headerSide}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <Text style={styles.title} numberOfLines={1}>Custom colour</Text>
              <View style={styles.headerSide} />
            </View>
          </View>

          {/* Preview + hex. The field is at the TOP of the sheet (§4) so the
              keyboard, when it comes, rises into the sliders rather than over
              the thing being typed into. */}
          <View style={styles.previewRow}>
            <View style={[styles.previewSwatch, { backgroundColor: hex }]}>
              <Icon name="check" size={22} color={inkOn(hex)} />
            </View>
            <View style={styles.hexWrap}>
              <Text style={styles.hexLabel}>Hex</Text>
              <AppTextInput
                value={draft}
                onChangeText={handleDraft}
                placeholder="#F97316"
                placeholderTextColor={theme.colors.textPlaceholder}
                autoCapitalize="characters"
                autoCorrect={false}
                spellCheck={false}
                maxLength={7}
                returnKeyType="done"
                accessibilityLabel="Highlight colour hex code"
                style={[styles.hexInput, !draftIsColour && styles.hexInputBad]}
              />
            </View>
          </View>

          {/* The sliders opt out of the card's pull-down: a drag that starts on
              a track belongs to the track, whichever way it wanders. */}
          <View {...noDragProps} style={styles.sliders}>
            <ColorSlider
              label="Hue"
              value={hsl.h}
              max={360}
              colors={HUE_STOPS}
              thumbColor={hslToHex({ h: hsl.h, s: 100, l: 50 })}
              onChange={(h) => applyHsl({ h })}
              theme={theme}
              styles={styles}
            />
            <ColorSlider
              label="Saturation"
              value={hsl.s}
              max={100}
              colors={satStops}
              thumbColor={hex}
              onChange={(s) => applyHsl({ s })}
              theme={theme}
              styles={styles}
            />
            <ColorSlider
              label="Lightness"
              value={hsl.l}
              max={100}
              colors={lightStops}
              thumbColor={hex}
              onChange={(l) => applyHsl({ l })}
              theme={theme}
              styles={styles}
            />
          </View>

          {faint ? (
            <View style={styles.noteRow}>
              <Icon name="alert-circle-outline" size={15} color={theme.colors.textTertiary} />
              <Text style={styles.noteText}>{faint}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            onPress={handleUse}
            accessibilityRole="button"
            accessibilityLabel="Use this colour as the highlight colour"
            style={styles.useBtn}
          >
            <Text style={styles.useText} numberOfLines={1}>Use this colour</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

const HIT = { top: 10, bottom: 10, left: 12, right: 12 };

const createStyles = (theme) =>
  StyleSheet.create({
    root: { flex: 1, justifyContent: 'flex-end' },
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
    sheet: {
      backgroundColor: theme.colors.surfaceElevated,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingTop: 10,
      paddingHorizontal: 18,
      ...depth(theme, 'overlay'),
    },
    grabber: {
      alignSelf: 'center',
      width: 38,
      height: 5,
      borderRadius: 3,
      backgroundColor: theme.colors.textMuted,
      marginBottom: 6,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 10,
    },
    headerSide: { minWidth: 64 },
    cancelText: { fontSize: 16, color: theme.colors.textSecondary, fontWeight: '500' },
    title: { fontSize: 17, fontWeight: '600', color: theme.colors.textPrimary, flexShrink: 1 },

    previewRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 4, marginBottom: 6 },
    previewSwatch: {
      width: 54,
      height: 54,
      borderRadius: 27,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.borderStrong,
    },
    hexWrap: { flex: 1, flexShrink: 1, minWidth: 0 },
    hexLabel: {
      fontSize: 10.5,
      fontWeight: '600',
      letterSpacing: 0.9,
      textTransform: 'uppercase',
      color: theme.colors.textTertiary,
      marginBottom: 4,
    },
    // A single-line field in a fixed row: no vertical padding of its own, and
    // Android's two centring instructions, or the value rides above the caret.
    hexInput: {
      height: 42,
      fontSize: 16,
      fontWeight: '600',
      letterSpacing: 1,
      paddingVertical: 0,
      paddingHorizontal: 12,
      includeFontPadding: false,
      textAlignVertical: 'center',
      color: theme.colors.inputText,
      backgroundColor: theme.colors.inputBackground,
      borderRadius: 21,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    hexInputBad: { borderColor: theme.colors.accentError },

    sliders: { marginTop: 8 },
    sliderBlock: { marginBottom: 6 },
    sliderHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    sliderLabel: {
      fontSize: 10.5,
      fontWeight: '600',
      letterSpacing: 0.9,
      textTransform: 'uppercase',
      color: theme.colors.textTertiary,
      flexShrink: 1,
    },
    sliderValue: {
      fontSize: 13,
      fontWeight: '700',
      color: theme.colors.textSecondary,
      fontVariant: ['tabular-nums'],
    },
    // The 44 pt grab area. The thumb overhangs the track either side, so the row
    // keeps half a thumb of side room and the knob still sits inside the sheet.
    sliderRow: {
      height: ROW_H,
      justifyContent: 'center',
      marginHorizontal: THUMB / 2,
    },
    track: {
      height: TRACK_H,
      borderRadius: TRACK_H / 2,
      overflow: 'hidden',
    },
    thumb: {
      position: 'absolute',
      top: (ROW_H - THUMB) / 2,
      width: THUMB,
      height: THUMB,
      borderRadius: THUMB / 2,
      borderWidth: 3,
      borderColor: '#FFFFFF',
      // The knob is white-rimmed, so on a light page it needs an edge of its own
      // or it disappears into the pale end of every track.
      shadowColor: '#0B1220',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.3,
      shadowRadius: 3,
      elevation: 3,
    },

    noteRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
    noteText: { flex: 1, flexShrink: 1, fontSize: 12, color: theme.colors.textTertiary },

    useBtn: {
      marginTop: 14,
      height: 48,
      borderRadius: 24,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.primary,
      ...depth(theme, 'control'),
    },
    useText: { fontSize: 16, fontWeight: '700', color: theme.colors.background, flexShrink: 1 },
  });
