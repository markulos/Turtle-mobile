import { _resetUploadDiagnostics, dedupeKeyOf, reportUploadIssue } from '../uploadDiagnostics';

/**
 * The reporter files ONE feedback task per anomaly per item per batch. The
 * pond had collected 36 tasks for three defects, three of them for a single
 * stalled PDF — one per retry attempt — which is what these pin.
 */
const ctx = (batch = 'batch-1') => ({ getBaseUrl: () => 'https://pond.example/api', token: 't', batch });

const filedTitles = () => global.fetch.mock.calls.map(([, init]) => JSON.parse(init.body).content);

beforeEach(() => {
  _resetUploadDiagnostics();
  global.fetch = jest.fn(async () => ({ json: async () => ({ success: true, noteId: 'n1' }) }));
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('dedupeKeyOf', () => {
  it('drops the attempt number and scopes by item and batch', () => {
    expect(dedupeKeyOf('watchdog-transfer-attempt-2', { item: 'thesis.pdf' }, { batch: 'b1' })).toBe('watchdog-transfer|thesis.pdf|b1');
    expect(dedupeKeyOf('watchdog-transfer', { item: 'thesis.pdf' }, { batch: 'b1' })).toBe('watchdog-transfer|thesis.pdf|b1');
    expect(dedupeKeyOf('item-failed', { item: 'thesis.pdf' }, { batch: 'b1' })).toBe('item-failed|thesis.pdf|b1');
  });

  it('reads the batch from the details when the context does not carry one', () => {
    expect(dedupeKeyOf('inflight-reconciled', { batch: 'b7', landed: 0 }, {})).toBe('inflight-reconciled||b7');
    expect(dedupeKeyOf('inflight-reconciled', {}, {})).toBe('inflight-reconciled||');
  });
});

describe('reportUploadIssue', () => {
  it('files the first watchdog trip for an item and only counts the later attempts', async () => {
    await expect(reportUploadIssue('watchdog-transfer-attempt-1', { item: 'thesis.pdf', attempt: 1 }, ctx())).resolves.toBe(true);
    await expect(reportUploadIssue('watchdog-transfer-attempt-2', { item: 'thesis.pdf', attempt: 2 }, ctx())).resolves.toBe(false);
    await expect(reportUploadIssue('watchdog-transfer-attempt-3', { item: 'thesis.pdf', attempt: 3 }, ctx())).resolves.toBe(false);
    await expect(reportUploadIssue('watchdog-transfer', { item: 'thesis.pdf', attempt: 1 }, ctx())).resolves.toBe(false);

    expect(filedTitles()).toEqual(['Mobile feedback: uploads — watchdog-transfer-attempt-1']);
    // The suppressed attempts still reach the console, with their count.
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('watchdog-transfer-attempt-3 (×3)'));
  });

  it('still files the terminal verdict for that item — it is a different fact', async () => {
    await reportUploadIssue('watchdog-transfer-attempt-1', { item: 'thesis.pdf' }, ctx());
    await expect(reportUploadIssue('item-failed', { item: 'thesis.pdf', error: 'stalled' }, ctx())).resolves.toBe(true);
    expect(filedTitles()).toHaveLength(2);
  });

  it('files the same anomaly for another item, and again for the same item in a new batch', async () => {
    await reportUploadIssue('item-failed', { item: 'IMG_6498.HEIC' }, ctx('b1'));
    await expect(reportUploadIssue('item-failed', { item: 'IMG_6505.HEIC' }, ctx('b1'))).resolves.toBe(true);
    await expect(reportUploadIssue('item-failed', { item: 'IMG_6498.HEIC' }, ctx('b1'))).resolves.toBe(false);
    await expect(reportUploadIssue('item-failed', { item: 'IMG_6498.HEIC' }, ctx('b2'))).resolves.toBe(true);
    expect(filedTitles()).toHaveLength(3);
  });

  it('names the batch in the description when the details do not', async () => {
    await reportUploadIssue('item-failed', { item: 'a.heic' }, ctx('batch-9'));
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.description).toContain('Batch: batch-9');
    expect(body.description).toContain('item: a.heic');
    expect(body.tags).toEqual(['Turtle App', 'Mobile app', 'bug', 'uploads']);
  });

  it('keeps the per-session ceiling', async () => {
    for (let i = 0; i < 10; i++) await reportUploadIssue('item-failed', { item: `f${i}.heic` }, ctx());
    expect(filedTitles()).toHaveLength(6);
  });

  it('is console-only without a pond to file to', async () => {
    await expect(reportUploadIssue('item-failed', { item: 'a.heic' }, {})).resolves.toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('item-failed'));
  });
});
