// react-native-gesture-handler must be imported at the very top of the
// app entry — before anything else — so its native side is initialised
// before any gesture is registered. App.js is the registered root
// (expo/AppEntry.js → App), so this is the correct place.
import 'react-native-gesture-handler';
import React, { useState, useEffect } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { View, ActivityIndicator, Image, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

// Same turtle artwork the web app uses for its Chat nav icon
// (web-app/public/turtle-logo.png). Bringing the asset across so the
// mobile tab bar carries the same brand mark as the web app — top-down
// shell silhouette with the shell-line gaps as transparency.
const TURTLE_TAB_ICON = require('./assets/turtle-logo.png');
import { ShareIntentProvider, useShareIntent } from 'expo-share-intent';

// Screens
// (SettingsScreen lives inside TurtleScreen now — accessed via the
// gear icon in the top-right corner of the Turtle page — so it no
// longer ships as a tab.)
import { installGlobalTouchFeedback } from './utils/globalTouchFeedback';
import TasksScreen from './screens/TasksScreen';
import TurtleScreen from './screens/TurtleScreen';
import LoginScreen from './screens/LoginScreen';
import PhotosScreen from './screens/PhotosScreen';
import NotesScreen from './screens/NotesScreen';
import PasswordsScreen from './screens/PasswordsScreen';
import ShareTargetScreen from './screens/ShareTargetScreen';
import { ServerProvider } from './context/ServerContext';
import { ShareUploadProvider } from './context/ShareUploadContext';
import ShareUploadToast from './components/ShareUploadToast';
import { VaultUploadProvider } from './context/VaultUploadContext';
import VaultUploadPill from './components/VaultUploadPill';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { VaultProvider } from './context/VaultContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ClaudeQueueProvider } from './context/ClaudeQueueContext';
import { CommandBusProvider } from './context/CommandBusContext';
import { CelebrationProvider } from './context/CelebrationContext';
import { DownloadsProvider } from './context/DownloadsContext';
import DownloadsPill from './components/DownloadsPill';
import CommandConsole from './components/CommandConsole';
import VaultUnlockApproval from './components/VaultUnlockApproval';
import PomodoroNotifications from './components/PomodoroNotifications';
import { runCacheMaintenanceOnBackground } from './utils/cacheManager';
import { tapHaptic } from './utils/haptics';

// App-wide snappy touch feel: every TouchableOpacity gets a light press-in
// haptic + a crisper press fade. Installed once, before the tree renders.
installGlobalTouchFeedback();

const Tab = createBottomTabNavigator();

function TabNavigator() {
  const { theme, isDark, hideVaultButton } = useTheme();
  const insets = useSafeAreaInsets();
  const [consoleOpen, setConsoleOpen] = useState(false);

  return (
    <>
    <Tab.Navigator
      // Instant selection tick the moment a tab is tapped — the switch feels
      // tactile rather than silent. Fires for every tab via one listener.
      screenListeners={{ tabPress: () => tapHaptic() }}
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          // Turtle tab uses the web app's custom PNG mark so the
          // brand visual matches across platforms. We recolor the
          // dark turtle pixels to whatever `color` is (active/inactive
          // tab tint) via tintColor — alpha pixels pass through
          // untouched, so the shell-line gaps stay transparent.
          //
          // Sized larger than the rest of the tab icons (36 vs 24) to
          // act as the visual anchor of the tab bar — the turtle is
          // the brand, pinned to the trailing/right slot like a
          // primary-action button. The other tabs read as cooler
          // utility surfaces leading up to it.
          if (route.name === 'Turtle') {
            return (
              <Image
                source={TURTLE_TAB_ICON}
                style={{
                  width: 36,
                  height: 36,
                  tintColor: color,
                  resizeMode: 'contain',
                }}
              />
            );
          }
          let iconName;
          if (route.name === 'Tasks') iconName = focused ? 'checkbox-marked-circle' : 'checkbox-marked-circle-outline';
          else if (route.name === 'Notes') iconName = focused ? 'note-text' : 'note-text-outline';
          else if (route.name === 'Photos') iconName = focused ? 'image' : 'image-outline';
          else if (route.name === 'Vault') iconName = focused ? 'shield-key' : 'shield-key-outline';
          return <Icon name={iconName} size={24} color={color} />;
        },
        tabBarActiveTintColor: theme.colors.textPrimary,
        tabBarInactiveTintColor: theme.colors.textMuted,
        // Icons only — no text labels. Cleaner look and lets the
        // larger turtle icon breathe without crowding from a label
        // sitting under it.
        tabBarShowLabel: false,
        tabBarStyle: {
          backgroundColor: theme.colors.background,
          // A hairline along the TOP edge of the bottom nav — the device's
          // thinnest renderable line (StyleSheet.hairlineWidth, ~0.5px) in the
          // faint theme border colour, so the bar reads as its own surface,
          // just barely separated from the content above it.
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.colors.border,
          height: 49 + insets.bottom, // Standard iOS tab bar 49pt + safe area
          paddingBottom: insets.bottom,
          paddingTop: 6,
        },
        headerShown: false, // Hide default header
      })}
    >
      {/* Tab order: Tasks → Notes → Photos → Turtle. Settings has
          moved off the tab bar — it lives behind the gear icon in
          the top-right corner of the Turtle page. With Turtle now
          on the RIGHT, the brand glyph anchors the trailing edge of
          the nav and reads as the user's "home" the way Twitter /
          Threads pin their compose button to the right. */}
      <Tab.Screen
        name="Tasks"
        component={TasksScreen}
        options={{ title: 'TO-DO' }}
      />
      <Tab.Screen
        name="Notes"
        component={NotesScreen}
        options={{ title: 'Notes' }}
      />
      <Tab.Screen
        name="Photos"
        component={PhotosScreen}
        // tabBarButtonTestID gives the batch-share E2E flow a stable handle on
        // the icon-only Photos tab (.maestro/batch-share.yaml).
        options={{ title: 'Photos', tabBarButtonTestID: 'tab-photos' }}
      />
      {/* Vault tab can be hidden from the navbar via Settings; when hidden,
          the vault is still reachable through the /vault command in chat or
          the terminal. */}
      {!hideVaultButton && (
        <Tab.Screen
          name="Vault"
          component={PasswordsScreen}
          options={{ title: 'Vault' }}
        />
      )}
      <Tab.Screen
        name="Turtle"
        component={TurtleScreen}
        options={{ title: 'Turtle' }}
        listeners={{ tabLongPress: () => setConsoleOpen(true) }}
      />
    </Tab.Navigator>
    <CommandConsole visible={consoleOpen} onClose={() => setConsoleOpen(false)} />
    </>
  );
}

function AppContent() {
  const { isDark, theme } = useTheme();
  const { isAuthenticated, isLoading } = useAuth();

  // Share-intent hook from expo-share-intent. When the OS launches us
  // via the share sheet, `hasShareIntent` is true and `shareIntent`
  // carries { text?, webUrl?, files?: [{ path, mimeType, fileName }] }.
  // resetShareIntent() returns control to the normal app flow.
  //
  // Note: this hook ALSO fires when the app is already running and the
  // user shares into it (iOS "open with..." flow) — not just on cold
  // launch. The render below short-circuits the tab nav for the
  // duration of the share, so it works in either case.
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent();

  // Bound the on-disk cache: when the app is backgrounded/closed, sweep the
  // throwaway temp + leaked share files and (throttled) wipe expo-image's
  // persistent disk cache. Keeps the multi-GB bloat from ever building up while
  // staying warm enough for snappy in-session browsing. See utils/cacheManager.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') runCacheMaintenanceOnBackground();
    });
    return () => sub.remove();
  }, []);

  // Show loading spinner while checking for saved token
  if (isLoading) {
    return (
      <View style={{
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: theme.colors.background
      }}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  // Show login screen if not authenticated. We intentionally do NOT
  // short-circuit to ShareTargetScreen when unauthenticated — the
  // share screen needs a configured server URL, which the user gets
  // from the login flow. ShareTargetScreen itself also gracefully
  // shows a "not connected" state when serverIP is missing, but in
  // practice we want them to log in first.
  if (!isAuthenticated) {
    return (
      <>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <LoginScreen />
      </>
    );
  }

  // Share intent takes precedence over the normal tab nav. Rendering
  // ShareTargetScreen at the top level (NOT inside the NavigationContainer)
  // keeps the share UX focused — no tab bar, no swipe-to-back, just the
  // picker. When the user finishes or cancels, resetShareIntent() flips
  // hasShareIntent → false and we fall through to TabNavigator.
  if (hasShareIntent && shareIntent) {
    return (
      <>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <ShareTargetScreen
          shareIntent={shareIntent}
          onDismiss={resetShareIntent}
        />
      </>
    );
  }

  // Show main app if authenticated
  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <NavigationContainer>
        <TabNavigator />
      </NavigationContainer>
    </>
  );
}

// expo-share-intent requires its provider to wrap the tree so the
// hook can read the OS-delivered payload. It sits OUTSIDE our app's
// providers so the share-intent state survives a re-render of the
// auth/theme/server providers. Order chosen to match the package's
// own docs.
export default function App() {
  return (
    // GestureHandlerRootView must wrap the whole tree (flex:1) so
    // react-native-gesture-handler gestures — e.g. the draggable
    // day-tasks bottom sheet on the Tasks screen — receive touches.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ShareIntentProvider>
        <SafeAreaProvider>
          <ThemeProvider>
            <ServerProvider>
              {/* Owns "Send to Turtle" uploads at the app level so they outlive
                  the share sheet (ShareTargetScreen) unmounting. Inside
                  ServerProvider (needs the api client), around the rest. */}
              <ShareUploadProvider>
              {/* Owns photo-VAULT upload batches app-level: streams in the
                  background with a global progress pill, checkpoints to
                  AsyncStorage after every item, and RESUMES an interrupted
                  batch on the next launch. Inside ServerProvider (needs the
                  base URL); outside AppContent so no screen unmount stops it. */}
              <VaultUploadProvider>
                <AuthProvider>
                  <VaultProvider>
                    <ClaudeQueueProvider>
                      <CommandBusProvider>
                       {/* Confetti + "+N pts" flourish on task / pomodoro
                           completion, mirroring the desktop HUD. Wraps the app
                           so the overlay floats above every screen. */}
                       <CelebrationProvider>
                       {/* Owns the ghost-download queue socket + REST app-wide, so
                           the floating DownloadsPill and live gallery refresh work
                           on every screen. */}
                       <DownloadsProvider>
                        <AppContent />
                        {/* Floating share-upload progress / outcome toast. Rendered
                            here (NOT inside ShareTargetScreen) so it persists after
                            the share sheet dismisses and overlays the main app. */}
                        <ShareUploadToast />
                        {/* Floating vault-upload widget: live percentage while a
                            batch runs in the background (any screen), then the
                            finish stats + delete-originals offer. Bottom-anchored
                            so it never collides with the share toast above. */}
                        <VaultUploadPill />
                        {/* Floating ghost-download progress (links shared into the
                            Download album / enqueued): live % + cancel/retry, sits
                            just above the vault-upload pill. */}
                        <DownloadsPill />
                        {/* Cross-device biometric vault unlock: surfaces an approval
                            sheet when the web vault requests an unlock push. */}
                        <VaultUnlockApproval />
                        {/* Interactive pomodoro end notifications (Start break /
                            Start focus buttons). Renders nothing. */}
                        <PomodoroNotifications />
                       </DownloadsProvider>
                       </CelebrationProvider>
                      </CommandBusProvider>
                    </ClaudeQueueProvider>
                  </VaultProvider>
                </AuthProvider>
              </VaultUploadProvider>
              </ShareUploadProvider>
            </ServerProvider>
          </ThemeProvider>
        </SafeAreaProvider>
      </ShareIntentProvider>
    </GestureHandlerRootView>
  );
}
