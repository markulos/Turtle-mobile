/**
 * PeoplePopover — the list behind a task card's avatar stack.
 *
 * The stack says HOW MANY and roughly who; this says who, plainly, with the
 * basic facts about each of them and a way into their full profile. Tapping
 * one disc in a stack is not a realistic target once they overlap, so the
 * stack is one button and this is what it opens.
 *
 * ─── Why a Modal and not an in-tree overlay ─────────────────────────────────
 *
 * A card lives inside the day pane, which is one page of a horizontal pager
 * inside a vertical ScrollView inside a sheet. An in-tree popover would be
 * clipped by the first of those with `overflow: hidden` and outranked by the
 * next one with a zIndex (docs/STYLE-RULES.md §4). A TRANSPARENT Modal escapes
 * all of it and covers the floating tab bar too.
 *
 * ─── Why it DROPS from the stack ────────────────────────────────────────────
 *
 * The caller measures the stack in window coordinates and hands the rect over,
 * so the list appears attached to the thing that was tapped rather than
 * arriving from the bottom of the screen with no connection to it. It flips
 * ABOVE the anchor when there is no room below, and is clamped to the screen
 * either way — a popover half off the edge is worse than one on the wrong side.
 */
import React, { useMemo } from 'react';
import {
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { depth } from '../../../utils/surfaceDepth';
import { tapHaptic } from '../../../utils/haptics';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const CARD_W = 268;
const EDGE = 12;
/** Air between the stack and the card that drops from it. */
const ANCHOR_GAP = 8;
const AVATAR = 36;
const ROW_H = 56;
/** Show this many rows before the list starts scrolling inside the card. */
const MAX_ROWS = 6;

/**
 * Where the card sits, given the anchor's rect. Pure, so the flip-and-clamp
 * arithmetic is tested rather than eyeballed on one screen size.
 */
export function popoverPosition(anchor, {
  screenW = SCREEN_W, screenH = SCREEN_H, cardW = CARD_W, cardH = 200, edge = EDGE, gap = ANCHOR_GAP,
} = {}) {
  // No anchor (the measure failed): centre it, which is always on screen.
  if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) {
    return { left: Math.max(edge, Math.round((screenW - cardW) / 2)), top: Math.max(edge, Math.round((screenH - cardH) / 2)) };
  }
  const below = anchor.y + (anchor.height || 0) + gap;
  const above = anchor.y - gap - cardH;
  // Below by default; above only when below would run off the bottom AND
  // above actually fits. Otherwise stay below and let it clamp — a card
  // pinned to the bottom edge still reads as belonging to the anchor.
  const top = (below + cardH > screenH - edge && above >= edge) ? above : Math.min(below, screenH - edge - cardH);
  // Centre on the anchor horizontally, then clamp inside the screen.
  const wanted = anchor.x + (anchor.width || 0) / 2 - cardW / 2;
  const left = Math.max(edge, Math.min(wanted, screenW - edge - cardW));
  return { left: Math.round(left), top: Math.round(Math.max(edge, top)) };
}

/** The quiet second line: what is actually known about this person. */
export function personDetail(person) {
  if (!person) return '';
  const bits = [];
  if (person.role) bits.push(String(person.role).replace(/^\w/, (ch) => ch.toUpperCase()));
  if (person.phone) bits.push(person.phone);
  // `joined` is false for someone invited who has never signed in — worth
  // saying, because it explains an empty-looking profile behind this row.
  if (person.joined === false) bits.push('Hasn’t signed in yet');
  return bits.join(' · ');
}

export default function PeoplePopover({ visible, people = [], anchor, theme, onPick, onClose }) {
  const c = theme?.colors || {};
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const roster = Array.isArray(people) ? people.filter(Boolean) : [];
  const rows = Math.min(roster.length, MAX_ROWS);
  const cardH = rows * ROW_H + 44; // rows + the header
  const { left, top } = popoverPosition(anchor, { cardH });

  if (!visible || roster.length === 0) return null;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      {/* The scrim is the dismiss. A popover closes by tapping away from it —
          there is no Done key on something this small. */}
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" testID="people-popover-scrim" />
      <View style={[styles.card, { left, top }]} testID="people-popover">
        <Text style={styles.heading}>
          {roster.length === 1 ? 'ON THIS TASK' : `ON THIS TASK · ${roster.length}`}
        </Text>
        <ScrollView
          style={{ maxHeight: MAX_ROWS * ROW_H }}
          scrollIndicatorInsets={{ right: 1 }}
          indicatorStyle={theme?.mode === 'dark' ? 'white' : 'default'}
          showsVerticalScrollIndicator
        >
          {roster.map((p, i) => (
            <Pressable
              key={p.id}
              onPressIn={() => tapHaptic()}
              onPress={() => onPick?.(p)}
              accessibilityRole="button"
              accessibilityLabel={`${p.name}. Open profile`}
              testID={`people-popover-${p.id}`}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <View style={[styles.avatar, { backgroundColor: p.color }]}>
                {/* The initial stays under the photo, so a picture that is
                    still loading (or fails) shows the disc, not a hole. */}
                <Text style={styles.avatarText}>{(p.name || '?').trim().charAt(0).toUpperCase()}</Text>
                {!!p.avatarUrl && (
                  <Image
                    source={{ uri: p.avatarUrl }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    transition={120}
                    cachePolicy="memory-disk"
                    accessible={false}
                    testID={`people-popover-${p.id}-photo`}
                  />
                )}
              </View>
              <View style={styles.rowText}>
                <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
                {/* Only when there is something to say — an empty line under
                    every name would be a row of blank space. */}
                {!!personDetail(p) && (
                  <Text style={styles.detail} numberOfLines={1}>{personDetail(p)}</Text>
                )}
              </View>
              {/* The first is the task's owner; the rest are involved. */}
              {i === 0 && <Text style={styles.tag}>OWNER</Text>}
              <Icon name="chevron-right" size={18} color={c.textMuted} />
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const makeStyles = (theme) => {
  const c = theme?.colors || {};
  return StyleSheet.create({
    scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.25)' },
    card: {
      position: 'absolute',
      width: CARD_W,
      backgroundColor: c.surfaceElevated || c.surface || '#fff',
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      paddingVertical: 6,
      overflow: 'hidden',
      ...depth(theme, 'raised'),
    },
    heading: {
      fontSize: 10.5,
      fontWeight: '700',
      letterSpacing: 0.9,
      color: c.textTertiary,
      paddingHorizontal: 14,
      paddingTop: 8,
      paddingBottom: 6,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      height: ROW_H,
      paddingHorizontal: 14,
    },
    pressed: { opacity: 0.6 },
    avatar: {
      width: AVATAR,
      height: AVATAR,
      borderRadius: AVATAR / 2,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    avatarText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
    rowText: { flex: 1, minWidth: 0 },
    name: { fontSize: 15, fontWeight: '600', color: c.textPrimary },
    detail: { fontSize: 12, color: c.textSecondary, marginTop: 1 },
    tag: {
      fontSize: 9,
      fontWeight: '800',
      letterSpacing: 0.6,
      color: c.textTertiary,
    },
  });
};
