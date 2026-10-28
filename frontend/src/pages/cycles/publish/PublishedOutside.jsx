import React, { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Sheet from '../../../ui/Sheet.jsx';
import { publishApi } from '../../../lib/api/publish.js';
import {
  HISTORY_ID, MODULE_LABELS, STATUS_FILTERS, accountOn, dayAndTime, detailFacts, filterRows, historyRow, moduleLabel, providerChoices, statusOf, viewLink,
} from './publishModel.js';
import { BTN_SECONDARY, ConfirmSend, EYEBROW, LINK, MUTED, SendActions, StatusPill, Tile } from './SendParts.jsx';

/**
 * D1321 (#3482, PUB9, PUB11) — "Published outside", the second list on
 * Grow's Updates history (#2400 decision G, (a)), under Updates you shared on
 * the Reporting desk. It is part 1's `GET /api/publish/sends`, which the
 * venture's team reads; only the founder (`can_publish` on part 1's
 * destinations read) gets Retry, Check, Mark as not sent, Retract and Mark as
 * removed.
 *
 *   · Filters: module, destination and status go to the Worker; the search
 *     reads the text here.
 *   · A row opens its detail as D1317's `Sheet`. The detail has an address,
 *     `?sent=<uid>` on the desk's own (`historyHref`), so it can be linked;
 *     closing it (×, Escape, the scrim) goes back to the list's address.
 *   · At 390px the rows are cards (PUB11), each target 44px.
 */
export default function PublishedOutside({ projectId, api = publishApi, viewerId = null }) {
  const loc = useLocation();
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ module: '', provider: '', status: '', q: '' });
  const [state, setState] = useState({ status: 'loading', sends: [], error: '' });
  const [canPublish, setCanPublish] = useState(false);
  const [retrying, setRetrying] = useState(null);
  const [opened, setOpened] = useState(null);
  const sentUid = new URLSearchParams(loc.search).get('sent');

  const load = useCallback(() => {
    if (!projectId) return;
    setState((s) => ({ ...s, status: 'loading', error: '' }));
    api.sends(projectId, { module: filters.module, provider: filters.provider, status: filters.status })
      .then((r) => setState({ status: 'ready', sends: r?.sends || [], error: '' }))
      .catch((e) => setState({ status: e?.code === 'not_found' || e?.status === 404 ? 'hidden' : 'error', sends: [], error: e?.message || 'Published outside could not be read.' }));
  }, [api, projectId, filters.module, filters.provider, filters.status]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!projectId) return;
    api.destinations(projectId).then((r) => setCanPublish(r?.can_publish === true)).catch(() => setCanPublish(false));
  }, [api, projectId]);

  // The detail: the row from the list, else read on its own (a link from elsewhere).
  const listed = state.sends.find((s) => s.uid === sentUid) || null;
  useEffect(() => {
    if (!sentUid || listed || state.status !== 'ready') { setOpened(null); return; }
    let live = true;
    api.send(sentUid).then((r) => { if (live) setOpened(r?.send ? r.send : { missing: true }); }).catch(() => { if (live) setOpened({ missing: true }); });
    return () => { live = false; };
  }, [api, sentUid, listed, state.status]);
  const detail = sentUid ? listed || opened : null;

  const params = (uid) => {
    const q = new URLSearchParams(loc.search);
    if (uid) q.set('sent', uid); else q.delete('sent');
    const s = q.toString();
    return `${loc.pathname}${s ? `?${s}` : ''}#${HISTORY_ID}`;
  };
  const openRow = (uid) => navigate(params(uid));
  const close = () => navigate(params(null), { replace: true });
  const replace = (s) => s && setState((st) => ({ ...st, sends: st.sends.map((x) => (x.uid === s.uid ? s : x)) }));

  const rows = filterRows(state.sends, filters);
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const SELECT = 'min-h-[44px] rounded-[9px] border border-axal-hairline bg-white px-3 text-[12.5px] font-semibold text-axal-ink sm:min-h-[34px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

  // Outside the venture's team the Worker answers 404: the list is not theirs, so it is not drawn.
  if (state.status === 'hidden') return null;
  let body;
  if (state.status === 'loading') body = <p className={`m-0 text-[12.5px] ${MUTED}`} aria-busy="true" data-testid="published-loading">Reading…</p>;
  else if (state.status === 'error') body = (
    <div role="alert" className="flex flex-wrap items-center gap-2 text-[12.5px]" data-testid="published-error">
      <span className={MUTED}>Unreadable: {state.error}</span><button type="button" className={BTN_SECONDARY} onClick={load}>Try again</button>
    </div>
  );
  else if (!rows.length) body = <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="published-none">{state.sends.length ? 'Nothing matches these filters.' : 'Nothing published outside Axal VC yet.'}</p>;
  else body = (
    <ul className="m-0 flex list-none flex-col gap-2.5 p-0 sm:gap-0 sm:overflow-hidden sm:rounded-xl sm:border sm:border-axal-hairline sm:bg-white dark:sm:border-gray-800 dark:sm:bg-gray-900" data-testid="published-rows">
      <li aria-hidden="true" className={`hidden h-9 grid-cols-[96px_140px_minmax(0,1fr)_124px_110px] items-center gap-2 px-3.5 sm:grid ${EYEBROW}`}>
        <span>Sent</span><span>Module</span><span>Destination</span><span>Status</span><span />
      </li>
      {rows.map((s) => <HistoryRow key={s.uid} send={s} selected={s.uid === sentUid} canPublish={canPublish} onOpen={openRow} onRetry={setRetrying} />)}
    </ul>
  );

  return (
    <section id={HISTORY_ID} className="flex min-w-0 scroll-mt-4 flex-col gap-2.5" aria-labelledby="published-title" data-testid="published-outside">
      <div className="flex items-baseline gap-2.5">
        <h2 id="published-title" className="m-0 text-[17px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100">Published outside</h2>
        {state.status === 'ready' && <span className={`font-mono text-[11.5px] ${MUTED}`} data-testid="published-count">{rows.length}</span>}
      </div>
      <div className="flex flex-wrap gap-2" data-testid="published-filters">
        <label className="sr-only" htmlFor="published-module">Module</label>
        <select id="published-module" value={filters.module} onChange={set('module')} className={SELECT} data-testid="published-filter-module">
          <option value="">Module · All</option>
          {Object.entries(MODULE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label className="sr-only" htmlFor="published-provider">Destination</label>
        <select id="published-provider" value={filters.provider} onChange={set('provider')} className={SELECT} data-testid="published-filter-provider">
          <option value="">Destination · All</option>
          {providerChoices(state.sends).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        <label className="sr-only" htmlFor="published-status">Status</label>
        <select id="published-status" value={filters.status} onChange={set('status')} className={SELECT} data-testid="published-filter-status">
          <option value="">Status · All</option>
          {STATUS_FILTERS.map((k) => <option key={k} value={k}>{statusOf(k).word}</option>)}
        </select>
        <input type="search" value={filters.q} onChange={set('q')} aria-label="Search the text" placeholder="Search the text"
          className={`${SELECT} min-w-[160px] flex-1 font-normal`} data-testid="published-search" />
      </div>
      {body}
      {detail && <SendDetail send={detail} canPublish={canPublish} viewerId={viewerId} api={api} onClose={close} onChanged={replace} onRetry={setRetrying} />}
      {retrying && (
        <ConfirmSend rows={[{ uid: retrying.uid, provider_key: retrying.provider_key, title: accountOn(retrying.destination, retrying.provider_key), line: retrying.audience || 'Audience not stated' }]}
          onCancel={() => setRetrying(null)} onSend={async () => { const r = await api.retry(retrying.uid); setRetrying(null); replace(r?.send); }} />
      )}
    </section>
  );
}

function HistoryRow({ send, selected, canPublish, onOpen, onRetry }) {
  const r = historyRow(send);
  const retry = canPublish && send.status === 'failed';
  const after = r.link
    ? <a href={r.link.href} target="_blank" rel="noopener noreferrer" className={LINK}>{r.link.label}</a>
    : retry ? <button type="button" className={`${BTN_SECONDARY} min-h-[36px] px-3 text-[12px]`} onClick={() => onRetry(send)} data-testid={`published-retry-${send.uid}`}>Retry</button>
      : <span className={MUTED} aria-label="No link">—</span>;
  return (
    <li className={`rounded-xl border border-axal-hairline bg-white px-3 py-2.5 text-[12.5px] sm:grid sm:min-h-[50px] sm:grid-cols-[96px_140px_minmax(0,1fr)_124px_110px] sm:items-center sm:gap-2 sm:rounded-none sm:border-0 sm:border-t sm:px-3.5 sm:py-1.5 dark:border-gray-800 dark:bg-gray-900 ${selected ? 'sm:bg-violet-50 sm:shadow-[inset_3px_0_0_#7c3aed] dark:sm:bg-violet-500/15' : ''}`}
      data-testid={`published-row-${send.uid}`}>
      <div className="hidden flex-col sm:flex"><span className="font-mono text-[11.5px] font-medium tabular-nums">{r.day}</span><span className={`font-mono text-[11.5px] ${MUTED}`}>{r.time}</span></div>
      <span className="hidden sm:inline">{r.module}</span>
      <div className="flex min-w-0 items-center gap-2">
        <Tile provider={send.provider_key} size={22} />
        <button type="button" onClick={() => onOpen(send.uid)} className="min-h-[44px] min-w-0 flex-1 text-left sm:min-h-0" data-testid={`published-open-${send.uid}`}>
          <span className="block truncate font-semibold text-axal-ink hover:underline dark:text-gray-100">{r.account}</span>
          <span className={`block truncate text-[11.5px] ${MUTED}`}>{r.provider}{r.audience ? ` · ${r.audience}` : ''}</span>
        </button>
        <span className="sm:hidden"><StatusPill status={r.status} /></span>
      </div>
      <span className="hidden sm:inline"><StatusPill status={r.status} testId={`published-status-${send.uid}`} /></span>
      <span className="hidden sm:inline">{after}</span>
      <div className="mt-1 truncate text-[13px] text-axal-ink sm:hidden dark:text-gray-100">{r.first}</div>
      <div className="flex min-h-[44px] items-center sm:hidden"><span className={`font-mono text-[11.5px] ${MUTED}`}>{r.day}{r.time ? ` · ${r.time}` : ''} · {r.module}</span><span className="flex-1" />{after}</div>
    </li>
  );
}

/** PUB9's detail: the exact text, the facts, and what may be done, as a Sheet with its own address. */
function SendDetail({ send, canPublish, viewerId, api, onClose, onChanged, onRetry }) {
  if (send.missing) {
    return (
      <Sheet eyebrow="Published outside" title="Not here" width={480} onClose={onClose} testId="published-detail">
        <p className={`m-0 px-5 py-[18px] text-[13px] ${MUTED}`} data-testid="published-detail-missing">That post is not here, or not yours to see.</p>
      </Sheet>
    );
  }
  const when = dayAndTime(send.sent_at || send.confirmed_at);
  const link = viewLink(send);
  return (
    <Sheet eyebrow="Published outside" title={accountOn(send.destination, send.provider_key)} sub={`${moduleLabel(send.module)}${when.day ? ` · ${when.day}, ${when.time}` : ''}`}
      width={480} onClose={onClose} testId="published-detail"
      footer={link ? <a href={link.href} target="_blank" rel="noopener noreferrer" className={BTN_SECONDARY}>{link.label}</a> : null}>
      <div className="flex flex-col gap-3.5 px-5 py-4" data-testid={`published-detail-${send.uid}`}>
        <span><StatusPill status={send.status} /></span>
        <span className={EYEBROW}>Exact text</span>
        {send.text != null
          ? <div className="whitespace-pre-wrap rounded-[10px] border border-axal-hairline bg-[#f7f6fa] px-3 py-3 text-[13px] leading-[1.55] text-axal-ink dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100" data-testid="published-text">{send.text}</div>
          : <p className={`m-0 text-[12.5px] ${MUTED}`}>The text is for the venture’s team.</p>}
        <dl className="m-0 flex flex-col">
          {detailFacts(send, viewerId).map((f) => (
            <div key={f.k} className="flex min-h-[38px] items-center gap-2.5 border-t border-axal-hairline first:border-t-0 dark:border-gray-700">
              <dt className={`w-[104px] flex-none text-[12px] ${MUTED}`}>{f.k}</dt>
              <dd className={`m-0 min-w-0 flex-1 break-all ${f.mono ? 'font-mono text-[12.5px] tabular-nums' : 'text-[13px] font-semibold'}`}>{f.v}</dd>
              {f.copy && typeof navigator !== 'undefined' && navigator.clipboard && <button type="button" className={`${BTN_SECONDARY} min-h-[30px] px-2.5 text-[12px]`} onClick={() => navigator.clipboard.writeText(f.v).catch(() => {})}>Copy</button>}
            </div>
          ))}
        </dl>
        <SendActions send={send} canPublish={canPublish} api={api} onChanged={onChanged} onRetry={onRetry} />
      </div>
    </Sheet>
  );
}
