/**
 * The join was hand-written at every call site, each slightly differently —
 * one tested `startsWith('/')`, another `^https?:` — so an absolute URL was
 * handled in one place and mangled in the next. These are the cases that
 * differed.
 */
import { resolveAvatarUrl } from '../avatarUrl';

const BASE = 'https://app.t3d.ca/api';

describe('resolveAvatarUrl', () => {
  test('joins a server-relative path to the pond origin, not to /api', () => {
    // The stored path carries its own /api, so the base's must come off or the
    // result is /api/api/avatars/...
    expect(resolveAvatarUrl('/api/avatars/ab12.jpg?v=9', BASE))
      .toBe('https://app.t3d.ca/api/avatars/ab12.jpg?v=9');
  });

  test('leaves an already-absolute URL completely alone', () => {
    for (const url of [
      'https://example.com/a.png',
      'http://192.168.1.4:3000/a.png',
      'file:///var/mobile/a.jpg',
      'data:image/png;base64,iVBORw0KG',
      // The optimistic local pick, straight out of the image picker — iOS
      // hands back ph://, Android content://. Prepending an origin to either
      // breaks the preview the user just chose.
      'ph://1A2B3C4D-0000-4000-8000-000000000000/L0/001',
      'content://media/external/images/media/42',
      'blob:https://app.t3d.ca/9a8b',
    ]) {
      expect(resolveAvatarUrl(url, BASE)).toBe(url);
    }
  });

  test('copes with a base that has no /api, or a trailing slash', () => {
    expect(resolveAvatarUrl('/avatars/a.jpg', 'http://10.0.0.5:3000')).toBe('http://10.0.0.5:3000/avatars/a.jpg');
    expect(resolveAvatarUrl('/avatars/a.jpg', 'http://10.0.0.5:3000/api/')).toBe('http://10.0.0.5:3000/avatars/a.jpg');
    expect(resolveAvatarUrl('/avatars/a.jpg', 'http://10.0.0.5:3000/')).toBe('http://10.0.0.5:3000/avatars/a.jpg');
  });

  test('adds the separator when the stored path lacks one', () => {
    expect(resolveAvatarUrl('avatars/a.jpg', BASE)).toBe('https://app.t3d.ca/avatars/a.jpg');
  });

  test('is null when there is nothing to show, rather than a broken URL', () => {
    // An <Image> given "" or "undefined" logs a load failure per render.
    expect(resolveAvatarUrl(null, BASE)).toBeNull();
    expect(resolveAvatarUrl('', BASE)).toBeNull();
    expect(resolveAvatarUrl('   ', BASE)).toBeNull();
    expect(resolveAvatarUrl(undefined, BASE)).toBeNull();
    expect(resolveAvatarUrl('/avatars/a.jpg', null)).toBeNull();
    expect(resolveAvatarUrl('/avatars/a.jpg', '')).toBeNull();
  });
});
