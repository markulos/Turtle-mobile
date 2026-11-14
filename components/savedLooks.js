/**
 * SAVED LOOKS — the dock you built, kept and named.
 *
 * Settings → Navigation already offers two ready-made kinds of look: a
 * PALETTE (three colours someone paired) and a THEME (a whole composed
 * character, able to override fields the generic controls have no slot for).
 * What it had no answer for was the look YOU arrive at after twenty minutes
 * of moving the backdrop, the highlight, the ink and the glow around: the
 * moment you touch any of those again it is gone, with nothing to go back to.
 *
 * So a look can be saved and named. Mark asked for it in those words — "save
 * their custom appearance as template and name it as they like" — and it is
 * the same idea as a theme with one difference that decides the whole shape of
 * this file: a theme is AUTHORED, in code, and may therefore be trusted. A
 * saved look comes off a device's own storage, where it can be half-written by
 * a crash, carried forward across an app update that renamed a setting, or
 * edited by hand. Everything here is written to survive that — `readLooks`
 * drops what it cannot understand rather than throwing, and every field is
 * coerced on the way in rather than on the way out.
 *
 * ── What a look is ─────────────────────────────────────────────────────────
 *
 * Every setting the Navigation panel can change, including `themeKey`. That
 * last one matters more than it looks: a theme's overrides (Godzilla's
 * scale-green unselected glyphs, its cold rim) are NOT settings and cannot be
 * rebuilt from the other fields, so a look saved while wearing a theme has to
 * remember which theme or it would come back as a flat approximation of
 * itself. See dockThemes' note on why a theme's key is stored at all.
 *
 * Pure functions on plain data, no storage and no React. ThemeContext owns
 * the persistence and the picker owns the pixels; what lives here is the part
 * that has rules — naming, capacity, identity, and what counts as the look
 * you are currently wearing.
 */

import { normalizeHex } from '../utils/accentColor';
import { DOCK_INKS, DOCK_STYLES } from './dockSkins';

/**
 * How many looks one person may keep.
 *
 * A cap rather than no cap, because these are drawn as full-width dock
 * previews — the only honest way to show a dock is as a dock — and a list of
 * forty of them is a scroll, not a choice. Twelve is comfortably more than
 * anyone has reported wanting and still a page you can look at.
 */
export const MAX_LOOKS = 12;

/** Long enough for "Late night reading", short enough to sit on one tile. */
export const NAME_MAX = 24;

const INDICATORS = ['chip', 'underline'];

/** A name with its edges trimmed and its length capped. '' if there is none. */
export function cleanName(raw) {
  return String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

/**
 * The current settings, as a look.
 *
 * Takes the whole settings object rather than nine arguments so a field added
 * to the panel later is one line here and not a call-site hunt — and so the
 * capture cannot silently go out of order.
 */
export function captureLook(s) {
  const o = s || {};
  return {
    indicator: oneOf(o.dockIndicator, INDICATORS, 'chip'),
    style: oneOf(o.dockStyle, DOCK_STYLES, 'smoked'),
    color: normalizeHex(o.dockColor) || null,
    ink: oneOf(o.dockInk, DOCK_INKS, 'auto'),
    inkColor: normalizeHex(o.dockInkColor) || null,
    // 0 is a real setting ("off"), so this cannot fall back on falsiness.
    glow: Number.isFinite(o.dockGlow) ? Math.max(0, Math.min(2, o.dockGlow)) : 1,
    glowColor: normalizeHex(o.dockGlowColor) || null,
    accent: normalizeHex(o.accentColor) || null,
    // '' means "not wearing one". Kept as-is: the themes a build knows about
    // are dockThemes' business, and a look saved on a newer build should not
    // be mangled here just because this one has not heard of its theme.
    themeKey: typeof o.dockTheme === 'string' ? o.dockTheme : '',
  };
}

/** One stored entry, coerced — or null if there is nothing usable in it. */
export function normalizeLook(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id == null ? '' : raw.id).trim();
  const name = cleanName(raw.name);
  if (!id || !name) return null;
  const look = captureLook({
    dockIndicator: raw.indicator,
    dockStyle: raw.style,
    dockColor: raw.color,
    dockInk: raw.ink,
    dockInkColor: raw.inkColor,
    dockGlow: raw.glow,
    dockGlowColor: raw.glowColor,
    accentColor: raw.accent,
    dockTheme: raw.themeKey,
  });
  return { id, name, savedAt: Number.isFinite(raw.savedAt) ? raw.savedAt : 0, ...look };
}

/**
 * The stored blob, as a list — never throwing.
 *
 * This runs at app start, on data this code did not write in this version.
 * A look that cannot be read is dropped and the rest are kept: losing one
 * saved look is a disappointment, and failing to boot the theme provider is
 * an app that opens on a white screen.
 */
export function readLooks(json) {
  let parsed = null;
  try {
    parsed = typeof json === 'string' ? JSON.parse(json) : json;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of parsed) {
    const look = normalizeLook(raw);
    if (!look || seen.has(look.id)) continue;
    seen.add(look.id);
    out.push(look);
    if (out.length >= MAX_LOOKS) break;
  }
  return out;
}

/**
 * Add one, newest first.
 *
 * Saving under a name you already used REPLACES that look rather than leaving
 * you two tiles with one label and no way to tell them apart — "save" on a
 * name you recognise is how everything else in the app behaves, and the
 * alternative is an error message for something that is not a mistake.
 * Case- and space-insensitive, because "Night" and "night " are the same
 * answer to "what shall I call it".
 */
export function addLook(list, entry) {
  const name = cleanName(entry?.name);
  if (!name) return Array.isArray(list) ? list : [];
  const id = String(entry?.id == null ? '' : entry.id).trim();
  if (!id) return Array.isArray(list) ? list : [];
  const key = name.toLowerCase();
  const rest = (Array.isArray(list) ? list : []).filter((l) => l.name.toLowerCase() !== key);
  const fresh = normalizeLook({ ...entry, id, name });
  if (!fresh) return rest;
  return [fresh, ...rest].slice(0, MAX_LOOKS);
}

/** Drop one. */
export function removeLook(list, id) {
  const want = String(id);
  return (Array.isArray(list) ? list : []).filter((l) => String(l.id) !== want);
}

/**
 * Rename one. A name already in use by ANOTHER look is refused — here a
 * collision really is a mistake, because unlike saving there is no "you meant
 * to overwrite it" reading of it.
 */
export function renameLook(list, id, raw) {
  const name = cleanName(raw);
  const all = Array.isArray(list) ? list : [];
  if (!name) return all;
  const want = String(id);
  const key = name.toLowerCase();
  if (all.some((l) => String(l.id) !== want && l.name.toLowerCase() === key)) return all;
  return all.map((l) => (String(l.id) === want ? { ...l, name } : l));
}

/** The fields that decide whether two looks are the same look. */
const FIELDS = ['indicator', 'style', 'color', 'ink', 'inkColor', 'glow', 'glowColor', 'accent', 'themeKey'];

/**
 * Is this look what the dock is wearing right now?
 *
 * Compared field by field rather than by a stored "current" id, for the same
 * reason a palette is: the moment you nudge the glow, you are no longer
 * wearing the thing you saved, and a tile that stayed ticked through that
 * would be lying. Nothing has to be cleared when a setting changes, because
 * nothing was remembered.
 */
export function isWearing(look, settings) {
  if (!look) return false;
  const now = captureLook(settings);
  return FIELDS.every((f) => look[f] === now[f]);
}

/** Which saved look is on, if any. */
export function wornLook(list, settings) {
  return (Array.isArray(list) ? list : []).find((l) => isWearing(l, settings)) || null;
}

/**
 * A fresh id.
 *
 * The clock plus a counter: two looks saved in the same millisecond (a double
 * tap, a test) must not collide, and `readLooks` drops the second of any two
 * entries sharing an id — so a collision here would silently eat a look.
 */
let seq = 0;
export function newLookId() {
  seq += 1;
  return `look-${Date.now().toString(36)}-${seq.toString(36)}`;
}

export default {
  MAX_LOOKS, NAME_MAX, cleanName, captureLook, normalizeLook, readLooks,
  addLook, removeLook, renameLook, isWearing, wornLook, newLookId,
};
