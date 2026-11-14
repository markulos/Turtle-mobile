import React, { useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import DockGlow from './DockGlow';
import { SPOT_H, SPOT_W, dockLight } from './dockLight';
import {
  BAR_CONTENT_HEIGHT, PILL_RADIUS, PILL_SIZE, TAB_SLOT, UNDERLINE_H, UNDERLINE_W,
} from './tabBarLayout';
import { impactHaptic } from '../utils/haptics';

/**
 * DockLivePreview — the navbar as it will actually look, at its real size, at
 * the top of the navbar panel in Settings.
 *
 * The small tiles under it each answer ONE question ("this backdrop or that
 * one?"), so none of them shows the whole answer — and until now neither did
 * anything else on the page: the glow, the rim and the shade were only ever
 * visible on the real dock, at the far end of the screen from the control
 * being tapped. This is the sum of every setting in the panel, redrawn the
 * moment any of them changes, built from the same numbers the real dock uses
 * (tabBarLayout for the sizes, dockLight for the glow) rather than a sketch
 * of them.
 *
 * Tap a tab in it to move the guide there: a look has to be judged on more
 * than one icon. It moves in one step — this is a picture of the dock, not
 * the dock, and the travel is the real one's business.
 *
 * It does not frost what is behind it (no BlurView): there is nothing behind
 * it but the card.
 */
const TABS = [
  { key: 'tasks', label: 'Tasks', icon: 'checkbox-marked-circle-outline' },
  { key: 'notes', label: 'Notes', icon: 'note-text-outline' },
  { key: 'photos', label: 'Photos', icon: 'image-multiple-outline' },
  { key: 'profile', label: 'Profile', icon: 'account-circle-outline' },
];
const ICON_SIZE = 24;
// The line sits this far above the chip's bottom edge on the real dock.
const LINE_LIFT = 4;
const PAD_V = (BAR_CONTENT_HEIGHT - PILL_SIZE) / 2;

export default function DockLivePreview({
  skin, indicator, accent, ink, glow, glowColor, theme,
}) {
  const [active, setActive] = useState(1);
  const underline = indicator === 'underline';
  const light = dockLight({ glow, glowColor, accent });

  return (
    <View
      testID="dock-live"
      style={[styles.stage, { backgroundColor: theme.colors.surfaceElevated }]}
    >
      {/* A scrap of page for a translucent bar to be translucent against. */}
      <LinearGradient
        pointerEvents="none"
        colors={[theme.colors.background, theme.colors.surfaceElevated]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.capsule, { borderColor: skin.edge }]}>
        <LinearGradient
          pointerEvents="none"
          colors={skin.wash.colors}
          locations={skin.wash.locations}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        {skin.lip ? <View style={[styles.lip, { backgroundColor: skin.lip }]} /> : null}
        {TABS.map((tab, i) => {
          const on = i === active;
          return (
            <TouchableOpacity
              key={tab.key}
              testID={`dock-live-tab-${tab.key}`}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`Preview the guide on ${tab.label}${on ? ', showing now' : ''}`}
              activeOpacity={0.6}
              onPressIn={() => { if (!on) impactHaptic('light'); }}
              onPress={() => setActive(i)}
              style={styles.slot}
            >
              {on && !underline ? (
                <View
                  testID="dock-live-chip"
                  style={[styles.chip, { backgroundColor: light.chipFill }]}
                />
              ) : null}
              {on && underline && light.strength > 0 ? (
                <View pointerEvents="none" style={styles.spot}>
                  <DockGlow
                    id="dock-live-spot"
                    width={SPOT_W}
                    height={SPOT_H}
                    color={light.spotColor}
                    peak={light.spotPeak}
                    cy={1}
                    ry={1}
                  />
                </View>
              ) : null}
              {on && underline ? (
                <View testID="dock-live-line" style={[styles.line, { backgroundColor: accent }]} />
              ) : null}
              <Icon
                testID={on ? 'dock-live-active-icon' : undefined}
                name={tab.icon}
                size={ICON_SIZE}
                color={on ? ink : skin.inactiveTint}
              />
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    borderRadius: 14,
    borderCurve: 'continuous',
    overflow: 'hidden',
    alignItems: 'center',
    paddingVertical: 18,
  },
  capsule: {
    flexDirection: 'row',
    height: BAR_CONTENT_HEIGHT,
    borderRadius: BAR_CONTENT_HEIGHT / 2,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    paddingHorizontal: PAD_V,
  },
  lip: {
    position: 'absolute', left: 0, right: 0, bottom: 0, height: 1.5,
  },
  slot: {
    width: TAB_SLOT,
    height: BAR_CONTENT_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    position: 'absolute',
    top: PAD_V,
    left: (TAB_SLOT - PILL_SIZE) / 2,
    width: PILL_SIZE,
    height: PILL_SIZE,
    borderRadius: PILL_RADIUS,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  shade: { position: 'absolute', top: -1, left: -1 },
  line: {
    position: 'absolute',
    bottom: PAD_V + LINE_LIFT,
    left: (TAB_SLOT - UNDERLINE_W) / 2,
    width: UNDERLINE_W,
    height: UNDERLINE_H,
    borderRadius: UNDERLINE_H / 2,
  },
  spot: {
    position: 'absolute',
    bottom: PAD_V + LINE_LIFT + UNDERLINE_H,
    left: (TAB_SLOT - SPOT_W) / 2,
  },
});
