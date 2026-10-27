import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { cyclesApi } from '../../lib/api/cycles';
import { reportingApi } from '../../lib/api/reporting.js';
import { reportError } from '../../lib/log';
import { Unreadable } from '../../ui';
import { CycleHeader } from './CycleOverview';
import { CycleBar } from './PhoneModulePage';
import UpdatesHistory from './UpdatesHistory';
import { DESK_TABS, DUTIES_LINE, LINE, TITLE, deskHref, deskSearch } from './reportingModel';
import { EMPTY, NOT_SHARED, dueNext, prepareLabel, readOnlyLine } from './reporting/deskModel.js';
import { reportHref } from './reporting/builderModel.js';
import { BAR_PRIMARY, CARD, Calendar, DueNext, DutiesTable, DutyDrawer, H2, MUTED, NeedsYou, PinnedBar } from './reporting/DeskBlocks.jsx';
import { ExpectedDateDialog, ReminderDialog } from './reporting/ReportingDialogs.jsx';
import ReportPage from './reporting/ReportPage.jsx';

/**
 * D1056 (#2427), D1060 (#2930) — Grow's Reporting desk at `/grow/reporting`,
 * Duties at `/grow/reporting/duties`, and a report at `/grow/reporting/:id`
 * (sent, RPT6) and `/grow/reporting/:id/edit` (the builder, RPT3–RPT5).
 * `CycleRoute` draws it in place of a module page.
 *
 * The desk reads part 2's `GET /api/reporting/desk` once (D1058): Due next,
 * Needs you and the calendar (RPT1, RPT7), and Duties with its drawer (RPT2,
 * RPT8). The History is still the Durable company-building read's
 * `parts.updates`, which lists Share an update's updates beside the reports.
 * Each read answers alone: a failed desk never hides the History.
 *
 * WHO WRITES. The Worker's `can_write` (the owner and accepted co-founders,
 * never an admin) decides; anyone else the desk admits — an advisor, an
 * Operating Partner of the venture, an admin — reads it with "Read only" and
 * no Prepare, expected date or reminders (RPT14, RPT15).
 *
 * D1062 (#2932), the founder at 390 (RPT20a): Due next, Needs you, the
 * periods as a list with their pills, and "Prepare [period] report" in a bar
 * pinned to the bottom of the page instead of the header's primary.
 */

const PILL = 'w-fit rounded-full border border-axal-hairline px-2 py-0.5 text-[11px] font-bold text-axal-muted dark:border-gray-700 dark:text-gray-400';
const MENU_ITEM = 'block w-full px-3 py-2 text-left text-[12.5px] font-semibold text-axal-ink hover:bg-gray-50 dark:text-gray-100 dark:hover:bg-gray-800';

/** The desk's tabs, a second level under Grow's: text with an underline, each a literal link. */
export function DeskTabBar({ active, search = '', counts = {} }) {
  return (
    <div className="border-b border-axal-hairline dark:border-gray-700" data-testid="reporting-tabs">
      <nav aria-label={TITLE} className="-mb-px flex gap-1 overflow-x-auto">
        {DESK_TABS.map((t) => (
          <Link key={t.id} to={deskHref(t.id, search)} aria-current={t.id === active ? 'page' : undefined}
            className={`inline-flex min-h-11 items-center whitespace-nowrap border-b-2 px-3 py-2.5 text-[12.5px] ${t.id === active
              ? 'border-axal-violet font-extrabold text-axal-ink dark:border-violet-400 dark:text-gray-100'
              : 'border-transparent font-semibold text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}`}
            data-testid={`reporting-tab-${t.id}`}>
            {t.label}{counts[t.id] != null ? <span className="ml-1.5 text-axal-muted dark:text-gray-400">{counts[t.id]}</span> : null}
          </Link>
        ))}
      </nav>
    </div>
  );
}

/** The History: every update the venture sent, from the Durable company-building read. */
function History({ projectId, onShare }) {
  const [state, setState] = useState({ status: 'loading', updates: undefined, reason: null });
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    setState({ status: 'loading', updates: undefined, reason: null });
    cyclesApi.module('grow', projectId, 'durable-company-building', {})
      .then((data) => { if (alive) setState({ status: 'ready', updates: Array.isArray(data?.parts?.updates) ? data.parts.updates : null, reason: data?.parts?.updates_reason || null }); })
      .catch(() => { if (alive) setState({ status: 'unreadable', updates: undefined, reason: null }); });
    return () => { alive = false; };
  }, [projectId, reload]);
  if (state.status === 'loading') return <section className={CARD} aria-busy="true" data-testid="reporting-history-loading"><h2 className={H2}>History</h2><div className="h-3 w-40 animate-pulse rounded bg-axal-ground dark:bg-gray-800" /></section>;
  if (state.status === 'unreadable') return <Unreadable what="The History" claim="This is not a claim that nothing was sent." onRetry={() => setReload((n) => n + 1)} />;
  return <div data-testid="reporting-history"><UpdatesHistory updates={state.updates} reason={state.reason} onShare={onShare} /></div>;
}

/** Part 2's desk read: ready, unreadable, or not shared with this account (the Worker's 404). */
export function useDesk(projectId) {
  const [state, setState] = useState({ status: 'loading', desk: null });
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!projectId) return undefined;
    let alive = true;
    setState((s) => ({ status: s.desk ? 'ready' : 'loading', desk: s.desk }));
    reportingApi.desk(projectId)
      .then((desk) => { if (alive) setState({ status: 'ready', desk }); })
      .catch((e) => { if (alive) setState({ status: e?.status === 404 || e?.status === 403 ? 'not_shared' : 'unreadable', desk: null }); });
    return () => { alive = false; };
  }, [projectId, reload]);
  return { ...state, reload: useCallback(() => setReload((n) => n + 1), []) };
}

/** The header's More menu: Share an update, and the founders' Reminder settings. Escape closes it. */
function MoreMenu({ action, onReminders }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    const key = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener?.('keydown', key);
    return () => document.removeEventListener?.('keydown', key);
  }, [open]);
  const share = action?.onOpen || action?.onClick;
  return (
    <div className="relative">
      <button type="button" aria-label="More" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center rounded-[9px] border border-axal-hairline bg-white px-2.5 py-2 text-[12.5px] font-bold text-axal-ink hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
        data-testid="reporting-more">⋯</button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-xl border border-axal-hairline bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900" data-testid="reporting-more-menu">
          {action?.href && !share
            ? <Link role="menuitem" to={action.href} className={MENU_ITEM} onClick={() => setOpen(false)} data-testid="reporting-more-share">Share an update</Link>
            : share ? <button type="button" role="menuitem" className={MENU_ITEM} onClick={() => { setOpen(false); share(); }} data-testid="reporting-more-share">Share an update</button> : null}
          {onReminders && <button type="button" role="menuitem" className={MENU_ITEM} onClick={() => { setOpen(false); onReminders(); }} data-testid="reporting-more-reminders">Reminder settings</button>}
        </div>
      )}
    </div>
  );
}

/** RPT14, RPT15: the header for anyone the Worker lets read and not write. No Grow tabs: their shell is their own. */
function ReadOnlyHeader({ desk, role }) {
  return (
    <header className="flex flex-col gap-1.5" data-testid="reporting-readonly-header">
      <div className="flex flex-wrap items-center gap-2.5">
        <h1 className="m-0 text-[20px] font-extrabold leading-tight tracking-[-.025em] text-axal-ink sm:text-2xl dark:text-gray-100">{TITLE}{desk?.project?.name ? ` · ${desk.project.name}` : ''}</h1>
        <span className={PILL} data-testid="reporting-readonly">◉ Read only</span>
      </div>
      <p className="m-0 text-[13px] leading-relaxed text-axal-ink/80 dark:text-gray-300" data-testid="reporting-readonly-line">{readOnlyLine(role)}</p>
    </header>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-[14px]" aria-busy="true" data-testid="reporting-desk-loading">
      {['Due next', 'Needs you', 'Calendar'].map((t) => (
        <section key={t} className={CARD}><h2 className={H2}>{t}</h2><p className={MUTED}>Reading…</p><div className="h-3 w-48 animate-pulse rounded bg-axal-ground dark:bg-gray-800" /></section>
      ))}
    </div>
  );
}

/** RPT17a: a venture no investor has signed with yet. Not "nothing owed": no duty exists to owe. */
function Empty({ action, search }) {
  const share = action?.onOpen || action?.onClick;
  return (
    <section className={`${CARD} items-start`} data-testid="reporting-empty">
      <h2 className={H2}>{EMPTY.title}</h2>
      <p className={MUTED}>{EMPTY.line}</p>
      <div className="flex flex-wrap gap-2">
        {share ? <button type="button" className="inline-flex items-center rounded-[9px] bg-axal-violet px-3 py-1.5 text-[12.5px] font-bold text-white hover:bg-axal-violet-deep dark:hover:bg-violet-500" onClick={share}>Share an update</button>
          : action?.href ? <Link className="inline-flex items-center rounded-[9px] bg-axal-violet px-3 py-1.5 text-[12.5px] font-bold text-white hover:bg-axal-violet-deep dark:hover:bg-violet-500" to={action.href}>Share an update</Link> : null}
        <Link to={`/raise${search}`} className="inline-flex items-center rounded-[9px] border border-axal-hairline px-3 py-1.5 text-[12.5px] font-bold text-axal-ink hover:bg-gray-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800" data-testid="reporting-empty-raise">Go to Raise</Link>
      </div>
    </section>
  );
}

export default function ReportingDesk({ tab = 'desk', projectId, projectStatus = 'ready', onRetryProject, search = '', cards, action, phone = false, reportUid = null, role = null }) {
  const s = deskSearch(search);
  const navigate = useNavigate();
  const isReport = tab === 'edit' || tab === 'report';
  const { status, desk, reload } = useDesk(isReport ? null : projectId);
  const [dialog, setDialog] = useState(null);
  const [duty, setDuty] = useState(null);
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState('');
  const canWrite = status === 'ready' && !!desk?.can_write;

  const prepare = async (period) => {
    if (!period || preparing) return;
    setPreparing(true); setPrepareError('');
    try {
      const r = await reportingApi.draftReport(period.uid);
      const to = reportHref(r?.uid, { draft: true, search: s });
      if (to) navigate(to);
      else setPrepareError('The report could not be opened. Try again.');
    } catch (e) {
      reportError('ReportingDesk:prepare', e);
      setPrepareError(e?.message || 'The report could not be prepared. Nothing was sent. Try again.');
    } finally { setPreparing(false); }
  };

  if (isReport) {
    return <ReportPage uid={reportUid} edit={tab === 'edit'} projectId={projectId} projectStatus={projectStatus} onRetryProject={onRetryProject} search={s} cards={cards} phone={phone} role={role} />;
  }

  const next = status === 'ready' ? dueNext(desk) : null;
  const deskAction = canWrite
    ? { label: preparing ? 'Preparing…' : prepareLabel(next), onClick: next ? () => prepare(next.period) : undefined, disabled: preparing || !next }
    : null;
  const readOnly = status === 'ready' && !desk?.can_write;
  const more = readOnly ? null : <MoreMenu action={action} onReminders={canWrite ? () => setDialog({ kind: 'reminders' }) : null} />;

  let body;
  // No venture means no read is made: say the venture list failed, never a skeleton.
  if (projectStatus === 'unreadable') body = <Unreadable what="Your ventures" claim="This is not a claim that you have none." onRetry={onRetryProject} />;
  else if (!projectId) body = <p className={MUTED} aria-busy="true" data-testid="reporting-loading">Loading…</p>;
  else {
    const deskBody = status === 'loading' ? <Skeleton />
      : status === 'unreadable' ? <Unreadable what="The reporting desk" claim="This is not a claim that nothing is owed." onRetry={reload} />
        : status === 'not_shared' ? <section className={CARD} data-testid="reporting-not-shared"><p className={MUTED}>{NOT_SHARED}</p></section>
          : !(desk?.duties || []).length ? <Empty action={action} search={s} /> : null;
    if (tab === 'duties') {
      body = (
        <div className="flex flex-col gap-3" data-testid="reporting-duties">
          <p className={MUTED} data-testid="reporting-duties-line">{DUTIES_LINE}</p>
          {deskBody || <DutiesTable desk={desk} onOpen={setDuty} />}
        </div>
      );
    } else {
      body = (
        <div className="flex flex-col gap-[14px]" data-testid="reporting-desk">
          {deskBody || (
            <>
              {!readOnly && <DueNext desk={desk} canWrite={canWrite} onPrepare={prepare} busy={preparing} phone={phone} />}
              {canWrite && <NeedsYou desk={desk} onPrepare={prepare} onExpect={(p) => setDialog({ kind: 'expected', period: p })} busy={preparing} />}
              <Calendar desk={desk} canWrite={canWrite} onPrepare={prepare} onExpect={(p) => setDialog({ kind: 'expected', period: p })} busy={preparing} phone={phone} />
            </>
          )}
          <History projectId={projectId} onShare={readOnly ? undefined : action?.onOpen || action?.onClick} />
        </div>
      );
    }
  }
  const header = phone
    ? <CycleBar back={{ label: 'Grow', to: `/grow${s}` }} title={TITLE} eadwynLabel={`Grow · ${TITLE}`} />
    : readOnly ? <ReadOnlyHeader desk={desk} role={role} />
      : <CycleHeader cycle="grow" cards={cards} active="reporting" action={deskAction} title={TITLE} sub={LINE} search={s} more={more} />;
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid={`reporting-${tab}-page`}>
      {header}
      {prepareError && <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" role="alert" data-testid="reporting-prepare-refused">{prepareError}</p>}
      <DeskTabBar active={tab} search={s} counts={status === 'ready' ? { duties: (desk?.duties || []).length } : {}} />
      {body}
      {phone && tab === 'desk' && deskAction && next && (
        <PinnedBar testId="reporting-prepare-bar">
          <button type="button" className={BAR_PRIMARY} onClick={deskAction.onClick} disabled={deskAction.disabled} data-testid="reporting-prepare-pinned">{deskAction.label}</button>
        </PinnedBar>
      )}
      {dialog?.kind === 'expected' && (
        <ExpectedDateDialog period={dialog.period} today={desk?.today} onClose={() => setDialog(null)} onDone={() => { setDialog(null); reload(); }} />
      )}
      {dialog?.kind === 'reminders' && (
        <ReminderDialog desk={desk} onClose={() => setDialog(null)} onDone={() => { setDialog(null); reload(); }} />
      )}
      {duty && <DutyDrawer desk={desk} duty={duty} onClose={() => setDuty(null)} raiseHref={`/raise${s}`} />}
    </div>
  );
}
