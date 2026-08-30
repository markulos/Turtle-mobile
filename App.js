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
import { clusterPadding, BAR_CONTENT_HEIGHT, BAR_VERTICAL_PAD, CARD_MARGIN_H, CARD_GAP_BOTTOM, DOCK_CONTENT_Y_NUDGE } from './components/tabBarLayout';
import { avatarAnimal } from './utils/avatar';
import ProfileScreen from './screens/ProfileScreen';
import VaultUnlockApproval from './components/VaultUnlockApproval';
import GestureProbeOverlay from './components/GestureProbeOverlay';
import gestureProbe from './utils/gestureProbe';
import DevProfiler from './components/DevProfiler';
import PomodoroNotifications from './components/PomodoroNotifications';
import { runCacheMaintenanceOnBackground } from './utils/cacheManager';
import ErrorBoundary, { withBoundary } from './components/ErrorBoundary';

// Guarded screens, built ONCE at module scope. A boundary created inside the
// render would be a new component type on every pass, remounting the screen and
// throwing away its state — see withBoundary. One tab crashing now costs that
// tab; the other three stay usable.
const GuardedTasks = withBoundary(TasksScreen, 'Tasks');
const GuardedNotes = withBoundary(NotesScreen, 'Notes');
const GuardedPhotos = withBoundary(PhotosScreen, 'Photos');
const GuardedVault = withBoundary(PasswordsScreen, 'Vault');
const GuardedTurtle = withBoundary(TurtleScreen, 'Turtle');
import { useAppFonts } from './utils/fonts';

// App-wide snappy touch feel: every TouchableOpacity gets a light press-in
// haptic + a crisper press fade. Installed once, before the tree renders.
installGlobalTouchFeedback();

const Tab = createBottomTabNavigator();

function TabNavigator() {
  // No isDark here any more: the dock is ghosted black in BOTH themes, so
  // nothing in this navigator's chrome branches on the theme.
  const { theme, hideVaultButton } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  // The avatar tab needs to know WHOSE avatar to draw.
  const { authIdentity } = useAuth();
  // Tabs actually rendered. The Vault tab is optional and Profile is always on,
  // so the cluster is 5 wide by default (Vault hidden) — the same width as
  // before this tab existed, which is why clusterPadding and the sliding pill
  // need no adjustment.
  const tabCount = hideVaultButton ? 5 : 6;
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
          // Profile's tab icon is the user's ANIMAL — but drawn as a bare glyph
          // like every other tab, not as the tinted disc AnimalAvatar renders.
          // Two reasons the disc was wrong here:
          //   • Style — a saturated circle among flat monochrome glyphs read as
          //     a foreign object, and its `onLight` variant was written for a
          //     WHITE active chip; the chip is the theme accent now, so a tinted
          //     disc sat on a saturated chip and muddied both.
          //   • Size — the disc was 25pt but its glyph is 55% of that, so the
          //     actual mark was ~14pt against every neighbour's 24pt.
          // As a plain glyph it takes the same 24pt and the same active/inactive
          // `color` the navigator hands every other tab, for free. The identity
          // still reads: it's the user's own animal. The full tinted avatar (and
          // any uploaded photo) still lives on the Profile screen itself.
          if (route.name === 'Profile') {
            return (
              <TabBarIcon focused={focused}>
                <Icon name={avatarAnimal(authIdentity || 'anon') || 'account-circle-outline'} size={24} color={color} />
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
        // Active sits on the accent chip, so white. Inactive follows the DOCK,
        // not the app theme — the capsule is ghosted black in both themes now
        // (see TabBarPill), so a dark light-mode tint would vanish into it.
        tabBarActiveTintColor: '#FFFFFF',
        tabBarInactiveTintColor: 'rgba(255,255,255,0.55)',
        // Icons only — no text labels. Cleaner look and lets the
        // larger turtle icon breathe without crowding from a label
        // sitting under it.
        tabBarShowLabel: false,
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
        // Force each tab button to FILL the bar's inner box and centre its glyph
        // in it. Without this the icons are only as centred as v7's own item
        // padding happens to be — it reserves label space and applies its own
        // vertical padding even with tabBarShowLabel:false, which is what left
        // the glyphs sitting off the dock's centre line. Owning the item box
        // here makes the icon's centre and the dock's centre the same point.
        tabBarItemStyle: {
          height: '100%',
          paddingTop: 0,
          paddingBottom: 0,
          justifyContent: 'center',
          alignItems: 'center',
        },
        // The icon is the item's only child, so it must not add its own margins
        // on top of that centring — except the shared vertical nudge, which is
        // the ONLY way to push the glyph down: BottomTabItem's inner pressable
        // hard-codes `justifyContent: 'flex-start'` and `padding: 5`, and
        // tabBarItemStyle only reaches the OUTER wrapper, so the glyph is
        // top-anchored no matter what the wrapper does. The chip carries the
        // same nudge (see PILL_TOP), so glyph and chip move as one block.
        tabBarIconStyle: {
          flex: 0,
          margin: 0,
          marginTop: DOCK_CONTENT_Y_NUDGE,
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
        component={GuardedTasks}
        options={{ title: 'TO-DO' }}
      />
      <Tab.Screen
        name="Notes"
        component={GuardedNotes}
        options={{ title: 'Notes' }}
      />
      <Tab.Screen
        name="Photos"
        component={GuardedPhotos}
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
          component={GuardedVault}
          options={{ title: 'Vault' }}
        />
      )}
      <Tab.Screen
        name="Turtle"
        component={GuardedTurtle}
        options={{ title: 'Turtle' }}
        listeners={{ tabLongPress: () => setConsoleOpen(true) }}
      />
      {/* Profile takes the trailing slot — the Instagram/X convention of "you"
          on the right. NOTE: this displaces the turtle mark from the trailing
          edge, where it had been the deliberate brand anchor. Deliberate trade,
          recorded here so it isn't "fixed" by accident later. */}
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ title: 'Profile' }}
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
      <NavigationContainer
        // Dev probe: tell the probe WHICH screen is focused. Its labels only
        // cover instrumented gestures (all of them in the vault today), so a
        // freeze anywhere else filed as a bare "app" with nothing to go on.
        onReady={() => gestureProbe.setScope('Tasks')}
        onStateChange={(state) => {
          if (!state) return;
          const route = state.routes?.[state.index];
          gestureProbe.setScope(route?.name || null);
        }}
      >
        {/* Times every commit under the navigator, so a stall on any screen
            names its cost the way the vault's trees already do. */}
        <DevProfiler id="tabs">
          <TabNavigator />
        </DevProfiler>
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
    <GestureHandlerRootView
      style={{ flex: 1 }}
      // DEV-ONLY touch sniff for the gesture probe. The CAPTURE phase sees
      // every touch before any child claims it, and returning false means we
      // never become the responder — so this observes without ever altering
      // gesture routing. In a release build the handler is a no-op call.
      // (Modals render into their own native root, so their touches don't
      // reach here — the photo viewer arms the probe from its own responder.)
      onStartShouldSetResponderCapture={() => { gestureProbe.touchStart('app'); return false; }}
      // Same contract for MOVES: a drag's latency is timed from the first
      // movement, not from the finger landing (a finger resting still is dwell,
      // not lag). Capture + false, so routing is untouched here too.
      onMoveShouldSetResponderCapture={() => { gestureProbe.touchMove(); return false; }}
    >
      {/* Last resort. It cannot SAVE anything — every provider below is an
          ancestor of the whole app, so a throw in one blanks the tree whether
          or not this catches it. What it buys is the difference between a white
          screen and a screen that names what failed and offers a retry, which
          on a phone with no console attached is the only diagnosis available. */}
      <ErrorBoundary label="Turtle">
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
                        <ErrorBoundary label="Turtle"><AppContent /></ErrorBoundary>
                        {/* Every floating overlay below is a SIBLING of AppContent,
                            which is what makes guarding them worth doing: none of
                            them is an ancestor of the app, so a crash in a progress
                            pill has no business blanking the screen behind it.

                            They fall back to null rather than to a card. These
                            things float OVER content at fixed corners — an error
                            box parked there would cover the app it was reporting
                            on, and would keep covering it. A vanished toast plus a
                            console line is the honest trade for UI whose whole
                            purpose is to be transient. */}
                        {/* Floating share-upload progress / outcome toast. Rendered
                            here (NOT inside ShareTargetScreen) so it persists after
                            the share sheet dismisses and overlays the main app. */}
                        <ErrorBoundary label="share toast" fallback={null}><ShareUploadToast /></ErrorBoundary>
                        {/* Floating vault-upload widget: live percentage while a
                            batch runs in the background (any screen), then the
                            finish stats + delete-originals offer. Bottom-anchored
                            so it never collides with the share toast above. */}
                        <ErrorBoundary label="vault upload pill" fallback={null}><VaultUploadPill /></ErrorBoundary>
                        {/* Floating ghost-download progress (links shared into the
                            Download album / enqueued): live % + cancel/retry, sits
                            just above the vault-upload pill. */}
                        <ErrorBoundary label="downloads pill" fallback={null}><DownloadsPill /></ErrorBoundary>
                        {/* Cross-device biometric vault unlock: surfaces an approval
                            sheet when the web vault requests an unlock push. */}
                        <ErrorBoundary label="vault unlock" fallback={null}><VaultUnlockApproval /></ErrorBoundary>
                        {/* Interactive pomodoro end notifications (Start break /
                            Start focus buttons). Renders nothing. */}
                        <ErrorBoundary label="pomodoro notifications" fallback={null}><PomodoroNotifications /></ErrorBoundary>
                        {/* DEV ONLY (null in release): watches for gestures the
                            app answered late or not at all, and turns each one
                            into a to-do carrying a ready-to-send fix prompt. */}
                        <GestureProbeOverlay />
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
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}
