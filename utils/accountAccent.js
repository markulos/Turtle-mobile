/**
 * The account's highlight colour, on the wire.
 *
 * The picker in Settings → Appearance has always written to this phone's
 * AsyncStorage and stopped there, so the colour was per-DEVICE: pick teal
 * here and the web app stayed on its own blue. The choice is shared now,
 * stored per USER in `users.settings.accent` / `users.settings.accentCustom`
 * through `GET /api/me` + `PATCH /api/me/settings` — the same per-user JSON
 * store the canvas boards ride on, so it needed no server change.
 *
 * AsyncStorage stays the local truth and paints the first frame; this is the
 * reconciliation on top of it. See `useAccountAccent`.
 *
 * The web half is `src/context/accountAccent.ts` in the web repo. The KEY is
 * what crosses the wire, so the swatch list there is a copy of ACCENTS here
 * and the two have to agree — there is a test on that side pinning it.
 */
import { ACCENTS, CUSTOM_ACCENT } from '../context/ThemeContext';
import { normalizeHex } from './accentColor';

/** The `users.settings` keys. Shared with the web app. */
export const ACCENT_SETTING = 'accent';
export const ACCENT_CUSTOM_SETTING = 'accentCustom';

/**
 * A hex in the form the WIRE uses: lower case.
 *
 * The two apps disagree about case — this one normalises to '#AABBCC' and the
 * web to '#aabbcc' — and the colour is the same either way, so nothing on
 * screen cares. The sync does: it decides whether to push by comparing
 * strings, so without one agreed spelling each device would see the other's
 * write as a change and answer it with a write of its own. Same colour, one
 * pointless round trip per device. Lower case is the wire's.
 */
export function wireHex(input) {
  const hex = normalizeHex(input);
  return hex ? hex.toLowerCase() : null;
}

/** True when this key names a swatch that can actually be resolved. */
export function isKnownAccent(key, custom) {
  if (key === CUSTOM_ACCENT) return !!custom;
  return ACCENTS.some((a) => a.key === key);
}

/**
 * The choice stored on the account, or null when there is none.
 *
 * The custom colour is read FIRST, the same way the local load does it and
 * for the same reason: 'custom' is only a legal key if there is a colour
 * behind it, so a half-written pair has to resolve to nothing rather than to
 * a phantom accent.
 */
export function readAccent(me) {
  const settings = me && me.user && me.user.settings;
  if (!settings || typeof settings !== 'object') return null;
  const custom = wireHex(settings[ACCENT_CUSTOM_SETTING]);
  const key = settings[ACCENT_SETTING];
  if (!isKnownAccent(key, custom)) return null;
  return { key, custom };
}

/**
 * The body of the PATCH that records a choice.
 *
 * A preset sends null for the custom colour, which DELETES the key server
 * side — otherwise the blob keeps a stale mixed colour behind a preset, and
 * the other device would resurrect the wrong one the next time 'custom' was
 * chosen.
 */
export function accentPatch(choice) {
  const custom = wireHex(choice.custom);
  if (choice.key === CUSTOM_ACCENT && custom) {
    return { [ACCENT_SETTING]: CUSTOM_ACCENT, [ACCENT_CUSTOM_SETTING]: custom };
  }
  return { [ACCENT_SETTING]: choice.key, [ACCENT_CUSTOM_SETTING]: null };
}

/**
 * A comparable stamp for a choice.
 *
 * The sync pushes when what is on screen stops matching what the account is
 * known to hold, and "matching" has to ignore the custom colour that is
 * remembered behind a selected PRESET — the picker keeps it so the swatch
 * still shows your colour, but it is not part of the choice and pushing on it
 * would be a write with nothing behind it.
 */
export function accentSignature(choice) {
  if (!choice || !choice.key) return '';
  return choice.key === CUSTOM_ACCENT ? `custom:${wireHex(choice.custom) || ''}` : choice.key;
}
