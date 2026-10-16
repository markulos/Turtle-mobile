import fs from 'fs';
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../../../utils/haptics', () => ({
  tapHaptic: jest.fn(), impactHaptic: jest.fn(), notifyHaptic: jest.fn(), markGesture: jest.fn(),
}));

import SendInTurtleSheet, { sendPlan, sendSummary } from '../SendInTurtleSheet';

const theme = {
  mode: 'dark',
  colors: {
    background: '#000', surface: '#0a0a0a', surfaceElevated: '#111', border: '#222',
    textPrimary: '#fff', textSecondary: '#aaa', textTertiary: '#888', textMuted: '#666',
    accentInfo: '#4aa', accentSuccess: '#4ADE80', primary: '#fa0',
  },
};

const PEOPLE = [
  { userId: 'u2', name: 'Sam', avatarUrl: null },
  { userId: 'u3', name: 'Lee', avatarUrl: null },
];

const draw = (props = {}) => render(
  <SendInTurtleSheet
    visible
    people={PEOPLE}
    count={1}
    onClose={jest.fn()}
    onSend={jest.fn()}
    theme={theme}
    {...props}
  />,
);

/**
 * SIX TO A MESSAGE is the protocol's limit, not a hint. A cap nobody mentions
 * is how photos go missing between two people.
 */
describe('what it promises before you tap', () => {
  it('counts the messages the photos will arrive as', () => {
    expect(sendPlan(1)).toEqual({ count: 1, messages: 1 });
    expect(sendPlan(6)).toEqual({ count: 6, messages: 1 });
    expect(sendPlan(7)).toEqual({ count: 7, messages: 2 });
    expect(sendPlan(0)).toEqual({ count: 0, messages: 0 });
  });

  it('says the split out loud only when there is one', () => {
    expect(sendSummary(1)).toBe('1 photo');
    expect(sendSummary(3)).toBe('3 photos');
    expect(sendSummary(7)).toBe('7 photos, as 2 messages');
  });

  it('survives junk rather than rendering NaN at somebody', () => {
    expect(sendSummary(undefined)).toBe('0 photos');
    expect(sendSummary(-4)).toBe('0 photos');
  });

  it('prints the summary on the sheet', async () => {
    const view = await draw({ count: 7 });
    expect(view.getByText('7 photos, as 2 messages')).toBeTruthy();
  });
});

describe('choosing who', () => {
  it('draws nothing at all when it is not up', async () => {
    expect((await draw({ visible: false })).toJSON()).toBeNull();
  });

  it('lists the people it was handed, and reports the one tapped', async () => {
    const onSend = jest.fn();
    const view = await draw({ onSend });
    expect(view.getByText('Sam')).toBeTruthy();
    await act(async () => { fireEvent.press(view.getByTestId('send-in-turtle-u3')); });
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u3' }));
  });

  it('says what to do when the pond is only you', async () => {
    const view = await draw({ people: [] });
    expect(view.getByText(/Nobody else is in this pond yet/)).toBeTruthy();
  });

  // A second tap mid-send would be a second copy of the same photos in the
  // thread, which is not something the other person can undo.
  it('takes no second tap while one send is running', async () => {
    const onSend = jest.fn();
    const view = await draw({ onSend, busyFor: 'u2' });
    await act(async () => { fireEvent.press(view.getByTestId('send-in-turtle-u2')); });
    await act(async () => { fireEvent.press(view.getByTestId('send-in-turtle-u3')); });
    expect(onSend).not.toHaveBeenCalled();
  });
});

/**
 * The wiring, which no render test here can see: MediaGallery is six thousand
 * lines over expo-video, Reanimated and FlashList, and what matters is WHERE
 * the sheet is mounted and WHAT the share key does before it downloads
 * anything.
 */
describe('the gallery offers it wherever a photo is shared', () => {
  const SRC = fs.readFileSync('screens/TurtleScreen/components/MediaGallery.jsx', 'utf8');
  const CODE = SRC
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length));

  it('asks before it downloads a single original', () => {
    // The bulk key used to go straight to the OS sheet, which for somebody in
    // this pond means downloading every original, handing it to another app,
    // and uploading it back into the pond it just left.
    const key = CODE.slice(CODE.indexOf('testID="gallery-share-button"'));
    const press = key.slice(key.indexOf('onPress={'), key.indexOf('</TouchableOpacity>'));
    expect(press).toMatch(/openSendInTurtle\(ids\)/);
    expect(press).toMatch(/shareSelectionOutside\(\)/);
    // And the expensive path is still there, named, as the other answer.
    expect(CODE).toMatch(/const shareSelectionOutside = useCallback\(async/);
  });

  it('offers the same thing from the viewer’s share sheet', () => {
    expect(CODE).toMatch(/testID="share-send-in-turtle"/);
    expect(CODE).toMatch(/openSendInTurtle\(\[m\?\.id\]\)/);
  });

  it('posts the ids it already has — no download, no upload', () => {
    const send = CODE.slice(
      CODE.indexOf('const sendInTurtle = useCallback'),
      CODE.indexOf('}, [api, sendInTurtleIds]);'),
    );
    expect(send).toMatch(/api\.post\(`\/messages\/\$\{encodeURIComponent\(person\.userId\)\}`/);
    expect(send).toMatch(/attachments: toAttachments\(batch\)/);
    expect(send).not.toMatch(/downloadAsync|uploadPickedAsset/);
    // In batches of six, because that is what a message holds.
    expect(send).toMatch(/i \+= MAX_MESSAGE_ATTACHMENTS/);
  });

  it('never offers to send to yourself', () => {
    expect(CODE).toMatch(/p\.userId !== myUserId/);
  });

  it('is mounted at the screen root, over the viewer that raises it', () => {
    // A parent's zIndex or overflow outranks whatever the sheet carries, and
    // the viewer is a Modal — so this has to be an in-tree overlay mounted
    // beside the other root sheets (STYLE-RULES §4).
    const mount = CODE.indexOf('<SendInTurtleSheet');
    expect(mount).toBeGreaterThan(-1);
    expect(mount).toBeGreaterThan(CODE.indexOf('<EdgeSwipePage overlay visible={photosOpen}'));
    const sheet = fs.readFileSync('screens/TurtleScreen/components/SendInTurtleSheet.jsx', 'utf8');
    expect(sheet).toMatch(/layer: \{ zIndex: 1000 \}/);
    expect(sheet).not.toMatch(/<Modal/);
  });
});

/**
 * The other direction: the pond's own library as a source for a DM.
 */
describe('the chat can attach from Turtle photos', () => {
  const CHAT = fs.readFileSync('screens/ProfileScreen/components/FriendChatPage.jsx', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length));

  it('asks where from, in the Turtle chat’s own words', () => {
    // Two places asking the same question should ask it the same way.
    expect(CHAT).toMatch(/Alert\.alert\('Attach a photo'/);
    expect(CHAT).toMatch(/text: 'Turtle photos'/);
    expect(CHAT).toMatch(/text: 'Phone library'/);
  });

  it('mounts the same picker the Turtle chat uses', () => {
    expect(CHAT).toMatch(/<VaultImagePicker/);
    expect(CHAT).toMatch(/onPick=\{addFromVault\}/);
  });

  it('a vault photo is already a media id, so nothing uploads', () => {
    const upload = CHAT.slice(
      CHAT.indexOf('const uploadOf = useCallback'),
      CHAT.indexOf('const started = uploadPickedAsset'),
    );
    expect(upload).toMatch(/if \(entry\.mediaId\)/);
    expect(upload).toMatch(/Promise\.resolve\(entry\.mediaId\)/);
  });

  it('respects the six-attachment room the strip already enforces', () => {
    const add = CHAT.slice(
      CHAT.indexOf('const addFromVault = useCallback'),
      CHAT.indexOf('}, [photos, uploadOf, photoOrigin]);'),
    );
    expect(add).toMatch(/attachmentRoom\(photos\)/);
    expect(add).toMatch(/\.slice\(0, Math\.max\(room, 0\)\)/);
  });
});
