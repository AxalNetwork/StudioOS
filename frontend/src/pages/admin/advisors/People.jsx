import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { adminNetworkProfiles } from '../../../lib/api';
import { adminNetworkApi } from '../../../lib/api/network.js';
import { reportError } from '../../../lib/log';
import { Lightbox, actionGhost, actionPrimary, usePhoneWidth } from '../../../ui';
import PersonDrawer from './PersonDrawer';
import {
  EXPORT_PAGE, FILTERS, PAGE_SIZE, PEOPLE_PATH, SORTS, UNREADABLE, activeFilterCount, csvOf, deckDrafts,
  filterOptions, pageLine, queryOf, rowOf, searchOf, stateOf,
} from './peopleModel';

/**
 * D978 (#2764) — People (AP3): one table of every advisor, operating partner
 * and deck-only name, from D973's people read. Search, filters, sort and the
 * page live in the address, so a link to a filtered list is that list. Cards
 * on a phone (AP13b). A row opens the person (AP4) at /people/:ref.
 *
 * Every cell is its block's words: a failed block says "Unreadable", a value
 * no store holds says "Not recorded" with its reason, and neither is a zero.
 * Picking rows offers two acts: add them to the deck roster (hidden, so the
 * deck does not change until someone shows them) and export them.
 */

const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const SUB = 'text-[12px] leading-[1.45] text-axal-muted dark:text-gray-400';
const ERR = 'text-[12.5px] text-axal-destructive dark:text-red-400';
const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100';
const FIELD = 'min-h-[36px] rounded-[9px] border border-axal-hairline bg-white px-2.5 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const LINK = 'font-bold text-axal-ink underline-offset-2 hover:underline dark:text-gray-100';
const ALERT = 'flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-axal-destructive-edge bg-axal-destructive-tint px-3.5 py-3 text-[13px] text-axal-destructive dark:border-red-900 dark:bg-red-950/40 dark:text-red-300';

const COLUMNS = [
  ['firm', 'Firm'], ['skills', 'Skills'], ['stage', 'Stage'], ['profile', 'Profile check'], ['kyc', 'KYC'],
  ['host', 'Lab host'], ['sessions', 'Sessions, 90 days'], ['rating', 'Rating'], ['terms', 'Terms'], ['deck', 'Deck'], ['lastActive', 'Last active'],
];

function Value({ c }) {
  if (c.state === 'ready') return <span className={c.warn ? 'font-semibold text-axal-amber-deep dark:text-amber-300' : ''}>{c.text}</span>;
  return (
    <span className={c.state === 'unreadable' ? ERR : SUB} title={c.reason}>
      {c.text}<span className="sr-only">: {c.reason}</span>
    </span>
  );
}

/** The people read for the address's state. A 503 (a filter's source failed) is the whole list Unreadable. */
function usePeople(query) {
  const [read, setRead] = useState({ status: 'loading', data: null });
  const [tick, setTick] = useState(0);
  const sig = JSON.stringify(query);
  useEffect(() => {
    let live = true;
    setRead((r) => ({ status: 'loading', data: r.data }));
    adminNetworkApi.people(JSON.parse(sig)).then(
      (data) => { if (live) setRead({ status: 'ready', data }); },
      (e) => { reportError('advisors-partners:people', e); if (live) setRead({ status: 'error', data: null, reason: e?.data?.reason || null }); },
    );
    return () => { live = false; };
  }, [sig, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { read, reload };
}

/** Hand the browser the CSV (the pattern of `lib/csvExport.js`, with a BOM for Excel). */
function saveCsv(filename, body) {
  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') return false;
  const url = URL.createObjectURL(new Blob([`﻿${body}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click?.();
  a.remove?.();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}
const fileName = (now) => `advisors-partners-people-${new Date(now).toISOString().slice(0, 10)}.csv`;

/** AP3's bulk act: the picked people as hidden deck cards, after reading the roster for cards already linked. */
function BulkDeckDialog({ people, onClose, onDone }) {
  const [roster, setRoster] = useState({ status: 'loading', data: null });
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setRoster({ status: 'loading', data: null });
    Promise.all([adminNetworkProfiles.list({ limit: 500 }), adminNetworkProfiles.list({ state: 'archived', limit: 500 })]).then(
      ([a, b]) => { if (live) setRoster({ status: 'ready', data: [...(a?.profiles || []), ...(b?.profiles || [])] }); },
      (e) => { reportError('advisors-partners:people-roster', e); if (live) setRoster({ status: 'error', data: null }); },
    );
    return () => { live = false; };
  }, [tick]);
  const drafts = useMemo(() => (roster.status === 'ready' ? deckDrafts(people, roster.data) : []), [people, roster]);
  const adding = drafts.filter((d) => d.payload);

  async function save() {
    setBusy(true);
    const out = [];
    for (const d of adding) {
      try { await adminNetworkProfiles.create(d.payload); out.push({ ref: d.ref, name: d.name, ok: true }); } catch (e) {
        reportError('advisors-partners:people-add', e);
        out.push({ ref: d.ref, name: d.name, ok: false, why: e?.message || 'It could not be saved.' });
      }
    }
    setBusy(false);
    setResults(out);
    if (out.some((r) => r.ok)) onDone?.();
  }

  const footer = results ? (
    <button type="button" className={actionPrimary} onClick={onClose} data-testid="people-bulk-deck-close">Close</button>
  ) : (
    <>
      <button type="button" className={actionGhost} onClick={onClose} disabled={busy}>Cancel</button>
      <button type="button" className={actionPrimary} onClick={save} disabled={busy || roster.status !== 'ready' || !adding.length} data-testid="people-bulk-deck-save">
        {busy ? 'Adding…' : `Add ${adding.length} to the deck roster`}
      </button>
    </>
  );

  return (
    <Lightbox label="Add to the deck roster?" onClose={busy ? () => {} : onClose} title="Add to the deck roster?" width={560} footer={footer} testId="people-bulk-deck">
      <div className="flex flex-col gap-3 text-[13px] text-axal-ink dark:text-gray-100">
        <p className="m-0">Each person gets a deck card linked to their account, <strong>hidden</strong>: the next deck built does not change until someone shows them on Deck roster.</p>
        {roster.status === 'loading' ? <span className={SUB}>Reading the deck roster…</span> : null}
        {roster.status === 'error' ? (
          <div role="alert" className={ALERT} data-testid="people-bulk-deck-unreadable">
            <span>{UNREADABLE}. The deck roster could not be read, so who already has a card is unknown. Nothing is added.</span>
            <button type="button" className={actionGhost} onClick={() => setTick((t) => t + 1)}>Try again</button>
          </div>
        ) : null}
        {roster.status === 'ready' ? (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0" data-testid="people-bulk-deck-list">
            {drafts.map((d) => {
              const r = results?.find((x) => x.ref === d.ref);
              return (
                <li key={d.ref} className="flex flex-wrap justify-between gap-2" data-testid={`people-bulk-deck-${d.ref}`}>
                  <span className="font-semibold">{d.name || 'Name not recorded'}</span>
                  <span className={r && !r.ok ? ERR : SUB}>{r ? (r.ok ? 'Added, hidden.' : `Not added: ${r.why}`) : d.skip ? `Skipped: ${d.skip}` : 'Will be added, hidden.'}</span>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </Lightbox>
  );
}

function Toolbar({ state, filters, go }) {
  const [q, setQ] = useState(state.q);
  useEffect(() => setQ(state.q), [state.q]);
  const n = activeFilterCount(state);
  return (
    <div className="flex flex-col gap-2.5" data-testid="people-toolbar">
      <form role="search" className="flex flex-wrap items-center gap-2" data-testid="people-search-form"
        onSubmit={(e) => { e?.preventDefault?.(); go({ ...state, q: q.trim(), page: 1 }); }}>
        <label className="sr-only" htmlFor="people-search">Search people</label>
        <input id="people-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} maxLength={200}
          placeholder="Search by name, firm, skill or headline" className={`${FIELD} min-w-0 flex-1`} data-testid="people-search" />
        <button type="submit" className={actionGhost}>Search</button>
        <label className="sr-only" htmlFor="people-sort">Sort</label>
        <select id="people-sort" value={state.sort} onChange={(e) => go({ ...state, sort: e.target.value, page: 1 })} className={FIELD} data-testid="people-sort">
          {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </form>
      <div className="flex flex-wrap items-center gap-2" data-testid="people-filters">
        {FILTERS.map((f) => {
          const opts = filterOptions(f.key, filters);
          if (!opts.length && !state.filters[f.key]) return null;
          return (
            <label key={f.key} className="flex items-center gap-1.5">
              <span className={EYE}>{f.label}</span>
              <select value={state.filters[f.key] || ''} className={FIELD} data-testid={`people-filter-${f.key}`}
                onChange={(e) => {
                  const next = { ...state.filters };
                  if (e.target.value) next[f.key] = e.target.value; else delete next[f.key];
                  go({ ...state, filters: next, page: 1 });
                }}>
                <option value="">Any</option>
                {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          );
        })}
        {n ? <button type="button" className={actionGhost} onClick={() => go({ q: '', filters: {}, sort: state.sort, page: 1 })} data-testid="people-clear">Clear {n === 1 ? 'the filter' : `${n} filters`}</button> : null}
      </div>
    </div>
  );
}

export default function People() {
  const loc = useLocation();
  const navigate = useNavigate();
  const phone = usePhoneWidth();
  const [now] = useState(() => Date.now());
  const state = useMemo(() => stateOf(loc.search), [loc.search]);
  const query = useMemo(() => queryOf(state), [state]);
  const { read, reload } = usePeople(query);
  const [picked, setPicked] = useState(() => new Map());
  const [bulk, setBulk] = useState(false);
  const [note, setNote] = useState(null);
  const [exporting, setExporting] = useState(false);

  const tail = loc.pathname.replace(/\/+$/, '').slice(PEOPLE_PATH.length + 1);
  const openRef = tail ? decodeURIComponent(tail) : null;
  const go = useCallback((next) => navigate({ pathname: PEOPLE_PATH, search: searchOf(next) }), [navigate]);

  const data = read.data;
  const items = Array.isArray(data?.items) ? data.items : [];
  const rows = useMemo(() => items.map((p) => ({ p, r: rowOf(p, now) })), [items, now]);
  const offset = Number(data?.offset) || 0;
  const total = Number.isFinite(data?.total) ? data.total : null;

  const toggle = (p) => setPicked((m) => { const n = new Map(m); if (n.has(p.ref)) n.delete(p.ref); else n.set(p.ref, p); return n; });
  const pageAll = rows.length > 0 && rows.every(({ p }) => picked.has(p.ref));
  const togglePage = () => setPicked((m) => {
    const n = new Map(m);
    for (const { p } of rows) { if (pageAll) n.delete(p.ref); else n.set(p.ref, p); }
    return n;
  });

  /** Every person the current search and filters match, a hundred a call. Refuses an incomplete list. */
  async function exportAll() {
    setExporting(true);
    setNote(null);
    try {
      const all = [];
      for (let off = 0; ; off += EXPORT_PAGE) {
        const page = await adminNetworkApi.people({ ...queryOf(state, EXPORT_PAGE), offset: off });
        if (page?.available === false) { setNote({ bad: true, text: 'Not exported: some people could not be read, so the file would be incomplete. Try again.' }); return; }
        const got = Array.isArray(page?.items) ? page.items : [];
        all.push(...got);
        if (got.length < EXPORT_PAGE || (Number.isFinite(page?.total) && all.length >= page.total)) break;
      }
      saveCsv(fileName(now), csvOf(all, now));
      setNote({ text: `Exported ${all.length.toLocaleString('en-US')} ${all.length === 1 ? 'person' : 'people'}.` });
    } catch (e) {
      reportError('advisors-partners:people-export', e);
      setNote({ bad: true, text: 'Not exported: the list could not be read. Try again.' });
    } finally { setExporting(false); }
  }
  function exportPicked() {
    const list = [...picked.values()];
    saveCsv(fileName(now), csvOf(list, now));
    setNote({ text: `Exported ${list.length.toLocaleString('en-US')} picked ${list.length === 1 ? 'person' : 'people'}.` });
  }

  const empty = read.status === 'ready' && items.length === 0;
  const filtered = activeFilterCount(state) > 0;

  return (
    <section className={`${CARD} flex flex-col gap-3 px-[18px] py-4`} aria-labelledby="ap-h-people" data-testid="ap-people">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="ap-h-people" className={H2}>People</h2>
        <button type="button" className={actionGhost} onClick={exportAll} disabled={exporting || read.status !== 'ready' || data?.available === false || empty} data-testid="people-export">
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>
      <Toolbar state={state} filters={data?.filters} go={go} />
      {note ? <p role="status" className={`m-0 ${note.bad ? ERR : SUB}`} data-testid="people-note">{note.text}</p> : null}

      {picked.size ? (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-[10px] bg-axal-ground px-3 py-2 dark:bg-gray-800" data-testid="people-bulk">
          <span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{picked.size.toLocaleString('en-US')} picked</span>
          <button type="button" className={actionGhost} onClick={() => setBulk(true)} data-testid="people-bulk-deck-open">Add to deck roster</button>
          <button type="button" className={actionGhost} onClick={exportPicked} data-testid="people-bulk-export">Export</button>
          <button type="button" className={actionGhost} onClick={() => setPicked(new Map())} data-testid="people-bulk-clear">Clear</button>
        </div>
      ) : null}

      {read.status === 'loading' && !data ? <span className="font-mono text-[13px] text-axal-muted" data-testid="people-loading">Reading…</span> : null}
      {read.status === 'error' ? (
        <div role="alert" className={ALERT} data-testid="people-unreadable">
          <span>{UNREADABLE}. {read.reason || 'The people could not be read.'} Nothing here is a zero.</span>
          <button type="button" className={actionGhost} onClick={reload}>Try again</button>
        </div>
      ) : null}
      {read.status === 'ready' && data?.available === false ? (
        <div role="alert" className={ALERT} data-testid="people-incomplete">
          <span>Some people could not be read, so this list may be missing some and its total is unknown.</span>
          <button type="button" className={actionGhost} onClick={reload}>Try again</button>
        </div>
      ) : null}

      {empty && !filtered && offset === 0 ? (
        <div className="flex flex-col gap-2" data-testid="people-empty">
          <span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">No advisors or partners yet.</span>
          <span className={SUB}>People appear here when an account takes the Advisor or Partner role, or a name is added to the deck roster.</span>
          <span className="flex flex-wrap gap-2">
            <Link to="/admin/partner-invitations" className={actionGhost}>Invite a partner</Link>
            <Link to="/admin/advisors-partners/deck" className={actionGhost}>Open the deck roster</Link>
          </span>
        </div>
      ) : null}
      {empty && (filtered || offset > 0) ? (
        <div className="flex flex-col gap-2" data-testid="people-nomatch">
          <span className="text-[13px] text-axal-ink dark:text-gray-100">{state.q ? `No one matches ‘${state.q}’.` : offset > 0 ? 'No one on this page.' : 'No one matches these filters.'}</span>
          <button type="button" className={`${actionGhost} self-start`} onClick={() => go({ q: '', filters: {}, sort: state.sort, page: 1 })}>{state.q ? 'Clear the search' : 'Clear the filters'}</button>
        </div>
      ) : null}

      {rows.length && phone ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="people-cards">
          {rows.map(({ p, r }) => (
            <li key={p.ref} className="flex items-start gap-2.5 rounded-[10px] border border-axal-hairline px-3 py-2.5 dark:border-gray-700" data-testid={`people-card-${p.ref}`}>
              <input type="checkbox" checked={picked.has(p.ref)} onChange={() => toggle(p)} aria-label={`Pick ${r.name}`} className="mt-1 h-5 w-5" data-testid={`people-pick-${p.ref}`} />
              <Link to={`/admin/advisors-partners/people/${encodeURIComponent(p.ref)}${loc.search}`} className="flex min-w-0 flex-1 flex-col gap-0.5 text-[12.5px] text-axal-ink dark:text-gray-100">
                <span className="font-bold">{r.name}</span>
                <span className={SUB}>{r.kind} · <Value c={r.firm} /></span>
                <span><Value c={r.skills} /></span>
                <span className={SUB}>Sessions <Value c={r.sessions} /> · Rating <Value c={r.rating} /> · <Value c={r.lastActive} /></span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {rows.length && !phone ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] border-collapse text-left text-[12.5px] text-axal-ink dark:text-gray-100" data-testid="people-table">
            <thead>
              <tr className={EYE}>
                <th scope="col" className="w-8 py-1.5 pr-2">
                  <input type="checkbox" checked={pageAll} onChange={togglePage} aria-label="Pick everyone on this page" data-testid="people-pick-all" />
                </th>
                <th scope="col" className="py-1.5 pr-3 font-bold">Name</th>
                <th scope="col" className="py-1.5 pr-3 font-bold">Kind</th>
                {COLUMNS.map(([k, label]) => <th key={k} scope="col" className="py-1.5 pr-3 font-bold">{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ p, r }) => (
                <tr key={p.ref} className="border-t border-axal-hairline align-top dark:border-gray-700" data-testid={`people-row-${p.ref}`}>
                  <td className="py-2 pr-2">
                    <input type="checkbox" checked={picked.has(p.ref)} onChange={() => toggle(p)} aria-label={`Pick ${r.name}`} data-testid={`people-pick-${p.ref}`} />
                  </td>
                  <th scope="row" className="py-2 pr-3 font-normal">
                    <Link to={`/admin/advisors-partners/people/${encodeURIComponent(p.ref)}${loc.search}`} className={LINK} data-testid={`people-open-${p.ref}`}>{r.name}</Link>
                    {r.headline.state === 'ready' ? <span className={`block ${SUB}`}>{r.headline.text}</span> : null}
                  </th>
                  <td className="py-2 pr-3">{r.kind}</td>
                  {COLUMNS.map(([k]) => <td key={k} className="py-2 pr-3"><Value c={r[k]} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {read.status === 'ready' && (items.length || offset > 0) ? (
        <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-2">
          <span className={`${SUB} font-mono`} data-testid="people-pageline">{pageLine(offset, items.length, total)}</span>
          <span className="flex gap-2">
            <button type="button" className={actionGhost} disabled={state.page <= 1} onClick={() => go({ ...state, page: state.page - 1 })} data-testid="people-prev">Previous</button>
            <button type="button" className={actionGhost} disabled={items.length < PAGE_SIZE || (total != null && offset + items.length >= total)} onClick={() => go({ ...state, page: state.page + 1 })} data-testid="people-next">Next</button>
          </span>
        </nav>
      ) : null}

      {bulk ? (
        <BulkDeckDialog people={[...picked.values()]} onClose={() => setBulk(false)}
          onDone={() => { setNote({ text: 'Added to the deck roster, hidden until someone shows them on Deck roster.' }); reload(); }} />
      ) : null}
      {openRef ? (
        <PersonDrawer personRef={openRef} now={now} onChanged={reload}
          onClose={() => navigate({ pathname: PEOPLE_PATH, search: loc.search })} />
      ) : null}
    </section>
  );
}
