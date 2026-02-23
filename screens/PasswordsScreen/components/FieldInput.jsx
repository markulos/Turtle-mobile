import React, { useState, useMemo, useRef } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
  FlatList,
} from 'react-native';
import { useTheme } from '../../../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

// Extract all unique field labels from all entries
const extractFieldLabels = (entries) => {
  const labels = new Set();
  if (!entries || !Array.isArray(entries)) return [];
  
  entries.forEach(entry => {
    if (entry.lines && Array.isArray(entry.lines)) {
      entry.lines.forEach(line => {
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
          const label = line.substring(0, colonIndex).trim().toLowerCase();
          if (label) labels.add(label);
        }
      });
    }
  });
  
  return Array.from(labels).sort();
};

// Common field labels as defaults
const COMMON_FIELDS = [
  'username',
  'password',
  'email',
  'url',
  'website',
  'note',
  'pin',
  'api key',
  'token',
  'account',
];

export const FieldInput = ({ 
  value, 
  onChangeText, 
  onSubmit, 
  entries,
  placeholder = "field: content"
}) => {
  const { theme } = useTheme();
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef(null);
  const styles = createStyles(theme);

  // Get current field being typed (before colon)
  const currentField = useMemo(() => {
    const colonIndex = value.indexOf(':');
    if (colonIndex === -1) return value.toLowerCase().trim();
    return value.substring(0, colonIndex).toLowerCase().trim();
  }, [value]);

  // Check if we should show suggestions
  const shouldShowSuggestions = useMemo(() => {
    const colonIndex = value.indexOf(':');
    // Only show if no colon yet, or cursor is before colon
    if (colonIndex !== -1 && value.length > colonIndex) return false;
    return currentField.length > 0;
  }, [value, currentField]);

  // Get suggestions based on current field
  const suggestions = useMemo(() => {
    const entryLabels = extractFieldLabels(entries);
    const allLabels = [...new Set([...COMMON_FIELDS, ...entryLabels])];
    
    if (!currentField) return [];
    
    return allLabels
      .filter(label => label.includes(currentField) && label !== currentField)
      .slice(0, 5); // Max 5 suggestions
  }, [currentField, entries]);

  const handleSelectSuggestion = (suggestion) => {
    const colonIndex = value.indexOf(':');
    if (colonIndex === -1) {
      onChangeText(`${suggestion}: `);
    } else {
      const afterColon = value.substring(colonIndex);
      onChangeText(`${suggestion}${afterColon}`);
    }
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const handleChangeText = (text) => {
    onChangeText(text);
    const colonIndex = text.indexOf(':');
    const field = colonIndex === -1 ? text : text.substring(0, colonIndex);
    setShowSuggestions(field.trim().length > 0 && suggestions.length > 0);
  };

  const handleSubmitEditing = () => {
    setShowSuggestions(false);
    onSubmit?.();
  };

  const renderSuggestion = ({ item }) => (
    <TouchableOpacity 
      style={styles.suggestionItem}
      onPress={() => handleSelectSuggestion(item)}
    >
      <Icon name="text-short" size={14} color={theme.colors.textMuted} />
      <Text style={styles.suggestionText}>{item}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <TextInput
        ref={inputRef}
        style={styles.input}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textPlaceholder}
        value={value}
        onChangeText={handleChangeText}
        onSubmitEditing={handleSubmitEditing}
        onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
        onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {showSuggestions && suggestions.length > 0 && (
        <View style={styles.suggestionsContainer}>
          <FlatList
            data={suggestions}
            keyExtractor={(item) => item}
            renderItem={renderSuggestion}
            keyboardShouldPersistTaps="handled"
            scrollEnabled={false}
          />
        </View>
      )}
    </View>
  );
};

const createStyles = (theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      position: 'relative',
    },
    input: {
      flex: 1,
      fontSize: 14,
      color: theme.colors.inputText,
      backgroundColor: theme.colors.inputBackground,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 8,
    },
    suggestionsContainer: {
      position: 'absolute',
      top: '100%',
      left: 0,
      right: 0,
      backgroundColor: theme.colors.surfaceElevated,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
      marginTop: 4,
      zIndex: 1000,
      elevation: 5,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.3,
      shadowRadius: 4,
    },
    suggestionItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    suggestionText: {
      fontSize: 14,
      color: theme.colors.textPrimary,
      marginLeft: 8,
      textTransform: 'capitalize',
    },
  });
