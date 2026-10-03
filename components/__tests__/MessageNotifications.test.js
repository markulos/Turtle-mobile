jest.mock('expo-notifications', () => ({
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(),
}));

import { handleMessageResponse } from '../MessageNotifications';
import { takePendingChat, __resetChatIntent } from '../../services/chatIntent';
import { navigationRef, flushPendingNavigation, __resetParkedNavigation } from '../../services/navigationRef';

/**
 * What a tapped push actually does.
 *
 * `handleMessageResponse` is exported for this: the component around it is a
 * `useEffect` and a `return null`, and everything worth testing is the decision
 * it makes about one notification payload.
 */
const response = (data) => ({ notification: { request: { content: { data } } } });

beforeEach(() => {
  __resetChatIntent();
  __resetParkedNavigation();
});

describe('a message notification', () => {
  test('asks for the conversation with whoever sent it', () => {
    expect(handleMessageResponse(response({ type: 'message', withUserId: 'u7' }))).toBe(true);
    expect(takePendingChat()).toBe('u7');
  });

  test('asks BEFORE navigating, so a cold start finds it already parked', () => {
    // The screen reads the parked request as it mounts, and the navigator is
    // what mounts it. Reversed, the tab comes up to an empty hand-off.
    const order = [];
    jest.spyOn(navigationRef, 'isReady').mockImplementation(() => {
      order.push(takePendingChat() ? 'request-was-there' : 'nothing-yet');
      return false;
    });
    handleMessageResponse(response({ type: 'message', withUserId: 'u7' }));
    expect(order).toEqual(['request-was-there']);
    navigationRef.isReady.mockRestore();
  });
});

describe('notifications this one has no business with', () => {
  test.each([
    ['pomodoro', { type: 'pomodoro' }],
    ['a vault unlock', { type: 'vault-unlock' }],
    ['no type at all', {}],
  ])('%s is left alone', (_label, data) => {
    expect(handleMessageResponse(response(data))).toBe(false);
    expect(takePendingChat()).toBeNull();
  });

  test('a message with nobody named is ignored rather than opening a blank thread', () => {
    expect(handleMessageResponse(response({ type: 'message' }))).toBe(false);
    expect(handleMessageResponse(response({ type: 'message', withUserId: '  ' }))).toBe(false);
    expect(takePendingChat()).toBeNull();
  });

  test('a malformed response does not throw inside a notification handler', () => {
    for (const bad of [undefined, null, {}, { notification: {} }]) {
      expect(() => handleMessageResponse(bad)).not.toThrow();
      expect(handleMessageResponse(bad)).toBe(false);
    }
  });
});

describe('the tab a cold start asked for', () => {
  test('is parked while the navigator is still mounting, and replayed on ready', () => {
    const navigate = jest.fn();
    const ready = jest.spyOn(navigationRef, 'isReady').mockReturnValue(false);
    jest.spyOn(navigationRef, 'navigate').mockImplementation(navigate);

    handleMessageResponse(response({ type: 'message', withUserId: 'u7' }));
    // Nothing yet — this is the bug a bare navigate() would have: silently
    // dropped, and the app opens on whatever tab it was last on.
    expect(navigate).not.toHaveBeenCalled();

    ready.mockReturnValue(true);
    flushPendingNavigation();
    expect(navigate).toHaveBeenCalledWith('Profile');

    // Replaying again must not bounce the user back to the tab a second time.
    navigate.mockClear();
    flushPendingNavigation();
    expect(navigate).not.toHaveBeenCalled();

    navigationRef.isReady.mockRestore();
    navigationRef.navigate.mockRestore();
  });

  test('goes straight there when the app is already running', () => {
    const navigate = jest.fn();
    jest.spyOn(navigationRef, 'isReady').mockReturnValue(true);
    jest.spyOn(navigationRef, 'navigate').mockImplementation(navigate);

    handleMessageResponse(response({ type: 'message', withUserId: 'u7' }));
    expect(navigate).toHaveBeenCalledWith('Profile');

    navigationRef.isReady.mockRestore();
    navigationRef.navigate.mockRestore();
  });
});
