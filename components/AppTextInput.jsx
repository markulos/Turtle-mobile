/**
 * AppTextInput — a TextInput whose PLACEHOLDER is drawn by the app, not by iOS.
 *
 * ─── The bug it fixes, app-wide ─────────────────────────────────────────────
 *
 * `utils/fonts.js installGlobalFont()` makes Figtree the face of every Text and
 * TextInput by wrapping both components and adding a `fontFamily` to their
 * style. That reaches the input's OWN text. It does not reach the placeholder:
 * iOS builds that as its own attributed string, outside the style the wrapper
 * touched, so it renders in the SYSTEM face — wider, differently tracked, and
 * optically a size off. One field then shows two typefaces:
 * "S e a r c h  o r  a d d  a  t a s k …" over a page set in Figtree.
 *
 * There is no `placeholderStyle` prop in React Native, so the only fix is to
 * stop using the native placeholder and draw our own: a real <Text>, in the
 * app's pipeline, laid over the empty field and invisible to touch. The vault's
 * board search found this first; this is that trick made canonical so every
 * composer and form gets it without rediscovering it.
 *
 * ─── Why it is a drop-in ────────────────────────────────────────────────────
 *
 * Same API as TextInput — keep `placeholder` and `placeholderTextColor` exactly
 * as they were and change the tag. The component splits the style itself: the
 * LAYOUT half (flex, size, margins, position) goes to a wrapper so the field
 * occupies precisely the box it occupied before, and the TEXT half stays on the
 * input AND is mirrored onto the placeholder, so the two are the same words in
 * the same place at the same size — one of them just isn't editable.
 *
 * Vertical placement comes from an absolutely-filled box with `justifyContent`,
 * not from a `lineHeight` matched to the field's height: nothing has to know
 * how tall the field is, which is what makes this safe to apply to a hundred
 * fields at once. Single line centres; `multiline` sits at the top, where the
 * caret starts.
 */
import React, { forwardRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

/**
 * Sizing the wrapper SHARES with the input. Both boxes carry these, so each
 * percentage resolves one level up and the two end up identical: the wrapper
 * takes the slot the input used to have in the real parent, and the input
 * fills the wrapper. Putting them only on the wrapper collapses a
 * `width: '100%'` field (a percentage against an auto-width parent is auto);
 * putting them only on the input collapses the wrapper the same way.
 */
const SHARED_KEYS = [
  'flex', 'flexGrow', 'flexShrink', 'flexBasis',
  'width', 'minWidth', 'maxWidth', 'height', 'minHeight', 'maxHeight',
];

/**
 * Offsets that MOVE to the wrapper and are stripped from the input. Applied to
 * both they would count twice — doubled margins, an absolute field offset from
 * an already-offset box.
 */
const MOVED_KEYS = [
  'alignSelf',
  'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight',
  'marginHorizontal', 'marginVertical', 'marginStart', 'marginEnd',
  'position', 'top', 'bottom', 'left', 'right', 'zIndex',
];

/**
 * Type properties the placeholder must share with the field, or it lands on a
 * different baseline in a different size the moment either changes.
 */
const TEXT_KEYS = [
  'fontSize', 'fontWeight', 'fontStyle', 'fontFamily', 'letterSpacing',
  'lineHeight', 'textAlign', 'textTransform', 'writingDirection',
];

const pick = (flat, keys) => {
  const out = {};
  for (const k of keys) if (flat[k] !== undefined) out[k] = flat[k];
  return out;
};

/**
 * The field's CONTENT BOX — inside its border and its padding, which is where
 * the field's own text lives and so where the placeholder has to live.
 *
 * A single line is centred in that box (what RN does with one line of text), a
 * multiline field starts at its top. Taking BOTH vertical paddings matters:
 * the chat composer pads 12 above and 4 below, so centring on the whole box
 * instead of the content box would sit the placeholder 4 pt off its own text.
 */
function contentBox(flat, multiline) {
  const padH = flat.paddingHorizontal;
  const padV = flat.paddingVertical;
  const all = flat.padding;
  const border = flat.borderWidth ?? 0;
  return {
    paddingLeft: flat.paddingLeft ?? flat.paddingStart ?? padH ?? all ?? 0,
    paddingRight: flat.paddingRight ?? flat.paddingEnd ?? padH ?? all ?? 0,
    paddingTop: flat.paddingTop ?? padV ?? all ?? 0,
    // A multiline field is measured from its top, so its bottom padding plays
    // no part in where the first line sits.
    paddingBottom: multiline ? 0 : (flat.paddingBottom ?? padV ?? all ?? 0),
    borderLeftWidth: flat.borderLeftWidth ?? border,
    borderRightWidth: flat.borderRightWidth ?? border,
    borderTopWidth: flat.borderTopWidth ?? border,
    borderBottomWidth: multiline ? 0 : (flat.borderBottomWidth ?? border),
  };
}

const AppTextInput = forwardRef(function AppTextInput({
  style,
  placeholder,
  placeholderTextColor,
  /** Lets a test reach the drawn placeholder; it is not an a11y target. */
  placeholderTestID,
  /** Extra style for the drawn placeholder, when one field wants it different. */
  placeholderStyle,
  /** Style for the wrapper, if a caller needs to reach it. */
  wrapStyle,
  value,
  defaultValue,
  onChangeText,
  multiline,
  ...rest
}, ref) {
  // An UNCONTROLLED field (defaultValue, or nothing) still has to know whether
  // it is empty — otherwise the placeholder would sit over the user's typing
  // forever. Mirrored locally; the input remains the source of truth.
  const [typed, setTyped] = useState(defaultValue == null ? '' : String(defaultValue));
  const controlled = value !== undefined;
  const text = controlled ? value : typed;
  const empty = text == null || String(text).length === 0;

  const handleChangeText = (next) => {
    if (!controlled) setTyped(next);
    onChangeText?.(next);
  };

  const flat = StyleSheet.flatten(style) || {};
  const box = { ...pick(flat, SHARED_KEYS), ...pick(flat, MOVED_KEYS) };
  const type = pick(flat, TEXT_KEYS);
  // The input keeps everything except the offsets the wrapper now applies.
  const inputStyle = { ...flat };
  for (const k of MOVED_KEYS) if (inputStyle[k] !== undefined) delete inputStyle[k];

  return (
    <View style={[styles.wrap, box, wrapStyle]}>
      {/* The native placeholder STAYS — and is invisible. Transparent, it
          costs nothing on screen, while keeping the two things that hang off
          the real prop: VoiceOver still announces the field's hint, and
          `getByPlaceholderText` still finds it in tests. Only the drawing is
          ours. */}
      <TextInput
        ref={ref}
        style={inputStyle}
        value={value}
        defaultValue={defaultValue}
        onChangeText={handleChangeText}
        multiline={multiline}
        placeholder={placeholder}
        placeholderTextColor="transparent"
        {...rest}
      />
      {empty && placeholder ? (
        <View
          style={[
            StyleSheet.absoluteFill,
            contentBox(flat, multiline),
            { justifyContent: multiline ? 'flex-start' : 'center' },
          ]}
          pointerEvents="none"
          accessible={false}
          importantForAccessibility="no"
        >
          <Text
            testID={placeholderTestID}
            numberOfLines={1}
            pointerEvents="none"
            accessible={false}
            importantForAccessibility="no"
            style={[type, { color: placeholderTextColor }, placeholderStyle]}
          >
            {placeholder}
          </Text>
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  // The box the input used to occupy. `position: relative` is the default, and
  // it is what the absolutely-filled placeholder is measured against.
  wrap: { position: 'relative' },
});

export default AppTextInput;
