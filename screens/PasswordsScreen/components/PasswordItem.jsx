import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useTheme } from '../../../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

export const PasswordItem = ({ item, onSave, onDelete }) => {
  const { theme } = useTheme();
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(item.title || '');
  const [lines, setLines] = useState(item.lines || []);
  const [newLine, setNewLine] = useState('');
  const styles = createStyles(theme);

  const handleSave = () => {
    onSave({ ...item, title, lines });
    setIsEditing(false);
  };

  const handleAddLine = () => {
    if (!newLine.trim()) return;
    setLines([...lines, newLine.trim()]);
    setNewLine('');
  };

  const handleRemoveLine = (index) => {
    setLines(lines.filter((_, i) => i !== index));
  };

  const parseLine = (line) => {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) return { label: '', value: line };
    return {
      label: line.substring(0, colonIndex).trim(),
      value: line.substring(colonIndex + 1).trim()
    };
  };

  if (isEditing) {
    return (
      <View style={styles.container}>
        <TextInput
          style={styles.titleInput}
          placeholder="Subject..."
          placeholderTextColor={theme.colors.textPlaceholder}
          value={title}
          onChangeText={setTitle}
        />
        
        {lines.map((line, index) => {
          const { label, value } = parseLine(line);
          return (
            <View key={index} style={styles.lineRow}>
              <Text style={styles.lineText}>
                <Text style={styles.label}>{label}</Text>
                {label ? ': ' : ''}
                <Text style={styles.value}>{value}</Text>
              </Text>
              <TouchableOpacity onPress={() => handleRemoveLine(index)}>
                <Icon name="close" size={18} color={theme.colors.accentError} />
              </TouchableOpacity>
            </View>
          );
        })}

        <View style={styles.addLineRow}>
          <TextInput
            style={styles.lineInput}
            placeholder="field: content"
            placeholderTextColor={theme.colors.textPlaceholder}
            value={newLine}
            onChangeText={setNewLine}
            onSubmitEditing={handleAddLine}
          />
          <TouchableOpacity style={styles.addBtn} onPress={handleAddLine}>
            <Icon name="plus" size={20} color={theme.colors.textPrimary} />
          </TouchableOpacity>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
            <Text style={styles.saveText}>Save</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setIsEditing(false)}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <TouchableOpacity style={styles.container} onPress={() => setIsEditing(true)}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {item.title || 'Untitled'}
        </Text>
        <TouchableOpacity onPress={() => onDelete(item.id)}>
          <Icon name="delete" size={20} color={theme.colors.accentError} />
        </TouchableOpacity>
      </View>
      
      {item.lines?.map((line, index) => {
        const { label, value } = parseLine(line);
        return (
          <View key={index} style={styles.lineRow}>
            {label ? (
              <>
                <Text style={styles.label}>{label}:</Text>
                <Text style={styles.value} numberOfLines={1}>{value}</Text>
              </>
            ) : (
              <Text style={styles.value}>{value}</Text>
            )}
          </View>
        );
      })}
    </TouchableOpacity>
  );
};

export const NewEntryForm = ({ onSave, onCancel }) => {
  const { theme } = useTheme();
  const [title, setTitle] = useState('');
  const [lines, setLines] = useState([]);
  const [newLine, setNewLine] = useState('');
  const styles = createStyles(theme);

  const handleAddLine = () => {
    if (!newLine.trim()) return;
    setLines([...lines, newLine.trim()]);
    setNewLine('');
  };

  const handleRemoveLine = (index) => {
    setLines(lines.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!title.trim()) return;
    const success = await onSave({
      id: Date.now().toString(),
      title: title.trim(),
      lines,
      createdAt: Date.now(),
    });
    
    // Clear fields after successful save
    if (success) {
      setTitle('');
      setLines([]);
      setNewLine('');
    }
  };

  const parseLine = (line) => {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) return { label: '', value: line };
    return {
      label: line.substring(0, colonIndex).trim(),
      value: line.substring(colonIndex + 1).trim()
    };
  };

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.titleInput}
        placeholder="Subject..."
        placeholderTextColor={theme.colors.textPlaceholder}
        value={title}
        onChangeText={setTitle}
        autoFocus
      />
      
      {lines.map((line, index) => {
        const { label, value } = parseLine(line);
        return (
          <View key={index} style={styles.lineRow}>
            <Text style={styles.lineText}>
              <Text style={styles.label}>{label}</Text>
              {label ? ': ' : ''}
              <Text style={styles.value}>{value}</Text>
            </Text>
            <TouchableOpacity onPress={() => handleRemoveLine(index)}>
              <Icon name="close" size={18} color={theme.colors.accentError} />
            </TouchableOpacity>
          </View>
        );
      })}

      <View style={styles.addLineRow}>
        <TextInput
          style={styles.lineInput}
          placeholder="field: content"
          placeholderTextColor={theme.colors.textPlaceholder}
          value={newLine}
          onChangeText={setNewLine}
          onSubmitEditing={handleAddLine}
        />
        <TouchableOpacity style={styles.addBtn} onPress={handleAddLine}>
          <Icon name="plus" size={20} color={theme.colors.textPrimary} />
        </TouchableOpacity>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
          <Text style={styles.saveText}>Save Entry</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onCancel}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const createStyles = (theme) =>
  StyleSheet.create({
    container: {
      backgroundColor: theme.colors.surface,
      borderRadius: 12,
      padding: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 12,
    },
    title: {
      fontSize: 17,
      fontWeight: '700',
      color: theme.colors.textPrimary,
      flex: 1,
    },
    titleInput: {
      fontSize: 17,
      fontWeight: '700',
      color: theme.colors.inputText,
      backgroundColor: theme.colors.inputBackground,
      paddingVertical: 12,
      paddingHorizontal: 12,
      marginBottom: 12,
      borderRadius: 8,
    },
    lineRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 6,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    lineText: {
      flex: 1,
      fontSize: 14,
    },
    label: {
      fontWeight: '600',
      color: theme.colors.textPrimary,
    },
    value: {
      color: theme.colors.textSecondary,
      flex: 1,
    },
    addLineRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 8,
    },
    lineInput: {
      flex: 1,
      fontSize: 14,
      color: theme.colors.inputText,
      backgroundColor: theme.colors.inputBackground,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 8,
    },
    addBtn: {
      padding: 8,
      marginLeft: 8,
      backgroundColor: theme.colors.surfaceElevated,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    actions: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: 16,
    },
    saveBtn: {
      backgroundColor: theme.colors.surfaceElevated,
      paddingHorizontal: 20,
      paddingVertical: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    saveText: {
      color: theme.colors.textPrimary,
      fontWeight: '600',
    },
    cancelText: {
      color: theme.colors.textTertiary,
    },
  });
