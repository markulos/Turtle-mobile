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
  const sessionGeneration = useRef(0);
  const libraryRequestGeneration = useRef(0);
  const activeTrack = useActiveMediaItem();
  const isPlaying = useIsPlaying();
  const { position, duration } = useProgress(0.5);
  const mediaBase = useMemo(
    () => (getMediaBaseUrl ? getMediaBaseUrl() : getBaseUrl()).replace(/\/api$/, ''),
    [getBaseUrl, getMediaBaseUrl]
  );

  const refreshLibrary = useCallback(async () => {
    if (!isAuthenticated) return;
    const requestGeneration = ++libraryRequestGeneration.current;
    const currentSession = sessionGeneration.current;
    const isCurrentRequest = () =>
      currentSession === sessionGeneration.current &&
      requestGeneration === libraryRequestGeneration.current;
    setLoading(true);
    try {
      const response = await api.get(
        '/media/gallery?kind=audio&limit=300&order=desc&sortBy=upload'
      );
      if (!isCurrentRequest()) return;
      setTracks(Array.isArray(response?.items) ? response.items : []);
      setError(null);
    } catch (refreshError) {
      if (!isCurrentRequest()) return;
      setError(refreshError?.message || 'Unable to load music');
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  }, [api, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      sessionGeneration.current += 1;
      libraryRequestGeneration.current += 1;
      if (wasAuthenticated.current) {
        setReady(false);
        setTracks([]);
        setError(null);
        setLoading(false);
        musicPlayerService.clear().catch(() => {});
      }
      wasAuthenticated.current = false;
      return;
    }
    const currentSession = ++sessionGeneration.current;
    wasAuthenticated.current = true;
    setReady(false);
    musicPlayerService
      .ensureReady()
      .then(() => {
        if (currentSession === sessionGeneration.current) setReady(true);
      })
      .catch((setupError) => {
        if (currentSession === sessionGeneration.current) {
          setError(setupError?.message || 'Music player is unavailable');
        }
      });
    refreshLibrary();
  }, [isAuthenticated, refreshLibrary]);

  const playMedia = useCallback(
    async (mediaId) => {
      if (!ready) return;
      try {
        const { items, startIndex } = buildMusicQueue(tracks, mediaId, mediaBase);
        await musicPlayerService.playQueue(items, startIndex);
        setError(null);
      } catch (playError) {
        setError(playError?.message || 'Unable to play this track');
      }
    },
    [mediaBase, ready, tracks]
  );

  const togglePlayback = useCallback(() => {
    if (!ready) return;
    return musicPlayerService.togglePlayback(isPlaying);
  }, [isPlaying, ready]);

  const previous = useCallback(() => {
    if (!ready) return;
    return musicPlayerService.previous();
  }, [ready]);

  const next = useCallback(() => {
    if (!ready) return;
    return musicPlayerService.next();
  }, [ready]);

  const seekTo = useCallback((seconds) => {
    if (!ready) return;
    return musicPlayerService.seekTo(seconds);
  }, [ready]);

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
      togglePlayback,
      previous,
      next,
      seekTo,
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
      togglePlayback,
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
