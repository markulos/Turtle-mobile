import React from 'react';
import { Share } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import MarkdownText from '../MarkdownText';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('../../utils/haptics', () => ({ tapHaptic: jest.fn() }));

// expo-clipboard is a NATIVE module — absent from the jest runtime exactly as
// it is absent from a binary compiled before the dependency landed. These
// suites therefore exercise the SHARE fallback by default, which is the path
// copyText exists to provide; the clipboard path is opted into per test.
const mockSetString = jest.fn();
jest.mock('expo-clipboard', () => ({ setStringAsync: (...a) => mockSetString(...a) }), { virtual: true });

const theme = {
  colors: {
    textPrimary: '#fff',
    textSecondary: '#aaa',
    accentInfo: '#60A5FA',
    accentSuccess: '#34D399',
  },
};

const renderMd = async (text) => render(<MarkdownText text={text} theme={theme} style={{ fontSize: 15 }} />);

describe('MarkdownText copy affordance', () => {
  beforeEach(() => {
    mockSetString.mockReset().mockResolvedValue(undefined);
  });

  test('puts a copy key on a fenced block and copies its text', async () => {
    const view = await renderMd('Here you go:\n\n```\nWrite me a haiku about turtles\n```');

    const key = view.getByTestId('markdown-copy-code');
    expect(key.props.accessibilityRole).toBe('button');
    // The fence's OWN text, not the surrounding prose — the whole point of
    // hanging the control off the block rather than the message.
    await fireEvent.press(key);
    await waitFor(() => expect(mockSetString).toHaveBeenCalledWith('Write me a haiku about turtles'));
  });

  test('labels the key with the fence language when one was declared', async () => {
    const view = await renderMd('```bash\nnpm test\n```');
    expect(view.getByLabelText('Copy this bash block')).toBeTruthy();
    expect(view.getByText('bash')).toBeTruthy();
  });

  test('a fence with no language still gets a key, and a generic label', async () => {
    const view = await renderMd('```\nplain\n```');
    expect(view.getByLabelText('Copy this block')).toBeTruthy();
  });

  test('confirms back to the user after a successful copy', async () => {
    const view = await renderMd('```\ntake me\n```');
    expect(view.getByText('Copy')).toBeTruthy();

    await fireEvent.press(view.getByTestId('markdown-copy-code'));
    await waitFor(() => expect(view.getByText('Copied')).toBeTruthy());
  });

  test('says Shared, not Copied, when it fell back to the share sheet', async () => {
    // The older-binary case: the module is there but refuses.
    mockSetString.mockRejectedValue(new Error('no native module'));
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    const view = await renderMd('```\ntake me\n```');

    await fireEvent.press(view.getByTestId('markdown-copy-code'));
    await waitFor(() => expect(view.getByText('Shared')).toBeTruthy());
    share.mockRestore();
  });

  test('claims nothing when the clipboard failed AND the share sheet was dismissed', async () => {
    // Saying "Copied" here would be a lie — the text went nowhere.
    mockSetString.mockRejectedValue(new Error('no native module'));
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.dismissedAction });
    const view = await renderMd('```\ntake me\n```');

    await fireEvent.press(view.getByTestId('markdown-copy-code'));
    await waitFor(() => expect(Share.share).toHaveBeenCalled());
    expect(view.getByText('Copy')).toBeTruthy();
    expect(view.queryByText('Copied')).toBeNull();
    share.mockRestore();
  });

  // The control is tied to the reply's OWN formatting: a fence means "this is
  // an artefact, take it". Prose is to read. Keys on both would mean neither.
  test('leaves prose, headings, lists and quotes without a key', async () => {
    const view = await renderMd([
      '# A heading',
      'A paragraph with `inline code` in it.',
      '- a list item',
      '> a quote',
    ].join('\n\n'));

    expect(view.queryByTestId('markdown-copy-code')).toBeNull();
  });

  // Regression, 2026-09-16: a copied prompt came back cut off "like there's a
  // character limit". There wasn't one anywhere — the real reply was 5,231
  // chars with a 4,426-char fence, stored whole and parsed whole; the cut came
  // from hand-dragging an iOS text selection through a block that tall, which
  // is the thing the key replaces. This pins the no-limit end of it: a fence
  // the size of a real prompt copies byte-for-byte, first line to last.
  test('copies a prompt-sized fence whole — no cap between parse and clipboard', async () => {
    const body = Array.from({ length: 89 }, (_, i) => (
      i === 0 ? 'Add UI for the visitor-upload size cap to the iOS app.'
        : i === 88 ? '- Show me the diff before promoting an OTA build.'
          : `line ${i} — "share_upload_effective_mb": 512 <- derived, READ ONLY`
    )).join('\n');
    expect(body.length).toBeGreaterThan(4000);

    const view = await renderMd(`Here's the prompt.\n\n---\n\n\`\`\`\n${body}\n\`\`\`\n\nTell me if you want it narrower.`);

    await fireEvent.press(view.getByTestId('markdown-copy-code'));
    await waitFor(() => expect(mockSetString).toHaveBeenCalled());
    const copied = mockSetString.mock.calls[0][0];
    expect(copied).toBe(body);
    expect(copied).toHaveLength(body.length);
    // The two ends specifically — a truncation anywhere shows up here first.
    expect(copied.startsWith('Add UI for the visitor-upload size cap')).toBe(true);
    expect(copied.endsWith('- Show me the diff before promoting an OTA build.')).toBe(true);
    // And the surrounding prose is NOT swept in: the key is the fence's, not
    // the message's.
    expect(copied).not.toContain("Here's the prompt");
    expect(copied).not.toContain('Tell me if you want it narrower');
  });

  test('gives every fence in one reply its own key', async () => {
    const view = await renderMd('```\nfirst\n```\n\nthen\n\n```\nsecond\n```');
    expect(view.getAllByTestId('markdown-copy-code')).toHaveLength(2);

    await fireEvent.press(view.getAllByTestId('markdown-copy-code')[1]);
    await waitFor(() => expect(mockSetString).toHaveBeenCalledWith('second'));
  });
});
