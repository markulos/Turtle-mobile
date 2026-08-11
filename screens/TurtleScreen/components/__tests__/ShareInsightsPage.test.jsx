// The page pulls in EdgeSwipePage → ThemeContext → AsyncStorage. These tests
// exercise the roll-up arithmetic, not the tree, so the native module just has
// to exist.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));

import { summarizeVisits, whenLabel } from '../ShareInsightsPage';

const DAY = 86400000;
// Midday so day-bucket maths never straddles a local midnight by accident.
const NOW = new Date('2026-08-09T12:00:00').getTime();
const visit = (over) => ({ ts: NOW, event: 'view', ip: '1.1.1.1', origin: 'internet', isBot: false, client: 'Safari', place: null, ...over });

describe('summarizeVisits', () => {
  test('counts people only — bot fetches are reported apart, never folded in', () => {
    const roll = summarizeVisits([
      visit({ ip: 'a' }),
      visit({ ip: 'b' }),
      visit({ ip: 'crawler', isBot: true }),
      visit({ ip: 'crawler', isBot: true }),
    ], NOW);

    expect(roll.opens).toBe(2);
    expect(roll.visitors).toBe(2);
    expect(roll.botHits).toBe(2);
  });

  test('separates downloads and failed unlocks from opens', () => {
    const roll = summarizeVisits([
      visit({ event: 'view' }),
      visit({ event: 'download' }),
      visit({ event: 'download' }),
      visit({ event: 'unlock_fail' }),
    ], NOW);

    expect(roll.opens).toBe(1);
    expect(roll.downloads).toBe(2);
    expect(roll.failedUnlocks).toBe(1);
  });

  test('buckets opens into 30 day-slots ending today, dropping anything older', () => {
    const roll = summarizeVisits([
      visit({ ts: NOW }),
      visit({ ts: NOW - 2 * DAY }),
      visit({ ts: NOW - 2 * DAY }),
      visit({ ts: NOW - 60 * DAY }), // off the left edge of the chart
    ], NOW);

    expect(roll.days).toHaveLength(30);
    expect(roll.days[29].opens).toBe(1);
    expect(roll.days[27].opens).toBe(2);
    expect(roll.peakDay).toBe(2);
    // The 60-day-old open still counts as an open; it just has no bar.
    expect(roll.opens).toBe(4);
    expect(roll.days.reduce((n, d) => n + d.opens, 0)).toBe(3);
  });

  test('compares the last 7 days against the 7 before them', () => {
    const roll = summarizeVisits([
      visit({ ts: NOW - 1 * DAY }),
      visit({ ts: NOW - 2 * DAY }),
      visit({ ts: NOW - 9 * DAY }),
    ], NOW);

    expect(roll.last7).toBe(2);
    expect(roll.prev7).toBe(1);
  });

  test('ranks places and clients by frequency, falling back to network origin', () => {
    const roll = summarizeVisits([
      visit({ place: 'Toronto, CA', client: 'Safari' }),
      visit({ place: 'Toronto, CA', client: 'Chrome' }),
      visit({ place: null, origin: 'Tailscale device', client: 'Safari' }),
    ], NOW);

    expect(roll.places[0]).toEqual({ label: 'Toronto, CA', n: 2 });
    expect(roll.places[1]).toEqual({ label: 'Tailscale device', n: 1 });
    expect(roll.clients[0]).toEqual({ label: 'Safari', n: 2 });
  });

  test('an empty log reads as zero, not as a crash or NaN', () => {
    const roll = summarizeVisits([], NOW);
    expect(roll).toMatchObject({ opens: 0, visitors: 0, downloads: 0, botHits: 0, peakDay: 0, lastSeen: null });
    expect(roll.days).toHaveLength(30);
  });
});

describe('whenLabel', () => {
  test('reads as an age, and says never for nothing', () => {
    expect(whenLabel(null)).toBe('never');
    expect(whenLabel(NOW - 30000, NOW)).toBe('just now');
    expect(whenLabel(NOW - 14 * 60000, NOW)).toBe('14m ago');
    expect(whenLabel(NOW - 3 * 3600000, NOW)).toBe('3h ago');
    expect(whenLabel(NOW - 3 * DAY, NOW)).toBe('3d ago');
  });
});
