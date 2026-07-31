/**
 * Geometry shared by the tab bar and its sliding chip.
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
export const clusterStart = (barWidth, count) =>
  Math.max(0, (barWidth - count * TAB_SLOT) / 2);

/** Horizontal padding the BAR needs so its flex items form that same cluster. */
export const clusterPadding = (screenWidth, count) =>
  clusterStart(screenWidth, count);

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
