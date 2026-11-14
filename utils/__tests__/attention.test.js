import {
  __resetAttention, attentionSummary, getAttention, hasAttention, registerAttentionRefresh,
  requestAttentionRefresh, setAttention, subscribeAttention,
} from '../attention';
import {
  notificationLine, notificationRows, notificationsLabel, unreadNotifications,
} from '../notificationRows';

/**
 * What the dot on the Profile tab is lit for, and the rows behind one of its
 * three sources. Pure stores and mappers — the components only read them.
 */

beforeEach(() => { __resetAttention(); });

describe('the attention store', () => {
  test('nothing is waiting until something says so', () => {
    expect(getAttention()).toEqual({ messages: 0, notifications: 0, update: 'none' });
    expect(hasAttention(getAttention())).toBe(false);
    expect(attentionSummary(getAttention())).toBe('');
  });

  test('any one of the three lights it', () => {
    setAttention({ messages: 2 });
    expect(hasAttention(getAttention())).toBe(true);
    __resetAttention();
    setAttention({ notifications: 1 });
    expect(hasAttention(getAttention())).toBe(true);
    __resetAttention();
    setAttention({ update: 'available' });
    expect(hasAttention(getAttention())).toBe(true);
  });

  test('a partial update leaves the other counts alone', () => {
    setAttention({ messages: 3 });
    setAttention({ notifications: 1 });
    expect(getAttention()).toEqual({ messages: 3, notifications: 1, update: 'none' });
  });

  test('a count is never negative, fractional or NaN', () => {
    setAttention({ messages: -4, notifications: 2.9 });
    expect(getAttention().messages).toBe(0);
    expect(getAttention().notifications).toBe(2);
    setAttention({ messages: 'three', notifications: undefined });
    expect(getAttention().messages).toBe(0);
    expect(getAttention().notifications).toBe(0);
  });

  test('subscribers hear a change, and ONLY a change', () => {
    const heard = jest.fn();
    const stop = subscribeAttention(heard);
    setAttention({ messages: 1 });
    setAttention({ messages: 1 }); // the same number again: a re-fetch, not news
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
    setAttention({ messages: 2 });
    expect(heard).toHaveBeenCalledTimes(1);
  });

  test('a downloaded update stays "ready" for the rest of the run', () => {
    // A later check that finds nothing NEWER than what is already pending
    // must not put the dot out: the update is still waiting to be applied.
    setAttention({ update: 'ready' });
    setAttention({ update: 'none' });
    expect(getAttention().update).toBe('ready');
    setAttention({ update: 'available' });
    expect(getAttention().update).toBe('ready');
  });

  test('an unknown update state is ignored rather than stored', () => {
    setAttention({ update: 'banana' });
    expect(getAttention().update).toBe('none');
  });

  test('the screen reader hears what the dot means', () => {
    setAttention({ messages: 2, notifications: 1, update: 'available' });
    expect(attentionSummary(getAttention())).toBe('2 unread messages, 1 new notification, an app update');
    __resetAttention();
    setAttention({ messages: 1, update: 'ready' });
    expect(attentionSummary(getAttention())).toBe('1 unread message, an app update ready');
  });

  test('whoever changes a count can ask for the truth, and a missing refresher is not an error', () => {
    expect(() => requestAttentionRefresh()).not.toThrow();
    const refresh = jest.fn();
    const stop = registerAttentionRefresh(refresh);
    requestAttentionRefresh();
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
    requestAttentionRefresh();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('a refresher that throws does not take the caller down', () => {
    registerAttentionRefresh(() => { throw new Error('offline'); });
    expect(() => requestAttentionRefresh()).not.toThrow();
  });
});

describe('notification rows', () => {
  const payload = {
    success: true,
    unread: 1,
    notifications: [
      {
        id: 'ntf-2', taskId: 't9', type: 'comment', actorId: 'u2', actorName: 'Ana',
        actorAvatarUrl: null, taskTitle: 'Order the tiles', taskItemType: 'task',
        taskExists: true, preview: 'Which grey?', createdAt: 1763000000000, readAt: null,
      },
      {
        id: 'ntf-1', taskId: 't3', type: 'comment', actorId: 'u3', actorName: '',
        taskTitle: '(deleted)', taskItemType: 'task', taskExists: false,
        preview: '', createdAt: 1762000000000, readAt: 1762000500000,
      },
    ],
  };

  test('the pond\'s payload becomes rows, newest first as sent', () => {
    const rows = notificationRows(payload);
    expect(rows.map((r) => r.id)).toEqual(['ntf-2', 'ntf-1']);
    expect(rows[0]).toMatchObject({
      taskId: 't9', title: 'Order the tiles', actor: 'Ana', preview: 'Which grey?', unread: true, taskExists: true,
    });
    expect(rows[1]).toMatchObject({ unread: false, taskExists: false });
    expect(unreadNotifications(rows)).toBe(1);
  });

  test('garbage in is an empty list, not a crash', () => {
    for (const bad of [null, undefined, {}, { notifications: 'no' }, { notifications: [null, {}] }]) {
      expect(notificationRows(bad)).toEqual([]);
    }
  });

  test('the headline names who did what', () => {
    const [first, second] = notificationRows(payload);
    expect(notificationLine(first)).toBe('Ana commented on your task');
    // No name on file: still a sentence.
    expect(notificationLine(second)).toBe('Someone commented on your task');
    expect(notificationLine({ ...first, itemType: 'event' })).toBe('Ana commented on your event');
    // A type this build has never heard of still gets a row.
    expect(notificationLine({ ...first, kind: 'assigned' })).toBe('Ana updated a task');
  });

  test('the card says how many are new, or what the page is for', () => {
    expect(notificationsLabel(0)).toBe('Comments on your tasks');
    expect(notificationsLabel(3)).toBe('3 new');
    expect(notificationsLabel(-2)).toBe('Comments on your tasks');
    expect(notificationsLabel('x')).toBe('Comments on your tasks');
  });
});
