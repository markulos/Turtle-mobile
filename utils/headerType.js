/**
 * The size of a screen's own title, in one place.
 *
 * Every tab had picked its own: Notes at 28, the Planner at 20, the Media Vault
 * at 17. Each looked considered on its own page and the set looked like three
 * apps — a title is the first thing you read on a screen, so its size is what
 * tells you whether you are still in the same product.
 *
 * NOT the whole style, only what has to MATCH. Weight is deliberately left out:
 * Notes sets one title in a single weight while the Planner and the Vault split
 * theirs across two ("Planner" hairline, the board regular), and forcing those
 * into one weight would flatten a distinction that is doing real work. Size,
 * tracking and line box are the things that make a set of titles look like a
 * set; the weight inside them is each screen's business.
 *
 * LINE HEIGHT IS EXPLICIT because the rows that hold these have fixed heights.
 * Left to the platform, a 28pt line box varies by OS version, and a title that
 * grows a point on someone's phone is a title clipped by the header it sits in.
 */
export const SCREEN_TITLE = {
  // 28 → 20. At 28 it was display type at the top of pages that are otherwise
  // all content: the title stopped introducing the screen and started being
  // the loudest thing on it. The line box comes down with it — the ratio is
  // what keeps the descenders clear, not the number.
  fontSize: 20,
  lineHeight: 25,
  letterSpacing: 0.2,
};

/**
 * The room a header row needs to hold one without clipping: the line box, plus
 * enough either side that the descenders are not sitting on the rule.
 */
// Not simply the title's box scaled down with it: a header row also holds
// KEYS, and those have a 44pt floor whatever the type does (STYLE-RULES §3).
// The type shrank; the target may not.
export const SCREEN_TITLE_ROW_H = 44;
