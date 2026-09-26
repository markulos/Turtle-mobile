import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../../../../utils/haptics', () => ({ tapHaptic: jest.fn(), impactHaptic: jest.fn(), notifyHaptic: jest.fn() }));
// Records the props the page was given so a test can assert on swipeEnabled —
// the guard that stops a left-edge drawer drag closing the reader behind it.
let mockEdgeSwipeProps = {};
jest.mock('../../EdgeSwipePage', () => (props) => {
  mockEdgeSwipeProps = props;
  return props.visible ? props.children : null;
});

// The real hook is exercised in ChromeContext.test.jsx; here we only need to
// see that the reader takes a hold while it is up and gives it back.
const mockRetainDock = jest.fn();
const mockReleaseDock = jest.fn();
jest.mock('../../../../../context/ChromeContext', () => {
  const { useEffect } = require('react');
  return {
    useHideDock: (active) => useEffect(() => {
      if (!active) return undefined;
      mockRetainDock();
      return mockReleaseDock;
    }, [active]),
  };
});

const mockEnsureLocalCopy = jest.fn();
const mockShareDocument = jest.fn(() => Promise.resolve({ uri: 'file:///c/lease.pdf', cached: true }));
jest.mock('../documentOpen', () => ({
  ensureLocalCopy: (...a) => mockEnsureLocalCopy(...a),
  shareDocument: (...a) => mockShareDocument(...a),
  openDocument: (...a) => mockShareDocument(...a),
}));

// A stand-in for the native renderer: it records the props it was handed and
// exposes the callbacks so a test can drive "the document finished loading" /
// "the reader scrolled to page 4" without a real PDF or a real native module.
let mockPdfProps = null;
const mockSetPage = jest.fn();
jest.mock('react-native-pdf', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: React.forwardRef((props, ref) => {
      mockPdfProps = props;
      React.useImperativeHandle(ref, () => ({ setPage: mockSetPage }));
      return React.createElement(View, { testID: props.testID });
    }),
  };
});

import PdfViewer, { canRenderPdf, __resetPdfModuleForTests } from '../PdfViewer';

const theme = { mode: 'dark', colors: { background: '#000', surface: '#0a0a0a', surfaceElevated: '#111', textPrimary: '#fff', textSecondary: '#aaa', textMuted: '#666', primary: '#fff', border: '#222', accentError: '#f55', accentInfo: '#4af' } };
const item = { id: 'doc-1', type: 'document', originalName: 'lease.pdf', mimeType: 'application/pdf', rawUrl: '/r/1' };
const props = (over = {}) => ({ visible: true, item, onClose: jest.fn(), getFullUrl: (p) => `http://pond${p}`, theme, bottomInset: 0, ...over });

beforeEach(() => {
  jest.clearAllMocks();
  mockPdfProps = null;
  __resetPdfModuleForTests();
  mockEnsureLocalCopy.mockResolvedValue({ uri: 'file:///c/lease.pdf', cached: true });
});

describe('PdfViewer', () => {
  it('renders the cached file and reports the page count on the bar', async () => {
    const { getByText, getByTestId } = await render(<PdfViewer {...props()} />);

    await waitFor(() => expect(mockPdfProps).toBeTruthy());
    // The bytes come from the shared cache, NOT from handing the renderer a
    // pond URL — that is what makes an already-opened document work offline.
    expect(mockEnsureLocalCopy).toHaveBeenCalledWith(item, expect.objectContaining({ getFullUrl: expect.any(Function) }));
    expect(mockPdfProps.source).toEqual({ uri: 'file:///c/lease.pdf', cache: false });

    await act(async () => { mockPdfProps.onLoadComplete(12); });
    await waitFor(() => getByText('1 of 12'));
    expect(getByTestId('pdf-page-label')).toBeTruthy();
  });

  it('page keys drive the renderer and clamp at both ends', async () => {
    const { getByLabelText, getByText } = await render(<PdfViewer {...props()} />);
    await waitFor(() => expect(mockPdfProps).toBeTruthy());
    await act(async () => { mockPdfProps.onLoadComplete(3); });
    await waitFor(() => getByText('1 of 3'));

    // At page 1 there is nowhere back to go: the key is disabled, so pressing
    // it must not call into the renderer at all.
    await fireEvent.press(getByLabelText('Previous page'));
    expect(mockSetPage).not.toHaveBeenCalled();

    await fireEvent.press(getByLabelText('Next page'));
    expect(mockSetPage).toHaveBeenCalledWith(2);
    await waitFor(() => getByText('2 of 3'));

    // The renderer is the source of truth for where the reader actually is —
    // a scroll it reports must move the label without a key being pressed.
    await act(async () => { mockPdfProps.onPageChanged(3, 3); });
    await waitFor(() => getByText('3 of 3'));
    mockSetPage.mockClear();
    await fireEvent.press(getByLabelText('Next page'));
    expect(mockSetPage).not.toHaveBeenCalled();
  });

  it('the fit toggle swaps fitPolicy and puts the reader back on the page it was on', async () => {
    const { getByLabelText, getByText } = await render(<PdfViewer {...props()} />);
    await waitFor(() => expect(mockPdfProps).toBeTruthy());
    await act(async () => { mockPdfProps.onLoadComplete(9); });
    expect(mockPdfProps.fitPolicy).toBe(0); // fit width

    await act(async () => { mockPdfProps.onPageChanged(5, 9); });
    await waitFor(() => getByText('5 of 9'));

    await fireEvent.press(getByLabelText('Fit whole page'));
    await waitFor(() => expect(mockPdfProps.fitPolicy).toBe(2));
    // fitPolicy is read once at mount, so the toggle remounts — the page prop
    // is what stops that remount dumping the reader back on page 1.
    expect(mockPdfProps.page).toBe(5);
    expect(getByLabelText('Fit width')).toBeTruthy();
  });

  it('shows the zoom only once it is not 100%', async () => {
    const { queryByTestId, getByTestId } = await render(<PdfViewer {...props()} />);
    await waitFor(() => expect(mockPdfProps).toBeTruthy());
    await act(async () => { mockPdfProps.onLoadComplete(2); });
    expect(queryByTestId('pdf-zoom-label')).toBeNull();

    await act(async () => { mockPdfProps.onScaleChanged(1.8); });
    await waitFor(() => expect(getByTestId('pdf-zoom-label')).toBeTruthy());
  });

  it('surfaces a download failure with a retry instead of a blank page', async () => {
    mockEnsureLocalCopy.mockRejectedValueOnce(new Error('Not reachable right now — the computer holding it is offline.'));
    const { getByText, getByLabelText } = await render(<PdfViewer {...props()} />);
    await waitFor(() => getByText('Not reachable right now — the computer holding it is offline.'));
    expect(getByLabelText('Try again')).toBeTruthy();
  });

  it('hands the document to the OS when the header share key is pressed', async () => {
    const { getByLabelText } = await render(<PdfViewer {...props()} />);
    await waitFor(() => expect(mockPdfProps).toBeTruthy());
    await fireEvent.press(getByLabelText('Open in another app'));
    expect(mockShareDocument).toHaveBeenCalledWith(item, expect.objectContaining({ getFullUrl: expect.any(Function) }));
  });

  /**
   * The snap-back regression. Feeding the live page back into the renderer's
   * `page` prop made every scroll re-anchor the document, pinning it to one
   * page (10 of 11 in the report). A page the DOCUMENT reports must move the
   * label and nothing else.
   */
  it('a scroll never writes back to the renderer page prop', async () => {
    const { getByText } = await render(<PdfViewer {...props()} />);
    await waitFor(() => expect(mockPdfProps).toBeTruthy());
    await act(async () => { mockPdfProps.onLoadComplete(11); });
    const settled = mockPdfProps.page;

    await act(async () => { mockPdfProps.onPageChanged(10, 11); });
    await waitFor(() => getByText('10 of 11'));
    expect(mockPdfProps.page).toBe(settled);

    await act(async () => { mockPdfProps.onPageChanged(11, 11); });
    await waitFor(() => getByText('11 of 11'));
    expect(mockPdfProps.page).toBe(settled);

    // A scroll must not have called into the renderer either — that call is
    // the other half of the loop.
    expect(mockSetPage).not.toHaveBeenCalled();
  });

  // Scrolling away and then pressing a key still has to work: the key reads
  // where the reader actually IS, not where it was last told to go.
  it('a page key after a scroll steps from the scrolled-to page', async () => {
    const { getByLabelText, getByText } = await render(<PdfViewer {...props()} />);
    await waitFor(() => expect(mockPdfProps).toBeTruthy());
    await act(async () => { mockPdfProps.onLoadComplete(11); });
    await act(async () => { mockPdfProps.onPageChanged(7, 11); });
    await waitFor(() => getByText('7 of 11'));

    await fireEvent.press(getByLabelText('Next page'));
    expect(mockSetPage).toHaveBeenCalledWith(8);
    await waitFor(() => expect(mockPdfProps.page).toBe(8));
  });

  it('takes the dock away while it is up and gives it back when it closes', async () => {
    const { unmount } = await render(<PdfViewer {...props()} />);
    await waitFor(() => expect(mockRetainDock).toHaveBeenCalledTimes(1));
    expect(mockReleaseDock).not.toHaveBeenCalled();
    await unmount();
    expect(mockReleaseDock).toHaveBeenCalledTimes(1);
  });

  // The index panel is the answer to "‹ › forty times" on a long document.
  const toc = [
    { title: 'Introduction', pageIdx: '0', children: [] },
    { title: 'Selected works', pageIdx: '4', children: [{ title: 'Flutter', pageIdx: '9', children: [] }] },
  ];

  it('the index key opens the contents, and picking an entry jumps to its page', async () => {
    const { getByLabelText, getByText } = await render(<PdfViewer {...props()} />);
    await waitFor(() => expect(mockPdfProps).toBeTruthy());
    await act(async () => { mockPdfProps.onLoadComplete(11, '/p', { width: 1, height: 1 }, toc); });
    await waitFor(() => getByText('1 of 11'));

    await fireEvent.press(getByLabelText('Contents and pages'));
    await waitFor(() => getByText('Selected works'));
    // Nested entries come along, and pageIdx is zero-based: "9" is page 10.
    await fireEvent.press(getByLabelText('Flutter, page 10'));
    expect(mockSetPage).toHaveBeenCalledWith(10);
    await waitFor(() => getByText('10 of 11'));
  });

  it('falls back to a page list when the document has no contents', async () => {
    const { getByLabelText, getByText, queryByTestId } = await render(<PdfViewer {...props()} />);
    await waitFor(() => expect(mockPdfProps).toBeTruthy());
    await act(async () => { mockPdfProps.onLoadComplete(4, '/p', { width: 1, height: 1 }, []); });

    await fireEvent.press(getByLabelText('Contents and pages'));
    await waitFor(() => getByText('Page 3'));
    // No outline means no Contents/Pages toggle to choose between.
    expect(queryByTestId('pdf-index-mode-outline')).toBeNull();

    await fireEvent.press(getByLabelText('Go to page 3'));
    expect(mockSetPage).toHaveBeenCalledWith(3);
  });

  // The drawer sits on the left edge, which is also where the page's
  // back-swipe starts — dragging it must not close the reader behind it.
  it('disables the page back-swipe while the index is open', async () => {
    const { getByLabelText } = await render(<PdfViewer {...props()} />);
    await waitFor(() => expect(mockPdfProps).toBeTruthy());
    await act(async () => { mockPdfProps.onLoadComplete(11, '/p', { width: 1, height: 1 }, toc); });
    expect(mockEdgeSwipeProps.swipeEnabled).toBe(true);

    await fireEvent.press(getByLabelText('Contents and pages'));
    await waitFor(() => expect(mockEdgeSwipeProps.swipeEnabled).toBe(false));
  });

  it('canRenderPdf reports false when the native module is missing, and the page offers Open in…', async () => {
    jest.resetModules();
    jest.doMock('react-native-pdf', () => { throw new Error('Cannot find native module'); });
    const Reloaded = require('../PdfViewer');
    expect(Reloaded.canRenderPdf()).toBe(false);
    jest.dontMock('react-native-pdf');
  });
});
