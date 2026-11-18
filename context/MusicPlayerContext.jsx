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
  PlaybackState,
  useActiveMediaItem,
  useIsPlaying,
  usePlaybackState,
  useProgress,
} from '@rntp/player';
import { AppState } from 'react-native';
import { useAuth } from './AuthContext';
import { useMediaVersion } from './DownloadsContext';
import { useServer } from './ServerContext';
import { buildMusicQueue } from '../services/musicTrackMapper';
import { partitionVoiceRecordings } from '../utils/voiceRecordings';
import {
  musicAutoResume, musicPlayerService, onPlaybackInterrupted,
} from '../services/musicPlayerService';
import { musicOfflineStore } from '../services/musicOfflineStore';
import { preparingPercent, preparingStalled } from '../services/preparingProgress';

const MusicPlayerContext = createContext(null);

/** How often the "finding the audio" percentage is recomputed. */
const PREPARING_TICK_MS = 150;

export function MusicPlayerProvider({ children }) {
  const { isAuthenticated, authIdentity, authGeneration } = useAuth();
  const { mediaVersion } = useMediaVersion();
  const { api, getBaseUrl, getMediaBaseUrl } = useServer();
  /**
   * THE MUSIC LIBRARY — and deliberately not every audio row in the vault.
   *
   * Voice recordings are filed out of it (utils/voiceRecordings). This is the
   * one place that exclusion happens, and it has to be here rather than in the
   * list: `playMedia` builds the play queue out of THIS array, so a recording
   * left in it would still be played by press-play-and-walk — invisible in the
   * list and audible between two songs, which is worse than not filing it.
   */
  const [tracks, setTracks] = useState([]);
  /** The recordings themselves, for the section that owns them. They play in a
   *  queue of their own through `playRows`, the same way a track someone else
   *  shared does. */
  const [recordings, setRecordings] = useState([]);
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
  const playbackState = usePlaybackState();
  const { position, duration, buffered } = useProgress(0.5);

  /**
   * Asked for, nothing audible yet.
   *
   * Worth telling the UI about because of ONE case in particular: a YouTube
   * search result. Playing one makes the pond resolve the video to a signed
   * audio URL first, and that is seconds of work the player spends with the
   * track loaded, not playing, and no bytes yet. On screen that looked exactly
   * like a track that had failed to start, so the honest response was to press
   * play again - which cancels and restarts the same wait.
   *
   * `Buffering` and not playing is the precise shape of it. A track the user
   * PAUSED sits in `Ready`, not `Buffering`, so pausing at 0:00 does not read
   * as loading; a stall in the middle of a track does land here, which is
   * fine - it is the same "waiting for audio", and the caller decides whether
   * a position of zero makes it worth different words.
   */
  const preparing = !!activeTrack && !isPlaying && playbackState === PlaybackState.Buffering;

  /**
   * …and how far along that wait is, 0-99.
   *
   * The clock is kept here rather than in the two places that draw it, so the
   * row and the transport bar can never disagree about the same wait. It only
   * ticks WHILE preparing, and it starts again from zero for each track: this
   * is the progress of one attempt to play one thing, not a running total.
   *
   * services/preparingProgress.js holds the arithmetic and the argument for
   * why the first half of it is an estimate at all.
   */
  const [preparingPct, setPreparingPct] = useState(0);
  /**
   * …and whether that wait has gone on long enough to stop calling it one.
   *
   * Kept beside the percentage and on the same tick, because they are two
   * readings of one clock: the moment this turns true is the moment the
   * percentage stops being worth showing. See preparingStalled().
   */
  const [preparingStalledNow, setPreparingStalledNow] = useState(false);
  /**
   * PLAYBACK STOPPED ON ITS OWN — and what is being done about it.
   *
   * `null` almost always. `{ code, message, exhausted }` while the resume
   * ladder is climbing (exhausted: false) and after it has given up
   * (exhausted: true). See services/musicAutoResume.js: this is the half of
   * that fix that reaches a screen, because audio that stops needs a reason
   * on it — Mark's report was "stops playing after a few minutes" precisely
   * because nothing ever said anything.
   */
  const [interrupted, setInterrupted] = useState(null);
  useEffect(() => onPlaybackInterrupted(setInterrupted), []);
  const preparingSinceRef = useRef(0);
  const preparingKey = preparing ? String(activeTrack?.mediaId ?? activeTrack?.id ?? '') : '';
  // `buffered` is an absolute position, so the amount IN HAND is the part of
  // it ahead of where we are — which is also the right quantity when this is a
  // stall in the middle of a track rather than a start.
  const bufferedAheadSec = Math.max(0, (Number(buffered) || 0) - (Number(position) || 0));
  const bufferedAheadRef = useRef(bufferedAheadSec);
  bufferedAheadRef.current = bufferedAheadSec;

  useEffect(() => {
    if (!preparingKey) {
      preparingSinceRef.current = 0;
      setPreparingPct(0);
      setPreparingStalledNow(false);
      return undefined;
    }
    preparingSinceRef.current = Date.now();
    setPreparingPct(0);
    // Cleared on every new attempt, including the retry this state exists to
    // invite: tapping again must look like a fresh start, or the words that
    // asked for the tap are still on screen after it.
    setPreparingStalledNow(false);
    // Faster than useProgress's half-second poll: the estimated half is a
    // local clock, and at 500ms it visibly steps rather than moves.
    const tick = setInterval(() => {
      const elapsedMs = Date.now() - preparingSinceRef.current;
      const bufferedAheadSec = bufferedAheadRef.current;
      setPreparingPct((last) => preparingPercent({ elapsedMs, bufferedAheadSec, floor: last }));
      // Set from the reading each tick rather than latched, so the bytes
      // finally arriving takes the sentence back off the screen by itself.
      setPreparingStalledNow(preparingStalled({ elapsedMs, bufferedAheadSec }));
    }, PREPARING_TICK_MS);
    return () => clearInterval(tick);
  }, [preparingKey]);

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
        const rows = Array.isArray(response?.items) ? response.items : [];
        // One request, two lists: the gallery has no idea about this
        // distinction and does not need to — a recording is an audio row with
        // a tag on it.
        const { music, recordings: filed } = partitionVoiceRecordings(rows);
        setTracks(music);
        setRecordings(filed);
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
      setRecordings([]);
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
        // Read at the moment the queue is built, not held in state: a track
        // downloaded while this queue's tracks were already on screen must be
        // played from the phone, and the store is the only thing that knows.
        const { items, startIndex } = buildMusicQueue(
          tracks, mediaId, mediaBase, musicOfflineStore.localUris()
        );
        await musicPlayerService.playQueue(items, startIndex);
      });
    },
    [mediaBase, runCommand, tracks]
  );

  /**
   * Play from a list the context does not own.
   *
   * `playMedia` builds its queue out of `tracks` — MY library — so a row that
   * isn't in it (a track someone in the pond shared with me) makes
   * buildMusicQueue throw "Selected track is not playable". The rows carry the
   * same media shape, so the only thing missing was somewhere to pass them.
   * The queue becomes that list, which is what makes skip walk the shared
   * tracks rather than jumping back into mine.
   */
  /**
   * A track was renamed — tell the LOCK SCREEN.
   *
   * The queue is handed to the player once, when playback starts, so a
   * rename updated every list in the app and left the lock screen, Control
   * Centre and the car showing the old name. Deliberately fire-and-forget:
   * the rename itself has already happened and must not fail because the
   * player is between states, and a track that is not in the queue is the
   * normal case rather than an error.
   */
  const renameInQueue = useCallback((mediaId, title) => {
    if (!mediaId || !title) return;
    Promise.resolve(musicPlayerService.renameInQueue(String(mediaId), String(title)))
      .catch(() => {});
  }, []);

  const playRows = useCallback(
    async (rows, mediaId) => {
      return runCommand(async () => {
        const { items, startIndex } = buildMusicQueue(
          rows, mediaId, mediaBase, musicOfflineStore.localUris()
        );
        await musicPlayerService.playQueue(items, startIndex);
      });
    },
    [mediaBase, runCommand]
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

  /**
   * "Try again" after the ladder has given up — the tap the transport bar's
   * play key becomes while `interrupted` is set.
   *
   * Not routed through runCommand: the player is already set up (it was
   * playing a moment ago), and the ladder reports its own progress through
   * `interrupted` rather than through commandError.
   */
  const resumeInterrupted = useCallback(() => {
    musicAutoResume.resumeNow();
  }, []);

  // Audio is coming out of the speaker, so nothing is interrupted — whatever
  // recovered it. The ladder clears this itself; this is the safety net for
  // the paths that do not go through it (a manual Play, a skip, a new queue).
  useEffect(() => {
    if (isPlaying) setInterrupted((current) => (current ? null : current));
  }, [isPlaying]);

  const error = setupError || libraryError || commandError;

  const value = useMemo(
    () => ({
      tracks,
      recordings,
      loading,
      ready,
      error,
      setupError,
      libraryError,
      activeTrack,
      isPlaying,
      preparing,
      preparingPct,
      preparingStalled: preparingStalledNow,
      interrupted,
      resumeInterrupted,
      position,
      duration,
      refreshLibrary,
      retrySetup,
      playMedia,
      playRows,
      renameInQueue,
      togglePlayback,
      pause,
      previous,
      next,
      seekTo,
    }),
    [
      tracks,
      recordings,
      loading,
      ready,
      error,
      setupError,
      libraryError,
      activeTrack,
      isPlaying,
      preparing,
      preparingPct,
      preparingStalledNow,
      interrupted,
      resumeInterrupted,
      position,
      duration,
      refreshLibrary,
      retrySetup,
      playMedia,
      playRows,
      renameInQueue,
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
