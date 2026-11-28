/**
 * D9068 (#9068): Network › Introductions › Through Axal, the member's requests by who acts next, to the canvas
 * `design/incoming/Network External Introduction Requests Page.dc.html` (D7678, boards NIE01, NIE18, NIE21), at
 * `/network/introductions/requests`.
 *
 * FOUR LANES, COUNTED BY THE SERVER. `GET /api/intro-requests?next_actor=` pages one lane with a true total, and
 * every answer carries `lanes`, each lane's count from one read. A lane that holds nothing is a counted zero; a read
 * that fails is Unavailable with Try again, never an empty desk. Team requests, curated matches and the quarterly
 * ask keep their own desk on Network › Introductions and are not mixed in here.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DataState } from '../../ui/Honesty';
import { introRequestsApi } from '../../lib/api/introRequests.js';
import { reportError } from '../../lib/log';
import { LANES, fourFields, laneOf, nextLine, shortUid, stamp, targetLine } from './introRequestModel.js';
import { BTN, BTN_PRIMARY, Card, Chip, Frame, PageHeader } from './introKit.jsx';

function Row({ r }) {
  const t = targetLine(r);
  const f = fourFields(r);
  const href = `/network/introductions/requests/${encodeURIComponent(r.uid)}`;
  return (
    <li className="flex flex-col gap-2 border-t border-gray-200 py-3 first:border-t-0 dark:border-gray-700 lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1.6fr)_110px] lg:items-center lg:gap-4" data-request={r.uid}>
      <div className="min-w-0">
        <Link to={href} className="block min-h-[24px] truncate text-[14px] font-bold text-gray-900 hover:text-violet-700 dark:text-gray-100 dark:hover:text-violet-300">
          {t.name || 'Person not recorded'}<span className="sr-only"> · open request {shortUid(r.uid)}</span>
        </Link>
        <small className="block truncate text-[12px] text-gray-600 dark:text-gray-400">{[t.organization && t.name && !t.name.startsWith('Person to be') ? t.organization : null, t.kind].filter(Boolean).join(' · ')}</small>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip s={f.request} />
        <Chip s={f.response} />
      </div>
      <p className="text-[12.5px] text-gray-700 dark:text-gray-300"><span className="lg:sr-only">Next: </span>{nextLine(r)}</p>
      <span className="font-mono text-[12px] text-gray-600 dark:text-gray-400">{(stamp(r.updated_at) || '').slice(0, 10)}</span>
    </li>
  );
}

export default function IntroRequestsDesk() {
  const [params, setParams] = useSearchParams();
  const lane = laneOf(params.get('lane'));
  const [read, setRead] = useState({ status: 'loading', items: [], total: null, lanes: null, next: null });
  const [more, setMore] = useState({ status: 'idle' });

  const load = useCallback(() => {
    let live = true;
    setRead((r) => ({ ...r, status: 'loading', items: [] }));
    introRequestsApi.list({ next_actor: lane })
      .then((d) => { if (live) setRead({ status: 'ok', items: d.items || [], total: d.total, lanes: d.lanes || null, next: d.next_cursor }); })
      .catch((e) => { if (live) setRead({ status: 'error', items: [], total: null, lanes: null, next: null }); reportError('intro-requests:list', e); });
    return () => { live = false; };
  }, [lane]);
  useEffect(load, [load]);

  const loadMore = () => {
    setMore({ status: 'loading' });
    introRequestsApi.list({ next_actor: lane, cursor: read.next })
      .then((d) => { setRead((r) => ({ ...r, items: [...r.items, ...(d.items || [])], next: d.next_cursor, total: d.total })); setMore({ status: 'idle' }); })
      .catch((e) => { setMore({ status: 'error' }); reportError('intro-requests:list-more', e); });
  };

  const all = read.lanes ? LANES.reduce((n, l) => n + Number(read.lanes[l.key] || 0), 0) : null;
  const laneLabel = LANES.find((l) => l.key === lane).label;

  return (
    <Frame bar={<Link to="/network/introductions/requests/new" className={`${BTN_PRIMARY} flex-1`}>Request an introduction</Link>}>
      <PageHeader
        crumb={[{ label: 'Network', to: '/network' }, { label: 'Introductions', to: '/network/introductions' }, { label: 'Through Axal' }]}
        eye="Network · Introductions"
        title="Through Axal"
        sub="Requests you asked Axal to coordinate, by who acts next. Axal contacts the person only after an operator reviews a request."
        actions={(
          <>
            <Link to="/network/introductions/readiness" className={BTN}>Request readiness</Link>
            <Link to="/network/introductions/requests/new" className={`${BTN_PRIMARY} hidden lg:inline-flex`}>Request an introduction</Link>
          </>
        )}
      />

      <Card title="Your requests through Axal" id="ir-desk" aside={all != null ? `${all} ${all === 1 ? 'request' : 'requests'} · counted by the server` : null}>
        <div role="tablist" aria-label="Requests through Axal by who acts next" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {LANES.map((l) => {
            const on = l.key === lane;
            const n = read.lanes ? read.lanes[l.key] : null;
            return (
              <button
                key={l.key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setParams((p) => { const q = new URLSearchParams(p); q.set('lane', l.key); return q; }, { replace: true })}
                className={`flex min-h-[56px] flex-col items-start rounded-lg border px-3 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500 ${on ? 'border-violet-500 bg-violet-50 dark:border-violet-400 dark:bg-violet-500/10' : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800'}`}
              >
                <b className="font-mono text-[18px] text-gray-900 dark:text-gray-100" data-lane-count={l.key}>{n == null ? (read.status === 'error' ? '?' : '…') : n}</b>
                <span className="text-[12.5px] font-semibold text-gray-700 dark:text-gray-300">{l.label}{n == null && read.status === 'error' ? ' · Unavailable' : ''}</span>
              </button>
            );
          })}
        </div>

        <div role="tabpanel" aria-label={laneLabel}>
          {read.status === 'loading' ? (
            <div aria-busy="true" aria-label="Loading requests" className="flex flex-col gap-2 py-2">
              <p role="status" className="text-[12.5px] text-gray-600 dark:text-gray-400">Reading your requests… No count is drawn until the read answers.</p>
              {[0, 1, 2].map((i) => <span key={i} className="block h-[34px] animate-pulse rounded bg-gray-200 dark:bg-gray-700" />)}
            </div>
          ) : null}
          {read.status === 'error' ? (
            <DataState state="unavailable" size="block" what="Your requests" claim="This is not a claim that you have none." onRetry={load} retryLabel="Try again" />
          ) : null}
          {read.status === 'ok' && read.items.length === 0 ? (
            all === 0 ? (
              <DataState state="none" size="block" action={<Link to="/network/introductions/requests/new" className={BTN_PRIMARY}>Request an introduction</Link>}>
                You have not asked Axal for an introduction. Name a person and Axal coordinates the rest.
              </DataState>
            ) : (
              <DataState state="none" size="block">Nothing in {laneLabel} right now.</DataState>
            )
          ) : null}
          {read.items.length ? (
            <>
              <div className="hidden border-b border-gray-200 pb-1 text-[11px] font-bold uppercase tracking-wide text-gray-600 dark:border-gray-700 dark:text-gray-400 lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1.6fr)_110px] lg:gap-4">
                <span>Person</span><span>Request · response</span><span>Next</span><span>Updated</span>
              </div>
              <ul>{read.items.map((r) => <Row key={r.uid} r={r} />)}</ul>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 pt-2 text-[12px] text-gray-600 dark:border-gray-700 dark:text-gray-400">
                <span>{read.items.length} shown of {read.total}{read.next ? '' : ' · end of list'}</span>
                {read.next ? <button type="button" className={BTN} onClick={loadMore} disabled={more.status === 'loading'}>{more.status === 'loading' ? 'Loading…' : 'Show more'}</button> : null}
              </div>
              {more.status === 'error' ? <DataState state="unavailable" what="The next page" claim="The rows above are still current." onRetry={loadMore} retryLabel="Try again" /> : null}
            </>
          ) : null}
        </div>
      </Card>

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2" aria-label="Kept separate">
        <Card title="From your team and curated matches" id="ir-kept">
          <p className="text-[13px] text-gray-700 dark:text-gray-300">Teammates who know the person, curated matches and the investor quarterly ask keep their own desk, counts and rules. This service spends no credit and uses none of them.</p>
          <Link to="/network/introductions" className={`${BTN} self-start`}>Open Introductions</Link>
        </Card>
        <Card title="What submitting does" id="ir-what">
          <p className="text-[13px] text-gray-700 dark:text-gray-300">Submitting asks Axal to coordinate. It sends nothing to the person. An operator reviews the request, may ask you something, and records any contact; you see each step here.</p>
        </Card>
      </section>
    </Frame>
  );
}
