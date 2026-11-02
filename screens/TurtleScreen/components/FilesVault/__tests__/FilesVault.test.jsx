import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));
jest.mock('expo-blur', () => ({ BlurView: 'BlurView' }));
// FilesVault calls useSafeAreaInsets() itself, and so do FolderPage and the
// ViewerSheet-backed FolderNameSheet it renders; there is no SafeAreaProvider
// under jest, so the hook needs a mock — same shape FolderPage.test.jsx and
// FolderSheets.test.jsx use for the identical reason.
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../../../../utils/haptics', () => ({ tapHaptic: jest.fn(), impactHaptic: jest.fn(), notifyHaptic: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(() => Promise.resolve(null)), setItem: jest.fn(() => Promise.resolve()) }));
// Named `mockApi` (not `api`): babel-plugin-jest-hoist only allows a
// jest.mock() factory to close over an outer variable whose name starts with
// "mock" — the same convention FolderPage.test.jsx / FolderSheets.test.jsx /
// useFolderData.test.js use for the identical ServerContext mock.
const mockApi = { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() };
jest.mock('../../../../../context/ServerContext', () => ({ useServer: () => ({ api: mockApi }), getApiAuthToken: () => 't' }));
jest.mock('../../../../../services/offlineQueue', () => ({ sendOrQueue: jest.fn(() => Promise.resolve({ queued: false, result: { success: true } })) }));
// FilesVault pushes FolderPage once a folder is open, and FolderPage imports
// the real documentOpen.js (expo-file-system/legacy + expo-sharing) at module
// scope; FolderPage.test.jsx mocks it for the same reason even though this
// suite never presses a document row.
jest.mock('../documentOpen', () => ({ openDocument: jest.fn(() => Promise.resolve({ uri: 'x', cached: true })) }));
jest.mock('../../EdgeSwipePage', () => ({ visible, children }) => (visible ? children : null));

import FilesVault, { folderCreatedLabel, matchFolders } from '../FilesVault';
import FolderPage from '../FolderPage';

const theme = { mode: 'dark', colors: { background: '#000', surface: '#0a0a0a', surfaceElevated: '#111', textPrimary: '#fff', textSecondary: '#aaa', textMuted: '#666', primary: '#fff', border: '#222', accentError: '#f55' } };

// C1: FilesVault no longer owns its folder-page stack — MediaGallery does,
// rendering the FolderPage list at the gallery root, above the vault's own
// floating header (see the "zIndex is load-bearing" note on MediaGallery's
// photos page). This Host mirrors that split exactly — FilesVault gets a
// controlled `stack`/`onStackChange`, and the FolderPage list is rendered as
// an EXTERNAL sibling, the same shape MediaGallery uses — so these tests
// keep exercising the real push/pop contract instead of FilesVault's old
// internal state.
function Host(props) {
  const [stack, setStack] = React.useState([]);
  return (
    <>
      <FilesVault {...props} stack={stack} onStackChange={setStack} />
      {stack.map((level, i) => (
        <FolderPage
          key={`${level.parent}-${i}`}
          visible
          parent={level.parent}
          onClose={() => setStack((s) => s.slice(0, -1))}
          onOpenFolder={(f) => setStack((s) => [...s, { parent: f.id }])}
          onOpenMedia={props.onOpenMedia}
          onBulkTag={props.onBulkTag}
          onUploadHere={props.onUploadHere}
          getFullUrl={props.getFullUrl}
          base={props.base}
          theme={props.theme}
          topInset={0}
          bottomInset={0}
        />
      ))}
    </>
  );
}
const root = { success: true, folder: null, path: [], folders: [{ id: 'fld_aaaaaaaaaaaa', name: 'Scans', itemCount: 3, folderCount: 1, covers: ['/t/1.jpg'] }], items: [], unfiled: { count: 2 }, pagination: { total: 0, limit: 200, offset: 0, hasMore: false } };
const scans = { success: true, folder: { id: 'fld_aaaaaaaaaaaa', name: 'Scans' }, path: [{ id: 'fld_aaaaaaaaaaaa', name: 'Scans' }], folders: [], items: [{ id: 'd1', type: 'document', originalName: 'a.pdf', uploadDate: 1, rawUrl: '/r', thumbnailUrl: null }], pagination: { total: 1, limit: 200, offset: 0, hasMore: false } };
const taxes = { success: true, folder: { id: 'fld_bbbbbbbbbbbb', name: 'Taxes' }, path: [{ id: 'fld_aaaaaaaaaaaa', name: 'Scans' }, { id: 'fld_bbbbbbbbbbbb', name: 'Taxes' }], folders: [], items: [], pagination: { total: 0, limit: 200, offset: 0, hasMore: false } };

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.get.mockImplementation((p) => Promise.resolve(p.includes('parent=root') ? root : p.includes('fld_bbbbbbbbbbbb') ? taxes : scans));
});

// NOTE: @testing-library/react-native 14.0.1's render/rerender/fireEvent/waitFor
// are all `async function`s in this repo's installed version (confirmed by
// FolderPage.test.jsx / FolderSheets.test.jsx) — every call is awaited here.
describe('FilesVault', () => {
  it('shows Unfiled first, then the folders A–Z, and pushes a folder page on tap', async () => {
    const { getByText, getByLabelText, queryByText } = await render(<Host theme={theme} getFullUrl={(p) => `http://pond${p}`} base="http://pond" onOpenMedia={jest.fn()} onBulkTag={jest.fn()} onUploadHere={jest.fn()} />);
    await waitFor(() => getByText('Scans'));
    expect(getByText('Unfiled')).toBeTruthy();
    // The root is a LIST now, so a count is part of a row's meta line rather
    // than a bare number under a tile — "2 items", possibly behind a creation
    // date. Matched loosely because the date is locale-formatted and the point
    // here is that Unfiled's count reached the row at all.
    expect(getByText(/2 items/)).toBeTruthy();
    await fireEvent.press(getByLabelText(/^Open folder Scans/));
    await waitFor(() => getByText('a.pdf'));
    await fireEvent.press(getByLabelText('Back'));
    await waitFor(() => expect(queryByText('a.pdf')).toBeNull());
  });

  it('an open-target for a nested folder pushes the whole crumb chain', async () => {
    const consumed = jest.fn();
    const { getAllByText, getByText } = await render(<Host theme={theme} getFullUrl={(p) => p} base="" onOpenMedia={jest.fn()} onBulkTag={jest.fn()} onUploadHere={jest.fn()} target={{ kind: 'folder', id: 'fld_bbbbbbbbbbbb' }} onTargetConsumed={consumed} />);
    await waitFor(() => getAllByText('Taxes'));
    expect(consumed).toHaveBeenCalled();
    // getAllByText, not getByText: the root's own "Scans" folder disc stays
    // mounted underneath the pushed pages (EdgeSwipePage's jest mock has no
    // occlusion, unlike the real overlay), and the Taxes-level FolderPage's
    // own crumb bar repeats "Scans" as an ancestor crumb — so it legitimately
    // renders more than once at once.
    expect(getAllByText('Scans').length).toBeGreaterThan(0);
    // Discriminator: "a.pdf" only exists in the `scans` fixture's items,
    // which useFolderData only serves to the Scans-level FolderPage (parent
    // fld_aaaaaaaaaaaa). If only the Taxes leaf were pushed (its own crumb
    // bar alone already renders "Scans" and "Taxes"), this would never
    // appear — so this pins both stack levels being mounted, not just one.
    await waitFor(() => getByText('a.pdf'));
  });
});

// ── Finding and making are the same field ──────────────────────────────────
//
// The `+` used to open a modal sheet with a name box in it. Now it opens the
// vault's own search field — the Boards tab's, shared — so the name you type is
// also a search, and you find out you already have a "Scans" before you make a
// second one.
describe('FilesVault search / create', () => {
  const draw = () => render(<Host theme={theme} getFullUrl={(p) => `http://pond${p}`} base="http://pond" onOpenMedia={jest.fn()} onBulkTag={jest.fn()} onUploadHere={jest.fn()} />);

  it('filters the folders to rows as you type', async () => {
    const { getByText, getByTestId, queryByText } = await draw();
    await waitFor(() => getByText('Scans'));
    // Unfiled and the tiles are the BROWSING view; typing replaces them.
    await fireEvent.changeText(getByTestId('files-search-input'), 'sca');
    await waitFor(() => getByTestId('files-row-fld_aaaaaaaaaaaa'));
    expect(queryByText('Unfiled')).toBeNull();
  });

  it('offers to create a name that is not a folder yet, and not one that is', async () => {
    const { getByText, getByTestId, queryByTestId } = await draw();
    await waitFor(() => getByText('Scans'));
    await fireEvent.changeText(getByTestId('files-search-input'), 'Receipts');
    await waitFor(() => getByTestId('files-create-row'));
    // An exact name that already exists must NOT offer to make a second one.
    await fireEvent.changeText(getByTestId('files-search-input'), 'scans');
    await waitFor(() => expect(queryByTestId('files-create-row')).toBeNull());
    // ...but a name that merely PREFIXES an existing one is still creatable.
    await fireEvent.changeText(getByTestId('files-search-input'), 'Scan');
    await waitFor(() => getByTestId('files-create-row'));
  });

  it('creating posts the folder and leaves search', async () => {
    const { sendOrQueue } = require('../../../../../services/offlineQueue');
    sendOrQueue.mockResolvedValueOnce({ queued: false, result: { success: true, folder: { id: 'fld_cccccccccccc', name: 'Receipts' } } });
    const { getByText, getByTestId, queryByTestId } = await draw();
    await waitFor(() => getByText('Scans'));
    await fireEvent.changeText(getByTestId('files-search-input'), 'Receipts');
    await fireEvent.press(getByTestId('files-create-row'));
    await waitFor(() => expect(sendOrQueue).toHaveBeenCalled());
    // (api, request, …) — the request is the second argument.
    expect(sendOrQueue.mock.calls[0][1]).toMatchObject({ method: 'post', path: '/folders', body: { name: 'Receipts' } });
    // The field empties and the browsing view comes back.
    await waitFor(() => expect(queryByTestId('files-create-row')).toBeNull());
  });

  // The one thing worth keeping from the sheet: a server rejection is reported
  // where the name still is, so it can be edited rather than retyped.
  it('reports a rejected name under the field', async () => {
    const { sendOrQueue } = require('../../../../../services/offlineQueue');
    sendOrQueue.mockRejectedValueOnce(new Error('A folder named Receipts already exists here.'));
    const { getByText, getByTestId } = await draw();
    await waitFor(() => getByText('Scans'));
    await fireEvent.changeText(getByTestId('files-search-input'), 'Receipts');
    await fireEvent.press(getByTestId('files-create-row'));
    await waitFor(() => getByText('A folder named Receipts already exists here.'));
  });

  it('the + key opens the field rather than a sheet', async () => {
    const { getByText, getByTestId, queryByText } = await draw();
    await waitFor(() => getByText('Scans'));
    await fireEvent.press(getByTestId('files-search-add'));
    // The old sheet's chrome is gone for good.
    expect(queryByText('New folder')).toBeNull();
    expect(getByTestId('files-search-input')).toBeTruthy();
  });
});

describe('matchFolders', () => {
  const f = (name) => ({ id: name, name });

  it('is everything when nothing is typed', () => {
    const all = [f('Scans'), f('Taxes')];
    expect(matchFolders(all, '').matches).toBe(all);
    expect(matchFolders(all, '   ').exact).toBe(false);
  });

  it('matches anywhere in the name, ignoring case and edge spacing', () => {
    const all = [f('Tax Returns'), f('Scans')];
    expect(matchFolders(all, 'RETURN').matches.map((x) => x.name)).toEqual(['Tax Returns']);
    expect(matchFolders(all, '  scans  ').matches.map((x) => x.name)).toEqual(['Scans']);
  });

  // `exact` is what suppresses the create row, and a SUBSTRING match is not
  // enough: "Tax" must stay creatable next to "Taxes 2024", or you can never
  // make the shorter name once the longer one exists.
  it('is exact only on the whole name, not on a prefix of one', () => {
    const all = [f('Taxes 2024')];
    expect(matchFolders(all, 'Tax').exact).toBe(false);
    expect(matchFolders(all, 'taxes 2024').exact).toBe(true);
  });

  it('survives a missing list', () => {
    expect(matchFolders(null, 'x').matches).toEqual([]);
    expect(matchFolders(undefined, '').matches).toEqual([]);
  });
});

/**
 * The date under a folder's name. Absolute, not relative: the question a
 * folder's date answers is "which batch of work is this", and that is a date
 * rather than a distance.
 */
describe('folderCreatedLabel', () => {
  const NOW = Date.parse('2026-11-01T12:00:00Z');

  it('drops the year inside the current one, where it is noise on every row', () => {
    const label = folderCreatedLabel(Date.parse('2026-03-12T10:00:00Z'), NOW);
    expect(label).toMatch(/12/);
    expect(label).not.toMatch(/2026/);
  });

  it('keeps the year once it is a different one', () => {
    expect(folderCreatedLabel(Date.parse('2024-03-12T10:00:00Z'), NOW)).toMatch(/2024/);
  });

  it('reads an ISO string as readily as a number', () => {
    expect(folderCreatedLabel('2024-03-12T10:00:00Z', NOW)).toMatch(/2024/);
  });

  // A folder made before the column existed, or the synthetic Unfiled row.
  // The row shows its count alone rather than the words "Invalid Date".
  it('answers null for anything it cannot read, rather than a broken date', () => {
    for (const bad of [null, undefined, '', 0, 'not a date', NaN]) {
      expect(folderCreatedLabel(bad, NOW)).toBeNull();
    }
  });
});

/**
 * The share mark is a QUESTION, so it is its own target.
 *
 * Tapping a row opens the folder. Tapping the mark asks the thing the mark
 * raises — who exactly can see this — and that is a different intent, so it
 * must not just be a second way to open the folder.
 */
describe('FilesVault share mark', () => {
  const shared = {
    ...root,
    folders: [{ id: 'fld_aaaaaaaaaaaa', name: 'Scans', itemCount: 3, folderCount: 1, covers: ['/t/1.jpg'] }],
  };

  beforeEach(() => {
    mockApi.get.mockImplementation((p) => {
      if (p.includes('/folder-access/mine')) {
        return Promise.resolve({ success: true, folders: { fld_aaaaaaaaaaaa: [{ userId: 'u1' }, { userId: 'u2' }] } });
      }
      return Promise.resolve(p.includes('parent=root') ? shared : p.includes('fld_bbbbbbbbbbbb') ? taxes : scans);
    });
  });

  it('marks a shared folder with its count, and leaves the others unmarked', async () => {
    const { getByTestId, queryByTestId } = await render(<Host theme={theme} getFullUrl={(p) => p} base="" onOpenMedia={jest.fn()} onBulkTag={jest.fn()} onUploadHere={jest.fn()} />);
    await waitFor(() => getByTestId('files-share-fld_aaaaaaaaaaaa'));
    expect(queryByTestId('files-share-unfiled')).toBeNull();
  });

  it('opens share settings rather than the folder', async () => {
    const { getByTestId, queryByText } = await render(<Host theme={theme} getFullUrl={(p) => p} base="" onOpenMedia={jest.fn()} onBulkTag={jest.fn()} onUploadHere={jest.fn()} />);
    await waitFor(() => getByTestId('files-share-fld_aaaaaaaaaaaa'));
    await fireEvent.press(getByTestId('files-share-fld_aaaaaaaaaaaa'));
    // The folder's own contents would mean the row's onPress fired instead.
    await waitFor(() => expect(queryByText('a.pdf')).toBeNull());
  });
});
