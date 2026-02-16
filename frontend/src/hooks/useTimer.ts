import { useState, useEffect, useCallback, useRef } from 'react';

interface UseTimerOptions {
  duration: number;
  onExpire: () => void;
  autoStart?: boolean;
}

export function useTimer({ duration, onExpire, autoStart = false }: UseTimerOptions) {
  const [timeLeft, setTimeLeft] = useState(duration);
  const [isRunning, setIsRunning] = useState(autoStart);
  const startTimeRef = useRef<number>(0);
  const rafRef = useRef<number>(0);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  const tick = useCallback(() => {
    const elapsed = (performance.now() - startTimeRef.current) / 1000;
    const remaining = Math.max(0, duration - elapsed);
    setTimeLeft(remaining);

    if (remaining <= 0) {
      setIsRunning(false);
      onExpireRef.current();
    } else {
      rafRef.current = requestAnimationFrame(tick);
    }
  }, [duration]);

  useEffect(() => {
    if (isRunning) {
      startTimeRef.current = performance.now();
      rafRef.current = requestAnimationFrame(tick);
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [isRunning, tick]);

  const start = useCallback(() => {
    setTimeLeft(duration);
    setIsRunning(true);
  }, [duration]);

  const stop = useCallback(() => {
    setIsRunning(false);
    cancelAnimationFrame(rafRef.current);
  }, []);

  const reset = useCallback((newDuration?: number) => {
    cancelAnimationFrame(rafRef.current);
    setTimeLeft(newDuration ?? duration);
    setIsRunning(false);
  }, [duration]);

  const progress = timeLeft / duration;
  const isUrgent = timeLeft <= 5 && timeLeft > 0;

  return { timeLeft, progress, isRunning, isUrgent, start, stop, reset };
}
