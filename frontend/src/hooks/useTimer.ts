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
  const durationRef = useRef(duration);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  const tick = useCallback(() => {
    const elapsed = (performance.now() - startTimeRef.current) / 1000;
    const remaining = Math.max(0, durationRef.current - elapsed);
    setTimeLeft(remaining);

    if (remaining <= 0) {
      setIsRunning(false);
      onExpireRef.current();
    } else {
      rafRef.current = requestAnimationFrame(tick);
    }
  }, []);

  useEffect(() => {
    if (isRunning) {
      startTimeRef.current = performance.now();
      rafRef.current = requestAnimationFrame(tick);
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [isRunning, tick]);

  const start = useCallback(() => {
    setTimeLeft(durationRef.current);
    setIsRunning(true);
  }, []);

  const stop = useCallback(() => {
    setIsRunning(false);
    cancelAnimationFrame(rafRef.current);
  }, []);

  const reset = useCallback((newDuration?: number) => {
    cancelAnimationFrame(rafRef.current);
    const d = newDuration ?? duration;
    durationRef.current = d;
    setTimeLeft(d);
    setIsRunning(false);
  }, [duration]);

  const progress = durationRef.current > 0 ? timeLeft / durationRef.current : 0;
  const isUrgent = timeLeft <= 5 && timeLeft > 0;

  return { timeLeft, progress, isRunning, isUrgent, start, stop, reset };
}
