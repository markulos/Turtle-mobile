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
