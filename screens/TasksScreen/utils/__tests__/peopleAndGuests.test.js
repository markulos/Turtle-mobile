/**
 * The two policies behind the People picker: who it offers before you search,
 * and what adding a guest does to the reminders.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));

import { rankPeople } from '../peopleFrequency';
import { guestReminderConfig, DEFAULT_LEADS } from '../guestReminders';

describe('rankPeople', () => {
  const counts = { ann: 9, bob: 4, cal: 4, dee: 1 };

  test('offers the people you actually put on tasks, most first', () => {
    expect(rankPeople(counts)).toEqual(['ann', 'bob', 'cal']);
  });

  // A top three that reshuffles between renders because two people are level
  // on 4 is a list you cannot build muscle memory against.
  test('breaks ties stably rather than by whichever came back first', () => {
    expect(rankPeople({ cal: 4, bob: 4 })).toEqual(['bob', 'cal']);
    expect(rankPeople({ bob: 4, cal: 4 })).toEqual(['bob', 'cal']);
  });

  // A suggestion you have already taken is a row that does nothing — and it
  // pushes the one useful suggestion off the end of three.
  test('drops anyone already on the task', () => {
    expect(rankPeople(counts, { exclude: ['ann', 'bob'] })).toEqual(['cal', 'dee']);
  });

  test('counts of zero are not a suggestion', () => {
    expect(rankPeople({ ann: 0, bob: 2 })).toEqual(['bob']);
  });

  test('survives nothing stored, or nonsense stored', () => {
    expect(rankPeople(null)).toEqual([]);
    expect(rankPeople({})).toEqual([]);
    expect(rankPeople({ '': 5 })).toEqual([]);
  });

  test('honours the limit it is given', () => {
    expect(rankPeople(counts, { limit: 1 })).toEqual(['ann']);
    expect(rankPeople(counts, { limit: 0 })).toEqual([]);
  });
});

describe('guestReminderConfig', () => {
  const guest = [{ name: 'Tanya', phone: '416-555-0134' }];

  // A guest has no app, no push, no notification tray. SMS is not an option
  // for them; it is the only channel.
  test('a guest turns SMS on', () => {
    expect(guestReminderConfig({ leads: [30], sms: false }, guest).sms).toBe(true);
  });

  // The day-before is what lets them move something; the at-time is what gets
  // them there. One without the other is half a reminder.
  test('and fills empty lead times with the day before and the time itself', () => {
    expect(guestReminderConfig({ leads: [], sms: false }, guest).leads).toEqual(DEFAULT_LEADS);
    expect(DEFAULT_LEADS).toEqual([1440, 0]);
  });

  test('but never overrides lead times the user chose', () => {
    expect(guestReminderConfig({ leads: [60, 15], sms: false }, guest).leads).toEqual([60, 15]);
  });

  test('leaves everything else on the config alone', () => {
    expect(guestReminderConfig({ leads: [30], sms: false, involved: true }, guest).involved).toBe(true);
  });

  // Removing the last guest must not silently cancel texts the OWNER may have
  // turned on for themselves.
  test('with no guests it changes nothing', () => {
    expect(guestReminderConfig({ leads: [30], sms: true }, [])).toEqual({ leads: [30], sms: true });
    expect(guestReminderConfig({ leads: [], sms: false }, undefined)).toEqual({ leads: [], sms: false });
  });

  // A "guest" with no number is a name on a list — there is nowhere to send to.
  test('a guest with no phone is not a reason to text anyone', () => {
    expect(guestReminderConfig({ leads: [], sms: false }, [{ name: 'Tanya' }]).sms).toBe(false);
  });

  test('survives a missing config', () => {
    expect(guestReminderConfig(null, guest)).toMatchObject({ sms: true, leads: DEFAULT_LEADS });
  });
});
