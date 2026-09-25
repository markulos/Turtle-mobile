/**
 * The picker's two pure questions: does a search find the person, and are two
 * spellings of one number the same person.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
}));
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');

import { matchMembers, memberLabel, phoneKey } from '../PeoplePicker';

const F = [
  { id: 'a', displayName: 'Mohamed Boulos', phone: '+14165550134' },
  { id: 'b', displayName: 'Michelle', phone: '+14165550199' },
  { id: 'c', phone: '+14165550111' },
];

describe('matchMembers', () => {
  test('everything when nothing is typed', () => {
    expect(matchMembers(F, '')).toBe(F);
    expect(matchMembers(F, '   ')).toBe(F);
  });

  test('matches anywhere in the name, ignoring case and edge spacing', () => {
    expect(matchMembers(F, 'boulos').map((f) => f.id)).toEqual(['a']);
    expect(matchMembers(F, '  MICH  ').map((f) => f.id)).toEqual(['b']);
  });

  // You look someone up by whichever of the two you happen to have.
  test('and matches on the number too', () => {
    expect(matchMembers(F, '0199').map((f) => f.id)).toEqual(['b']);
  });

  // A member who never set a name is still findable, by the thing they do have.
  test('a member with no name falls back to their number', () => {
    expect(memberLabel(F[2])).toBe('+14165550111');
    expect(matchMembers(F, '0111').map((f) => f.id)).toEqual(['c']);
  });

  test('survives a missing list', () => {
    expect(matchMembers(null, 'x')).toEqual([]);
  });
});

// Equality only — the number is SENT as the contact stored it, because they
// are the ones who know what their number is.
describe('phoneKey', () => {
  test('two spellings of one number are one person', () => {
    expect(phoneKey('(416) 555-0134')).toBe(phoneKey('416-555-0134'));
    expect(phoneKey('+1 416 555 0134')).toBe('14165550134');
  });

  test('a leading 00 is a +', () => {
    expect(phoneKey('0014165550134')).toBe('14165550134');
  });

  test('and different numbers stay different', () => {
    expect(phoneKey('4165550134')).not.toBe(phoneKey('4165550199'));
  });

  test('survives nothing at all', () => {
    expect(phoneKey(null)).toBe('');
    expect(phoneKey('no digits here')).toBe('');
  });
});
