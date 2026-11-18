const mockStore = new Map();
const mockPermissions = { status: 'undetermined' };
const mockRequest = jest.fn(async () => ({ status: 'granted' }));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (k) => (mockStore.has(k) ? mockStore.get(k) : null),
    setItem: async (k, v) => { mockStore.set(k, v); },
  },
}));
jest.mock('expo-media-library', () => ({
  getPermissionsAsync: async () => ({ status: mockPermissions.status }),
  // Through a wrapper: this factory runs while the consts above are still in
  // their dead zone, so a direct reference would capture nothing.
  requestPermissionsAsync: (...args) => mockRequest(...args),
}));

const load = () => {
  jest.resetModules();
  return require('../photoAccessPrompt');
};

/**
 * Asking for the photo library ONCE.
 *
 * Mark, 2026-11-18: "remove the prompt that asks to autosave photos. make it
 * ask once on uploading images but also have a checkmark for never ask
 * again." What used to ask was the SYSTEM sheet, fired unconditionally at the
 * top of every upload batch — so every rule worth having is new here, and
 * every one of them fails silently: a prompt that stops appearing looks the
 * same as one nobody has triggered yet.
 */
beforeEach(() => {
  mockStore.clear();
  mockPermissions.status = 'undetermined';
  mockRequest.mockClear();
  mockRequest.mockResolvedValue({ status: 'granted' });
});

const PHOTO = { assetId: 'asset-1', uri: 'file:///a.heic' };
const DOC = { uri: 'file:///b.pdf', stagedPath: '/x/b.pdf' };

describe('hasLibraryPhotos', () => {
  test('an assetId is the test, because that is what the permission is FOR', () => {
    // Also the only thing it is any use for: resolving the user's own library
    // item on resume, and offering to delete it afterwards.
    expect(hasOf([PHOTO])).toBe(true);
    expect(hasOf([DOC, PHOTO])).toBe(true);
    expect(hasOf([DOC])).toBe(false);
    expect(hasOf([])).toBe(false);
    expect(hasOf(null)).toBe(false);
  });

  function hasOf(items) {
    return load().hasLibraryPhotos(items);
  }
});

describe('shouldAskPhotoAccess', () => {
  const base = { status: 'undetermined', asked: false, never: false, hasPhotos: true };

  test('asks on an image upload that has not been asked about', () => {
    expect(load().shouldAskPhotoAccess(base)).toBe(true);
  });

  test('NEVER for a batch with no camera-roll item in it', () => {
    // A PDF upload asking about your photo library is the thing being
    // removed, and it used to happen on every one.
    expect(load().shouldAskPhotoAccess({ ...base, hasPhotos: false })).toBe(false);
  });

  test('never twice — "once" means once, declined included', () => {
    expect(load().shouldAskPhotoAccess({ ...base, asked: true })).toBe(false);
  });

  test('…and never at all once the checkmark has been ticked', () => {
    expect(load().shouldAskPhotoAccess({ ...base, asked: false, never: true })).toBe(false);
  });

  test('not when access is already granted', () => {
    expect(load().shouldAskPhotoAccess({ ...base, status: 'granted' })).toBe(false);
  });

  test('LIMITED access still asks, once', () => {
    // The case that made the old behaviour so visible: with limited access
    // the system re-presented its photo picker at the top of every upload.
    // Our question is the thing that can offer full access without doing
    // that, and it still only gets one go.
    expect(load().shouldAskPhotoAccess({ ...base, status: 'limited' })).toBe(true);
    expect(load().shouldAskPhotoAccess({ ...base, status: 'limited', asked: true })).toBe(false);
  });
});

describe('askPhotoAccessIfDue', () => {
  test('raises the question, and the subscriber hears it', async () => {
    const svc = load();
    const seen = [];
    svc.onPhotoAccessAsk((due) => seen.push(due));
    // Subscribing reports the state as it already is.
    expect(seen).toEqual([false]);

    await expect(svc.askPhotoAccessIfDue([PHOTO])).resolves.toBe(true);
    expect(seen[seen.length - 1]).toBe(true);
  });

  test('THE SYSTEM SHEET IS NOT REACHED BY ASKING — only by answering yes', async () => {
    // The whole point. The old code called this on every batch; now nothing
    // calls it until somebody has said Allow.
    const svc = load();
    await svc.askPhotoAccessIfDue([PHOTO]);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  test('a documents-only upload never asks', async () => {
    const svc = load();
    await expect(svc.askPhotoAccessIfDue([DOC])).resolves.toBe(false);
  });

  test('a second batch does not re-ask while the first question is still up', async () => {
    const svc = load();
    await expect(svc.askPhotoAccessIfDue([PHOTO])).resolves.toBe(true);
    await expect(svc.askPhotoAccessIfDue([PHOTO])).resolves.toBe(false);
  });

  test('already granted: silent', async () => {
    mockPermissions.status = 'granted';
    const svc = load();
    await expect(svc.askPhotoAccessIfDue([PHOTO])).resolves.toBe(false);
  });
});

describe('answerPhotoAccessAsk', () => {
  test('Allow lowers the sheet and THEN asks the OS', async () => {
    const svc = load();
    const seen = [];
    svc.onPhotoAccessAsk((due) => seen.push(due));
    await svc.askPhotoAccessIfDue([PHOTO]);

    await expect(svc.answerPhotoAccessAsk({ allow: true })).resolves.toBe(true);
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(seen[seen.length - 1]).toBe(false);
  });

  test('…and reports a DENIED system answer honestly', async () => {
    mockRequest.mockResolvedValue({ status: 'denied' });
    const svc = load();
    await expect(svc.answerPhotoAccessAsk({ allow: true })).resolves.toBe(false);
  });

  test('Not now records that it was asked, so the next upload is quiet', async () => {
    const svc = load();
    await svc.answerPhotoAccessAsk({ allow: false });
    expect(mockRequest).not.toHaveBeenCalled();

    const fresh = load();
    await expect(fresh.askPhotoAccessIfDue([PHOTO])).resolves.toBe(false);
  });

  test('THE CHECKMARK SURVIVES A RESTART', async () => {
    // A "never again" that only lived in memory would be back the next
    // morning, which is the same bug with a longer fuse.
    const svc = load();
    await svc.answerPhotoAccessAsk({ allow: false, never: true });
    expect(JSON.parse(mockStore.get(svc.PHOTO_ASK_KEY))).toEqual({ asked: true, never: true });

    const fresh = load();
    await expect(fresh.askPhotoAccessIfDue([PHOTO])).resolves.toBe(false);
    expect(fresh.shouldAskPhotoAccess({
      status: 'undetermined', asked: false, never: true, hasPhotos: true,
    })).toBe(false);
  });

  test('…and so does a plain Allow, which is also an answer', async () => {
    const svc = load();
    await svc.answerPhotoAccessAsk({ allow: true, never: false });
    expect(JSON.parse(mockStore.get(svc.PHOTO_ASK_KEY))).toEqual({ asked: true, never: false });
  });

  test('a throwing OS call is a No, not a crash in an upload', async () => {
    mockRequest.mockRejectedValue(new Error('no such module'));
    const svc = load();
    await expect(svc.answerPhotoAccessAsk({ allow: true })).resolves.toBe(false);
  });
});

describe('nothing here may take an upload down', () => {
  test('ONE BAD SUBSCRIBER breaks neither the others nor the subscribe itself', async () => {
    // Both halves matter: the broadcast runs mid-upload, and the subscribe
    // runs inside a component's mount effect.
    const svc = load();
    const seen = [];
    svc.onPhotoAccessAsk((due) => seen.push(due));
    await svc.askPhotoAccessIfDue([PHOTO]);
    // One bad subscriber must not take the rest down with it.
    svc.onPhotoAccessAsk(() => { throw new Error('bad subscriber'); });

    await expect(svc.answerPhotoAccessAsk({ allow: false })).resolves.toBe(false);
    expect(seen[seen.length - 1]).toBe(false);
  });
});
