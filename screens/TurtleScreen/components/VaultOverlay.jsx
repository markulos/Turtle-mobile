import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useServer } from '../../../context/ServerContext';
import { useTheme } from '../../../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useVault } from '../../PasswordsScreen/hooks/useVault';
import {
  SetupScreen,
  UnlockScreen,
  PasswordItem,
  NewEntryForm,
  SearchBar,
} from '../../PasswordsScreen/components';

/**
 * VaultOverlay - Embedded Password Vault for Turtle Chat
 * 
 * This component wraps the PasswordsScreen functionality to be rendered
 * as an overlay within the Turtle chat interface.
 * 
 * Props:
 * - initialPassword: string | null - Password from /vault command to auto-unlock
 * - onClose: () => void - Callback to close vault and return to chat
 */
export default function VaultOverlay({ initialPassword, onClose }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { isConnected, getBaseUrl } = useServer();
  
  const {
    isSetup,
    isUnlocked,
    isLoading,
    isProcessing,
    entries,
    createVault,
    unlock,
    lock,
    saveEntry,
    deleteEntry,
    clearAll,
    checkSetup,
  } = useVault(getBaseUrl, isConnected);

  const [searchQuery, setSearchQuery] = useState('');
  const [showNewForm, setShowNewForm] = useState(false);
  const [unlockError, setUnlockError] = useState(null);

  // Reset local state when vault is locked or reset
  useEffect(() => {
    if (!isSetup || !isUnlocked) {
      setSearchQuery('');
      setShowNewForm(false);
    }
  }, [isSetup, isUnlocked]);

  // Auto-unlock with initialPassword if provided
  useEffect(() => {
    const attemptAutoUnlock = async () => {
      if (initialPassword && isSetup && !isUnlocked && !isLoading) {
        console.log('[VaultOverlay] Attempting auto-unlock with provided password');
        const success = await unlock(initialPassword);
        if (!success) {
          setUnlockError('Invalid password from command');
        }
      }
    };
    
    attemptAutoUnlock();
  }, [initialPassword, isSetup, isUnlocked, isLoading, unlock]);

  const filteredEntries = useMemo(() => {
    if (!searchQuery.trim()) return entries;
    const query = searchQuery.toLowerCase();
    return entries.filter(
      (e) =>
        e.title?.toLowerCase().includes(query) ||
        e.lines?.some(line => line.toLowerCase().includes(query))
    );
  }, [entries, searchQuery]);

  const handleSave = async (entry) => {
    const success = await saveEntry(entry);
    if (success && !entry.id) {
      setShowNewForm(false);
    }
    return success;
  };

  const handleLock = useCallback(() => {
    lock();
    onClose();
  }, [lock, onClose]);

  const styles = createStyles(theme);

  if (isLoading) {
    return (
      <View style={[styles.overlayContainer, styles.centered]}>
        <ActivityIndicator size="large" color={theme.colors.textPrimary} />
      </View>
    );
  }

  // If not setup, show setup screen
  if (!isSetup) {
    return (
      <View style={[styles.overlayContainer, { paddingTop: insets.top }]}>
        <View style={styles.overlayHeader}>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Icon name="arrow-left" size={24} color={theme.colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.overlayTitle}>Password Vault</Text>
          <View style={{ width: 40 }} />
        </View>
        <SetupScreen onSetup={createVault} isProcessing={isProcessing} />
      </View>
    );
  }

  // If not unlocked, show unlock screen (with auto-unlock error if applicable)
  if (!isUnlocked) {
    return (
      <View style={[styles.overlayContainer, { paddingTop: insets.top }]}>
        <View style={styles.overlayHeader}>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Icon name="arrow-left" size={24} color={theme.colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.overlayTitle}>Password Vault</Text>
          <View style={{ width: 40 }} />
        </View>
        <UnlockScreen 
          onUnlock={unlock} 
          isProcessing={isProcessing}
          errorMessage={unlockError}
        />
      </View>
    );
  }

  // Vault is unlocked - show password list
  return (
    <View style={[styles.overlayContainer, { paddingTop: insets.top }]}>
      {/* Custom Header with Close Button */}
      <View style={styles.overlayHeader}>
        <TouchableOpacity onPress={handleLock} style={styles.closeButton}>
          <Icon name="lock" size={22} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.overlayTitle}>Password Vault</Text>
        <TouchableOpacity onPress={clearAll}>
          <Text style={styles.resetText}>Reset</Text>
        </TouchableOpacity>
      </View>

      <SearchBar
        value={searchQuery}
        onChangeText={setSearchQuery}
        onClear={() => setSearchQuery('')}
        onLock={handleLock}
      />

      <ScrollView style={styles.scrollView}>
        {showNewForm && (
          <NewEntryForm
            onSave={handleSave}
            onCancel={() => setShowNewForm(false)}
            allEntries={entries}
          />
        )}
        
        <FlatList
          data={filteredEntries}
          keyExtractor={(item) => item.id}
          scrollEnabled={false}
          renderItem={({ item }) => (
            <PasswordItem
              item={item}
              onSave={handleSave}
              onDelete={deleteEntry}
              allEntries={entries}
            />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Icon name="shield-key" size={48} color={theme.colors.textMuted} />
              <Text style={styles.emptyText}>
                {searchQuery ? 'No matches found' : 'No entries saved'}
              </Text>
            </View>
          }
        />
        
        <View style={{ height: 100 }} />
      </ScrollView>

      {!showNewForm && (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => setShowNewForm(true)}
        >
          <Icon name="plus" size={28} color={theme.colors.textPrimary} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const createStyles = (theme) =>
  StyleSheet.create({
    overlayContainer: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: theme.colors.background,
      zIndex: 100,
    },
    centered: {
      justifyContent: 'center',
      alignItems: 'center',
    },
    overlayHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    closeButton: {
      width: 40,
      height: 40,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: 20,
      backgroundColor: theme.colors.surfaceElevated,
    },
    overlayTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: theme.colors.textPrimary,
    },
    resetText: {
      fontSize: 13,
      color: theme.colors.accentError,
    },
    scrollView: {
      flex: 1,
      padding: 16,
    },
    empty: {
      alignItems: 'center',
      paddingTop: 80,
    },
    emptyText: {
      marginTop: 16,
      fontSize: 15,
      color: theme.colors.textMuted,
    },
    fab: {
      position: 'absolute',
      right: 20,
      bottom: 20,
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: theme.colors.surfaceElevated,
      justifyContent: 'center',
      alignItems: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.3,
      shadowRadius: 4,
      elevation: 5,
    },
  });
