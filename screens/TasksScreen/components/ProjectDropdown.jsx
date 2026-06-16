import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Keyboard,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../context/ThemeContext';

/**
 * ProjectDropdown — inline accordion-style picker.
 *
 * Matches the web app's project-search reveal exactly:
 *
 *   • `max-height: 0 → 320px` with a 280ms Material-standard ease
 *     `cubic-bezier(0.4, 0, 0.2, 1)`.
 *   • `opacity: 0 → 1` over 200ms with ease-out — completing *before*
 *     the height does, which is what makes the open feel light and
 *     present rather than mechanical: by the time the slide settles,
 *     content has already faded fully in.
 *   • Always-mounted; just toggles between the two states.
 *
 * RN-specific architecture (so the JS-thread cost stays minimal):
 *
 *   • Reanimated shared values drive BOTH height and opacity on the UI
 *     thread (worklets), so the open/close holds 60fps even when the JS
 *     thread is busy — e.g. the calendar/task list re-rendering behind
 *     the picker. The earlier version animated `height` with an RN
 *     Animated.Value on the JS driver (useNativeDriver:false — the only
 *     option for layout props); every frame hopped the JS bridge, so any
 *     JS-thread contention surfaced as the open/close stutter. The exact
 *     durations + easing below are unchanged, so the look is identical.
 *
 *   • Container has `overflow: hidden` so the ScrollView inside
 *     (pinned to its natural full size) reveals progressively as
 *     the container's height interpolates. This is what produces
 *     the "opens from the middle of the page" visual instead of a
 *     pop-in.
 *
 *   • Children stay mounted permanently. Project rows + icons + count
 *     chips render ONCE on first mount and are reused for every
 *     subsequent open. The previous mount-on-open / unmount-on-close
 *     lifecycle was paying the full render cost of N rows in the
 *     same frame the animation was trying to play — exactly why it
 *     stuttered.
 */

const MAX_HEIGHT = 360;
const OPEN_DURATION_MS  = 280;  // height — matches web's 280ms
const CLOSE_DURATION_MS = 240;
// Material Design standard "ease" — the same `cubic-bezier(0.4, 0, 0.2, 1)`
// the web app's CSS transition uses. Slightly gentler than iOS's
// 0.32/0.72/0/1; the user specifically wants the web feel here.
const WEB_EASE = Easing.bezier(0.4, 0, 0.2, 1);
// Opacity finishes before the slide does — content reads fully
// visible by the time the height settles into place.
const OPACITY_OPEN_MS  = 200;
const OPACITY_CLOSE_MS = 160;
const OPACITY_EASE = Easing.out(Easing.cubic);

/**
 * Kept exported as a no-op so the parent's existing call sites
 * (TasksScreen → onPress / onSelect / onClose) don't need to change
 * back. The previous LayoutAnimation approach required the parent to
 * call `configureNext` before each setState; with the Animated.Value
 * approach this hook isn't needed (the picker's own useEffect
 * triggers the animation off the `visible` prop). Keeping the export
 * means zero parent-side churn.
 */
export const configureProjectDropdownAnimation = () => {};

export const ProjectDropdown = ({
  visible,
  onClose,
  projects,
  tasks,
  selected,
  onSelect,
  onManage,
  onAddProject,
  // Board name → display name of whoever shared it WITH me. Such rows get a
  // "shared in" people glyph + a folder-account icon so they read as not-mine.
  incomingShareLabels = {},
}) => {
  const { theme } = useTheme();
  const [newProjectName, setNewProjectName] = useState('');
  const [showAddInput, setShowAddInput] = useState(false);

  // UI-thread shared values for height + opacity (see file header).
  // Initialised to match the current `visible` so the picker doesn't
  // flash-animate on first mount if it happens to start open.
  const height = useSharedValue(visible ? MAX_HEIGHT : 0);
  const opacity = useSharedValue(visible ? 1 : 0);

  useEffect(() => {
    // The opacity duration is shorter than the height duration so opacity
    // always settles first, matching the web's `200ms ease-out` opacity
    // vs `280ms cubic-bezier` height. Both run as worklets on the UI
    // thread, so JS-thread work can't stall them mid-animation.
    height.value = withTiming(visible ? MAX_HEIGHT : 0, {
      duration: visible ? OPEN_DURATION_MS : CLOSE_DURATION_MS,
      easing: WEB_EASE,
    });
    opacity.value = withTiming(visible ? 1 : 0, {
      duration: visible ? OPACITY_OPEN_MS : OPACITY_CLOSE_MS,
      easing: OPACITY_EASE,
    });
  }, [visible, height, opacity]);

  const containerAnimStyle = useAnimatedStyle(() => ({ height: height.value }));
  const innerAnimStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  // Reset the add-input row when the picker closes so reopening
  // starts clean.
  useEffect(() => {
    if (!visible) {
      setShowAddInput(false);
      setNewProjectName('');
      Keyboard.dismiss();
    }
  }, [visible]);

  const getCount = (project) => {
    if (project === 'All') return tasks.length;
    if (project === 'No Project') return tasks.filter(t => !t.project).length;
    return tasks.filter(t => t.project === project).length;
  };

  const handleAddProject = () => {
    if (!newProjectName.trim()) return;
    onAddProject(newProjectName.trim());
    setNewProjectName('');
    setShowAddInput(false);
  };

  const handleSelect = (key) => {
    onSelect(key);
    onClose();
  };

  const items = [
    { key: 'All', icon: 'folder-open', label: 'All' },
    { key: 'No Project', icon: 'folder-off', label: 'No Project' },
    ...projects.map(p => ({ key: p, icon: 'folder', label: p })),
  ];

  const styles = createStyles(theme);

  return (
    <Animated.View
      // Height animates on the UI thread (Reanimated); the outer wrapper
      // is the layout-clipping element.
      style={[styles.container, containerAnimStyle]}
      // overflow:hidden clips the content visually, but RN may still
      // forward touches to clipped children — gate that explicitly so
      // a fully-collapsed picker doesn't intercept taps on the
      // content beneath it (calendar / task list).
      pointerEvents={visible ? 'auto' : 'none'}
    >
      {/* Inner wrapper carries the opacity animation. Kept on its own
          view so the height-animated wrapper and the opacity-animated
          wrapper stay independent. */}
      <Animated.View style={[{ flex: 1 }, innerAnimStyle]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {items.map(({ key, icon, label }) => {
          const isActive = selected === key;
          const sharedBy = incomingShareLabels[key];
          return (
            <TouchableOpacity
              key={key}
              style={[styles.item, isActive && styles.itemActive]}
              onPress={() => handleSelect(key)}
              activeOpacity={0.6}
            >
              <Icon
                name={sharedBy ? 'folder-account' : icon}
                size={20}
                color={isActive ? theme.colors.textPrimary : theme.colors.textSecondary}
              />
              <Text
                style={[styles.text, isActive && styles.textActive]}
                numberOfLines={1}
              >
                {label}
              </Text>
              {sharedBy ? (
                <Icon
                  name="account-multiple"
                  size={14}
                  color={theme.colors.accentInfo}
                  style={{ marginRight: 6 }}
                  accessibilityLabel={`Shared by ${sharedBy}`}
                />
              ) : null}
              <Text style={styles.count}>{getCount(key)}</Text>
            </TouchableOpacity>
          );
        })}

        {/* Add-project row — inline TextInput when expanded, a plain
            "+ Add" row otherwise. */}
        {showAddInput ? (
          <View style={styles.addInputRow}>
            <TextInput
              style={styles.addInput}
              placeholder="New project name…"
              placeholderTextColor={theme.colors.textPlaceholder}
              value={newProjectName}
              onChangeText={setNewProjectName}
              onSubmitEditing={handleAddProject}
              returnKeyType="done"
              autoFocus
            />
            <TouchableOpacity style={styles.addBtn} onPress={handleAddProject}>
              <Icon name="check" size={18} color={theme.colors.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.cancelAddBtn}
              onPress={() => {
                setShowAddInput(false);
                setNewProjectName('');
              }}
            >
              <Icon name="close" size={18} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.item, styles.metaItem]}
            onPress={() => setShowAddInput(true)}
            activeOpacity={0.6}
          >
            <Icon name="plus-circle" size={20} color={theme.colors.textPrimary} />
            <Text style={[styles.text, styles.metaText]}>Add New Project</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.item, styles.metaItem]}
          onPress={() => {
            onClose();
            onManage();
          }}
          activeOpacity={0.6}
        >
          <Icon name="playlist-edit" size={20} color={theme.colors.textSecondary} />
          <Text style={[styles.text, styles.metaSecondary]}>Edit Projects</Text>
        </TouchableOpacity>
      </ScrollView>
      </Animated.View>
    </Animated.View>
  );
};

const createStyles = (theme) => StyleSheet.create({
  container: {
    // Absolute OVERLAY anchored to the top of its host (just under the
    // header). It used to sit in normal flow, where animating its height
    // resized the flex:1 task list / calendar below it every frame — a
    // layout pass per frame = the open/close stutter. As an overlay it no
    // longer pushes or resizes anything; the parent instead translates the
    // page content down by the same animated amount (a compositor-only
    // transform), so the "push the page down" look is identical but nothing
    // relayouts. See TasksScreen's dropdownProgress / contentShiftStyle.
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    backgroundColor: theme.colors.surface,
    // overflow:hidden is THE mechanism that produces the accordion
    // visual. The ScrollView inside is full-height (MAX_HEIGHT); as
    // the outer container's height animates 0 → MAX_HEIGHT, the
    // container reveals the ScrollView progressively. Without this,
    // the ScrollView would render at full size from frame 1 and
    // overflow the collapsed container, defeating the reveal.
    overflow: 'hidden',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  scrollView: {
    // Fixed height so the ScrollView is always rendered at its full
    // size — the parent container's animated height does all the
    // visual clipping. If we used flex:1 here, the ScrollView would
    // shrink in lockstep with the container instead of staying at
    // full size beneath it, and we'd lose the "reveals top-down"
    // effect.
    height: MAX_HEIGHT,
  },
  scrollContent: {
    paddingVertical: 4,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: theme.colors.surface,
  },
  itemActive: {
    backgroundColor: theme.colors.surfaceElevated,
  },
  text: {
    flex: 1,
    fontSize: theme.typography.body,
    marginLeft: 12,
    color: theme.colors.textPrimary,
  },
  textActive: {
    color: theme.colors.textPrimary,
    fontWeight: '600',
  },
  count: {
    fontSize: 12,
    color: theme.colors.textMuted,
    backgroundColor: theme.colors.surfaceElevated,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    minWidth: 28,
    textAlign: 'center',
    overflow: 'hidden',
  },
  metaItem: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
  },
  metaText: {
    color: theme.colors.textPrimary,
    fontWeight: '500',
  },
  metaSecondary: {
    color: theme.colors.textSecondary,
  },
  addInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
  },
  addInput: {
    flex: 1,
    backgroundColor: theme.colors.inputBackground,
    color: theme.colors.inputText,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: theme.typography.body,
    marginRight: 8,
  },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.surfaceElevated,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    marginRight: 4,
  },
  cancelAddBtn: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
