import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const THEME_STORAGE_KEY = '@connected_pass_theme';
const TIME_FORMAT_STORAGE_KEY = '@connected_pass_time_format';
const HIDE_VAULT_BUTTON_KEY = '@connected_pass_hide_vault_button';
const CALENDAR_DAY_TASKS_KEY = '@connected_pass_calendar_day_tasks';
const CALENDAR_FREE_SCROLL_KEY = '@connected_pass_calendar_free_scroll';
const ACCENT_KEY = '@connected_pass_accent';

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
  { key: 'amber', label: 'Amber', color: '#F59E0B' },
  { key: 'teal', label: 'Teal', color: '#14B8A6' },
  { key: 'red', label: 'Red', color: '#EF4444' },
];
export const DEFAULT_ACCENT = 'orange';
const accentColorFor = (key) =>
  (ACCENTS.find((a) => a.key === key) || ACCENTS[0]).color;

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
const DARK_THEME = {
  mode: 'dark',
  colors: {
    // Backgrounds - Pure black with subtle gradients
    background: '#000000',            // Pure black
    surface: '#0A0A0A',               // Slightly lighter black
    surfaceElevated: '#111111',       // Elevated cards
    surfaceHighlight: '#1A1A1A',      // Highlight/selection
    
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
    
    // Borders - Very subtle
    border: 'rgba(255, 255, 255, 0.08)',
    borderStrong: 'rgba(255, 255, 255, 0.15)',
    
    // Overlays
    overlay: 'rgba(0, 0, 0, 0.9)',
    overlayLight: 'rgba(0, 0, 0, 0.7)',
    
    // Input specific - Dark grey background, light grey text
    inputBackground: '#0D0D0D',
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

// Light theme - Black text on white (inverse)
const LIGHT_THEME = {
  mode: 'light',
  colors: {
    background: '#FFFFFF',
    surface: '#F5F5F5',
    surfaceElevated: '#EEEEEE',
    surfaceHighlight: '#E0E0E0',
    
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
    
    inputBackground: '#F5F5F5',
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

const ThemeContext = createContext({
  theme: DARK_THEME,
  isDark: true,
  toggleTheme: () => {},
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
});

export const ThemeProvider = ({ children }) => {
  const [isDark, setIsDark] = useState(true);
  const [timeFormat, setTimeFormatState] = useState('12h');
  const [hideVaultButton, setHideVaultButtonState] = useState(false);
  const [showCalendarDayTasks, setShowCalendarDayTasksState] = useState(false);
  const [calendarFreeScroll, setCalendarFreeScrollState] = useState(false);
  const [accent, setAccentState] = useState(DEFAULT_ACCENT);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadTheme();
  }, []);

  const loadTheme = async () => {
    try {
      const savedTheme = await AsyncStorage.getItem(THEME_STORAGE_KEY);
      if (savedTheme !== null) {
        setIsDark(savedTheme === 'dark');
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
      const savedAccent = await AsyncStorage.getItem(ACCENT_KEY);
      if (savedAccent && ACCENTS.some((a) => a.key === savedAccent)) {
        setAccentState(savedAccent);
      }
      const savedFreeScroll = await AsyncStorage.getItem(CALENDAR_FREE_SCROLL_KEY);
      if (savedFreeScroll !== null) {
        setCalendarFreeScrollState(savedFreeScroll === 'true');
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
    const next = ACCENTS.some((a) => a.key === key) ? key : DEFAULT_ACCENT;
    setAccentState(next);
    try {
      await AsyncStorage.setItem(ACCENT_KEY, next);
    } catch (error) {
      console.error('Error saving accent:', error);
    }
  };

  const toggleTheme = async () => {
    const newIsDark = !isDark;
    setIsDark(newIsDark);
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, newIsDark ? 'dark' : 'light');
    } catch (error) {
      console.error('Error saving theme:', error);
    }
  };

  // The chosen accent is folded into the palette here, once, so every consumer
  // of useTheme() picks it up with no change at the call site.
  const accentColor = accentColorFor(accent);
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
    },
  }), [baseTheme, accentColor, isDark]);

  // Memoize the context value so consumers only re-render when something they
  // actually read changes. Without this, a fresh object literal every render
  // would re-render every screen on any provider re-render. toggleTheme /
  // setTimeFormat are stable-enough closures; the meaningful deps are the
  // values they expose.
  const value = useMemo(
    () => ({
      theme, isDark, toggleTheme, timeFormat, setTimeFormat,
      accent, setAccent, accentColor,
      hideVaultButton, setHideVaultButton,
      showCalendarDayTasks, setShowCalendarDayTasks,
      calendarFreeScroll, setCalendarFreeScroll,
    }),
    [theme, isDark, timeFormat, hideVaultButton, showCalendarDayTasks, calendarFreeScroll, accent, accentColor],
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
