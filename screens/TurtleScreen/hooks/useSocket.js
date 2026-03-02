import { useEffect, useRef, useState, useCallback } from 'react';
import io from 'socket.io-client';

/**
 * useSocket - Manages Socket.io connection for Pomodoro sync
 * 
 * @param {string} serverUrl - Backend URL
 * @param {string} sessionId - Unique session identifier
 */
export function useSocket(serverUrl, sessionId) {
  const socketRef = useRef(null);
  const [isConnected, setIsConnected] = useState(false);
  const [timerState, setTimerState] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [durations, setDurations] = useState({ focus: 25, break: 5 });

  // Initialize socket connection
  useEffect(() => {
    if (!serverUrl || !sessionId) return;

    const socketUrl = serverUrl.replace('/api', '');
    console.log('[Socket] Connecting to:', socketUrl);

    socketRef.current = io(socketUrl, {
      query: { sessionId },
      transports: ['websocket'],
    });

    const socket = socketRef.current;

    socket.on('connect', () => {
      console.log('[Socket] Connected:', socket.id);
      setIsConnected(true);
      // Request current timer state
      socket.emit('pomodoro-get-state');
      socket.emit('pomodoro-get-durations');
    });

    socket.on('disconnect', () => {
      console.log('[Socket] Disconnected');
      setIsConnected(false);
    });

    socket.on('pomodoro-tick', (data) => {
      console.log('[Socket] Pomodoro tick:', data);
      setTimerState(data);
    });

    socket.on('pomodoro-complete', (data) => {
      console.log('[Socket] Pomodoro complete:', data);
      setTimerState((prev) => prev ? { ...prev, isComplete: true } : null);
    });

    socket.on('pomodoro-stopped', () => {
      console.log('[Socket] Pomodoro stopped');
      setTimerState(null);
    });

    socket.on('pomodoro-idle', () => {
      console.log('[Socket] Pomodoro idle');
      setTimerState(null);
    });

    socket.on('pomodoro-durations', (data) => {
      console.log('[Socket] Durations:', data);
      setDurations(data);
    });

    socket.on('pomodoro-durations-updated', (data) => {
      console.log('[Socket] Durations updated:', data);
      setDurations(data);
    });

    return () => {
      socket.disconnect();
    };
  }, [serverUrl, sessionId]);

  // Pomodoro actions
  const startPomodoro = useCallback((mode) => {
    socketRef.current?.emit('pomodoro-start', { mode });
  }, []);

  const stopPomodoro = useCallback(() => {
    socketRef.current?.emit('pomodoro-stop');
  }, []);

  const updateDurations = useCallback((focusMinutes, breakMinutes) => {
    socketRef.current?.emit('pomodoro-update-durations', {
      focusMinutes,
      breakMinutes,
    });
  }, []);

  const openSettings = useCallback(() => {
    setShowSettings(true);
  }, []);

  const closeSettings = useCallback(() => {
    setShowSettings(false);
  }, []);

  return {
    isConnected,
    timerState,
    durations,
    showSettings,
    startPomodoro,
    stopPomodoro,
    updateDurations,
    openSettings,
    closeSettings,
  };
}
