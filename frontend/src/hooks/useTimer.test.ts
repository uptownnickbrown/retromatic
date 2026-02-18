import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTimer } from './useTimer';

describe('useTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Mock performance.now with a controllable value
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    // Mock requestAnimationFrame to use setTimeout for testability
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      return setTimeout(() => {
        now += 1000; // advance 1 second per frame
        vi.spyOn(performance, 'now').mockImplementation(() => now);
        cb(now);
      }, 16) as unknown as number;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      clearTimeout(id);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('initializes with full duration', () => {
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

  it('starts counting down when start() is called', () => {
    const onExpire = vi.fn();
    const { result } = renderHook(() => useTimer({ duration: 30, onExpire }));

    act(() => {
      result.current.start();
    });

    expect(result.current.isRunning).toBe(true);
  });

  it('stops when stop() is called', () => {
    const onExpire = vi.fn();
    const { result } = renderHook(() => useTimer({ duration: 30, onExpire, autoStart: true }));

    act(() => {
      result.current.stop();
    });

    expect(result.current.isRunning).toBe(false);
  });

  it('resets to full duration', () => {
    const onExpire = vi.fn();
    const { result } = renderHook(() => useTimer({ duration: 30, onExpire }));

    act(() => {
      result.current.start();
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.timeLeft).toBe(30);
    expect(result.current.isRunning).toBe(false);
  });

  it('resets to a custom duration', () => {
    const onExpire = vi.fn();
    const { result } = renderHook(() => useTimer({ duration: 30, onExpire }));

    act(() => {
      result.current.reset(15);
    });

    expect(result.current.timeLeft).toBe(15);
    expect(result.current.isRunning).toBe(false);
  });

  it('computes progress as ratio of timeLeft to duration', () => {
    const onExpire = vi.fn();
    const { result } = renderHook(() => useTimer({ duration: 30, onExpire }));

    expect(result.current.progress).toBe(1); // 30/30

    act(() => {
      result.current.reset(15);
    });

    expect(result.current.progress).toBe(0.5); // 15/30
  });

  it('marks isUrgent when timeLeft <= 5 and > 0', () => {
    const onExpire = vi.fn();
    const { result } = renderHook(() => useTimer({ duration: 30, onExpire }));

    // At 30 seconds - not urgent
    expect(result.current.isUrgent).toBe(false);

    // Simulate resetting to 4 seconds
    act(() => {
      result.current.reset(4);
    });
    expect(result.current.isUrgent).toBe(true);

    // At exactly 0 - not urgent
    act(() => {
      result.current.reset(0);
    });
    expect(result.current.isUrgent).toBe(false);
  });
});
