import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const THEME_STORAGE_KEY = '@connected_pass_theme';

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
    
    // Text - White on black
    textPrimary: '#FFFFFF',           // Pure white
    textSecondary: 'rgba(255, 255, 255, 0.7)',
    textTertiary: 'rgba(255, 255, 255, 0.5)',
    textMuted: 'rgba(255, 255, 255, 0.3)',
    textPlaceholder: 'rgba(255, 255, 255, 0.4)',
    
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
    
    // Input specific - Black background, white text
    inputBackground: '#000000',
    inputText: '#FFFFFF',
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
    
    inputBackground: '#000000',
    inputText: '#FFFFFF',
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
});

export const ThemeProvider = ({ children }) => {
  const [isDark, setIsDark] = useState(true);
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
    } catch (error) {
      console.error('Error loading theme:', error);
    } finally {
      setIsLoading(false);
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

  const theme = isDark ? DARK_THEME : LIGHT_THEME;

  if (isLoading) {
    return null;
  }

  return (
    <ThemeContext.Provider value={{ theme, isDark, toggleTheme }}>
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
