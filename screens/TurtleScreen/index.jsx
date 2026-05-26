import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  FlatList,
  Platform,
  KeyboardAvoidingView,
  Keyboard,
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
import { usePomodoroSocket } from './hooks/usePomodoroSocket';

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
  const { api, isConnected, getBaseUrl, serverIP } = useServer();
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  
  // Chat state
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const [debugLogs, setDebugLogs] = useState([]);
  const [encryptionKey, setEncryptionKey] = useState(null);
  
  // History pagination state
  const [historyOffset, setHistoryOffset] = useState(0);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  
  // Vault overlay state
  const [isVaultOpen, setIsVaultOpen] = useState(false);
  const [vaultPassword, setVaultPassword] = useState(null);
  
  // Photo Gallery state
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [galleryAutoUpload, setGalleryAutoUpload] = useState(false);
  
  // Server-as-source-of-truth pomodoro timer (mirrors web app). The hook
  // returns the active/ended state and exposes start/stop helpers — the
  // synthetic timer card below the chat list reads directly from `pomodoro.state`.
  const pomodoro = usePomodoroSocket(serverIP);
  const [showSettings, setShowSettings] = useState(false);
  const durations = pomodoro.durations || { focus: DEFAULT_FOCUS_MINUTES, break: DEFAULT_BREAK_MINUTES };
  
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
          { command: '/pomodoro stats', description: 'Show pomodoro stats' },
          { command: '/pomodoro settings', description: 'Adjust timer durations' },
          { command: '/photos', description: 'Open Photo Vault' },
          { command: '/photos upload', description: 'Upload photos to vault' },
          { command: '/vault', description: 'Open Password Vault' },
        ]);
      }
    };
    
    fetchSlashCommands();
  }, [api]);

  // Fetch chat history with lazy loading for inverted FlatList
  const fetchChatHistory = useCallback(async (isLoadMore = false) => {
    // Prevent overlapping fetches or fetching when we've hit the end
    if (isLoadingHistory || (!hasMoreHistory && isLoadMore)) return;

    try {
      setIsLoadingHistory(true);
      const currentOffset = isLoadMore ? historyOffset : 0;
      
      const res = await api.get(`/turtle/chat/history?limit=50&offset=${currentOffset}`);
      
      if (res && res.success) {
        // DO NOT .reverse() - Keep newest messages first for inverted list
        const formattedMessages = res.messages.map(msg => ({
          id: msg._id,
          text: msg.text,
          timestamp: msg.createdAt, 
          sender: msg.user._id === 1 ? 'user' : 'assistant', 
          isTelegram: msg.source === 'telegram' 
        })); 

        // APPEND older messages to the end of the array (visually the top of the screen)
        setMessages(prev => isLoadMore ? [...prev, ...formattedMessages] : formattedMessages);
        setHistoryOffset(currentOffset + 50);
        setHasMoreHistory(res.messages.length === 50); 
      }
    } catch (error) {
      console.error('[TurtleChat] Failed to load history:', error);
    } finally {
      setIsLoadingHistory(false);
    }
  }, [historyOffset, hasMoreHistory, isLoadingHistory, api]);

  // Initial load on component mount
  useEffect(() => {
    fetchChatHistory(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty array PREVENTS infinite pagination loops and scroll resets

  // Pomodoro start/stop are emitted to the server; the synthetic timer card
  // (rendered below) reflects whatever the server reports for this session.
  // Since stop/complete acknowledgements come back through the socket, we
  // don't need to optimistically push system messages here.
  const handleStartTimer = useCallback((mode) => {
    pomodoro.start(mode);
  }, [pomodoro]);

  const handleStopTimer = useCallback(() => {
    pomodoro.stop();
  }, [pomodoro]);

  const handleCloseSettings = useCallback(() => {
    setShowSettings(false);
  }, []);

  const handleSaveSettings = useCallback(({ focusMinutes, breakMinutes }) => {
    pomodoro.updateDurations(focusMinutes, breakMinutes);
    const generateId = () => (Date.now() + Math.random()).toString();
    setMessages(prev => [{
      id: generateId(),
      text: `⚙️ Pomodoro settings updated: ${focusMinutes}m focus / ${breakMinutes}m break`,
      sender: 'system',
      timestamp: new Date().toISOString(),
    }, ...prev]);
  }, [pomodoro]);

  // Auto-hide the autocomplete whenever the input no longer starts with "/".
  // Covers every clear path (sending a slash command, manual erase, etc.)
  // without sprinkling setShowAutocomplete(false) at every site.
  useEffect(() => {
    if (!inputText.startsWith('/')) {
      setShowAutocomplete(false);
    }
  }, [inputText]);

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

  // Initialize encryption key and fetch history
  useEffect(() => {
    const DEV_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    setEncryptionKey(DEV_KEY);
    
    // Fetch real history from DB instead of a hardcoded welcome message
    fetchChatHistory(false);
  }, [fetchChatHistory]);

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

    // Best-practice mobile chat UX: dismiss the keyboard the moment the user
    // sends so the response (or pomodoro card) is visible without manual tap.
    // Covers every command path below since they all go through this function.
    Keyboard.dismiss();
    setShowAutocomplete(false);
    
    // ===== COMMAND INTERCEPTION (BEFORE AI) =====
    
    // Check for /vault command
    const vaultMatch = currentInput.match(VAULT_COMMAND_REGEX);
    if (vaultMatch) {
      const password = vaultMatch[1] || null;
      console.log('[Turtle] Vault command detected');
      
      setMessages(prev => [{
        id: generateId(),
        text: currentInput,
        sender: 'user',
        timestamp: new Date().toISOString(),
      }, ...prev]);
      
      setInputText('');
      handleOpenVault(password);
      
      setMessages(prev => [{
        id: generateId(),
        text: '🔐 Opening Password Vault...',
        sender: 'system',
        timestamp: new Date().toISOString(),
      }, ...prev]);
      
      return; // STOP HERE - don't send to AI
    }

    // Check for local /search command (don't send to AI)
    if (currentInput.toLowerCase().startsWith('/search')) {
      setInputText('');
      Keyboard.dismiss();
      return; 
    }

    // Check for /pomodoro commands
    if (currentInput === '/pomodoro focus' || currentInput.startsWith('/pomodoro focus ')) {
      console.log('[Turtle] Pomodoro focus command detected');
      
      setMessages(prev => [{
        id: generateId(),
        text: currentInput,
        sender: 'user',
        timestamp: new Date().toISOString(),
      }, ...prev]);
      
      setInputText('');
      handleStartTimer('focus');
      
      return; // STOP HERE - don't send to AI
    }
    
    if (currentInput === '/pomodoro break' || currentInput.startsWith('/pomodoro break ')) {
      console.log('[Turtle] Pomodoro break command detected');
      
      setMessages(prev => [{
        id: generateId(),
        text: currentInput,
        sender: 'user',
        timestamp: new Date().toISOString(),
      }, ...prev]);
      
      setInputText('');
      handleStartTimer('break');
      
      return; // STOP HERE - don't send to AI
    }
    
    if (currentInput === '/pomodoro stop') {
      console.log('[Turtle] Pomodoro stop command detected');
      
      setMessages(prev => [{
        id: generateId(),
        text: currentInput,
        sender: 'user',
        timestamp: new Date().toISOString(),
      }, ...prev]);
      
      setInputText('');
      handleStopTimer();
      
      return; // STOP HERE - don't send to AI
    }
    
    if (currentInput === '/pomodoro settings') {
      console.log('[Turtle] Pomodoro settings command detected');

      setMessages(prev => [{
        id: generateId(),
        text: currentInput,
        sender: 'user',
        timestamp: new Date().toISOString(),
      }, ...prev]);

      setInputText('');
      setShowSettings(true);

      setMessages(prev => [{
        id: generateId(),
        text: '⚙️ Opening Pomodoro settings...',
        sender: 'system',
        timestamp: new Date().toISOString(),
      }, ...prev]);

      return; // STOP HERE - don't send to AI
    }

    if (currentInput === '/pomodoro stats') {
      console.log('[Turtle] Pomodoro stats command detected');

      setMessages(prev => [{
        id: generateId(),
        text: currentInput,
        sender: 'user',
        timestamp: new Date().toISOString(),
      }, ...prev]);

      setInputText('');

      try {
        const stats = await api.get(
          `/pomodoro/stats?sessionId=${encodeURIComponent(pomodoro.sessionId)}&limit=8`
        );
        setMessages(prev => [{
          id: generateId(),
          type: 'stats',
          stats,
          sender: 'system',
          timestamp: new Date().toISOString(),
          text: '',
        }, ...prev]);
      } catch (err) {
        setMessages(prev => [{
          id: generateId(),
          text: `⚠️ Could not load stats: ${err && err.message ? err.message : err}`,
          sender: 'system',
          timestamp: new Date().toISOString(),
        }, ...prev]);
      }

      return; // STOP HERE - don't send to AI
    }
    
    // Check for /photos commands
    if (currentInput === '/photos') {
      console.log('[Turtle] Photos command detected');
      
      setMessages(prev => [{
        id: generateId(),
        text: currentInput,
        sender: 'user',
        timestamp: new Date().toISOString(),
      }, ...prev]);
      
      setInputText('');
      setIsLoading(false);
      setIsGalleryOpen(true);
      
      setMessages(prev => [{
        id: generateId(),
        text: '📸 Opening Photo Vault...',
        sender: 'system',
        timestamp: new Date().toISOString(),
      }, ...prev]);
      
      return; // STOP HERE - don't send to AI
    }
    
    // Check for /photos upload command - opens gallery in upload mode
    if (currentInput === '/photos upload') {
      console.log('[Turtle] Photos upload command detected');
      
      setMessages(prev => [{
        id: generateId(),
        text: currentInput,
        sender: 'user',
        timestamp: new Date().toISOString(),
      }, ...prev]);
      
      setInputText('');
      setIsLoading(false);
      // Open gallery and trigger upload immediately
      setGalleryAutoUpload(true);
      setIsGalleryOpen(true);
      
      setMessages(prev => [{
        id: generateId(),
        text: '📸 Opening Photo Vault for upload...',
        sender: 'system',
        timestamp: new Date().toISOString(),
      }, ...prev]);
      
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

    setMessages(prev => [userMessage, ...prev]);
    setInputText('');
    setIsLoading(true);
    clearDebugLogs();

    try {
      addDebugLog('AI Request', `Sending: "${currentInput}"`);
      
      // Prepare chat history
      const chatHistoryArray = messages
        .filter(msg => msg.sender === 'user' || msg.sender === 'assistant')
        .slice(0, 10) // Grab 10 newest
        .reverse() // Flip chronological for AI context
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
      setMessages(prev => [{
        id: generateId(),
        text: reply || 'Command processed.',
        sender: 'assistant',
        timestamp: new Date().toISOString(),
      }, ...prev]);

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

          setMessages(prev => [{
            id: generateId(),
            text: `✅ Intent executed:\n${resultText}`,
            sender: 'system',
            timestamp: new Date().toISOString(),
          }, ...prev]);
        }
      }
    } catch (error) {
      console.error('[AI Chat] Error:', error);
      setMessages(prev => [{
        id: generateId(),
        text: `⚠️ ${error.message}`,
        sender: 'error',
        timestamp: new Date().toISOString(),
      }, ...prev]);
    } finally {
      setIsLoading(false);
    }
  }, [inputText, isConnected, encryptionKey, getBaseUrl, api, messages, token, debugMode, addDebugLog, handleOpenVault, handleStartTimer, handleStopTimer, durations]);

  const styles = createStyles(theme, insets);

  // Show Media Gallery overlay when open
  if (isGalleryOpen) {
    return (
      <View style={[styles.container, { flex: 1 }]}>
        <MediaGallery 
          onClose={() => {
            setIsGalleryOpen(false);
            setGalleryAutoUpload(false);
          }} 
          autoUpload={galleryAutoUpload}
        />
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

      {/* Messages (Inverted Physics) */}
      <FlatList
        ref={scrollViewRef}
        style={styles.messagesContainer}
        contentContainerStyle={styles.messagesContent}
        showsVerticalScrollIndicator={false}
        inverted={true} // Flips rendering physics upside down
        // Instagram / iMessage-style keyboard handling:
        //   - "interactive" on iOS lets the keyboard slide down proportionally
        //     as the user drags the message list, then snap closed.
        //   - "on-drag" on Android dismisses on the first scroll gesture
        //     (Android doesn't support "interactive").
        //   - "handled" persistence ensures taps on TouchableOpacity (avatars,
        //     the autocomplete suggestions, etc.) still register, while taps
        //     on plain message background dismiss the keyboard.
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        keyboardShouldPersistTaps="handled"
        data={messages.filter(msg => {
          const query = inputText.toLowerCase();
          if (query.startsWith('/search ')) {
            const searchStr = query.replace('/search ', '').trim();
            if (!searchStr) return true;
            const searchTerms = searchStr.split(/\s+/);
            const messageText = msg.text.toLowerCase();
            return searchTerms.every(term => messageText.includes(term));
          }
          return true;
        })}
        keyExtractor={(item) => item.id}
        onEndReached={() => {
          if (hasMoreHistory && !isLoadingHistory) fetchChatHistory(true);
        }}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={
          isLoading ? (
            <View style={styles.loadingBubble}>
              <Text style={styles.loadingText}>Turtle is typing...</Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={[styles.emptyState, { transform: [{ scaleY: -1 }] }]}>
            <Image source={turtleIcon} style={styles.watermarkImage} contentFit="contain" />
            <Text style={styles.emptyTitle}>Chat with Turtle</Text>
            <Text style={styles.emptyText}>Ask me anything about your tasks, passwords, or just chat!</Text>
          </View>
        }
        renderItem={({ item: message }) => {
          let textToRender = message.text;
          let extractedImage = null;
          const match = message.text?.match(/\[IMG:(.+?)\]/);
          if (match) {
            extractedImage = match[1];
            textToRender = message.text.replace(match[0], '').trim();
          }

          if (message.type === 'stats' && message.stats) {
            return (
              <View style={styles.timerBubble}>
                <PomodoroStatsCard stats={message.stats} theme={theme} />
              </View>
            );
          }
          
          // Fix: Robust URL generation that handles trailing slashes and prevents double '/api'
          const buildImageUrl = (filename) => {
            const base = getBaseUrl().replace(/\/+$/, '').replace(/\/api$/, '');
            return `${base}/api/media/raw/${filename}`;
          };

          return (
            <View style={[
              styles.messageBubble,
              message.isWelcome ? styles.welcomeBubble : 
              message.sender === 'user' ? styles.userBubble : 
              message.sender === 'error' ? styles.errorBubble : styles.serverBubble,
              // Telegram Style: If there's an image, remove padding so it sits flush to the edges
              extractedImage && { paddingVertical: 4, paddingHorizontal: 4 }
            ]}>
              {extractedImage && (
                <Image 
                  source={{ uri: buildImageUrl(extractedImage) }} 
                  style={{ 
                    width: 240, 
                    aspectRatio: 1, 
                    borderRadius: 10, // Inner radius slightly tighter than outer bubble
                    marginBottom: textToRender ? 6 : 0, 
                    backgroundColor: 'rgba(0,0,0,0.1)' 
                  }} 
                  contentFit="cover" 
                  cachePolicy="memory-disk"
                />
              )}
              {textToRender ? (
                <Text style={[
                  styles.messageText, 
                  message.isWelcome ? styles.welcomeText : message.sender === 'user' ? styles.userText : styles.serverText,
                  // Re-inject padding for text if it was removed by the image container
                  extractedImage && { paddingHorizontal: 8, paddingBottom: 4 }
                ]}>
                  {textToRender}
                </Text>
              ) : null}
              {!message.isWelcome && (
                <Text style={[
                  styles.timestamp,
                  // Adjust timestamp position if inside a photo bubble
                  extractedImage && { paddingHorizontal: 8, paddingBottom: 2 }
                ]}>
                  {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
              )}
              {message.isTelegram && (
                <View style={{ backgroundColor: 'rgba(0, 136, 204, 0.8)', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2, marginTop: 6, alignSelf: 'flex-end', ...(extractedImage && { marginRight: 6, marginBottom: 4 }) }}>
                  <Text style={{ fontSize: 9, color: '#fff', fontWeight: 'bold' }}>TG</Text>
                </View>
              )}
            </View>
          );
        }}
      />

      {/* Synthetic pomodoro timer card — driven by server state, sits above
          the input so it stays in view regardless of chat scroll. */}
      {pomodoro.state && (
        <View style={styles.timerCardSlot}>
          <TimerMessage
            state={pomodoro.state}
            onStop={handleStopTimer}
            onDismiss={pomodoro.dismiss}
            theme={theme}
          />
        </View>
      )}

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
        onClose={handleCloseSettings}
        onSave={handleSaveSettings}
        initialFocusMinutes={durations.focus}
        initialBreakMinutes={durations.break}
      />
    </KeyboardAvoidingView>
  );
}

const createStyles = (theme, insets) =>
  StyleSheet.create({
    premiumBezel: {
      backgroundColor: 'rgba(30, 30, 32, 0.85)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255, 255, 255, 0.15)',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 5,
    },
    // Light mode premium bezel override - ONLY for light mode
    lightPremiumBezel: {
      backgroundColor: 'rgba(252, 252, 255, 0.92)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(0, 0, 0, 0.15)',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.08,
      shadowRadius: 8,
      elevation: 5,
    },
    // Dark mode premium bezel override - matches MediaGallery like/share container
    darkPremiumBezel: {
      backgroundColor: 'rgba(30, 30, 32, 0.85)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255, 255, 255, 0.15)',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 5,
    },
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
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: 100,
      // scaleY: -1 perfectly counteracts the inverted FlatList, keeping text readable
      transform: [{ scaleY: -1 }],
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
      paddingVertical: 8, // Tighter vertical padding
      paddingHorizontal: 12, // Tighter horizontal padding
      borderRadius: 14, // Modern, squarer Apple/Telegram radius
      marginBottom: theme.spacing.xs,
    },
    timerBubble: {
      alignSelf: 'flex-start',
      marginBottom: theme.spacing.sm,
    },
    timerCardSlot: {
      paddingHorizontal: theme.spacing.md,
      paddingTop: 4,
      paddingBottom: 4,
      alignItems: 'flex-start',
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
      backgroundColor: 'transparent',
      paddingBottom: insets.bottom > 0 ? insets.bottom / 2 : 8,
    },
    inputContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.sm,
      paddingTop: 4,
      backgroundColor: 'transparent',
    },
    inputWrapper: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      // Telegram style: Highly translucent pill, NO heavy drop shadows
      backgroundColor: theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.04)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.15)',
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

// ---------------------------------------------------------------------------
// PomodoroStatsCard — chat bubble that shows aggregated stats (today, week,
// all-time) plus the most recent sessions. Mirrors the web app's StatsCard.
// ---------------------------------------------------------------------------
function PomodoroStatsCard({ stats, theme }) {
  if (!stats) return null;
  const styles = createStatsStyles(theme);

  const fmtDuration = (sec) => (sec >= 60 ? `${Math.round(sec / 60)} min` : `${sec}s`);
  const fmtRecent = (ms) =>
    new Date(ms).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });

  const renderBucket = (label, data) => (
    <View style={styles.bucket} key={label}>
      <Text style={styles.bucketLabel}>{label}</Text>
      <Text style={styles.bucketCount}>
        {data.focusCompleted}
        <Text style={styles.bucketTomato}> 🍅</Text>
      </Text>
      <Text style={styles.bucketSubline}>
        {data.focusMinutes} min focus
        {data.focusStopped > 0 ? ` · ${data.focusStopped} stopped` : ''}
      </Text>
      <Text style={styles.bucketSublineMuted}>
        {data.breakCompleted} breaks · {data.breakMinutes} min
      </Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerEmoji}>📊</Text>
        <Text style={styles.headerTitle}>Pomodoro stats</Text>
      </View>

      <View style={styles.bucketsRow}>
        {renderBucket('Today', stats.today)}
        {renderBucket('This week', stats.thisWeek)}
        {renderBucket('All time', stats.allTime)}
      </View>

      {stats.recent && stats.recent.length > 0 ? (
        <View>
          <Text style={styles.recentLabel}>Recent sessions</Text>
          {stats.recent.map((s) => {
            const isCompleted = s.status === 'completed';
            return (
              <View style={styles.recentRow} key={s.id}>
                <Text style={styles.recentMode}>{s.mode === 'focus' ? '🍅' : '☕'}</Text>
                <View
                  style={[
                    styles.recentStatusPill,
                    {
                      backgroundColor: isCompleted ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)',
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.recentStatusText,
                      { color: isCompleted ? '#4ade80' : '#f87171' },
                    ]}
                  >
                    {isCompleted ? 'done' : 'stopped'}
                  </Text>
                </View>
                <Text style={styles.recentTime}>{fmtRecent(s.endedAt)}</Text>
                <Text style={styles.recentDuration}>{fmtDuration(s.actualDuration)}</Text>
              </View>
            );
          })}
        </View>
      ) : (
        <Text style={styles.emptyHint}>
          No sessions logged yet — start a focus timer with /pomodoro focus.
        </Text>
      )}
    </View>
  );
}

const createStatsStyles = (theme) =>
  StyleSheet.create({
    container: {
      backgroundColor: theme.colors.surfaceElevated,
      borderRadius: 16,
      padding: 14,
      minWidth: 240,
      maxWidth: 320,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 10,
    },
    headerEmoji: { fontSize: 18 },
    headerTitle: { fontWeight: '600', color: theme.colors.textPrimary, fontSize: 14 },
    bucketsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 14,
      marginBottom: 12,
    },
    bucket: {
      minWidth: 90,
    },
    bucketLabel: {
      fontSize: 10,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      color: theme.colors.textMuted,
      marginBottom: 2,
    },
    bucketCount: {
      fontSize: 22,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
      color: theme.colors.accentPrimary || '#7dd3fc',
    },
    bucketTomato: { fontSize: 11, fontWeight: '400', color: theme.colors.textMuted },
    bucketSubline: { fontSize: 11, color: theme.colors.textPrimary, opacity: 0.85 },
    bucketSublineMuted: { fontSize: 11, color: theme.colors.textMuted, marginTop: 1 },
    recentLabel: {
      fontSize: 10,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      color: theme.colors.textMuted,
      marginBottom: 6,
    },
    recentRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 4,
      paddingHorizontal: 6,
      backgroundColor: 'rgba(255,255,255,0.03)',
      borderRadius: 6,
      marginBottom: 4,
    },
    recentMode: { fontSize: 14, width: 18 },
    recentStatusPill: {
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: 4,
    },
    recentStatusText: {
      fontSize: 10,
      fontWeight: '500',
    },
    recentTime: { flex: 1, fontSize: 12, color: theme.colors.textPrimary, opacity: 0.85 },
    recentDuration: {
      fontSize: 12,
      color: theme.colors.textMuted,
      fontVariant: ['tabular-nums'],
    },
    emptyHint: { fontSize: 12, color: theme.colors.textMuted },
  });
