// react-native-gesture-handler must be imported at the very top of the
// app entry — before anything else — so its native side is initialised
// before any gesture is registered. App.js is the registered root
// (expo/AppEntry.js → App), so this is the correct place.
import 'react-native-gesture-handler';
// The app typeface goes on next: it swaps react-native's Text / TextInput for
// Figtree-faced wrappers BEFORE any library captures the originals.
import './utils/installFont';
// Defines the background upload-drain task at module scope on EVERY launch —
// including the background launches iOS makes for it. Must run before the app.
import './services/backgroundUploadTask';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
// One shared value, owned by the navigator and read by both halves of the
// dock's drag (see dragSlot in TabNavigator).
import { useSharedValue } from 'react-native-reanimated';
// Native keyboard tracking (build 4+). The provider alone changes nothing on
// screen; it lets screens adopt useReanimatedKeyboardAnimation / KeyboardAware
// views one at a time, replacing the RN Keyboard-event guesswork.
import { KeyboardProvider } from 'react-native-keyboard-controller';
import {
  NavigationContainer,
  DefaultTheme as NavLightTheme,
  DarkTheme as NavDarkTheme,
} from '@react-navigation/native';
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
import useAccountAccent from './utils/useAccountAccent';
import { VaultUploadProvider } from './context/VaultUploadContext';
import VaultUploadPill from './components/VaultUploadPill';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { VaultProvider } from './context/VaultContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { MusicPlayerProvider } from './context/MusicPlayerContext';
import { ClaudeQueueProvider } from './context/ClaudeQueueContext';
import { CommandBusProvider } from './context/CommandBusContext';
import { OpenTargetProvider } from './context/OpenTargetContext';
import { ChromeProvider, useChrome } from './context/ChromeContext';
import { CelebrationProvider } from './context/CelebrationContext';
import { DownloadsProvider } from './context/DownloadsContext';
import { OfflineMediaProvider } from './context/OfflineMediaContext';
import DownloadsPill from './components/DownloadsPill';
import CommandConsole from './components/CommandConsole';
import TabBarIcon from './components/TabBarIcon';
import TabBarPill from './components/TabBarPill';
import { activeInk, dockSkin } from './components/dockSkins';
import { buildNavTheme } from './utils/navTheme';
import { inkModeFor, resolveDockSkin } from './components/dockThemes';
import DockTabBar from './components/DockTabBar';
import { CHIP_SLIDE_BASE_MS, TAB_SWITCH_SPEC, forTabTurn } from './components/dockMotion';
import { requestTabWhenClear, useDockSettle } from './components/dockNav';
import { useDockMotionProbe } from './components/dockMotionProbe';
import { clusterPadding, BAR_CONTENT_HEIGHT, BAR_VERTICAL_PAD, CARD_MARGIN_H, CARD_GAP_BOTTOM, DOCK_CONTENT_Y_NUDGE } from './components/tabBarLayout';
import { AnimalGlyph } from './components/AnimalAvatar';
import { useMyAvatarAnimal } from './utils/avatarChoice';
import ProfileScreen from './screens/ProfileScreen';
import VaultUnlockApproval from './components/VaultUnlockApproval';
import GestureProbeOverlay from './components/GestureProbeOverlay';
import gestureProbe from './utils/gestureProbe';
import DevProfiler from './components/DevProfiler';
import PomodoroNotifications from './components/PomodoroNotifications';
import MessageNotifications from './components/MessageNotifications';
import AttentionSync from './components/AttentionSync';
import LaunchUpdateCheck from './components/LaunchUpdateCheck';
import { attentionSummary, hasAttention, useAttention } from './utils/attention';
import { navigationRef, flushPendingNavigation } from './services/navigationRef';
import PomodoroLiveEffects from './components/PomodoroLiveEffects';
import { runCacheMaintenanceOnBackground } from './utils/cacheManager';
import ErrorBoundary, { withBoundary } from './components/ErrorBoundary';
import { withTabTiming } from './components/withTabTiming';
import { withTabSkeleton } from './components/withTabSkeleton';

// Guarded screens, built ONCE at module scope. A boundary created inside the
// render would be a new component type on every pass, remounting the screen and
// throwing away its state — see withBoundary. One tab crashing now costs that
// tab; the other three stay usable.
//
// Three wrappers, and the ORDER of them is load-bearing:
//
//   boundary ─ outermost, so a throw in the screen OR in its template shows
//              the error card instead of blanking the app;
//   skeleton ─ next, because it is the thing that decides whether the screen
//              below it is mounted at all yet (withTabSkeleton);
//   timing   ─ innermost, so it reports from the REAL screen's own commit. A
//              frame that measured the template appearing would report a tab
//              as ready while it was still a row of grey bars.
const guarded = (Screen, name, kind) => withBoundary(
  withTabSkeleton(withTabTiming(Screen, name), kind),
  name,
);
const GuardedTasks = guarded(TasksScreen, 'Tasks', 'tasks');
const GuardedNotes = guarded(NotesScreen, 'Notes', 'notes');
const GuardedPhotos = guarded(PhotosScreen, 'Photos', 'photos');
const GuardedVault = guarded(PasswordsScreen, 'Vault', 'vault');
const GuardedTurtle = guarded(TurtleScreen, 'Turtle', 'turtle');
// Profile carries no boundary or timing of its own (it never has); the template
// is independent of both, so it gets one too rather than being the one tab that
// opens on a blank page.
const FramedProfile = withTabSkeleton(ProfileScreen, 'profile');
import { useAppFonts } from './utils/fonts';

// App-wide snappy touch feel: every TouchableOpacity gets a light press-in
// haptic + a crisper press fade. Installed once, before the tree renders.
installGlobalTouchFeedback();

const Tab = createBottomTabNavigator();

// The "something is waiting on Profile" dot. The same red as the count badge
// on the Profile cards, with a white ring so it reads on every dock skin and
// on the accent chip under an active tab, whatever colour that is.
const PROFILE_DOT = {
  position: 'absolute',
  top: -3,
  right: -5,
  width: 10,
  height: 10,
  borderRadius: 5,
  borderWidth: 1.5,
  borderColor: '#FFFFFF',
};

function TabNavigator() {
  // No isDark here: the dock's material is a SKIN chosen in Settings, not a
  // function of light/dark mode, so nothing in this navigator's chrome
  // branches on the theme.
  const {
    theme, hideVaultButton, dockStyle, dockColor, dockInk, dockTheme, dockIndicator, dockInkColor,
    accentColor,
  } = useTheme();
  const skin = resolveDockSkin({ dockTheme, dockStyle, dockColor }, dockSkin);
  // The ACTIVE glyph's ink. It depends on what the glyph is sitting on — the
  // accent chip, or (with the underline) the dock itself — as well as on the
  // setting; see activeInk. One value, used for the navigator's tint and for
  // the active layer every icon cross-fades to.
  // A worn theme's or palette's fixed ink was chosen against its chip; with
  // the underline it reads as auto instead. See inkModeFor.
  const inkMode = inkModeFor({
    dockInk, dockIndicator, dockTheme, dockStyle, dockColor, accentColor,
  });
  const activeTint = activeInk(inkMode, theme.colors.accent, {
    underline: dockIndicator === 'underline',
    darkDock: skin.blurTint === 'dark',
    custom: dockInkColor,
  });
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  // The avatar tab needs to know WHOSE avatar to draw…
  const { authIdentity } = useAuth();
  // …and which animal they picked for it, if they picked one. Subscribed, so
  // the tab changes the moment the choice is made rather than at next launch.
  const myAnimal = useMyAvatarAnimal();
  // Tabs actually rendered. The Vault tab is optional and Profile is always on,
  // so the cluster is 5 wide by default (Vault hidden) — the same width as
  // before this tab existed, which is why clusterPadding and the sliding pill
  // need no adjustment.
  const tabCount = hideVaultButton ? 5 : 6;
  // Is anything waiting on Profile — an unread message, a new notification,
  // an app update? One small dot on the Profile tab says so from wherever you
  // are (utils/attention; AttentionSync and the launch update check feed it).
  // Read here rather than inside the icon so the tab's accessibility label
  // can say WHAT is waiting; it changes a few times a day, not per frame.
  const attention = useAttention();
  const profileAttention = hasAttention(attention);
  const profileAttentionLabel = attentionSummary(attention);
  const [consoleOpen, setConsoleOpen] = useState(false);
  // Where the dock's chip is while a thumb is dragging along the bar, as a
  // fractional tab index (-1 = nobody is dragging). It lives HERE because the
  // two halves of that gesture are built in two different places — the drag is
  // in the custom `tabBar`, the chip is painted through `tabBarBackground` —
  // and a shared value is the only thing both can hold that costs no re-render
  // per frame. See DockTabBar.
  const dragSlot = useSharedValue(-1);
  // …and which slot the thumb let go on, for the handful of frames between the
  // release and the navigator agreeing. Same two-places problem, same answer:
  // the drag writes it, the chip reads it, neither waits for a render.
  const leadSlot = useSharedValue(-1);
  // …and where the chip actually IS, as a fractional slot, every frame it
  // moves. The pill writes it; each tab's icon reads it and inks itself by
  // how much of the chip is under it — so the glyphs change with the chip,
  // on the UI thread, instead of in one step when React commits the change.
  const chipPos = useSharedValue(-1);
  // …and the two ENDS of the travel it is on: the tab being left and the tab
  // being arrived at. Only those two icons change ink; the ones the chip
  // merely passes over on a long move stay as they are. -2 means "no ends" —
  // a thumb is dragging the chip, and whichever icon it is over lights.
  const chipFrom = useSharedValue(-2);
  const chipTo = useSharedValue(-2);
  // ...and how long that move should take, which depends on how far it goes.
  // Written by whoever starts the move, read by the chip's worklet.
  const slideMs = useSharedValue(CHIP_SLIDE_BASE_MS);
  // The dock's press swell — 0 at rest, 1 while a finger is down. DockTabBar
  // owns the ANIMATION; the value lives here only because the probe below has
  // to be able to tell whether the swell was still running while the chip was
  // travelling (the swell scales the capsule, and the capsule is a blur view,
  // so an overlap is expensive in a way nothing else here is). DockTabBar
  // keeps its own fallback for when nobody hands it one.
  const dockPressLift = useSharedValue(0);
  // What the LAST move actually did — when it left relative to the touch, and
  // whether it kept every frame on the way across. Owned here for the same
  // reason the three values above are: the touch is stamped in the dock's
  // gesture and the travel is started by the chip, and those are two different
  // components. Reported into Settings → Navigation, in plain words, so this
  // stops being judged by eye. See components/dockMotionProbe.
  const dockProbe = useDockMotionProbe(slideMs, dockPressLift);
  // WHERE THE NAVIGATOR IS, as the chip knows it — the third thing that can
  // aim it, after a thumb and a lead. It lives here, with the other two,
  // because it has more than one writer now: the dock writes it the moment it
  // asks for a tab (the navigator's store is synchronous, so the answer is
  // known on the next line — components/dockNav), and TabBarPill writes it
  // again when React commits. -1 until the pill has mounted and read it.
  const navSlot = useSharedValue(-1);
  // …and the one way anybody tells the chip what became of a request: where
  // the navigator is now, and that the lead for that request is answered.
  // Shared by the gesture's path and the button's, so a tap that both of them
  // report is still one answer.
  const settleDock = useDockSettle(leadSlot, navSlot);
  // A LONG-PRESS is a different gesture from a tap — on Turtle it opens the
  // console — and the finger that made it still has to come off the dock.
  // Raised by `tabLongPress` below, read (and lowered) by the dock when that
  // finger lifts, so the lift is not taken for a tap on the tab underneath.
  // A ref, not a shared value: both ends are on the JS thread, and they run
  // in the order the events happened.
  const suppressDockTap = useRef(false);
  // An immersive page (the PDF reader) asks for the dock to go. `display:none`
  // is the only thing that actually removes it — the bar is the navigator's
  // own child and paints above every screen, so a page cannot cover it.
  const { dockHidden } = useChrome();

  return (
    <>
    <Tab.Navigator
      // The real bar, wrapped in one gesture: the dock can be DRAGGED, so
      // changing tabs is a thumb sliding along the capsule and not only a tap.
      // Everything about how the bar looks still comes from screenOptions
      // below — see DockTabBar for why it wraps rather than replaces.
      tabBar={(props) => (
        <DockTabBar
          {...props}
          dragSlot={dragSlot}
          leadSlot={leadSlot}
          slideMs={slideMs}
          pressLift={dockPressLift}
          navSlot={navSlot}
          probe={dockProbe}
          settle={settleDock}
          suppressTap={suppressDockTap}
        />
      )}
      // EVERY TAB STAYS ATTACHED. This is the fix for the dock lagging on a
      // long move, and the reason is in how the navigator hides a tab.
      //
      // With detaching on (the default), react-native-screens takes an
      // inactive tab's native views OUT of the hierarchy — and v7 decides
      // "inactive" from each tab's transition value: 0 for the focused tab, +1
      // to its right, -1 to its left. Its interpolation only reaches
      // "detached" at exactly +1; every tab to the LEFT of the focused one
      // (-1) is left attached, invisible. So:
      //
      //   one tab to the right    1 screen re-attached
      //   Tasks → Profile         FIVE re-attached, in a single frame — the
      //                           four tabs in between flip from +1 to -1
      //                           without animating, and each of them is a
      //                           whole screen's views going back into the
      //                           window (layout, layers, every image)
      //
      // That is main-thread work proportional to how FAR the selection moved,
      // landing a few frames after the lift — while the chip, which left on
      // the touch and takes longest on exactly these moves, is still short of
      // its target. It froze there and then finished: the "lag when it moves a
      // long distance". Going left was cheap (detaching is), which is why it
      // did not happen every time.
      //
      // Off, the navigator never attaches or detaches anything on a tab
      // change: every opened tab stays in the window and a switch is two
      // opacities and two transforms on the native driver. Nothing new is
      // being kept alive by this — half the tabs were ALREADY permanently
      // attached (everything left of the focused one), the screens never
      // froze (v7 computes `shouldFreeze` from a value that is an animated
      // node whenever a transition is configured, so `freezeOnBlur` has been
      // a no-op here), and an unfocused page sits at opacity 0 behind the
      // focused one (forTabTurn), where the compositor skips it.
      //
      // NOT the `lazy: false` that was tried and reverted (see below): a tab
      // still mounts on first visit, visible and measured. This only stops it
      // being pulled out of the window afterwards.
      detachInactiveScreens={false}
      // THE BUTTON'S PRESS GOES THROUGH THE SAME DOOR AS THE DOCK'S.
      //
      // A touch on the dock is decided by the dock's own gesture now (see
      // DockTabBar: a tap is a finger that lifted on the dock without
      // dragging), because react-navigation's button drops ordinary taps in
      // several ways — a rest longer than 500ms, a thumb roll the drag
      // recogniser takes, a touch on the strip below the capsule. But the
      // button still fires whenever it can, and for anything that is not a
      // touch at all (VoiceOver's activate, a keyboard) it is the ONLY thing
      // that fires.
      //
      // So its default — "dispatch a navigate unless I was already focused,
      // as of my last render" — is replaced by `requestTab`, which asks the
      // navigator's live state instead of a render's memory. That makes it
      // idempotent: the gesture and the button can both report the same tap,
      // in either order, and the tab changes once, with one re-render. Left
      // as the default, the second of the two would dispatch a second
      // navigate to the tab it is already on, and re-render the navigator in
      // the middle of its own transition.
      //
      // `tabLongPress` is deliberately NOT handled here: only the one tab
      // that does something with a long press listens for it (Turtle, below).
      screenListeners={({ navigation, route }) => ({
        tabPress: (e) => {
          if (e && typeof e.preventDefault === 'function') e.preventDefault();
          const st = navigation.getState();
          const i = st?.routes?.findIndex((r) => r.key === route.key);
          if (i == null || i < 0) return;
          // …when the chip has landed: the same gate the dock's own
          // request waits out (dockNav), so neither turns the page early.
          requestTabWhenClear(navigation, i, settleDock, st);
        },
      })}
      // No tabPress haptic: tab switching is silent by request. (There used to
      // be a selection tick here for every tab.)
      screenOptions={({ route, navigation }) => ({
        // The page TURNS instead of being swapped: the leaving page dissolves
        // and slides the way the selection is going, the arriving one comes in
        // from the other side — on the same curve, the same duration and the
        // same travel as the chip coming to meet it (see dockMotion, which
        // owns all three and explains every number in them).
        //
        // forTabTurn in place of v7's 'shift' preset, which is the same idea
        // with numbers we cannot reach: 50pt of travel and a cross-fade spread
        // across the whole transition. `animation` is deliberately absent —
        // naming a preset here would only pick the defaults these two options
        // replace.
        //
        // Safe against the lazy:false note below: a transition only puts a
        // transform and an opacity on screens that have already mounted and
        // measured. Nothing here mounts a screen hidden.
        transitionSpec: TAB_SWITCH_SPEC,
        sceneStyleInterpolator: forTabTurn,
        // NOTE: lazy:false + freezeOnBlur:true were tried here for instant tab
        // switches and REVERTED — screens mounted hidden at boot measure their
        // layouts wrong (zero-height grids, mis-sized scrubbers) and freeze
        // masked the re-measure. Components that need instant readiness must
        // derive their geometry from DATA, not layout (see MediaGallery's
        // analytic scrubber extent).
        tabBarIcon: ({ focused: isFocused }) => {
          // ONE ICON, DRAWN IN BOTH INKS. `draw` is the glyph for one state —
          // the filled form in the active ink, or the outline in the resting
          // one — and TabBarIcon lays the two over each other and cross-fades
          // them by how much of the chip is under this slot. See TabBarIcon:
          // the ink follows the chip, not the navigator.
          const draw = ({ focused, color }) => {
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
              <>
                <Image
                  source={TURTLE_TAB_ICON}
                  style={{
                    width: 36,
                    height: 36,
                    tintColor: color,
                    resizeMode: 'contain',
                  }}
                />
              </>
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
          //
          // A CHOSEN animal wins over the assigned one here, exactly as it does
          // on the Profile card — the tab is the most-seen picture of "you" in
          // the app, and leaving it on the assigned animal made the choice look
          // like it had only half applied. A chosen animal is an emoji, so it
          // keeps its own colour instead of taking `color`; that is the cost of
          // being able to pick an animal the icon font does not have, and it
          // still reads correctly on both the plain and the accent-chip states.
          if (route.name === 'Profile') {
            return (
              <>
                {/* The wrapper is the glyph's own 24pt box, so the dot hangs
                    off the animal's corner and rides the icon's press scale. */}
                <View>
                  <AnimalGlyph
                    id={authIdentity || 'anon'}
                    animal={myAnimal}
                    size={24}
                    color={color}
                    testID="tab-profile-animal"
                  />
                  {profileAttention ? (
                    <View
                      pointerEvents="none"
                      testID="tab-profile-attention"
                      style={[
                        PROFILE_DOT,
                        { backgroundColor: theme.colors.accentError || '#F87171' },
                      ]}
                    />
                  ) : null}
                </View>
              </>
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
            <>
              <Icon name={iconName} size={24} color={color} />
            </>
          );
          };
          let slot = -1;
          try {
            slot = navigation.getState().routes.findIndex((r) => r.key === route.key);
          } catch {
            // No state yet: the icon falls back to `focused`.
          }
          return (
            <TabBarIcon
              focused={isFocused}
              brand={route.name === 'Turtle'}
              slot={slot}
              chipPos={chipPos}
              chipFrom={chipFrom}
              chipTo={chipTo}
              active={draw({ focused: true, color: activeTint })}
              inactive={draw({ focused: false, color: skin.inactiveTint })}
            />
          );
        },
        // Active sits ON the accent chip, so its ink is derived from the chosen
        // highlight colour: white was right for every saturated preset and
        // invisible the moment the accent could be a pale pink. Derived
        // UNLESS Settings says otherwise — the contrast check optimises for
        // legibility, and on a mid-toned accent which of the two answers looks
        // right is a matter of taste (dockSkins' activeInk). Inactive
        // follows the DOCK's SKIN, not the app theme — the glyphs sit on the
        // capsule, so white-on-smoked and dark-on-paper are properties of the
        // material, and a theme-derived tint would vanish into one of them.
        tabBarActiveTintColor: activeTint,
        tabBarInactiveTintColor: skin.inactiveTint,
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
          // Last, so it wins over everything above: the whole card (blur
          // background included) leaves while an immersive page is up, and
          // comes back the moment that page releases its hold.
          ...(dockHidden ? { display: 'none' } : null),
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
        tabBarBackground: () => (
          <TabBarPill
            dragSlot={dragSlot}
            leadSlot={leadSlot}
            navSlot={navSlot}
            chipPos={chipPos}
            chipFrom={chipFrom}
            chipTo={chipTo}
            slideMs={slideMs}
            probe={dockProbe}
            pressLift={dockPressLift}
          />
        ),
        headerShown: false, // Hide default header
      })}
    >
      {/* Tab order: Tasks → Notes → Photos → Turtle. Settings has
          moved off the tab bar — it lives behind the gear icon in
          the top-right corner of the Turtle page. With Turtle now
          on the RIGHT, the brand glyph anchors the trailing edge of
          the nav and reads as the user's "home" the way Twitter /
          Threads pin their compose button to the right. */}
      {/* freezeOnBlur here and on Notes, and deliberately NOWHERE else.
          A blurred screen still re-renders on every context change — a
          downloads socket event, a mediaVersion bump — and that work lands on
          the same JS thread the tab you ARE on needs. Freezing stops it.

          This is NOT the change that was reverted above. That was lazy:false,
          which mounts screens HIDDEN at boot and makes them measure their
          layouts against nothing; freeze merely masked the re-measure that
          would have corrected it. With lazy:true a screen still mounts visible
          and measures correctly, and freeze only suspends re-renders after it
          has been seen.

          Restricted to the two list screens because the note's constraint is
          per-component: Photos and Turtle carry the gallery, whose scrubber
          extent is measured rather than derived, and that is exactly the kind
          of geometry a suspended re-render can stale. They keep re-rendering. */}
      <Tab.Screen
        name="Tasks"
        component={GuardedTasks}
        options={{ title: 'TO-DO', freezeOnBlur: true }}
      />
      <Tab.Screen
        name="Notes"
        component={GuardedNotes}
        options={{ title: 'Notes', freezeOnBlur: true }}
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
        listeners={{
          tabLongPress: () => {
            // The one long press in the app that means something. Flagged so
            // the dock does not take the finger coming off the glass for a
            // tap, and change tabs underneath the console it just opened.
            suppressDockTap.current = true;
            setConsoleOpen(true);
          },
        }}
      />
      {/* Profile takes the trailing slot — the Instagram/X convention of "you"
          on the right. NOTE: this displaces the turtle mark from the trailing
          edge, where it had been the deliberate brand anchor. Deliberate trade,
          recorded here so it isn't "fixed" by accident later. */}
      <Tab.Screen
        name="Profile"
        component={FramedProfile}
        options={{
          title: 'Profile',
          // The dot is silent to a screen reader; the label is how it speaks.
          tabBarAccessibilityLabel: profileAttentionLabel
            ? `Profile, ${profileAttentionLabel}`
            : 'Profile',
        }}
      />
    </Tab.Navigator>
    <CommandConsole visible={consoleOpen} onClose={() => setConsoleOpen(false)} />
    </>
  );
}

/**
 * Reconciles this phone's highlight colour with the account's. Renders
 * nothing — it is a component only because ThemeProvider sits above
 * ServerProvider and so cannot reach the api itself. See useAccountAccent.
 */
function AccountAccentSync() {
  useAccountAccent();
  return null;
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

  // What shows BETWEEN two cross-fading pages during a tab turn — see
  // utils/navTheme for why the library's own default made that flash pale.
  //
  // UP HERE, above every early return in this component, because that is
  // where hooks have to live: AppContent returns early three times before the
  // navigator (loading, a share intent, not signed in), so a useMemo further
  // down runs on SOME renders and not others — and the render that first gets
  // past those gates then has more hooks than the one before it, which React
  // refuses outright ("Rendered more hooks than during the previous render").
  // It took the app down on the first launch after the change, not at the
  // moment of the tab turn it belongs to.
  const navTheme = useMemo(
    () => buildNavTheme(isDark, theme, { light: NavLightTheme, dark: NavDarkTheme }),
    [isDark, theme],
  );

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
      {/* THE BACKDROP, and the reason a tab change flashed white.
          A turn cross-fades the two pages (forTabTurn), and for the middle
          ~40% of it NEITHER is opaque — at the midpoint they are about 0.57
          and 0.43, which do not even add up to one. Each scene's own dark
          background is INSIDE the view being faded, so it goes translucent
          with it, and what shows through underneath is the native root view:
          white. Giving the navigator a dark theme does not fix this, because
          that colour is on the layer that is fading.
          So: one opaque layer BEHIND the navigator that never animates. */}
      <View style={[styles.appBackdrop, { backgroundColor: theme.colors.background }]}>
      <NavigationContainer
        theme={navTheme}
        // The handle a notification tap steers by — it has no component to
        // navigate from. See services/navigationRef.
        ref={navigationRef}
        // Dev probe: tell the probe WHICH screen is focused. Its labels only
        // cover instrumented gestures (all of them in the vault today), so a
        // freeze anywhere else filed as a bare "app" with nothing to go on.
        onReady={() => {
          gestureProbe.setScope('Tasks');
          // A tap that launched the app from cold was handled before this
          // existed, and parked the tab it wanted. This is where it lands.
          flushPendingNavigation();
        }}
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
      </View>
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
      <KeyboardProvider>
      <ShareIntentProvider>
        <SafeAreaProvider>
          <ThemeProvider>
            <ServerProvider>
              <AuthProvider>
                {/* Upload owners consume immutable auth identity while remaining
                    app-level, so screen/share-sheet unmounts never stop them. */}
                <ShareUploadProvider>
                  <VaultUploadProvider>
                  {/* Which pictures are kept on the phone. App-level because
                      both the viewer's Save button and the page that paints
                      the picture read it, and Settings reports its size. */}
                  <OfflineMediaProvider>
                  <DownloadsProvider>
                  <MusicPlayerProvider>
                  <VaultProvider>
                    <ClaudeQueueProvider>
                      <CommandBusProvider>
                      <OpenTargetProvider>
                      {/* Lets an immersive page (the PDF reader) take the
                          floating dock away while it is up — the dock is the
                          navigator's, drawn above every screen, so it cannot
                          be covered from inside one. See ChromeContext. */}
                      <ChromeProvider>
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
                        {/* Keeps this phone's highlight colour and the
                            account's the same one, so a colour picked here
                            shows up on the web and the other way round.
                            Draws nothing; guarded like its neighbours so a
                            failed settings read can never blank the app. */}
                        <ErrorBoundary label="accent sync" fallback={null}><AccountAccentSync /></ErrorBoundary>
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
                        {/* Tapping a message push opens that conversation
                            instead of dropping you on the last tab you used.
                            Root-mounted because the tab a thread lives on is
                            lazy, and a cold start's tap arrives before it.
                            Renders nothing. */}
                        <ErrorBoundary label="message notifications" fallback={null}><MessageNotifications /></ErrorBoundary>
                        {/* The Profile tab's dot: unread messages and task notifications,
                            counted from here because the Profile tab is lazy and cannot
                            know what is waiting on it until it has been opened. */}
                        <ErrorBoundary label="attention sync" fallback={null}><AttentionSync /></ErrorBoundary>
                        {/* A newer app update is fetched quietly after launch and applies
                            on the next open — so a bad update heals without any menus. */}
                        <ErrorBoundary label="launch update check" fallback={null}><LaunchUpdateCheck /></ErrorBoundary>
                        {/* The iOS Live Activity and the completion confetti,
                            driven from here rather than from inside the lazy
                            Turtle tab — so a focus block started on the desktop
                            reaches this phone's lock screen whether or not that
                            tab was ever opened. Renders nothing. */}
                        <ErrorBoundary label="pomodoro live effects" fallback={null}><PomodoroLiveEffects /></ErrorBoundary>
                        {/* DEV ONLY (null in release): watches for gestures the
                            app answered late or not at all, and turns each one
                            into a to-do carrying a ready-to-send fix prompt. */}
                        <GestureProbeOverlay />
                       </CelebrationProvider>
                      </ChromeProvider>
                      </OpenTargetProvider>
                      </CommandBusProvider>
                    </ClaudeQueueProvider>
                  </VaultProvider>
                  </MusicPlayerProvider>
                  </DownloadsProvider>
                  </OfflineMediaProvider>
                  </VaultUploadProvider>
                </ShareUploadProvider>
              </AuthProvider>
            </ServerProvider>
          </ThemeProvider>
        </SafeAreaProvider>
      </ShareIntentProvider>
      </KeyboardProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  // Behind the whole navigator: the one opaque layer a cross-fading tab turn
  // can show through to. Never animated, never themed by the navigation
  // library — see the comment at its usage.
  appBackdrop: { flex: 1 },
});
