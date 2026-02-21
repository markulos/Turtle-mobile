import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export const FormField = ({ label, children }) => (
  <View style={styles.container}>
    <Text style={styles.label}>{label}</Text>
    {children}
  </View>
);

const styles = StyleSheet.create({
  container: { marginBottom: 10 },
  label: { fontSize: 14, fontWeight: '600', color: '#666', marginBottom: 8 },
});