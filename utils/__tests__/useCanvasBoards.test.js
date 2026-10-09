/**
 * The canvas store: one read, shared, and NO writes.
 *
 * The last of those is the safety property of this whole feature, not a
 * detail. The desktop saves a canvas by rewriting the entire boards array —
 * last writer wins — so a phone that wrote anything could blank a board being
 * arranged on a desktop left open in another room. The phone reads. This test
 * is what says so out loud, and what fails the day someone adds a save here
 * without answering the conflict question first.
 */
import {
  __resetCanvasBoards,
  canvasBoards,
  canvasBoardsLoaded,
  loadCanvasBoards,
  subscribeCanvasBoards,
} from '../useCanvasBoards';

const BOARD = {
  id: 'b1',
  name: 'Moodboard',
  createdAt: 1,
  updatedAt: 2,
  items: [{ id: 'i1', kind: 'media', ref: 'm1', x: 0, y: 0, w: 100, h: 100, z: 0 }],
};

const apiWith = (settings) => ({
  get: jest.fn().mockResolvedValue({ user: { settings } }),
  patch: jest.fn(),
  put: jest.fn(),
  post: jest.fn(),
  delete: jest.fn(),
});

beforeEach(() => {
  __resetCanvasBoards();
  jest.clearAllMocks();
});

test('reads the boards the desktop wrote, through /me', async () => {
  const api = apiWith({ canvasBoards: [BOARD] });
  await loadCanvasBoards(api);
  expect(api.get).toHaveBeenCalledWith('/me');
  expect(canvasBoards().map((b) => b.id)).toEqual(['b1']);
  expect(canvasBoardsLoaded()).toBe(true);
});

test('NEVER writes — not on load, not on a second load', async () => {
  const api = apiWith({ canvasBoards: [BOARD] });
  await loadCanvasBoards(api);
  await loadCanvasBoards(api, { force: true });
  // The whole promise of the read-only version, in one assertion.
  expect(api.patch).not.toHaveBeenCalled();
  expect(api.put).not.toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalled();
  expect(api.delete).not.toHaveBeenCalled();
});

test('asks once, however many screens want the list', async () => {
  const api = apiWith({ canvasBoards: [BOARD] });
  await Promise.all([loadCanvasBoards(api), loadCanvasBoards(api), loadCanvasBoards(api)]);
  expect(api.get).toHaveBeenCalledTimes(1);
  // And a later caller gets what is already in hand, with no second request.
  await loadCanvasBoards(api);
  expect(api.get).toHaveBeenCalledTimes(1);
});

test('a refresh really does re-read', async () => {
  const api = apiWith({ canvasBoards: [BOARD] });
  await loadCanvasBoards(api);
  api.get.mockResolvedValueOnce({ user: { settings: { canvasBoards: [BOARD, { ...BOARD, id: 'b2' }] } } });
  await loadCanvasBoards(api, { force: true });
  expect(canvasBoards().map((b) => b.id)).toEqual(['b1', 'b2']);
});

test('a settings blob with no canvases is simply no canvases', async () => {
  await loadCanvasBoards(apiWith({ avatarAnimal: 'fox' }));
  expect(canvasBoards()).toEqual([]);
  expect(canvasBoardsLoaded()).toBe(true);
});

test('a failed read keeps what was already in hand, and stays "unloaded"', async () => {
  const api = apiWith({ canvasBoards: [BOARD] });
  await loadCanvasBoards(api);
  expect(canvasBoards()).toHaveLength(1);

  __resetCanvasBoards();
  const broken = { get: jest.fn().mockRejectedValue(new Error('offline')) };
  await loadCanvasBoards(broken);
  expect(canvasBoards()).toEqual([]);
  // Not "you have no canvases" — we never found out. The screen tells those
  // two empties apart with this.
  expect(canvasBoardsLoaded()).toBe(false);
});

test('tells its subscribers, so every screen showing the list agrees', async () => {
  const heard = [];
  const off = subscribeCanvasBoards(() => heard.push(canvasBoards().length));
  await loadCanvasBoards(apiWith({ canvasBoards: [BOARD] }));
  off();
  await loadCanvasBoards(apiWith({ canvasBoards: [] }), { force: true });
  expect(heard).toEqual([1]);
});
