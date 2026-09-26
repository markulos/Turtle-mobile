/**
 * "May we delete it off the phone?" — four sources, four different answers.
 *
 * The rule with teeth is the COUNT: it goes on a red button that says "Delete
 * N from phone", so it must be exactly the number of the user's own files that
 * will disappear. Counting our staging copies in it would be a lie in the one
 * place a lie is unforgivable.
 */
import {
  DELETE_ASSET, DELETE_SAF, DELETE_STAGED,
  deletableKind, deletionPlan, isReclaimable,
} from '../originalDeletion';

const ios = { platform: 'ios' };
const android = { platform: 'android' };

const uploaded = (over) => ({ status: 'uploaded', ...over });

describe('deletableKind', () => {
  test('a camera-roll asset is ours to delete, on either phone', () => {
    expect(deletableKind(uploaded({ assetId: 'ph://1' }), ios)).toBe(DELETE_ASSET);
    expect(deletableKind(uploaded({ assetId: 'ph://1' }), android)).toBe(DELETE_ASSET);
  });

  test('an Android SAF document is too', () => {
    const item = uploaded({ sourceUri: 'content://downloads/1', stagedPath: '/doc/staged-1' });
    expect(deletableKind(item, android)).toBe(DELETE_SAF);
  });

  test('an iOS document is NOT — the picker gave us a copy, not the file', () => {
    // This is the whole reason the classifier exists. The item looks identical
    // to the Android one apart from where it came from.
    const item = uploaded({ sourceUri: 'file:///cache/DocumentPicker/notes.pdf', stagedPath: '/doc/staged-1' });
    expect(deletableKind(item, ios)).toBe(DELETE_STAGED);
  });

  test('a content:// URI on iOS is not understood, so it is not deleted', () => {
    // Belt and braces: SAF is Android-only by construction.
    const item = uploaded({ sourceUri: 'content://downloads/1' });
    expect(deletableKind(item, ios)).toBeNull();
  });

  test('nothing is offered until the file is SAFE in the vault', () => {
    for (const status of ['pending', 'inflight', 'failed', 'missing']) {
      expect(deletableKind({ status, assetId: 'ph://1' }, ios)).toBeNull();
    }
  });

  test('a duplicate counts as safe — the pond already had it', () => {
    expect(deletableKind({ status: 'duplicate', assetId: 'ph://1' }, ios)).toBe(DELETE_ASSET);
  });

  test('an item with nothing to go on answers null, not a crash', () => {
    expect(deletableKind(null, ios)).toBeNull();
    expect(deletableKind(uploaded({}), ios)).toBeNull();
  });
});

describe('deletionPlan', () => {
  const batch = [
    uploaded({ assetId: 'ph://1' }),
    uploaded({ assetId: 'ph://2' }),
    uploaded({ sourceUri: 'file:///cache/a.pdf', stagedPath: '/doc/a' }),
    { status: 'pending', assetId: 'ph://3' },
    { status: 'failed', assetId: 'ph://4' },
  ];

  test('on iOS, a mixed batch offers only the photos', () => {
    const plan = deletionPlan(batch, ios);
    expect(plan.assetIds).toEqual(['ph://1', 'ph://2']);
    expect(plan.safUris).toEqual([]);
    // THE number on the button: two, not three, and not five.
    expect(plan.count).toBe(2);
  });

  test('the staging copy is listed but never counted', () => {
    const plan = deletionPlan(batch, ios);
    expect(plan.stagedPaths).toEqual(['/doc/a']);
    expect(plan.count).toBe(2);
  });

  test('on Android the same batch can also take the document', () => {
    const plan = deletionPlan(
      [...batch, uploaded({ sourceUri: 'content://downloads/9' })],
      android,
    );
    expect(plan.safUris).toEqual(['content://downloads/9']);
    expect(plan.count).toBe(3);
  });

  test('a documents-only iOS batch offers NOTHING, so no button is shown', () => {
    const plan = deletionPlan(
      [uploaded({ sourceUri: 'file:///cache/a.pdf', stagedPath: '/doc/a' })],
      ios,
    );
    expect(plan.count).toBe(0);
  });

  test('an empty or absent batch is a plan for nothing', () => {
    expect(deletionPlan([], ios).count).toBe(0);
    expect(deletionPlan(undefined, ios).count).toBe(0);
  });
});

describe('undeletableReason', () => {
  const { undeletableReason, NO_OFFER_IOS_DOCUMENTS, NO_OFFER_PHOTO_ACCESS } = require('../originalDeletion');

  test('an iOS document batch explains the platform, not a permission', () => {
    // Sending someone to Settings here would achieve nothing: the picker
    // copies the file and never hands over the user's own.
    const items = [uploaded({ type: 'document', stagedPath: '/doc/a' })];
    expect(undeletableReason(items, ios)).toBe(NO_OFFER_IOS_DOCUMENTS);
  });

  test('photos with no handle on them point at the setting that fixes it', () => {
    const items = [uploaded({ type: 'image' }), uploaded({ type: 'video' })];
    expect(undeletableReason(items, ios)).toBe(NO_OFFER_PHOTO_ACCESS);
  });

  test('when both apply, the permanent fact wins', () => {
    const items = [uploaded({ type: 'document', stagedPath: '/doc/a' }), uploaded({ type: 'image' })];
    expect(undeletableReason(items, ios)).toBe(NO_OFFER_IOS_DOCUMENTS);
  });

  test('nothing to explain when everything deletable is already on offer', () => {
    expect(undeletableReason([uploaded({ assetId: 'ph://1', type: 'image' })], ios)).toBeNull();
  });

  test('and nothing to explain for a batch still in flight', () => {
    expect(undeletableReason([{ status: 'pending', type: 'document' }], ios)).toBeNull();
  });

  test('on Android a SAF document is offered, so there is nothing to say', () => {
    const items = [uploaded({ type: 'document', sourceUri: 'content://downloads/1' })];
    expect(undeletableReason(items, android)).toBeNull();
  });
});

describe('isReclaimable', () => {
  test('our own copy goes once the file is safe in the vault', () => {
    expect(isReclaimable(uploaded({ stagedPath: '/doc/a' }))).toBe(true);
    expect(isReclaimable({ status: 'duplicate', stagedPath: '/doc/a' })).toBe(true);
  });

  test('but NOT while the upload still needs it to resume', () => {
    expect(isReclaimable({ status: 'pending', stagedPath: '/doc/a' })).toBe(false);
    expect(isReclaimable({ status: 'inflight', stagedPath: '/doc/a' })).toBe(false);
    // A failed item keeps its copy: the batch can be resumed.
    expect(isReclaimable({ status: 'failed', stagedPath: '/doc/a' })).toBe(false);
  });

  test('a camera-roll item has no copy of ours to reclaim', () => {
    expect(isReclaimable(uploaded({ assetId: 'ph://1' }))).toBe(false);
  });
});
