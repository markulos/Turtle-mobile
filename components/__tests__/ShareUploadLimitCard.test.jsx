import React from 'react';
import { act, fireEvent, render, screen, userEvent } from '@testing-library/react-native';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('../../utils/haptics', () => ({ tapHaptic: jest.fn(), notifyHaptic: jest.fn() }));
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: { mode: 'dark', colors: new Proxy({}, { get: () => '#888' }) } }),
}));

const mockApi = { get: jest.fn(), patch: jest.fn() };
jest.mock('../../context/ServerContext', () => ({ useServer: () => ({ api: mockApi }) }));

import ShareUploadLimitCard, { formatLimitMb, ceilingNotice } from '../ShareUploadLimitCard';

const settings = (over = {}) => ({
  settings: {
    share_upload_max_mb: 512, share_upload_effective_mb: 512, share_upload_hard_cap_mb: null, ...over,
  },
});

beforeEach(() => {
  mockApi.get.mockReset().mockResolvedValue(settings());
  mockApi.patch.mockReset().mockResolvedValue(settings());
});

describe('formatLimitMb', () => {
  test('whole units, and 0 is the word', () => {
    expect(formatLimitMb(0)).toBe('Unlimited');
    expect(formatLimitMb(512)).toBe('512 MB');
    expect(formatLimitMb(2048)).toBe('2 GB');
    expect(formatLimitMb(10240)).toBe('10 GB');
    expect(formatLimitMb(1536)).toBe('1.5 GB');
    expect(formatLimitMb(-1)).toBe('—');
  });
});

describe('ceilingNotice', () => {
  test('silent when the box has no cap, or the choice fits under it', () => {
    expect(ceilingNotice({ chosenMb: 4096, effectiveMb: 4096, hardCapMb: null })).toBeNull();
    expect(ceilingNotice({ chosenMb: 256, effectiveMb: 256, hardCapMb: 512 })).toBeNull();
  });

  test('speaks up when the machine overrode the choice', () => {
    // The case that would otherwise look like the save silently failed.
    expect(ceilingNotice({ chosenMb: 0, effectiveMb: 512, hardCapMb: 512 }))
      .toMatch(/capped at 512 MB.*visitors get 512 MB/);
    expect(ceilingNotice({ chosenMb: 4096, effectiveMb: 512, hardCapMb: 512 }))
      .toMatch(/capped at 512 MB/);
  });
});

describe('ShareUploadLimitCard', () => {
  test('shows what visitors actually get, and saves a preset', async () => {
    const user = userEvent.setup();
    await render(<ShareUploadLimitCard />);

    expect(await screen.findByText(/Visitors can upload files up to 512 MB/)).toBeTruthy();

    mockApi.patch.mockResolvedValue(settings({ share_upload_max_mb: 2048, share_upload_effective_mb: 2048 }));
    await user.press(screen.getByTestId('share-upload-preset-2048'));

    expect(mockApi.patch).toHaveBeenCalledWith('/settings', { share_upload_max_mb: 2048 });
    expect(screen.getByText(/Visitors can upload files up to 2 GB/)).toBeTruthy();
  });

  test('unlimited is a real choice and is stored as 0', async () => {
    const user = userEvent.setup();
    await render(<ShareUploadLimitCard />);
    await screen.findByTestId('share-upload-preset-0');

    mockApi.patch.mockResolvedValue(settings({ share_upload_max_mb: 0, share_upload_effective_mb: 0 }));
    await user.press(screen.getByTestId('share-upload-preset-0'));

    expect(mockApi.patch).toHaveBeenCalledWith('/settings', { share_upload_max_mb: 0 });
    expect(screen.getByText(/Visitors can upload files up to Unlimited/)).toBeTruthy();
  });

  test('a capped machine is explained, not silently obeyed', async () => {
    mockApi.get.mockResolvedValue(settings({
      share_upload_max_mb: 0, share_upload_effective_mb: 512, share_upload_hard_cap_mb: 512,
    }));
    await render(<ShareUploadLimitCard />);

    expect(await screen.findByText(/capped at 512 MB by SHARE_UPLOAD_MAX_BYTES/)).toBeTruthy();
  });

  test('a rejected save rolls the choice back', async () => {
    const user = userEvent.setup();
    await render(<ShareUploadLimitCard />);
    await screen.findByTestId('share-upload-preset-2048');

    mockApi.patch.mockRejectedValue(new Error('nope'));
    await user.press(screen.getByTestId('share-upload-preset-2048'));

    // Still the server's last known truth, not the optimistic guess.
    expect(screen.getByText(/Visitors can upload files up to 512 MB/)).toBeTruthy();
  });

  test('a nonsense custom value never reaches the server', async () => {
    const user = userEvent.setup();
    await render(<ShareUploadLimitCard />);
    const field = await screen.findByTestId('share-upload-custom');

    // changeText rather than type(): typing a controlled field character by
    // character leaves it holding only the LAST keystroke here, which would
    // have made this assert against "5" instead of "12.5".
    await act(async () => { fireEvent.changeText(field, '12.5'); });
    await user.press(screen.getByTestId('share-upload-custom-apply'));
    expect(mockApi.patch).not.toHaveBeenCalled();

    // …and a whole number does go through.
    await act(async () => { fireEvent.changeText(field, '3072'); });
    await user.press(screen.getByTestId('share-upload-custom-apply'));
    expect(mockApi.patch).toHaveBeenCalledWith('/settings', { share_upload_max_mb: 3072 });
  });
});
