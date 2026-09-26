import { batchKind, countOf, describeBatch, jobKind, pluralise } from '../uploadWording';

describe('batchKind', () => {
  it('names a single-type batch by what is in it', () => {
    expect(batchKind([{ type: 'image' }, { type: 'image' }])).toBe('photo');
    expect(batchKind([{ type: 'video' }])).toBe('video');
    expect(batchKind([{ mimeType: 'image/jpeg' }])).toBe('photo');
    expect(batchKind([{ mimeType: 'video/quicktime' }])).toBe('video');
    // MediaLibrary rows carry mediaType rather than type.
    expect(batchKind([{ mediaType: 'photo' }])).toBe('photo');
  });

  // The actual bug: a PDF counted as a photo.
  it('calls anything that is not photo-or-video a file', () => {
    expect(batchKind([{ mimeType: 'application/pdf' }])).toBe('file');
    expect(batchKind([{ type: 'image' }, { mimeType: 'application/pdf' }])).toBe('file');
    // An asset the picker typed as nothing at all: "file" is the generic that
    // is never actually wrong.
    expect(batchKind([{ uri: 'file:///x' }])).toBe('file');
  });

  it('calls a photo-and-video mix items rather than picking a side', () => {
    expect(batchKind([{ type: 'image' }, { type: 'video' }])).toBe('item');
  });

  it('is safe on nothing', () => {
    expect(batchKind([])).toBe('item');
    expect(batchKind(undefined)).toBe('item');
    expect(batchKind(null)).toBe('item');
  });
});

describe('pluralise and countOf', () => {
  it('agrees with the count', () => {
    expect(pluralise('photo', 1)).toBe('photo');
    expect(pluralise('photo', 2)).toBe('photos');
    expect(pluralise('file', 1)).toBe('file');
    expect(countOf('file', 3)).toBe('3 files');
    expect(countOf('video', 1)).toBe('1 video');
    // Unknown kind degrades to the generic rather than printing undefined.
    expect(countOf('nonsense', 2)).toBe('2 items');
  });
});

describe('describeBatch', () => {
  it('is what the upload sheet puts in its title', () => {
    expect(describeBatch([{ type: 'image' }])).toBe('1 photo');
    expect(describeBatch([{ type: 'video' }, { type: 'video' }])).toBe('2 videos');
    expect(describeBatch([{ mimeType: 'application/pdf' }, { mimeType: 'text/csv' }])).toBe('2 files');
  });
});

describe('jobKind', () => {
  // The share toast has no asset list — only the kind the job was enqueued as.
  it('treats filed documents and music imports as files, everything else as photos', () => {
    expect(jobKind('files')).toBe('file');
    expect(jobKind('audio-files')).toBe('file');
    expect(jobKind('audio-url')).toBe('file');
    expect(jobKind('standard')).toBe('photo');
    expect(jobKind(undefined)).toBe('photo');
  });
});
