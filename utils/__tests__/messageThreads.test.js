/**
 * The inbox the app could not draw.
 *
 * A direct message was reachable from a push notification or from a row of the
 * Friends LEADERBOARD — so if nobody had written to you lately there was no
 * door at all. `GET /api/messages` had answered "who has messaged me" the
 * whole time and nothing called it. This is the shape of that answer.
 */
import fs from 'fs';
import {
  badgeText, threadRows, threadWhen, unreadCount, unreadLabel,
} from '../messageThreads';

const msg = (over = {}) => ({ id: 'm1', content: 'Hello', attachments: [], createdAt: 2000, mine: false, ...over });
const thread = (over = {}) => ({ withUserId: 'u2', withName: 'Sam', unread: 0, last: msg(), ...over });

describe('threadRows', () => {
  it('turns the endpoint\'s answer into rows', () => {
    const [row] = threadRows({ threads: [thread()] }, null);
    expect(row).toMatchObject({ userId: 'u2', name: 'Sam', unread: 0, at: 2000 });
  });

  it('puts the conversation that moved last at the top', () => {
    // The server orders these already — but a list that depends on somebody
    // else's ORDER BY for its own correctness breaks silently the day a
    // column is added to that query.
    const out = threadRows({ threads: [
      thread({ withUserId: 'old', last: msg({ createdAt: 10 }) }),
      thread({ withUserId: 'new', last: msg({ createdAt: 900 }) }),
    ] }, null);
    expect(out.map((r) => r.userId)).toEqual(['new', 'old']);
  });

  it('takes a better name and a face from the roster, but never the list itself', () => {
    // A conversation you have had is one you have had, whether or not the
    // roster has caught up with the person in it.
    const people = new Map([['u2', { userId: 'u2', name: 'Samantha', avatarUrl: 'a.png' }]]);
    const [row] = threadRows({ threads: [thread({ withName: '' })] }, people);
    expect(row).toMatchObject({ name: 'Samantha', avatarUrl: 'a.png' });

    const stranger = threadRows({ threads: [thread({ withUserId: 'u9', withName: '' })] }, people);
    expect(stranger).toHaveLength(1);
    expect(stranger[0].name).toBe('Someone');
  });

  it('reads an ISO stamp as well as a number', () => {
    const iso = '2026-03-12T10:00:00Z';
    const [row] = threadRows({ threads: [thread({ last: msg({ createdAt: iso }) }) ] }, null);
    expect(row.at).toBe(Date.parse(iso));
  });

  it('drops a row with nobody on the other end of it', () => {
    expect(threadRows({ threads: [thread({ withUserId: null })] }, null)).toEqual([]);
  });

  it('survives an empty, failed or missing answer', () => {
    expect(threadRows(null, null)).toEqual([]);
    expect(threadRows({}, null)).toEqual([]);
    expect(threadRows({ threads: 'nonsense' }, null)).toEqual([]);
  });
});

describe('the count, and what says it', () => {
  it('is summed off the ROWS, not off the endpoint\'s own total', () => {
    // Two numbers from two places eventually disagree, and a badge saying 3
    // over a list showing 2 is one you stop believing and then stop looking at.
    const rows = threadRows({
      unreadTotal: 99,
      threads: [thread({ unread: 2 }), thread({ withUserId: 'u3', unread: 1 })],
    }, null);
    expect(unreadCount(rows)).toBe(3);
  });

  it('never counts a negative or a nonsense unread', () => {
    const rows = threadRows({ threads: [thread({ unread: -4 }), thread({ withUserId: 'u3', unread: 'x' })] }, null);
    expect(unreadCount(rows)).toBe(0);
  });

  it('says what is waiting, and something sensible when nothing is', () => {
    expect(unreadLabel(0)).toBe('Your conversations');
    expect(unreadLabel(1)).toBe('1 unread');
    expect(unreadLabel(4)).toBe('4 unread');
  });

  it('caps the badge, because a circle sized for two digits is not sized for three', () => {
    expect(badgeText(0)).toBe('');
    expect(badgeText(9)).toBe('9');
    expect(badgeText(99)).toBe('99');
    expect(badgeText(100)).toBe('99+');
    expect(badgeText(undefined)).toBe('');
  });
});

describe('threadWhen', () => {
  const now = new Date('2026-03-12T15:00:00').getTime();

  it('is a clock time only while it is still today', () => {
    const at = new Date('2026-03-12T09:30:00').getTime();
    expect(threadWhen(at, { now, locale: 'en-US' })).toMatch(/9:30/);
  });

  it('is a word for yesterday and a date before that', () => {
    expect(threadWhen(new Date('2026-03-11T09:30:00').getTime(), { now })).toBe('Yesterday');
    expect(threadWhen(new Date('2026-03-01T09:30:00').getTime(), { now, locale: 'en-GB' })).toMatch(/1 Mar/);
  });

  it('says the year once it is a different one', () => {
    expect(threadWhen(new Date('2025-03-01T09:30:00').getTime(), { now, locale: 'en-GB' })).toMatch(/2025/);
  });

  it('is empty rather than "Invalid Date" for a row with no stamp', () => {
    expect(threadWhen(null, { now })).toBe('');
    expect(threadWhen('not a date', { now })).toBe('');
  });
});

/**
 * The DM mark. MaterialCommunityIcons draws `send` as a FILLED plane lying
 * flat — that is a Send BUTTON, the thing you press to commit the words you
 * just typed. A direct message is a place you go, and every app that has one
 * draws it as the outlined plane tilted up off the horizontal.
 */
describe('the DM icon is one mark, in one place', () => {
  const read = (p) => fs.readFileSync(p, 'utf8');
  const blank = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length));

  it('is the outlined plane, tilted — not the flat filled one', () => {
    const src = blank(read('components/DirectMessageIcon.jsx'));
    expect(src).toMatch(/name="send-outline"/);
    expect(src).toMatch(/rotate: `\$\{DM_TILT\}deg`/);
  });

  it('every messaging surface draws the same one', () => {
    for (const p of [
      'screens/TurtleScreen/components/MediaGallery.jsx',
      'screens/TurtleScreen/components/SendInTurtleSheet.jsx',
      'screens/ProfileScreen/index.jsx',
      'screens/ProfileScreen/components/MessagesPage.jsx',
    ]) {
      const src = blank(read(p));
      expect(src).toMatch(/DirectMessageIcon/);
      // The flat Send BUTTON glyph is gone from all of them.
      expect(src).not.toMatch(/name="send"/);
    }
  });
});

/**
 * The wiring, which no unit test can see: the Profile needs a visible door to
 * the conversations, and the badge on it has to be live.
 */
describe('the Profile’s way into chats', () => {
  const SRC = fs.readFileSync('screens/ProfileScreen/index.jsx', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length));

  it('is a card, and it leads the list', () => {
    const cards = SRC.slice(SRC.indexOf('const CARDS = ['), SRC.indexOf("key: 'claude'"));
    expect(cards.indexOf("key: 'messages'")).toBeGreaterThan(-1);
    expect(cards.indexOf("key: 'messages'")).toBeLessThan(cards.indexOf("key: 'vault'"));
  });

  it('carries a live count, refreshed on the ping and on coming back', () => {
    expect(SRC).toMatch(/const \{ messagesVersion \} = useSyncSignals\(\)/);
    expect(SRC).toMatch(/\}, \[refreshUnreadDms, messagesVersion\]\)/);
    // Opening a thread marks it read server-side, so closing is exactly when
    // the number has changed.
    expect(SRC).toMatch(/if \(!messagesOpen && !chatFriend\) refreshUnreadDms\(\)/);
  });

  it('counts it the same way the list does', () => {
    expect(SRC).toMatch(/unreadCount\(threadRows\(res, null\)\)/);
  });

  it('a failed count is decoration, never an error on the page', () => {
    const loader = SRC.slice(SRC.indexOf('const refreshUnreadDms'), SRC.indexOf('}, [api]);'));
    expect(loader).not.toMatch(/Alert\.alert|setError/);
  });

  it('opens the list, and the list opens the thread over it', () => {
    expect(SRC).toMatch(/<MessagesPage/);
    expect(SRC).toMatch(/onOpenThread=\{setChatFriend\}/);
    // Mounted BEFORE the chat page, so a thread draws over the list.
    expect(SRC.indexOf('<MessagesPage')).toBeLessThan(SRC.indexOf('<FriendChatPage'));
  });
});
