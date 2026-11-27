import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { PAID_STATUSES } from '../lib/incorporationPricing';

const POLL_INTERVAL_MS = 5_000;
const MAX_POLLS = 60;
// D601: once paid, the order waits on an admin's "Packet ready" and "Filed"
// (days, not seconds), so polling stops at payment instead of timing out into
// a false "something went wrong" after five minutes.
export const TERMINAL_STATES = new Set([...PAID_STATUSES, 'documents_ready', 'failed']);

/**
 * Polls GET /api/legal/incorporate/status?id=<incorporationId> every 5 s.
 * Stops automatically once a terminal state is reached, after MAX_POLLS
 * attempts, or when the hosting component unmounts.
 *
 * Returns:
 *   status  — current status string, or null before the first response
 *   data    — full response object from the endpoint
 *   error   — last fetch error message (null when last call succeeded)
 *   timedOut — true when MAX_POLLS elapsed without a terminal state
 *   polling  — true while actively scheduling the next tick
 */
export function useIncorporationStatus(incorporationId) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [timedOut, setTimedOut] = useState(false);
  const pollsRef = useRef(0);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!incorporationId) return;
    let cancelled = false;
    pollsRef.current = 0;

    const tick = async () => {
      if (cancelled) return;
      try {
        const res = await api.legalIncorporateStatus(incorporationId);
        if (cancelled) return;
        setData(res);
        setError(null);
        pollsRef.current += 1;
        if (TERMINAL_STATES.has(res.status)) return;
        if (pollsRef.current >= MAX_POLLS) {
          setTimedOut(true);
          return;
        }
        timerRef.current = setTimeout(tick, POLL_INTERVAL_MS);
      } catch (e) {
        if (cancelled) return;
        setError(e?.message || 'Status check failed');
        pollsRef.current += 1;
        if (pollsRef.current < MAX_POLLS) {
          timerRef.current = setTimeout(tick, POLL_INTERVAL_MS);
        } else {
          setTimedOut(true);
        }
      }
    };

    tick();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [incorporationId]);

  const status = data?.status ?? null;
  const polling = !!incorporationId && !TERMINAL_STATES.has(status) && !timedOut;

  return { status, data, error, timedOut, polling };
}
