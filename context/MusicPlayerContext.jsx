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
import { AppState } from 'react-native';
import { useAuth } from './AuthContext';
import { useMediaVersion } from './DownloadsContext';
import { useServer } from './ServerContext';
import { buildMusicQueue } from '../services/musicTrackMapper';
import { musicPlayerService } from '../services/musicPlayerService';

const MusicPlayerContext = createContext(null);

export function MusicPlayerProvider({ children }) {
  const { isAuthenticated, authIdentity, authGeneration } = useAuth();
  const { mediaVersion } = useMediaVersion();
  const { api, getBaseUrl, getMediaBaseUrl } = useServer();
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [setupError, setSetupError] = useState(null);
  const [libraryError, setLibraryError] = useState(null);
  const [commandError, setCommandError] = useState(null);
  const sessionGeneration = useRef(0);
  const libraryRequestGeneration = useRef(0);
  const activeSessionRef = useRef({ authenticated: false, generation: 0, key: null });
  const previousSessionRef = useRef({ authenticated: false, key: null });
  const lifecycleChainRef = useRef(Promise.resolve());
  const setupFlightRef = useRef(null);
  const setupErrorRef = useRef(null);
  const readyRef = useRef(false);
  const apiRef = useRef(api);
  const refreshFlightRef = useRef(null);
  const mediaRefreshPendingRef = useRef(false);
  const mediaRefreshTimerRef = useRef(null);
  const lastMediaVersionRef = useRef(mediaVersion);
  const activeTrack = useActiveMediaItem();
  const isPlaying = useIsPlaying();
  const { position, duration } = useProgress(0.5);
  const mediaBase = useMemo(
    () => (getMediaBaseUrl ? getMediaBaseUrl() : getBaseUrl()).replace(/\/api$/, ''),
    [getBaseUrl, getMediaBaseUrl]
  );

  useEffect(() => {
    apiRef.current = api;
  }, [api]);
  useEffect(() => {
    readyRef.current = ready;
  }, [ready]);
  useEffect(() => {
    setupErrorRef.current = setupError;
  }, [setupError]);

  const refreshLibrary = useCallback(async () => {
    const session = activeSessionRef.current;
    if (!session.authenticated) return;
    if (refreshFlightRef.current?.generation === session.generation) {
      return refreshFlightRef.current.promise;
    }
    const requestGeneration = ++libraryRequestGeneration.current;
    const currentSession = session.generation;
    const isCurrentRequest = () =>
      currentSession === activeSessionRef.current.generation &&
      activeSessionRef.current.authenticated &&
      requestGeneration === libraryRequestGeneration.current;
    const promise = (async () => {
      setLoading(true);
      try {
        const response = await apiRef.current.get(
          '/media/gallery?kind=audio&limit=300&order=desc&sortBy=upload'
        );
        if (!isCurrentRequest()) return;
        setTracks(Array.isArray(response?.items) ? response.items : []);
        setLibraryError(null);
      } catch (refreshError) {
        if (!isCurrentRequest()) return;
        setLibraryError(refreshError?.message || 'Unable to load music');
      } finally {
        if (isCurrentRequest()) setLoading(false);
        if (refreshFlightRef.current?.promise === promise) refreshFlightRef.current = null;
        if (mediaRefreshPendingRef.current && isCurrentRequest()) {
          mediaRefreshPendingRef.current = false;
          Promise.resolve().then(() => refreshLibrary());
        }
      }
    })();
    refreshFlightRef.current = { generation: currentSession, promise };
    return promise;
  }, []);

  const retrySetup = useCallback(async () => {
    const session = activeSessionRef.current;
    if (!session.authenticated) return false;
    if (setupFlightRef.current?.generation === session.generation) {
      return setupFlightRef.current.promise;
    }
    const isCurrent = () =>
      activeSessionRef.current.authenticated &&
      activeSessionRef.current.generation === session.generation;
    const promise = (async () => {
      await lifecycleChainRef.current.catch(() => {});
      if (!isCurrent()) return false;
      try {
        await musicPlayerService.ensureReady();
        if (!isCurrent()) return false;
        readyRef.current = true;
        setReady(true);
        setSetupError(null);
        return true;
      } catch (error) {
        if (isCurrent()) {
          readyRef.current = false;
          setReady(false);
          setSetupError(error?.message || 'Music player is unavailable');
        }
        return false;
      } finally {
        if (setupFlightRef.current?.promise === promise) setupFlightRef.current = null;
      }
    })();
    setupFlightRef.current = { generation: session.generation, promise };
    return promise;
  }, []);

  useEffect(() => {
    const key = isAuthenticated
      ? `${authIdentity || 'unknown'}:${authGeneration || 'unknown'}`
      : null;
    const previous = previousSessionRef.current;
    const generation = ++sessionGeneration.current;
    activeSessionRef.current = { authenticated: isAuthenticated, generation, key };
    libraryRequestGeneration.current += 1;
    refreshFlightRef.current = null;
    mediaRefreshPendingRef.current = false;
    if (mediaRefreshTimerRef.current) {
      clearTimeout(mediaRefreshTimerRef.current);
      mediaRefreshTimerRef.current = null;
    }
    readyRef.current = false;
    setReady(false);

    if (!isAuthenticated) {
      setTracks([]);
      setSetupError(null);
      setLibraryError(null);
      setCommandError(null);
      setLoading(false);
      if (previous.authenticated) {
        lifecycleChainRef.current = lifecycleChainRef.current
          .catch(() => {})
          .then(() => musicPlayerService.clear())
          .catch(() => {});
      }
      previousSessionRef.current = { authenticated: false, key: null };
      return;
    }

    setSetupError(null);
    setLibraryError(null);
    setCommandError(null);
    if (previous.authenticated && previous.key !== key) {
      lifecycleChainRef.current = lifecycleChainRef.current
        .catch(() => {})
        .then(() => musicPlayerService.clear())
        .catch(() => {});
    }
    previousSessionRef.current = { authenticated: true, key };
    retrySetup();
    refreshLibrary();
  }, [authGeneration, authIdentity, isAuthenticated, refreshLibrary, retrySetup]);

  useEffect(() => {
    if (lastMediaVersionRef.current === mediaVersion) return;
    lastMediaVersionRef.current = mediaVersion;
    if (!isAuthenticated) return;
    if (mediaRefreshTimerRef.current) clearTimeout(mediaRefreshTimerRef.current);
    mediaRefreshTimerRef.current = setTimeout(() => {
      mediaRefreshTimerRef.current = null;
      if (refreshFlightRef.current) {
        mediaRefreshPendingRef.current = true;
      } else {
        refreshLibrary();
      }
    }, 200);
    return () => {
      if (mediaRefreshTimerRef.current) {
        clearTimeout(mediaRefreshTimerRef.current);
        mediaRefreshTimerRef.current = null;
      }
    };
  }, [isAuthenticated, mediaVersion, refreshLibrary]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (
        state === 'active' &&
        activeSessionRef.current.authenticated &&
        setupErrorRef.current
      ) {
        retrySetup();
      }
    });
    return () => subscription?.remove();
  }, [retrySetup]);

  const runCommand = useCallback(async (operation) => {
    const session = activeSessionRef.current;
    if (!session.authenticated) return;
    const canRun = readyRef.current || (await retrySetup());
    if (
      !canRun ||
      !activeSessionRef.current.authenticated ||
      activeSessionRef.current.generation !== session.generation
    ) {
      return;
    }
    try {
      await operation();
      setCommandError(null);
    } catch (error) {
      if (activeSessionRef.current.generation === session.generation) {
        setCommandError(error?.message || 'Music command failed');
      }
    }
  }, [retrySetup]);

  const playMedia = useCallback(
    async (mediaId) => {
      return runCommand(async () => {
        const { items, startIndex } = buildMusicQueue(tracks, mediaId, mediaBase);
        await musicPlayerService.playQueue(items, startIndex);
      });
    },
    [mediaBase, runCommand, tracks]
  );

  const togglePlayback = useCallback(
    () => runCommand(() => musicPlayerService.togglePlayback(isPlaying)),
    [isPlaying, runCommand]
  );

  // Unconditional pause, for callers that need the music to stop regardless of
  // its current state — e.g. unmuting a video in the photo viewer, which takes
  // the audio session. togglePlayback can't serve that: it would START playback
  // if the player happened to be paused already.
  const pause = useCallback(
    () => runCommand(() => musicPlayerService.pause()),
    [runCommand]
  );

  const previous = useCallback(
    () => runCommand(() => musicPlayerService.previous()),
    [runCommand]
  );

  const next = useCallback(
    () => runCommand(() => musicPlayerService.next()),
    [runCommand]
  );

  const seekTo = useCallback(
    (seconds) => runCommand(() => musicPlayerService.seekTo(seconds)),
    [runCommand]
  );

  const error = setupError || libraryError || commandError;

  const value = useMemo(
    () => ({
      tracks,
      loading,
      ready,
      error,
      setupError,
      libraryError,
      activeTrack,
      isPlaying,
      position,
      duration,
      refreshLibrary,
      retrySetup,
      playMedia,
      togglePlayback,
      pause,
      previous,
      next,
      seekTo,
    }),
    [
      tracks,
      loading,
      ready,
      error,
      setupError,
      libraryError,
      activeTrack,
      isPlaying,
      position,
      duration,
      refreshLibrary,
      retrySetup,
      playMedia,
      togglePlayback,
      pause,
      previous,
      next,
      seekTo,
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
