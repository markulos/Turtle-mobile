import React from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useTheme } from '../../../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

export const SearchBar = ({ value, onChangeText, onClear, onLock }) => {
  const { theme } = useTheme();
  const styles = createStyles(theme);

  return (
    <View style={styles.container}>
      <View style={styles.searchContainer}>
        <Icon name="magnify" size={20} color={theme.colors.textTertiary} />
        <TextInput
          style={styles.input}
          placeholder="Search passwords..."
          placeholderTextColor={theme.colors.textPlaceholder}
          value={value}
          onChangeText={onChangeText}
        />
        {value ? (
          <TouchableOpacity onPress={onClear}>
            <Icon name="close-circle" size={20} color={theme.colors.textTertiary} />
          </TouchableOpacity>
        ) : null}
      </View>
      <TouchableOpacity style={styles.lockBtn} onPress={onLock}>
        <Icon name="lock" size={22} color={theme.colors.textPrimary} />
      </TouchableOpacity>
    </View>
  );
};

const createStyles = (theme) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    searchContainer: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.colors.inputBackground,
      borderRadius: 8,
      paddingHorizontal: 12,
      height: 40,
    },
    input: {
      flex: 1,
      marginLeft: 8,
      fontSize: 15,
      color: theme.colors.inputText,
    },
    lockBtn: {
      marginLeft: 12,
      padding: 8,
    },
  });
