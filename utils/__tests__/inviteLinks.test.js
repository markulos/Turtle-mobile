import { parseInviteLink } from '../inviteLinks';

describe('parseInviteLink', () => {
  test('deep link with encoded server URL', () => {
    expect(parseInviteLink('turtle://join/AB12-CD34?server=https%3A%2F%2Fpond.example.com'))
      .toEqual({ code: 'AB12-CD34', server: 'https://pond.example.com' });
  });

  test('deep link with bare host server', () => {
    expect(parseInviteLink('turtle://join/AB12CD34?server=192.168.2.93'))
      .toEqual({ code: 'AB12CD34', server: '192.168.2.93' });
  });

  test('deep link without server', () => {
    expect(parseInviteLink('turtle://join/AB12CD34'))
      .toEqual({ code: 'AB12CD34', server: null });
  });

  test('https landing URL yields its origin as the server', () => {
    expect(parseInviteLink('https://pond.tail1234.ts.net/join/XY-99Z'))
      .toEqual({ code: 'XY-99Z', server: 'https://pond.tail1234.ts.net' });
  });

  test('link fished out of a whole pasted SMS', () => {
    const sms = 'You\'re invited to "Mark\'s Pond" on Turtle 🐢 Tap to join: https://pond.example.com/join/AB12CD34';
    expect(parseInviteLink(sms))
      .toEqual({ code: 'AB12CD34', server: 'https://pond.example.com' });
  });

  test('hand-typed code is not a link', () => {
    expect(parseInviteLink('AB12CD34')).toBeNull();
  });

  test('pond name is not a link', () => {
    expect(parseInviteLink("Mark's Pond")).toBeNull();
  });

  test('empty and null input', () => {
    expect(parseInviteLink('')).toBeNull();
    expect(parseInviteLink(null)).toBeNull();
  });

  test('malformed percent-escape in server falls back to verbatim', () => {
    expect(parseInviteLink('turtle://join/AB12CD34?server=%E0%A4%A'))
      .toEqual({ code: 'AB12CD34', server: '%E0%A4%A' });
  });

  test('deep link takes precedence when both shapes appear', () => {
    const landing = 'https://pond.example.com/join/AB12CD34 turtle://join/ZZ99YY88?server=https%3A%2F%2Fother.example.com';
    expect(parseInviteLink(landing)).toEqual({ code: 'ZZ99YY88', server: 'https://other.example.com' });
  });
});
