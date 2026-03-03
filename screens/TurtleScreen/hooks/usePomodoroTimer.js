import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * usePomodoroTimer - Manages local Pomodoro timer with countdown
 * 
 * Features:
 * - Local countdown that works in background
 * - Calculates remaining time from endTime
 * - Provides formatted display time
 * - Tracks progress (0-1)
 * 
 * @param {Object} timerState - { endTime, totalDuration, mode, isRunning }
 * @param {Function} onComplete - Callback when timer reaches 0
 */
export function usePomodoroTimer(timerState, onComplete) {
  // Local state
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [displayTime, setDisplayTime] = useState('00:00');
  const [progress, setProgress] = useState(0);
  const [isActive, setIsActive] = useState(false);
  const [mode, setMode] = useState('focus');
  
  // Refs
  const intervalRef = useRef(null);
  const endTimeRef = useRef(null);
  const totalDurationRef = useRef(1500);
  const hasCompletedRef = useRef(false);
  
  // Calculate remaining from endTime
  const calculateRemaining = useCallback(() => {
    if (!endTimeRef.current) return 0;
    return Math.max(0, Math.floor((endTimeRef.current - Date.now()) / 1000));
  }, []);
  
  // Format seconds to MM:SS
  const formatTime = useCallback((seconds) => {
    if (!seconds || seconds < 0) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, []);
  
  // Initialize timer from server state
  useEffect(() => {
    if (!timerState || !timerState.endTime) {
      setIsActive(false);
      setRemainingSeconds(0);
      setDisplayTime('00:00');
      setProgress(0);
      hasCompletedRef.current = false;
      return;
    }
    
    // Reset completion flag for new timer
    hasCompletedRef.current = false;
    
    // Set refs
    endTimeRef.current = timerState.endTime;
    totalDurationRef.current = timerState.totalDuration || 1500;
    setMode(timerState.mode || 'focus');
    
    // Calculate initial remaining
    const remaining = calculateRemaining();
    setRemainingSeconds(remaining);
    setDisplayTime(formatTime(remaining));
    setProgress(1 - (remaining / totalDurationRef.current));
    setIsActive(remaining > 0);
    
    console.log('[usePomodoroTimer] Initialized:', {
      endTime: new Date(timerState.endTime).toLocaleTimeString(),
      remaining,
      mode: timerState.mode,
    });
  }, [timerState, calculateRemaining, formatTime]);
  
  // Countdown interval
  useEffect(() => {
    if (!isActive || !endTimeRef.current) return;
    
    // Clear existing
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    
    // Start countdown
    intervalRef.current = setInterval(() => {
      const remaining = calculateRemaining();
      setRemainingSeconds(remaining);
      setDisplayTime(formatTime(remaining));
      setProgress(1 - (remaining / totalDurationRef.current));
      
      if (remaining <= 0 && !hasCompletedRef.current) {
        hasCompletedRef.current = true;
        setIsActive(false);
        onComplete?.();
      }
    }, 1000);
    
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isActive, calculateRemaining, formatTime, onComplete]);
  
  return {
    remainingSeconds,
    displayTime,
    progress,
    isActive,
    mode,
    totalDuration: totalDurationRef.current,
    isFocus: mode === 'focus',
  };
}
