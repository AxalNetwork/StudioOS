import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { cyclesApi } from '../../../lib/api/cycles';
import { Unreadable } from '../../../ui';
import { CycleHeader } from '../../cycles/CycleOverview';
import { CycleBar } from '../../cycles/PhoneModulePage';
import { RecordsTable } from '../../cycles/CycleModulePage';
import { recordHref, recordId, rowLinks } from '../../cycles/recordModel';
import { FORECAST_LINE, HOME_PATH, LINE, NOT_YET, SLUG, TABS, TITLE, WAITS, forecastHref, tabHref, tabSearch } from './useOfFundsModel';

/**
 * D1173 (#2455) — the Use of funds tool's tab bar and tab pages. CycleRoute
 * draws Home (the module page) with `UseOfFundsHomeNav` under its header, and
 * `UseOfFundsTabPage` for the tab words under the module. Allocation draws
 * the module read's sections; the other tabs say what they wait for.
 */

const MUTED = 'text-axal-muted dark:text-gray-400';
const LINK = 'font-semibold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300 dark:hover:text-violet-200';

/** The tool's own tabs, a second level under the Raise modules. */
export function UseOfFundsTabBar({ active, search = '' }) {
  return (
    <div className="border-b border-axal-hairline dark:border-gray-700" data-testid="uof-tabs">
      <nav aria-label={TITLE} className="-mb-px flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <Link key={t.id} to={tabHref(t, search)} aria-current={t.id === active ? 'page' : undefined}
            className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-[12.5px] ${t.id === active
              ? 'border-axal-violet font-extrabold text-axal-ink dark:border-violet-400 dark:text-gray-100'
              : 'border-transparent font-semibold text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}`}
            data-testid={`uof-tab-${t.id}`}>
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

/** Home's tab bar. */
export function UseOfFundsHomeNav({ search = '' }) {
  return <UseOfFundsTabBar active="home" search={search} />;
}

function Wait({ tab, children }) {
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-axal-hairline bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900" data-testid={`uof-wait-${tab}`}>
      <span className="w-fit rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[11px] font-bold text-axal-muted dark:border-gray-600 dark:text-gray-400">{NOT_YET}</span>
      <p className={`m-0 text-[12.5px] ${MUTED}`}>{WAITS[tab]}</p>
      {children}
    </section>
  );
}

/** Allocation: the sections from the module read, each opening its record; search, filter and sort go to the Worker. */
function Allocation({ projectId, search }) {
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
  const recs = read.data?.records;
  return (
    <RecordsTable title="Sections" records={recs} status={read.status} query={query} onQuery={setQuery}
      onRetry={() => setReload((n) => n + 1)}
      rowHref={(row) => (rowLinks(recs, row) ? recordHref('raise', SLUG, recordId(row), tabSearch(search)) : null)} />
  );
}

export function UseOfFundsTabPage({ tab, projectId, projectStatus = 'ready', onRetryProject, search = '', cards, action, phone = false }) {
  const here = TABS.find((t) => t.id === tab) || TABS[0];
  let body;
  // No venture means no read is made: say the venture list failed, never a skeleton.
  if (projectStatus === 'unreadable') body = <Unreadable what="Your ventures" claim="This is not a claim that you have none." onRetry={onRetryProject} />;
  else if (!projectId) body = <div className="h-24 animate-pulse rounded-xl bg-axal-ground dark:bg-gray-800" data-testid="uof-loading" />;
  else if (tab === 'allocation') body = <Allocation projectId={projectId} search={search} />;
  else if (tab === 'runway') {
    body = (
      <Wait tab="runway">
        <p className={`m-0 text-[12.5px] ${MUTED}`}>{FORECAST_LINE} <Link className={LINK} to={forecastHref(search)} data-testid="uof-forecast-link">Open the financial model</Link></p>
      </Wait>
    );
  } else body = <Wait tab={tab} />;
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid={`uof-${tab}-page`}>
      {phone
        ? <CycleBar back={{ label: TITLE, to: `${HOME_PATH}${tabSearch(search)}` }} title={here.label} eadwynLabel={`Raise · ${TITLE}`} />
        : <CycleHeader cycle="raise" cards={cards} active={SLUG} action={action} title={TITLE} sub={LINE} search={tabSearch(search)} />}
      <UseOfFundsTabBar active={tab} search={search} />
      {body}
    </div>
  );
}
