import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizeHex } from '../utils/accentColor';
import {
  DOCK_STYLES, DEFAULT_DOCK_STYLE, DEFAULT_DOCK_COLOR, DOCK_INKS, DEFAULT_DOCK_INK,
} from '../components/dockSkins';
import { isDockTheme } from '../components/dockThemes';

const THEME_STORAGE_KEY = '@connected_pass_theme';

/**
 * LIGHT, DARK, OR WHATEVER THE PHONE IS DOING.
 *
 * 'system' is the auto mode, and it is auto by DELEGATION — which is the
 * whole trick. iOS and Android already own this problem: they read the
 * ambient light sensor, they know the user's location and therefore the real
 * sunset where they are and on this date, and they expose the answer as one
 * value that updates live. Anything this app computed itself would be a worse
 * version of that:
 *
 *   • a light sensor needs a native module, which changes the OTA runtime
 *     fingerprint and so cannot ship over the air at all;
 *   • a clock-and-calendar schedule needs LATITUDE to know when dusk is in
 *     November, and asking for location permission to decide a colour is a
 *     bad trade — without it, "19:00" is dusk in one hemisphere and midday in
 *     the other.
 *
 * So: follow the system. It is the platform convention, it is what every
 * other app on the phone does, and it is the one implementation that is
 * already right on the first evening in a new timezone.
 *
 * Stored in the SAME key the old boolean used, which still reads correctly —
 * 'dark' and 'light' were always the two values written there.
 */
export const THEME_MODES = ['system', 'light', 'dark'];
export const DEFAULT_THEME_MODE = 'dark';
const TIME_FORMAT_STORAGE_KEY = '@connected_pass_time_format';
const HIDE_VAULT_BUTTON_KEY = '@connected_pass_hide_vault_button';
const CALENDAR_DAY_TASKS_KEY = '@connected_pass_calendar_day_tasks';
const CALENDAR_FREE_SCROLL_KEY = '@connected_pass_calendar_free_scroll';
const ACCENT_KEY = '@connected_pass_accent';
const CUSTOM_ACCENT_KEY = '@connected_pass_accent_custom';
const DOCK_INDICATOR_KEY = '@connected_pass_dock_indicator';
const DOCK_STYLE_KEY = '@connected_pass_dock_style';
const DOCK_COLOR_KEY = '@connected_pass_dock_color';
const DOCK_INK_KEY = '@connected_pass_dock_ink';
const DOCK_THEME_KEY = '@connected_pass_dock_theme';

/**
 * How the dock marks the tab you are on: the filled accent CHIP behind the
 * glyph, or a thin accent LINE under it. Stored as a word rather than a boolean
 * because this is a choice between two treatments, and a third ("none", a dot)
 * is the obvious next request.
 */
export const DOCK_INDICATORS = ['chip', 'underline'];
export const DEFAULT_DOCK_INDICATOR = 'chip';

/**
 * The app-wide highlight colour, chosen in Settings.
 *
 * It lands on `theme.colors.accent` — the token new surfaces should reach for —
 * and ALSO overrides `accentInfo`, which is what the existing screens already
 * use for links, active chips and affirmative actions. That override is what
 * makes the choice permeate without editing every screen.
 *
 * `primary` is deliberately NOT overridden: in this theme it is the
 * foreground/contrast colour (white on dark, black on light) and dozens of
 * components pair it with `onPrimary` for filled controls. Repointing it at an
 * accent would put orange text on orange fills.
 */
export const ACCENTS = [
  { key: 'orange', label: 'Orange', color: '#F97316' },
  { key: 'blue', label: 'Blue', color: '#3B82F6' },
  { key: 'green', label: 'Green', color: '#22C55E' },
  { key: 'violet', label: 'Violet', color: '#8B5CF6' },
  { key: 'pink', label: 'Pink', color: '#EC4899' },
  { key: 'lightPink', label: 'Light pink', color: '#F9A8D4' },
  { key: 'amber', label: 'Amber', color: '#F59E0B' },
  { key: 'teal', label: 'Teal', color: '#14B8A6' },
  { key: 'red', label: 'Red', color: '#EF4444' },
];
export const DEFAULT_ACCENT = 'orange';

/**
 * The tenth swatch: whatever the user mixed for themselves.
 *
 * Kept OUT of ACCENTS rather than pushed onto it as a tenth entry, because that
 * list is a constant — every screen that maps over it would then have to know
 * that one of its colours is state, and the swatch row's "pick this" would
 * become "pick this, unless it's the last one, in which case open a sheet".
 */
export const CUSTOM_ACCENT = 'custom';

const accentColorFor = (key, customColor) => {
  if (key === CUSTOM_ACCENT) return customColor || ACCENTS[0].color;
  return (ACCENTS.find((a) => a.key === key) || ACCENTS[0]).color;
};

/**
 * '#F97316' + alpha → 'rgba(249, 115, 22, a)'.
 *
 * Written out rather than appending a hex alpha suffix to the token: the
 * palette below is a MIX of hex and rgba() strings, and '#RRGGBB' + 'AA' only
 * works for the former — the rgba ones would silently produce an invalid colour
 * (and invalid colours in RN render as nothing, which is hard to spot).
 */
const withAlpha = (hex, alpha) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return hex;
  const int = parseInt(m[1], 16);
  return `rgba(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}, ${alpha})`;
};

// Golden Ratio - 1.618
const PHI = 1.618;

// Base spacing unit
const BASE_UNIT = 8;

// Generate spacing scale using golden ratio
const generateSpacing = () => {
  const spacing = { base: BASE_UNIT };
  let current = BASE_UNIT;
  
  // Generate increasing sizes: xs, sm, md, lg, xl, xxl, xxxl
  ['xs', 'sm', 'md', 'lg', 'xl', 'xxl', 'xxxl'].forEach((size) => {
    spacing[size] = Math.round(current);
    current = current * PHI;
  });
  
  return spacing;
};

const SPACING = generateSpacing();

// Typography scale using golden ratio
const generateTypography = () => {
  const baseSize = 16;
  return {
    caption: Math.round(baseSize / (PHI * PHI)),      // ~6
    small: Math.round(baseSize / PHI),                 // ~10
    body: baseSize,                                    // 16
    subtitle: Math.round(baseSize * PHI),              // ~26
    title: Math.round(baseSize * PHI * PHI),           // ~42
    headline: Math.round(baseSize * PHI * PHI * PHI),  // ~68
  };
};

const TYPOGRAPHY = generateTypography();

// Pure Black Theme - White text on black background
//
// Exported because a few surfaces are their OWN dark room whatever the app
// theme is (the calendar's Task Schedule sheet: a frosted grey pane the
// calendar reads through). They build a palette from this one rather than
// hand-rolling a second set of dark tokens that would drift from it.
export const DARK_THEME = {
  mode: 'dark',
  colors: {
    // Backgrounds — a pure-black page carrying WARM, PALER surfaces.
    //
    // They were near-black (#0A0A0A / #111111) and separated from the page by
    // a hairline, which is a wireframe: the eye finds the outline first and
    // the surface second. The weight moved to the fill — each rung is lighter
    // than it was and carries a few points of warmth (red highest, blue
    // lowest), because neutral charcoal on a pure-black OLED page reads as an
    // absence of colour rather than as a lit surface. The same move the task
    // cards made; see screens/TasksScreen/utils/cardPalette for the full note.
    //
    // The PAGE stays pure black. It is the thing everything else is measured
    // against, and warming it would just make the whole app beige.
    background: '#000000',            // Pure black
    surface: '#141110',               // A warm step off the page
    surfaceElevated: '#1C1817',       // Elevated cards
    surfaceHighlight: '#262120',      // Highlight/selection
    
    // Primary - White for contrast on black
    primary: '#FFFFFF',               // White
    primaryLight: '#FFFFFF',
    primaryDark: '#CCCCCC',
    primaryMuted: 'rgba(255, 255, 255, 0.1)',
    
    // Text - Light grey on black for readability
    textPrimary: '#E0E0E0',           // Light grey (not pure white)
    textSecondary: 'rgba(255, 255, 255, 0.6)',
    textTertiary: 'rgba(255, 255, 255, 0.45)',
    textMuted: 'rgba(255, 255, 255, 0.3)',
    textPlaceholder: 'rgba(255, 255, 255, 0.55)',
    
    // Accents
    accentSuccess: '#4ADE80',
    accentWarning: '#FBBF24',
    accentError: '#F87171',
    accentInfo: '#60A5FA',
    
    // Borders — FADED, now that the surfaces carry the separation themselves.
    // A hairline is for holding a corner where two panels meet, not for
    // drawing the panel. `borderStrong` is kept for the few places that are
    // genuinely a rule (a divider between rows), and dropped with it.
    border: 'rgba(255, 255, 255, 0.035)',
    borderStrong: 'rgba(255, 255, 255, 0.09)',
    
    // Overlays
    overlay: 'rgba(0, 0, 0, 0.9)',
    overlayLight: 'rgba(0, 0, 0, 0.7)',
    
    // Input specific - Dark grey background, light grey text
    inputBackground: '#171413',
    inputText: '#E0E0E0',
  },
  spacing: SPACING,
  typography: TYPOGRAPHY,
  borderRadius: {
    sm: 4,
    md: 8,
    lg: 12,
    xl: 16,
    pill: 100,
  },
  shadows: {
    sm: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.5,
      shadowRadius: 2,
      elevation: 2,
    },
    md: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.6,
      shadowRadius: 4,
      elevation: 4,
    },
    lg: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.7,
      shadowRadius: 8,
      elevation: 8,
    },
  },
};

/**
 * Light theme — black text on an OFF-WHITE page.
 *
 * Not #FFFFFF. A pure-white page is a lightbox: it is the brightest thing the
 * screen can make, so every surface on it can only ever be darker, and the eye
 * has nowhere to rest. A warm off-white is paper — it sits below the whites it
 * carries, which is what lets a card read as a card rather than as a rectangle
 * of hairline.
 *
 * WARM, and by a little: the hue is a couple of points of red and green over
 * blue, which is not a colour anyone can name but is the difference between
 * "paper" and "grey". Push it further and the page reads as a tint someone
 * chose rather than as the absence of one.
 *
 * HOW MUCH WARM IS A BLUE DEFICIT, and it is the only number that matters
 * here: the gap between blue and the red/green above it IS the yellow. At six
 * points it read as cream; at four it reads as paper.
 *
 * ONE RULE FOR THE WHOLE RAMP — green two below red, blue five below it — so
 * every rung carries the SAME deficit as the tone descends. Tuned rung by rung
 * it drifted (3, 4, 5, 7 from the page down), which is a ramp changing hue as
 * it gets deeper, and the eye reads that as two different papers rather than
 * as one with shadows on it. A test pins the spread, because that drift is
 * invisible in any single screenshot.
 *
 * THE RAMP KEEPS ITS DIRECTION. Surfaces still step DOWN from the page, the
 * same relationship the whole light theme is built on (docs/STYLE-RULES.md §1,
 * and every `depth()` shadow tuned against it) — re-based warm, and with the
 * same distance between the rungs. Inverting it, so the page is the darkest
 * thing and cards are white, is a different design system; it would land on
 * every surface in the app at once and none of the shadows would be right for
 * it any more.
 */
const LIGHT_THEME = {
  mode: 'light',
  colors: {
    background: '#F5F3F0',
    surface: '#EEECE9',
    surfaceElevated: '#E7E5E2',
    surfaceHighlight: '#DCDAD7',
    
    primary: '#000000',
    primaryLight: '#333333',
    primaryDark: '#000000',
    primaryMuted: 'rgba(0, 0, 0, 0.1)',
    
    textPrimary: '#000000',
    textSecondary: 'rgba(0, 0, 0, 0.7)',
    textTertiary: 'rgba(0, 0, 0, 0.5)',
    textMuted: 'rgba(0, 0, 0, 0.3)',
    textPlaceholder: 'rgba(0, 0, 0, 0.4)',
    
    accentSuccess: '#22C55E',
    accentWarning: '#F59E0B',
    accentError: '#EF4444',
    accentInfo: '#3B82F6',
    
    border: 'rgba(0, 0, 0, 0.1)',
    borderStrong: 'rgba(0, 0, 0, 0.2)',
    
    overlay: 'rgba(0, 0, 0, 0.5)',
    overlayLight: 'rgba(0, 0, 0, 0.3)',
    
    inputBackground: '#EEECE9',
    inputText: '#000000',
  },
  spacing: SPACING,
  typography: TYPOGRAPHY,
  borderRadius: {
    sm: 4,
    md: 8,
    lg: 12,
    xl: 16,
    pill: 100,
  },
  shadows: {
    sm: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.1,
      shadowRadius: 2,
      elevation: 2,
    },
    md: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.15,
      shadowRadius: 4,
      elevation: 4,
    },
    lg: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.2,
      shadowRadius: 8,
      elevation: 8,
    },
  },
};

/**
 * The light palette on its own, so its relationships can be tested without
 * rendering a tree: the warmth, and that each rung steps down from the last.
 */
export const LIGHT_THEME_COLORS = LIGHT_THEME.colors;

const ThemeContext = createContext({
  theme: DARK_THEME,
  isDark: true,
  toggleTheme: () => {},
  // 'system' (follow the phone), or 'light' / 'dark' pinned by hand. `isDark`
  // is the ANSWER; this is the question. See THEME_MODES.
  themeMode: DEFAULT_THEME_MODE,
  setThemeMode: () => {},
  timeFormat: '12h', // '12h' (AM/PM, default) | '24h'
  setTimeFormat: () => {},
  // When true, the Vault tab is hidden from the bottom navbar; the vault is
  // then reachable only via the /vault command in chat / terminal.
  hideVaultButton: false,
  setHideVaultButton: () => {},
  // When true, each calendar day cell lists its tasks in small text (iOS
  // Calendar style) instead of the compact project dots. Defaults to dots
  // (false) so the grid stays uncluttered until the user opts in.
  showCalendarDayTasks: false,
  setShowCalendarDayTasks: () => {},
  // Calendar scroll style. false (default) = paged: the month list snaps one
  // whole month per swipe. true = free-form continuous scroll (iOS Calendar
  // style) where months flow past without snapping to a boundary.
  calendarFreeScroll: false,
  setCalendarFreeScroll: () => {},
  // 'chip' (the filled accent square behind the active glyph) | 'underline'
  // (a thin accent line under it). See DOCK_INDICATORS.
  dockIndicator: DEFAULT_DOCK_INDICATOR,
  setDockIndicator: () => {},
  // What the capsule is MADE of: 'smoked' (the near-black frosted default) or
  // 'paper' (white, flat, a hairline edge). Every colour each one implies
  // lives in components/dockSkins.
  dockStyle: DEFAULT_DOCK_STYLE,
  setDockStyle: () => {},
  // The colour behind the 'custom' skin, '#RRGGBB'. Remembered even while
  // another skin is selected, so the custom tile still previews what it was.
  dockColor: DEFAULT_DOCK_COLOR,
  setDockColor: () => {},
  // The ink on the ACTIVE tab's glyph: 'auto' reads the accent, 'light' and
  // 'dark' are the manual override. See DOCK_INKS.
  dockInk: DEFAULT_DOCK_INK,
  setDockInk: () => {},
  // A named theme's key ('godzilla'), or '' for none. Stored because a
  // theme's skin overrides are not recoverable from the settings above —
  // see components/dockThemes.
  dockTheme: '',
  setDockTheme: () => {},
  // The highlight colour: one of ACCENTS' keys, or CUSTOM_ACCENT for a colour
  // the user mixed themselves (`customAccent`, a '#RRGGBB').
  accent: DEFAULT_ACCENT,
  setAccent: () => {},
  accentColor: ACCENTS[0].color,
  customAccent: null,
  setCustomAccent: () => {},
});

export const ThemeProvider = ({ children }) => {
  const [themeMode, setThemeModeState] = useState(DEFAULT_THEME_MODE);
  // Live: the OS pushes a new value the moment it flips, so 'system' follows
  // sunset without this app owning a timer or a subscription.
  const systemScheme = useColorScheme();
  // The one derivation. Every consumer still reads `isDark` and knows nothing
  // about modes — which is why adding the auto mode touched no screen.
  // A system that reports nothing (older Android, a simulator mid-launch)
  // falls back to the app's own default rather than to light.
  const isDark = themeMode === 'system'
    ? (systemScheme ? systemScheme === 'dark' : DEFAULT_THEME_MODE === 'dark')
    : themeMode === 'dark';
  const [timeFormat, setTimeFormatState] = useState('12h');
  // Defaults to HIDDEN now: the vault's entry point is the Profile tab's card,
  // and the /vault chat command still works as the secondary route. Keeping the
  // setting (rather than deleting the Tab.Screen) means the dock's tab-count
  // geometry is already wired for it, and anyone who wants the tab back can
  // still switch it on. Not persisted, so the new default applies to everyone.
  const [hideVaultButton, setHideVaultButtonState] = useState(true);
  const [showCalendarDayTasks, setShowCalendarDayTasksState] = useState(false);
  const [calendarFreeScroll, setCalendarFreeScrollState] = useState(false);
  const [dockIndicator, setDockIndicatorState] = useState(DEFAULT_DOCK_INDICATOR);
  const [dockStyle, setDockStyleState] = useState(DEFAULT_DOCK_STYLE);
  const [dockColor, setDockColorState] = useState(DEFAULT_DOCK_COLOR);
  const [dockInk, setDockInkState] = useState(DEFAULT_DOCK_INK);
  const [dockTheme, setDockThemeState] = useState('');
  const [accent, setAccentState] = useState(DEFAULT_ACCENT);
  // The user's own colour, '#RRGGBB', or null if they have never mixed one.
  // Remembered even while a preset is selected, so the custom swatch still
  // shows what it was the last time they opened it.
  const [customAccent, setCustomAccentState] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadTheme();
  }, []);

  const loadTheme = async () => {
    try {
      const savedTheme = await AsyncStorage.getItem(THEME_STORAGE_KEY);
      if (THEME_MODES.includes(savedTheme)) {
        setThemeModeState(savedTheme);
      }
      const savedFmt = await AsyncStorage.getItem(TIME_FORMAT_STORAGE_KEY);
      if (savedFmt === '24h' || savedFmt === '12h') {
        setTimeFormatState(savedFmt);
      }
      const savedHideVault = await AsyncStorage.getItem(HIDE_VAULT_BUTTON_KEY);
      if (savedHideVault !== null) {
        setHideVaultButtonState(savedHideVault === 'true');
      }
      const savedDayTasks = await AsyncStorage.getItem(CALENDAR_DAY_TASKS_KEY);
      if (savedDayTasks !== null) {
        setShowCalendarDayTasksState(savedDayTasks === 'true');
      }
      // The custom colour is read FIRST: 'custom' is only a legal accent if
      // there is actually a colour behind it, and a stored key with no colour
      // (a half-written pair, an older install) has to fall back to a preset
      // rather than to whatever accentColorFor guesses.
      const savedCustom = normalizeHex(await AsyncStorage.getItem(CUSTOM_ACCENT_KEY));
      if (savedCustom) {
        setCustomAccentState(savedCustom);
      }
      const savedAccent = await AsyncStorage.getItem(ACCENT_KEY);
      const accentIsReal = savedAccent === CUSTOM_ACCENT
        ? !!savedCustom
        : ACCENTS.some((a) => a.key === savedAccent);
      if (savedAccent && accentIsReal) {
        setAccentState(savedAccent);
      }
      const savedFreeScroll = await AsyncStorage.getItem(CALENDAR_FREE_SCROLL_KEY);
      if (savedFreeScroll !== null) {
        setCalendarFreeScrollState(savedFreeScroll === 'true');
      }
      // Checked against the list rather than trusted: a word from storage that
      // is no longer a treatment we draw would leave the dock with no
      // indicator at all.
      const savedDock = await AsyncStorage.getItem(DOCK_INDICATOR_KEY);
      if (DOCK_INDICATORS.includes(savedDock)) {
        setDockIndicatorState(savedDock);
      }
      // Same guard, same reason: a skin that no longer exists must fall back
      // to one that does rather than leave the dock unpainted.
      const savedSkin = await AsyncStorage.getItem(DOCK_STYLE_KEY);
      if (DOCK_STYLES.includes(savedSkin)) {
        setDockStyleState(savedSkin);
      }
      // Validated as a colour, not trusted as a string: the dock paints this
      // directly, and 'undefined' as a fill is an invisible nav bar.
      const savedDockColor = normalizeHex(await AsyncStorage.getItem(DOCK_COLOR_KEY));
      if (savedDockColor) {
        setDockColorState(savedDockColor);
      }
      const savedInk = await AsyncStorage.getItem(DOCK_INK_KEY);
      if (DOCK_INKS.includes(savedInk)) {
        setDockInkState(savedInk);
      }
      // Checked against what we still ship: a theme dropped in a later build
      // must fall back to the ordinary settings rather than leave the dock
      // asking for a skin nobody can paint.
      const savedDockTheme = await AsyncStorage.getItem(DOCK_THEME_KEY);
      if (isDockTheme(savedDockTheme)) {
        setDockThemeState(savedDockTheme);
      }
    } catch (error) {
      console.error('Error loading theme:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const setTimeFormat = async (fmt) => {
    const next = fmt === '24h' ? '24h' : '12h';
    setTimeFormatState(next);
    try {
      await AsyncStorage.setItem(TIME_FORMAT_STORAGE_KEY, next);
    } catch (error) {
      console.error('Error saving time format:', error);
    }
  };

  const setHideVaultButton = async (hide) => {
    const next = !!hide;
    setHideVaultButtonState(next);
    try {
      await AsyncStorage.setItem(HIDE_VAULT_BUTTON_KEY, next ? 'true' : 'false');
    } catch (error) {
      console.error('Error saving hide-vault-button setting:', error);
    }
  };

  const setDockIndicator = async (kind) => {
    const next = DOCK_INDICATORS.includes(kind) ? kind : DEFAULT_DOCK_INDICATOR;
    setDockIndicatorState(next);
    try {
      await AsyncStorage.setItem(DOCK_INDICATOR_KEY, next);
    } catch (error) {
      console.error('Error saving dock-indicator setting:', error);
    }
  };

  const setDockStyle = async (kind) => {
    const next = DOCK_STYLES.includes(kind) ? kind : DEFAULT_DOCK_STYLE;
    setDockStyleState(next);
    try {
      await AsyncStorage.setItem(DOCK_STYLE_KEY, next);
    } catch (error) {
      console.error('Error saving dock-style setting:', error);
    }
  };

  const setDockColor = async (hex) => {
    const next = normalizeHex(hex) || DEFAULT_DOCK_COLOR;
    setDockColorState(next);
    try {
      await AsyncStorage.setItem(DOCK_COLOR_KEY, next);
    } catch (error) {
      console.error('Error saving dock-colour setting:', error);
    }
  };

  const setDockInk = async (mode) => {
    const next = DOCK_INKS.includes(mode) ? mode : DEFAULT_DOCK_INK;
    setDockInkState(next);
    try {
      await AsyncStorage.setItem(DOCK_INK_KEY, next);
    } catch (error) {
      console.error('Error saving dock-ink setting:', error);
    }
  };

  const setDockTheme = async (key) => {
    const next = isDockTheme(key) ? key : '';
    setDockThemeState(next);
    try {
      await AsyncStorage.setItem(DOCK_THEME_KEY, next);
    } catch (error) {
      console.error('Error saving dock-theme setting:', error);
    }
  };

  const setShowCalendarDayTasks = async (show) => {
    const next = !!show;
    setShowCalendarDayTasksState(next);
    try {
      await AsyncStorage.setItem(CALENDAR_DAY_TASKS_KEY, next ? 'true' : 'false');
    } catch (error) {
      console.error('Error saving calendar-day-tasks setting:', error);
    }
  };

  const setCalendarFreeScroll = async (free) => {
    const next = !!free;
    setCalendarFreeScrollState(next);
    try {
      await AsyncStorage.setItem(CALENDAR_FREE_SCROLL_KEY, next ? 'true' : 'false');
    } catch (error) {
      console.error('Error saving calendar-free-scroll setting:', error);
    }
  };

  const setAccent = async (key) => {
    // 'custom' only holds if there is a colour behind it; asked for without
    // one, it falls back rather than leaving the app on a phantom accent.
    const legal = key === CUSTOM_ACCENT
      ? !!customAccent
      : ACCENTS.some((a) => a.key === key);
    const next = legal ? key : DEFAULT_ACCENT;
    setAccentState(next);
    try {
      await AsyncStorage.setItem(ACCENT_KEY, next);
    } catch (error) {
      console.error('Error saving accent:', error);
    }
  };

  /**
   * Take a colour the user mixed and select it in one move.
   *
   * One call, not "save the colour" + "now switch to it": nobody picks a colour
   * in order to not use it, and two calls means two await points where a crash
   * or a backgrounded app can leave the pair disagreeing.
   *
   * The COLOUR is written before the KEY, for the same reason — a failure
   * between them leaves the accent pointing at a preset, which is a wrong
   * colour, rather than at a 'custom' with nothing behind it, which is no
   * colour at all.
   */
  const setCustomAccent = async (hex) => {
    const next = normalizeHex(hex);
    if (!next) return null;
    setCustomAccentState(next);
    setAccentState(CUSTOM_ACCENT);
    try {
      await AsyncStorage.setItem(CUSTOM_ACCENT_KEY, next);
      await AsyncStorage.setItem(ACCENT_KEY, CUSTOM_ACCENT);
    } catch (error) {
      console.error('Error saving custom accent:', error);
    }
    return next;
  };

  const setThemeMode = async (mode) => {
    const next = THEME_MODES.includes(mode) ? mode : DEFAULT_THEME_MODE;
    setThemeModeState(next);
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, next);
    } catch (error) {
      console.error('Error saving theme mode:', error);
    }
  };

  /**
   * The old switch, still honoured: flipping it PINS the opposite of what you
   * are looking at. From 'system' that means leaving auto — which is right,
   * because the only reason to flip a switch you are watching is to disagree
   * with what it is showing you.
   */
  const toggleTheme = () => setThemeMode(isDark ? 'light' : 'dark');

  // The chosen accent is folded into the palette here, once, so every consumer
  // of useTheme() picks it up with no change at the call site.
  const accentColor = accentColorFor(accent, customAccent);
  const baseTheme = isDark ? DARK_THEME : LIGHT_THEME;
  const theme = useMemo(() => ({
    ...baseTheme,
    colors: {
      ...baseTheme.colors,
      accent: accentColor,
      // Existing screens already reach for accentInfo as "the highlight";
      // repointing it is what carries the choice across the app.
      accentInfo: accentColor,
      // Every RULE in the app takes a wash of the accent: the hairline over the
      // tab bar, card and input outlines, list separators, section dividers.
      // These two tokens are what the whole app already draws lines with, so
      // tinting them here is what makes the choice reach everywhere at once.
      //
      // The alphas are low on purpose — a line should read as "the accent is
      // in the room", not as a coloured border. They're a touch stronger on
      // light backgrounds, where a tint of the same alpha disappears.
      border: withAlpha(accentColor, isDark ? 0.22 : 0.28),
      borderStrong: withAlpha(accentColor, isDark ? 0.4 : 0.45),
      // The same token BEFORE the wash, for the one line that must not take it:
      // the groove (`insetRule` / `ridgeRule`). A tint reads as a tint on the
      // off-white page, but on pure black an accent at 0.22 is a warm brown
      // hairline — a coloured border, which is what the wash above is expressly
      // not meant to be. Everything else keeps the accent.
      borderNeutral: baseTheme.colors.border,
    },
  }), [baseTheme, accentColor, isDark]);

  // Memoize the context value so consumers only re-render when something they
  // actually read changes. Without this, a fresh object literal every render
  // would re-render every screen on any provider re-render. toggleTheme /
  // setTimeFormat are stable-enough closures; the meaningful deps are the
  // values they expose.
  const value = useMemo(
    () => ({
      theme, isDark, toggleTheme, themeMode, setThemeMode, timeFormat, setTimeFormat,
      accent, setAccent, accentColor, customAccent, setCustomAccent,
      // Exposed so useAccountAccent can wait for AsyncStorage before it
      // adopts the account's colour — reconciling first would be undone a
      // moment later by this phone's own stored answer.
      isLoading,
      hideVaultButton, setHideVaultButton,
      showCalendarDayTasks, setShowCalendarDayTasks,
      calendarFreeScroll, setCalendarFreeScroll,
      dockIndicator, setDockIndicator,
      dockStyle, setDockStyle, dockColor, setDockColor, dockInk, setDockInk,
      dockTheme, setDockTheme,
    }),
    [theme, isDark, themeMode, timeFormat, hideVaultButton, showCalendarDayTasks, calendarFreeScroll, dockIndicator, dockStyle, dockColor, dockInk, dockTheme, accent, accentColor, customAccent, isLoading],
  );

  if (isLoading) {
    return null;
  }

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);

// Helper to create themed styles
export const createThemedStyles = (stylesFn) => {
  return () => {
    const { theme } = useTheme();
    return stylesFn(theme);
  };
};
