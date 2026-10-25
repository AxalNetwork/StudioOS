import { useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { LIST_DEBOUNCE_MS, listReply } from './invitationsModel';

/**
 * D950 (#2726) — the Invitations tab's page, read from the Worker (D926):
 * search, filters, sort and page are the server's, and the total is exact.
 *
 * ONE REQUEST PER FILTER CHANGE. A change waits `LIST_DEBOUNCE_MS`; another
 * change in that time replaces it, so typing a name makes one request, not
 * one a key. A reply for options that are no longer the page's is dropped,
 * even when it lands after a newer one was asked for (each request carries
 * its sequence number). The first read, and a `tick` (the desk's reload
 * after a write, or Try again), go at once.
 *
 * Its shape is `useRead`'s: `{ status, data: { items, total } | null, error,
 * refreshing }`. A page that already answered keeps its rows while the next is
 * read (`refreshing`), and keeps them as stale under "Could not refresh" when
 * that read fails.
 */
export function useInvitationList(opts, tick, enabled = true) {
  const key = JSON.stringify(opts);
  const [read, setRead] = useState({ status: 'loading', data: null, error: null, key });
  const seq = useRef(0);
  const lastTick = useRef(null);
  useEffect(() => {
    if (!enabled) return undefined;
    const mine = ++seq.current;
    const now = lastTick.current !== tick;
    lastTick.current = tick;
    setRead((r) => (r.data !== null ? { ...r, status: r.status === 'error' ? 'loading' : r.status, refreshing: true, key } : { status: 'loading', data: null, error: null, key }));
    const timer = setTimeout(() => {
      api.adminPartners.listInvitations(JSON.parse(key)).then(listReply).then(
        (data) => { if (mine === seq.current) setRead({ status: 'ready', data, error: null, key }); },
        (error) => {
          reportError('admin-partners:invitations-page', error);
          if (mine === seq.current) setRead((r) => ({ status: 'error', data: r.data, error, key }));
        },
      );
    }, now ? 0 : LIST_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [key, tick, enabled]);
  return read;
}
