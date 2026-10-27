import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { cyclesApi } from '../../../lib/api/cycles';
import { Unreadable } from '../../../ui';
import { CycleHeader } from '../../cycles/CycleOverview';
import { CycleBar } from '../../cycles/PhoneModulePage';
import CallsTab from '../calls/CallsTab';
import { FounderClosing } from '../../closing/ClosingRoom';
import { CLOSING, HOME_PATH, LINE, SLUG, TABS, TITLE, tabHref, tabSearch } from './capRelModel';
import CapRelPipeline from './CapRelPipeline';
import CapRelMatch from './CapRelMatch';
import CapRelOutreach from './CapRelOutreach';
import CapRelCommitments from './CapRelCommitments';
import CapRelActivity from './CapRelActivity';
import { CapRelOverviewBlocks, MovedNotice } from './CapRelOverview';

/**
 * D1188 (#2457) — the Capital relationships tool's tab bar and tab pages.
 * CycleRoute draws Overview (the module page) with `CapRelHomeNav` under its
 * header, and `CapRelTabPage` for the tab words under the module. Calls draws
 * the module read. D1192 (#3126): Pipeline is the board and list
 * (`CapRelPipeline.jsx`), and Overview draws its blocks (`CapRelOverview.jsx`)
 * above the module page's own. D1193 (#3127): Match, Outreach, Commitments and
 * Activity each draw their own read (`CapRelMatch.jsx`, `CapRelOutreach.jsx`,
 * `CapRelCommitments.jsx`, `CapRelActivity.jsx`), so no tab waits any more.
 */

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

/** Overview's tab bar, the moved notice, and Overview's blocks (D1192, CRL1) above the module page's own. */
export function CapRelHomeNav({ search = '', projectId = null }) {
  return (
    <div className="flex flex-col gap-4">
      <MovedNotice />
      <CapRelTabBar active="overview" search={search} />
      {projectId ? <CapRelOverviewBlocks projectId={projectId} search={search} /> : null}
    </div>
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


/** Calls: the calls for capital this venture has run, from the module read. */
function Calls({ projectId }) {
  const read = useModule(projectId);
  // D1221 (#2458), D1223 (#3222): the Calls for Capital page, off and on (CLS1–CLS3); it draws its own loading and errors (CLS12).
  return <div data-testid="caprel-calls"><CallsTab calls={read.data?.parts?.calls} status={read.status} projectId={projectId} onRetry={read.retry} /></div>;
}

export function CapRelTabPage({ tab, projectId, projectStatus = 'ready', onRetryProject, search = '', cards, action, phone = false }) {
  const here = TABS.find((t) => t.id === tab) || (tab === CLOSING.id ? CLOSING : TABS[0]);
  let body;
  // No venture means no read is made: say the venture list failed, never a skeleton.
  if (projectStatus === 'unreadable') body = <Unreadable what="Your ventures" claim="This is not a claim that you have none." onRetry={onRetryProject} />;
  else if (!projectId) body = <div className="h-24 animate-pulse rounded-xl bg-axal-ground dark:bg-gray-800" data-testid="caprel-loading" />;
  else if (tab === 'pipeline') body = <CapRelPipeline projectId={projectId} search={search} />;
  else if (tab === 'calls') body = <Calls projectId={projectId} />;
  // D1193 (#3127): Match, Outreach, Commitments and Activity, each from its own read.
  else if (tab === 'commitments') body = <CapRelCommitments projectId={projectId} search={search} />;
  else if (tab === 'match') body = <CapRelMatch projectId={projectId} search={search} />;
  else if (tab === 'outreach') body = <CapRelOutreach projectId={projectId} search={search} />;
  else if (tab === 'activity') body = <CapRelActivity projectId={projectId} />;
  else if (tab === 'closing') body = <FounderClosing projectId={projectId} search={search} />;
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid={`caprel-${tab}-page`}>
      {phone
        ? <CycleBar back={{ label: TITLE, to: `${HOME_PATH}${tabSearch(search)}` }} title={here.label} eadwynLabel={`Raise · ${TITLE}`} />
        : <CycleHeader cycle="raise" cards={cards} active={SLUG} action={action} title={TITLE} sub={LINE} search={tabSearch(search)} />}
      <MovedNotice />
      <CapRelTabBar active={tab === CLOSING.id ? 'commitments' : tab} search={search} />
      {body}
    </div>
  );
}
