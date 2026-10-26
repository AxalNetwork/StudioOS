import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { cyclesApi } from '../../../lib/api/cycles';
import { Unreadable } from '../../../ui';
import { CycleHeader } from '../../cycles/CycleOverview';
import { CycleBar } from '../../cycles/PhoneModulePage';
import { RecordsTable } from '../../cycles/CycleModulePage';
import { recordHref, recordId, rowLinks } from '../../cycles/recordModel';
import CallsTab from '../calls/CallsTab';
import { ProRataPanel, RoundClosesPanel } from '../RoundClosesPanel';
import { FounderClosing } from '../../closing/ClosingRoom';
import { CLOSING, HOME_PATH, LINE, NOT_YET, SLUG, TABS, TITLE, WAITS, tabHref, tabSearch } from './capRelModel';

/**
 * D1188 (#2457) — the Capital relationships tool's tab bar and tab pages.
 * CycleRoute draws Overview (the module page) with `CapRelHomeNav` under its
 * header, and `CapRelTabPage` for the tab words under the module. Pipeline and
 * Calls draw the module read; Commitments draws today's closes and pro-rata;
 * Match, Outreach and Activity say what they wait for.
 */

const MUTED = 'text-axal-muted dark:text-gray-400';

/** The tool's own tabs, a second level under the Raise modules. */
export function CapRelTabBar({ active, search = '' }) {
  return (
    <div className="border-b border-axal-hairline dark:border-gray-700" data-testid="caprel-tabs">
      <nav aria-label={TITLE} className="-mb-px flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <Link key={t.id} to={tabHref(t, search)} aria-current={t.id === active ? 'page' : undefined}
            className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-[12.5px] ${t.id === active
              ? 'border-axal-violet font-extrabold text-axal-ink dark:border-violet-400 dark:text-gray-100'
              : 'border-transparent font-semibold text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}`}
            data-testid={`caprel-tab-${t.id}`}>
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

/** Overview's tab bar. */
export function CapRelHomeNav({ search = '' }) {
  return <CapRelTabBar active="overview" search={search} />;
}

function Wait({ tab }) {
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-axal-hairline bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900" data-testid={`caprel-wait-${tab}`}>
      <span className="w-fit rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[11px] font-bold text-axal-muted dark:border-gray-600 dark:text-gray-400">{NOT_YET}</span>
      <p className={`m-0 text-[12.5px] ${MUTED}`}>{WAITS[tab]}</p>
    </section>
  );
}

/** The module read, with the Worker's search, filters and sort. */
function useModule(projectId) {
  const [reload, setReload] = useState(0);
  const [query, setQuery] = useState({});
  const [read, setRead] = useState({ status: 'loading', data: null });
  useEffect(() => {
    let alive = true;
    setRead({ status: 'loading', data: null });
    Promise.resolve().then(() => cyclesApi.module('raise', projectId, SLUG, query))
      .then((data) => { if (alive) setRead({ status: 'ready', data }); })
      .catch((error) => { if (alive) setRead({ status: 'unreadable', data: null, message: error?.message || '' }); });
    return () => { alive = false; };
  }, [projectId, query, reload]);
  return { ...read, query, setQuery, retry: () => setReload((n) => n + 1) };
}

/** Pipeline: the investors, each opening its record. CRL2's board is part 4's. */
function Pipeline({ projectId, search }) {
  const read = useModule(projectId);
  const recs = read.data?.records;
  return (
    <RecordsTable title="Investors" records={recs} status={read.status} query={read.query} onQuery={read.setQuery} onRetry={read.retry}
      rowHref={(row) => (rowLinks(recs, row) ? recordHref('raise', SLUG, recordId(row), tabSearch(search)) : null)} />
  );
}

/** Calls: the calls for capital this venture has run, from the module read. */
function Calls({ projectId }) {
  const read = useModule(projectId);
  // D1221 (#2458), D1223 (#3222): the Calls for Capital page, off and on (CLS1–CLS3); it draws its own loading and errors (CLS12).
  return <div data-testid="caprel-calls"><CallsTab calls={read.data?.parts?.calls} status={read.status} projectId={projectId} onRetry={read.retry} /></div>;
}

/** Commitments: today's closes and pro-rata, as the old pipeline page draws them. */
function Commitments({ projectId, search = '' }) {
  const [err, setErr] = useState('');
  return (
    <div className="flex flex-col gap-4" data-testid="caprel-commitments">
      {err && <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300" data-testid="caprel-commitments-error">{err}</p>}
      {/* D1213 (#2424): the round's closing room (CP1). */}
      <p className="m-0 text-[13px]"><Link to={tabHref(CLOSING, search)} className="font-semibold underline" data-testid="caprel-closing-door">Open the closing room</Link> for the paper, the lines and what is received.</p>
      <RoundClosesPanel projectId={projectId} onError={setErr} />
      <ProRataPanel projectId={projectId} onError={setErr} />
    </div>
  );
}

export function CapRelTabPage({ tab, projectId, projectStatus = 'ready', onRetryProject, search = '', cards, action, phone = false }) {
  const here = TABS.find((t) => t.id === tab) || (tab === CLOSING.id ? CLOSING : TABS[0]);
  let body;
  // No venture means no read is made: say the venture list failed, never a skeleton.
  if (projectStatus === 'unreadable') body = <Unreadable what="Your ventures" claim="This is not a claim that you have none." onRetry={onRetryProject} />;
  else if (!projectId) body = <div className="h-24 animate-pulse rounded-xl bg-axal-ground dark:bg-gray-800" data-testid="caprel-loading" />;
  else if (tab === 'pipeline') body = <Pipeline projectId={projectId} search={search} />;
  else if (tab === 'calls') body = <Calls projectId={projectId} />;
  else if (tab === 'commitments') body = <Commitments projectId={projectId} search={search} />;
  else if (tab === 'closing') body = <FounderClosing projectId={projectId} search={search} />;
  else body = <Wait tab={tab} />;
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid={`caprel-${tab}-page`}>
      {phone
        ? <CycleBar back={{ label: TITLE, to: `${HOME_PATH}${tabSearch(search)}` }} title={here.label} eadwynLabel={`Raise · ${TITLE}`} />
        : <CycleHeader cycle="raise" cards={cards} active={SLUG} action={action} title={TITLE} sub={LINE} search={tabSearch(search)} />}
      <CapRelTabBar active={tab === CLOSING.id ? 'commitments' : tab} search={search} />
      {body}
    </div>
  );
}
