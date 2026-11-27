import { useState } from 'react';
import { Link } from 'react-router-dom';
import { cyclesWrite } from '../../lib/api/cycles';
import { connectorsApi } from '../../lib/api/connectors';
import { Lightbox, actionGhost, actionPrimary } from '../../ui';

/**
 * D1097 (#2962, Vercel part 2) — Operating systems' Hosting block
 * (`id="from-vercel"`), from the module read's `parts.tools.hosting`: VC1, VC5
 * and VC6a of `design/incoming/From Vercel Page.dc.html`, after Tools and
 * GitHub's Code system.
 *
 *   - Each Vercel connection: its sync line, "as of" its last sync, and Sync
 *     again for its owner (the connector syncs only its owner's connection);
 *   - each chosen project's facts (project, domain, framework, runtime,
 *     branch, repository) and whether production is live;
 *   - Health: each event Open or Closed, Dismiss on an open one through an
 *     in-page dialog that says what it changes (nothing on Vercel);
 *   - "Production runs on a personal Vercel account, Hobby plan." with the
 *     way to Company creation's proposal (D1099);
 *   - VC5: Empty with Choose projects, Unreadable with Try again, and an
 *     expired sign-in with Reconnect Vercel and the date its figures are from.
 *
 * Who is outside the company reads counts, never a name or a domain (the
 * Tools rule, decided by the Worker). Mounted by `buildParts.jsx`'s
 * `'vercel'` line on `operating-systems` (D1311).
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const parse = (v) => {
  if (typeof v !== 'string' || !v) return null;
  const ms = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v.replace(' ', 'T')}Z`);
  return Number.isFinite(ms) ? new Date(ms) : null;
};
/** "23 Oct 2026, 09:12" (UTC), or null for a time Vercel did not give. */
export function stamp(v) {
  const d = parse(v);
  if (!d) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
/** "20 Oct" for a sentence. */
export function day(v) {
  const d = parse(v);
  return d ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` : null;
}

export const FACT_KEYS = [['project', 'Project'], ['domain', 'Domain'], ['framework', 'Framework'], ['runtime', 'Runtime'], ['branch', 'Branch'], ['repository', 'Repository']];

/** VC5's reconnect sentence: whose sign-in expired, when, and the date the figures are from. */
export function reconnectSentence(r) {
  if (!r) return null;
  const who = r.project ? `Vercel’s sign-in for ${r.project}` : 'Vercel’s sign-in';
  const expired = day(r.expired_at);
  const asOf = day(r.as_of);
  return `${who} expired${expired ? ` on ${expired}` : ''}. ${asOf ? `Figures are as of ${asOf}.` : 'No figures were read before it expired.'}`;
}

/** One health event's line: its words, the subject when the viewer may see it, and since or closed when. */
export function healthLine(e) {
  const words = e?.words || 'Health event';
  const subject = typeof e?.subject === 'string' && e.subject ? e.subject : null;
  const open = e?.state === 'open';
  const when = open ? (day(e?.opened_at) ? `since ${day(e.opened_at)}` : null) : (day(e?.closed_at) ? `closed ${day(e.closed_at)}` : null);
  return { open, text: subject ? `${words} · ${subject}` : words, when };
}

/** The block's state from `parts.tools.hosting`. */
export function hostingView(hosting) {
  if (!hosting || typeof hosting !== 'object' || hosting.state === 'not_recorded') return { state: 'none' };
  if (hosting.state === 'unreadable') return { state: 'unreadable', reason: hosting.reason || 'Unreadable: Vercel could not be read. The rest of this page is current.' };
  if (hosting.state === 'empty') return { state: 'empty', reason: hosting.reason || 'Vercel has not brought anything to this venture yet.' };
  const systems = Array.isArray(hosting.systems) ? hosting.systems.filter((s) => s && typeof s === 'object') : [];
  const rows = Array.isArray(hosting.syncs?.rows) ? hosting.syncs.rows : [];
  const latest = rows[0] ?? null;
  return {
    state: systems.length ? 'ok' : 'empty', reason: systems.length ? null : 'Vercel has not brought anything to this venture yet.', systems,
    sync: latest ? (latest.state === 'failed' ? latest.error : latest.text) || null : hosting.syncs?.state === 'unreadable' ? 'The sync history could not be read.' : hosting.syncs?.reason || null,
    syncFailed: latest?.state === 'failed',
  };
}

export default function HostingFromVercel({ hosting, projectId, reload }) {
  const view = hostingView(hosting);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [asking, setAsking] = useState(null);
  if (view.state === 'none') return null;
  const choose = `/build/connect?tool=vercel&project_id=${encodeURIComponent(String(projectId ?? ''))}`;
  const syncAgain = async (uid) => {
    setBusy(`sync-${uid}`); setError('');
    try { await connectorsApi.sync(uid); reload?.(); }
    catch (e) { setError(e?.message || 'The sync did not complete. Nothing on this page changed.'); }
    finally { setBusy(null); }
  };
  const dismiss = async (event) => {
    setBusy(event.id); setError('');
    try { await cyclesWrite.build.dismissVercelHealthEvent(projectId, event.id); setAsking(null); reload?.(); }
    catch (e) { setError(e?.message || 'That event could not be dismissed. Nothing changed.'); }
    finally { setBusy(null); }
  };
  return (
    <section id="from-vercel" className="flex min-w-0 scroll-mt-4 flex-col gap-3 rounded-xl border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900" data-testid="cycle-part-hosting-vercel" aria-labelledby="from-vercel-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2.5">
        <h2 id="from-vercel-title" className="m-0 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100">Hosting</h2>
        <span className={FAINT}>From Vercel</span>
      </div>
      {view.state === 'unreadable' && (
        <p role="alert" className="m-0 flex flex-wrap items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-[12.5px] text-red-800 dark:bg-red-950/40 dark:text-red-200" data-testid="hosting-vercel-unreadable">
          {view.reason}
          {reload && <button type="button" className={actionGhost} onClick={() => reload()} data-testid="hosting-vercel-retry">Try again</button>}
        </p>
      )}
      {view.state === 'empty' && (
        <p className="m-0 flex flex-wrap items-center gap-2 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="hosting-vercel-empty">
          {view.reason}
          <Link to={choose} className="font-bold text-axal-violet hover:underline dark:text-violet-300" data-testid="hosting-vercel-choose">Choose projects</Link>
        </p>
      )}
      {view.state === 'ok' && view.systems.map((sys, i) => {
        const items = Array.isArray(sys.health?.items) ? sys.health.items : null;
        const projects = Array.isArray(sys.projects) ? sys.projects : null;
        const reconnect = reconnectSentence(sys.reconnect);
        const open = sys.action && typeof sys.action.href === 'string' && sys.action.href.startsWith('/') ? sys.action.href : choose;
        return (
          <div key={i} className="flex flex-col gap-3 rounded-lg border border-axal-hairline px-3 py-3 dark:border-gray-800" data-testid={`hosting-vercel-${i}`}>
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-axal-hairline px-2 py-0.5 text-[11px] font-semibold text-axal-ink dark:border-gray-700 dark:text-gray-200">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-axal-ink dark:bg-gray-200" />{sys.source_label || 'From the Vercel connection'}
              </span>
              <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="hosting-vercel-asof">{stamp(sys.last_sync) ? `as of ${stamp(sys.last_sync)}` : 'Not synced yet'}</span>
              {sys.owner && <span className={FAINT}>{sys.owner}</span>}
              <span className="flex-1" />
              {sys.sync_uid && !reconnect && (
                <button type="button" className={actionGhost} disabled={busy != null} onClick={() => syncAgain(sys.sync_uid)} data-testid="hosting-vercel-sync">{busy === `sync-${sys.sync_uid}` ? 'Syncing…' : 'Sync again'}</button>
              )}
            </div>
            {reconnect && (
              <p role="status" className="m-0 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200" data-testid="hosting-vercel-reconnect">
                {reconnect}
                <Link to={open} className="font-bold underline" data-testid="hosting-vercel-reconnect-link">Reconnect Vercel</Link>
              </p>
            )}
            {view.sync && <span className={`font-mono text-[12.5px] ${view.syncFailed ? 'text-red-700 dark:text-red-300' : 'text-axal-ink/80 dark:text-gray-300'}`} data-testid="hosting-vercel-syncline">{view.sync}</span>}
            {projects === null ? (
              <p className={MUTED} data-testid="hosting-vercel-projects-count">{sys.projects_total === 1 ? '1 project' : `${sys.projects_total ?? 0} projects`} from Vercel. Only the company’s members see which.</p>
            ) : projects.length === 0 ? (
              <p className={`${MUTED} flex flex-wrap items-center gap-2`} data-testid="hosting-vercel-no-projects">
                {sys.projects_reason || 'No Vercel project is chosen for this venture yet.'}
                <Link to={open} className="font-bold text-axal-violet hover:underline dark:text-violet-300">Choose projects</Link>
              </p>
            ) : projects.map((p, j) => (
              <div key={j} className="flex flex-col gap-2" data-testid={`hosting-vercel-project-${j}`}>
                <dl className="m-0 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  {FACT_KEYS.map(([k, label]) => (
                    <div key={k} className="flex min-w-0 flex-col gap-0.5">
                      <dt className="font-mono text-[10px] uppercase tracking-[.07em] text-axal-muted dark:text-gray-400">{label}</dt>
                      <dd className={`m-0 truncate font-mono text-[13px] font-semibold ${p[k] ? 'text-axal-ink dark:text-gray-100' : 'italic font-normal text-axal-muted dark:text-gray-400'}`} data-testid={`hosting-vercel-fact-${k}`}>{p[k] || 'Not recorded'}</dd>
                    </div>
                  ))}
                </dl>
                {p.live && (
                  <span className="inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-semibold" data-testid="hosting-vercel-live"
                    data-state={p.live.state}>
                    <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${LIVE_DOT[p.live.state] || 'bg-gray-400'}`} />
                    {p.live.words || 'Not recorded'}{day(p.live.since) && p.live.state !== 'not_deployed' ? ` since ${day(p.live.since)}` : ''}
                  </span>
                )}
              </div>
            ))}
            <div className="flex flex-col" data-testid="hosting-vercel-health">
              <span className="pb-1.5 font-mono text-[10.5px] uppercase tracking-[.07em] text-axal-muted dark:text-gray-400">Health</span>
              {items === null ? (
                <p className={MUTED} data-testid="hosting-vercel-health-counts">{sys.health?.open ?? 0} open, {sys.health?.closed ?? 0} closed in the last 30 days.</p>
              ) : items.length === 0 ? (
                <p className={MUTED} data-testid="hosting-vercel-health-none">No production health event in the last 30 days.</p>
              ) : items.map((e) => {
                const line = healthLine(e);
                return (
                  <div key={e.id} className="flex flex-wrap items-center gap-2.5 border-t border-axal-hairline py-2.5 dark:border-gray-800" data-testid={`hosting-vercel-event-${e.id}`}>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${line.open ? 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200' : 'bg-gray-100 text-axal-muted dark:bg-gray-800 dark:text-gray-400'}`}>{line.open ? 'Open' : 'Closed'}</span>
                    <span className="min-w-0 flex-1 text-[13px] text-axal-ink dark:text-gray-100">{line.text}{line.when && <span className="ml-1.5 font-mono text-[12px] text-axal-muted dark:text-gray-400">{line.when}</span>}</span>
                    {line.open && <button type="button" className={actionGhost} disabled={busy != null} onClick={() => { setError(''); setAsking(e); }} data-testid={`hosting-vercel-dismiss-${e.id}`}>Dismiss</button>}
                  </div>
                );
              })}
            </div>
            {sys.hobby && (
              <p className="m-0 flex flex-wrap items-center gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200" data-testid="hosting-vercel-hobby">
                {sys.hobby.text}
                {sys.hobby.link?.href?.startsWith('/') && <Link to={sys.hobby.link.href} className="font-semibold underline">{sys.hobby.link.text}</Link>}
              </p>
            )}
          </div>
        );
      })}
      {error && !asking && <p role="alert" className="m-0 text-[12px] text-red-700 dark:text-red-300" data-testid="hosting-vercel-error">{error}</p>}
      {asking && (
        <Lightbox label="Dismiss a health event" title="Dismiss this health event?" onClose={() => { if (busy == null) { setAsking(null); setError(''); } }} width={520} testId="hosting-vercel-dialog"
          footer={(
            <div className="flex justify-end gap-2">
              <button type="button" className={actionGhost} disabled={busy != null} onClick={() => { setAsking(null); setError(''); }} data-testid="hosting-vercel-cancel">Cancel</button>
              <button type="button" className={actionPrimary} disabled={busy != null} onClick={() => dismiss(asking)} data-testid="hosting-vercel-confirm">{busy === asking.id ? 'Dismissing…' : 'Dismiss'}</button>
            </div>
          )}>
          <div className="flex flex-col gap-3 text-[13px]">
            <p className="m-0 text-axal-ink dark:text-gray-100" data-testid="hosting-vercel-dialog-sentence">“{healthLine(asking).text}” leaves this page and does not come back while Vercel still shows it.</p>
            <div className="rounded-lg bg-gray-50 px-3 py-2 text-[12.5px] text-axal-ink dark:bg-gray-800 dark:text-gray-100">Nothing changes on Vercel. If it clears and happens again, it shows as a new event.</div>
            {error && <p role="alert" className="m-0 text-[12px] text-red-700 dark:text-red-300" data-testid="hosting-vercel-dialog-error">{error}</p>}
          </div>
        </Lightbox>
      )}
    </section>
  );
}

const LIVE_DOT = { live: 'bg-emerald-500', failing: 'bg-red-500', building: 'bg-amber-500', not_deployed: 'bg-gray-400' };
const MUTED = 'm-0 text-[12.5px] text-axal-muted dark:text-gray-400';
const FAINT = 'text-[11px] text-axal-faint dark:text-gray-500';
