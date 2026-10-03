import {
  requestChat,
  subscribeChatIntent,
  takePendingChat,
  __resetChatIntent,
} from '../chatIntent';

/**
 * The hand-off between a notification tap and the screen that owns the thread.
 *
 * Both halves of it are easy to get subtly wrong in ways that only show up from
 * a KILLED app, which is the one state nobody re-tests by hand: deliver to
 * nobody and the tap is lost, or park a copy as well and the same conversation
 * reopens every time the tab is next visited.
 */
beforeEach(() => __resetChatIntent());

describe('a request made while the screen is listening', () => {
  test('goes straight to it', () => {
    const seen = [];
    subscribeChatIntent((id) => seen.push(id));
    requestChat('u7');
    expect(seen).toEqual(['u7']);
  });

  test('is NOT also parked — or the thread reopens on the next visit', () => {
    subscribeChatIntent(() => {});
    requestChat('u7');
    expect(takePendingChat()).toBeNull();
  });

  test('reaches every listener, even if one of them throws', () => {
    const seen = [];
    subscribeChatIntent(() => { throw new Error('a screen blew up'); });
    subscribeChatIntent((id) => seen.push(id));
    expect(() => requestChat('u7')).not.toThrow();
    expect(seen).toEqual(['u7']);
  });

  test('stops reaching one that has unsubscribed', () => {
    const seen = [];
    const off = subscribeChatIntent((id) => seen.push(id));
    off();
    requestChat('u7');
    expect(seen).toEqual([]);
    // …and with nobody left listening it parks again, rather than vanishing.
    expect(takePendingChat()).toBe('u7');
  });
});

describe('a request made before anything is listening', () => {
  test('waits, which is the whole cold-start case', () => {
    requestChat('u7');
    expect(takePendingChat()).toBe('u7');
  });

  test('is taken exactly once', () => {
    requestChat('u7');
    expect(takePendingChat()).toBe('u7');
    // Leaving it set is what makes a thread you deliberately closed spring
    // back open the next time you open the tab.
    expect(takePendingChat()).toBeNull();
  });

  test('keeps only the most recent — two taps mean the second one', () => {
    requestChat('u7');
    requestChat('u9');
    expect(takePendingChat()).toBe('u9');
    expect(takePendingChat()).toBeNull();
  });
});

describe('requests that say nothing', () => {
  test.each([[null], [undefined], [''], ['   ']])('%p is ignored', (bad) => {
    const seen = [];
    subscribeChatIntent((id) => seen.push(id));
    requestChat(bad);
    expect(seen).toEqual([]);
    expect(takePendingChat()).toBeNull();
  });

  test('a numeric id is carried as a string, the way a route wants it', () => {
    requestChat(42);
    expect(takePendingChat()).toBe('42');
  });
});

describe('subscribing with nonsense', () => {
  test('is a no-op that still returns an unsubscribe', () => {
    const off = subscribeChatIntent(null);
    expect(typeof off).toBe('function');
    expect(() => off()).not.toThrow();
    // And it did not count as a listener: the next request still parks.
    requestChat('u7');
    expect(takePendingChat()).toBe('u7');
  });
});
