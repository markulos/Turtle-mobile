/**
 * The IN YOUR POND section of the vault's sharing card — giving a thing to
 * someone who already has an account, rather than minting a link.
 *
 * The section is rendered through the whole sheet on purpose: its placement
 * ABOVE the public link is part of the design (the safe, common case first),
 * and a test that mounted the section alone could not notice it moving.
 *
 * The sheet serves two subjects now, a BOARD and a FOLDER, and the thing most
 * worth pinning is that they talk to different endpoint families off one
 * `subject` prop — a folder quietly asking `?album=` would read every board's
 * links as that folder's.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve()) }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('../../../../utils/haptics', () => ({
  impactHaptic: jest.fn(), notifyHaptic: jest.fn(), tapHaptic: jest.fn(),
}));

import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import VaultShareSheet from '../VaultShareSheet';

const theme = {
  colors: {
    background: '#000', surface: '#111', surfaceElevated: '#181818', surfaceHighlight: '#222',
    border: '#333', borderStrong: '#444',
    textPrimary: '#fff', textSecondary: '#bbb', textTertiary: '#999', textMuted: '#777',
    accentInfo: '#0a84ff',
  },
};

const BEA = { shareId: 'share_bea', userId: 'u_bea', name: 'Bea', avatarUrl: null, permission: 'view' };

/** A fake pond: Bea already has the board, Cal doesn't. */
function makeApi(over = {}) {
  return {
    get: jest.fn(async (path) => {
      if (path.startsWith('/album-access?')) return { success: true, album: 'Trip', people: [BEA] };
      if (path.startsWith('/folder-access?')) return { success: true, folderId: 'fld_trip', name: 'Trip', people: [BEA] };
      if (path === '/friends') {
        return {
          success: true,
          friends: [
            { id: 'u_bea', name: 'Bea', avatarUrl: null },
            { id: 'u_cal', name: 'Cal', avatarUrl: null },
          ],
        };
      }
      // `filteredBy` matters: the sheet refuses a folder listing that does not
      // say it filtered by folderId (an older pond ignores the parameter).
      if (path.startsWith('/album-shares?folderId=')) return { success: true, filteredBy: 'folderId', shares: [] };
      if (path.startsWith('/album-shares')) return { success: true, filteredBy: 'album', shares: [] };
      return {};
    }),
    post: jest.fn(async () => ({
      success: true,
      album: 'Trip',
      people: [BEA, { shareId: 'share_cal', userId: 'u_cal', name: 'Cal', permission: 'view' }],
      person: { shareId: 'share_cal', userId: 'u_cal', name: 'Cal', permission: 'view' },
    })),
    delete: jest.fn(async () => ({ success: true, removed: true })),
    patch: jest.fn(async () => ({ success: true })),
    ...over,
  };
}

const open = async (api, props = {}) => render(
  <VaultShareSheet
    visible
    subject={{ kind: 'album', id: 'Trip', name: 'Trip' }}
    api={api}
    theme={theme}
    baseUrl="https://pond"
    onClose={() => {}}
    {...props}
  />,
);

/** The same sheet, pointed at a folder instead of a board. */
const openFolder = async (api, props = {}) => render(
  <VaultShareSheet
    visible
    subject={{ kind: 'folder', id: 'fld_trip', name: 'Trip' }}
    api={api}
    theme={theme}
    baseUrl="https://pond"
    onClose={() => {}}
    {...props}
  />,
);

describe('a board’s pond access', () => {
  test('lists who already has the board', async () => {
    const api = makeApi();
    const view = await open(api);
    await waitFor(() => expect(view.getByText('Bea')).toBeTruthy());
    expect(view.getByText('Can view')).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith('/album-access?album=Trip');
  });

  test('says so plainly when the board is shared with nobody', async () => {
    const api = makeApi({
      get: jest.fn(async (path) => {
        if (path.startsWith('/album-access?')) return { success: true, people: [] };
        if (path === '/friends') return { success: true, friends: [] };
        return { success: true, shares: [] };
      }),
    });
    const view = await open(api);
    await waitFor(() => expect(view.getByText('Not shared with anyone yet.')).toBeTruthy());
  });

  test('the picker offers only people who do NOT already have it', async () => {
    const api = makeApi();
    const view = await open(api);
    await waitFor(() => expect(view.getByTestId('pond-access-open-picker')).toBeTruthy());
    fireEvent.press(view.getByTestId('pond-access-open-picker'));

    await waitFor(() => expect(view.getByTestId('pond-access-add-u_cal')).toBeTruthy());
    // Bea holds it already — offering her again would mint a second grant for
    // one person, which the server folds anyway.
    expect(view.queryByTestId('pond-access-add-u_bea')).toBeNull();
  });

  test('granting sends the member id and redraws from the server’s roster', async () => {
    const api = makeApi();
    const view = await open(api);
    await waitFor(() => expect(view.getByTestId('pond-access-open-picker')).toBeTruthy());
    fireEvent.press(view.getByTestId('pond-access-open-picker'));
    await waitFor(() => expect(view.getByTestId('pond-access-add-u_cal')).toBeTruthy());
    fireEvent.press(view.getByTestId('pond-access-add-u_cal'));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/album-access', {
      album: 'Trip', withUserId: 'u_cal',
    }));
    // The roster comes back from the POST, so the list cannot drift from what
    // the server actually stored.
    await waitFor(() => expect(view.getByText('Cal')).toBeTruthy());
  });

  test('a failed grant says so and leaves the roster alone', async () => {
    const api = makeApi({ post: jest.fn(async () => ({ success: false, error: "That member isn't in your pond." })) });
    const view = await open(api);
    await waitFor(() => expect(view.getByTestId('pond-access-open-picker')).toBeTruthy());
    fireEvent.press(view.getByTestId('pond-access-open-picker'));
    await waitFor(() => expect(view.getByTestId('pond-access-add-u_cal')).toBeTruthy());
    fireEvent.press(view.getByTestId('pond-access-add-u_cal'));

    await waitFor(() => expect(view.getByText("That member isn't in your pond.")).toBeTruthy());
    expect(view.getByText('Bea')).toBeTruthy();
  });

  test('removing someone confirms first, then deletes by SHARE id', async () => {
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const api = makeApi();
    const view = await open(api);
    await waitFor(() => expect(view.getByTestId('pond-access-remove-u_bea')).toBeTruthy());
    fireEvent.press(view.getByTestId('pond-access-remove-u_bea'));

    expect(spy).toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();

    // Take the destructive button out of the alert and press it.
    const remove = spy.mock.calls[0][2].find((b) => b.style === 'destructive');
    await remove.onPress();
    // The share id, not the user id: that is the row that revokes.
    expect(api.delete).toHaveBeenCalledWith('/album-access/share_bea');
    spy.mockRestore();
  });

  test('losing the pond directory does not erase who already has the board', async () => {
    // The two reads are independent. An empty roster would read as "shared with
    // nobody", which is a different claim from "could not list your pond".
    const api = makeApi({
      get: jest.fn(async (path) => {
        if (path.startsWith('/album-access?')) return { success: true, people: [BEA] };
        if (path === '/friends') throw new Error('offline');
        return { success: true, shares: [] };
      }),
    });
    const view = await open(api);
    await waitFor(() => expect(view.getByText('Bea')).toBeTruthy());
  });

  test('the pond section comes before the public link', async () => {
    const api = makeApi();
    const view = await open(api);
    await waitFor(() => expect(view.getByText('IN YOUR POND')).toBeTruthy());
    const order = view.getAllByText(/IN YOUR POND|PUBLIC LINK/).map((n) => n.props.children);
    expect(order).toEqual(['IN YOUR POND', 'PUBLIC LINK']);
  });
});

/**
 * The same sheet, pointed at a Files folder. What matters is that the subject
 * decides which endpoint family it talks to: a folder asking `?album=` would
 * read every board's links as this folder's, and a grant posted as `album`
 * would be interpreted against a name rather than a row.
 */
describe('a folder’s sharing', () => {
  test('reads the folder’s roster and links by ID, never by name', async () => {
    const api = makeApi();
    const view = await openFolder(api);
    await waitFor(() => expect(view.getByText('Bea')).toBeTruthy());
    expect(api.get).toHaveBeenCalledWith('/folder-access?folderId=fld_trip');
    expect(api.get).toHaveBeenCalledWith('/album-shares?folderId=fld_trip');
    // Not one album call anywhere.
    const asked = api.get.mock.calls.map((c) => c[0]);
    expect(asked.some((p) => p.includes('album-access'))).toBe(false);
    expect(asked.some((p) => p.includes('album-shares?album='))).toBe(false);
  });

  test('granting posts the folder id to the folder endpoint', async () => {
    const api = makeApi();
    const view = await openFolder(api);
    await waitFor(() => expect(view.getByTestId('pond-access-open-picker')).toBeTruthy());
    fireEvent.press(view.getByTestId('pond-access-open-picker'));
    await waitFor(() => expect(view.getByTestId('pond-access-add-u_cal')).toBeTruthy());
    fireEvent.press(view.getByTestId('pond-access-add-u_cal'));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/folder-access', {
      folderId: 'fld_trip', withUserId: 'u_cal',
    }));
  });

  test('says the subfolders come with it, next to BOTH ways of sharing', async () => {
    const api = makeApi();
    const view = await openFolder(api);
    await waitFor(() => expect(view.getByText('IN YOUR POND')).toBeTruthy());
    // Deliberately in both sections: either way of handing a folder over takes
    // the folders inside it, and that belongs beside each control rather than
    // once at the top where it reads as being about the other one.
    expect(view.getAllByText(/folders inside it/)).toHaveLength(2);
  });

  /** The web release and the OTA can both land before the server does. */
  test('a pond that cannot make folder links says so and offers no form', async () => {
    const api = makeApi({
      get: jest.fn(async (path) => {
        if (path.startsWith('/folder-access?')) return { success: true, people: [] };
        if (path === '/friends') return { success: true, friends: [] };
        // An older pond ignores ?folderId= and hands back everything it has.
        if (path.startsWith('/album-shares')) {
          return { success: true, filteredBy: null, shares: [{ id: 1, url: 'https://pond/s/other', album: 'Someone else', viewCount: 0 }] };
        }
        return {};
      }),
    });
    const view = await openFolder(api);
    await waitFor(() => expect(view.getByTestId('links-unsupported')).toBeTruthy());
    // The other board's link is NOT listed as this folder's…
    expect(view.queryByText('https://pond/s/other')).toBeNull();
    // …and there is nothing to press that would fail.
    expect(view.queryByText('Create link')).toBeNull();
  });

  test('a board is unaffected: it still asks by name and offers the form', async () => {
    const api = makeApi();
    const view = await open(api);
    await waitFor(() => expect(view.getByText('Create link')).toBeTruthy());
    expect(api.get).toHaveBeenCalledWith('/album-shares?album=Trip');
    expect(view.queryByTestId('links-unsupported')).toBeNull();
  });
});

/**
 * View vs edit, which only a FOLDER has.
 *
 * The pond will honour a permission on a folder share and not on a board's
 * (PERMISSIONS in server/routes/folderAccess.js vs routes/albumAccess.js), so
 * the control has to be absent on a board rather than present and futile.
 */
describe('a folder’s permission', () => {
  /** Press through the confirm Alert the toggle raises. */
  const confirm = (label) => {
    const call = Alert.alert.mock.calls.at(-1);
    if (!call) throw new Error('no Alert was raised');
    const button = (call[2] || []).find((b) => b.text === label);
    if (!button) throw new Error(`no “${label}” button on the Alert`);
    return button.onPress();
  };

  beforeEach(() => { jest.spyOn(Alert, 'alert').mockImplementation(() => {}); });
  afterEach(() => { Alert.alert.mockRestore?.(); });

  test('a folder row says what the person has and invites a change', async () => {
    const api = makeApi();
    const view = await openFolder(api);
    await waitFor(() => expect(view.getByText('Bea')).toBeTruthy());
    expect(view.getByText('Can view · tap to change')).toBeTruthy();
    expect(view.getByTestId('pond-access-permission-u_bea')).toBeTruthy();
  });

  test('a board row does not, because the pond would ignore it', async () => {
    const api = makeApi();
    const view = await open(api);
    await waitFor(() => expect(view.getByText('Bea')).toBeTruthy());
    expect(view.queryByTestId('pond-access-permission-u_bea')).toBeNull();
    expect(view.getByText('Can view')).toBeTruthy();
  });

  test('allowing edit PATCHes the share row and redraws from the answer', async () => {
    const api = makeApi({
      patch: jest.fn(async () => ({
        success: true,
        people: [{ ...BEA, permission: 'edit' }],
      })),
    });
    const view = await openFolder(api);
    await waitFor(() => expect(view.getByTestId('pond-access-permission-u_bea')).toBeTruthy());
    fireEvent.press(view.getByTestId('pond-access-permission-u_bea'));

    // Spelled out in verbs: handing somebody the ability to take your files
    // out of a folder is not a thing to discover afterwards.
    const [title, body] = Alert.alert.mock.calls.at(-1);
    expect(title).toContain('Let Bea edit');
    expect(body).toContain('take files out');
    expect(body).toContain('cannot delete the folder');

    await confirm('Allow editing');
    expect(api.patch).toHaveBeenCalledWith('/folder-access/share_bea', { permission: 'edit' });
    await waitFor(() => expect(view.getByText('Can edit · tap to change')).toBeTruthy());
  });

  test('going back to view is confirmed too, and says what it takes away', async () => {
    const api = makeApi({
      get: jest.fn(async (path) => {
        if (path.startsWith('/folder-access?')) {
          return { success: true, folderId: 'fld_trip', name: 'Trip', people: [{ ...BEA, permission: 'edit' }] };
        }
        if (path === '/friends') return { success: true, friends: [] };
        if (path.startsWith('/album-shares')) return { success: true, filteredBy: 'folderId', shares: [] };
        return {};
      }),
      patch: jest.fn(async () => ({ success: true, people: [BEA] })),
    });
    const view = await openFolder(api);
    await waitFor(() => expect(view.getByText('Can edit · tap to change')).toBeTruthy());
    fireEvent.press(view.getByTestId('pond-access-permission-u_bea'));

    const [title, body] = Alert.alert.mock.calls.at(-1);
    expect(title).toContain('view only');
    expect(body).toContain('Files they already added stay where they are');

    await confirm('View only');
    expect(api.patch).toHaveBeenCalledWith('/folder-access/share_bea', { permission: 'view' });
    await waitFor(() => expect(view.getByText('Can view · tap to change')).toBeTruthy());
  });

  test('cancelling changes nothing', async () => {
    const api = makeApi();
    const view = await openFolder(api);
    await waitFor(() => expect(view.getByTestId('pond-access-permission-u_bea')).toBeTruthy());
    fireEvent.press(view.getByTestId('pond-access-permission-u_bea'));

    expect((Alert.alert.mock.calls.at(-1)[2] || []).some((b) => b.style === 'cancel')).toBe(true);
    expect(api.patch).not.toHaveBeenCalled();
  });

  /** The OTA can land before the server does. A silent no-op is the worst case. */
  test('a pond whose server cannot do it yet says so', async () => {
    const api = makeApi({
      patch: jest.fn(async () => { throw new Error('API Error: 404'); }),
    });
    const view = await openFolder(api);
    await waitFor(() => expect(view.getByTestId('pond-access-permission-u_bea')).toBeTruthy());
    fireEvent.press(view.getByTestId('pond-access-permission-u_bea'));
    await confirm('Allow editing');

    await waitFor(() => expect(
      view.getByText('This pond’s server cannot change a folder’s permission yet.'),
    ).toBeTruthy());
    // And the row still reads what is actually true.
    expect(view.getByText('Can view · tap to change')).toBeTruthy();
  });

  /** A new grant must never start at edit — that is always a deliberate choice. */
  test('a fresh grant is still view', async () => {
    const api = makeApi();
    const view = await openFolder(api);
    await waitFor(() => expect(view.getByTestId('pond-access-open-picker')).toBeTruthy());
    fireEvent.press(view.getByTestId('pond-access-open-picker'));
    await waitFor(() => expect(view.getByTestId('pond-access-add-u_cal')).toBeTruthy());
    fireEvent.press(view.getByTestId('pond-access-add-u_cal'));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [, body] = api.post.mock.calls.at(-1);
    expect(body.permission).toBeUndefined();
  });
});
