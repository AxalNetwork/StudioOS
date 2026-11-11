import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Sheet, Unreadable } from '../../../ui';
import StatusBadge from './StatusBadge.jsx';
import SourceAvailability from './SourceAvailability.jsx';
import { SOURCE_LABELS } from './overviewModel.js';
import {
  DATE_RANGES, OUTCOME_OPTIONS, SOURCE_SHORT, activeCount, actorOptions, byDay, eventLabel, feedQuery,
  mergePages, olderThanLine, outcomeState, timeOf,
} from './eventsModel.js';

/**
 * D4803 (#4803, canvas SE03a workspace, SE03b event drawer, SE11b phone,
 * SE10b to SE10d states) — the Events workspace: the merged security ledger
 * as an investigation surface.
 *
 *   triage       quick categories and the filter bar (search, date range,
 *                actor, outcome, source); branch is shown, disabled, because
 *                only licence and security events record one
 *   investigation newest-first rows grouped by UTC day, the human label over
 *                the stored action, Load older on the server's cursor
 *   explanation  the event drawer: what happened, who and where, the raw row
 *                behind a disclosure, copy buttons; how the ledger is
 *                measured sits behind its own disclosure
 *
 * EVERY FILTER IS THE SERVER'S. The ledger is a merged page across five
 * stores, so a filter applied to the rows in the browser would show whichever
 * few matched and read as the whole answer. The bar sends its values to
 * `/governance`, and Load older carries them (SE03a's "keeps your filters").
 *
 * EMPTY IS NOT UNREADABLE. "No event matches" is drawn only when every store
 * the filters read answered; a store that could not be read is named above
 * the list with Retry, and the list says it may be incomplete (SE10c).
 */

const BTN = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-axal-hairline bg-white px-3 text-[12.5px] font-semibold text-axal-ink hover:bg-axal-ground disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-[34px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const FIELD = 'min-h-[44px] rounded-lg border border-axal-hairline bg-white px-2.5 text-[12.5px] text-axal-ink sm:min-h-[34px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';

/** The six quick categories, the server's order; the fallback before the first read. */
export const QUICK_CATEGORIES = Object.freeze([
  { key: 'all', label: 'All actions' },
  { key: 'impersonations', label: 'Impersonations' },
  { key: 'licence_changes', label: 'Licence changes' },
  { key: 'suspensions', label: 'Suspensions' },
  { key: 'exports', label: 'Exports' },
  { key: 'auth', label: 'Sign-ins and step-ups' },
]);

function Actor({ identity, fallback }) {
  if (!identity) return <span>{fallback || 'Unnamed'}</span>;
  const behalf = identity.kind === 'support' && identity.on_behalf_of ? ` for ${identity.on_behalf_of.label}` : '';
  return (
    <span data-identity-kind={identity.kind}>
      {identity.label}{behalf}
      {identity.kind !== 'user' && <small className="ml-1 text-[10.5px] text-axal-faint dark:text-gray-400">({identity.kind === 'network' ? 'network' : identity.kind})</small>}
    </span>
  );
}

function Scope({ row }) {
  return row.tenant
    ? <span>{row.tenant}</span>
    : <span className="text-axal-faint dark:text-gray-400" title="This store does not record a branch">Not recorded</span>;
}

function Outcome({ row }) {
  const o = outcomeState(row);
  return <StatusBadge state={o.state} label={o.word} />;
}

/** The bar: search, date range, actor, outcome, source, and the branch the ledger cannot filter on. */
export function EventFilters({ controls, setControls, actors, onApply, phone = false }) {
  const [q, setQ] = useState(controls.q || '');
  useEffect(() => { setQ(controls.q || ''); }, [controls.q]);
  const set = (patch) => setControls({ ...controls, ...patch });
  return (
    <form
      className={phone ? 'flex flex-col gap-2' : 'flex flex-wrap items-end gap-2'}
      role="search"
      aria-label="Filter events"
      onSubmit={(e) => { e.preventDefault?.(); set({ q }); onApply?.(); }}
      data-testid="events-filters"
    >
      <label className="flex min-w-[220px] flex-1 flex-col gap-0.5 text-[11px] font-semibold text-axal-muted dark:text-gray-400">
        Search
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search actor, event or ID"
          maxLength={100}
          className={FIELD}
          data-testid="events-search"
        />
      </label>
      <label className="flex flex-col gap-0.5 text-[11px] font-semibold text-axal-muted dark:text-gray-400">
        Date range
        <select value={controls.range} onChange={(e) => set({ range: e.target.value })} className={FIELD} data-testid="events-range">
          {DATE_RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
      </label>
      {controls.range === 'custom' && (
        <>
          <label className="flex flex-col gap-0.5 text-[11px] font-semibold text-axal-muted dark:text-gray-400">
            From (UTC)
            <input type="date" value={controls.custom?.from || ''} onChange={(e) => set({ custom: { ...controls.custom, from: e.target.value } })} className={FIELD} />
          </label>
          <label className="flex flex-col gap-0.5 text-[11px] font-semibold text-axal-muted dark:text-gray-400">
            To (UTC)
            <input type="date" value={controls.custom?.to || ''} onChange={(e) => set({ custom: { ...controls.custom, to: e.target.value } })} className={FIELD} />
          </label>
        </>
      )}
      <label className="flex flex-col gap-0.5 text-[11px] font-semibold text-axal-muted dark:text-gray-400">
        Actor
        <select value={controls.actor || ''} onChange={(e) => set({ actor: e.target.value })} className={FIELD} data-testid="events-actor">
          <option value="">Anyone</option>
          {actors.map((a) => <option key={a.id} value={String(a.id)}>{a.label}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-0.5 text-[11px] font-semibold text-axal-muted dark:text-gray-400">
        Outcome
        <select value={controls.outcome || ''} onChange={(e) => set({ outcome: e.target.value })} className={FIELD} data-testid="events-outcome">
          {OUTCOME_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-0.5 text-[11px] font-semibold text-axal-muted dark:text-gray-400">
        Source
        <select value={controls.source || ''} onChange={(e) => set({ source: e.target.value })} className={FIELD} data-testid="events-source">
          <option value="">All 5 sources</option>
          {Object.keys(SOURCE_SHORT).map((k) => <option key={k} value={k}>{SOURCE_LABELS[k] || k}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-0.5 text-[11px] font-semibold text-axal-muted dark:text-gray-400">
        Branch
        <select disabled aria-describedby="events-branch-why" className={FIELD} data-testid="events-branch">
          <option>Not offered</option>
        </select>
        <span id="events-branch-why" className="max-w-[180px] text-[10.5px] font-normal text-axal-faint dark:text-gray-400">
          Only licence and security events record a branch.
        </span>
      </label>
      <button type="submit" className={BTN} data-testid="events-apply">Search</button>
    </form>
  );
}

/** SE03b — one event in full. Read-only: nothing here can change the ledger. */
export function EventDrawer({ row, onClose, onActor }) {
  const [copied, setCopied] = useState(null);
  const [rawOpen, setRawOpen] = useState(false);
  const { label, raw } = eventLabel(row);
  const json = JSON.stringify(row, null, 2);
  const copy = async (what, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      setCopied('none');
    }
  };
  const id = row.actor_identity?.user_id;
  const outcome = outcomeState(row);
  const said = row.outcome === 'refused'
    ? 'It was refused. Nothing was changed.'
    : row.source === 'security_events'
      ? 'It was allowed.'
      : row.source === 'impersonation_sessions'
        ? `The support session is ${outcome.word.toLowerCase()}.`
        : 'The store writes its row after the act, so the act happened.';
  return (
    <Sheet label="Event detail" eyebrow={`Event · ${SOURCE_SHORT[row.source] || row.source}`} title={label} onClose={onClose} width={560} testId="event-drawer">
      <div className="flex flex-col gap-4 text-[13px]">
        <div className="flex flex-wrap items-center gap-2">
          <Outcome row={row} />
          <span className="text-axal-muted dark:text-gray-300">{row.at ? `${String(row.at).slice(0, 19).replace('T', ' ')} UTC` : 'No timestamp recorded'}</span>
        </div>
        <section aria-labelledby="ev-what">
          <h3 id="ev-what" className="text-[12px] font-extrabold uppercase tracking-[.06em] text-axal-faint dark:text-gray-400">What happened</h3>
          <p className="mt-1 leading-relaxed text-axal-ink dark:text-gray-100" data-testid="event-what">
            {row.actor_identity?.label || row.actor || 'An unnamed actor'}: {label.toLowerCase()}. {row.target ? `${row.target}. ` : ''}{said}
          </p>
        </section>
        <section aria-labelledby="ev-who">
          <h3 id="ev-who" className="text-[12px] font-extrabold uppercase tracking-[.06em] text-axal-faint dark:text-gray-400">Who and where</h3>
          <dl className="mt-1 grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1">
            <dt className="text-axal-muted dark:text-gray-400">Actor</dt><dd><Actor identity={row.actor_identity} fallback={row.actor} /></dd>
            <dt className="text-axal-muted dark:text-gray-400">Scope</dt><dd><Scope row={row} /></dd>
            <dt className="text-axal-muted dark:text-gray-400">Source</dt><dd>{SOURCE_LABELS[row.source] || row.source}</dd>
            <dt className="text-axal-muted dark:text-gray-400">Recorded as</dt><dd className="break-all font-mono text-[12px]">{raw}</dd>
          </dl>
          {id && onActor && (
            <button type="button" className={`${BTN} mt-2`} onClick={() => onActor(id)} data-testid="event-actor-filter">
              All events for this actor →
            </button>
          )}
        </section>
        <section>
          <button type="button" className={BTN} aria-expanded={rawOpen} aria-controls="ev-raw" onClick={() => setRawOpen((v) => !v)} data-testid="event-raw-toggle">
            Raw event {rawOpen ? '▴' : '▾'}
          </button>
          {rawOpen && (
            <pre id="ev-raw" className="mt-2 max-h-72 overflow-auto rounded-lg border border-axal-hairline bg-axal-ground p-3 font-mono text-[11px] leading-relaxed dark:border-gray-700 dark:bg-gray-950" data-testid="event-raw">{json}</pre>
          )}
        </section>
        <div className="flex flex-wrap items-center gap-2 border-t border-axal-hairline pt-3 dark:border-gray-800">
          <button type="button" className={BTN} onClick={() => copy('id', row.key)}>Copy event ID</button>
          <button type="button" className={BTN} onClick={() => copy('json', json)}>Copy raw JSON</button>
          <span role="status" className="text-[11.5px] text-axal-faint dark:text-gray-400">
            {copied === 'id' ? 'Event ID copied.' : copied === 'json' ? 'Raw JSON copied.' : copied === 'none' ? 'Copying is not available in this browser.' : ''}
          </span>
        </div>
        <p className="text-[11.5px] text-axal-faint dark:text-gray-400">Read-only. The ledger cannot be edited from here.</p>
      </div>
    </Sheet>
  );
}

/**
 * The workspace. `feed` is the first page (null while reading, `unavailable`
 * when the read failed); `loadOlder(before)` resolves to the next page under
 * the same category and filters.
 */
export default function EventsWorkspace({
  feed, unavailable, filter, setFilter, controls, setControls, onRetry, loadOlder, se, now = Date.now(), categories,
}) {
  const ready = feed && feed !== unavailable;
  const [older, setOlder] = useState([]);
  const [olderState, setOlderState] = useState(() => ({
    cursor: ready ? feed.cursor || null : null, busy: false, failed: false, split: Boolean(ready && feed.page_split_second),
  }));
  const [open, setOpen] = useState(null);
  const [sheet, setSheet] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const opener = useRef(null);

  // D4699 — the first page Load older belongs to. A page that answers after the list changed
  // (a new filter, a retry) is dropped: it belongs to the old list, not this one.
  const listOf = useRef(feed);
  // A new first page is a new list: what Load older appended belongs to the old one.
  useEffect(() => {
    listOf.current = feed;
    setOlder([]);
    setOlderState({ cursor: ready ? feed.cursor || null : null, busy: false, failed: false, split: Boolean(ready && feed.page_split_second) });
  }, [feed]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => (ready ? mergePages(feed.rows, ...older) : []), [ready, feed, older]);
  const groups = useMemo(() => byDay(rows, now), [rows, now]);
  const actors = useMemo(() => {
    const list = actorOptions(rows);
    const want = controls.actor ? Number(controls.actor) : null;
    return want && !list.some((a) => a.id === want) ? [...list, { id: want, label: `account ${want}` }] : list;
  }, [rows, controls.actor]);
  const query = feedQuery(controls, now);
  const narrowed = activeCount(query);
  const cats = (ready && feed.filters) || categories || QUICK_CATEGORIES;
  const sources = ready
    ? { state: 'ready', read: feed.sources.filter((s) => s.available).length, total: feed.sources.length, rows: feed.sources }
    : { state: feed === unavailable ? 'unreadable' : 'reading', read: 0, total: 0, rows: [] };
  const failedSources = ready ? feed.sources.filter((s) => !s.available) : [];

  const more = async () => {
    if (!olderState.cursor || olderState.busy) return;
    const list = feed;
    setOlderState((s) => ({ ...s, busy: true, failed: false }));
    try {
      const page = await loadOlder(olderState.cursor.before);
      if (listOf.current !== list) return;
      setOlder((cur) => [...cur, page.rows || []]);
      setOlderState({ cursor: page.cursor || null, busy: false, failed: false, split: Boolean(page.page_split_second) });
    } catch {
      if (listOf.current !== list) return;
      setOlderState((s) => ({ ...s, busy: false, failed: true }));
    }
  };
  const show = (row, e) => { opener.current = e?.currentTarget || null; setOpen(row); };
  const close = () => { setOpen(null); opener.current?.focus?.(); };

  const lastAt = rows.length ? rows[rows.length - 1].at : null;
  const caption = ready
    ? `Newest first · ${rows.length} loaded${olderState.cursor ? ' · older events held' : ''} · times in UTC`
    : 'Newest first · times in UTC';

  return (
    <div className="flex flex-col gap-4" data-testid="events-workspace">
      <div className="flex flex-col gap-1">
        <h2 className="text-[18px] font-extrabold tracking-tight text-axal-ink dark:text-white">Events</h2>
        <p className="text-[12.5px] text-axal-muted dark:text-gray-300">Investigate activity across security and administrative sources.</p>
      </div>

      <div className="hidden md:block">
        <EventFilters controls={controls} setControls={setControls} actors={actors} />
      </div>
      <div className="flex flex-col gap-2 md:hidden">
        <button type="button" className={BTN} aria-expanded={sheet} aria-controls="events-phone-filters" onClick={() => setSheet((v) => !v)} data-testid="events-phone-filters-toggle">
          Filters{narrowed ? ` · ${narrowed}` : ''} {sheet ? '▴' : '▾'}
        </button>
        {sheet && (
          <div id="events-phone-filters" className={`${CARD} p-3`}>
            <EventFilters controls={controls} setControls={setControls} actors={actors} onApply={() => setSheet(false)} phone />
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Quick categories" data-testid="hq-gov-filters">
        {cats.map((f) => (
          <button
            key={f.key}
            type="button"
            role="radio"
            aria-checked={filter === f.key}
            onClick={() => setFilter(f.key)}
            title={f.reads ? `reads ${f.reads}` : undefined}
            className={`min-h-[44px] rounded-full border px-3 text-[12px] font-semibold sm:min-h-[32px] ${
              filter === f.key
                ? 'border-axal-ink bg-axal-ink text-white dark:border-white dark:bg-white dark:text-gray-900'
                : 'border-axal-hairline bg-white text-axal-muted hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800'
            }`}
          >
            {f.label}
          </button>
        ))}
        {narrowed > 0 && (
          <button type="button" className={BTN} onClick={() => setControls({ q: '', range: 'any', custom: {}, actor: '', outcome: '', source: '' })} data-testid="events-clear">
            Clear filters
          </button>
        )}
      </div>

      <SourceAvailability sources={sources} onRetry={onRetry} data-testid="hq-gov-sources" />

      {failedSources.length > 0 && (
        <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200" data-testid="events-partial">
          <b>{failedSources.map((s) => SOURCE_LABELS[s.table] || s.table).join(', ')} could not be read.</b> Events from {failedSources.length === 1 ? 'that source' : 'those sources'} may be missing from this list.
        </div>
      )}

      {feed === unavailable && (
        <Unreadable what="The security ledger" claim="This is not a claim that nobody did anything." onRetry={onRetry} />
      )}
      {feed === null && <p className="text-[12.5px] text-axal-faint dark:text-gray-400" aria-busy="true">Reading the sources…</p>}

      {ready && rows.length === 0 && failedSources.length === 0 && (
        <div className={`${CARD} flex items-start gap-3 p-4`} data-testid="hq-gov-empty">
          <StatusBadge state="measured_zero" label="No events" />
          <p className="text-[12.5px] text-axal-muted dark:text-gray-300">
            No event matches {narrowed || filter !== 'all' ? 'these filters' : 'the ledger'}. Every source was read; this is a real zero.
          </p>
        </div>
      )}

      {ready && rows.length > 0 && (
        <>
          <div className={`${CARD} hidden overflow-hidden md:block`}>
            <table className="w-full text-left text-[12.5px]" data-testid="hq-gov-feed">
              <caption className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[.06em] text-axal-faint dark:text-gray-400">{caption}</caption>
              <thead>
                <tr className="border-b border-axal-hairline text-[11px] text-axal-muted dark:border-gray-800 dark:text-gray-400">
                  <th scope="col" className="px-3 py-2 font-semibold">Time</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Actor</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Scope</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Event</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Outcome</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Source</th>
                </tr>
              </thead>
              {groups.map((g) => (
                <tbody key={g.day}>
                  <tr className="bg-axal-ground dark:bg-gray-950">
                    <th colSpan={6} scope="colgroup" className="px-3 py-1.5 text-[11px] font-bold text-axal-muted dark:text-gray-300">{g.day}</th>
                  </tr>
                  {g.rows.map((r) => {
                    const { label, raw } = eventLabel(r);
                    return (
                      <tr key={r.key} className="border-t border-axal-hairline align-top dark:border-gray-800" data-testid={`event-row-${r.key}`}>
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-[11.5px] text-axal-muted dark:text-gray-300">{timeOf(r.at) || 'No time'}</td>
                        <td className="px-3 py-2"><Actor identity={r.actor_identity} fallback={r.actor} /></td>
                        <td className="px-3 py-2"><Scope row={r} /></td>
                        <td className="px-3 py-2">
                          <button type="button" onClick={(e) => show(r, e)} className="text-left font-semibold text-axal-ink underline-offset-2 hover:underline dark:text-white" data-testid="event-open">
                            {label}
                          </button>
                          <small className="block break-all font-mono text-[10.5px] text-axal-faint dark:text-gray-400">{raw}</small>
                        </td>
                        <td className="px-3 py-2"><Outcome row={r} /></td>
                        <td className="whitespace-nowrap px-3 py-2 text-[11.5px] text-axal-muted dark:text-gray-300">{SOURCE_SHORT[r.source] || r.source}</td>
                      </tr>
                    );
                  })}
                </tbody>
              ))}
            </table>
          </div>

          <ol className="flex flex-col gap-2 md:hidden" aria-label={caption} data-testid="events-cards">
            {rows.map((r) => {
              const { label } = eventLabel(r);
              return (
                <li key={r.key} className={`${CARD} p-3`}>
                  <button type="button" onClick={(e) => show(r, e)} className="flex w-full min-h-[44px] flex-col gap-1 text-left">
                    <span className="flex w-full items-start justify-between gap-2">
                      <b className="text-[13px] text-axal-ink dark:text-white">{label}</b>
                      <Outcome row={r} />
                    </span>
                    <small className="text-[11.5px] text-axal-muted dark:text-gray-300">
                      {timeOf(r.at) || 'No time'} · {r.actor_identity?.label || r.actor || 'Unnamed'} · {r.tenant || 'Branch not recorded'}
                    </small>
                  </button>
                </li>
              );
            })}
          </ol>
        </>
      )}

      {ready && (
        <div className="flex flex-col items-start gap-1" data-testid="events-older">
          {olderState.cursor ? (
            <>
              <button type="button" className={BTN} onClick={more} disabled={olderState.busy} data-testid="events-load-older">
                {olderState.busy ? 'Loading older events…' : 'Load older events'}
              </button>
              <small className="text-[11.5px] text-axal-faint dark:text-gray-400">
                Older than {olderThanLine(lastAt) || 'the last row'} · keeps your filters
              </small>
            </>
          ) : rows.length > 0 && (
            <small className="text-[11.5px] text-axal-faint dark:text-gray-400" data-testid="events-end">
              That is every event the sources hold{narrowed || filter !== 'all' ? ' for these filters' : ''}.
            </small>
          )}
          {olderState.failed && (
            <p role="alert" className="text-[12px] text-red-700 dark:text-red-300">Older events could not be read. The rows above are unchanged; try again.</p>
          )}
          {olderState.split && (
            <p className="text-[11.5px] text-axal-faint dark:text-gray-400" data-testid="events-split-second">
              Every row on the last page shares one second, so the next page starts after it; rows in that second beyond these may not be shown.
            </p>
          )}
        </div>
      )}

      {ready && (
        <div className={`${CARD} p-3`}>
          <button type="button" className={BTN} aria-expanded={howOpen} aria-controls="events-how" onClick={() => setHowOpen((v) => !v)} data-testid="events-how-toggle">
            How this is measured {howOpen ? '▴' : '▾'}
          </button>
          {howOpen && (
            <div id="events-how" className="mt-3 flex flex-col gap-2 text-[11.5px] leading-relaxed text-axal-muted dark:text-gray-300">
              <p data-testid="hq-gov-tenant-reason"><b>Branch.</b> {feed.tenant_reason}</p>
              <p>
                Each store answers with its own newest rows under the filters, and the list keeps the newest of the merge,
                so no row that belongs on a page is left behind. A refusal is one row per minute per address and network,
                carrying the first reason in that minute. Whether an HQ act landed on its branch is on Platform → Deployments.
              </p>
              <p data-testid="hq-gov-tenant-view"><b>Viewing as a branch.</b> {feed.tenant_view_reason}</p>
              {(se?.not_counted || []).length > 0 && (
                <ul className="space-y-1" data-testid="hq-security-events-not-counted">
                  {se.not_counted.map((n) => (
                    <li key={n.what}><b>{n.what}</b>: not recorded. {n.reason}</li>
                  ))}
                </ul>
              )}
              {se?.available && (
                <p data-testid="hq-security-events-retention">
                  Kept for {se.retention_days} days, and the ledger&apos;s own seal refuses any delete inside that window.
                </p>
              )}
              {se && !se.available && (
                <p data-testid="hq-security-events-unreadable">
                  The ledger&apos;s counts could not be read: {se.reason} The list above still shows what the other stores hold.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {open && (
        <EventDrawer
          row={open}
          onClose={close}
          onActor={(id) => { setControls({ ...controls, actor: String(id) }); close(); }}
        />
      )}
    </div>
  );
}
