import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
  Switch,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import { useServer } from '../../context/ServerContext';
import { useAuth } from '../../context/AuthContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { interceptAndSend } from '../../services/AICommandInterceptor';
import VaultOverlay from './components/VaultOverlay';
import PomodoroWidget from './components/PomodoroWidget';
import PomodoroSettings from './components/PomodoroSettings';
import { useSocket } from './hooks/useSocket';

const turtleIcon = require('../../assets/turtle-icon.svg');

// Regex to match /vault command (with optional quoted password)
const VAULT_COMMAND_REGEX = /^\/vault(?:\s+"([^"]*)")?$/;

// Regex to match /pomodoro commands
const POMODORO_COMMAND_REGEX = /^\/pomodoro\s+(focus|break|stop|settings)$/;

const HEADER_HEIGHT = 60;
const DEBUG_TOGGLE_HEIGHT = 44;
const COLLAPSIBLE_HEIGHT = HEADER_HEIGHT + DEBUG_TOGGLE_HEIGHT;

export default function TurtleScreen() {
  const { theme } = useTheme();
  const { api, isConnected, getBaseUrl } = useServer();
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const [debugLogs, setDebugLogs] = useState([]);
  const [encryptionKey, setEncryptionKey] = useState(null);
  
  // Vault overlay state
  const [isVaultOpen, setIsVaultOpen] = useState(false);
  const [vaultPassword, setVaultPassword] = useState(null);
  
  // Socket.io for Pomodoro
  const sessionId = useRef(`session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`).current;
  const {
    timerState,
    durations,
    showSettings,
    startPomodoro,
    stopPomodoro,
    updateDurations,
    openSettings,
    closeSettings,
  } = useSocket(getBaseUrl(), sessionId);
  
  // Slash command autocomplete state
  const [slashCommands, setSlashCommands] = useState([]);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteSuggestions, setAutocompleteSuggestions] = useState([]);
  const inputRef = useRef(null);
  
  const scrollViewRef = useRef(null);

  // Fetch slash commands on mount
  useEffect(() => {
    const fetchSlashCommands = async () => {
      try {
        const response = await api.get('/slash-commands');
        if (response.success) {
          setSlashCommands(response.commands || []);
        }
      } catch (error) {
        console.log('[Turtle] Failed to fetch slash commands:', error);
      }
    };
    
    fetchSlashCommands();
  }, [api]);

  // Handle input changes for autocomplete
  const handleInputChange = (text) => {
    setInputText(text);
    
    // Show autocomplete when typing /
    if (text.startsWith('/')) {
      const query = text.toLowerCase();
      const suggestions = [];
      
      slashCommands.forEach(cmd => {
        // Match main command
        if (cmd.command.toLowerCase().startsWith(query)) {
          suggestions.push({
            text: cmd.command,
            description: cmd.description,
            isCommand: true,
          });
        }
        
        // Match subcommands if parent command is typed
        if (cmd.subcommands && query.startsWith(cmd.command.toLowerCase() + ' ')) {
          const subQuery = query.slice(cmd.command.length + 1);
          cmd.subcommands.forEach(sub => {
            if (sub.toLowerCase().startsWith(subQuery)) {
              suggestions.push({
                text: `${cmd.command} ${sub}`,
                description: `${cmd.description} - ${sub}`,
                isCommand: false,
              });
            }
          });
        }
      });
      
      setAutocompleteSuggestions(suggestions);
      setShowAutocomplete(suggestions.length > 0);
    } else {
      setShowAutocomplete(false);
    }
  };

  // Apply autocomplete suggestion
  const applySuggestion = (suggestion) => {
    setInputText(suggestion.text + ' ');
    setShowAutocomplete(false);
    inputRef.current?.focus();
  };

  useEffect(() => {
    const DEV_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    setEncryptionKey(DEV_KEY);
    
    // Add welcome message on mount
    setMessages([
      {
        id: 'welcome',
        text: "Hi! I'm TURTLEDO.",
        sender: 'assistant',
        timestamp: new Date().toISOString(),
        isWelcome: true,
      }
    ]);
  }, []);

  const addDebugLog = useCallback((stage, data) => {
    if (!debugMode) return;
    const logEntry = {
      id: Date.now().toString() + Math.random(),
      stage,
      data,
      timestamp: new Date().toLocaleTimeString(),
    };
    setDebugLogs(prev => [...prev, logEntry]);
    console.log(`[Turtle Debug] ${stage}:`, data);
  }, [debugMode]);

  const clearDebugLogs = () => setDebugLogs([]);

  // Handle opening vault with password
  const handleOpenVault = useCallback((password) => {
    console.log('[Turtle] Opening vault...');
    setVaultPassword(password);
    setIsVaultOpen(true);
  }, []);

  // Handle closing vault
  const handleCloseVault = useCallback(() => {
    console.log('[Turtle] Closing vault...');
    setIsVaultOpen(false);
    setVaultPassword(null);
  }, []);

  // Handle Pomodoro completion
  const handlePomodoroComplete = useCallback(() => {
    const generateId = () => (Date.now() + Math.random()).toString();
    setMessages(prev => [...prev, {
      id: generateId(),
      text: timerState?.mode === 'focus' 
        ? '🎉 Focus session complete! Take a break.' 
        : '☕ Break is over! Ready to focus?',
      sender: 'system',
      timestamp: new Date().toISOString(),
    }]);
  }, [timerState]);



  const sendMessage = useCallback(async () => {
    const generateId = () => (Date.now() + Math.random()).toString();
    
    if (!inputText.trim() || !isConnected || !encryptionKey) {
      addDebugLog('Error', 'Missing Input, Connection, or Encryption Key');
      return;
    }

    const currentInput = inputText.trim();
    
    // Check for /vault command BEFORE sending to AI
    const vaultMatch = currentInput.match(VAULT_COMMAND_REGEX);
    if (vaultMatch) {
      const password = vaultMatch[1] || null;
      console.log('[Turtle] Vault command detected');
      
      setMessages(prev => [...prev, {
        id: generateId(),
        text: currentInput,
        sender: 'user',
        timestamp: new Date().toISOString(),
      }]);
      
      setInputText('');
      handleOpenVault(password);
      
      setMessages(prev => [...prev, {
        id: generateId(),
        text: '🔐 Opening Password Vault...',
        sender: 'system',
        timestamp: new Date().toISOString(),
      }]);
      
      return;
    }

    // Check for /pomodoro commands BEFORE sending to AI
    const pomodoroMatch = currentInput.match(POMODORO_COMMAND_REGEX);
    if (pomodoroMatch) {
      const command = pomodoroMatch[1];
      console.log('[Turtle] Pomodoro command detected:', command);
      
      setMessages(prev => [...prev, {
        id: generateId(),
        text: currentInput,
        sender: 'user',
        timestamp: new Date().toISOString(),
      }]);
      
      setInputText('');
      
      switch (command) {
        case 'focus':
          startPomodoro('focus');
          setMessages(prev => [...prev, {
            id: generateId(),
            text: `🍅 Focus timer started (${durations.focus} min)`,
            sender: 'system',
            timestamp: new Date().toISOString(),
          }]);
          break;
        case 'break':
          startPomodoro('break');
          setMessages(prev => [...prev, {
            id: generateId(),
            text: `☕ Break timer started (${durations.break} min)`,
            sender: 'system',
            timestamp: new Date().toISOString(),
          }]);
          break;
        case 'stop':
          stopPomodoro();
          setMessages(prev => [...prev, {
            id: generateId(),
            text: '⏹️ Timer stopped',
            sender: 'system',
            timestamp: new Date().toISOString(),
          }]);
          break;
        case 'settings':
          openSettings();
          setMessages(prev => [...prev, {
            id: generateId(),
            text: '⚙️ Opening Pomodoro settings...',
            sender: 'system',
            timestamp: new Date().toISOString(),
          }]);
          break;
      }
      
      return;
    }

    const userMessage = {
      id: generateId(),
      text: currentInput,
      sender: 'user',
      timestamp: new Date().toISOString(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputText('');
    setIsLoading(true);
    clearDebugLogs();

    try {
      addDebugLog('AI Request', `Sending: "${currentInput}"`);
      
      const chatHistoryArray = messages
        .filter(msg => msg.sender === 'user' || msg.sender === 'assistant')
        .slice(-10)
        .map(msg => ({
          role: msg.sender === 'user' ? 'user' : 'assistant',
          content: msg.text
        }));
      
      const aiResponse = await api.post('/turtle/chat', {
        message: currentInput,
        history: chatHistoryArray,
      });

      const { reply, intent } = aiResponse;

      setMessages(prev => [...prev, {
        id: generateId(),
        text: reply || 'Command processed.',
        sender: 'assistant',
        timestamp: new Date().toISOString(),
      }]);

      if (intent && typeof intent === 'object' && intent.payload) {
        const serverUrl = getBaseUrl();
        const result = await interceptAndSend(
          intent,
          encryptionKey,
          serverUrl,
          token,
          addDebugLog
        );

        if (result.success) {
          const executionResult = result.serverResponse?.data?.result;
          const resultText = typeof executionResult === 'string' 
            ? executionResult 
            : JSON.stringify(executionResult, null, 2);

          setMessages(prev => [...prev, {
            id: generateId(),
            text: `✅ Intent executed:\n${resultText}`,
            sender: 'system',
            timestamp: new Date().toISOString(),
          }]);
        }
      }
    } catch (error) {
      console.error('[AI Chat] Error:', error);
      setMessages(prev => [...prev, {
        id: generateId(),
        text: `⚠️ ${error.message}`,
        sender: 'error',
        timestamp: new Date().toISOString(),
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [inputText, isConnected, encryptionKey, getBaseUrl, api, messages, token, debugMode, addDebugLog, handleOpenVault, startPomodoro, stopPomodoro, openSettings, durations]);

  const styles = createStyles(theme, insets);

  return (
    <KeyboardAvoidingView
      style={[styles.container, { flex: 1 }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      {/* Static Safe Area Overlay - always covers the notch */}
      <View 
        style={[
          styles.safeAreaOverlay, 
          { 
            height: insets.top,
          }
        ]} 
      />

      {/* Messages - header is now inline at top */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.messagesContainer}
        contentContainerStyle={styles.messagesContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Inline Header - scrolls naturally with chat */}
        <View style={styles.inlineHeader}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>TURTLEDO</Text>
            <View style={styles.connectionStatus}>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: isConnected ? '#30D158' : '#FF453A' },
                ]}
              />
              <Text style={styles.statusText}>
                {isConnected ? 'Connected' : 'Offline'}
              </Text>
            </View>
          </View>

          <View style={styles.debugToggleContainer}>
            <View style={styles.debugToggle}>
              <Icon name="shield-lock" size={16} color={debugMode ? '#4ADE80' : theme.colors.textMuted} />
              <Text style={[styles.debugToggleText, debugMode && styles.debugToggleTextActive]}>
                Encryption Debug
              </Text>
              <Switch
                value={debugMode}
                onValueChange={setDebugMode}
                trackColor={{ false: theme.colors.border, true: 'rgba(74, 222, 128, 0.3)' }}
                thumbColor={debugMode ? '#4ADE80' : theme.colors.textMuted}
              />
            </View>
            {debugMode && debugLogs.length > 0 && (
              <TouchableOpacity onPress={clearDebugLogs} style={styles.clearDebugBtn}>
                <Text style={styles.clearDebugText}>Clear</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Pomodoro Widget - shown when timer is active */}
        {timerState && (
          <PomodoroWidget
            timerState={timerState}
            onStop={stopPomodoro}
            onComplete={handlePomodoroComplete}
          />
        )}

        {messages.length === 0 ? (
          <View style={styles.emptyState}>
            <Image
              source={turtleIcon}
              style={styles.watermarkImage}
              contentFit="contain"
            />
            <Text style={styles.emptyTitle}>Chat with Turtle</Text>
            <Text style={styles.emptyText}>
              Ask me anything about your tasks, passwords, or just chat!
              {'\n\n'}Type <Text style={styles.commandHint}>/vault</Text> to access the Password Vault.
              {'\n'}Type <Text style={styles.commandHint}>/pomodoro focus</Text> to start a timer.
              {debugMode && '\n\n🔒 Debug mode ON - Encryption logs enabled'}
            </Text>
          </View>
        ) : (
          messages.map(message => (
            <View
              key={message.id}
              style={[
                styles.messageBubble,
                message.isWelcome ? styles.welcomeBubble : 
                message.sender === 'user'
                  ? styles.userBubble
                  : message.sender === 'error'
                  ? styles.errorBubble
                  : styles.serverBubble,
              ]}
            >
              {/* Show turtle SVG only for welcome message */}
              {message.isWelcome && (
                <Image
                  source={turtleIcon}
                  style={styles.watermarkImage}
                  contentFit="contain"
                />
              )}
              <Text
                style={[
                  styles.messageText,
                  message.isWelcome ? styles.welcomeText :
                  message.sender === 'user'
                    ? styles.userText
                    : styles.serverText,
                ]}
              >
                {message.text}
              </Text>
              {!message.isWelcome && (
                <Text style={styles.timestamp}>
                  {new Date(message.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
              )}
            </View>
          ))
        )}
        {isLoading && (
          <View style={styles.loadingBubble}>
            <Text style={styles.loadingText}>Turtle is typing...</Text>
          </View>
        )}
      </ScrollView>

      {/* Autocomplete Dropdown */}
      {showAutocomplete && (
        <View style={styles.autocompleteContainer}>
          <ScrollView 
            style={styles.autocompleteScroll}
            keyboardShouldPersistTaps="handled"
          >
            {autocompleteSuggestions.map((suggestion, index) => (
              <TouchableOpacity
                key={index}
                style={styles.autocompleteItem}
                onPress={() => applySuggestion(suggestion)}
              >
                <Text style={styles.autocompleteCommand}>{suggestion.text}</Text>
                <Text style={styles.autocompleteDescription}>{suggestion.description}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Input */}
      <View style={styles.inputContainer}>
        <View style={styles.inputWrapper}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={inputText}
            onChangeText={handleInputChange}
            placeholder="Message..."
            placeholderTextColor={theme.colors.textMuted}
            multiline
            maxLength={500}
            editable={isConnected}
          />
        </View>
        <TouchableOpacity
          style={styles.sendButton}
          onPress={sendMessage}
          disabled={!inputText.trim() || !isConnected}
        >
          <Icon
            name="send-circle"
            size={32}
            color={
              inputText.trim() && isConnected
                ? '#4ADE80'
                : theme.colors.textMuted
            }
          />
        </TouchableOpacity>
      </View>

      {/* Vault Overlay - rendered on top when open */}
      {isVaultOpen && (
        <VaultOverlay
          initialPassword={vaultPassword}
          onClose={handleCloseVault}
        />
      )}

      {/* Pomodoro Settings Modal */}
      <PomodoroSettings
        visible={showSettings}
        onClose={closeSettings}
        onSave={({ focusMinutes, breakMinutes }) => {
          updateDurations(focusMinutes, breakMinutes);
          const generateId = () => (Date.now() + Math.random()).toString();
          setMessages(prev => [...prev, {
            id: generateId(),
            text: `⚙️ Pomodoro settings updated: ${focusMinutes}m focus / ${breakMinutes}m break`,
            sender: 'system',
            timestamp: new Date().toISOString(),
          }]);
        }}
        initialFocusMinutes={durations.focus}
        initialBreakMinutes={durations.break}
      />
    </KeyboardAvoidingView>
  );
}

const createStyles = (theme, insets) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    // Static Safe Area Overlay - always covers the notch
    safeAreaOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      backgroundColor: theme.colors.surface,
      zIndex: 100,
    },
    watermarkImage: {
      width: 200,
      height: 200,
      opacity: 0.55,
    },
    // Inline header - scrolls naturally with chat
    inlineHeader: {
      backgroundColor: theme.colors.surface,
      borderBottomWidth: 0.5,
      borderBottomColor: theme.colors.border,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: theme.spacing.md,
      paddingHorizontal: theme.spacing.lg,
      borderBottomWidth: 0.5,
      borderBottomColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      height: HEADER_HEIGHT,
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: '600',
      color: theme.colors.textPrimary,
      marginLeft: theme.spacing.xs,
    },
    connectionStatus: {
      position: 'absolute',
      right: theme.spacing.lg,
      flexDirection: 'row',
      alignItems: 'center',
    },
    statusDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      marginRight: 6,
    },
    statusText: {
      fontSize: 12,
      color: theme.colors.textSecondary,
    },
    messagesContainer: {
      flex: 1,
    },
    messagesContent: {
      flexGrow: 1,
      paddingHorizontal: theme.spacing.sm,
    },
    emptyState: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: theme.spacing.xxl,
    },
    emptyTitle: {
      fontSize: 20,
      fontWeight: '600',
      color: theme.colors.textPrimary,
      marginBottom: theme.spacing.xs,
    },
    emptyText: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      textAlign: 'center',
      paddingHorizontal: theme.spacing.xl,
    },
    commandHint: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      backgroundColor: theme.colors.surfaceElevated,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
      color: theme.colors.textPrimary,
    },
    messageBubble: {
      maxWidth: '80%',
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: 20,
      marginBottom: theme.spacing.xs,
    },
    welcomeBubble: {
      alignSelf: 'center',
      backgroundColor: 'transparent',
      paddingVertical: theme.spacing.lg,
      paddingHorizontal: theme.spacing.md,
    },
    userBubble: {
      alignSelf: 'flex-end',
      backgroundColor: '#0084FF',
      borderBottomRightRadius: 4,
    },
    serverBubble: {
      alignSelf: 'flex-start',
      backgroundColor: theme.colors.surfaceElevated,
      borderBottomLeftRadius: 4,
    },
    errorBubble: {
      alignSelf: 'flex-start',
      backgroundColor: 'rgba(255, 69, 58, 0.2)',
      borderBottomLeftRadius: 4,
    },
    messageText: {
      fontSize: 15,
      lineHeight: 20,
    },
    welcomeText: {
      fontSize: 15,
      lineHeight: 20,
      color: theme.colors.textSecondary,
      textAlign: 'center',
      fontWeight: 'bold',
    },
    userText: {
      color: '#fff',
    },
    serverText: {
      color: theme.colors.textPrimary,
    },
    timestamp: {
      fontSize: 10,
      color: theme.colors.textMuted,
      marginTop: 4,
      alignSelf: 'flex-end',
    },
    loadingBubble: {
      alignSelf: 'flex-start',
      padding: theme.spacing.md,
      marginBottom: theme.spacing.sm,
    },
    loadingText: {
      fontSize: 14,
      color: theme.colors.textMuted,
      fontStyle: 'italic',
    },
    inputContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.sm,
      paddingTop: 4,
      paddingBottom: insets.bottom > 0 ? insets.bottom / 2 : 1,
      borderTopWidth: 0,
      backgroundColor: theme.colors.background,
    },
    inputWrapper: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.surfaceElevated,
      borderRadius: 20,
      paddingHorizontal: theme.spacing.sm,
      minHeight: 36,
      maxHeight: 100,
    },
    input: {
      flex: 1,
      minHeight: 36,
      maxHeight: 100,
      backgroundColor: 'transparent',
      paddingHorizontal: theme.spacing.xs,
      paddingTop: 8,
      paddingBottom: 8,
      color: theme.colors.textPrimary,
      fontSize: 15,
      textAlignVertical: 'center',
    },
    sendButton: {
      marginLeft: theme.spacing.xs,
      alignItems: 'center',
      justifyContent: 'center',
    },
    debugToggleContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 8,
      backgroundColor: theme.colors.surface,
      borderBottomWidth: 0.5,
      borderBottomColor: theme.colors.border,
      height: DEBUG_TOGGLE_HEIGHT,
    },
    debugToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    debugToggleText: {
      fontSize: 13,
      color: theme.colors.textSecondary,
    },
    debugToggleTextActive: {
      color: '#4ADE80',
      fontWeight: '600',
    },
    clearDebugBtn: {
      paddingHorizontal: 12,
      paddingVertical: 4,
      backgroundColor: theme.colors.surfaceElevated,
      borderRadius: 4,
    },
    clearDebugText: {
      fontSize: 12,
      color: theme.colors.textSecondary,
    },
    // Autocomplete styles
    autocompleteContainer: {
      position: 'absolute',
      bottom: 60 + (insets.bottom > 0 ? insets.bottom / 2 : 8),
      left: 12,
      right: 12,
      backgroundColor: theme.colors.surfaceElevated,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.border,
      maxHeight: 200,
      zIndex: 50,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -2 },
      shadowOpacity: 0.2,
      shadowRadius: 4,
      elevation: 5,
    },
    autocompleteScroll: {
      maxHeight: 200,
    },
    autocompleteItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 0.5,
      borderBottomColor: theme.colors.border,
    },
    autocompleteCommand: {
      fontSize: 15,
      fontWeight: '600',
      color: theme.colors.textPrimary,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    autocompleteDescription: {
      fontSize: 12,
      color: theme.colors.textMuted,
    },
  });
