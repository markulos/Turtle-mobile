import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  AppState,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useServer } from '../../context/ServerContext';
import { useTheme } from '../../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useVault } from './hooks/useVault';
import {
  SetupScreen,
  UnlockScreen,
  PasswordItem,
  NewEntryForm,
  SearchBar,
} from './components';

export default function PasswordsScreen() {
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

  // Reset local state when vault is locked or reset
  useEffect(() => {
    if (!isSetup || !isUnlocked) {
      setSearchQuery('');
      setShowNewForm(false);
    }
  }, [isSetup, isUnlocked]);

  // Recheck vault status when app comes to foreground
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        console.log('App active, rechecking vault status...');
        checkSetup();
      }
    });
    return () => subscription?.remove();
  }, [checkSetup]);

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

  const styles = createStyles(theme);

  if (isLoading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={theme.colors.textPrimary} />
      </View>
    );
  }

  if (!isSetup) {
    return <SetupScreen onSetup={createVault} isProcessing={isProcessing} />;
  }

  if (!isUnlocked) {
    return <UnlockScreen onUnlock={unlock} isProcessing={isProcessing} />;
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Passwords</Text>
        <TouchableOpacity onPress={clearAll}>
          <Text style={styles.resetText}>Reset</Text>
        </TouchableOpacity>
      </View>

      <SearchBar
        value={searchQuery}
        onChangeText={setSearchQuery}
        onClear={() => setSearchQuery('')}
        onLock={lock}
      />

      <ScrollView style={styles.scrollView}>
        {showNewForm && (
          <NewEntryForm
            onSave={handleSave}
            onCancel={() => setShowNewForm(false)}
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
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    centered: {
      justifyContent: 'center',
      alignItems: 'center',
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    headerTitle: {
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
      fontSize: 16,
      color: theme.colors.textSecondary,
      fontWeight: '600',
    },
    fab: {
      position: 'absolute',
      right: 16,
      bottom: 16,
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: theme.colors.surfaceElevated,
      justifyContent: 'center',
      alignItems: 'center',
      elevation: 4,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
  });
