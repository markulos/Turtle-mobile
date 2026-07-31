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
import { View, ActivityIndicator, Image, StyleSheet, useWindowDimensions } from 'react-native';
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
import { MusicPlayerProvider } from './context/MusicPlayerContext';
import { ClaudeQueueProvider } from './context/ClaudeQueueContext';
import { CommandBusProvider } from './context/CommandBusContext';
import { CelebrationProvider } from './context/CelebrationContext';
import { DownloadsProvider } from './context/DownloadsContext';
import DownloadsPill from './components/DownloadsPill';
import CommandConsole from './components/CommandConsole';
import TabBarIcon from './components/TabBarIcon';
import TabBarPill from './components/TabBarPill';
import { clusterPadding, BAR_CONTENT_HEIGHT, BAR_VERTICAL_PAD, CARD_MARGIN_H, CARD_GAP_BOTTOM } from './components/tabBarLayout';
import VaultUnlockApproval from './components/VaultUnlockApproval';
import PomodoroNotifications from './components/PomodoroNotifications';
import { runCacheMaintenanceOnBackground } from './utils/cacheManager';
import { useAppFonts } from './utils/fonts';

// App-wide snappy touch feel: every TouchableOpacity gets a light press-in
// haptic + a crisper press fade. Installed once, before the tree renders.
installGlobalTouchFeedback();

const Tab = createBottomTabNavigator();

function TabNavigator() {
  const { theme, isDark, hideVaultButton } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  // Tabs actually rendered. The Vault tab is optional, and the cluster has to
  // narrow with it or the group would sit off-centre.
  const tabCount = hideVaultButton ? 4 : 5;
  const [consoleOpen, setConsoleOpen] = useState(false);

  return (
    <>
    <Tab.Navigator
      // No tabPress haptic: tab switching is silent by request. (There used to
      // be a selection tick here for every tab.)
      screenOptions={({ route }) => ({
        // NOTE: lazy:false + freezeOnBlur:true were tried here for instant tab
        // switches and REVERTED — screens mounted hidden at boot measure their
        // layouts wrong (zero-height grids, mis-sized scrubbers) and freeze
        // masked the re-measure. Components that need instant readiness must
        // derive their geometry from DATA, not layout (see MediaGallery's
        // analytic scrubber extent).
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
              <TabBarIcon focused={focused} brand>
                <Image
                  source={TURTLE_TAB_ICON}
                  style={{
                    width: 36,
                    height: 36,
                    tintColor: color,
                    resizeMode: 'contain',
                  }}
                />
              </TabBarIcon>
            );
          }
          let iconName;
          // Glyph pairs are chosen so the filled and outline forms share one
          // silhouette — becoming active should read as the SAME icon gaining
          // weight, not as a swap to a different mark. check-circle replaces
          // checkbox-marked-circle and shield-lock replaces shield-key for the
          // same reason: same meaning, far less internal detail at 24pt.
          if (route.name === 'Tasks') iconName = focused ? 'check-circle' : 'check-circle-outline';
          else if (route.name === 'Notes') iconName = focused ? 'note-text' : 'note-text-outline';
          else if (route.name === 'Photos') iconName = focused ? 'image' : 'image-outline';
          else if (route.name === 'Vault') iconName = focused ? 'shield-lock' : 'shield-lock-outline';
          return (
            <TabBarIcon focused={focused}>
              <Icon name={iconName} size={24} color={color} />
            </TabBarIcon>
          );
        },
        // Fixed rather than theme-derived, because the dock is a LIGHT frosted
        // capsule in both themes: the theme's textMuted is white-ish on dark and
        // would vanish against it. Active sits on the accent-coloured chip so it
        // goes white; inactive is a dark grey that reads on the frost without
        // competing with the chip.
        tabBarActiveTintColor: '#FFFFFF',
        tabBarInactiveTintColor: 'rgba(0,0,0,0.45)',
        // Icons only — no text labels. Cleaner look and lets the
        // larger turtle icon breathe without crowding from a label
        // sitting under it.
        tabBarShowLabel: false,
        // Align each glyph to the chip sliding underneath it. react-navigation's
        // default item style adds padding: 5 with justifyContent: 'flex-start',
        // which pushed every icon 5pt below the chip's top edge — the icon slot
        // and the chip are both PILL_SIZE tall, so with the padding stripped
        // they share an origin and line up exactly.
        // Centre the glyph on both axes. react-navigation's default item style
        // is justifyContent: 'flex-start' with padding: 5, which top-aligns the
        // icon and offsets it; centring explicitly (and dropping the vertical
        // padding) puts the icon slot's centre on the row's centre, which is the
        // chip's centre too since both are PILL_SIZE squares in the same row.
        tabBarItemStyle: {
          paddingVertical: 0,
          justifyContent: 'center',
          alignItems: 'center',
        },
        tabBarStyle: {
          // Floating bar: absolutely positioned so the page runs UNDERNEATH it
          // (Pinterest-style) instead of being pushed above it, with a
          // transparent surface so the blur in tabBarBackground is what you see
          // through. Screens keep their content clear of it with
          // useBottomTabBarHeight(), which reports this bar's real height.
          position: 'absolute',
          backgroundColor: 'transparent',
          // Elevation would paint an opaque Android shadow surface under the
          // bar, defeating the underlay.
          elevation: 0,
          // A hairline along the TOP edge of the bottom nav — the device's
          // thinnest renderable line (StyleSheet.hairlineWidth, ~0.5px) in the
          // faint theme border colour, so the bar reads as its own surface,
          // just barely separated from the content above it.
          // No top border: the bar is a detached CARD now, so its edge is the
          // card's own hairline (drawn in tabBarBackground) rather than a rule
          // spanning the screen.
          borderTopWidth: 0,
          // Floats clear of the screen bottom, like the chat composer: the
          // safe-area inset becomes a MARGIN under the card instead of padding
          // inside it, which is what detaches it from the home indicator.
          height: BAR_CONTENT_HEIGHT,
          marginHorizontal: CARD_MARGIN_H,
          marginBottom: insets.bottom + CARD_GAP_BOTTOM,
          // SYMMETRIC vertical padding — this is what makes the icons land dead
          // centre on the chip. The inner content box is left exactly PILL_SIZE
          // tall, so navigation's centred icon and the top-anchored chip occupy
          // the same square instead of drifting apart (see tabBarLayout).
          paddingTop: BAR_VERTICAL_PAD,
          paddingBottom: BAR_VERTICAL_PAD,
          // Pull the tabs into a CENTRED CLUSTER of fixed-width slots instead of
          // stretching them edge to edge — the Pinterest nav's proportions. The
          // items still flex, so narrowing the row is what tightens the spacing;
          // the sliding chip reads the same geometry from tabBarLayout, so the
          // two can't disagree about where a slot sits.
          paddingHorizontal: clusterPadding(windowWidth - CARD_MARGIN_H * 2, tabCount),
        },
        // One accent pill that SLIDES between tabs, painted behind the buttons.
        // tabBarBackground is composited under navigation's own tab buttons, so
        // this adds the indicator without touching their layout or a11y.
        tabBarBackground: () => <TabBarPill />,
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
  // App typeface. Held behind the SAME startup gate as the auth check below, so
  // no screen ever paints in the system face and then reflows when Figtree
  // lands. Costs nothing extra at launch: it loads while the token is checked.
  const fontsLoaded = useAppFonts();

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

  // Show loading spinner while checking for saved token / loading the typeface
  if (isLoading || !fontsLoaded) {
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
              <AuthProvider>
                {/* Upload owners consume immutable auth identity while remaining
                    app-level, so screen/share-sheet unmounts never stop them. */}
                <ShareUploadProvider>
                  <VaultUploadProvider>
                  <DownloadsProvider>
                  <MusicPlayerProvider>
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
                       </CelebrationProvider>
                      </CommandBusProvider>
                    </ClaudeQueueProvider>
                  </VaultProvider>
                  </MusicPlayerProvider>
                  </DownloadsProvider>
                  </VaultUploadProvider>
                </ShareUploadProvider>
              </AuthProvider>
            </ServerProvider>
          </ThemeProvider>
        </SafeAreaProvider>
      </ShareIntentProvider>
    </GestureHandlerRootView>
  );
}
