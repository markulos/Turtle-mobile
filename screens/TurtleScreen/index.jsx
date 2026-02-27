import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import { useServer } from '../../context/ServerContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

// Load the actual turtle SVG from assets
const turtleIcon = require('../../assets/turtle-icon.svg');

export default function TurtleScreen() {
  const { theme } = useTheme();
  const { api, isConnected } = useServer();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [kimiStatus, setKimiStatus] = useState(null);

  // Check Kimi status when connected
  useEffect(() => {
    if (isConnected) {
      api.get('/turtle/status')
        .then(setKimiStatus)
        .catch(() => setKimiStatus(null));
    }
  }, [isConnected, api]);

  const sendMessage = useCallback(async () => {
    if (!inputText.trim() || !isConnected) return;

    const userMessage = {
      id: Date.now().toString(),
      text: inputText.trim(),
      sender: 'user',
      timestamp: new Date().toISOString(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputText('');
    setIsLoading(true);

    try {
      const response = await api.post('/turtle/chat', {
        message: userMessage.text,
        timestamp: userMessage.timestamp,
      });

      const serverMessage = {
        id: (Date.now() + 1).toString(),
        text: response.reply || 'No response from server.',
        sender: 'server',
        timestamp: new Date().toISOString(),
      };

      setMessages(prev => [...prev, serverMessage]);
    } catch (error) {
      console.error('Error sending message:', error);
      
      const errorMessage = {
        id: (Date.now() + 1).toString(),
        text: error.message || 'Sorry, I could not process your message. Please try again.',
        sender: 'error',
        timestamp: new Date().toISOString(),
      };

      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  }, [inputText, isConnected, api]);

  const styles = createStyles(theme, insets);

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      {/* Background Watermark - Uses actual turtle-icon.svg */}

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>TURTLEDO</Text>
        <View style={styles.connectionStatus}>
          <View
            style={[
              styles.statusDot,
              { 
                backgroundColor: isConnected 
                  ? (kimiStatus?.configured ? '#4ADE80' : '#30D158')
                  : '#FF453A' 
              },
            ]}
          />
          <Text style={styles.statusText}>
            {!isConnected 
              ? 'Offline' 
              : (kimiStatus?.configured ? 'Kimi AI' : 'Connected')}
          </Text>
        </View>
      </View>

      {/* Messages */}
      <ScrollView
        style={styles.messagesContainer}
        contentContainerStyle={styles.messagesContent}
        showsVerticalScrollIndicator={false}
      >
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
            </Text>
          </View>
        ) : (
          messages.map(message => (
            <View
              key={message.id}
              style={[
                styles.messageBubble,
                message.sender === 'user'
                  ? styles.userBubble
                  : message.sender === 'error'
                  ? styles.errorBubble
                  : styles.serverBubble,
              ]}
            >
              <Text
                style={[
                  styles.messageText,
                  message.sender === 'user'
                    ? styles.userText
                    : styles.serverText,
                ]}
              >
                {message.text}
              </Text>
              <Text style={styles.timestamp}>
                {new Date(message.timestamp).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
            </View>
          ))
        )}
        {isLoading && (
          <View style={styles.loadingBubble}>
            <Text style={styles.loadingText}>Turtle is typing...</Text>
          </View>
        )}
      </ScrollView>

      {/* Input */}
      <View style={styles.inputContainer}>
        <View style={styles.inputWrapper}>
          <TextInput
            style={styles.input}
            value={inputText}
            onChangeText={setInputText}
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
                ? '#4ADE80'  // Light green when typing
                : theme.colors.textMuted
            }
          />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const createStyles = (theme, insets) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    backgroundWatermark: {
      position: 'absolute',
      width: '70%',
      height: '50%',
      alignSelf: 'center',
      top: '20%',
    },
    watermarkImage: {
      width: 200,
      height: 200,
      opacity: 0.15,
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
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: theme.spacing.sm,
    },
    emptyState: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: theme.spacing.xxl,
    },
    emptyIcon: {
      marginBottom: theme.spacing.md,
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
    messageBubble: {
      maxWidth: '80%',
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: 20,
      marginBottom: theme.spacing.xs,
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
  });
