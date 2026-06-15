// Shared "Telegram-style" frosted-glass chrome for the chat surfaces —
// the messaging composer bar (TurtleScreen) and the Claude session panel
// (ClaudeConsole). Keeping the blur params in ONE place is what lets both
// boxes carry the EXACT same look: a translucent, blurred bar that the
// chat content scrolls behind. Tweak here → both surfaces update together.
//
// expo-blur notes:
//   • `tint` follows the theme (dark frost on dark, light frost on light).
//   • `intensity` is the blur strength (0–100). ~45 reads as a soft frost
//     without fully hiding the content scrolling behind it.
//   • Android needs `experimentalBlurMethod="dimezisBlurView"` to actually
//     blur (otherwise BlurView just renders a flat translucent overlay).
import { Platform } from 'react-native';

// How far the frosted composer overlaps the content above it, so chat
// messages visibly slide UNDER the frost as they scroll (the Telegram
// seam). The message list adds the same value as bottom inset so the
// newest message still rests clear of the bar at rest. Keep the two in
// sync — exported here as the single source of truth.
export const FROST_OVERLAP = 18;

export const blurProps = (theme) => ({
  // Telegram-style frosted bar: a strong-but-not-maxed blur (~85) so the chat
  // behind reads as soft, recognisable shapes rather than a featureless smear.
  // Pairs with a clearly-present translucent tint below — together they make
  // the bar a distinct frosted SURFACE, not invisible glass.
  intensity: 85,
  tint: theme.mode === 'dark' ? 'dark' : 'light',
  // No-op on iOS; enables real blur on Android.
  experimentalBlurMethod: 'dimezisBlurView',
});

// A translucent tint laid over the blur, sitting at Telegram's level: present
// enough that the bar reads as a real frosted SURFACE (not invisible glass),
// but still see-through so the blurred chat shows softly behind it. Tuned to
// ~0.4/0.5 — the 0.12/0.18 before was so faint it read as no panel at all.
export const frostOverlayColor = (theme) =>
  theme.mode === 'dark' ? 'rgba(20,20,22,0.4)' : 'rgba(250,250,252,0.5)';

// Hairline top border colour for the frosted bar — the thin line that
// separates the frost from the chat scrolling above it.
export const frostBorderColor = (theme) =>
  theme.mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.10)';
