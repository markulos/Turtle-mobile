/**
 * Geometry shared by the tab bar and its sliding chip — and, at the bottom of
 * the file, the two rules that keep a panel clear of the screen's own furniture
 * at BOTH ends: the dock below (`panelBottomInset`) and the top hood above
 * (`panelTopInset`). They live here together because a panel needs both and
 * should not have to learn two modules to get its edges right.
 *
 * These live in one module because two separate things have to agree on them
 * exactly: the bar sets its horizontal padding so the tabs sit as a centred
 * cluster, and TabBarPill positions the chip inside that cluster. If either
 * derived its own numbers, the chip would drift off the icons the moment the
 * tab count or the slot width changed.
 *
 * Measured off the Pinterest reference (1170px wide @3x = a 390pt screen): its
 * nav is a tight group of ~52pt slots centred on the screen, floating clear of
 * the edges, rather than items stretched across the full width.
 */

// One tab's footprint. Wide enough for the 38pt chip plus breathing room, tight
// enough that the group stays a cluster instead of a bar.
export const TAB_SLOT = 67;

// The bar is a floating card, detached from the screen edges — matching the
// chat composer's glass card, which uses the same 10pt side margin. The bottom
// gap sits ON TOP of the safe-area inset so the card clears the home indicator
// instead of resting on it.
//
// Declared UP HERE, with the geometry, rather than at the foot of the file
// where they used to live: the worklets below (clusterStart, slotAtX) capture
// what they reference at the moment they are DEFINED, so a constant declared
// after them reaches the UI thread as undefined — and a drag computed from
// undefined is a chip that vanishes.
export const CARD_MARGIN_H = 10;
export const CARD_GAP_BOTTOM = 8;

// The chip itself: a perfect square, 1.5x the original 38pt so it reads as a
// card carrying the glyph rather than a tight highlight around it.
export const PILL_SIZE = 57;

// Corner softness. The base is the iOS continuous-corner ratio — Apple's
// squircle sits at ~22.4% of the side, and 1/φ³ = 0.236 lands on the same
// curve — scaled 1.5x for a rounder chip: 20pt on a 57pt square, ~34% of the
// side. Still well short of the 50% that would turn it back into a circle.
const PHI = 1.618;
const RADIUS_SCALE = 1.5;
export const PILL_RADIUS = Math.round((PILL_SIZE / (PHI * PHI * PHI)) * RADIUS_SCALE);

/**
 * Left edge of the centred tab cluster within a bar of `barWidth`.
 * Clamped at 0 so a narrow screen (or an unexpectedly large tab count) degrades
 * to edge-to-edge rather than pushing the first tab off-screen.
 */
export const clusterStart = (barWidth, count) => {
  // A worklet because the dock's DRAG reads it on the UI thread (see slotAtX).
  // Callable from JS exactly as before — workletizing adds a second caller, it
  // does not take the first one away.
  'worklet';
  return Math.max(0, (barWidth - count * TAB_SLOT) / 2);
};

/** Horizontal padding the BAR needs so its flex items form that same cluster. */
export const clusterPadding = (screenWidth, count) =>
  clusterStart(screenWidth, count);

/**
 * WHICH TAB A FINGER IS OVER, as a CONTINUOUS slot position.
 *
 * This is the dock's drag (DockTabBar): a thumb sliding along the capsule
 * carries the chip with it and switches tabs as it crosses them. Both halves of
 * that need the same answer from the same place —
 *
 *   • the CHIP needs a fractional position, so it tracks the finger instead of
 *     hopping slot to slot. 2.4 means "40% of the way from Photos to Vault";
 *   • the NAVIGATION needs a whole one, which is `Math.round` of this. Rounding
 *     (not truncating) is what makes the boundary fall on the midpoint BETWEEN
 *     two icons rather than on an icon's left edge — so the tab flips when the
 *     thumb passes the gap, which is where the eye expects it.
 *
 * `x` is in WINDOW coordinates (a gesture's absoluteX), which is why this takes
 * the screen width rather than the bar's: the bar is inset by CARD_MARGIN_H
 * either side, and the cluster is centred inside that. Returning a slot index —
 * not a pixel offset — is also what keeps it honest with TabBarPill: the chip
 * converts the slot with its OWN measured geometry, through the same
 * `TAB_SLOT * i + offset` it uses at rest, so a drag cannot land the chip
 * anywhere a tap could not.
 *
 * Clamped to a real slot: a thumb that slides past the last icon, or off the
 * left end of the capsule, holds at the end tab rather than scrubbing into
 * nothing.
 */
export const slotAtX = (x, screenWidth, count) => {
  'worklet';
  const left = CARD_MARGIN_H + clusterStart(screenWidth - CARD_MARGIN_H * 2, count);
  // -0.5 puts the CENTRE of slot 0 at exactly 0: the pill's resting formula is
  // measured from a slot's left edge, so a finger on an icon must read as that
  // icon's whole number.
  const raw = (x - left) / TAB_SLOT - 0.5;
  return Math.min(count - 1, Math.max(0, raw));
};

/**
 * THE UNDERLINE — the dock's second indicator treatment (Settings → Navigation).
 *
 * A thin accent line under the active glyph instead of the filled chip behind
 * it. Same slot, same travel, a different mark: the chip reads as a button the
 * icon sits on, the line as a rule the icon stands on.
 *
 * The width is a touch narrower than the glyph block so the line reads as
 * UNDER the icon rather than as a box around it, and it is deliberately not
 * the full slot — a line that touches the ridges either side of it would look
 * like a filled cell.
 *
 * Its vertical place is measured off the BOTTOM of the content block, not off
 * the glyph: the brand turtle is 36pt where every other glyph is 24, so a line
 * positioned under "the icon" would be under one icon and through another. 7pt
 * up from the block's bottom edge clears the turtle's descent and still leaves
 * the line inside the capsule.
 */
export const UNDERLINE_W = 30;
export const UNDERLINE_H = 3;

/**
 * Where an indicator of `indicatorWidth` sits inside the cluster, so that it is
 * centred on slot 0. Both treatments go through this, which is what keeps the
 * chip and the line travelling on exactly the same line of slots — the caller
 * adds `TAB_SLOT * slot` to it, whole or fractional.
 */
export const indicatorOffset = (start, indicatorWidth) => {
  'worklet';
  return start + (TAB_SLOT - indicatorWidth) / 2;
};

/**
 * THE RIDGES — a hairline between each pair of tab icons, evenly spaced.
 *
 * The x of each one, measured from the same cluster edge the icons and the
 * indicator use: one at every slot BOUNDARY, which is what makes them even
 * without anyone dividing the bar up a second way. count - 1 of them, so there
 * is no ridge hanging off either end of the cluster.
 *
 * Returned as a list rather than drawn from an index so the spacing is a
 * testable claim: the gaps between consecutive ridges are all one slot.
 */
export const ridgeOffsets = (barWidth, count) => {
  const start = clusterStart(barWidth, count);
  const xs = [];
  for (let i = 1; i < count; i += 1) xs.push(start + TAB_SLOT * i);
  return xs;
};

// Breathing room above AND below the chip inside the bar. Applied as the bar's
// paddingTop and (on top of the safe-area inset) its paddingBottom, so the
// bar's inner content box is EXACTLY PILL_SIZE tall.
export const BAR_VERTICAL_PAD = 6;

// Bar height WITHOUT the safe-area inset. The chip is the tallest thing in it,
// so the bar is sized from the chip rather than the old fixed 49pt.
//
// Why the padding has to be symmetric: navigation centres each tab button's
// icon inside this inner box, while the chip is positioned from the box's top.
// Those two agree ONLY when the box is exactly the chip's height — otherwise
// the glyph centres in a taller box than the chip and sits a few points below
// it (the old paddingTop-only layout put the icons 3pt low). Sizing the box to
// PILL_SIZE makes "dead centre" true by construction at any inset or scale.
export const BAR_CONTENT_HEIGHT = PILL_SIZE + BAR_VERTICAL_PAD * 2;

// react-navigation v7's BottomTabItem hard-codes `padding: 5` and
// `justifyContent: 'flex-start'` on its INNER pressable, and `tabBarItemStyle`
// only reaches the OUTER wrapper — so neither value can be overridden. The icon
// is therefore stacked from the top of the item with 5pt above it, always.
//
// That is fixable from our side by SIZING for it: give the icon slot the box
// height minus that padding on both sides. The button then measures exactly
// PILL_SIZE (5 + slot + 5), the slot sits 5pt down inside it, and the glyph's
// centre lands on the box's centre — dead centre on the chip and on the dock,
// without fighting the library.
export const TAB_ITEM_PADDING = 5;
export const TAB_ICON_SLOT = PILL_SIZE - TAB_ITEM_PADDING * 2;

/**
 * How much space the dock ACTUALLY occupies, measured up from the window's
 * bottom edge: the card itself, the gap it floats above the screen edge, and
 * the safe-area inset under that.
 *
 * Anything positioning itself relative to the dock must use THIS, not
 * `useBottomTabBarHeight()`. The card's clearance is a MARGIN, and what that
 * hook reports for a margin-based floating bar is ambiguous — screens using it
 * ended up with a too-wide gap above the dock (the chat composer) and a day
 * sheet that didn't rise far enough to clear it. One formula, one source of
 * truth, so every surface agrees with where the dock really is.
 */
export const dockOccupied = (insetsBottom = 0) =>
  BAR_CONTENT_HEIGHT + CARD_GAP_BOTTOM + insetsBottom;

/**
 * A breath between the dock and whatever the panel ends with, so the last
 * control is clear of it rather than touching it.
 */
export const PANEL_BOTTOM_GAP = 12;

/**
 * A breath between the top hood and the panel's first row, so the title and its
 * keys sit under the status bar rather than against it. 8pt is what
 * VaultSearchPanel has always used (`topPad + 8`); this is that number, named.
 */
export const PANEL_TOP_GAP = 8;

/**
 * THE RULE: every full-screen panel clears the TOP HOOD itself.
 *
 * The hood is the status bar and whatever the phone parks in it — a notch, a
 * Dynamic Island. A panel that starts at y=0 draws its back key, its title and
 * its Clear key straight through the clock.
 *
 * THE TRAP is that the panel LOOKS like it is already covered. An `overlay`
 * EdgeSwipePage mounts inside a screen whose root has taken the inset already
 * (`<SafeAreaView edges={['top']}>` in Notes, `paddingTop: insets.top` in the
 * Planner), so the natural reading is "my parent cleared it, I must not clear
 * it twice". That reading is WRONG, and it has cost this app the bug twice:
 *
 *   The page is an ABSOLUTE FILL. It is laid out against its ancestor's padding
 *   box, so the ancestor's safe-area padding does not move it down — it covers
 *   the hood no matter what the screen above it did. (The Modal form says the
 *   same thing more obviously: it is `statusBarTranslucent`.)
 *
 * The giveaway that the "twice" reading is wrong is that it contradicts the
 * panels that work: OverviewPage is an overlay in the SAME Planner tree and
 * takes the whole `insets.top`, as do GlobalSearchPage, SharedBoardPage and
 * MediaGallery's pages. Commit 3b7b2c1 read a correctly-cleared status bar as
 * "a notch's worth of nothing above the title" and took the inset out of the
 * two filter panels; what that left is the title printed over the clock.
 *
 * So the inset is NOT a judgement call per panel, which is why this is a
 * function and not a comment. The one genuine exception is a panel rendered
 * EMBEDDED in another page's body rather than as its own EdgeSwipePage — a
 * real layout parent does pad its children, so that caller passes 0.
 */
export const panelTopInset = (insetsTop = 0) =>
  (Number(insetsTop) || 0) + PANEL_TOP_GAP;

/**
 * THE RULE: every panel ends above the dock, not behind it.
 *
 * The dock FLOATS. It reserves no layout space, so a panel that simply fills
 * the screen puts its last row underneath it — and the last row of a panel is
 * where its verbs live. The Planner's filter panel shipped with exactly that:
 * its "Show" key and its live count sat behind the capsule, visible as two
 * slivers poking out either side of it.
 *
 * The trap this exists to close is that `useBottomTabBarHeight()` LOOKS like
 * the answer and is not — see `dockOccupied` above. A panel using it clears
 * some height, so the bug reads as a tuning problem rather than as the wrong
 * source, and the next panel repeats it.
 *
 * `overlaid` is whether the dock is actually drawn over this surface. An
 * in-tree overlay (EdgeSwipePage's `overlay`) is covered by it; a true
 * full-screen Modal presents ABOVE the whole navigator, so the dock is not
 * there and clearing it would be a band of empty page instead.
 */
export const panelBottomInset = (insetsBottom = 0, overlaid = true) => (
  overlaid
    ? dockOccupied(insetsBottom) + PANEL_BOTTOM_GAP
    : (Number(insetsBottom) || 0) + PANEL_BOTTOM_GAP
);

// Chip's vertical position inside the card, derived from the card's own height
// rather than assumed equal to the padding — this is the value that puts the
// chip's CENTRE on the card's centre line, whatever the padding happens to be.
// Vertical correction between the chip and the glyphs.
//
// The chip is placed inside tabBarBackground, which spans the WHOLE card, while
// the glyphs are centred inside the tab BUTTONS, which live in the bar's inner
// content box. Those two boxes are only concentric if react-navigation adds no
// padding of its own — and it does add the safe-area inset on an absolutely
// positioned bar, which lifts the button row relative to the card and leaves
// the chip sitting low. This is that difference, isolated as one number.
export const CHIP_Y_NUDGE = -8;

/**
 * How far DOWN the dock's contents sit inside the capsule — applied to the chip
 * AND the glyphs, so the two can't drift apart.
 *
 * They're placed by two different rules: the chip is positioned from the top of
 * `tabBarBackground` (an absolutely-positioned child), while each glyph is
 * top-anchored inside BottomTabItem's inner pressable (`justifyContent:
 * 'flex-start'` + `padding: 5`, neither reachable from `tabBarItemStyle`). Both
 * therefore measure from the TOP, and both ended up above the capsule's centre
 * line — the offset visible as a band of empty capsule under the icons.
 *
 * One constant moves the whole content block down together. This is the number
 * to tune if the block ever needs re-centring; changing only one of the two
 * would knock the glyphs off their chip.
 */
export const DOCK_CONTENT_Y_NUDGE = 8;

export const PILL_TOP =
  Math.round((BAR_CONTENT_HEIGHT - PILL_SIZE) / 2) + CHIP_Y_NUDGE + DOCK_CONTENT_Y_NUDGE;
