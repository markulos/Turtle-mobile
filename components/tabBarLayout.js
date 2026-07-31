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
export const TAB_SLOT = 52;

// The chip itself: a perfect square, sized to the icon slot so the glyph lands
// dead centre in it.
export const PILL_SIZE = 38;

// iOS continuous-corner ratio. Apple's squircle sits at ~22.4% of the side;
// 1/φ³ = 0.236 lands on the same curve, which is why the golden division reads
// as the familiar iOS shape rather than an arbitrary radius.
const PHI = 1.618;
export const PILL_RADIUS = Math.round(PILL_SIZE / (PHI * PHI * PHI));

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
