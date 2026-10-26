import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { capTableHolderApi } from '../../../lib/api/capTableHolder';
import { capTableRecordApi } from '../../../lib/api/capTableRecord';
import { useAuth } from '../../../hooks/useAuthSync';
import { Unreadable } from '../../../ui';
import { usePhoneWidth } from '../../../ui/phone/usePhoneWidth';
import AccessTab from './AccessTab';
import ImportExportTab from './ImportExportTab';
import HistoryTab from './HistoryTab';
import { CorrectDialog, VoidDialog } from './IssuanceDialogs';
import { CycleHeader } from '../../cycles/CycleOverview';
import { CycleBar } from '../../cycles/PhoneModulePage';
import { Tag } from './CapTableTag';
import { CapTableOverview } from './CapTableOverview';
import { holderIdOf } from './overviewModel';
import InstrumentsTab from './InstrumentsTab';
import OptionPoolTab from './OptionPoolTab';
import { ScenarioRoute, ScenariosList } from './ScenariosPages';
import {
  HOME_NOTE, HOME_PATH, LINE, PHONE_ROOT, SLUG, TABS, TITLE,
  tabHref, tabSearch,
} from './capTableModel';
import './capTable.css';

/**
 * D1015 (#2432) — the Cap table tool's tab bar and its tab pages. CycleRoute
 * draws Overview (the module page) with `CapTableTabBar` under its header, and
 * draws `CapTableTabPage` for the tab words under the module. Every figure
 * here comes from a read on `main`; see `capTableModel.js`.
 */

export const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
export const INK = 'text-axal-ink dark:text-gray-200';
export const MUTED = 'text-axal-muted dark:text-gray-400';
export const EYEBROW = 'text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
export { Tag };
export const LINK = 'font-semibold text-axal-violet hover:text-axal-violet-deep dark:text-violet-400 dark:hover:text-violet-300';
export const TH = 'px-3 py-2 text-left text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
export const TD = 'px-3 py-2 align-top text-[12.5px] text-axal-ink dark:text-gray-200';
export const MONO = 'font-mono tabular-nums';
export const AMBER = 'rounded-[10px] border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11.5px] text-amber-800 dark:border-amber-300/55 dark:bg-amber-300/10 dark:text-amber-300';

/** The tool's own tabs, a second level under the Raise modules: text with an underline. */
export function CapTableTabBar({ active, search = '' }) {
  return (
    <div className="border-b border-axal-hairline dark:border-gray-700" data-testid="captable-tabs">
      <nav aria-label={TITLE} className="-mb-px flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <Link key={t.id} to={tabHref(t, search)} aria-current={t.id === active ? 'page' : undefined}
            className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-[12.5px] ${t.id === active
              ? 'border-axal-violet font-extrabold text-axal-ink dark:border-violet-400 dark:text-gray-200'
              : 'border-transparent font-semibold text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}`}
            data-testid={`captable-tab-${t.id}`}>
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

/**
 * Overview's tab bar, the line that says which figures are the record's, and
 * (D1022) the record's blocks: the tool bar, Needs you, Who owns and the side
 * column. The module page's own Holders list and Planned round card follow, Modelled.
 */
export function CapTableHomeNav({ search = '', projectId = null }) {
  // D1028 (CT23a): below 1024px every control here is a 44px target (`capTable.css`).
  const phone = usePhoneWidth();
  return (
    <div className={`flex flex-col gap-3${phone ? ` ${PHONE_ROOT}` : ''}`} data-testid="captable-home">
      <CapTableTabBar active="overview" search={search} />
      <p className={`m-0 flex flex-wrap items-center gap-2 text-[12px] ${MUTED}`} data-testid="captable-home-note">
        <Tag kind="record" /> <Tag kind="modelled" /> {HOME_NOTE}
      </p>
      <CapTableOverview projectId={projectId} search={search} />
    </div>
  );
}

export function Skeleton({ testId }) {
  return <div className="h-24 w-full animate-pulse rounded-xl bg-axal-ground dark:bg-gray-800" aria-hidden="true" data-testid={testId} />;
}

/** One read, answering alone: loading, ready, refused (403 or 404) or error. */
export function useRead(load, projectId, reload) {
  const [state, setState] = useState({ status: 'loading', data: null });
  useEffect(() => {
    if (!projectId) return undefined;
    let alive = true;
    setState({ status: 'loading', data: null });
    Promise.resolve().then(() => load(projectId))
      .then((data) => { if (alive) setState({ status: 'ready', data }); })
      .catch((error) => { if (alive) setState({ status: [403, 404].includes(error?.status) ? 'refused' : 'error', data: null, message: error?.message || '' }); });
    return () => { alive = false; };
  }, [load, projectId, reload]);
  return state;
}

const readRecordOf = (id) => capTableRecordApi.read(id);
const readGrantsOf = (id) => capTableHolderApi.grants(id);

/**
 * D1025 (#2862, CT10): History, with the record (for the classes and the
 * currency its lines name) and the grants (who may void) read beside it. The
 * owner voids a recorded row (CT12b); an admin corrects one (CT12c).
 */
function HistoryPage({ projectId, reload, retry }) {
  const { user } = useAuth() || {};
  const record = useRead(readRecordOf, projectId, reload);
  const grants = useRead(readGrantsOf, projectId, reload);
  const [voiding, setVoiding] = useState(null);
  const [correcting, setCorrecting] = useState(null);
  const owner = grants.status === 'ready' && !!grants.data?.can_change;
  const admin = String(user?.role || '').toLowerCase() === 'admin';
  const done = () => { setVoiding(null); setCorrecting(null); retry(); };
  return (
    <>
      <HistoryTab projectId={projectId} record={record} owner={owner || admin} admin={admin} reload={reload} onVoid={setVoiding} onCorrect={setCorrecting} />
      {voiding && record.status === 'ready' ? <VoidDialog projectId={projectId} record={record.data} row={voiding} admin={admin && !owner} onClose={() => setVoiding(null)} onDone={done} /> : null}
      {correcting && record.status === 'ready' ? <CorrectDialog projectId={projectId} record={record.data} row={correcting} onClose={() => setCorrecting(null)} onDone={done} /> : null}
    </>
  );
}

export function Section({ title, tag, children, testId, aside }) {
  return (
    <section className={CARD} data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-axal-hairline px-4 py-3 dark:border-gray-700">
        <h2 className={`m-0 flex items-center gap-2 text-[15px] font-extrabold tracking-[-.015em] ${INK}`}>{title} {tag}</h2>
        {aside}
      </div>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

/** A read's own state where its block would be; the rest of the page still draws. */
export function ReadState({ read, what, claim, onRetry, testId, children }) {
  if (read.status === 'loading') return <Skeleton testId={`${testId}-loading`} />;
  if (read.status === 'refused') return <p className={`m-0 text-[13px] ${INK}`} data-testid={`${testId}-refused`}>{read.message || 'You do not have access to this venture’s cap table.'}</p>;
  if (read.status === 'error') return <div data-testid={`${testId}-unreadable`}><Unreadable what={what} claim={claim} onRetry={onRetry} /></div>;
  return children;
}

export function Table({ cols, rows, testId }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse" data-testid={testId}>
        <thead><tr className="border-b border-axal-hairline dark:border-gray-700">{cols.map((c) => <th key={c.key} className={TH}>{c.label}</th>)}</tr></thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
}

export function CapTableTabPage({ tab, proposal = null, instrument = null, scenario = null, projectId, projectStatus = 'ready', onRetryProject, search = '', cards, action, phone = false }) {
  const [reload, setReload] = useState(0);
  const retry = useCallback(() => setReload((n) => n + 1), []);
  const overlay = tab === 'new' || tab === 'proposal';
  // D1023: `/instrument/<uid>` is the instrument drawer, over Instruments.
  const onInstruments = tab === 'instrument';
  const under = tab === 'instrument' ? 'instruments' : tab === 'scenario' ? 'scenarios' : tab;
  const here = TABS.find((t) => t.id === under) || TABS[0];
  // D1022: `h-<n>` is the holder drawer, over Overview's record blocks.
  const holder = holderIdOf(tab);
  let body;
  // No venture means no read is made: say the venture list failed, never a skeleton.
  if (projectStatus === 'unreadable') body = <Unreadable what="Your ventures" claim="This is not a claim that you have none." onRetry={onRetryProject} />;
  else if (!projectId) body = <Skeleton testId="captable-loading" />;
  else if (holder != null) body = <CapTableOverview projectId={projectId} search={search} holderId={holder} />;
  // D1025: `/new` is Record an issuance and `/proposal/<id>` a proposal's drawer, each over Overview.
  else if (tab === 'new') body = <CapTableOverview projectId={projectId} search={search} open={{ kind: 'record' }} />;
  else if (tab === 'proposal') body = <CapTableOverview projectId={projectId} search={search} open={{ kind: 'proposal', id: proposal }} />;
  else if (tab === 'history') body = <HistoryPage projectId={projectId} reload={reload} retry={retry} />;
  else if (tab === 'instruments' || onInstruments) body = <InstrumentsTab projectId={projectId} reload={reload} retry={retry} search={search} openUid={onInstruments ? instrument : null} />;
  else if (tab === 'option-pool') body = <OptionPoolTab projectId={projectId} reload={reload} retry={retry} search={search} />;
  else if (tab === 'access') body = <AccessTab projectId={projectId} reload={reload} retry={retry} />;
  else if (tab === 'import-export') body = <ImportExportTab projectId={projectId} reload={reload} retry={retry} search={search} />;
  // D1024: `/scenarios/<uid>` is one scenario and `/scenarios/compare` the compare page, under the Scenarios tab.
  else if (tab === 'scenario') body = <ScenarioRoute id={scenario} projectId={projectId} reload={reload} retry={retry} search={search} />;
  else body = <ScenariosList projectId={projectId} reload={reload} retry={retry} search={search} />;
  const root = `flex min-w-0 flex-col gap-4${phone ? ` ${PHONE_ROOT}` : ''}`;
  // D1028 (CT23b): on a phone a holder is a page of its own, under a bar back to
  // the Cap table, with no tabs and nothing of Overview behind it.
  if (phone && holder != null && projectId && projectStatus !== 'unreadable') {
    return <div className={root} data-testid="captable-holder-page"><CapTableOverview projectId={projectId} search={search} holderId={holder} /></div>;
  }
  return (
    <div className={root} data-testid={holder != null ? 'captable-holder-page' : overlay ? `captable-${tab}-over-overview` : onInstruments ? 'captable-instrument-over-instruments' : `captable-${tab}-page`}>
      {phone
        ? <CycleBar back={{ label: TITLE, to: `${HOME_PATH}${tabSearch(search)}` }} title={here.label} eadwynLabel={`Raise · ${TITLE}`} />
        : <CycleHeader cycle="raise" cards={cards} active={SLUG} action={action} title={TITLE} sub={LINE} search={tabSearch(search)} />}
      <CapTableTabBar active={holder != null || overlay ? 'overview' : onInstruments ? 'instruments' : tab === 'scenario' ? 'scenarios' : tab} search={search} />
      {body}
    </div>
  );
}
