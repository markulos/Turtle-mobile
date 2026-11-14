import fs from 'fs';
import path from 'path';

/**
 * THE APP HAS ONE KEYBOARD, and this is what keeps it that way.
 *
 * Anything that moves with the keyboard takes its position from
 * utils/keyboardMotion, which reads the keyboard every frame on the UI thread.
 * The older ways all LOOK right in a still screenshot and all feel wrong in
 * the hand:
 *
 *   • a timed guess — `keyboardWillShow` → `Animated.timing` with a bezier
 *     standing in for the keyboard's spring. Close at the ends, adrift between.
 *   • a state snap — the keyboard's height in React state, taken by layout.
 *     The bar is home before the keyboard has left.
 *   • React Native's own KeyboardAvoidingView — a layout prop animated from
 *     JS, a beat behind.
 *   • Reanimated's `useAnimatedKeyboard` — per frame, but a frame late, blind
 *     inside a Modal, and deprecated in Reanimated 4.
 *
 * A convention nobody enforces drifts back — the same reasoning behind the
 * header-rule scan and the INPUT_FIELD one.
 *
 * ─── The lists are allowed to SHRINK and nothing else ──────────────────────
 *
 * The files below still use an older way. They are not exceptions; they are
 * the work that has not been done yet, named so it is visible. Converting one
 * means deleting its line. Adding a line means a new surface has gone its own
 * way, which is what the exact-match tests are here to stop.
 */
const ROOT = path.resolve(__dirname, '..', '..');
const ROOTS = ['screens', 'components'];
const EXT = new Set(['.js', '.jsx']);

/**
 * Still listening for `keyboardWillShow` themselves. Most of these only PAD a
 * scroll body (off-screen content, nothing to animate) — but each is one edit
 * away from timing a lift off the event again, so they are counted.
 */
const LISTENERS_NOT_YET = [
  'screens/NotesScreen/index.jsx',
  'screens/TasksScreen/components/CalendarView.jsx',
  'screens/TasksScreen/index.jsx',
  'screens/TurtleScreen/components/PhotoViewer/ViewerSheet.jsx',
  'screens/TurtleScreen/index.jsx',
];

/** Still on Reanimated's deprecated keyboard hook. */
const REANIMATED_HOOK_NOT_YET = [
  'screens/NotesScreen/index.jsx',
  // Put back on purpose (owner, 2026-11-14): same source as the main chat.
  // It leaves this list WITH the main chat, not before it.
  'screens/ProfileScreen/components/FriendChatPage.jsx',
  'screens/TurtleScreen/components/AlbumActionsSheet.jsx',
  'screens/TurtleScreen/components/AlbumPickerSheet.jsx',
  'screens/TurtleScreen/components/BoardTimeline.jsx',
  'screens/TurtleScreen/components/MediaGallery.jsx',
  'screens/TurtleScreen/components/TrackActionsSheet.jsx',
  'screens/TurtleScreen/components/VaultShareSheet.jsx',
  'screens/TurtleScreen/index.jsx',
];

/** Still importing React Native's own KeyboardAvoidingView. */
const CORE_AVOIDING_VIEW_NOT_YET = [
  'components/KeyboardSafeView.jsx',
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (EXT.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

const FILES = ROOTS.flatMap((r) => walk(path.join(ROOT, r))).map((full) => ({
  rel: path.relative(ROOT, full).split(path.sep).join('/'),
  src: fs.readFileSync(full, 'utf8'),
}));

const filesWhere = (test) => FILES.filter((f) => test(f.src)).map((f) => f.rel).sort();

/** `KeyboardAvoidingView` named inside the `from 'react-native'` import. */
function importsCoreAvoidingView(src) {
  const blocks = src.match(/import\s*\{[^}]*\}\s*from\s*'react-native';/g) || [];
  return blocks.some((b) => /\bKeyboardAvoidingView\b/.test(b));
}

describe('one keyboard', () => {
  test('nothing new times itself off keyboardWillShow', () => {
    // A quoted event name is a listener; the same words in a comment are not.
    const found = filesWhere((src) => /['"]keyboardWillShow['"]/.test(src));
    expect(found).toEqual([...LISTENERS_NOT_YET].sort());
  });

  test('nothing new reads the keyboard through Reanimated', () => {
    // An assignment is a call; the same words in a comment are not.
    const found = filesWhere((src) => /=\s*useAnimatedKeyboard\(/.test(src));
    expect(found).toEqual([...REANIMATED_HOOK_NOT_YET].sort());
  });

  test("nothing new wraps itself in React Native's KeyboardAvoidingView", () => {
    expect(filesWhere(importsCoreAvoidingView)).toEqual([...CORE_AVOIDING_VIEW_NOT_YET].sort());
  });

  test('the bezier that stood in for the keyboard is gone', () => {
    // 0.17, 0.59, 0.4, 0.77 — pasted from file to file as "the iOS keyboard
    // ease". It is not the keyboard's curve; nothing is, but the keyboard.
    expect(filesWhere((src) => /bezier\(\s*0\.17,\s*0\.59,\s*0\.4,\s*0\.77\s*\)/.test(src))).toEqual([]);
  });
});

describe('one keyboard for every chat composer', () => {
  const read = (rel) => FILES.find((f) => f.rel === rel).src;

  test('the composer sets everything that changes the keyboard size', () => {
    // Autocorrect, spell-check and autofill each bring the suggestion bar,
    // which makes the keyboard taller. iOS opens the keyboard at its LAST
    // size and then corrects it, so two composers that disagree hand each
    // other a two-step rise.
    const src = read('components/ChatComposer.jsx');
    const defaults = src.slice(src.indexOf('<AppTextInput'), src.indexOf('{...(inputProps || {})}'));
    expect(defaults).toMatch(/autoCorrect=\{false\}/);
    expect(defaults).toMatch(/spellCheck=\{false\}/);
    expect(defaults).toMatch(/autoComplete="off"/);
    expect(defaults).toMatch(/textContentType="none"/);
  });

  test('no composer switches any of them back on', () => {
    const users = FILES.filter((f) => /<ChatComposer\b/.test(f.src));
    expect(users.length).toBeGreaterThan(1);
    for (const f of users) {
      expect([f.rel, /spellCheck:\s*true|autoCorrect:\s*true/.test(f.src)]).toEqual([f.rel, false]);
    }
  });
});

describe('the surfaces that ride the keyboard', () => {
  const read = (rel) => FILES.find((f) => f.rel === rel).src;

  test('the friend chat: composer and conversation take ONE transform', () => {
    const src = read('screens/ProfileScreen/components/FriendChatPage.jsx');
    expect(src).toMatch(/keyboardLift\(keyboard\.height\.value, 1, dockRest, KEYBOARD_GAP\)/);
    // Rigid, the way the main chat is: ONE lifted column holding both the
    // conversation and the composer. Two views given the same style are two
    // things that can settle at different times.
    expect(src.match(/keyboardRide\]\}/g)).toHaveLength(1);
    expect(src).toMatch(/style=\{\[s\.column, keyboardRide\]\}/);
  });

  test('the friend chat: the keyboard changes no layout', () => {
    const src = read('screens/ProfileScreen/components/FriendChatPage.jsx');
    // The snap this replaced: the keyboard's height as the composer's margin,
    // which re-measured the dock and re-padded the list on the first frame.
    expect(src).toMatch(/marginBottom=\{dockRest\}/);
    expect(src).not.toMatch(/marginBottom=\{keyboard\b/);
    // And no JS on the keyboard at all — the main chat runs none. A scroll
    // fired when the keyboard came up was a second motion on top of the ride.
    expect(src).not.toMatch(/useKeyboardHeight/);
    expect(src).not.toMatch(/keyboardUp/);
    // Nor a re-render: the parent re-renders on every keyboard event, and a
    // list re-rendered mid-ride re-settles — the messages' second step.
    expect(src).toMatch(/export default React\.memo\(FriendChatPage\);/);
    expect(src).toMatch(/contentContainerStyle=\{listContentStyle\}/);
    const parent = read('screens/ProfileScreen/index.jsx');
    expect(parent).toMatch(/onClose=\{closeChat\}/);
    // And the parent does not even LISTEN to the keyboard while the chat is
    // up: a whole screen committing mid-ride stalls the ride.
    expect(parent).toMatch(/useKeyboardHeight\(!chatFriend\)/);
    // What that scroll was really for — seeing your own message after sending
    // from up in history — now hangs off the send itself.
    expect(src).toMatch(/setSentTick\(\(t\) => t \+ 1\)/);
  });

  test.each([
    ['components/CommandConsole.jsx', /useKeyboardLiftAnimated\(\{ rest: insets\.bottom, enabled: visible \}\)/],
    ['screens/TurtleScreen/components/TerminalConsole.jsx', /useKeyboardLiftAnimated\(\{ enabled: fullscreen \}\)/],
    ['screens/TasksScreen/components/TaskForm.jsx', /useKeyboardLiftAnimated\(\{ rest: insets\.bottom \|\| 0, gap: FOOTER_GAP \}\)/],
    ['components/AccentColorPicker.jsx', /useKeyboardLiftAnimated\(\{ enabled: visible \}\)/],
  ])('%s rides the keyboard instead of timing itself', (rel, lift) => {
    const src = read(rel);
    expect(src).toMatch(lift);
    expect(src).not.toMatch(/Keyboard\.addListener/);
  });

  test.each([
    'screens/LoginScreen/index.js',
    'screens/PasswordsScreen/components/ChangeMasterPasswordModal.jsx',
    'screens/PasswordsScreen/components/SetupScreen.jsx',
    'screens/PasswordsScreen/components/UnlockScreen.jsx',
  ])('%s avoids the keyboard through the keyboard controller', (rel) => {
    expect(read(rel)).toMatch(/import \{ KeyboardAvoidingView \} from 'react-native-keyboard-controller';/);
  });
});
