import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { cyclesApi } from '../../lib/api/cycles';
import { Unreadable } from '../../ui';
import { CycleHeader } from './CycleOverview';
import { CycleBar } from './PhoneModulePage';
import UpdatesHistory from './UpdatesHistory';
import { DESK_TABS, DESK_WAITS, DUTIES_LINE, DUTIES_WAIT, LINE, NOT_YET, TITLE, deskHref, deskSearch } from './reportingModel';

/**
 * D1056 (#2427) — Grow's Reporting desk at `/grow/reporting` and its Duties
 * tab at `/grow/reporting/duties`. `CycleRoute` draws it in place of a module
 * page, under Grow's tab row with Reporting lit. Today it draws the History
 * from the Durable company-building read (`parts.updates`), and every block
 * that needs a duty says what it waits for (`reportingModel.js`).
 */

const CARD = 'flex min-w-0 flex-col gap-2 rounded-xl border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900';
const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100';
const MUTED = 'm-0 text-[12.5px] text-axal-muted dark:text-gray-400';
const PILL = 'w-fit rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[10.5px] font-bold text-axal-muted dark:border-gray-600 dark:text-gray-400';

/** The desk's tabs, a second level under Grow's: text with an underline, each a literal link. */
export function DeskTabBar({ active, search = '' }) {
  return (
    <div className="border-b border-axal-hairline dark:border-gray-700" data-testid="reporting-tabs">
      <nav aria-label={TITLE} className="-mb-px flex gap-1 overflow-x-auto">
        {DESK_TABS.map((t) => (
          <Link key={t.id} to={deskHref(t.id, search)} aria-current={t.id === active ? 'page' : undefined}
            className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-[12.5px] ${t.id === active
              ? 'border-axal-violet font-extrabold text-axal-ink dark:border-violet-400 dark:text-gray-100'
              : 'border-transparent font-semibold text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}`}
            data-testid={`reporting-tab-${t.id}`}>
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

/** A block no read carries yet: its title, "Not read here yet", and what it waits for. */
function Waiting({ id, title, waits }) {
  return (
    <section className={CARD} data-testid={`reporting-wait-${id}`}>
      <h2 className={H2}>{title}</h2>
      <span className={PILL}>{NOT_YET}</span>
      <p className={MUTED}>{waits}</p>
    </section>
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

export default function ReportingDesk({ tab = 'desk', projectId, projectStatus = 'ready', onRetryProject, search = '', cards, action, phone = false }) {
  const s = deskSearch(search);
  let body;
  // No venture means no read is made: say the venture list failed, never a skeleton.
  if (projectStatus === 'unreadable') body = <Unreadable what="Your ventures" claim="This is not a claim that you have none." onRetry={onRetryProject} />;
  else if (!projectId) body = <p className={MUTED} aria-busy="true" data-testid="reporting-loading">Loading…</p>;
  else if (tab === 'duties') {
    body = (
      <div className="flex flex-col gap-3" data-testid="reporting-duties">
        <p className={MUTED} data-testid="reporting-duties-line">{DUTIES_LINE}</p>
        <Waiting id="duties" title="Duties" waits={DUTIES_WAIT} />
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col gap-[14px]" data-testid="reporting-desk">
        {DESK_WAITS.map((w) => <Waiting key={w.key} id={w.key} title={w.title} waits={w.waits} />)}
        <History projectId={projectId} onShare={action?.onOpen || action?.onClick} />
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid={`reporting-${tab}-page`}>
      {phone
        ? <CycleBar back={{ label: 'Grow', to: `/grow${s}` }} title={TITLE} eadwynLabel={`Grow · ${TITLE}`} />
        : <CycleHeader cycle="grow" cards={cards} active="reporting" action={action} title={TITLE} sub={LINE} search={s} />}
      <DeskTabBar active={tab} search={s} />
      {body}
    </div>
  );
}
