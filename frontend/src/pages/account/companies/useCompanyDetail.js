/**
 * #4964 — one company-detail read per settings page, shared.
 *
 * Settings › General drew its header from one `GET /api/company/:uid` and its form from a second. Both now subscribe
 * to this store, keyed by uid:
 *
 *   - the first subscriber of a visit (subscribers going from none to one) starts one read; every other subscriber
 *     mounted meanwhile shares it, so a page load is one request;
 *   - `reload()` is one refetch for all of them (the form's Try again, after a conflict, after a save);
 *   - `setRow(row)` publishes a row a write returned (a save, a logo change), so the header's name, the form and the
 *     preview read the same response, and no second read is made to learn what the write already answered.
 *
 * A 404 is `notFound` (not this member's to open); any other failure is `error` (#4736's rule, through
 * `portfolio.through`). The reader is injectable for tests.
 */
import { useCallback, useEffect, useState } from 'react';
import { teamsApi } from '../../../lib/api/teams';
import * as portfolio from './portfolioAdapter.js';

const LOADING = Object.freeze({ status: 'loading', row: null });
const entries = new Map();

const defaultReader = (uid) => portfolio.through(() => teamsApi.getCompany(uid));

function entryOf(uid) {
  let e = entries.get(uid);
  if (!e) { e = { state: LOADING, listeners: new Set(), inflight: null }; entries.set(uid, e); }
  return e;
}

function publish(uid, state) {
  const e = entryOf(uid);
  e.state = state;
  for (const l of [...e.listeners]) l(state);
}

/** Start (or join) the read for `uid`. */
export function loadCompanyDetail(uid, reader = defaultReader) {
  const e = entryOf(uid);
  if (e.inflight) return e.inflight;
  if (e.state.status !== 'loading') publish(uid, { ...LOADING, row: e.state.row });
  const run = Promise.resolve().then(() => reader(uid)).then(
    (r) => (r && r.available ? { status: 'ready', row: r.value } : { status: r?.notFound ? 'notFound' : 'error', row: null }),
    () => ({ status: 'error', row: null }),
  ).then((state) => {
    if (e.inflight === run) e.inflight = null;
    publish(uid, state);
    return state;
  });
  e.inflight = run;
  return run;
}

/** Publish a row a write returned, to every subscriber of its company. */
export function publishCompanyDetail(uid, row) {
  if (uid && row && typeof row === 'object') publish(uid, { status: 'ready', row });
}

/** For tests: forget every cached company. */
export function resetCompanyDetails() { entries.clear(); }

export function useCompanyDetail(uid, { reader = defaultReader } = {}) {
  const [state, setState] = useState(() => (uid ? entryOf(uid).state : LOADING));
  useEffect(() => {
    if (!uid) return undefined;
    const e = entryOf(uid);
    const first = e.listeners.size === 0;
    e.listeners.add(setState);
    // A new visit reads afresh; a subscriber joining a visit already under way shares its read and its row.
    if (first) loadCompanyDetail(uid, reader);
    else setState(e.state);
    return () => { e.listeners.delete(setState); };
  }, [uid, reader]);
  const reload = useCallback(() => (uid ? loadCompanyDetail(uid, reader) : Promise.resolve(LOADING)), [uid, reader]);
  const setRow = useCallback((row) => publishCompanyDetail(uid, row), [uid]);
  return { ...state, reload, setRow };
}
