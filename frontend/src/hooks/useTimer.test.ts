import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTimer } from './useTimer';

// Controllable time for performance.now() and rAF-based timer
let mockTime: number;

function setupTimerMocks() {
  mockTime = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => mockTime);
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    return setTimeout(() => cb(mockTime), 16) as unknown as number;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    clearTimeout(id);
  });
}

// Simulate time passing: advance the mock clock, then flush rAF callbacks
function advanceTimerBy(ms: number) {
  mockTime += ms;
  vi.advanceTimersByTime(16); // flush one rAF frame
}

describe('useTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setupTimerMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('starts with full duration, not running', () => {
      const onExpire = vi.fn();
      const { result } = renderHook(() => useTimer({ duration: 30, onExpire }));

      expect(result.current.timeLeft).toBe(30);
      expect(result.current.isRunning).toBe(false);
      expect(result.current.progress).toBe(1);
      expect(result.current.isUrgent).toBe(false);
    });

    it('auto-starts when autoStart is true', () => {
      const onExpire = vi.fn();
      const { result } = renderHook(() => useTimer({ duration: 30, onExpire, autoStart: true }));

      expect(result.current.isRunning).toBe(true);
    });
  });

  describe('countdown behavior', () => {
    it('decreases timeLeft as time passes', () => {
      const onExpire = vi.fn();
      const { result } = renderHook(() => useTimer({ duration: 5, onExpire }));

      act(() => { result.current.start(); });

      // Advance 2 seconds
      act(() => { advanceTimerBy(2000); });

      expect(result.current.timeLeft).toBe(3);
      expect(result.current.isRunning).toBe(true);
      expect(onExpire).not.toHaveBeenCalled();
    });

    it('calls onExpire when timer reaches zero', () => {
      const onExpire = vi.fn();
      const { result } = renderHook(() => useTimer({ duration: 3, onExpire }));

      act(() => { result.current.start(); });

      // Tick through: not yet expired
      act(() => { advanceTimerBy(2000); });
      expect(onExpire).not.toHaveBeenCalled();

      // Tick past expiry
      act(() => { advanceTimerBy(1500); });
      expect(onExpire).toHaveBeenCalledTimes(1);
      expect(result.current.timeLeft).toBe(0);
      expect(result.current.isRunning).toBe(false);
    });

    it('does not call onExpire more than once', () => {
      const onExpire = vi.fn();
      const { result } = renderHook(() => useTimer({ duration: 1, onExpire }));

      act(() => { result.current.start(); });
      act(() => { advanceTimerBy(2000); });
      // Extra ticks after expiry should not re-fire
      act(() => { advanceTimerBy(1000); });
      act(() => { advanceTimerBy(1000); });

      expect(onExpire).toHaveBeenCalledTimes(1);
      expect(result.current.isRunning).toBe(false);
    });

    it('clamps timeLeft at zero (never goes negative)', () => {
      const onExpire = vi.fn();
      const { result } = renderHook(() => useTimer({ duration: 2, onExpire }));

      act(() => { result.current.start(); });
      // Overshoot by a lot
      act(() => { advanceTimerBy(10000); });

      expect(result.current.timeLeft).toBe(0);
    });
  });

  describe('controls', () => {
    it('stop() freezes the countdown', () => {
      const onExpire = vi.fn();
      const { result } = renderHook(() => useTimer({ duration: 10, onExpire }));

      act(() => { result.current.start(); });
      act(() => { advanceTimerBy(3000); });

      const timeAtStop = result.current.timeLeft;
      act(() => { result.current.stop(); });

      // More time passes, but timeLeft should not change
      act(() => { advanceTimerBy(5000); });
      expect(result.current.timeLeft).toBe(timeAtStop);
      expect(result.current.isRunning).toBe(false);
      expect(onExpire).not.toHaveBeenCalled();
    });

    it('reset() restores to full duration and stops', () => {
      const onExpire = vi.fn();
      const { result } = renderHook(() => useTimer({ duration: 10, onExpire }));

      act(() => { result.current.start(); });
      act(() => { advanceTimerBy(5000); });
      act(() => { result.current.reset(); });

      expect(result.current.timeLeft).toBe(10);
      expect(result.current.isRunning).toBe(false);
    });

    it('reset(newDuration) sets a custom timeLeft', () => {
      const onExpire = vi.fn();
      const { result } = renderHook(() => useTimer({ duration: 30, onExpire }));

      act(() => { result.current.reset(15); });

      expect(result.current.timeLeft).toBe(15);
      expect(result.current.isRunning).toBe(false);
    });
  });

  describe('derived values', () => {
    it('progress reflects elapsed fraction', () => {
      const onExpire = vi.fn();
      const { result } = renderHook(() => useTimer({ duration: 10, onExpire }));

      act(() => { result.current.start(); });
      act(() => { advanceTimerBy(5000); });

      expect(result.current.progress).toBe(0.5);
    });

    it('isUrgent is true when timeLeft <= 5 and > 0', () => {
      const onExpire = vi.fn();
      const { result } = renderHook(() => useTimer({ duration: 10, onExpire }));

      act(() => { result.current.start(); });

      // At 7s left — not urgent
      act(() => { advanceTimerBy(3000); });
      expect(result.current.isUrgent).toBe(false);

      // At 4s left — urgent
      act(() => { advanceTimerBy(3000); });
      expect(result.current.isUrgent).toBe(true);

      // At 0s — not urgent (expired)
      act(() => { advanceTimerBy(5000); });
      expect(result.current.isUrgent).toBe(false);
    });
  });
});
