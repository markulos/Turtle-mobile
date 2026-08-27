import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, ActivityIndicator, ScrollView, StyleSheet,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDecay,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../../../context/ThemeContext';
import { useBoardLink } from '../../../context/BoardLinkContext';
import { impactHaptic, tapHaptic } from '../../../utils/haptics';
import { TAP_ONLY } from '../../../utils/pressBehavior';
import {
  absorbTouchJump, clamp, clampScale, focalTranslate, panBaseline,
  panBound, rubberClamp, rubberScale,
} from '../../../utils/zoomMath';
import { canvasFitScale, boardWeight } from '../../../utils/boardCanvasLayout';
import {
  boardFrameLayout, toggleExpanded, toggleGroup,
  ITEM_LABEL_BAND, FRAME_HEADER, FRAME_PAD,
  GROUP_HEADER, GROUP_PAD, GROUP_FOOTER, CHIP_HEIGHT,
} from '../../../utils/boardFrames';
import { boardTree, pruneTrail, moveTargets } from '../../../utils/boardTree';
import { R_TIMING } from '../../../utils/motionReanimated';
import EdgeSwipePage from './EdgeSwipePage';
import BoardAvatar, { boardColor, boardTint } from './BoardAvatar';
import BoardTimeline from './BoardTimeline';
import BoardCreateSheet from './BoardCreateSheet';
import BoardActionsSheet from './BoardActionsSheet';
import useBoardsOverview from '../hooks/useBoardsOverview';
import useBoardContents from '../hooks/useBoardContents';

/**
 * BoardsCanvas — every board in the app, as a map of frames you open in place.
 *
 * The conversations inbox already answers "what happened last?" — it is a list,
 * newest first, and it is the right shape for that question. This page answers
 * a different one: "what IS there?". A list can't show that, because a list has
 * no room for relative size, no place to stand back from, and nowhere to put
 * the fact that one board lives inside another.
 *
 * So the same boards are drawn as a field of discs — bigger where more lives on
 * the board — on a surface you drag and pinch. TAPPING one OPENS IT WHERE IT
 * SITS: the disc grows into a bordered FRAME in the board's own colour, and
 * everything the board holds is laid out INSIDE that border — its sub-boards,
 * then its newest items. Open a sub-board and its frame grows inside its
 * parent's, which grows to hold it.
 *
 * Containment drawn as containment is the whole idea. Nothing to trace with
 * your eye, nothing to hold in your head: what is inside a board is literally
 * inside it, and two boards can be open at once, side by side, which is the
 * comparison a list can never show you.
 *
 * It is deliberately the SAME boards, discs and data as the inbox (shared via
 * useBoardsOverview and BoardAvatar), and opening a board's conversation opens
 * the SAME BoardTimeline. This is a second view of one thing, not a second
 * thing.
 *
 * ── What is inside a frame ───────────────────────────────────────────────────
 *
 * Sub-boards, then the board's own contents grouped by kind — Tasks, Notes,
 * Photos, Chat — one chip each, carrying its count. Tapping a chip opens a
 * smaller frame inside the board's, holding those items.
 *
 * Grouping is what makes a real board legible. Ungrouped, a board's newest
 * handful is whatever it happens to have most of, and the four tasks that
 * actually needed doing are buried under forty photos. Grouped, every kind is
 * visible as a count whether or not it is open — and those counts come from the
 * overview the map already loaded, so opening a board costs no fetch at all.
 * Only opening a group asks the server for anything.
 *
 * ── The gestures, one meaning each ───────────────────────────────────────────
 *
 *   • TAP a board → open it into its frame, or close the frame back to a disc.
 *     A board with nothing in it at all has nothing to open, so a tap goes
 *     straight to its conversation.
 *   • TAP a group chip → open that kind inside the frame, or close it again.
 *   • TAP an item (or the "More" disc that closes a full group) → that board's
 *     conversation, which is where the item actually lives.
 *   • HOLD a board → the actions card: open its conversation, make a board
 *     inside it, focus the map on it, move it, delete it.
 *
 * A board that can be opened is marked BEFORE you tap it — a dashed halo, and a
 * badge carrying how many boards are nested inside. "Tap does something
 * different here" has to be visible in advance, not discovered by trying.
 *
 * Inside a frame, only the HEADER takes touches. The body is inert on purpose:
 * a frame is mostly empty space, that space is the drag surface, and a map you
 * cannot drag by its middle is a map you cannot move.
 *
 * ── Focus, for when the map gets deep ────────────────────────────────────────
 *
 * Opening is not navigation: frames nest, the map keeps growing, and the board
 * you care about ends up a long drag from the rest. "Focus the map here"
 * re-roots the whole canvas on one board, with a breadcrumb trail back out.
 * Opening looks inside without leaving; focusing makes a board the whole map.
 *
 * The transform runs entirely on the UI thread — Reanimated shared values
 * driven by Gesture Handler, with the pan/zoom arithmetic borrowed wholesale
 * from the photo viewer's `zoomMath` (translations measured from the viewport's
 * CENTRE, so "no offset" is literally the origin and a zoom-out always settles
 * centred rather than parked wherever the pinch happened to end).
 */

// Zoom range. The floor is resolved per-canvas — you can always pull back far
// enough to see every board at once, however many there are (see minScale
// below) — so this is only the "small canvas" default.
const MIN_SCALE_FLOOR = 0.5;
// Roomy enough to read an item's label without opening anything. A frame's
// contents are 10pt type; at 1× that is small, and pinching in is the natural
// way to look closer at a map.
const MAX_SCALE = 3;
// Where the canvas opens: readable, not an overview. A map you land on already
// zoomed out is a picture; a map you land INSIDE is somewhere you explore.
const OPEN_SCALE = 1;

// Snap-back / recentre animation: the shared `settle` timing, which is what a
// gesture-thrown surface does once the finger leaves. Short and eased-out — a
// long spring on a drag surface reads as lag when the user is already moving on
// to their next gesture. ZoomableView claimed to match this and had drifted to
// 220ms; both now read the one token.

// Momentum. A map is a big surface you cross rather than a list you nudge, so
// a flick has to CARRY — 0.992 stopped almost as soon as the finger left, which
// meant crossing an opened-up map was a dozen small drags. `rubberBandEffect`
// replaces the hard stop at the edge with a give-and-return, so the end of the
// map feels like an edge instead of a wall.
const DECELERATION = 0.9975;
const EDGE_RUBBER = 0.6;
// How many frames the finger count must hold steady before a release counts as
// a flick. Two is enough to clear the frame the count changed on and the one
// after it, which is where the bogus velocity lives.
const SETTLED_FRAMES = 3;

// Faint ruled background. Without a reference grid, dragging a sparse canvas
// looks like nothing is happening — the discs move but the void behind them
// doesn't, so the motion reads as a glitch rather than as travel.
const GRID_STEP = 132;

// A frame's corner radius. Generous, so an opened board still belongs to the
// same family of shapes as the disc it grew out of.
const FRAME_RADIUS = 22;
// The board's own disc, shrunk into its frame's header — the one thing that
// says "this big box is still that board you tapped". Sized to fit FRAME_HEADER.
const FRAME_AVATAR = 30;

// A back-swipe may only start in a true bezel strip here, not in the app's
// usual whole-left-panel zone: on this page a leftward-to-rightward drag IS the
// primary interaction, and having the page slide away mid-pan would be the
// single most annoying thing it could do. The header chevron (and Android's
// hardware back) remain the unambiguous way out.
const BACK_EDGE = 22;

const HIT = { top: 10, bottom: 10, left: 10, right: 10 };

/**
 * Which tab owns each kind of thing. Photos and audio are two pages of the one
 * vault, so they share a tab and the vault picks the page from the link itself.
 */
const SURFACE_TAB = {
  tasks: 'Tasks',
  notes: 'Notes',
  photos: 'Photos',
  audio: 'Photos',
};

// Relative last-activity stamp — the same one the inbox rows carry, so a board
// reads the same age in both places.
const timeAgo = (ts) => {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 0) return 'soon';
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Which glyph stands for a task / note / photo / message on the map. */
const ITEM_ICON = {
  task: 'checkbox-marked-circle-outline',
  event: 'calendar-outline',
  birthday: 'cake-variant-outline',
  note: 'note-text-outline',
  media: 'image-outline',
  chat: 'message-text-outline',
};

const iconForItem = (item) => (
  item?.kind === 'task' ? (ITEM_ICON[item.itemType] || ITEM_ICON.task) : (ITEM_ICON[item?.kind] || 'circle-small')
);

/**
 * One board on the map: its disc, its name, and one line of meta. Memoised —
 * a pan re-renders nothing (the transform lives on the UI thread), but an
 * avatar or overview arriving re-renders the page, and there can be dozens of
 * these.
 */
const BoardNode = React.memo(function BoardNode({
  node, left, top, thumbs, base, colors, meta, nested, openable, onOpen, onHold,
}) {
  const { name, size, w } = node;
  const tint = boardColor(name);
  return (
    <TouchableOpacity
      {...TAP_ONLY}
      activeOpacity={0.65}
      onPress={() => onOpen(name)}
      onLongPress={() => onHold(name)}
      delayLongPress={320}
      style={[styles.node, { left, top, width: w }]}
      testID={`board-node-${name}`}
      accessibilityRole="button"
      accessibilityState={openable ? { expanded: false } : undefined}
      accessibilityLabel={
        openable
          ? `${name} board${nested ? `, ${plural(nested, 'board')} inside` : ''}. Open`
          : `Open ${name} board`
      }
      accessibilityHint="Hold for board options"
    >
      {/* Ringed disc. The ring is the board's own colour, so a photo collage
          still carries the tint that identifies it everywhere else. */}
      <View style={[styles.ring, {
        width: size + 7,
        height: size + 7,
        borderRadius: (size + 7) / 2,
        borderColor: boardTint(name, 0.5),
        backgroundColor: colors.surface,
      }]}
      >
        <BoardAvatar name={name} thumbs={thumbs} base={base} size={size} />
        {/* Absolutely positioned so the "there is something in here" markings
            cost the layout nothing — a halo that took part in the flow would
            shift every openable board's disc relative to every empty one's. */}
        {openable && (
          <>
            <View
              pointerEvents="none"
              style={[styles.halo, {
                borderRadius: (size + 7) / 2 + 6,
                borderColor: boardTint(name, 0.38),
              }]}
            />
            <View
              pointerEvents="none"
              testID={`board-nested-${name}`}
              style={[styles.badge, {
                backgroundColor: colors.surfaceElevated,
                borderColor: boardTint(name, 0.55),
              }]}
            >
              <Icon name={nested ? 'file-tree-outline' : 'plus'} size={9} color={tint} />
              {nested > 0 && (
                <Text style={[styles.badgeText, { color: tint }]}>{nested}</Text>
              )}
            </View>
          </>
        )}
      </View>
      <Text style={[styles.nodeName, { color: colors.textPrimary }]} numberOfLines={1}>
        {name}
      </Text>
      <Text style={[styles.nodeMeta, { color: tint }]} numberOfLines={1}>
        {meta}
      </Text>
    </TouchableOpacity>
  );
});

/**
 * An OPEN board: the disc grown into a frame, with the board's contents laid
 * out inside its border.
 *
 * The body is deliberately `box-none`. A frame is mostly the space between the
 * things in it, that space is the canvas's drag surface, and a map you cannot
 * drag by the middle of is a map you cannot move. So only the header strip
 * takes touches — which is also the only place the frame has anything to say.
 *
 * The contents are NOT children of this view. Every node on the map is placed
 * in the same absolute coordinate space and drawn shallowest-first, so a frame
 * lands underneath the things it contains without nesting the view tree eight
 * levels deep.
 */
const FrameNode = React.memo(function FrameNode({
  node, left, top, thumbs, base, colors, meta, nested, onOpen, onHold,
}) {
  const { name, w, h, empty } = node;
  const tint = boardColor(name);
  return (
    <View
      pointerEvents="box-none"
      style={[styles.frame, {
        left,
        top,
        width: w,
        height: h,
        borderColor: boardTint(name, 0.55),
        backgroundColor: boardTint(name, 0.07),
      }]}
      testID={`board-frame-${name}`}
    >
      <TouchableOpacity
        {...TAP_ONLY}
        activeOpacity={0.7}
        onPress={() => onOpen(name)}
        onLongPress={() => onHold(name)}
        delayLongPress={320}
        style={styles.frameHeader}
        testID={`board-node-${name}`}
        accessibilityRole="button"
        accessibilityState={{ expanded: true }}
        accessibilityLabel={`${name} board${nested ? `, ${plural(nested, 'board')} inside` : ''}. Close`}
        accessibilityHint="Hold for board options"
      >
        <View style={[styles.frameAvatar, { borderColor: boardTint(name, 0.5) }]}>
          <BoardAvatar name={name} thumbs={thumbs} base={base} size={FRAME_AVATAR} />
        </View>
        <View style={styles.frameTitles}>
          <Text style={[styles.frameName, { color: colors.textPrimary }]} numberOfLines={1}>
            {name}
          </Text>
          <Text style={[styles.frameMeta, { color: tint }]} numberOfLines={1}>
            {meta}
          </Text>
        </View>
        <Icon name="chevron-up" size={20} color={boardTint(name, 0.9)} />
      </TouchableOpacity>
      {empty && (
        <Text style={[styles.frameEmpty, { color: colors.textTertiary }]} pointerEvents="none">
          Nothing in here yet
        </Text>
      )}
    </View>
  );
});

/**
 * One item hanging off an open board — a task, a note, a photo, a message.
 *
 * Small on purpose. These are the leaves of the map, and they are there to
 * answer "what kind of thing is on this board" at a glance, not to be read;
 * the board's own conversation is one tap away for that.
 */
const ItemNode = React.memo(function ItemNode({
  node, left, top, base, colors, onOpen,
}) {
  const { item, size, owner, w } = node;
  const tint = boardColor(owner);
  const thumb = item?.thumbnailUrl
    ? (item.thumbnailUrl.startsWith('http') ? item.thumbnailUrl : base + item.thumbnailUrl)
    : null;
  const done = item?.kind === 'task' ? item.completed : (item?.kind === 'note' ? item.done : false);
  return (
    <TouchableOpacity
      {...TAP_ONLY}
      activeOpacity={0.65}
      onPress={() => onOpen(owner)}
      style={[styles.node, { left, top, width: w }]}
      testID={`board-item-${item?.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${item?.title || 'Item'}, on ${owner}. Open the board`}
    >
      <View style={[styles.itemDisc, {
        width: size,
        height: size,
        borderRadius: size / 2,
        borderColor: boardTint(owner, 0.45),
        backgroundColor: colors.surface,
      }]}
      >
        {thumb ? (
          <Image
            source={{ uri: thumb }}
            style={{ width: size, height: size, borderRadius: size / 2 }}
            contentFit="cover"
            transition={150}
            recyclingKey={thumb}
            cachePolicy="memory-disk"
          />
        ) : (
          <Icon name={iconForItem(item)} size={Math.round(size * 0.46)} color={tint} />
        )}
      </View>
      <Text
        style={[
          styles.itemLabel,
          { color: colors.textSecondary },
          done && { color: colors.textMuted, textDecorationLine: 'line-through' },
        ]}
        numberOfLines={2}
      >
        {item?.title || ''}
      </Text>
    </TouchableOpacity>
  );
});

/**
 * A CLOSED group: one chip inside a frame, saying what kind of thing and how
 * many. Its width is decided by the layout (which has to place it before any
 * text exists to measure), so the chip is given that width and told to fit.
 */
const GroupChip = React.memo(function GroupChip({ node, left, top, colors, onToggle }) {
  const { group, count, owner, w, h } = node;
  const tint = boardColor(owner);
  return (
    <TouchableOpacity
      {...TAP_ONLY}
      activeOpacity={0.7}
      onPress={() => onToggle(owner, group.kind)}
      style={[styles.chip, {
        left,
        top,
        width: w,
        height: h,
        borderColor: boardTint(owner, 0.45),
        backgroundColor: colors.surface,
      }]}
      testID={`board-group-${owner}-${group.kind}`}
      accessibilityRole="button"
      accessibilityState={{ expanded: false }}
      accessibilityLabel={`${count} ${group.label} on ${owner}. Show them`}
    >
      <Icon name={group.icon} size={14} color={tint} />
      <Text style={[styles.chipLabel, { color: colors.textPrimary }]} numberOfLines={1}>
        {group.label}
      </Text>
      <Text style={[styles.chipCount, { color: tint }]}>{count}</Text>
      <Icon name="chevron-down" size={15} color={colors.textTertiary} />
    </TouchableOpacity>
  );
});

/**
 * An OPEN group: a lighter frame inside the board's, holding that kind's items.
 *
 * Same `box-none` rule as a board's frame — only the header strip takes
 * touches, so the space between the items stays part of the canvas's drag
 * surface.
 */
const GroupFrame = React.memo(function GroupFrame({
  node, left, top, colors, onToggle, onOpenIn,
}) {
  const { group, count, owner, w, h, empty } = node;
  const tint = boardColor(owner);
  return (
    <View
      pointerEvents="box-none"
      style={[styles.groupFrame, {
        left,
        top,
        width: w,
        height: h,
        borderColor: boardTint(owner, 0.4),
        backgroundColor: boardTint(owner, 0.05),
      }]}
      testID={`board-group-frame-${owner}-${group.kind}`}
    >
      <TouchableOpacity
        {...TAP_ONLY}
        activeOpacity={0.7}
        onPress={() => onToggle(owner, group.kind)}
        style={styles.groupHeader}
        testID={`board-group-${owner}-${group.kind}`}
        accessibilityRole="button"
        accessibilityState={{ expanded: true }}
        accessibilityLabel={`${count} ${group.label} on ${owner}. Hide them`}
      >
        <Icon name={group.icon} size={14} color={tint} />
        <Text style={[styles.chipLabel, { color: colors.textPrimary }]} numberOfLines={1}>
          {group.label}
        </Text>
        <Text style={[styles.chipCount, { color: tint }]}>{count}</Text>
        <View style={styles.headerSpacer} />
        <Icon name="chevron-up" size={15} color={colors.textTertiary} />
      </TouchableOpacity>
      {/* The way through to where this kind of thing actually LIVES. The map
          can show you a board has forty photos; it is not where you look at
          them, and hunting the vault down again with the same filter is a
          chore the map created. Chat has no button because its home is the
          board's own conversation, which every item here already opens. */}
      {!!group.surface && (
        <TouchableOpacity
          {...TAP_ONLY}
          activeOpacity={0.7}
          onPress={() => onOpenIn(group.surface, owner)}
          style={[styles.openIn, {
            borderColor: boardTint(owner, 0.45),
            backgroundColor: colors.surfaceElevated,
          }]}
          testID={`board-open-in-${owner}-${group.kind}`}
          accessibilityRole="button"
          accessibilityLabel={`Open ${owner}'s ${group.label.toLowerCase()} in ${group.surfaceLabel}`}
        >
          <Text style={[styles.openInText, { color: colors.textSecondary }]} numberOfLines={1}>
            Open in {group.surfaceLabel}
          </Text>
          <Icon name="open-in-new" size={12} color={tint} />
        </TouchableOpacity>
      )}
      {empty && (
        <Text style={[styles.groupEmpty, { color: colors.textTertiary }]} pointerEvents="none">
          Loading…
        </Text>
      )}
    </View>
  );
});

/** The node that closes a full group: "there is more here than fits". */
const MoreNode = React.memo(function MoreNode({ node, left, top, colors, onOpen }) {
  const { size, owner, w } = node;
  const tint = boardColor(owner);
  return (
    <TouchableOpacity
      {...TAP_ONLY}
      activeOpacity={0.65}
      onPress={() => onOpen(owner)}
      style={[styles.node, { left, top, width: w }]}
      testID={`board-more-${owner}`}
      accessibilityRole="button"
      accessibilityLabel={`See everything on ${owner}`}
    >
      <View style={[styles.itemDisc, {
        width: size,
        height: size,
        borderRadius: size / 2,
        borderColor: boardTint(owner, 0.45),
        backgroundColor: colors.surface,
      }]}
      >
        <Icon name="dots-horizontal" size={Math.round(size * 0.5)} color={tint} />
      </View>
      <Text style={[styles.itemLabel, { color: colors.textTertiary }]} numberOfLines={1}>
        More
      </Text>
    </TouchableOpacity>
  );
});

export default function BoardsCanvas({ visible, onClose }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { open: openBoardLink } = useBoardLink();
  const {
    boards, avatars, mediaBase, loading, loadFailed, load,
    createBoard, moveBoard, deleteBoard,
  } = useBoardsOverview(visible);
  const [openBoard, setOpenBoard] = useState(null);
  // Viewport, measured rather than assumed — this page sits inside a modal, and
  // Dimensions would be wrong the moment it doesn't fill the screen.
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  // The one-line "drag to explore" hint, retired the first time the user drags.
  const [hinted, setHinted] = useState(false);

  // ── Where in the tree we are standing ─────────────────────────────────────
  const tree = useMemo(() => boardTree(boards), [boards]);
  // The focus trail, as board names from the top down. Kept as names rather
  // than rows so a refresh (which replaces every row object) doesn't lose our
  // place.
  const [trail, setTrail] = useState([]);
  // …and re-validated against the live tree on every render, because the world
  // moves under us: a board in the trail can be renamed on the web app, deleted
  // from Tasks, or moved somewhere else entirely while this page is open.
  const path = useMemo(() => pruneTrail(tree, trail), [tree, trail]);
  const here = path.length ? path[path.length - 1] : null;

  // ── What is open ──────────────────────────────────────────────────────────
  const [expanded, setExpanded] = useState(() => new Set());
  // Which `board/kind` groups are open. Separate from `expanded` because they
  // are separate decisions: closing a board should not forget which of its
  // groups you had been reading.
  const [openGroups, setOpenGroups] = useState(() => new Set());

  // Only the groups actually ON this map are worth fetching for: a group left
  // open inside a board we have since focused away from, or inside a board that
  // is now closed, is not drawn — so it costs nothing until it is on screen
  // again. Two passes — lay out with whatever contents we already have, ask for
  // the rest, and the groups fill in place when the answers land.
  const openOnMap = useMemo(() => {
    const drawn = (name) => {
      if (!tree.has(name)) return false;
      // Under whatever the map is rooted on — or anywhere, at the top level.
      if (here && !tree.isInside(name, here)) return false;
      // AND every board between here and it must itself be open, or this one is
      // inside something closed and is not on the map at all. Without this an
      // open board buried in a closed one still fetched its groups.
      const trail = tree.trailTo(name);
      const from = here ? trail.indexOf(here) + 1 : 0;
      for (let i = from; i < trail.length - 1; i += 1) {
        if (!expanded.has(trail[i])) return false;
      }
      return true;
    };
    return [...expanded].filter(drawn);
  }, [expanded, tree, here]);
  const groupsOnMap = useMemo(() => {
    const drawn = new Set(openOnMap);
    // A group key is `board/kind`, and a board name may contain a slash — so
    // the board is everything before the LAST one.
    return [...openGroups].filter((key) => drawn.has(key.slice(0, key.lastIndexOf('/'))));
  }, [openGroups, openOnMap]);
  const { itemsOf, moreOf, invalidate } = useBoardContents(groupsOnMap);

  const roots = useMemo(() => tree.childrenOf(here), [tree, here]);
  const layout = useMemo(
    () => boardFrameLayout(tree, {
      roots, expanded, openGroups, itemsOf, moreOf,
    }),
    [tree, roots, expanded, openGroups, itemsOf, moreOf],
  );
  const { width: canvasW, height: canvasH } = layout;
  // Shallowest first, so a frame is painted UNDER everything it contains.
  // Every node lives in the same flat coordinate space — nesting the view tree
  // to match the board tree would put a frame's own touch surface over its
  // contents, and eight levels of nesting under that.
  const nodes = useMemo(
    () => layout.nodes.slice().sort((a, b) => a.depth - b.depth),
    [layout.nodes],
  );
  const boardCount = useMemo(() => nodes.filter((n) => n.kind === 'board').length, [nodes]);

  /** "3 boards · 12 items · 2h" — the one line of meta a node has room for. */
  const metaFor = useCallback((name) => {
    const row = tree.get(name);
    const own = boardWeight(row);
    const nested = tree.descendantCount(name);
    const age = timeAgo(row?.lastTs);
    const parts = [];
    if (nested) parts.push(plural(nested, 'board'));
    if (own) parts.push(plural(own, 'item'));
    if (age) parts.push(age);
    return parts.length ? parts.join(' · ') : 'Empty';
  }, [tree]);

  /**
   * Is there anything inside this board to open? Sub-boards, or items of its
   * own. A board with neither would open into nothing, so a tap on it goes
   * straight to its conversation instead of playing an empty animation.
   */
  const canOpen = useCallback(
    (name) => tree.childCount(name) > 0 || boardWeight(tree.get(name)) > 0,
    [tree],
  );

  // ── The transform, all UI-thread ──────────────────────────────────────────
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const scale = useSharedValue(OPEN_SCALE);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const savedScale = useSharedValue(OPEN_SCALE);
  const originX = useSharedValue(0);
  const originY = useSharedValue(0);
  // Geometry mirrored into shared values so the gesture worklets can read it
  // without hopping to the JS thread.
  const viewW = useSharedValue(0);
  const viewH = useSharedValue(0);
  const contentW = useSharedValue(0);
  const contentH = useSharedValue(0);
  const minScale = useSharedValue(MIN_SCALE_FLOOR);

  // ── Who owns the transform right now ──────────────────────────────────────
  //
  // Pan and pinch run SIMULTANEOUSLY, which is what makes a pinch that drifts
  // still a drag. But both used to write tx/ty every frame, so with two fingers
  // down they were overwriting each other and whichever ran last won. That is
  // most of what "erratic" was.
  //
  // The rule now: while two fingers are down the PINCH owns the transform. Its
  // focal tracking already IS two-finger panning — keeping the content point
  // under the fingers pinned there means the content follows them — so the pan
  // has nothing to add, and everything to break.
  const pinching = useSharedValue(0);
  // How many fingers the pan last saw, and the translation it last reported.
  // Both are needed to spot — and cancel — the leap in the average touch point
  // when a finger joins or leaves. See absorbTouchJump.
  const pointers = useSharedValue(0);
  const lastTX = useSharedValue(0);
  const lastTY = useSharedValue(0);
  // Frames since the finger count last changed. The velocity tracker measures
  // the same average point, so it reads that leap as an enormous flick; letting
  // it fling on that throws the map clear across the canvas.
  const sinceCountChange = useSharedValue(99);

  const fitScale = canvasFitScale(canvasW, canvasH, viewport.width, viewport.height);

  useEffect(() => {
    viewW.value = viewport.width;
    viewH.value = viewport.height;
    contentW.value = canvasW;
    contentH.value = canvasH;
    // However far the map is opened up, pinching all the way out must always
    // reach "everything at once".
    minScale.value = Math.min(MIN_SCALE_FLOOR, fitScale);
  }, [viewport, canvasW, canvasH, fitScale, viewW, viewH, contentW, contentH, minScale]);

  /** Move the viewport so content point (x, y) sits at its centre. */
  const frame = useCallback((x, y, nextScale, animated) => {
    const s = clampScale(nextScale, minScale.value, MAX_SCALE);
    const boundX = panBound(contentW.value, viewW.value, s);
    const boundY = panBound(contentH.value, viewH.value, s);
    const nextX = clamp(-x * s, boundX);
    const nextY = clamp(-y * s, boundY);
    cancelAnimation(tx);
    cancelAnimation(ty);
    cancelAnimation(scale);
    if (animated) {
      const timing = R_TIMING.settle;
      scale.value = withTiming(s, timing);
      tx.value = withTiming(nextX, timing);
      ty.value = withTiming(nextY, timing);
    } else {
      scale.value = s;
      tx.value = nextX;
      ty.value = nextY;
    }
  }, [tx, ty, scale, contentW, contentH, viewW, viewH, minScale]);

  // Opening shot: 1×, centred on the busiest board of whatever the map is
  // rooted on. Applied ONCE PER FOCUS — the overview landing after the names
  // tier grows the discs and re-lays the map out, and yanking the viewport back
  // at that moment (or on every avatar that hydrates, or every time a fan
  // opens) would snatch the canvas out from under a user who was already
  // exploring. Re-rooting the map IS a new map though, so that re-frames —
  // animated, unlike the first, so it reads as travel rather than a cut.
  const framedRef = useRef(null);
  useEffect(() => { if (!visible) framedRef.current = null; }, [visible]);
  useEffect(() => {
    if (!visible) return;
    const level = here || '';
    if (framedRef.current === level) return;
    if (!nodes.length || !viewport.width || !viewport.height) return;
    const first = framedRef.current === null;
    framedRef.current = level;
    frame(layout.focusX, layout.focusY, OPEN_SCALE, !first);
  }, [visible, here, nodes.length, viewport, layout.focusX, layout.focusY, frame]);

  // ── Keeping your place when the map re-lays out ───────────────────────────
  //
  // Opening a board changes the size of everything around it, and the map is
  // re-centred on its own bounding box — so without this, tapping a board sends
  // the whole canvas sliding and the thing you tapped ends up somewhere else
  // entirely. It was the single worst thing about moving around the map.
  //
  // The fix is to pin ONE node: remember where it sat on screen before the
  // change, and afterwards shift the viewport by exactly the distance it moved.
  // A node at content offset (nx, ny) appears at `viewport/2 + t + scale × n`,
  // so holding that fixed across nx → nx' is t' = t + scale × (nx − nx'). The
  // frame then appears to grow around a board that never moved, which is what
  // you would expect of a thing you just opened.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const anchorRef = useRef(null);

  /** Note where a node is now, so the next layout can put it back there. */
  const rememberAnchor = useCallback((key) => {
    const node = layoutRef.current.nodes.find((n) => n.key === key);
    anchorRef.current = node
      ? { key, x: node.left + node.w / 2, y: node.top + node.h / 2 }
      : null;
  }, []);

  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    anchorRef.current = null;
    const node = layout.nodes.find((n) => n.key === anchor.key);
    // Gone entirely (deleted, filtered away) — nothing to hold on to, and
    // yanking the viewport towards where it used to be would be worse.
    if (!node) return;
    const s = scale.value;
    const dx = s * (anchor.x - (node.left + node.w / 2));
    const dy = s * (anchor.y - (node.top + node.h / 2));
    if (!dx && !dy) return;
    // Instant, not animated: this is a correction that makes something look
    // like it never moved. Animating it would BE the movement.
    cancelAnimation(tx);
    cancelAnimation(ty);
    tx.value = clamp(tx.value + dx, panBound(contentW.value, viewW.value, s));
    ty.value = clamp(ty.value + dy, panBound(contentH.value, viewH.value, s));
    // The geometry effect above has already pushed the new canvas size into the
    // shared values, which is why the bounds here are the new ones.
  }, [layout, tx, ty, scale, contentW, contentH, viewW, viewH]);

  const markHinted = useCallback(() => setHinted(true), []);
  // UI-thread latch, so retiring the hint costs exactly one hop to JS rather
  // than one per drag for the rest of the session.
  const hintShown = useSharedValue(0);

  const pan = useMemo(() => Gesture.Pan()
    // Two fingers mid-pinch should drag the canvas with them rather than
    // whipping it to wherever the first finger happens to be.
    .averageTouches(true)
    .onStart((e) => {
      cancelAnimation(tx);
      cancelAnimation(ty);
      startX.value = tx.value;
      startY.value = ty.value;
      pointers.value = e.numberOfPointers;
      lastTX.value = 0;
      lastTY.value = 0;
      sinceCountChange.value = 99;
      if (hintShown.value === 0) {
        hintShown.value = 1;
        runOnJS(markHinted)();
      }
    })
    .onUpdate((e) => {
      // Two fingers down: stand aside and just keep the baseline current, so
      // that the moment one lifts we carry on from exactly where the pinch left
      // the map rather than from where this gesture thinks it should be.
      if (pinching.value) {
        pointers.value = e.numberOfPointers;
        sinceCountChange.value = 0;
        lastTX.value = e.translationX;
        lastTY.value = e.translationY;
        startX.value = panBaseline(tx.value, e.translationX);
        startY.value = panBaseline(ty.value, e.translationY);
        return;
      }
      // A finger joined or left, so what `translation` is measured from just
      // moved on its own. Absorb the leap instead of panning by it.
      if (e.numberOfPointers !== pointers.value) {
        startX.value = absorbTouchJump(startX.value, lastTX.value, e.translationX);
        startY.value = absorbTouchJump(startY.value, lastTY.value, e.translationY);
        pointers.value = e.numberOfPointers;
        sinceCountChange.value = 0;
      } else {
        sinceCountChange.value += 1;
      }
      lastTX.value = e.translationX;
      lastTY.value = e.translationY;

      const boundX = panBound(contentW.value, viewW.value, scale.value);
      const boundY = panBound(contentH.value, viewH.value, scale.value);
      // Rubber-banded rather than hard-stopped: dragging past the last board
      // gives, then springs back, so the edge of the map feels like an edge
      // instead of a bug.
      tx.value = rubberClamp(startX.value + e.translationX, boundX);
      ty.value = rubberClamp(startY.value + e.translationY, boundY);
    })
    .onEnd((e) => {
      const boundX = panBound(contentW.value, viewW.value, scale.value);
      const boundY = panBound(contentH.value, viewH.value, scale.value);
      const timing = R_TIMING.settle;
      // Lifting the second finger of a pinch is not a flick, however fast the
      // average point appeared to move. Only fling on a velocity measured over
      // frames where the finger count held still.
      const flick = sinceCountChange.value >= SETTLED_FRAMES;
      if (!flick) {
        tx.value = withTiming(clamp(tx.value, boundX), timing);
        ty.value = withTiming(clamp(ty.value, boundY), timing);
        return;
      }
      // Released INSIDE the bounds → flick-to-glide, clamped to the map's
      // edges. Released outside them → the rubber band wins and it springs
      // back; a decay from out there would drift further before returning.
      if (Math.abs(tx.value) > boundX) {
        tx.value = withTiming(clamp(tx.value, boundX), timing);
      } else {
        tx.value = withDecay({
          velocity: e.velocityX,
          clamp: [-boundX, boundX],
          deceleration: DECELERATION,
          rubberBandEffect: true,
          rubberBandFactor: EDGE_RUBBER,
        });
      }
      if (Math.abs(ty.value) > boundY) {
        ty.value = withTiming(clamp(ty.value, boundY), timing);
      } else {
        ty.value = withDecay({
          velocity: e.velocityY,
          clamp: [-boundY, boundY],
          deceleration: DECELERATION,
          rubberBandEffect: true,
          rubberBandFactor: EDGE_RUBBER,
        });
      }
    }), [
    tx, ty, scale, startX, startY, contentW, contentH, viewW, viewH,
    hintShown, markHinted, pinching, pointers, lastTX, lastTY, sinceCountChange,
  ]);

  const pinch = useMemo(() => Gesture.Pinch()
    .onStart((e) => {
      cancelAnimation(tx);
      cancelAnimation(ty);
      cancelAnimation(scale);
      pinching.value = 1;
      savedScale.value = scale.value;
      // The content point currently under the fingers, in unscaled
      // centre-relative canvas space. Keeping THIS point under the focal is
      // what makes a pinch feel like it is zooming what you grabbed.
      originX.value = (e.focalX - viewW.value / 2 - tx.value) / scale.value;
      originY.value = (e.focalY - viewH.value / 2 - ty.value) / scale.value;
    })
    .onUpdate((e) => {
      const next = rubberScale(savedScale.value * e.scale, minScale.value, MAX_SCALE);
      scale.value = next;
      tx.value = focalTranslate(e.focalX - viewW.value / 2, originX.value, next);
      ty.value = focalTranslate(e.focalY - viewH.value / 2, originY.value, next);
    })
    .onEnd(() => {
      const next = clampScale(scale.value, minScale.value, MAX_SCALE);
      const boundX = panBound(contentW.value, viewW.value, next);
      const boundY = panBound(contentH.value, viewH.value, next);
      // Only animate a scale that actually overshot its limits. Animating one
      // that didn't means 240ms of the pan computing its bounds against a
      // moving scale, which shows up as a wobble on release.
      if (Math.abs(next - scale.value) > 0.0005) {
        scale.value = withTiming(next, R_TIMING.settle);
      } else {
        scale.value = next;
      }
      // Instant, NOT animated. A finger is usually still down here — one of two
      // lifted is what ended the pinch — and the pan owns the transform again
      // the moment this returns. A timing animation would be overwritten
      // frame-by-frame by the pan, and fighting over one value is the jump.
      // Releasing BOTH fingers ends the pan too, and its own onEnd settles.
      tx.value = clamp(tx.value, boundX);
      ty.value = clamp(ty.value, boundY);
    })
    // onFinalize, not onEnd: a pinch that is cancelled (the gesture losing to
    // another, the app backgrounding mid-pinch) never reaches onEnd, and a
    // `pinching` flag left set means the pan never writes again.
    .onFinalize(() => {
      pinching.value = 0;
    }), [
    tx, ty, scale, savedScale, originX, originY,
    contentW, contentH, viewW, viewH, minScale, pinching,
  ]);

  // Simultaneous, not exclusive: a pinch that drifts is still a drag, and a
  // drag that gains a second finger is still a pinch.
  const gesture = useMemo(() => Gesture.Simultaneous(pan, pinch), [pan, pinch]);

  const canvasStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }));

  // ── Opening and closing ───────────────────────────────────────────────────
  /**
   * A tap means one thing per board, and which thing is written on the disc: a
   * board with something in it opens on the map, a board with nothing in it
   * opens its conversation. Holding gets you every other option either way.
   */
  const onOpen = useCallback((name) => {
    if (!canOpen(name)) {
      tapHaptic();
      setOpenBoard(name);
      return;
    }
    tapHaptic();
    rememberAnchor(`board:${name}`);
    setExpanded((prev) => toggleExpanded(tree, prev, name));
  }, [tree, canOpen, rememberAnchor]);

  /** Show or hide one kind of thing inside an open board. */
  const onToggleGroup = useCallback((name, kind) => {
    tapHaptic();
    // Pin the GROUP, not its board: the group is what is growing, it is what
    // the finger is on, and holding it still is what makes its items look like
    // they unfolded from it.
    rememberAnchor(`group:${name}/${kind}`);
    setOpenGroups((prev) => toggleGroup(prev, name, kind));
  }, [rememberAnchor]);

  /** An item, or the "More" node — both mean "show me this board properly". */
  const onOpenTimeline = useCallback((name) => {
    tapHaptic();
    setOpenBoard(name);
  }, []);

  /**
   * Leave the map for the surface that owns this kind of thing, with the board
   * already filtered for.
   *
   * The canvas closes on the way out. It is a page pushed over the Profile tab,
   * and leaving it up would mean landing back on the map — not on the photos
   * you asked for — the moment the destination tab is left again.
   */
  const openIn = useCallback((surface, board) => {
    const tab = SURFACE_TAB[surface];
    // A group whose surface has no tab is a wiring mistake, and navigating to
    // `undefined` throws — better to do nothing than to take the page down.
    if (!tab) return;
    tapHaptic();
    onClose?.();
    openBoardLink(surface, board);
    navigation.navigate(tab);
  }, [onClose, openBoardLink, navigation]);

  const collapseAll = useCallback(() => {
    tapHaptic();
    setExpanded(new Set());
    setOpenGroups(new Set());
  }, []);

  // ── Focus ─────────────────────────────────────────────────────────────────
  /** Jump to a depth from the breadcrumb trail; `0` is the whole map. */
  const ascendTo = useCallback((depth) => {
    tapHaptic();
    setTrail(path.slice(0, depth));
  }, [path]);

  // Back: out of the board the map is focused on, one level at a time, and only
  // off the page once we are back at the whole map. Wired to the chevron, the
  // edge swipe AND Android's hardware back, so all three agree.
  //
  // The `true` is EdgeSwipePage's "I consumed that, the page is staying" — a
  // committed swipe that got no answer would slide the canvas off the right
  // edge and leave it there, since `visible` never changes when back only means
  // "up one level".
  const goBack = useCallback(() => {
    if (path.length) {
      tapHaptic();
      setTrail(path.slice(0, -1));
      return true;
    }
    onClose?.();
    return false;
  }, [path, onClose]);

  // ── Creating, moving, deleting ────────────────────────────────────────────
  // `createParent === undefined` means the composer is closed; `null` means it
  // is open and aimed at the top level — which is why this is not a boolean.
  const [createParent, setCreateParent] = useState(undefined);
  const [held, setHeld] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const onHold = useCallback((name) => {
    impactHaptic('medium');
    setError(null);
    setHeld(name);
  }, []);

  const openComposer = useCallback((parent) => {
    setError(null);
    setCreateParent(parent);
  }, []);

  /**
   * Make sure a board's contents are on the map AND open, so something just put
   * inside it is visible instead of filed somewhere the user has to go and find.
   * Opening the branch is usually enough; re-rooting is the fallback for a
   * destination that isn't under what the map is focused on at all.
   */
  const reveal = useCallback((parent) => {
    if (!parent) {
      if (here) setTrail([]);
      return;
    }
    const chain = tree.trailTo(parent);
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const name of chain) next.add(name);
      return next;
    });
    const onMap = !here || parent === here || tree.isInside(parent, here);
    if (!onMap) setTrail(chain.slice(0, -1));
  }, [tree, here]);

  const submitCreate = useCallback(async (name) => {
    setBusy(true);
    setError(null);
    const parent = createParent ?? null;
    const result = await createBoard(name, parent);
    setBusy(false);
    if (!result.ok) {
      // The composer stays open with the server's own sentence in it — a name
      // clash is something the user fixes by typing, not by starting again.
      setError(result.error);
      return;
    }
    setCreateParent(undefined);
    // Show the new board where it actually went — a board you cannot see reads
    // exactly like a create that failed.
    reveal(parent);
  }, [createParent, createBoard, reveal]);

  const submitMove = useCallback(async (parent) => {
    if (!held) return;
    setBusy(true);
    setError(null);
    const result = await moveBoard(held, parent);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setHeld(null);
    // Follow the board to its new home for the same reason as above: the whole
    // point of the move was to put it somewhere, so show it there.
    reveal(parent);
  }, [held, moveBoard, reveal]);

  const submitDelete = useCallback(async () => {
    if (!held) return;
    setBusy(true);
    setError(null);
    const result = await deleteBoard(held);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // Nothing to navigate to: the board was ON this map, so the map is still
    // valid — and whatever was nested inside it has just surfaced in its place.
    setExpanded((prev) => {
      if (!prev.has(held)) return prev;
      const next = new Set(prev);
      next.delete(held);
      return next;
    });
    setHeld(null);
  }, [held, deleteBoard]);

  const focusHeld = useCallback(() => {
    const name = held;
    if (!name) return;
    tapHaptic();
    setHeld(null);
    setTrail(tree.trailTo(name));
  }, [held, tree]);

  const targets = useMemo(() => (held ? moveTargets(tree, held) : []), [tree, held]);

  // Grid lines, as an offset list rather than one View per pixel — a couple of
  // dozen hairlines is the whole background.
  const grid = useMemo(() => {
    if (!(canvasW > 0) || !(canvasH > 0)) return { columns: [], rows: [] };
    const columns = [];
    const rows = [];
    for (let x = GRID_STEP; x < canvasW; x += GRID_STEP) columns.push(x);
    for (let y = GRID_STEP; y < canvasH; y += GRID_STEP) rows.push(y);
    return { columns, rows };
  }, [canvasW, canvasH]);

  const empty = !loading && nodes.length === 0;
  const composerOpen = createParent !== undefined;
  const overlayUp = !!openBoard || composerOpen || !!held;

  return (
    <EdgeSwipePage
      visible={visible}
      onClose={goBack}
      edgeZone={BACK_EDGE}
      // An open board conversation (or a card) is a page ON TOP of this one;
      // the back-swipe must not reach through it to the canvas underneath.
      swipeEnabled={!overlayUp}
    >
      {/* A Modal renders into its own native view tree, OUTSIDE the
          GestureHandlerRootView at the app root — Gesture Handler needs a root
          inside it or the pan/pinch silently never fire (Android especially). */}
      <GestureHandlerRootView style={[styles.page, { backgroundColor: c.background }]}>
        <View
          style={styles.page}
          testID="boards-canvas"
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout;
            setViewport((prev) => (
              prev.width === width && prev.height === height ? prev : { width, height }
            ));
          }}
        >
          <GestureDetector gesture={gesture}>
            {/* The viewport. Clips the canvas and owns every gesture that no
                node claimed first — a stationary touch goes to the node under
                it, anything that moves is a pan. */}
            <View style={styles.viewport} collapsable={false}>
              {viewport.width > 0 && nodes.length > 0 && (
                <Animated.View
                  style={[
                    styles.canvas,
                    {
                      width: canvasW,
                      height: canvasH,
                      left: (viewport.width - canvasW) / 2,
                      top: (viewport.height - canvasH) / 2,
                    },
                    canvasStyle,
                  ]}
                >
                  {grid.columns.map((x) => (
                    <View key={`c${x}`} style={[styles.gridLine, styles.gridColumn, { left: x, backgroundColor: c.border }]} />
                  ))}
                  {grid.rows.map((y) => (
                    <View key={`r${y}`} style={[styles.gridLine, styles.gridRow, { top: y, backgroundColor: c.border }]} />
                  ))}

                  {nodes.map((node) => {
                    // Canvas-local: (0, 0) of the layout is the canvas's middle,
                    // and every node carries the corner of its own box.
                    const left = canvasW / 2 + node.left;
                    const top = canvasH / 2 + node.top;
                    if (node.kind === 'item') {
                      return (
                        <ItemNode
                          key={node.key}
                          node={node}
                          left={left}
                          top={top}
                          base={mediaBase}
                          colors={c}
                          onOpen={onOpenTimeline}
                        />
                      );
                    }
                    if (node.kind === 'more') {
                      return (
                        <MoreNode
                          key={node.key}
                          node={node}
                          left={left}
                          top={top}
                          colors={c}
                          onOpen={onOpenTimeline}
                        />
                      );
                    }
                    if (node.kind === 'group') {
                      const Group = node.open ? GroupFrame : GroupChip;
                      return (
                        <Group
                          key={node.key}
                          node={node}
                          left={left}
                          top={top}
                          colors={c}
                          onToggle={onToggleGroup}
                          onOpenIn={openIn}
                        />
                      );
                    }
                    const Board = node.open ? FrameNode : BoardNode;
                    return (
                      <Board
                        key={node.key}
                        node={node}
                        left={left}
                        top={top}
                        thumbs={avatars[node.name]}
                        base={mediaBase}
                        colors={c}
                        meta={metaFor(node.name)}
                        nested={tree.descendantCount(node.name)}
                        openable={canOpen(node.name)}
                        onOpen={onOpen}
                        onHold={onHold}
                      />
                    );
                  })}
                </Animated.View>
              )}
            </View>
          </GestureDetector>

          {/* Header — floats OVER the canvas rather than pushing it down, so
              the map keeps the whole screen. */}
          <View style={[styles.header, { paddingTop: insets.top + 6 }]} pointerEvents="box-none">
            <View style={styles.headerRow} pointerEvents="box-none">
              <TouchableOpacity
                onPress={goBack}
                hitSlop={HIT}
                style={styles.headerButton}
                accessibilityRole="button"
                accessibilityLabel={here ? `Back to ${path.length > 1 ? path[path.length - 2] : 'all boards'}` : 'Back'}
              >
                <Icon name="chevron-left" size={28} color={c.textPrimary} />
              </TouchableOpacity>
              {/* Inert, so the title and the count don't carve a dead strip out
                  of the top of a surface whose whole job is to be dragged. */}
              <Text
                style={[styles.title, { color: c.textPrimary }]}
                pointerEvents="none"
                numberOfLines={1}
              >
                {here || 'Boards'}
              </Text>
              {boardCount > 0 && (
                <View
                  style={[styles.countPill, { backgroundColor: c.surfaceElevated, borderColor: c.border }]}
                  pointerEvents="none"
                >
                  <Text style={[styles.countText, { color: c.textTertiary }]}>{boardCount}</Text>
                </View>
              )}
              <View style={styles.headerSpacer} pointerEvents="none" />
              {/* Focused on a board, its own conversation is one tap away —
                  without this, a board the map is rooted on would have no door
                  to its own tasks, notes and photos. */}
              {!!here && (
                <TouchableOpacity
                  onPress={() => { tapHaptic(); setOpenBoard(here); }}
                  hitSlop={HIT}
                  style={styles.headerButton}
                  accessibilityRole="button"
                  accessibilityLabel={`Open the ${here} conversation`}
                >
                  <Icon name="forum-outline" size={20} color={c.textSecondary} />
                </TouchableOpacity>
              )}
              {/* One tap back to a map you can see all of. An opened-up mind map
                  gets big fast, and closing branches one at a time to get back
                  to the overview is the tedium this exists to prevent. */}
              {expanded.size > 0 && (
                <TouchableOpacity
                  onPress={collapseAll}
                  hitSlop={HIT}
                  style={styles.headerButton}
                  accessibilityRole="button"
                  accessibilityLabel="Close every open board"
                >
                  <Icon name="collapse-all-outline" size={20} color={c.textSecondary} />
                </TouchableOpacity>
              )}
              {nodes.length > 0 && (
                <>
                  <TouchableOpacity
                    onPress={() => { tapHaptic(); frame(0, 0, fitScale, true); }}
                    hitSlop={HIT}
                    style={styles.headerButton}
                    accessibilityRole="button"
                    accessibilityLabel="Fit every board on screen"
                  >
                    <Icon name="fit-to-screen-outline" size={22} color={c.textSecondary} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => { tapHaptic(); frame(layout.focusX, layout.focusY, OPEN_SCALE, true); }}
                    hitSlop={HIT}
                    style={styles.headerButton}
                    accessibilityRole="button"
                    accessibilityLabel="Back to the busiest board"
                  >
                    <Icon name="image-filter-center-focus" size={21} color={c.textSecondary} />
                  </TouchableOpacity>
                </>
              )}
            </View>

            {/* The trail back out of a focused board. Only drawn once there IS
                one — on the whole map it would be a lone dead chip carving a
                strip out of the drag surface for nothing. */}
            {path.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.crumbs}
                contentContainerStyle={styles.crumbsContent}
                testID="board-breadcrumbs"
              >
                <Crumb label="Boards" icon="shape-outline" colors={c} onPress={() => ascendTo(0)} />
                {path.map((name, i) => (
                  <React.Fragment key={name}>
                    <Icon name="chevron-right" size={14} color={c.textMuted} />
                    <Crumb
                      label={name}
                      current={i === path.length - 1}
                      colors={c}
                      onPress={() => ascendTo(i + 1)}
                    />
                  </React.Fragment>
                ))}
              </ScrollView>
            )}
          </View>

          {/* Loading / empty / unreachable, in the middle of the canvas. */}
          {loading && nodes.length === 0 && (
            <View style={styles.centre} pointerEvents="none">
              <ActivityIndicator color={c.textSecondary} />
            </View>
          )}
          {empty && (
            <View style={styles.centre}>
              <Icon
                name={loadFailed ? 'wifi-off' : (here ? 'file-tree-outline' : 'shape-outline')}
                size={40}
                color={c.textTertiary}
              />
              <Text style={[styles.emptyText, { color: c.textSecondary }]}>
                {loadFailed
                  ? "Couldn't reach the server."
                  : (here
                    ? `Nothing inside “${here}” yet.`
                    : 'No boards yet — make your first one.')}
              </Text>
              {loadFailed ? (
                <TouchableOpacity
                  onPress={() => { tapHaptic(); load(); }}
                  style={[styles.retry, { backgroundColor: c.surfaceElevated, borderColor: c.border }]}
                  accessibilityRole="button"
                  accessibilityLabel="Retry loading boards"
                >
                  <Text style={{ color: c.textPrimary, fontWeight: '600' }}>Retry</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  onPress={() => { tapHaptic(); openComposer(here); }}
                  style={[styles.retry, { backgroundColor: c.surfaceElevated, borderColor: c.border }]}
                  accessibilityRole="button"
                  accessibilityLabel={here ? `Create a board inside ${here}` : 'Create a board'}
                >
                  <Text style={{ color: c.textPrimary, fontWeight: '600' }}>
                    {here ? 'New board inside' : 'New board'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* One-time hint. A canvas gives no affordance that it moves, and no
              disc announces that tapping opens it out, so the cheapest fix is
              to say both until the user proves they know. */}
          {!hinted && nodes.length > 0 && (
            <View style={[styles.hint, { bottom: insets.bottom + 88 }]} pointerEvents="none">
              <View style={[styles.hintPill, { backgroundColor: c.surfaceElevated, borderColor: c.border }]}>
                <Icon name="gesture-tap" size={15} color={c.textTertiary} />
                <Text style={[styles.hintText, { color: c.textTertiary }]}>
                  Tap to open a board · hold for options
                </Text>
              </View>
            </View>
          )}

          {/* New board, always at whatever the map is rooted on. Hidden while
              the map has nothing on it, because the empty state already offers
              the same thing in the middle of the screen. */}
          {!empty && (
            <TouchableOpacity
              onPress={() => { tapHaptic(); openComposer(here); }}
              style={[styles.fab, {
                bottom: insets.bottom + 20,
                backgroundColor: c.surfaceElevated,
                borderColor: c.border,
              }]}
              accessibilityRole="button"
              accessibilityLabel={here ? `New board inside ${here}` : 'New board'}
              testID="board-create-fab"
            >
              <Icon name="plus" size={26} color={c.textPrimary} />
            </TouchableOpacity>
          )}

          <BoardCreateSheet
            visible={composerOpen}
            parentName={createParent ?? null}
            busy={busy}
            error={error}
            colors={c}
            bottomInset={insets.bottom}
            onSubmit={submitCreate}
            onClose={() => { setCreateParent(undefined); setError(null); }}
          />

          <BoardActionsSheet
            visible={!!held}
            board={held}
            childCount={held ? tree.childCount(held) : 0}
            nestedCount={held ? tree.descendantCount(held) : 0}
            currentParent={held ? tree.parentOf(held) : null}
            targets={targets}
            busy={busy}
            error={error}
            colors={c}
            bottomInset={insets.bottom}
            onOpen={() => { const name = held; setHeld(null); setOpenBoard(name); }}
            onAddChild={() => { const name = held; setHeld(null); openComposer(name); }}
            onFocus={focusHeld}
            onMove={submitMove}
            onDelete={submitDelete}
            onClose={() => { setHeld(null); setError(null); }}
          />

          {/* The board's conversation — the same page the inbox opens, nested
              as an in-tree overlay (a sibling Modal wouldn't present over this
              one on iOS). Closing it refreshes the map, and re-reads that
              board's fan, only when the visit actually changed something. */}
          <BoardTimeline
            visible={!!openBoard}
            board={openBoard}
            onClose={(didActivity) => {
              const name = openBoard;
              setOpenBoard(null);
              if (didActivity) {
                load({ isRefresh: true });
                invalidate(name);
              }
            }}
          />
        </View>
      </GestureHandlerRootView>
    </EdgeSwipePage>
  );
}

/** One segment of the breadcrumb trail. The last one is where you are. */
function Crumb({ label, icon, current, colors, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={current}
      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
      style={[styles.crumb, {
        backgroundColor: current ? 'transparent' : colors.surfaceElevated,
        borderColor: current ? 'transparent' : colors.border,
      }]}
      accessibilityRole="button"
      accessibilityLabel={current ? `${label}, current level` : `Go up to ${label}`}
    >
      {!!icon && <Icon name={icon} size={12} color={colors.textTertiary} />}
      <Text
        style={[styles.crumbText, { color: current ? colors.textPrimary : colors.textSecondary }]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  viewport: { flex: 1, overflow: 'hidden' },
  canvas: { position: 'absolute' },
  gridLine: { position: 'absolute' },
  gridColumn: { top: 0, bottom: 0, width: StyleSheet.hairlineWidth },
  gridRow: { left: 0, right: 0, height: StyleSheet.hairlineWidth },
  node: { position: 'absolute', alignItems: 'center' },
  // An opened board. Its contents are drawn OVER this, not inside it — see the
  // note on FrameNode.
  frame: {
    position: 'absolute',
    borderWidth: 2,
    borderRadius: FRAME_RADIUS,
  },
  frameHeader: {
    height: FRAME_HEADER,
    marginTop: FRAME_PAD,
    marginHorizontal: FRAME_PAD,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  frameAvatar: {
    width: FRAME_AVATAR + 4,
    height: FRAME_AVATAR + 4,
    borderRadius: (FRAME_AVATAR + 4) / 2,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frameTitles: { flex: 1 },
  frameName: { fontSize: 14, fontWeight: '700' },
  frameMeta: { fontSize: 10.5, fontWeight: '600', marginTop: 1, opacity: 0.9 },
  frameEmpty: {
    position: 'absolute',
    left: FRAME_PAD,
    right: FRAME_PAD,
    top: FRAME_PAD + FRAME_HEADER + 24,
    fontSize: 12,
    textAlign: 'center',
  },
  // A closed group. Explicitly sized by the layout, which places it before
  // there is any laid-out text to measure.
  chip: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    borderRadius: CHIP_HEIGHT / 2,
    borderWidth: 1,
  },
  chipLabel: { fontSize: 12.5, fontWeight: '700' },
  chipCount: { fontSize: 12.5, fontWeight: '800' },
  // An open group: a lighter frame inside the board's own.
  groupFrame: {
    position: 'absolute',
    borderWidth: 1,
    borderRadius: 14,
  },
  groupHeader: {
    height: GROUP_HEADER,
    marginTop: GROUP_PAD,
    marginHorizontal: GROUP_PAD,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  groupEmpty: {
    position: 'absolute',
    left: GROUP_PAD,
    right: GROUP_PAD,
    top: GROUP_PAD + GROUP_HEADER + 14,
    fontSize: 11.5,
    textAlign: 'center',
  },
  // Pinned to the strip the layout reserved at the bottom of an open group.
  openIn: {
    position: 'absolute',
    left: GROUP_PAD,
    right: GROUP_PAD,
    bottom: GROUP_PAD,
    height: GROUP_FOOTER,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
  },
  openInText: { fontSize: 11.5, fontWeight: '700' },
  ring: {
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5,
  },
  // "There is something in here", drawn twice: an orbit around the disc…
  halo: {
    position: 'absolute', top: -6, left: -6, right: -6, bottom: -6,
    borderWidth: 1.5,
  },
  // …and the count, because the halo says "some" and a person deciding where to
  // tap wants "four". Open, it becomes the way to close it again.
  badge: {
    position: 'absolute', top: -4, right: -6,
    flexDirection: 'row', alignItems: 'center', gap: 2,
    paddingHorizontal: 5, paddingVertical: 1.5,
    borderRadius: 999, borderWidth: StyleSheet.hairlineWidth,
  },
  badgeText: { fontSize: 9.5, fontWeight: '800' },
  nodeName: { fontSize: 12.5, fontWeight: '700', marginTop: 6, maxWidth: '100%' },
  // Sits inside the reserved band under the disc — see LABEL_BAND, which the
  // layout's spacing pays for.
  nodeMeta: { fontSize: 10.5, fontWeight: '600', marginTop: 1, maxWidth: '100%', opacity: 0.9 },
  itemDisc: {
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, overflow: 'hidden',
  },
  // Two lines at 11pt fits ITEM_LABEL_BAND, which the layout's spacing pays for.
  itemLabel: {
    fontSize: 10, lineHeight: 12, marginTop: 4,
    maxWidth: '100%', textAlign: 'center', maxHeight: ITEM_LABEL_BAND - 6,
  },
  header: {
    position: 'absolute', top: 0, left: 0, right: 0,
    paddingBottom: 8,
  },
  headerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8,
  },
  headerButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerSpacer: { flex: 1 },
  // Capped so a long board name can't push the framing controls off the row.
  title: { fontSize: 17, fontWeight: '700', marginLeft: 2, maxWidth: '40%' },
  countPill: {
    marginLeft: 8, paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 999, borderWidth: StyleSheet.hairlineWidth,
  },
  countText: { fontSize: 11, fontWeight: '700' },
  crumbs: { marginTop: 4, flexGrow: 0 },
  crumbsContent: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12 },
  crumb: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 9, paddingVertical: 4,
    borderRadius: 999, borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 150,
  },
  crumbText: { fontSize: 12, fontWeight: '600' },
  centre: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center', padding: 32,
  },
  emptyText: { marginTop: 12, textAlign: 'center' },
  retry: {
    marginTop: 16, paddingHorizontal: 20, paddingVertical: 9,
    borderRadius: 10, borderWidth: 1,
  },
  hint: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  hintPill: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: 13, paddingVertical: 7,
    borderRadius: 999, borderWidth: StyleSheet.hairlineWidth,
  },
  hintText: { fontSize: 12, fontWeight: '600' },
  fab: {
    position: 'absolute', right: 18,
    width: 54, height: 54, borderRadius: 27,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
