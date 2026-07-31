import React from 'react';
import { StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useTheme } from '../context/ThemeContext';

/**
 * FrostedHeader — the top-of-page twin of the floating tab bar.
 *
 * Same treatment, mirrored: an absolutely-positioned bar with NO opaque fill,
 * a blur as its surface so the page reads through it as content scrolls up
 * underneath, and a hairline along the edge where it ends — white here, so the
 * boundary reads as a lit edge on both themes rather than a grey rule.
 *
 * Usage (the layout contract matters — this is why it's a primitive):
 *   1. Render it as the LAST child of the screen so it paints above content.
 *   2. Wrap the header's own controls in `children`; they sit inside the safe
 *      area automatically (paddingTop = insets.top unless `topPad` overrides).
 *   3. Give the scrollable content a top padding of this bar's height, so the
 *      first item can be scrolled clear of it. Measure with onLayout and feed
 *      the height back, exactly as the vault does with `vaultHeaderH`.
 *
 * Non-scrollable controls must NOT be placed under it — same rule as the tab
 * bar: content you can scroll may pass beneath the frost, but a pinned touch
 * target covered by it is simply unreachable.
 */
export default function FrostedHeader({
  children,
  topPad,          // override the safe-area top padding
  onLayout,        // measure the bar so content can reserve its height
  intensity,       // blur strength; defaults to the tab bar's per-theme values
  style,
}) {
  const { theme, isDark } = useTheme();

  return (
    <View style={[styles.bar, style]} onLayout={onLayout}>
      {/* The frost itself. Matches the tab bar's per-theme intensities so the
          top and bottom chrome read as the same material. */}
      <BlurView
        pointerEvents="none"
        intensity={intensity ?? (isDark ? 42 : 60)}
        tint={isDark ? 'dark' : 'light'}
        style={StyleSheet.absoluteFill}
      />
      <View style={topPad != null ? { paddingTop: topPad } : null}>
        {children}
      </View>
      {/* The edge that ends the header — white, hairline-thin. Drawn as its own
          view rather than a borderBottom so it stays crisp above the blur. */}
      <View pointerEvents="none" style={styles.edge} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    backgroundColor: 'transparent',
    overflow: 'hidden',
  },
  edge: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#FFFFFF',
  },
});
