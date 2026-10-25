import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { safeIssuancesApi } from '../../../lib/api/safeIssuances';
import { Unreadable } from '../../../ui';
import AccessTab from './AccessTab';
import ImportExportTab from './ImportExportTab';
import { CycleHeader } from '../../cycles/CycleOverview';
import { CycleBar } from '../../cycles/PhoneModulePage';
import {
  BASIS_CHECK, CANNOT_CONVERT, HOME_NOTE, HOME_PATH, LINE, MODELLED, ON_RECORD, SLUG, TABS, TITLE,
  conversionLines, harbour, harbourTone, issuedSafes, modelInstruments, modelPool, scenarioCards,
  simulatorHref, tabHref, tabSearch, variantHref, variantsHref,
} from './capTableModel';

/**
 * D1015 (#2432) — the Cap table tool's tab bar and its tab pages. CycleRoute
 * draws Overview (the module page) with `CapTableTabBar` under its header, and
 * draws `CapTableTabPage` for the tab words under the module. Every figure
 * here comes from a read on `main`; see `capTableModel.js`.
 */

export const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
export const INK = 'text-axal-ink dark:text-gray-100';
export const MUTED = 'text-axal-muted dark:text-gray-400';
export const EYEBROW = 'text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
export const LINK = 'font-semibold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300 dark:hover:text-violet-200';
export const TH = 'px-3 py-2 text-left text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
export const TD = 'px-3 py-2 align-top text-[12.5px] text-axal-ink dark:text-gray-100';
export const MONO = 'font-mono tabular-nums';
export const AMBER = 'rounded-[10px] border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11.5px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300';
const TONE = {
  good: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300',
  warn: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300',
  bad: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300',
  muted: 'border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400',
};

/** The two tags every board uses: On record (positive, solid edge) and Modelled (muted, dashed edge). */
export function Tag({ kind }) {
  const on = kind === 'record';
  return (
    <span className={`inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[10.5px] font-bold ${on
      ? 'border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300'
      : 'border-dashed border-gray-300 text-axal-muted dark:border-gray-600 dark:text-gray-400'}`}
      data-testid={on ? 'tag-on-record' : 'tag-modelled'}>
      {on ? ON_RECORD : MODELLED}
    </span>
  );
}

/** The tool's own tabs, a second level under the Raise modules: text with an underline. */
export function CapTableTabBar({ active, search = '' }) {
  return (
    <div className="border-b border-axal-hairline dark:border-gray-700" data-testid="captable-tabs">
      <nav aria-label={TITLE} className="-mb-px flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <Link key={t.id} to={tabHref(t, search)} aria-current={t.id === active ? 'page' : undefined}
            className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-[12.5px] ${t.id === active
              ? 'border-axal-violet font-extrabold text-axal-ink dark:border-violet-400 dark:text-gray-100'
              : 'border-transparent font-semibold text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}`}
            data-testid={`captable-tab-${t.id}`}>
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

/** Overview's tab bar and the line that says its figures are the model's. */
export function CapTableHomeNav({ search = '' }) {
  return (
    <div className="flex flex-col gap-2">
      <CapTableTabBar active="overview" search={search} />
      <p className={`m-0 flex flex-wrap items-center gap-2 text-[12px] ${MUTED}`} data-testid="captable-home-note">
        <Tag kind="modelled" /> {HOME_NOTE}
      </p>
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

const readCompare = (id) => api.getCapTableCompare(id);
const readSafes = (id) => safeIssuancesApi.list(id);
const read409a = (id) => api.get409a(id);

export function Section({ title, tag, children, testId, aside }) {
  return (
    <section className={CARD} data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-axal-hairline px-4 py-3 dark:border-gray-800">
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
        <thead><tr className="border-b border-axal-hairline dark:border-gray-800">{cols.map((c) => <th key={c.key} className={TH}>{c.label}</th>)}</tr></thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
}

function InstrumentsTab({ projectId, reload, retry, search }) {
  const safes = useRead(readSafes, projectId, reload);
  const model = useRead(readCompare, projectId, reload);
  const issued = safes.status === 'ready' ? issuedSafes(safes.data) : [];
  const canonical = model.status === 'ready' ? model.data?.canonical || null : null;
  const instruments = modelInstruments(canonical);
  const conv = conversionLines(canonical);
  return (
    <div className="flex flex-col gap-3.5">
      <Section title="Sent through StudioOS" testId="captable-issued">
        <ReadState read={safes} what="Your SAFEs" claim="This is not a claim that none were sent." onRetry={retry} testId="captable-issued">
          {issued.length === 0
            ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="captable-issued-none">No SAFE has been sent through StudioOS for this venture.</p>
            : (
              <Table testId="captable-issued-table"
                cols={[{ key: 'h', label: 'Holder' }, { key: 'a', label: 'Amount' }, { key: 'c', label: 'Cap' }, { key: 'd', label: 'Discount' }, { key: 'b', label: 'Basis' }, { key: 's', label: 'Status' }, { key: 'r', label: '' }]}
                rows={issued.map((s) => (
                  <tr key={s.uid} className="border-b border-axal-ground last:border-b-0 dark:border-gray-800" data-testid="captable-issued-row">
                    <td className={TD}>{s.holder}</td>
                    <td className={`${TD} ${MONO}`}>{s.amount}</td>
                    <td className={`${TD} ${MONO}`}>{s.cap}</td>
                    <td className={`${TD} ${MONO}`}>{s.discount}</td>
                    <td className={TD}>{s.basis}</td>
                    <td className={TD}>{s.status}</td>
                    <td className={TD}>{s.onRecord ? <Tag kind="record" /> : null}</td>
                  </tr>
                ))} />
            )}
        </ReadState>
      </Section>
      <Section title="In your model" tag={<Tag kind="modelled" />} testId="captable-model-instruments">
        <ReadState read={model} what="Your model" claim="This is not a claim that it holds no instruments." onRetry={retry} testId="captable-model">
          {!canonical
            ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="captable-model-none">No model is saved for this venture yet. <Link className={LINK} to={simulatorHref(search)}>Open the simulator</Link></p>
            : instruments.length === 0
              ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="captable-model-instruments-none">Your model holds no SAFE or note.</p>
              : (
                <div className="flex flex-col gap-3">
                  <Table testId="captable-model-instruments-table"
                    cols={[{ key: 'h', label: 'Holder' }, { key: 't', label: 'Type' }, { key: 'a', label: 'Amount' }, { key: 'c', label: 'Cap' }, { key: 'd', label: 'Discount' }, { key: 'b', label: 'Basis' }, { key: 'i', label: 'Interest' }, { key: 's', label: 'Signed' }]}
                    rows={instruments.map((m) => (
                      <tr key={m.key} className="border-b border-axal-ground last:border-b-0 dark:border-gray-800" data-testid="captable-model-instrument">
                        <td className={TD}>{m.holder}</td>
                        <td className={TD}>{m.type}</td>
                        <td className={`${TD} ${MONO}`}>{m.amount}</td>
                        <td className={`${TD} ${MONO}`}>{m.cap}</td>
                        <td className={`${TD} ${MONO}`}>{m.discount}</td>
                        <td className={TD}>
                          <span className="flex flex-col gap-1">{m.basis}{m.check ? <span className={AMBER} data-testid="captable-basis-check">{BASIS_CHECK}</span> : null}</span>
                          {m.cannotConvert ? <span className={`mt-1 block text-[11.5px] ${MUTED}`} data-testid="captable-cannot-convert">{CANNOT_CONVERT}</span> : null}
                        </td>
                        <td className={`${TD} ${MONO}`}>{m.interest ?? '—'}</td>
                        <td className={`${TD} ${MONO}`}>{m.signed}</td>
                      </tr>
                    ))} />
                  {conv ? (
                    <div className="flex flex-col gap-1" data-testid="captable-conversion">
                      <span className={EYEBROW}>How they convert in {conv.round}</span>
                      {conv.lines.length
                        ? conv.lines.map((l, i) => <span key={i} className={`font-mono text-[12px] ${INK}`}>{l}</span>)
                        : <span className={`text-[12px] ${MUTED}`}>The model’s round converts nothing.</span>}
                    </div>
                  ) : <p className={`m-0 text-[12px] ${MUTED}`} data-testid="captable-no-round">No round is planned, so nothing converts yet. Plan one in Scenarios.</p>}
                </div>
              )}
        </ReadState>
      </Section>
    </div>
  );
}

function OptionPoolTab({ projectId, reload, retry, search }) {
  const valuation = useRead(read409a, projectId, reload);
  const model = useRead(readCompare, projectId, reload);
  const h = valuation.status === 'ready' ? harbour(valuation.data) : null;
  const pool = model.status === 'ready' ? modelPool(model.data?.canonical || null) : null;
  return (
    <div className="flex flex-col gap-3.5">
      <Section title="409A safe harbour" testId="captable-409a">
        <ReadState read={valuation} what="The 409A" claim="This is not a claim that none is on file." onRetry={retry} testId="captable-409a">
          {h ? (
            <div className="flex flex-col gap-2">
              <span className={`w-fit rounded-full border px-2.5 py-0.5 text-[11.5px] font-bold ${TONE[harbourTone(h.state)]}`} data-testid="captable-409a-status">{h.reason}</span>
              <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-1 text-[12.5px] sm:grid-cols-4">
                {[['FMV per common share', h.fmv], ['Valuation date', h.valued], ['Valid until', h.expires], ['Provider', h.provider]].map(([k, v]) => (
                  <div key={k} className="flex flex-col"><dt className={EYEBROW}>{k}</dt><dd className={`m-0 ${MONO} ${INK}`}>{v}</dd></div>
                ))}
              </dl>
              <Link className={`${LINK} text-[12px]`} to={simulatorHref(search)}>Record a valuation or an event on the cap table page</Link>
            </div>
          ) : <div data-testid="captable-409a-unreadable"><Unreadable what="The 409A" claim="This is not a claim that none is on file." onRetry={retry} /></div>}
        </ReadState>
      </Section>
      <Section title="The pool in your model" tag={<Tag kind="modelled" />} testId="captable-pool">
        <ReadState read={model} what="Your model" claim="This is not a claim that it has no pool." onRetry={retry} testId="captable-pool-model">
          {pool ? (
            <dl className="m-0 grid grid-cols-3 gap-x-6 text-[12.5px]">
              {[['Target', pool.target], ['Shares', pool.shares], ['Fully diluted', pool.pct]].map(([k, v]) => (
                <div key={k} className="flex flex-col"><dt className={EYEBROW}>{k}</dt><dd className={`m-0 ${MONO} ${INK}`}>{v}</dd></div>
              ))}
            </dl>
          ) : <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="captable-pool-none">No model is saved for this venture yet.</p>}
        </ReadState>
      </Section>
      <Section title="Grants and vesting" testId="captable-grants">
        <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="captable-grants-wait">Not read here yet. Grants and vesting are stored per account, not per venture, so they cannot be shown for one venture.</p>
      </Section>
    </div>
  );
}

function ScenariosTab({ projectId, reload, retry, search }) {
  const read = useRead(readCompare, projectId, reload);
  const cards = read.status === 'ready' ? scenarioCards(read.data) : [];
  return (
    <Section title="Scenarios" tag={<Tag kind="modelled" />} testId="captable-scenarios"
      aside={<span className="flex gap-3 text-[12px]"><Link className={LINK} to={simulatorHref(search)}>Open the simulator</Link><Link className={LINK} to={variantsHref(search)}>Draft variants</Link></span>}>
      <ReadState read={read} what="Your scenarios" claim="This is not a claim that none are saved." onRetry={retry} testId="captable-scenarios">
        {cards.length === 0
          ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="captable-scenarios-none">No scenarios yet. A scenario starts from your saved model.</p>
          : (
            <div className="grid gap-2.5 md:grid-cols-2">
              {cards.map((s) => (
                <Link key={s.uid || s.name} to={s.model ? simulatorHref(search) : variantHref(s.uid)}
                  className={`${CARD} flex flex-col gap-1 px-3.5 py-3 hover:border-axal-violet`} data-testid="captable-scenario-card">
                  <span className={`text-[13.5px] font-extrabold ${INK}`}>{s.name}</span>
                  <span className={`text-[12px] ${MUTED}`}>{s.round}</span>
                  <span className={`text-[12px] ${INK}`}>Founders after <span className={MONO}>{s.founders}</span></span>
                  <span className={`text-[11.5px] ${MUTED}`}>Changed {s.changed}{s.computed ? '' : ' · not computed'}</span>
                </Link>
              ))}
            </div>
          )}
      </ReadState>
    </Section>
  );
}

export function CapTableTabPage({ tab, projectId, projectStatus = 'ready', onRetryProject, search = '', cards, action, phone = false }) {
  const [reload, setReload] = useState(0);
  const retry = useCallback(() => setReload((n) => n + 1), []);
  const here = TABS.find((t) => t.id === tab) || TABS[0];
  let body;
  // No venture means no read is made: say the venture list failed, never a skeleton.
  if (projectStatus === 'unreadable') body = <Unreadable what="Your ventures" claim="This is not a claim that you have none." onRetry={onRetryProject} />;
  else if (!projectId) body = <Skeleton testId="captable-loading" />;
  else if (tab === 'instruments') body = <InstrumentsTab projectId={projectId} reload={reload} retry={retry} search={search} />;
  else if (tab === 'option-pool') body = <OptionPoolTab projectId={projectId} reload={reload} retry={retry} search={search} />;
  else if (tab === 'access') body = <AccessTab projectId={projectId} reload={reload} retry={retry} />;
  else if (tab === 'import-export') body = <ImportExportTab projectId={projectId} reload={reload} retry={retry} search={search} />;
  else body = <ScenariosTab projectId={projectId} reload={reload} retry={retry} search={search} />;
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid={`captable-${tab}-page`}>
      {phone
        ? <CycleBar back={{ label: TITLE, to: `${HOME_PATH}${tabSearch(search)}` }} title={here.label} eadwynLabel={`Raise · ${TITLE}`} />
        : <CycleHeader cycle="raise" cards={cards} active={SLUG} action={action} title={TITLE} sub={LINE} search={tabSearch(search)} />}
      <CapTableTabBar active={tab} search={search} />
      {body}
    </div>
  );
}
