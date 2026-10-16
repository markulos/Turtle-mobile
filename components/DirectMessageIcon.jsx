/**
 * The DM mark — an outlined paper plane, nose up and to the right.
 *
 * ─── Why it is a component and not a name ──────────────────────────────────
 *
 * Because it is not one glyph. MaterialCommunityIcons draws `send` as a FILLED
 * plane lying flat, pointing right, which is a Send BUTTON — the thing you
 * press to commit the words you just typed. A direct message is not that: it
 * is a place you go, and every app that has one draws it as the outlined plane
 * tilted up off the horizontal. Flat and filled, beside "Send a link" and
 * "Regular" in a share sheet, it read as a fourth way to export the photo
 * rather than as the one way to hand it to a person.
 *
 * So the mark is `send-outline` plus a tilt, and it lives here because it is
 * now in three places — the share sheet, the people sheet it opens, and the
 * Profile's way into Messages — and three hand-rolled rotations is how two of
 * them end up at different angles.
 *
 * The tilt is a TRANSFORM, not a different glyph: the icon font has no angled
 * plane (there is no `send-variant` in this version — checked), and `near-me`
 * and the `navigation-*` family are map arrows, which mean "where I am".
 */
import React from 'react';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

/**
 * Degrees anticlockwise from flat.
 *
 * -45 would put the plane on the exact diagonal, which looks like a mistake
 * halfway between two states; the eye reads a slightly shallower tilt as
 * deliberate. This is the angle Instagram's and Telegram's both sit at.
 */
export const DM_TILT = -32;

export default function DirectMessageIcon({ size = 20, color, style, testID }) {
  return (
    <Icon
      name="send-outline"
      size={size}
      color={color}
      // A rotated glyph still occupies its own square box, so nothing around
      // it moves — the plane just leans inside the space it already had.
      style={[{ transform: [{ rotate: `${DM_TILT}deg` }] }, style]}
      testID={testID}
    />
  );
}
