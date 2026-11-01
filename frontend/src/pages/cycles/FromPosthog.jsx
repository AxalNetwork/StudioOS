import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { posthogApi } from '../../lib/api/posthog';
import Lightbox from '../../ui/Lightbox';
import {
  DELETE_LINE, DISCONNECTED, NOT_LINKED, NOT_MINE, NO_METRICS, ROLE_CHIPS, TRACK_LINE, UNTRACK_LINE,
  asOfLine, matchInsights, metricRow, partState, refusalOf,
} from './fromPosthogModel';

/**
 * D1604 (#3731, #2409 part 2) — a module's "From PostHog" part, shared by every
 * module PostHog feeds (parts 3–6 mount it). It reads
 * `GET /api/cycles/:section/posthog?project&module` and draws:
 *   - the module's tracked metrics, each a figure "From PostHog, as of <date>"
 *     or a dash with its reason, never 0, with Stop tracking;
 *   - Track a metric (PH3): pick a saved insight, say what it measures and
 *     track it here, in an in-page dialog; nothing is sent before Track;
 *   - the module's other facts (`children` draws them when a part gives it)
 *     with Delete, asked first: a deleted figure stays deleted;
 *   - its pending proposals with Accept and Dismiss;
 *   - Sync from PostHog when the part passes `onSync` (parts 3–6);
 *   - the states (PH8): loading, unreadable with Try again, not linked,
 *     disconnected, and a refusal kept in its dialog.
 *
 * Only the member whose PostHog serves the venture tracks, syncs, accepts or
 * dismisses; the rest of the team reads. Built from #2409's PH1–PH10 brief:
 * no "Connector · PostHog" canvas has been drawn.
 */
export default function FromPosthog({ section, projectId, module, api = posthogApi, onSync = null, phone = false, children = null, renderProposal = null }) {
  const [read, setRead] = useState({ status: 'loading', data: null });
  const [round, setRound] = useState(0);
  const [note, setNote] = useState(null);
  const [tracking, setTracking] = useState(false);
  const [untracking, setUntracking] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [open, setOpen] = useState(!phone);
  useEffect(() => {
    let live = true;
    setRead((r) => ({ ...r, status: r.data ? 'refreshing' : 'loading' }));
    api.fromPosthog(section, projectId, module).then(
      (data) => { if (live) setRead({ status: 'ready', data }); },
      (e) => { if (live) setRead((r) => ({ status: r.data ? 'ready' : 'unreadable', data: r.data, error: refusalOf(e) })); },
    );
    return () => { live = false; };
  }, [api, section, projectId, module, round]);
  const again = useCallback(() => setRound((n) => n + 1), []);

  const d = read.data;
  const state = partState(d);
  const mine = !!d?.link?.mine;
  const tracked = Array.isArray(d?.tracked) ? d.tracked : [];
  const facts = Array.isArray(d?.facts) ? d.facts : [];
  const proposals = Array.isArray(d?.proposals) ? d.proposals : [];

  const decide = async (p, how) => {
    setBusy(p.id); setNote(null);
    try { await (how === 'accept' ? api.accept(section, projectId, p.id) : api.dismiss(section, projectId, p.id)); again(); } catch (e) { setNote(refusalOf(e)); }
    setBusy(null);
  };
  const sync = async () => {
    setSyncing(true); setNote(null);
    try { await onSync(); again(); } catch (e) { setNote(refusalOf(e)); }
    setSyncing(false);
  };

  const frame = (body) => (
    <section id="from-posthog" aria-labelledby="from-posthog-title" data-testid="cycle-part-posthog"
      className="flex min-w-0 scroll-mt-4 flex-col gap-3 rounded-xl border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-wrap items-baseline justify-between gap-2.5">
        <h2 id="from-posthog-title" className="m-0 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100">
          {phone ? <button type="button" className="text-left" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="posthog-toggle">From PostHog</button> : 'From PostHog'}
        </h2>
        {state === 'ready' && mine && (open || !phone) && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={GHOST} onClick={() => setTracking(true)} data-testid="posthog-track">Track a metric</button>
            {onSync && <button type="button" className={PRIMARY} onClick={sync} disabled={syncing} data-testid="posthog-sync">{syncing ? 'Syncing…' : 'Sync from PostHog'}</button>}
          </div>
        )}
      </div>
      {(open || !phone) && body}
      {tracking && <TrackMetric api={api} section={section} projectId={projectId} module={module} uid={d?.link?.uid} label={d?.label}
        onClose={() => setTracking(false)} onDone={() => { setTracking(false); again(); }} />}
      {untracking && (
        <Confirm title="Stop tracking this metric?" line={UNTRACK_LINE} name={untracking.name} action="Stop tracking" testId="posthog-untrack-dialog"
          onClose={() => setUntracking(null)} run={async () => { await api.untrack(section, projectId, untracking.uid); setUntracking(null); again(); }} />
      )}
      {deleting && (
        <Confirm title="Delete this figure?" line={DELETE_LINE} name={deleting.label || 'This figure'} action="Delete" testId="posthog-delete-dialog" danger
          onClose={() => setDeleting(null)} run={async () => { await api.deleteFact(section, projectId, deleting.id); setDeleting(null); again(); }} />
      )}
    </section>
  );

  if (read.status === 'loading') return frame(<div className="h-2 w-40 animate-pulse rounded bg-axal-hairline dark:bg-gray-800" role="status" aria-label="Reading PostHog" data-testid="posthog-loading" />);
  if (read.status === 'unreadable') {
    return frame(
      <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" role="alert" data-testid="posthog-unreadable">
        {read.error && read.error !== 'PostHog could not be read. Try again.' ? read.error : 'Unreadable.'}{' '}
        <button type="button" className={LINK} onClick={again} data-testid="posthog-retry">Try again</button>
      </p>,
    );
  }
  if (state === 'not_linked') {
    return frame(
      <div className="flex flex-col items-start gap-1" data-testid="posthog-no-project">
        <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100">{NOT_LINKED}</p>
        <Link to="/account/connectors/posthog" className={LINK} data-testid="posthog-choose-project">Choose a project ›</Link>
      </div>,
    );
  }

  return frame(
    <div className="flex flex-col gap-3">
      {state === 'disconnected' && <p className={WARN} role="status" data-testid="posthog-disconnected">{DISCONNECTED}</p>}
      {note && <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" role="alert" data-testid="posthog-note">{note}</p>}
      {tracked.length === 0
        ? <p className={MUTED} data-testid="posthog-no-metrics">{NO_METRICS}{!mine ? ` ${NOT_MINE}` : ''}</p>
        : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="posthog-metrics">
            {tracked.map((t) => {
              const r = metricRow(t);
              return (
                <li key={t.uid} className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-axal-hairline px-3 py-2 dark:border-gray-800" data-testid="posthog-metric">
                  <div className="flex min-w-0 flex-col">
                    <span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{r.name}</span>
                    {r.role && <span className="font-mono text-[10.5px] uppercase tracking-axal-label text-axal-muted dark:text-gray-400">{r.role}</span>}
                  </div>
                  <div className="flex flex-col items-end">
                    {r.figure
                      ? <span className="font-mono text-[15px] font-bold tabular-nums text-axal-ink dark:text-gray-100" data-testid="posthog-figure">{r.figure}</span>
                      : <span className="text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="posthog-reason">— {r.reason}</span>}
                    {r.change && <span className="font-mono text-[11px] tabular-nums text-axal-muted dark:text-gray-400">{r.change}</span>}
                    {r.source && <span className="text-[11px] text-axal-muted dark:text-gray-400" data-testid="posthog-source">{r.source}</span>}
                  </div>
                  {mine && <button type="button" className={LINK} onClick={() => setUntracking({ uid: t.uid, name: r.name })} data-testid="posthog-untrack">Stop tracking</button>}
                </li>
              );
            })}
          </ul>
        )}
      {children ? children({ facts, onDelete: (f) => setDeleting(f) }) : facts.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="posthog-facts">
          {facts.map((f) => (
            <li key={f.id} className="flex flex-wrap items-baseline justify-between gap-2 text-[12.5px]" data-testid="posthog-fact">
              <span className="text-axal-ink dark:text-gray-100">{f.label || f.fact_key}</span>
              <span className="text-axal-muted dark:text-gray-400">{f.value != null ? f.value : '—'} · {asOfLine(f.as_of)}</span>
              <button type="button" className={LINK} onClick={() => setDeleting(f)} data-testid="posthog-fact-delete">Delete</button>
            </li>
          ))}
        </ul>
      )}
      {proposals.length > 0 && (
        <div className="flex flex-col gap-2" data-testid="posthog-proposals">
          {proposals.map((p) => (
            <div key={p.id} className="flex flex-col gap-1 rounded-lg border border-axal-lavender-edge bg-axal-lavender px-3 py-2 dark:border-violet-900 dark:bg-violet-950/30" data-testid="posthog-proposal">
              {renderProposal ? renderProposal(p) : <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100">{String(p.payload?.title || 'From PostHog')}</p>}
              {mine && (
                <div className="flex flex-wrap gap-2 max-sm:flex-col">
                  <button type="button" className={PRIMARY} disabled={busy === p.id} onClick={() => decide(p, 'accept')} data-testid="posthog-accept">Accept</button>
                  <button type="button" className={GHOST} disabled={busy === p.id} onClick={() => decide(p, 'dismiss')} data-testid="posthog-dismiss">Dismiss</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>,
  );
}

/** PH3: pick a saved insight, then what it measures. Nothing is sent before Track. */
function TrackMetric({ api, section, projectId, module, uid, label, onClose, onDone }) {
  const [list, setList] = useState({ status: 'loading', items: [] });
  const [q, setQ] = useState('');
  const [insight, setInsight] = useState(null);
  const [role, setRole] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    setList({ status: 'loading', items: [] });
    api.insights(uid, projectId).then(
      (r) => { if (live) setList({ status: 'ready', items: Array.isArray(r?.insights) ? r.insights : [] }); },
      (e) => { if (live) setList({ status: 'unreadable', items: [], error: refusalOf(e) }); },
    );
    return () => { live = false; };
  }, [api, uid, projectId, round]);
  const shown = matchInsights(list.items, q);
  const go = async () => {
    setBusy(true); setError(null);
    try { await api.track(section, projectId, module, insight.short_id, role); onDone(); } catch (e) { setError(refusalOf(e, 'The metric could not be tracked. Try again.')); setBusy(false); }
  };
  return (
    <Lightbox label="Track a metric" title="Track a metric" onClose={onClose} width={520} testId="posthog-track-dialog" phone="sheet"
      footer={(
        <div className="flex justify-end gap-2 max-sm:flex-col">
          <button type="button" className={GHOST} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={PRIMARY} onClick={go} disabled={busy || !insight || !role} data-testid="posthog-track-save">{busy ? 'Tracking…' : `Track in ${label || 'this module'}`}</button>
        </div>
      )}>
      <div className="flex flex-col gap-3 text-[13px] text-axal-ink dark:text-gray-200">
        <p className={MUTED}>{TRACK_LINE}</p>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10.5px] uppercase tracking-axal-label text-axal-muted dark:text-gray-400">1 · Saved insight</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your saved insights" data-testid="posthog-insight-search"
            className="rounded-[7px] border border-axal-hairline bg-white px-3 py-2 text-[13px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" />
        </label>
        {list.status === 'loading' && <div className="h-2 w-40 animate-pulse rounded bg-axal-hairline dark:bg-gray-800" role="status" aria-label="Reading your insights" />}
        {list.status === 'unreadable' && (
          <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" role="alert" data-testid="posthog-insights-unreadable">
            {list.error} <button type="button" className={LINK} onClick={() => setRound((n) => n + 1)}>Try again</button>
          </p>
        )}
        {list.status === 'ready' && shown.length === 0 && <p className={MUTED} data-testid="posthog-insights-none">{q ? 'No saved insight matches.' : 'This PostHog project has no saved insight yet. Save one in PostHog, then try again.'}</p>}
        {list.status === 'ready' && shown.length > 0 && (
          <div role="radiogroup" aria-label="Saved insights" className="flex max-h-56 flex-col gap-1 overflow-y-auto">
            {shown.map((i) => (
              <label key={i.short_id} className="flex cursor-pointer items-center gap-2 rounded-[7px] px-2 py-1.5 hover:bg-axal-lavender dark:hover:bg-violet-950/30">
                <input type="radio" name="posthog-insight" checked={insight?.short_id === i.short_id} onChange={() => setInsight(i)} data-testid="posthog-insight" value={i.short_id} />
                <span className="min-w-0 flex-1 truncate">{i.name || i.short_id}</span>
                {i.kind && <span className="rounded-full border border-axal-hairline px-2 py-0.5 font-mono text-[10px] dark:border-gray-700">{String(i.kind).replace(/Query$/, '')}</span>}
                {i.last_refresh && <span className="font-mono text-[10.5px] text-axal-muted dark:text-gray-400">{String(i.last_refresh).slice(0, 10)}</span>}
              </label>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10.5px] uppercase tracking-axal-label text-axal-muted dark:text-gray-400">2 · What it measures</span>
          <div className="flex flex-wrap gap-[7px]" role="radiogroup" aria-label="What it measures">
            {ROLE_CHIPS.map(([key, words]) => (
              <button key={key} type="button" role="radio" aria-checked={role === key} onClick={() => setRole(key)} data-testid="posthog-role"
                data-role={key} className={`rounded-full border px-3 py-1 text-[12px] font-semibold max-sm:min-h-[44px] ${role === key ? 'border-axal-violet bg-axal-violet text-white' : 'border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100'}`}>{words}</button>
            ))}
          </div>
        </div>
        {error && <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" role="alert" data-testid="posthog-track-error">{error}</p>}
      </div>
    </Lightbox>
  );
}

/** An in-page dialog that says what a change does; a refusal stays in it. */
function Confirm({ title, line, name, action, testId, danger = false, onClose, run }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const go = async () => {
    setBusy(true); setError(null);
    try { await run(); } catch (e) { setError(refusalOf(e, 'That could not be saved. Try again.')); setBusy(false); }
  };
  return (
    <Lightbox label={title} title={title} onClose={onClose} width={440} testId={testId} phone="sheet"
      footer={(
        <div className="flex justify-end gap-2 max-sm:flex-col">
          <button type="button" className={GHOST} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={danger ? DANGER : PRIMARY} onClick={go} disabled={busy} data-testid={`${testId}-confirm`}>{busy ? 'Saving…' : action}</button>
        </div>
      )}>
      <div className="flex flex-col gap-2 text-[13px] text-axal-ink dark:text-gray-200">
        <p className="m-0">“{name}”. {line}</p>
        {error && <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" role="alert" data-testid={`${testId}-error`}>{error}</p>}
      </div>
    </Lightbox>
  );
}

const MUTED = 'm-0 text-[12px] text-axal-muted dark:text-gray-400';
const LINK = 'text-[12.5px] font-semibold text-axal-violet-deep underline-offset-2 hover:underline disabled:opacity-50 dark:text-violet-300 dark:hover:underline';
const PRIMARY = 'inline-flex items-center justify-center rounded-axal-sm bg-axal-violet px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-axal-violet-deep disabled:opacity-50 dark:hover:bg-violet-500 max-sm:min-h-[44px]';
const GHOST = 'inline-flex items-center justify-center rounded-axal-sm border border-axal-hairline bg-white px-3 py-1.5 text-[12.5px] font-semibold text-axal-ink hover:border-axal-violet/40 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:border-violet-400/40 max-sm:min-h-[44px]';
const DANGER = 'inline-flex items-center justify-center rounded-axal-sm bg-red-600 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-red-700 disabled:opacity-50 dark:hover:bg-red-500 max-sm:min-h-[44px]';
const WARN = 'm-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100';
