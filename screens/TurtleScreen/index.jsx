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
import TimerMessage from './components/TimerMessage';
import PomodoroSettings from './components/PomodoroSettings';
import MediaGallery from './components/MediaGallery';
import { usePomodoroTimer } from './hooks/usePomodoroTimer';

const turtleIcon = require('../../assets/turtle-icon.svg');

// Regex to match /vault command (with optional quoted password)
const VAULT_COMMAND_REGEX = /^\/vault(?:\s+"([^"]*)")?$/;

// Default durations (in minutes)
const DEFAULT_FOCUS_MINUTES = 25;
const DEFAULT_BREAK_MINUTES = 5;

const HEADER_HEIGHT = 60;
const DEBUG_TOGGLE_HEIGHT = 44;

export default function TurtleScreen() {
  const { theme } = useTheme();
  const { api, isConnected, getBaseUrl } = useServer();
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  
  // Chat state
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const [debugLogs, setDebugLogs] = useState([]);
  const [encryptionKey, setEncryptionKey] = useState(null);
  
  // Vault overlay state
  const [isVaultOpen, setIsVaultOpen] = useState(false);
  const [vaultPassword, setVaultPassword] = useState(null);
  
  // Photo Gallery state
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  
  // LOCAL Pomodoro timer state (no server dependency)
  const [timerState, setTimerState] = useState(null);
  const [durations, setDurations] = useState({ 
    focus: DEFAULT_FOCUS_MINUTES, 
    break: DEFAULT_BREAK_MINUTES 
  });
  const [showSettings, setShowSettings] = useState(false);
  
  // Local Pomodoro countdown hook
  const timer = usePomodoroTimer(timerState, handlePomodoroComplete);
  
  // Track timer message ID
  const timerMessageIdRef = useRef(null);
  
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
        const response = await api.get('/turtle/commands');
        if (response.success) {
          setSlashCommands(response.commands || []);
        }
      } catch (error) {
        console.log('[Turtle] Failed to fetch slash commands:', error);
        // Fallback commands if server fails
        setSlashCommands([
          { command: '/pomodoro focus', description: 'Start 25m focus timer' },
          { command: '/pomodoro break', description: 'Start 5m break timer' },
          { command: '/pomodoro stop', description: 'Stop active timer' },
          { command: '/pomodoro settings', description: 'Adjust timer durations' },
        ]);
      }
    };
    
    fetchSlashCommands();
  }, [api]);

  // Handle timer start - add timer message to chat
  useEffect(() => {
    if (timer.isActive && timerMessageIdRef.current === null) {
      // New timer started - add timer message
      const timerId = `timer_${Date.now()}`;
      timerMessageIdRef.current = timerId;
      
      const generateId = () => (Date.now() + Math.random()).toString();
      const modeText = timer.isFocus ? 'Focus' : 'Break';
      
      setMessages(prev => [...prev, {
        id: generateId(),
        text: `${timer.isFocus ? '🍅' : '☕'} ${modeText} timer started`,
        sender: 'system',
        timestamp: new Date().toISOString(),
      }]);
    }
  }, [timer.isActive, timer.isFocus]);
  
  // Update or remove timer message
  useEffect(() => {
    if (!timerMessageIdRef.current) return;
    
    if (!timer.isActive) {
      // Timer stopped - remove message
      setMessages(prev => prev.filter(msg => msg.id !== timerMessageIdRef.current));
      timerMessageIdRef.current = null;
      return;
    }
    
    // Timer active - update or insert timer message
    setMessages(prev => {
      const existingIndex = prev.findIndex(msg => msg.id === timerMessageIdRef.current);
      
      if (existingIndex >= 0) {
        // Update existing timer message
        return prev.map(msg => 
          msg.id === timerMessageIdRef.current
            ? {
                ...msg,
                displayTime: timer.displayTime,
                progress: timer.progress,
                mode: timer.mode,
                totalDuration: timer.totalDuration,
              }
            : msg
        );
      } else {
        // Insert timer message at the end
        return [...prev, {
          id: timerMessageIdRef.current,
          type: 'timer',
          displayTime: timer.displayTime,
          progress: timer.progress,
          mode: timer.mode,
          totalDuration: timer.totalDuration,
          sender: 'timer',
          timestamp: new Date().toISOString(),
        }];
      }
    });
  }, [timer.displayTime, timer.progress, timer.isActive, timer.mode, timer.totalDuration]);
  
  // Handle timer completion
  function handlePomodoroComplete() {
    const generateId = () => (Date.now() + Math.random()).toString();
    
    // Clear timer message ref
    timerMessageIdRef.current = null;
    
    // Add completion message
    setMessages(prev => [...prev, {
      id: generateId(),
      text: timer.isFocus 
        ? '🎉 Focus session complete! Take a break.' 
        : '☕ Break is over! Ready to focus?',
      sender: 'system',
      timestamp: new Date().toISOString(),
    }]);
    
    // Clear timer state
    setTimerState(null);
  }
  
  // Handle timer stop
  const handleStopTimer = useCallback(() => {
    setTimerState(null);
    timerMessageIdRef.current = null;
    
    const generateId = () => (Date.now() + Math.random()).toString();
    setMessages(prev => [...prev, {
      id: generateId(),
      text: '⏹️ Timer stopped',
      sender: 'system',
      timestamp: new Date().toISOString(),
    }]);
  }, []);
  
  // Handle timer start
  const handleStartTimer = useCallback((mode) => {
    const minutes = mode === 'focus' ? durations.focus : durations.break;
    const endTime = Date.now() + (minutes * 60 * 1000);
    
    setTimerState({
      endTime,
      totalDuration: minutes * 60,
      mode,
      isRunning: true,
    });
  }, [durations]);
  
  // Handle settings update
  const handleUpdateDurations = useCallback((focusMinutes, breakMinutes) => {
    setDurations({ focus: focusMinutes, break: breakMinutes });
  }, []);

  // Handle input changes for autocomplete
  const handleInputChange = (text) => {
    setInputText(text);
    
    // Show autocomplete when typing /
    if (text.startsWith('/')) {
      const query = text.toLowerCase();
      const suggestions = [];
      
      slashCommands.forEach(cmd => {
        // Match command (server returns flat list like "/pomodoro focus")
        if (cmd.command.toLowerCase().startsWith(query)) {
          suggestions.push({
            text: cmd.command,
            description: cmd.description,
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

  // Initialize encryption key and welcome message
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

  // Send message handler
  const sendMessage = useCallback(async () => {
    const generateId = () => (Date.now() + Math.random()).toString();
    
    if (!inputText.trim() || !isConnected || !encryptionKey) {
      addDebugLog('Error', 'Missing Input, Connection, or Encryption Key');
      return;
    }

    const currentInput = inputText.trim();
    
    // ===== COMMAND INTERCEPTION (BEFORE AI) =====
    
    // Check for /vault command
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
      
      return; // STOP HERE - don't send to AI
    }

    // Check for /pomodoro commands
    if (currentInput === '/pomodoro focus' || currentInput.startsWith('/pomodoro focus ')) {
      console.log('[Turtle] Pomodoro focus command detected');
      
      setMessages(prev => [...prev, {
        id: generateId(),
        text: currentInput,
        sender: 'user',
        timestamp: new Date().toISOString(),
      }]);
      
      setInputText('');
      handleStartTimer('focus');
      
      return; // STOP HERE - don't send to AI
    }
    
    if (currentInput === '/pomodoro break' || currentInput.startsWith('/pomodoro break ')) {
      console.log('[Turtle] Pomodoro break command detected');
      
      setMessages(prev => [...prev, {
        id: generateId(),
        text: currentInput,
        sender: 'user',
        timestamp: new Date().toISOString(),
      }]);
      
      setInputText('');
      handleStartTimer('break');
      
      return; // STOP HERE - don't send to AI
    }
    
    if (currentInput === '/pomodoro stop') {
      console.log('[Turtle] Pomodoro stop command detected');
      
      setMessages(prev => [...prev, {
        id: generateId(),
        text: currentInput,
        sender: 'user',
        timestamp: new Date().toISOString(),
      }]);
      
      setInputText('');
      handleStopTimer();
      
      return; // STOP HERE - don't send to AI
    }
    
    if (currentInput === '/pomodoro settings') {
      console.log('[Turtle] Pomodoro settings command detected');
      
      setMessages(prev => [...prev, {
        id: generateId(),
        text: currentInput,
        sender: 'user',
        timestamp: new Date().toISOString(),
      }]);
      
      setInputText('');
      setShowSettings(true);
      
      setMessages(prev => [...prev, {
        id: generateId(),
        text: '⚙️ Opening Pomodoro settings...',
        sender: 'system',
        timestamp: new Date().toISOString(),
      }]);
      
      return; // STOP HERE - don't send to AI
    }
    
    // Check for /photos command
    if (currentInput === '/photos') {
      console.log('[Turtle] Photos command detected');
      
      setMessages(prev => [...prev, {
        id: generateId(),
        text: currentInput,
        sender: 'user',
        timestamp: new Date().toISOString(),
      }]);
      
      setInputText('');
      setIsLoading(false);
      setIsGalleryOpen(true);
      
      setMessages(prev => [...prev, {
        id: generateId(),
        text: '📸 Opening Photo Vault...',
        sender: 'system',
        timestamp: new Date().toISOString(),
      }]);
      
      return; // STOP HERE - don't send to AI
    }
    
    // ===== END COMMAND INTERCEPTION =====

    // Add user message to chat
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
      
      // Prepare chat history
      const chatHistoryArray = messages
        .filter(msg => msg.sender === 'user' || msg.sender === 'assistant')
        .slice(-10)
        .map(msg => ({
          role: msg.sender === 'user' ? 'user' : 'assistant',
          content: msg.text
        }));
      
      // Send to AI
      const aiResponse = await api.post('/turtle/chat', {
        message: currentInput,
        history: chatHistoryArray,
      });

      const { reply, intent } = aiResponse;

      // Add AI reply
      setMessages(prev => [...prev, {
        id: generateId(),
        text: reply || 'Command processed.',
        sender: 'assistant',
        timestamp: new Date().toISOString(),
      }]);

      // Handle encrypted intent if present
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
  }, [inputText, isConnected, encryptionKey, getBaseUrl, api, messages, token, debugMode, addDebugLog, handleOpenVault, handleStartTimer, handleStopTimer, durations]);

  const styles = createStyles(theme, insets);

  // Show Media Gallery overlay when open
  if (isGalleryOpen) {
    return (
      <View style={[styles.container, { flex: 1 }]}>
        <MediaGallery onClose={() => setIsGalleryOpen(false)} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { flex: 1 }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      {/* Static Safe Area Overlay */}
      <View 
        style={[
          styles.safeAreaOverlay, 
          { height: insets.top }
        ]} 
      />

      {/* Messages */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.messagesContainer}
        contentContainerStyle={styles.messagesContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Inline Header */}
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

        {/* Messages content */}
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
          messages.map(message => {
            // Render timer message specially
            if (message.type === 'timer') {
              return (
                <View key={message.id} style={styles.timerBubble}>
                  <TimerMessage
                    displayTime={message.displayTime}
                    progress={message.progress}
                    mode={message.mode}
                    totalDuration={message.totalDuration}
                    onStop={handleStopTimer}
                    theme={theme}
                  />
                </View>
              );
            }
            
            return (
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
            );
          })
        )}
        {isLoading && (
          <View style={styles.loadingBubble}>
            <Text style={styles.loadingText}>Turtle is typing...</Text>
          </View>
        )}
      </ScrollView>

      {/* Input Area - moves with keyboard */}
      <View style={styles.inputArea}>
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

        {/* Input Row */}
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
              autoComplete="off"
              textContentType="none"
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
      </View>

      {/* Vault Overlay */}
      {isVaultOpen && (
        <VaultOverlay
          initialPassword={vaultPassword}
          onClose={handleCloseVault}
        />
      )}

      {/* Pomodoro Settings Modal */}
      <PomodoroSettings
        visible={showSettings}
        onClose={() => setShowSettings(false)}
        onSave={({ focusMinutes, breakMinutes }) => {
          handleUpdateDurations(focusMinutes, breakMinutes);
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
    inlineHeader: {
      backgroundColor: theme.colors.surface,
      borderBottomWidth: 0.5,
      borderBottomColor: theme.colors.border,
      marginHorizontal: -theme.spacing.sm,
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
    timerBubble: {
      alignSelf: 'flex-start',
      marginBottom: theme.spacing.sm,
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
    inputArea: {
      backgroundColor: theme.colors.background,
      paddingBottom: insets.bottom > 0 ? insets.bottom / 2 : 8,
    },
    inputContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.sm,
      paddingTop: 4,
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
      fontSize: 15,
      color: theme.colors.textPrimary,
      maxHeight: 100,
      paddingTop: 8,
      paddingBottom: 8,
      paddingHorizontal: 4,
      backgroundColor: 'transparent',
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
    autocompleteContainer: {
      marginHorizontal: 12,
      marginBottom: 8,
      backgroundColor: theme.colors.surfaceElevated,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.border,
      maxHeight: 200,
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
