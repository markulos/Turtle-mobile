import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
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
  ChangeMasterPasswordModal,
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
    isLoadingEntries,
    entries,
    createVault,
    tryPassword,
    finishUnlock,
    requestOtp,
    verifyOtp,
    biometricUnlock,
    saveBiometric,
    bioAvailable,
    bioHasSaved,
    autoBioArmed,
    lock,
    saveEntry,
    deleteEntry,
    clearAll,
    changeMasterPassword,
    checkSetup,
  } = useVault(getBaseUrl, isConnected);

  const [searchQuery, setSearchQuery] = useState('');
  const [showNewForm, setShowNewForm] = useState(false);
  const [showChangePw, setShowChangePw] = useState(false);

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

  // Stable so the memoized PasswordItem rows aren't invalidated every render.
  const handleSave = useCallback(async (entry) => {
    const success = await saveEntry(entry);
    if (success && !entry.id) {
      setShowNewForm(false);
    }
    return success;
  }, [saveEntry]);

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
    return (
      <UnlockScreen
        tryPassword={tryPassword}
        finishUnlock={finishUnlock}
        requestOtp={requestOtp}
        verifyOtp={verifyOtp}
        biometricUnlock={biometricUnlock}
        saveBiometric={saveBiometric}
        bioAvailable={bioAvailable}
        bioHasSaved={bioHasSaved}
        autoBioArmed={autoBioArmed}
        isProcessing={isProcessing}
      />
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Passwords</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={() => setShowChangePw(true)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Change master password"
          >
            <Icon name="key-change" size={20} color={theme.colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={clearAll}>
            <Text style={styles.resetText}>Reset</Text>
          </TouchableOpacity>
        </View>
      </View>

      <SearchBar
        value={searchQuery}
        onChangeText={setSearchQuery}
        onClear={() => setSearchQuery('')}
        onLock={lock}
      />

      {/* Single FlatList — the form is the list header and the bottom
          spacer is the footer, so the list is the only scroller. This was
          previously a FlatList nested inside a ScrollView, which RN warns
          about ("VirtualizedLists should never be nested…") and disables
          windowing for. */}
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={filteredEntries}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          showNewForm ? (
            <NewEntryForm
              onSave={handleSave}
              onCancel={() => setShowNewForm(false)}
              allEntries={entries}
            />
          ) : null
        }
        renderItem={({ item }) => (
          <PasswordItem
            item={item}
            onSave={handleSave}
            onDelete={deleteEntry}
            allEntries={entries}
          />
        )}
        ListEmptyComponent={
          isLoadingEntries ? (
            // Still fetching from the server — show a loader rather than
            // flashing "No entries saved" before the vault has loaded.
            <View style={styles.empty}>
              <ActivityIndicator size="large" color={theme.colors.textPrimary} />
              <Text style={styles.emptyText}>Fetching vaults…</Text>
            </View>
          ) : (
            <View style={styles.empty}>
              <Icon name="shield-key" size={48} color={theme.colors.textMuted} />
              <Text style={styles.emptyText}>
                {searchQuery ? 'No matches found' : 'No entries saved'}
              </Text>
            </View>
          )
        }
        ListFooterComponent={<View style={{ height: 100 }} />}
      />

      {!showNewForm && (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => setShowNewForm(true)}
        >
          <Icon name="plus" size={28} color={theme.colors.textPrimary} />
        </TouchableOpacity>
      )}

      <ChangeMasterPasswordModal
        visible={showChangePw}
        onClose={() => setShowChangePw(false)}
        onChangePassword={changeMasterPassword}
        isProcessing={isProcessing}
      />
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
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 18,
    },
    resetText: {
      fontSize: 13,
      color: theme.colors.accentError,
    },
    list: {
      flex: 1,
    },
    listContent: {
      flexGrow: 1,
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
