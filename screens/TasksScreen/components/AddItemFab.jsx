import React, { useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  StyleSheet,
  Animated,
  Easing,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../context/ThemeContext';
import { ITEM_TYPES } from '../utils/constants';
import { tapHaptic } from '../../../utils/haptics';

// ── Google-Calendar-style "+" create button ──────────────────────────────
// A floating action button pinned bottom-right of the calendar. Tapping it
// expands a small speed-dial of the three item kinds (Birthday / Task / Event,
// stacked nearest-to-the-thumb first). Picking one calls onSelect(type), which
// opens the unified create form pre-set to that type — where the type can still
// be switched. Re-tapping the "+" (now an ×) or tapping the scrim collapses it.
export const AddItemFab = ({ onSelect, bottomInset = 0 }) => {
  const { theme } = useTheme();
  const styles = createStyles(theme, bottomInset);
  const [open, setOpen] = useState(false);
  const anim = useRef(new Animated.Value(0)).current;

  const animateTo = useCallback((to) => {
    Animated.timing(anim, {
      toValue: to,
      duration: to ? 200 : 160,
      easing: to ? Easing.out(Easing.back(1.4)) : Easing.in(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [anim]);

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      animateTo(next ? 1 : 0);
      return next;
    });
  }, [animateTo]);

  const close = useCallback(() => {
    setOpen(false);
    animateTo(0);
  }, [animateTo]);

  const pick = useCallback((type) => {
    close();
    onSelect?.(type);
  }, [close, onSelect]);

  // Order the speed-dial so the first chip sits just above the FAB and the
  // rest stack upward. Birthday on top, then Task, then Event nearest the
  // thumb — but show them in the natural Birthday/Task/Event reading order.
  const options = ITEM_TYPES;

  const rotate = anim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '135deg'] });
  const scrimOpacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

  return (
    <>
      {/* Tap-away scrim — only interactive while open so the calendar stays
          usable when the dial is closed. */}
      {open && (
        <TouchableWithoutFeedback onPress={close}>
          <Animated.View style={[styles.scrim, { opacity: scrimOpacity }]} />
        </TouchableWithoutFeedback>
      )}

      <View style={styles.host} pointerEvents="box-none">
        {/* Speed-dial options (rendered above the FAB, bottom-up). */}
        {options.map((opt, i) => {
          // Each chip slides up + fades in; the nearest one moves least.
          const offset = (options.length - i) * 58 + 8;
          const translateY = anim.interpolate({
            inputRange: [0, 1],
            outputRange: [12, -offset],
          });
          return (
            <Animated.View
              key={opt.value}
              pointerEvents={open ? 'auto' : 'none'}
              style={[
                styles.optionRow,
                { opacity: anim, transform: [{ translateY }, { scale: anim }] },
              ]}
            >
              <View style={styles.optionLabelChip}>
                <Text style={styles.optionLabelText}>{opt.label}</Text>
              </View>
              <TouchableOpacity
                style={[styles.optionBtn, { backgroundColor: opt.accent }]}
                activeOpacity={0.85}
                onPressIn={() => tapHaptic()}
                onPress={() => pick(opt.value)}
                accessibilityRole="button"
                accessibilityLabel={`New ${opt.label.toLowerCase()}`}
              >
                <Icon name={opt.icon} size={22} color="#FFFFFF" />
              </TouchableOpacity>
            </Animated.View>
          );
        })}

        {/* The main + button. */}
        <TouchableOpacity
          style={styles.fab}
          activeOpacity={0.85}
          onPressIn={() => tapHaptic()}
          onPress={toggle}
          accessibilityRole="button"
          accessibilityLabel={open ? 'Close create menu' : 'Create birthday, task, or event'}
        >
          <Animated.View style={{ transform: [{ rotate }] }}>
            <Icon name="plus" size={28} color={theme.colors.background} />
          </Animated.View>
        </TouchableOpacity>
      </View>
    </>
  );
};

const createStyles = (theme, bottomInset) => StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    zIndex: 40,
  },
  host: {
    position: 'absolute',
    right: 20,
    bottom: bottomInset + 24,
    alignItems: 'flex-end',
    zIndex: 50,
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    // Solid light "thumb" matching the app's segmented-control pill treatment;
    // the + glyph is the theme background so it reads as a cut-out on any theme.
    backgroundColor: theme.colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 6,
  },
  optionRow: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
  optionLabelChip: {
    backgroundColor: theme.colors.surfaceElevated,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    marginRight: 12,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 3,
    elevation: 3,
  },
  optionLabelText: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  optionBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
});
