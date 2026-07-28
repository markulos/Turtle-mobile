# Background Music and Lock-Screen Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Music Vault's screen-owned video player with a native app-level music queue that survives locking, backgrounding, and navigation while exposing previous, play/pause, next, and timeline seeking through system media controls.

**Architecture:** `@rntp/player` owns the native queue and media session. A small adapter-neutral controller handles setup and commands, `MusicPlayerProvider` owns Turtle's library/error state above navigation, and `MusicVault` becomes a UI consumer instead of owning playback. Pure mapping and controller logic are independently tested, while provider and UI behavior use Jest with the Expo preset.

**Tech Stack:** Expo SDK 54, React Native 0.81, React 19, `@rntp/player` v5.4+, Jest, `jest-expo`, React Native Testing Library, EAS development builds.

## Global Constraints

- Playback continues through phone lock, app backgrounding, Turtle tab changes, and leaving/reopening Music Vault.
- Lock-screen and notification controls are previous, play/pause, next, and seek.
- Track completion advances natively; the final track stops without wrapping.
- Android uses `taskRemovedBehavior: 'stop'`; playback after an intentional force-close is not guaranteed.
- Logout always pauses playback, clears the native queue, and removes the media notification.
- No global in-app mini-player, shuffle, repeat, queue editing, offline cache, CarPlay, or Android Auto browsing is added.
- Preserve all unrelated existing worktree changes.
- `@rntp/player` must resolve to version 5.4.0 or newer and remain below the next major version.
- Track Player v5 licensing must remain personal/educational unless a commercial license is obtained.

---

## File Structure

### Create

- `services/musicTrackMapper.js` — converts Turtle media rows into Track Player media items.
- `services/musicPlayerController.js` — adapter-neutral, testable setup and command orchestration.
- `services/musicPlayerService.js` — binds the controller to `@rntp/player` and native command configuration.
- `services/__tests__/musicTrackMapper.test.js` — queue/metadata mapping tests.
- `services/__tests__/musicPlayerController.test.js` — setup and command tests.
- `context/MusicPlayerContext.jsx` — app-level library and playback context.
- `context/__tests__/MusicPlayerContext.test.jsx` — provider persistence, loading, and logout tests.
- `screens/TurtleScreen/components/__tests__/MusicVault.test.jsx` — Music Vault integration tests.

### Modify

- `package.json` — Track Player and Jest dependencies, test scripts, Jest preset.
- `package-lock.json` — resolved dependency graph.
- `App.js` — mount `MusicPlayerProvider` inside `AuthProvider` and above navigation.
- `screens/TurtleScreen/components/MusicVault.jsx` — consume the shared native player.
- `app.json` — retain iOS background audio capability and document the native player requirement only if generated config needs an explicit adjustment.

---

### Task 1: Test Harness and Music Queue Mapping

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `services/musicTrackMapper.js`
- Create: `services/__tests__/musicTrackMapper.test.js`

**Interfaces:**
- Produces: `titleOf(row)`, `sourceOf(row)`, `resolveMediaUrl(value, mediaBase)`, `mapMediaRowToTrack(row, mediaBase)`, and `buildMusicQueue(rows, selectedId, mediaBase)`.
- `buildMusicQueue` returns `{ items: MediaItem[], startIndex: number }` and throws `Selected track is not playable` when the selected row cannot enter the queue.

- [ ] **Step 1: Install the native player and Expo-compatible test harness**

Run:

```powershell
npm install "@rntp/player@^5.4.0"
npx expo install jest-expo jest @types/jest "--" --dev
npx expo install @testing-library/react-native "--" --dev
```

Expected:

- `package.json` contains `@rntp/player` at `^5.4.0` or a newer compatible v5 range.
- The lockfile resolves one v5 Track Player version.
- Jest packages are in `devDependencies`.
- If the package registry requires separate Track Player access or licensing credentials, stop without substituting another library and report that exact blocker.

- [ ] **Step 2: Configure deterministic Jest commands**

Add to `package.json`:

```json
{
  "scripts": {
    "test": "jest --runInBand",
    "test:music": "jest --runInBand services/__tests__ context/__tests__ screens/TurtleScreen/components/__tests__/MusicVault.test.jsx"
  },
  "jest": {
    "preset": "jest-expo",
    "transformIgnorePatterns": [
      "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@rntp/.*|@react-navigation/.*|react-native-vector-icons)"
    ]
  }
}
```

Preserve all existing scripts.

- [ ] **Step 3: Write failing media mapping tests**

Create `services/__tests__/musicTrackMapper.test.js`:

```javascript
import {
  buildMusicQueue,
  mapMediaRowToTrack,
  resolveMediaUrl,
  sourceOf,
  titleOf,
} from '../musicTrackMapper';

describe('musicTrackMapper', () => {
  test('normalizes title, source, URLs, duration, artwork, and stable metadata', () => {
    const row = {
      id: 'media-7',
      originalName: 'Night Drive.mp3',
      rawUrl: '/api/media/raw/media-7',
      thumbUrl: '/api/media/thumb/media-7',
      sourceUrl: 'https://soundcloud.com/turtle/night-drive',
      duration: 183.4,
    };

    expect(titleOf(row)).toBe('Night Drive');
    expect(sourceOf(row)).toBe('soundcloud.com');
    expect(resolveMediaUrl(row.rawUrl, 'https://pond.example')).toBe(
      'https://pond.example/api/media/raw/media-7'
    );
    expect(mapMediaRowToTrack(row, 'https://pond.example')).toEqual({
      mediaId: 'media-7',
      url: 'https://pond.example/api/media/raw/media-7',
      title: 'Night Drive',
      artist: 'soundcloud.com',
      artworkUrl: 'https://pond.example/api/media/thumb/media-7',
      duration: 183.4,
      extras: { turtleMediaId: 'media-7' },
    });
  });

  test('filters unplayable rows and preserves the selected item index', () => {
    const rows = [
      { id: 'bad', originalName: 'Missing URL.mp3' },
      { id: 'one', filename: 'one.mp3', url: '/media/one.mp3' },
      { id: 'two', filename: 'two.mp3', rawUrl: '/media/two.mp3' },
    ];

    expect(buildMusicQueue(rows, 'two', 'https://pond.example')).toEqual({
      items: [
        expect.objectContaining({ mediaId: 'one', title: 'one' }),
        expect.objectContaining({ mediaId: 'two', title: 'two' }),
      ],
      startIndex: 1,
    });
  });

  test('rejects a selected row that is not playable without producing a queue', () => {
    expect(() =>
      buildMusicQueue(
        [{ id: 'bad', originalName: 'Missing URL.mp3' }],
        'bad',
        'https://pond.example'
      )
    ).toThrow('Selected track is not playable');
  });

  test('uses stable fallbacks and omits invalid optional metadata', () => {
    expect(
      mapMediaRowToTrack(
        { id: 12, filename: 'voice.aac', rawUrl: 'https://cdn.example/voice.aac', duration: -1 },
        'https://pond.example'
      )
    ).toEqual({
      mediaId: '12',
      url: 'https://cdn.example/voice.aac',
      title: 'voice',
      artist: 'Turtle Music',
      extras: { turtleMediaId: '12' },
    });
  });
});
```

- [ ] **Step 4: Run the mapper tests and verify RED**

Run:

```powershell
npm run test:music -- --runTestsByPath services/__tests__/musicTrackMapper.test.js
```

Expected: FAIL because `services/musicTrackMapper.js` does not exist.

- [ ] **Step 5: Implement the minimal media mapper**

Create `services/musicTrackMapper.js`:

```javascript
const AUDIO_EXTENSION = /\.[a-z0-9]{2,5}$/i;

export function titleOf(row) {
  const raw = row?.originalName || row?.filename || 'Unknown track';
  return String(raw).replace(AUDIO_EXTENSION, '').trim() || 'Unknown track';
}

export function sourceOf(row) {
  const value = row?.sourceUrl || row?.originalPath || '';
  try {
    return value ? new URL(value).hostname.replace(/^www\./, '') : '';
  } catch {
    return '';
  }
}

export function resolveMediaUrl(value, mediaBase) {
  if (!value) return null;
  const raw = String(value);
  if (/^https?:\/\//i.test(raw) || /^file:\/\//i.test(raw)) return raw;
  if (!mediaBase) return null;
  return `${String(mediaBase).replace(/\/$/, '')}/${raw.replace(/^\//, '')}`;
}

export function mapMediaRowToTrack(row, mediaBase) {
  if (row?.id == null) return null;
  const url = resolveMediaUrl(row.rawUrl || row.url, mediaBase);
  if (!url) return null;

  const item = {
    mediaId: String(row.id),
    url,
    title: titleOf(row),
    artist: sourceOf(row) || 'Turtle Music',
    extras: { turtleMediaId: String(row.id) },
  };
  const artworkUrl = resolveMediaUrl(
    row.artworkUrl || row.thumbUrl || row.thumbnailUrl,
    mediaBase
  );
  if (artworkUrl) item.artworkUrl = artworkUrl;
  if (Number.isFinite(Number(row.duration)) && Number(row.duration) > 0) {
    item.duration = Number(row.duration);
  }
  return item;
}

export function buildMusicQueue(rows, selectedId, mediaBase) {
  const selectedKey = String(selectedId);
  const items = (Array.isArray(rows) ? rows : [])
    .map((row) => mapMediaRowToTrack(row, mediaBase))
    .filter(Boolean);
  const startIndex = items.findIndex((item) => item.mediaId === selectedKey);
  if (startIndex < 0) throw new Error('Selected track is not playable');
  return { items, startIndex };
}
```

- [ ] **Step 6: Run the mapper tests and verify GREEN**

Run:

```powershell
npm run test:music -- --runTestsByPath services/__tests__/musicTrackMapper.test.js
```

Expected: 4 tests pass.

- [ ] **Step 7: Commit the mapping slice**

```powershell
git add package.json package-lock.json services/musicTrackMapper.js services/__tests__/musicTrackMapper.test.js
git commit -m "feat(mobile): map media rows into music queues"
```

---

### Task 2: Native Player Controller and Track Player Adapter

**Files:**
- Create: `services/musicPlayerController.js`
- Create: `services/musicPlayerService.js`
- Create: `services/__tests__/musicPlayerController.test.js`

**Interfaces:**
- Consumes: Track Player v5.4+.
- Produces: `createMusicPlayerController(adapter)` with methods `ensureReady()`, `playQueue(items, startIndex)`, `togglePlayback(isPlaying)`, `previous()`, `next()`, `seekTo(seconds)`, and `clear()`.
- Produces: singleton `musicPlayerService` using the real native adapter.

- [ ] **Step 1: Write failing controller tests**

Create `services/__tests__/musicPlayerController.test.js`:

```javascript
import { createMusicPlayerController } from '../musicPlayerController';

function makeAdapter(overrides = {}) {
  return {
    setup: jest.fn().mockResolvedValue(undefined),
    setQueue: jest.fn().mockResolvedValue(undefined),
    play: jest.fn().mockResolvedValue(undefined),
    pause: jest.fn().mockResolvedValue(undefined),
    previous: jest.fn().mockResolvedValue(undefined),
    next: jest.fn().mockResolvedValue(undefined),
    seekTo: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('musicPlayerController', () => {
  test('deduplicates concurrent native setup', async () => {
    const adapter = makeAdapter();
    const controller = createMusicPlayerController(adapter);

    await Promise.all([controller.ensureReady(), controller.ensureReady()]);

    expect(adapter.setup).toHaveBeenCalledTimes(1);
    expect(controller.isReady()).toBe(true);
  });

  test('allows setup to retry after a setup failure', async () => {
    const adapter = makeAdapter({
      setup: jest
        .fn()
        .mockRejectedValueOnce(new Error('native unavailable'))
        .mockResolvedValueOnce(undefined),
    });
    const controller = createMusicPlayerController(adapter);

    await expect(controller.ensureReady()).rejects.toThrow('native unavailable');
    await expect(controller.ensureReady()).resolves.toBeUndefined();
    expect(adapter.setup).toHaveBeenCalledTimes(2);
  });

  test('sets a validated queue at the selected index before playing', async () => {
    const adapter = makeAdapter();
    const controller = createMusicPlayerController(adapter);
    const items = [{ mediaId: 'a', url: 'https://example/a.mp3' }];

    await controller.playQueue(items, 0);

    expect(adapter.setQueue).toHaveBeenCalledWith(items, 0);
    expect(adapter.play).toHaveBeenCalledTimes(1);
    expect(adapter.setQueue.mock.invocationCallOrder[0]).toBeLessThan(
      adapter.play.mock.invocationCallOrder[0]
    );
  });

  test('rejects an invalid queue before touching the active native queue', async () => {
    const adapter = makeAdapter();
    const controller = createMusicPlayerController(adapter);

    await expect(controller.playQueue([], 0)).rejects.toThrow('Music queue is empty');
    expect(adapter.setQueue).not.toHaveBeenCalled();
  });

  test('routes transport, seek, and clear commands through the adapter', async () => {
    const adapter = makeAdapter();
    const controller = createMusicPlayerController(adapter);
    await controller.ensureReady();

    await controller.togglePlayback(true);
    await controller.togglePlayback(false);
    await controller.previous();
    await controller.next();
    await controller.seekTo(12.5);
    await controller.clear();

    expect(adapter.pause).toHaveBeenCalledTimes(2);
    expect(adapter.play).toHaveBeenCalledTimes(1);
    expect(adapter.previous).toHaveBeenCalledTimes(1);
    expect(adapter.next).toHaveBeenCalledTimes(1);
    expect(adapter.seekTo).toHaveBeenCalledWith(12.5);
    expect(adapter.clear).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the controller tests and verify RED**

Run:

```powershell
npm run test:music -- --runTestsByPath services/__tests__/musicPlayerController.test.js
```

Expected: FAIL because `services/musicPlayerController.js` does not exist.

- [ ] **Step 3: Implement the adapter-neutral controller**

Create `services/musicPlayerController.js`:

```javascript
export function createMusicPlayerController(adapter) {
  let ready = false;
  let setupPromise = null;

  const ensureReady = async () => {
    if (ready) return;
    if (!setupPromise) {
      setupPromise = Promise.resolve(adapter.setup())
        .then(() => {
          ready = true;
        })
        .catch((error) => {
          setupPromise = null;
          throw error;
        });
    }
    return setupPromise;
  };

  const runReady = async (operation) => {
    await ensureReady();
    return operation();
  };

  return {
    ensureReady,
    isReady: () => ready,
    async playQueue(items, startIndex) {
      if (!Array.isArray(items) || items.length === 0) {
        throw new Error('Music queue is empty');
      }
      if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= items.length) {
        throw new Error('Music queue start index is invalid');
      }
      await ensureReady();
      await adapter.setQueue(items, startIndex);
      await adapter.play();
    },
    togglePlayback: (isPlaying) =>
      runReady(() => (isPlaying ? adapter.pause() : adapter.play())),
    previous: () => runReady(() => adapter.previous()),
    next: () => runReady(() => adapter.next()),
    seekTo: (seconds) =>
      runReady(() => adapter.seekTo(Math.max(0, Number(seconds) || 0))),
    clear: () =>
      runReady(async () => {
        await adapter.pause();
        await adapter.clear();
      }),
  };
}
```

- [ ] **Step 4: Run controller tests and verify GREEN**

Run:

```powershell
npm run test:music -- --runTestsByPath services/__tests__/musicPlayerController.test.js
```

Expected: 5 tests pass.

- [ ] **Step 5: Bind the controller to Track Player**

Create `services/musicPlayerService.js`:

```javascript
import TrackPlayer, { PlayerCommand } from '@rntp/player';
import { createMusicPlayerController } from './musicPlayerController';

const nativeAdapter = {
  async setup() {
    await Promise.resolve(
      TrackPlayer.setupPlayer({
        contentType: 'music',
        handleAudioBecomingNoisy: true,
        autoUpdateMetadataFromStream: true,
        android: {
          wakeMode: 'network',
          taskRemovedBehavior: 'stop',
        },
      })
    );
    await Promise.resolve(
      TrackPlayer.setCommands({
        capabilities: [
          PlayerCommand.Previous,
          PlayerCommand.PlayPause,
          PlayerCommand.Next,
          PlayerCommand.Seek,
        ],
        handling: 'native',
      })
    );
  },
  setQueue: (items, startIndex) =>
    Promise.resolve(TrackPlayer.setMediaItems(items, startIndex)),
  play: () => Promise.resolve(TrackPlayer.play()),
  pause: () => Promise.resolve(TrackPlayer.pause()),
  previous: () => Promise.resolve(TrackPlayer.skipToPrevious()),
  next: () => Promise.resolve(TrackPlayer.skipToNext()),
  seekTo: (seconds) => Promise.resolve(TrackPlayer.seekTo(seconds)),
  clear: () => Promise.resolve(TrackPlayer.clear()),
};

export const musicPlayerService = createMusicPlayerController(nativeAdapter);
```

- [ ] **Step 6: Add a real-adapter shape test without invoking native code**

Append to `services/__tests__/musicPlayerController.test.js`:

```javascript
test('exposes the complete controller contract', () => {
  const controller = createMusicPlayerController(makeAdapter());
  expect(Object.keys(controller).sort()).toEqual(
    [
      'clear',
      'ensureReady',
      'isReady',
      'next',
      'playQueue',
      'previous',
      'seekTo',
      'togglePlayback',
    ].sort()
  );
});
```

- [ ] **Step 7: Run service tests and static checks**

Run:

```powershell
npm run test:music -- --runTestsByPath services/__tests__/musicPlayerController.test.js
npx tsc --noEmit --pretty false
```

Expected: controller tests pass and TypeScript exits 0.

- [ ] **Step 8: Commit the native service slice**

```powershell
git add services/musicPlayerController.js services/musicPlayerService.js services/__tests__/musicPlayerController.test.js
git commit -m "feat(mobile): add native music player service"
```

---

### Task 3: App-Level Music Player Provider

**Files:**
- Create: `context/MusicPlayerContext.jsx`
- Create: `context/__tests__/MusicPlayerContext.test.jsx`
- Modify: `App.js`

**Interfaces:**
- Consumes: `musicPlayerService`, `buildMusicQueue`, `useServer()`, `useAuth()`, and Track Player hooks.
- Produces: `useMusicPlayer()` returning `{ tracks, loading, ready, error, activeTrack, isPlaying, position, duration, refreshLibrary, playMedia, togglePlayback, previous, next, seekTo }`.

- [ ] **Step 1: Write failing provider persistence and logout tests**

Create `context/__tests__/MusicPlayerContext.test.jsx`:

```javascript
import React from 'react';
import { Button, Text, View } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { MusicPlayerProvider, useMusicPlayer } from '../MusicPlayerContext';
import { musicPlayerService } from '../../services/musicPlayerService';

const apiGet = jest.fn();
let authenticated = true;
let activeTrack = null;
let playing = false;

jest.mock('../ServerContext', () => ({
  useServer: () => ({
    api: { get: apiGet },
    getBaseUrl: () => 'https://pond.example/api',
    getMediaBaseUrl: () => 'https://pond.example',
  }),
}));
jest.mock('../AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: authenticated }),
}));
jest.mock('@rntp/player', () => ({
  useActiveMediaItem: () => activeTrack,
  useIsPlaying: () => playing,
  useProgress: () => ({ position: 12, duration: 180 }),
}));
jest.mock('../../services/musicPlayerService', () => ({
  musicPlayerService: {
    ensureReady: jest.fn().mockResolvedValue(undefined),
    playQueue: jest.fn().mockResolvedValue(undefined),
    togglePlayback: jest.fn().mockResolvedValue(undefined),
    previous: jest.fn().mockResolvedValue(undefined),
    next: jest.fn().mockResolvedValue(undefined),
    seekTo: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
  },
}));

function Probe({ visible = true }) {
  const music = useMusicPlayer();
  if (!visible) return null;
  return (
    <View>
      <Text testID="count">{music.tracks.length}</Text>
      <Text testID="position">{music.position}</Text>
      <Button title="play-two" onPress={() => music.playMedia('two')} />
      <Button title="refresh" onPress={() => music.refreshLibrary()} />
    </View>
  );
}

describe('MusicPlayerProvider', () => {
  beforeEach(() => {
    authenticated = true;
    activeTrack = null;
    playing = false;
    jest.clearAllMocks();
    apiGet.mockResolvedValue({
      items: [
        { id: 'one', filename: 'one.mp3', rawUrl: '/media/one.mp3' },
        { id: 'two', filename: 'two.mp3', rawUrl: '/media/two.mp3' },
      ],
    });
  });

  test('keeps library state when the Music Vault consumer unmounts and remounts', async () => {
    const view = render(
      <MusicPlayerProvider>
        <Probe />
      </MusicPlayerProvider>
    );
    await waitFor(() => expect(view.getByTestId('count').props.children).toBe(2));

    view.rerender(
      <MusicPlayerProvider>
        <Probe visible={false} />
      </MusicPlayerProvider>
    );
    view.rerender(
      <MusicPlayerProvider>
        <Probe />
      </MusicPlayerProvider>
    );

    expect(view.getByTestId('count').props.children).toBe(2);
    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  test('builds and starts the shared queue at the selected media item', async () => {
    const view = render(
      <MusicPlayerProvider>
        <Probe />
      </MusicPlayerProvider>
    );
    await waitFor(() => expect(view.getByTestId('count').props.children).toBe(2));

    fireEvent.press(view.getByText('play-two'));

    await waitFor(() =>
      expect(musicPlayerService.playQueue).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ mediaId: 'one' }),
          expect.objectContaining({ mediaId: 'two' }),
        ]),
        1
      )
    );
  });

  test('clears native playback when authentication is lost', async () => {
    const view = render(
      <MusicPlayerProvider>
        <Probe />
      </MusicPlayerProvider>
    );
    await waitFor(() => expect(musicPlayerService.ensureReady).toHaveBeenCalled());

    authenticated = false;
    await act(async () => {
      view.rerender(
        <MusicPlayerProvider>
          <Probe />
        </MusicPlayerProvider>
      );
    });

    expect(musicPlayerService.clear).toHaveBeenCalledTimes(1);
  });

  test('keeps the last library when refresh fails', async () => {
    const view = render(
      <MusicPlayerProvider>
        <Probe />
      </MusicPlayerProvider>
    );
    await waitFor(() => expect(view.getByTestId('count').props.children).toBe(2));
    apiGet.mockRejectedValueOnce(new Error('offline'));

    fireEvent.press(view.getByText('refresh'));
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
    expect(view.getByTestId('count').props.children).toBe(2);
  });
});
```

- [ ] **Step 2: Run provider tests and verify RED**

Run:

```powershell
npm run test:music -- --runTestsByPath context/__tests__/MusicPlayerContext.test.jsx
```

Expected: FAIL because `context/MusicPlayerContext.jsx` does not exist.

- [ ] **Step 3: Implement the provider**

Create `context/MusicPlayerContext.jsx` with:

```javascript
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  useActiveMediaItem,
  useIsPlaying,
  useProgress,
} from '@rntp/player';
import { useAuth } from './AuthContext';
import { useServer } from './ServerContext';
import { buildMusicQueue } from '../services/musicTrackMapper';
import { musicPlayerService } from '../services/musicPlayerService';

const MusicPlayerContext = createContext(null);

export function MusicPlayerProvider({ children }) {
  const { isAuthenticated } = useAuth();
  const { api, getBaseUrl, getMediaBaseUrl } = useServer();
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const wasAuthenticated = useRef(false);
  const activeTrack = useActiveMediaItem();
  const isPlaying = useIsPlaying();
  const { position, duration } = useProgress(0.5);
  const mediaBase = useMemo(
    () => (getMediaBaseUrl ? getMediaBaseUrl() : getBaseUrl()).replace(/\/api$/, ''),
    [getBaseUrl, getMediaBaseUrl]
  );

  const refreshLibrary = useCallback(async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    try {
      const response = await api.get(
        '/media/gallery?kind=audio&limit=300&order=desc&sortBy=upload'
      );
      setTracks(Array.isArray(response?.items) ? response.items : []);
      setError(null);
    } catch (refreshError) {
      setError(refreshError?.message || 'Unable to load music');
    } finally {
      setLoading(false);
    }
  }, [api, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      if (wasAuthenticated.current) {
        setReady(false);
        setTracks([]);
        musicPlayerService.clear().catch(() => {});
      }
      wasAuthenticated.current = false;
      return;
    }
    wasAuthenticated.current = true;
    musicPlayerService
      .ensureReady()
      .then(() => setReady(true))
      .catch((setupError) =>
        setError(setupError?.message || 'Music player is unavailable')
      );
    refreshLibrary();
  }, [isAuthenticated, refreshLibrary]);

  const playMedia = useCallback(
    async (mediaId) => {
      try {
        const { items, startIndex } = buildMusicQueue(tracks, mediaId, mediaBase);
        await musicPlayerService.playQueue(items, startIndex);
        setError(null);
      } catch (playError) {
        setError(playError?.message || 'Unable to play this track');
      }
    },
    [mediaBase, tracks]
  );

  const value = useMemo(
    () => ({
      tracks,
      loading,
      ready,
      error,
      activeTrack,
      isPlaying,
      position,
      duration,
      refreshLibrary,
      playMedia,
      togglePlayback: () => musicPlayerService.togglePlayback(isPlaying),
      previous: () => musicPlayerService.previous(),
      next: () => musicPlayerService.next(),
      seekTo: (seconds) => musicPlayerService.seekTo(seconds),
    }),
    [
      tracks,
      loading,
      ready,
      error,
      activeTrack,
      isPlaying,
      position,
      duration,
      refreshLibrary,
      playMedia,
    ]
  );

  return (
    <MusicPlayerContext.Provider value={value}>
      {children}
    </MusicPlayerContext.Provider>
  );
}

export function useMusicPlayer() {
  const value = useContext(MusicPlayerContext);
  if (!value) throw new Error('useMusicPlayer must be used inside MusicPlayerProvider');
  return value;
}
```

- [ ] **Step 4: Run provider tests and verify GREEN**

Run:

```powershell
npm run test:music -- --runTestsByPath context/__tests__/MusicPlayerContext.test.jsx
```

Expected: 4 tests pass with no act warnings.

- [ ] **Step 5: Mount the provider at app level**

Modify `App.js`:

```javascript
import { MusicPlayerProvider } from './context/MusicPlayerContext';
```

Inside `AuthProvider`, insert the `MusicPlayerProvider` opening tag immediately
before the existing `VaultProvider` opening tag and its closing tag immediately
after the existing `VaultProvider` closing tag:

```jsx
<AuthProvider>
  <MusicPlayerProvider>
    <VaultProvider>
    </VaultProvider>
  </MusicPlayerProvider>
</AuthProvider>
```

Do not move, reformat, or stage unrelated provider code.

- [ ] **Step 6: Run provider tests and source validation**

Run:

```powershell
npm run test:music -- --runTestsByPath context/__tests__/MusicPlayerContext.test.jsx
npx tsc --noEmit --pretty false
npx expo config --type public
```

Expected: tests pass; TypeScript and Expo config exit 0.

- [ ] **Step 7: Commit the provider slice**

```powershell
git add App.js context/MusicPlayerContext.jsx context/__tests__/MusicPlayerContext.test.jsx
git commit -m "feat(mobile): keep music playback above navigation"
```

---

### Task 4: Migrate Music Vault to the Shared Native Queue

**Files:**
- Modify: `screens/TurtleScreen/components/MusicVault.jsx`
- Create: `screens/TurtleScreen/components/__tests__/MusicVault.test.jsx`

**Interfaces:**
- Consumes: `useMusicPlayer()` from Task 3 and `titleOf`/`sourceOf` from Task 1.
- Produces: the existing Music Vault UI backed exclusively by the shared native queue.

- [ ] **Step 1: Write failing Music Vault interaction tests**

Create `screens/TurtleScreen/components/__tests__/MusicVault.test.jsx`:

```javascript
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import MusicVault from '../MusicVault';

const playMedia = jest.fn();
const togglePlayback = jest.fn();
const previous = jest.fn();
const next = jest.fn();
const seekTo = jest.fn();

jest.mock('../../../../context/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      colors: {
        background: '#000',
        surfaceElevated: '#111',
        border: '#222',
        textPrimary: '#fff',
        textSecondary: '#ccc',
        textTertiary: '#999',
        textMuted: '#666',
        accentSuccess: '#4ADE80',
      },
    },
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('../../../../context/MusicPlayerContext', () => ({
  useMusicPlayer: () => ({
    tracks: [
      { id: 'one', filename: 'First.mp3', rawUrl: '/media/one.mp3' },
      { id: 'two', filename: 'Second.mp3', rawUrl: '/media/two.mp3' },
    ],
    loading: false,
    ready: true,
    error: null,
    activeTrack: {
      mediaId: 'two',
      title: 'Second',
      artist: 'Turtle Music',
    },
    isPlaying: true,
    position: 45,
    duration: 180,
    playMedia,
    togglePlayback,
    previous,
    next,
    seekTo,
  }),
}));

describe('MusicVault', () => {
  beforeEach(() => jest.clearAllMocks());

  test('starts the selected media row through the shared provider', () => {
    const view = render(<MusicVault onClose={jest.fn()} />);
    fireEvent.press(view.getByText('First'));
    expect(playMedia).toHaveBeenCalledWith('one');
  });

  test('renders the active native item and routes transport controls', () => {
    const view = render(<MusicVault onClose={jest.fn()} />);
    expect(view.getAllByText('Second').length).toBeGreaterThan(0);

    fireEvent.press(view.getByLabelText('Previous track'));
    fireEvent.press(view.getByLabelText('Pause'));
    fireEvent.press(view.getByLabelText('Next track'));

    expect(previous).toHaveBeenCalledTimes(1);
    expect(togglePlayback).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run Music Vault tests and verify RED**

Run:

```powershell
npm run test:music -- --runTestsByPath screens/TurtleScreen/components/__tests__/MusicVault.test.jsx
```

Expected: FAIL because the current component owns `expo-video` and does not use
the mocked context or accessibility labels.

- [ ] **Step 3: Remove screen-owned playback**

In `MusicVault.jsx`:

- remove `useVideoPlayer` and `VideoView`;
- remove `useServer`, local `tracks`, `loading`, `current`, `playing`,
  `position`, and `duration` ownership;
- remove the hidden player surface;
- remove the local media fetch and player event subscriptions;
- import `useMusicPlayer`, `titleOf`, and `sourceOf`.

Read shared state:

```javascript
const {
  tracks,
  loading,
  ready,
  error,
  activeTrack,
  isPlaying,
  position,
  duration,
  playMedia,
  togglePlayback,
  previous,
  next,
  seekTo,
} = useMusicPlayer();

const current = tracks.findIndex(
  (item) => String(item.id) === String(activeTrack?.mediaId)
);
const nowTrack = current >= 0 ? tracks[current] : null;
```

Route row selection:

```javascript
const playIndex = useCallback(
  (index) => {
    const item = tracks[index];
    if (item?.id != null) playMedia(String(item.id));
  },
  [playMedia, tracks]
);
```

Route timeline seeking:

```javascript
const seekFromFraction = useCallback(
  (fraction) => {
    if (!duration) return;
    seekTo(Math.max(0, Math.min(duration, fraction * duration)));
  },
  [duration, seekTo]
);
```

- [ ] **Step 4: Add explicit accessible native-equivalent controls**

Update buttons:

```jsx
<TouchableOpacity
  accessibilityRole="button"
  accessibilityLabel="Previous track"
  onPress={() => {
    impactHaptic('light');
    previous();
  }}
  disabled={current <= 0}
>
  <Icon name="skip-previous" size={30} color={current > 0 ? c.textPrimary : c.textMuted} />
</TouchableOpacity>

<TouchableOpacity
  accessibilityRole="button"
  accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
  onPress={() => {
    impactHaptic('medium');
    togglePlayback();
  }}
>
  <Icon name={isPlaying ? 'pause-circle' : 'play-circle'} size={44} color={c.accentSuccess || '#4ADE80'} />
</TouchableOpacity>

<TouchableOpacity
  accessibilityRole="button"
  accessibilityLabel="Next track"
  onPress={() => {
    impactHaptic('light');
    next();
  }}
  disabled={current >= tracks.length - 1}
>
  <Icon name="skip-next" size={30} color={current < tracks.length - 1 ? c.textPrimary : c.textMuted} />
</TouchableOpacity>
```

Disable track selection and transport controls until `ready` is true. Render
the provider's concise `error` above the list without replacing existing
tracks.

- [ ] **Step 5: Run Music Vault and full music tests**

Run:

```powershell
npm run test:music -- --runTestsByPath screens/TurtleScreen/components/__tests__/MusicVault.test.jsx
npm run test:music
npx tsc --noEmit --pretty false
```

Expected: all music tests pass; TypeScript exits 0.

- [ ] **Step 6: Commit the UI migration**

```powershell
git add screens/TurtleScreen/components/MusicVault.jsx screens/TurtleScreen/components/__tests__/MusicVault.test.jsx
git commit -m "feat(mobile): control native music queue from Music Vault"
```

---

### Task 5: Native Configuration, Build, and Device Acceptance

**Files:**
- Inspect: `app.json`
- Inspect: `eas.json`
- Modify: `app.json` only if generated native introspection does not contain iOS `audio` background mode.
- Modify: generated native files only when the supported autolinking/build process requires it; do not run a destructive clean prebuild over the Live Activity extension.

**Interfaces:**
- Consumes: completed Tasks 1–4.
- Produces: installable iOS and Android development builds containing Track Player's native service.

- [ ] **Step 1: Run the complete automated verification suite**

Run:

```powershell
npm run test
npx tsc --noEmit --pretty false
npx expo-doctor
npx expo config --type public
npm ls "@rntp/player"
```

Expected:

- Jest reports zero failed tests.
- TypeScript exits 0.
- Expo Doctor reports no blocking dependency/config errors.
- Expo config resolves.
- `npm ls` reports one Track Player v5.4+ installation.

- [ ] **Step 2: Verify generated native requirements without destructive prebuild**

Run:

```powershell
npx expo config --type introspect
```

Inspect the output for:

- iOS `UIBackgroundModes` containing `audio`;
- Android notification permission already present in `app.json`.

Track Player's Android service comes from the linked library manifest and is
validated by the Android build in Step 4, not by Expo config introspection.

Do not run `expo prebuild --clean`; the repository contains a Live Activity
native extension that must not be erased.

- [ ] **Step 3: Commit any required declarative native-config adjustment**

If and only if iOS `audio` is missing, add it explicitly:

```json
{
  "expo": {
    "ios": {
      "infoPlist": {
        "UIBackgroundModes": ["audio"]
      }
    }
  }
}
```

Merge this key with the existing `infoPlist`; do not replace the other entries.

Then run:

```powershell
npx expo config --type introspect
git add app.json
git commit -m "chore(mobile): configure native background audio"
```

Skip this commit when no config change is required.

- [ ] **Step 4: Build fresh development clients**

Run the existing iOS EAS build:

```powershell
npm run build:ios:dev
```

Run an Android development build:

```powershell
npx eas build --profile development --platform android
```

Expected: both builds complete successfully and return installable artifact
links. If signing credentials or EAS quota block a platform, preserve the
successful platform artifact and report the exact blocked credential/quota
step.

- [ ] **Step 5: Perform physical-device acceptance checks**

On each available platform:

1. Install the fresh development client.
2. Open Media Vault → Music and play the second item in a queue of at least
   three tracks.
3. Navigate to Tasks, Notes, Photos chooser, and Turtle; verify uninterrupted
   playback.
4. Lock the phone; verify title, source/artist, artwork when available,
   previous, play/pause, next, and seek controls.
5. Use next and previous while locked; reopen Turtle and verify Music Vault
   reflects the same active item and progress.
6. Let one track finish while locked; verify native advance to the next item.
7. Disconnect headphones or Bluetooth; verify playback pauses.
8. Background the app for at least five minutes; verify playback and controls
   remain active.
9. Log out; verify playback stops and the media notification disappears.
10. Force-close Turtle; verify no requirement to restore or auto-start playback.

- [ ] **Step 6: Final regression and worktree review**

Run:

```powershell
npm run test
npx tsc --noEmit --pretty false
git status --short
git diff --check
git log -6 --oneline
```

Expected:

- zero failed tests;
- TypeScript exits 0;
- no whitespace errors;
- unrelated pre-existing files remain unstaged and unmodified by this feature;
- feature commits are limited to the files listed in this plan.
