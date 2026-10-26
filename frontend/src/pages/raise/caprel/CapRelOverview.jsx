import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { capitalRelationshipsApi } from '../../../lib/api/capitalRelationships';
import { Unreadable } from '../../../ui';
import { useProspects } from './CapRelPipeline';
import { HOME_PATH, MOVED, NOT_YET, TABS, centsText, needsYou, overviewFigures, tabSearch } from './capRelModel';

/**
 * D1192 (#3126) — Capital relationships' Overview blocks (CRL1, CRL19 in the
 * dark) above the module page's own round card and tables, and the moved
 * notice (CRL13). The round at a glance comes from D1190's commitments read;
 * Needs you, the pipeline by stage and the follow-ups from the prospects.
 * Each block answers alone: one that fails says so with Try again.
 */

const CARD = 'flex min-w-0 flex-col gap-2 rounded-xl border border-axal-hairline bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900';
const H3 = 'm-0 text-[13px] font-bold text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const INK = 'text-axal-ink dark:text-gray-100';
const LINK = 'font-semibold text-axal-violet hover:underline dark:text-violet-300';
const NR = 'w-fit rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[11px] font-bold text-axal-muted dark:border-gray-600 dark:text-gray-400';

const hrefOf = (tab, search) => `${HOME_PATH}${TABS.find((t) => t.id === tab)?.path || ''}${tabSearch(search)}`;

/** The moved notice (CRL13): after arriving from the old pipeline or from Investor match, until dismissed. */
export function MovedNotice() {
  // The address's own query: the tool's links keep only the venture, so `moved` is read here, once.
  const key = new URLSearchParams(useLocation().search).get('moved');
  const [gone, setGone] = useState(false);
  if (!key || !MOVED[key] || gone) return null;
  return (
    <div role="status" className="flex items-center gap-2.5 rounded-[10px] border border-axal-lavender-edge bg-axal-lavender px-3 py-1.5 text-[13px] text-axal-ink dark:border-violet-800 dark:bg-violet-950/40 dark:text-gray-100" data-testid="caprel-moved">
      <span className="min-w-0 flex-1">{MOVED[key]}</span>
      <button type="button" className={`${LINK} text-[12px]`} onClick={() => setGone(true)} data-testid="caprel-moved-dismiss">Dismiss</button>
    </div>
  );
}

function RoundBlock({ projectId }) {
  const [n, setN] = useState(0);
  const [read, setRead] = useState({ status: 'loading', data: null });
  useEffect(() => {
    let alive = true;
    setRead({ status: 'loading', data: null });
    Promise.resolve().then(() => capitalRelationshipsApi.commitments(projectId))
      .then((data) => { if (alive) setRead({ status: 'ready', data }); })
      .catch(() => { if (alive) setRead({ status: 'unreadable', data: null }); });
    return () => { alive = false; };
  }, [projectId, n]);
  const d = read.data;
  const t = d?.totals;
  const cur = d?.currency || d?.round?.currency || 'USD';
  return (
    <section className={CARD} data-testid="caprel-ov-round">
      <h3 className={H3}>The round at a glance</h3>
      {read.status === 'loading' ? <div className="h-16 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" data-testid="caprel-ov-round-loading" /> : null}
      {read.status === 'unreadable' ? <Unreadable what="Your commitments" claim="This is not a claim that nobody has committed." onRetry={() => setN((x) => x + 1)} /> : null}
      {d ? (
        <div className="flex flex-col gap-1.5">
          <p className={`m-0 text-[22px] font-extrabold ${INK} font-mono tabular-nums`} data-testid="caprel-ov-counted">
            {t?.counted_cents != null ? centsText(t.counted_cents, cur) : 'Not recorded'}
            <span className={`ml-2 text-[13px] font-semibold ${MUTED}`}>{d.round?.target_cents ? `of ${centsText(d.round.target_cents, cur)}${t?.percent_of_target != null ? ` · ${t.percent_of_target}%` : ''}` : ''}</span>
          </p>
          {!d.round ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="caprel-ov-no-round">{d.round_reason || 'No active round is recorded, so there is no target to count against.'}</p>
            : !d.round.target_cents ? <span className={NR}>Target not recorded</span> : null}
          <p className={`m-0 text-[12.5px] ${MUTED}`}>Counted: Received, Signed, Wired, Confirmed and Pending. {t?.not_counted_cents ? `${centsText(t.not_counted_cents, cur)} is listed but not counted (soft, indicated, or no status).` : ''}</p>
          {t?.partial ? <p className="m-0 text-[12px] font-semibold text-amber-800 dark:text-amber-300" data-testid="caprel-ov-partial">One source could not be read, so this total may be short. Commitments says which.</p> : null}
          <Link className={`${LINK} text-[12px]`} to={hrefOf('commitments', `?project_id=${projectId}`)}>Open Commitments</Link>
        </div>
      ) : null}
    </section>
  );
}

/** Overview's blocks, under its tab bar. */
export function CapRelOverviewBlocks({ projectId, search = '', today }) {
  const read = useProspects(projectId);
  const f = read.items ? overviewFigures(read.items, today) : null;
  const needs = f ? needsYou(f) : [];
  const max = f ? Math.max(1, ...f.byStage.map((s) => s.n)) : 1;
  const failed = read.status === 'unreadable';
  return (
    <div className="flex flex-col gap-3.5" data-testid="caprel-overview">
      <div className="grid gap-3.5 lg:grid-cols-3">
        <RoundBlock projectId={projectId} />
        <section className={CARD} data-testid="caprel-ov-needs">
          <h3 className={H3}>Needs you</h3>
          {read.status === 'loading' && !f ? <div className="h-16 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" /> : null}
          {failed ? <Unreadable what="Your investors" claim="This is not a claim that nothing needs you." onRetry={read.reload} /> : null}
          {f && !needs.length ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="caprel-ov-needs-none">Nothing needs you: no follow-up is overdue or due today, every conversation has a next step, and every commitment has a status.</p> : null}
          {needs.length ? (
            <ul className="m-0 flex list-none flex-col p-0">
              {needs.map((x) => (
                <li key={x.key} className="flex flex-wrap items-center justify-between gap-2 border-t border-axal-hairline py-2 first:border-t-0 dark:border-gray-800" data-testid={`caprel-ov-need-${x.key}`}>
                  <span className={`text-[13px] font-semibold ${INK}`}>{x.text}</span>
                  <Link className={`${LINK} text-[12px]`} to={hrefOf(x.tab, search)}>{x.action}</Link>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
        <section className={CARD} data-testid="caprel-ov-stages">
          <h3 className={H3}>The pipeline by stage</h3>
          {read.status === 'loading' && !f ? <div className="h-24 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" /> : null}
          {failed ? <Unreadable what="Your investors" claim="This is not a claim that you have none." onRetry={read.reload} /> : null}
          {f && f.total === 0 ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="caprel-ov-empty">No investors yet. Add them on Pipeline, or import a CSV.</p> : null}
          {f && f.total ? (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {f.byStage.map((s) => (
                <li key={s.stage} className="grid grid-cols-[92px_minmax(0,1fr)_28px] items-center gap-2 text-[12.5px]" data-testid={`caprel-ov-stage-${s.stage}`}>
                  <span className={INK}>{s.label}</span>
                  <span className="h-2 rounded-full bg-gray-100 dark:bg-gray-800"><span className="block h-2 rounded-full bg-axal-violet dark:bg-violet-400" style={{ width: `${Math.round((s.n / max) * 100)}%` }} /></span>
                  <span className={`text-right font-mono ${INK}`}>{s.n}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {f && f.total ? <p className={`m-0 text-[12px] ${MUTED}`}>Against 30 days ago: not recorded. The pipeline’s stage history is not read here yet.</p> : null}
        </section>
      </div>
      <div className="grid gap-3.5 lg:grid-cols-3">
        <section className={`${CARD} lg:col-span-2`} data-testid="caprel-ov-followups">
          <h3 className={H3}>Follow-ups</h3>
          {failed ? <Unreadable what="Your follow-ups" claim="This is not a claim that none are due." onRetry={read.reload} /> : null}
          {f && !f.followUps.length ? <p className={`m-0 text-[12.5px] ${MUTED}`}>No next step has a date yet.</p> : null}
          {f?.followUps.length ? (
            <ul className="m-0 flex list-none flex-col p-0">
              {f.followUps.slice(0, 6).map((x) => (
                <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-axal-hairline py-1.5 text-[12.5px] first:border-t-0 dark:border-gray-800" data-testid={`caprel-ov-followup-${x.id}`}>
                  <span className={INK}><span className="font-semibold">{x.name}</span> · {x.step}</span>
                  <span className={`font-mono ${x.overdue ? 'font-bold text-red-700 dark:text-red-300' : MUTED}`}>{x.due}{x.overdue ? ' · overdue' : ''}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
        <section className={CARD} data-testid="caprel-ov-waits">
          <h3 className={H3}>The next meetings, recent activity, and fit</h3>
          <span className={NR}>{NOT_YET}</span>
          <p className={`m-0 text-[12.5px] ${MUTED}`}>Upcoming meetings are on your Calendar as investor meetings. One timeline across every investor, and fit across the pipeline, come with Activity and Match.</p>
        </section>
      </div>
    </div>
  );
}
