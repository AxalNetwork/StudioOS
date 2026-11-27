import { useEffect, useRef, useState, useCallback } from 'react';

const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
const ACTIVITY_THROTTLE_MS = 1000;

export default function useInactivityTimeout({
  timeoutMs = 20 * 60 * 1000,
  warningMs = 60 * 1000,
  onTimeout,
  enabled = true,
} = {}) {
  const [warningOpen, setWarningOpen] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(Math.ceil(warningMs / 1000));

  const lastActivityRef = useRef(Date.now());
  const warnTimerRef = useRef(null);
  const logoutTimerRef = useRef(null);
  const countdownIntervalRef = useRef(null);
  const onTimeoutRef = useRef(onTimeout);

  useEffect(() => { onTimeoutRef.current = onTimeout; }, [onTimeout]);

  const clearTimers = useCallback(() => {
    if (warnTimerRef.current) { clearTimeout(warnTimerRef.current); warnTimerRef.current = null; }
    if (logoutTimerRef.current) { clearTimeout(logoutTimerRef.current); logoutTimerRef.current = null; }
    if (countdownIntervalRef.current) { clearInterval(countdownIntervalRef.current); countdownIntervalRef.current = null; }
  }, []);

  const scheduleTimers = useCallback(() => {
    clearTimers();
    const warnDelay = Math.max(0, timeoutMs - warningMs);
    warnTimerRef.current = setTimeout(() => {
      setSecondsLeft(Math.ceil(warningMs / 1000));
      setWarningOpen(true);
      countdownIntervalRef.current = setInterval(() => {
        const remaining = Math.max(
          0,
          Math.ceil((lastActivityRef.current + timeoutMs - Date.now()) / 1000),
        );
        setSecondsLeft(remaining);
      }, 1000);
      logoutTimerRef.current = setTimeout(() => {
        clearTimers();
        setWarningOpen(false);
        try { onTimeoutRef.current?.(); } catch (e) { /* ignore */ }
      }, warningMs);
    }, warnDelay);
  }, [timeoutMs, warningMs, clearTimers]);

  const resetTimer = useCallback(() => {
    lastActivityRef.current = Date.now();
    if (warningOpen) return;
    scheduleTimers();
  }, [scheduleTimers, warningOpen]);

  const stayLoggedIn = useCallback(() => {
    lastActivityRef.current = Date.now();
    setWarningOpen(false);
    scheduleTimers();
  }, [scheduleTimers]);

  const logoutNow = useCallback(() => {
    clearTimers();
    setWarningOpen(false);
    try { onTimeoutRef.current?.(); } catch (e) { /* ignore */ }
  }, [clearTimers]);

  useEffect(() => {
    if (!enabled) { clearTimers(); return; }

    let lastActivityHandled = 0;
    const handler = () => {
      const now = Date.now();
      if (now - lastActivityHandled < ACTIVITY_THROTTLE_MS) return;
      lastActivityHandled = now;
      lastActivityRef.current = now;
      if (!warningOpen) scheduleTimers();
    };

    ACTIVITY_EVENTS.forEach(ev => window.addEventListener(ev, handler, { passive: true }));
    scheduleTimers();

    return () => {
      ACTIVITY_EVENTS.forEach(ev => window.removeEventListener(ev, handler));
      clearTimers();
    };
  }, [enabled, warningOpen, scheduleTimers, clearTimers]);

  return { warningOpen, secondsLeft, stayLoggedIn, logoutNow, resetTimer };
}
