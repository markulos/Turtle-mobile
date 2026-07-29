import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../../context/ThemeContext';

export const FormField = ({ label, children }) => {
  const { theme } = useTheme();
  const styles = createStyles(theme);
  
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
};

const createStyles = (theme) => StyleSheet.create({
  container: { marginBottom: 14 },
  // Quiet metadata label — small, uppercase, tracked, muted — so the field's
  // VALUE (input text / chips) reads as primary and the label recedes. (Was
  // body-size weight-600, which competed with the value for attention.)
  label: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: theme.colors.textTertiary,
    marginBottom: 8,
  },
});