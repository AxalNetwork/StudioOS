import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { cyclesApi } from '../../../lib/api/cycles';
import { useOfFundsApi } from '../../../lib/api/useOfFunds';
import { Unreadable, usePhoneWidth } from '../../../ui';
import { CycleHeader } from '../../cycles/CycleOverview';
import { CycleBar } from '../../cycles/PhoneModulePage';
import MercuryRaiseFeed from '../../cycles/MercuryRaiseFeed';
import { recordHref } from '../../cycles/recordModel';
import {
  FORECAST_LINE, HOME_PATH, LINE, NOT_RECORDED, SECTIONS, SLUG, TABS, TITLE, afterRaiseView, baseOf, dayText,
  forecastHref, historyRows, homeTiles, initials, money, monthsText, needsRows, planEmpty, planVsActual, runwayCandidates,
  runwayTodayView, sectionOf, sectionRows, tabHref, tabSearch, tiesRows,
} from './useOfFundsModel';
import {
  AddMilestoneDialog, AdminBanner, BTN, BTN_GHOST, BlockError, Card, CashLine, ChartToggle, Columns, EYEBROW, EditSplitDialog,
  FIELD, H3, LINK, MONO, MUTED, NotRecorded, Pill, RoundSizeDialog, SECTION_BG, Skeleton, Source, StackBar, WhereUsedDialog,
  useRead, usePlan,
} from './UseOfFundsParts';
import { Compare, Forecast, Scenarios } from './ScenariosForecast';

/**
 * D1173 (#2455) — the Use of funds tool's tab bar and tab pages. CycleRoute
 * draws Home (the module page) with `UseOfFundsHomeNav` under its header, and
 * `UseOfFundsTabPage` for the tab words under the module.
 *
 * D1177 (#3104): each tab draws D1176's reads. Home (UF1) has the four tiles,
 * where the money goes, cash over time, where the plan is used and Needs you;
 * Allocation (UF2–UF4) the split, each section's hires against its amount and
 * its actual share, and Edit split; Milestones and hires (UF5, UF6); Runway
 * (UF7); Plan vs actual (UF12); History (UF15). Runway today is never the
 * forecast; a missing input is Not recorded; an admin works under a banner.
 *
 * D1178 (#3105): Scenarios (UF9) and Scenarios compared (UF10, UF11), and
 * Runway › Forecast (UF8), drawn from `ScenariosForecast.jsx`. A `sub` names
 * the page under a tab: `compare` under Scenarios, `forecast` under Runway.
 * No tab waits any more.
 */

/** The tool's own tabs, a second level under the Raise modules. */
export function UseOfFundsTabBar({ active, search = '' }) {
  return (
    <div className="border-b border-axal-hairline dark:border-gray-700" data-testid="uof-tabs">
      <nav aria-label={TITLE} className="-mb-px flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <Link key={t.id} to={tabHref(t, search)} aria-current={t.id === active ? 'page' : undefined}
            className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-[12.5px] max-md:min-h-[44px] ${t.id === active
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

/** The plan's state above every tab: loading, unreadable (UF19a), the admin banner (UF16) and Mercury's partial (UF19b). */
function PlanFrame({ read, children, testId }) {
  if (read.status === 'loading' && !read.data) {
    return (
      <div className="flex flex-col gap-3" data-testid={`${testId}-loading`}>
        <div className="grid gap-3 max-md:grid-cols-2 md:grid-cols-4">{['Raise', 'Runway today', 'Runway after the raise', 'Committed'].map((l) => (
          <div key={l} className="rounded-xl border border-axal-hairline bg-white px-3 py-3 dark:border-gray-800 dark:bg-gray-900"><div className={EYEBROW}>{l}</div>
            <span className="mt-2 block h-6 w-3/5 animate-pulse rounded bg-gray-100 dark:bg-gray-800" aria-hidden="true" /><div className={`mt-1 text-[11.5px] ${MUTED}`}>Reading…</div></div>
        ))}</div>
        <Skeleton lines={3} />
      </div>
    );
  }
  if (read.status === 'unreadable') {
    return <BlockError text="Use of funds could not be read. Nothing here is a zero. Edit split is off until the plan reads." onRetry={read.reload} testId={`${testId}-unreadable`} />;
  }
  const plan = read.data;
  return (
    <div className="flex flex-col gap-3">
      <AdminBanner viewer={plan?.viewer} />
      {plan?.runway_today?.partial ? (
        <BlockError tone="amber" testId="uof-mercury-partial"
          text={plan.runway_today.chosen ? 'Mercury could not be read. Runway today falls back to your metrics snapshot. The rest of the page reads as usual.' : 'Mercury could not be read. The rest of the page reads as usual.'}
          onRetry={read.reload} />
      ) : null}
      {children(plan)}
    </div>
  );
}

function Tile({ tile }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-axal-hairline bg-white px-3 py-3 dark:border-gray-800 dark:bg-gray-900" data-testid={`uof-tile-${tile.key}`}>
      <span className={EYEBROW}>{tile.label}</span>
      {tile.value
        ? <span className={`${tile.muted ? `text-[15px] ${MUTED}` : `${MONO} text-[24px] font-extrabold text-axal-ink max-md:text-[20px] dark:text-gray-100`}`} data-testid={`uof-tile-${tile.key}-value`}>{tile.value}</span>
        : <span className={`text-[15px] ${MUTED}`} data-testid={`uof-tile-${tile.key}-value`}>{NOT_RECORDED}</span>}
      <span className={`text-[11.5px] ${MUTED}`}>{tile.sub}</span>
    </div>
  );
}

function Tiles({ plan }) {
  return <div className="grid gap-3 max-md:grid-cols-2 md:grid-cols-4" data-testid="uof-tiles">{homeTiles(plan).map((t) => <Tile key={t.key} tile={t} />)}</div>;
}

/** The section table (UF1): share, amount, a month over the target, its milestone and its hires. */
function SectionTable({ rows, base, search, testId = 'uof-sections' }) {
  const target = base?.target_runway_months;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-left text-[12.5px]" data-testid={testId}>
        <thead><tr>{['Section', 'Share', 'Amount', target ? `A month over ${target} months` : 'A month', 'Milestone', 'Hires'].map((h) => (
          <th key={h} className={`border-b border-axal-hairline px-2 py-1.5 dark:border-gray-800 ${EYEBROW}`}>{h}</th>))}</tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.key} data-testid="uof-section-row">
            <td className="border-b border-axal-hairline px-2 py-1.5 dark:border-gray-800">
              <Link to={recordHref('raise', SLUG, r.key, tabSearch(search))} className={`${LINK} inline-flex items-center gap-1.5`}><span className={`h-2 w-2 rounded-full ${SECTION_BG[r.key]}`} aria-hidden="true" />{r.label}</Link>
            </td>
            <td className={`border-b border-axal-hairline px-2 py-1.5 ${MONO} dark:border-gray-800`}>{r.share != null ? `${r.share}%` : <NotRecorded />}</td>
            <td className={`border-b border-axal-hairline px-2 py-1.5 ${MONO} dark:border-gray-800`}>{money(r.amountCents, base?.currency) || <NotRecorded />}</td>
            <td className={`border-b border-axal-hairline px-2 py-1.5 ${MONO} dark:border-gray-800`}>{money(r.monthlyCents, base?.currency) || <NotRecorded />}</td>
            <td className="border-b border-axal-hairline px-2 py-1.5 dark:border-gray-800">{r.milestone ? <>{r.milestone.label}<span className={`block text-[11px] ${MUTED}`}>{r.milestone.by ? `by ${r.milestone.by}` : 'No date recorded'}</span></> : <span className={MUTED}>None yet</span>}</td>
            <td className={`border-b border-axal-hairline px-2 py-1.5 ${MONO} dark:border-gray-800`}>{r.hires == null ? <span className={MUTED}>Unreadable</span> : r.hires || <span className={MUTED}>None</span>}</td>
          </tr>
        ))}</tbody>
      </table>
      <p className={`m-0 mt-1 text-[11.5px] ${MUTED}`}>A row opens its section.</p>
    </div>
  );
}

/** Cash over time (UF1) and the cash path (UF7): the model's path, with its table. */
function CashCard({ base, title, testId }) {
  const [view, setView] = useState('chart');
  const path = base?.model?.cashPath;
  const cashOut = base?.model?.cashOut?.value;
  const points = Array.isArray(path?.value) ? path.value.map((p) => ({ month: p.month, cents: p.closingCents, raised: p.raisedCents, spend: p.spendCents })) : null;
  const outAt = cashOut?.withinHorizon && points ? Math.min(points.length - 1, Math.ceil(cashOut.months)) : null;
  return (
    <Card title={title} testId={testId} meta={<span className="flex items-center gap-2"><Source source="Modelled" />{points ? <ChartToggle id={testId} view={view} onChange={setView} /> : null}</span>}>
      {!points ? <NotRecorded reason={path?.reason || 'The cash path is Not recorded.'} testId={`${testId}-none`} />
        : view === 'table' ? (
          <div className="max-h-64 overflow-auto">
            <table className="w-full border-collapse text-left text-[12px]" data-testid={`${testId}-table`}>
              <thead><tr>{['Month', 'Raised', 'Planned spend', 'Cash at month end'].map((h) => <th key={h} className={`border-b border-axal-hairline px-2 py-1 dark:border-gray-800 ${EYEBROW}`}>{h}</th>)}</tr></thead>
              <tbody>{points.map((p) => <tr key={p.month}><td className={`px-2 py-1 ${MONO}`}>{p.month}</td><td className={`px-2 py-1 ${MONO}`}>{money(p.raised, base.currency)}</td><td className={`px-2 py-1 ${MONO}`}>{money(p.spend, base.currency)}</td><td className={`px-2 py-1 ${MONO}`}>{money(p.cents, base.currency)}</td></tr>)}</tbody>
            </table>
          </div>
        ) : (
          <>
            <CashLine points={points} marker={outAt} testId={`${testId}-chart`}
              label={`Modelled cash from ${points[0].month} to ${points[points.length - 1].month}${outAt != null ? `; cash runs out in ${points[outAt].month}` : '; it does not run out within the model'}.`} />
            <p className={`m-0 text-[11.5px] ${MUTED}`} data-testid={`${testId}-foot`}>
              {outAt != null ? `Cash out ${points[outAt].month}. ` : `Cash lasts at least to ${points[points.length - 1].month}. `}
              The raise is counted in the month it is recorded to arrive. Without the raise is not modelled yet.
            </p>
          </>
        )}
    </Card>
  );
}

function NeedsCard({ plan, onAct }) {
  const rows = needsRows(plan);
  return (
    <Card title="Needs attention" meta={<span className={`${MONO} text-amber-700 dark:text-amber-300`}>{rows.length}</span>} testId="uof-needs">
      {rows.length === 0 ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="uof-needs-none">Nothing needs you in this plan.</p> : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {rows.map((r) => (
            <li key={r.code} className="flex flex-col gap-1 border-t border-axal-hairline pt-2 first:border-0 first:pt-0 dark:border-gray-800" data-testid={`uof-need-${r.code}`}>
              <Pill tone={r.pill.startsWith('!') ? 'amber' : 'dashed'}>{r.pill}</Pill>
              <span className="text-[12.5px] text-axal-ink dark:text-gray-100">{r.text}</span>
              {r.button && plan?.viewer?.can_write ? <button type="button" className={`${BTN_GHOST} w-fit`} onClick={() => onAct(r.button.act)} data-testid={`uof-need-${r.code}-act`}>{r.button.text}</button> : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function TiesCard({ plan, onOpen }) {
  const rows = tiesRows(plan);
  return (
    <Card title="Where this plan is used" testId="uof-ties">
      {rows.map((r) => (
        <div key={r.key} className="flex flex-col gap-1 border-t border-axal-hairline pt-2 first:border-0 first:pt-0 dark:border-gray-800" data-testid={`uof-tie-${r.key}`}>
          <span className={EYEBROW}>{r.eyebrow}</span>
          <span className="text-[12.5px] font-bold text-axal-ink dark:text-gray-100">{r.text}</span>
          {r.sub ? <span className={`text-[11.5px] ${MUTED}`}>{r.sub}</span> : null}
          {r.pill ? <Pill tone={r.tone}>{r.pill}</Pill> : null}
        </div>
      ))}
      <button type="button" className={`${BTN_GHOST} w-fit`} onClick={onOpen} data-testid="uof-ties-open">Open</button>
    </Card>
  );
}

/** Home (UF1, UF16, UF17, UF22): under the module's header, above the module's own parts. */
export function UseOfFundsHome({ projectId, search = '', api = useOfFundsApi }) {
  const read = usePlan(projectId, api);
  const phone = usePhoneWidth();
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState('');
  const saved = (text) => { setDialog(null); setNotice(text); read.reload(); };
  if (!projectId) return null;
  return (
    <div className="mt-3 flex flex-col gap-3" data-testid="uof-home">
      <PlanFrame read={read} testId="uof-home">
        {(plan) => {
          const base = baseOf(plan);
          const rows = sectionRows(base, base?.hires?.state === 'ok' ? base.hires.items : null);
          const act = (a) => (a === 'edit' ? setDialog('split') : a === 'round' ? setDialog('round') : a === 'deck' ? setDialog('ties') : null);
          if (planEmpty(plan)) {
            return (
              <>
                <Tiles plan={plan} />
                <div className="grid gap-3 md:grid-cols-3">
                  <Card title="Where the money goes" className="md:col-span-2"><StackBar rows={rows} /></Card>
                  <Card testId="uof-empty">
                    <div className="flex flex-col items-center gap-2 py-4 text-center">
                      <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-full bg-violet-50 text-axal-violet dark:bg-violet-950 dark:text-violet-300">○</span>
                      <h3 className={H3}>Set your raise and split to see what it buys.</h3>
                      <p className={`m-0 text-[12.5px] ${MUTED}`}>Start with Edit split.</p>
                      {plan.viewer?.can_write ? <button type="button" className={BTN} onClick={() => setDialog('split')} data-testid="uof-empty-edit">Edit split</button> : null}
                    </div>
                  </Card>
                </div>
                {dialog === 'split' ? <EditSplitDialog projectId={projectId} base={base} viewer={plan.viewer} api={api} onClose={() => setDialog(null)} onSaved={saved} /> : null}
              </>
            );
          }
          return (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone="violet">Base · {base?.name || 'Base'}</Pill>
                {plan.viewer?.can_write ? <button type="button" className={`${BTN} max-md:flex-1`} onClick={() => setDialog('split')} data-testid="uof-edit-split-open">Edit split</button> : null}
              </div>
              {notice ? <p role="status" className="m-0 text-[12.5px] font-semibold text-emerald-700 dark:text-emerald-300" data-testid="uof-notice">{notice}</p> : null}
              <Tiles plan={plan} />
              <div className="grid gap-3 md:grid-cols-3">
                <div className="flex min-w-0 flex-col gap-3 md:col-span-2">
                  <Card title="Where the money goes" meta={money(base?.amount_to_raise_cents, base?.currency) ? `${money(base.amount_to_raise_cents, base.currency)} · base scenario` : null} testId="uof-money">
                    <StackBar rows={rows} currency={base?.currency} />
                    {!phone ? <SectionTable rows={rows} base={base} search={search} /> : null}
                  </Card>
                  {!phone ? (plan.viewer?.mercury === false && plan.runway_today?.sources?.mercury?.state === 'founder_only'
                    ? <p className={`m-0 rounded-lg border border-axal-hairline px-3 py-2 text-[12.5px] ${MUTED} dark:border-gray-800`} data-testid="uof-cash-founder-only">Cash over time uses the founder’s own figures. Mercury figures are visible to the founder only.</p>
                    : <CashCard base={base} title="Cash over time" testId="uof-cash" />) : null}
                </div>
                <div className="flex min-w-0 flex-col gap-3">
                  {!phone ? <TiesCard plan={plan} onOpen={() => setDialog('ties')} /> : null}
                  <NeedsCard plan={plan} onAct={act} />
                </div>
              </div>
              {dialog === 'split' ? <EditSplitDialog projectId={projectId} base={base} viewer={plan.viewer} api={api} onClose={() => setDialog(null)} onSaved={saved} /> : null}
              {dialog === 'ties' ? <WhereUsedDialog plan={plan} rows={tiesRows(plan)} onClose={() => setDialog(null)} onRound={() => setDialog('round')} /> : null}
              {dialog === 'round' ? <RoundSizeDialog projectId={projectId} plan={plan} api={api} onClose={() => setDialog(null)} onSaved={saved} /> : null}
            </>
          );
        }}
      </PlanFrame>
    </div>
  );
}

/** Home's tab bar, and D1177's Home blocks under it. */
export function UseOfFundsHomeNav({ search = '', projectId = null, api }) {
  return (
    <>
      <UseOfFundsTabBar active="home" search={search} />
      {projectId ? <UseOfFundsHome projectId={projectId} search={search} api={api} /> : null}
    </>
  );
}

/** The module read: its Mercury part (founder only) feeds Allocation's actual share and Plan vs actual. */
const useModule = (projectId) => useRead(() => cyclesApi.module('raise', projectId, SLUG, {}), projectId ? `module:${projectId}` : null);

/** Allocation (UF2–UF4): the split, each section against its hires and its actual share, and Edit split. */
function Allocation({ projectId, search, api, phone }) {
  const read = usePlan(projectId, api);
  const mod = useModule(projectId);
  const [dialog, setDialog] = useState(false);
  const [notice, setNotice] = useState('');
  const [view, setView] = useState('chart');
  return (
    <PlanFrame read={read} testId="uof-allocation">
      {(plan) => {
        const base = baseOf(plan);
        const rows = sectionRows(base, base?.hires?.state === 'ok' ? base.hires.items : null);
        const mercury = mod.data?.parts?.mercury;
        const actual = planVsActual(base, mercury, 3);
        const over = rows.filter((r) => r.overBudget);
        return (
          <>
            {notice ? <p role="status" className="m-0 text-[12.5px] font-semibold text-emerald-700 dark:text-emerald-300" data-testid="uof-notice">{notice}</p> : null}
            <div className="grid gap-3 md:grid-cols-3">
              <div className="flex min-w-0 flex-col gap-3 md:col-span-2">
                <Card title="The split" meta={<ChartToggle id="uof-split" view={view} onChange={setView} />} testId="uof-split-card">
                  {view === 'chart' ? <StackBar rows={rows} currency={base?.currency} testId="uof-split-stack" /> : (
                    <table className="w-full border-collapse text-left text-[12.5px]" data-testid="uof-split-table">
                      <tbody>{rows.map((r) => <tr key={r.key}><td className="px-2 py-1">{r.label}</td><td className={`px-2 py-1 ${MONO}`}>{r.share != null ? `${r.share}%` : NOT_RECORDED}</td><td className={`px-2 py-1 ${MONO}`}>{money(r.amountCents, base?.currency) || NOT_RECORDED}</td></tr>)}</tbody>
                    </table>
                  )}
                </Card>
                {phone ? (
                  <Card title="Sections" testId="uof-section-list">
                    <ul className="m-0 flex list-none flex-col p-0">{rows.map((r) => (
                      <li key={r.key} className="flex items-center gap-2 border-t border-axal-hairline py-2 first:border-0 dark:border-gray-800">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${SECTION_BG[r.key]}`} aria-hidden="true" />
                        <span className="min-w-0 flex-1"><span className="block text-[13px] font-bold text-axal-ink dark:text-gray-100">{r.label}</span>
                          <span className={`${MONO} text-[11.5px] ${MUTED}`}>{r.share != null ? `${r.share}%` : NOT_RECORDED} · {money(r.amountCents, base?.currency) || NOT_RECORDED} · {money(r.monthlyCents, base?.currency) ? `${money(r.monthlyCents, base?.currency)} a month` : 'a month Not recorded'}</span></span>
                        <Link to={recordHref('raise', SLUG, r.key, tabSearch(search))} aria-label={`Open ${r.label}`} className={`${BTN_GHOST} w-11`}>›</Link>
                      </li>
                    ))}</ul>
                  </Card>
                ) : (
                  <Card title="Allocation" testId="uof-allocation-table">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[860px] border-collapse text-left text-[12.5px]">
                        <thead><tr>{['Section', 'Share', 'Amount', `Monthly over ${base?.target_runway_months ?? '—'} months`, 'Milestones', 'Hires', 'Hires’ cost against the amount', 'Actual share · last 3 months'].map((h) => (
                          <th key={h} className={`border-b border-axal-hairline px-2 py-1.5 dark:border-gray-800 ${EYEBROW}`}>{h}</th>))}</tr></thead>
                        <tbody>{rows.map((r) => {
                          const a = actual.rows.find((x) => x.key === r.key);
                          return (
                            <tr key={r.key} data-testid="uof-allocation-row">
                              <td className="border-b border-axal-hairline px-2 py-1.5 dark:border-gray-800"><Link className={LINK} to={recordHref('raise', SLUG, r.key, tabSearch(search))}>{r.label}</Link></td>
                              <td className={`border-b border-axal-hairline px-2 py-1.5 ${MONO} dark:border-gray-800`}>{r.share != null ? `${r.share}%` : <NotRecorded />}</td>
                              <td className={`border-b border-axal-hairline px-2 py-1.5 ${MONO} dark:border-gray-800`}>{money(r.amountCents, base?.currency) || <NotRecorded />}</td>
                              <td className={`border-b border-axal-hairline px-2 py-1.5 ${MONO} dark:border-gray-800`}>{money(r.monthlyCents, base?.currency) || <NotRecorded />}</td>
                              <td className={`border-b border-axal-hairline px-2 py-1.5 ${MONO} dark:border-gray-800`}>{r.milestones || <span className={MUTED}>None</span>}</td>
                              <td className={`border-b border-axal-hairline px-2 py-1.5 ${MONO} dark:border-gray-800`}>{r.hires == null ? <span className={MUTED}>Unreadable</span> : r.hires || <span className={MUTED}>None</span>}</td>
                              <td className="border-b border-axal-hairline px-2 py-1.5 dark:border-gray-800">{!r.hires ? <span className={MUTED}>No hires</span>
                                : <span className={r.overBudget ? 'font-bold text-amber-800 dark:text-amber-300' : ''}>{money(r.hireCostCents, base?.currency) || NOT_RECORDED} of {money(r.amountCents, base?.currency) || NOT_RECORDED}<span className={`block text-[11px] ${MUTED}`}>a year</span></span>}</td>
                              <td className={`border-b border-axal-hairline px-2 py-1.5 ${MONO} dark:border-gray-800`} data-testid={`uof-actual-${r.key}`}>{a?.actual != null ? <>{`${a.actual}%`}<span className={`block text-[11px] ${MUTED}`}>⇄ Connector · Mercury</span></> : <span className={MUTED}>{plan.viewer?.mercury === false ? 'Founder only' : NOT_RECORDED}</span>}</td>
                            </tr>
                          );
                        })}</tbody>
                      </table>
                    </div>
                    <p className={`m-0 text-[11.5px] ${MUTED}`}>Actual share reads Mercury for the last 3 months, from the categories you mapped. A measured 0% means nothing was spent from it. A row opens its section.</p>
                  </Card>
                )}
                {over.map((r) => (
                  <BlockError key={r.key} tone="amber" testId={`uof-over-${r.key}`}
                    text={`${r.label}: hires cost ${money(r.hireCostCents, base?.currency)} a year; this section has ${money(r.amountCents, base?.currency)}. The split still saves; the warning stays until the hires fit.`} />
                ))}
              </div>
              <Card title="Edit split" testId="uof-edit-card">
                <p className={`m-0 text-[12.5px] ${MUTED}`}>Change the raise, the five shares and your target runway in one dialog. The deck’s Ask slide is marked out of sync when you save.</p>
                <div className="flex items-center justify-between text-[12.5px]"><span>Your target runway</span><span className={MONO}>{base?.target_runway_months ? `${base.target_runway_months} months` : NOT_RECORDED}</span></div>
                {plan.viewer?.can_write ? <button type="button" className={BTN_GHOST} onClick={() => setDialog(true)} data-testid="uof-edit-split-open">Edit split</button> : null}
              </Card>
            </div>
            {dialog ? <EditSplitDialog projectId={projectId} base={base} viewer={plan.viewer} api={api} onClose={() => setDialog(false)} onSaved={(t) => { setDialog(false); setNotice(t); read.reload(); }} /> : null}
          </>
        );
      }}
    </PlanFrame>
  );
}

/** Milestones and hires (UF5, UF6): the summary, payroll from planned hires, and both tables. */
function Milestones({ projectId, search, api }) {
  const read = usePlan(projectId, api);
  const [q, setQ] = useState('');
  const [section, setSection] = useState('');
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState('');
  return (
    <PlanFrame read={read} testId="uof-milestones">
      {(plan) => {
        const base = baseOf(plan);
        const model = base?.model;
        const states = new Map((model?.milestones?.value || []).map((m) => [String(m.id), m.state]));
        const ms = (base?.milestones || [])
          .filter((m) => (!section || m.category_key === section) && (!q.trim() || String(m.label).toLowerCase().includes(q.trim().toLowerCase())))
          .sort((a, b) => String(a.due_on || '9999').localeCompare(String(b.due_on || '9999')));
        const hiresOk = base?.hires?.state === 'ok';
        const hires = hiresOk ? base.hires.items.filter((h) => !section || h.category_key === section) : [];
        const out = model?.cashOut?.value;
        const outMonth = out?.withinHorizon && model?.cashPath?.value ? model.cashPath.value[Math.min(model.cashPath.value.length - 1, Math.ceil(out.months))]?.month : null;
        // Payroll a month: the model's per-section payroll, summed; each change is one step.
        const payroll = model?.sections?.every((s) => Array.isArray(s.payroll?.value)) && model.burn?.value
          ? model.burn.value.map((b, i) => ({ month: b.month, cents: model.sections.reduce((a, s) => a + s.payroll.value[i], 0) })) : null;
        const steps = payroll ? payroll.filter((p, i) => i === 0 || p.cents !== payroll[i - 1].cents) : null;
        return (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2" data-testid="uof-ms-summary">
              <span className={`${MONO} text-[12.5px] text-axal-ink dark:text-gray-100`}>{(base?.milestones || []).length} milestones · {hiresOk ? base.hires.items.length : '—'} hires · {outMonth ? `cash out ${outMonth}` : 'cash out not modelled'}</span>
              {plan.viewer?.can_write ? <button type="button" className={BTN} onClick={() => setAdding(true)} data-testid="uof-add-milestone-open">Add milestone</button> : null}
            </div>
            {notice ? <p role="status" className="m-0 text-[12.5px] font-semibold text-emerald-700 dark:text-emerald-300" data-testid="uof-notice">{notice}</p> : null}
            <Card title="Payroll from planned hires" meta={<Source source="Modelled" />} testId="uof-payroll">
              {steps ? (
                <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12.5px]">{steps.map((s) => <li key={s.month} className="flex justify-between"><span className={MONO}>From {s.month}</span><span className={MONO}>{money(s.cents, base.currency)} a month</span></li>)}</ul>
              ) : <NotRecorded reason={model?.burn?.reason || 'Planned payroll is Not recorded.'} />}
            </Card>
            <div className="flex flex-wrap items-center gap-2">
              <input type="search" className={`${FIELD} max-w-xs`} placeholder="Search milestones" aria-label="Search milestones" value={q} onChange={(e) => setQ(e.target.value)} data-testid="uof-ms-search" />
              <select className={`${FIELD} w-auto`} value={section} onChange={(e) => setSection(e.target.value)} aria-label="Section" data-testid="uof-ms-section">
                <option value="">Section: any</option>{SECTIONS.map((s) => <option key={s.key} value={s.key}>{s.short}</option>)}
              </select>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <Card title="Milestones" testId="uof-ms-table">
                {ms.length === 0 ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="uof-ms-none">{(base?.milestones || []).length ? 'No milestone matches.' : 'No milestones yet.'}</p> : (
                  <div className="overflow-x-auto"><table className="w-full min-w-[520px] border-collapse text-left text-[12.5px]">
                    <thead><tr>{['Milestone', 'Section', 'By', 'Cost', 'State', 'Source'].map((h) => <th key={h} className={`border-b border-axal-hairline px-2 py-1.5 dark:border-gray-800 ${EYEBROW}`}>{h}</th>)}</tr></thead>
                    <tbody>{ms.map((m) => {
                      const st = states.get(String(m.id)) || (m.cost_cents == null ? 'Not costed' : NOT_RECORDED);
                      return (
                        <tr key={m.id} data-testid="uof-ms-row">
                          <td className="border-b border-axal-hairline px-2 py-1.5 font-bold dark:border-gray-800">{m.label}</td>
                          <td className="border-b border-axal-hairline px-2 py-1.5 dark:border-gray-800">{sectionOf(m.category_key)?.short || NOT_RECORDED}</td>
                          <td className={`border-b border-axal-hairline px-2 py-1.5 ${MONO} dark:border-gray-800`}>{m.due_on || <NotRecorded />}</td>
                          <td className={`border-b border-axal-hairline px-2 py-1.5 ${MONO} dark:border-gray-800`}>{m.cost_cents == null ? <Pill tone="dashed">○ Not costed</Pill> : money(m.cost_cents, base.currency)}</td>
                          <td className="border-b border-axal-hairline px-2 py-1.5 dark:border-gray-800"><Pill tone={st === 'Funded' ? 'green' : st === 'At risk' ? 'amber' : 'dashed'}>{st === 'Funded' ? '✓ Funded' : st === 'At risk' ? '! At risk' : st === 'Not costed' ? '○ Not costed' : st}</Pill></td>
                          <td className="border-b border-axal-hairline px-2 py-1.5 dark:border-gray-800"><Source source={m.source} /></td>
                        </tr>
                      );
                    })}</tbody>
                  </table></div>
                )}
              </Card>
              <Card title="Hires" testId="uof-hires-table">
                {!hiresOk ? <BlockError text={base?.hires?.reason || 'Hires could not be read.'} onRetry={read.reload} />
                  : hires.length === 0 ? <p className={`m-0 text-[12.5px] ${MUTED}`}>No hires planned. A hire is added on its section’s page.</p> : (
                    <div className="overflow-x-auto"><table className="w-full min-w-[440px] border-collapse text-left text-[12.5px]">
                      <thead><tr>{['Role', 'Section', 'From', 'Cost a year', 'A month'].map((h) => <th key={h} className={`border-b border-axal-hairline px-2 py-1.5 dark:border-gray-800 ${EYEBROW}`}>{h}</th>)}</tr></thead>
                      <tbody>{hires.map((h) => (
                        <tr key={h.id} data-testid="uof-hire-row">
                          <td className="border-b border-axal-hairline px-2 py-1.5 font-bold dark:border-gray-800">{h.role || NOT_RECORDED}</td>
                          <td className="border-b border-axal-hairline px-2 py-1.5 dark:border-gray-800"><Link className={LINK} to={recordHref('raise', SLUG, h.category_key, tabSearch(search))}>{sectionOf(h.category_key)?.short || NOT_RECORDED}</Link></td>
                          <td className={`border-b border-axal-hairline px-2 py-1.5 ${MONO} dark:border-gray-800`}>{h.start_month || <NotRecorded />}</td>
                          <td className={`border-b border-axal-hairline px-2 py-1.5 ${MONO} dark:border-gray-800`}>{money(h.annual_cents, h.currency) || <NotRecorded />}</td>
                          <td className={`border-b border-axal-hairline px-2 py-1.5 ${MONO} dark:border-gray-800`}>{typeof h.annual_cents === 'number' ? money(Math.round(h.annual_cents / 12), h.currency) : <NotRecorded />}</td>
                        </tr>
                      ))}</tbody>
                    </table></div>
                  )}
              </Card>
            </div>
            {adding ? <AddMilestoneDialog projectId={projectId} api={api} onClose={() => setAdding(false)} onSaved={(t) => { setAdding(false); setNotice(t); read.reload(); }} /> : null}
          </>
        );
      }}
    </PlanFrame>
  );
}

/** Runway (UF7): runway today from its most direct source, the cash path, planned burn and runway after the raise. */
function Runway({ projectId, search, api }) {
  const read = usePlan(projectId, api);
  const [view, setView] = useState('chart');
  return (
    <PlanFrame read={read} testId="uof-runway">
      {(plan) => {
        const base = baseOf(plan);
        const today = runwayTodayView(plan.runway_today, plan.viewer);
        const after = afterRaiseView(base);
        const others = runwayCandidates(plan.runway_today, plan.forecast);
        const burn = base?.model?.burn?.value;
        const perSection = base?.model?.sections?.every((s) => Array.isArray(s.spend?.value)) ? base.model.sections : null;
        const avg = burn?.length ? Math.round(burn.reduce((a, b) => a + b.spendCents, 0) / burn.length) : null;
        return (
          <>
            <div className="grid gap-3 lg:grid-cols-3">
              <Card testId="uof-runway-today">
                <span className={EYEBROW}>Runway today</span>
                {today.value ? <span className={today.state === 'founder_only' ? `text-[15px] ${MUTED}` : `${MONO} text-[32px] font-extrabold text-axal-ink dark:text-gray-100`} data-testid="uof-runway-today-value">{today.value}</span>
                  : <NotRecorded reason={today.sub} testId="uof-runway-today-none" />}
                {today.value && today.state !== 'founder_only' ? <><Pill tone="violet">{today.sub}</Pill>{today.cash && today.burn ? <p className={`m-0 text-[12.5px] ${MUTED}`}>Cash {today.cash} at {today.burn} net burn a month.</p> : null}</> : today.value ? <p className={`m-0 text-[12px] ${MUTED}`}>{today.sub}</p> : null}
                {others.length ? (
                  <div className="flex flex-col gap-1.5 border-t border-axal-hairline pt-2 dark:border-gray-800" data-testid="uof-runway-others">
                    <span className={EYEBROW}>Other runways we found</span>
                    {others.map((o) => (
                      <div key={o.key} className="flex flex-wrap items-center justify-between gap-1 text-[12.5px]" data-testid={`uof-runway-other-${o.forecast ? 'forecast' : o.key}`}>
                        <span className="text-axal-ink dark:text-gray-100">{o.label}{o.value ? ` · ${o.value}` : ''}<span className={`block text-[11px] ${MUTED}`}>{o.source}{o.reason ? ` · ${o.reason}` : ''}</span></span>
                        {o.used ? <Pill tone="green">✓ Used</Pill> : null}
                      </div>
                    ))}
                  </div>
                ) : null}
                <p className={`m-0 text-[11.5px] ${MUTED}`}>Runway today uses the most direct source. A forecast is a model you set and is never runway today.</p>
              </Card>
              <div className="lg:col-span-2"><CashCard base={base} title="Cash path" testId="uof-cash-path" /></div>
            </div>
            <div className="grid gap-3 lg:grid-cols-3">
              <Card title="Planned burn" className="lg:col-span-2" meta={<span className="flex items-center gap-2"><Source source="Modelled" />{burn ? <ChartToggle id="uof-burn" view={view} onChange={setView} /> : null}</span>} testId="uof-burn">
                {!burn ? <NotRecorded reason={base?.model?.burn?.reason} />
                  : view === 'table' ? (
                    <div className="max-h-64 overflow-auto"><table className="w-full border-collapse text-left text-[12px]" data-testid="uof-burn-table">
                      <thead><tr><th className={`px-2 py-1 ${EYEBROW}`}>Month</th>{SECTIONS.map((s) => <th key={s.key} className={`px-2 py-1 ${EYEBROW}`}>{s.short}</th>)}<th className={`px-2 py-1 ${EYEBROW}`}>Total</th></tr></thead>
                      <tbody>{burn.map((b, i) => <tr key={b.month}><td className={`px-2 py-1 ${MONO}`}>{b.month}</td>{SECTIONS.map((s) => <td key={s.key} className={`px-2 py-1 ${MONO}`}>{perSection ? money(perSection.find((x) => x.key === s.key).spend.value[i], base.currency) : '—'}</td>)}<td className={`px-2 py-1 ${MONO}`}>{money(b.spendCents, base.currency)}</td></tr>)}</tbody>
                    </table></div>
                  ) : (
                    <Columns testId="uof-burn-chart" label={`Planned burn by month from ${burn[0].month}, averaging ${money(avg, base.currency)} a month.`} format={(v) => money(v, base.currency)}
                      groups={burn.slice(0, 12).map((b) => ({ key: b.month, label: b.month.slice(2), values: [{ key: 'total', value: b.spendCents, fill: 'bg-violet-600 dark:bg-violet-400' }] }))} />
                  )}
                {burn ? <p className={`m-0 text-[11.5px] ${MUTED}`}>Planned burn averages {money(avg, base.currency)} a month. {today.burn ? `Net burn today is ${today.burn} (${today.sub?.replace(/^\S+ /, '')}).` : 'Net burn today is Not recorded.'}</p> : null}
              </Card>
              <Card testId="uof-after">
                <span className={EYEBROW}>Runway after the raise</span>
                {after.value ? <span className={`${MONO} text-[32px] font-extrabold text-axal-ink dark:text-gray-100`} data-testid="uof-after-value">{after.value}</span> : <NotRecorded reason={after.sub} />}
                <Source source="Modelled" />
                {after.value && base?.target_runway_months && after.relation === 'exact' ? (
                  <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="uof-after-line">At planned burn the raise lasts {monthsText(Math.abs(after.months - base.target_runway_months))} {after.months >= base.target_runway_months ? 'past' : 'short of'} your target.</p>
                ) : null}
                <div className="flex justify-between text-[12.5px]"><span>Your target</span><span className={MONO}>{base?.target_runway_months ? `${base.target_runway_months} months` : NOT_RECORDED}</span></div>
                <div className="flex justify-between text-[12.5px]"><span>Planned burn</span><span className={MONO}>{avg != null ? `${money(avg, base.currency)} a month` : NOT_RECORDED}</span></div>
                <p className={`m-0 text-[12px] ${MUTED}`}>{FORECAST_LINE} <Link className={LINK} to={forecastHref(search)} data-testid="uof-forecast-link">Forecast ›</Link></p>
              </Card>
            </div>
          </>
        );
      }}
    </PlanFrame>
  );
}

/** Plan vs actual (UF12): planned share against Mercury's actual share, and the categories with their mapping. */
function Actuals({ projectId, api }) {
  const read = usePlan(projectId, api);
  const mod = useModule(projectId);
  const [months, setMonths] = useState(3);
  return (
    <PlanFrame read={read} testId="uof-actuals">
      {(plan) => {
        const base = baseOf(plan);
        const mercury = mod.data?.parts?.mercury;
        if (plan.viewer?.mercury === false) {
          return <Card testId="uof-actuals-founder-only"><p className={`m-0 text-[12.5px] ${MUTED}`}>Actual spend comes from the founder’s own Mercury. It is visible to the founder only.</p></Card>;
        }
        if (mod.status === 'loading' && !mod.data) return <Skeleton lines={4} testId="uof-actuals-reading" />;
        if (mod.status === 'unreadable' || mercury?.state === 'unreadable') return <BlockError text="Mercury’s spend could not be read. This is not a claim that nothing was spent." onRetry={mod.reload} testId="uof-actuals-unreadable" />;
        if (!mercury || !Array.isArray(mercury.categories)) {
          return (
            <div className="flex flex-col gap-3" data-testid="uof-actuals-none">
              <Card title="Planned and actual share, by section"><NotRecorded reason="No spend is connected." /></Card>
              <Card>
                <h3 className={H3}>Connect Mercury to see actual spend.</h3>
                <p className={`m-0 text-[12.5px] ${MUTED}`}>Actuals are visible to you only.</p>
                <Link className={`${BTN} w-fit no-underline`} to="/account/connectors/mercury" data-testid="uof-connect-mercury">Connect Mercury</Link>
              </Card>
            </div>
          );
        }
        const pva = planVsActual(base, mercury, months);
        return (
          <>
            <div className="flex flex-wrap items-center gap-2"><span className={EYEBROW}>Window</span>
              <span className="inline-flex rounded-lg border border-axal-hairline p-0.5 text-[12px] font-semibold dark:border-gray-700" role="group" aria-label="Window">
                {[3, 6, 12].map((m) => <button key={m} type="button" aria-pressed={months === m} onClick={() => setMonths(m)} data-testid={`uof-window-${m}`}
                  className={`rounded-md px-2.5 py-1 max-md:min-h-[40px] ${months === m ? 'bg-violet-50 text-axal-ink dark:bg-violet-950 dark:text-gray-100' : MUTED}`}>{m} months</button>)}
              </span>
            </div>
            <Card title="Planned and actual share, by section" meta={<Pill tone="violet">{`⇄ Connector · Mercury${dayText(pva.asOf) ? `, as of ${dayText(pva.asOf)}` : ''}`}</Pill>} testId="uof-pva">
              {mercury.sections === null ? <NotRecorded reason="No Mercury category is mapped to a section yet. Map one below." testId="uof-pva-unmapped" /> : (
                <>
                  <Columns testId="uof-pva-chart" label={`Planned against actual share of spend by section, over the last ${months} months.`} format={(v) => `${v}%`}
                    groups={pva.rows.map((r) => ({ key: r.key, label: r.short, values: [
                      { key: 'planned', value: r.planned, fill: SECTION_BG[r.key] },
                      { key: 'actual', value: r.actual, fill: 'bg-sky-500 dark:bg-sky-400' },
                    ] }))} />
                  <table className="w-full border-collapse text-left text-[12.5px]" data-testid="uof-pva-table">
                    <thead><tr>{['Section', 'Planned share', 'Actual share', 'Spent'].map((h) => <th key={h} className={`border-b border-axal-hairline px-2 py-1 dark:border-gray-800 ${EYEBROW}`}>{h}</th>)}</tr></thead>
                    <tbody>{pva.rows.map((r) => (
                      <tr key={r.key} data-testid={`uof-pva-${r.key}`}><td className="px-2 py-1">{r.label}</td><td className={`px-2 py-1 ${MONO}`}>{r.planned != null ? `${r.planned}%` : NOT_RECORDED}</td>
                        <td className={`px-2 py-1 ${MONO}`}>{r.actual != null ? `${r.actual}%` : NOT_RECORDED}</td><td className={`px-2 py-1 ${MONO}`}>{money(r.actualCents) || NOT_RECORDED}</td></tr>
                    ))}</tbody>
                  </table>
                  <p className={`m-0 text-[11.5px] ${MUTED}`}>Mapped {money(pva.spentCents) || NOT_RECORDED} · Unmapped {money(pva.unmappedCents) || NOT_RECORDED}. A measured 0% means nothing was spent from it. A suggestion changes nothing until you accept it.</p>
                </>
              )}
            </Card>
            <MercuryRaiseFeed slug={SLUG} part={mercury} projectId={projectId} reload={mod.reload} />
          </>
        );
      }}
    </PlanFrame>
  );
}

/** History (UF15): every save with who made it; an admin's change carries an Admin tag. */
function History({ projectId, api }) {
  const [page, setPage] = useState(1);
  const read = useRead(() => api.history(projectId, page), projectId ? `history:${projectId}:${page}` : null);
  const [q, setQ] = useState('');
  const rows = useMemo(() => historyRows(read.data?.items).filter((r) => !q.trim() || r.text.toLowerCase().includes(q.trim().toLowerCase())), [read.data, q]);
  if (read.status === 'loading' && !read.data) return <Skeleton lines={5} testId="uof-history-loading" />;
  if (read.status === 'unreadable') return <BlockError text="The plan’s history could not be read. This is not a claim that nothing changed." onRetry={read.reload} testId="uof-history-unreadable" />;
  const total = read.data?.total ?? 0;
  const size = read.data?.page_size ?? 20;
  return (
    <Card title="History" testId="uof-history">
      <input type="search" className={`${FIELD} max-w-xs`} placeholder="Search changes" aria-label="Search changes" value={q} onChange={(e) => setQ(e.target.value)} data-testid="uof-history-search" />
      {total === 0 ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="uof-history-none">No change is recorded for this plan yet.</p> : (
        <ul className="m-0 flex list-none flex-col p-0">{rows.map((r) => (
          <li key={r.id} className="flex items-start gap-2.5 border-t border-axal-hairline py-2 first:border-0 dark:border-gray-800" data-testid="uof-history-row">
            <span aria-hidden="true" className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold ${r.admin ? 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200' : 'bg-violet-50 text-axal-violet dark:bg-violet-950 dark:text-violet-300'}`}>{initials(r.who)}</span>
            <span className="min-w-0 flex-1"><span className="block text-[12.5px] text-axal-ink dark:text-gray-100">{r.text}</span>
              <span className={`${MONO} text-[11px] ${MUTED}`}>{r.who}{r.admin ? ' · studio admin' : ''} · {r.at || 'Date not recorded'}</span></span>
            <span className="flex flex-wrap gap-1"><Pill>{r.kind}</Pill>{r.admin ? <Pill tone="neutral" testId="uof-history-admin">◉ Admin</Pill> : null}</span>
          </li>
        ))}</ul>
      )}
      {total > size ? (
        <div className="flex items-center justify-between gap-2 text-[12px]">
          <span className={`${MONO} ${MUTED}`} data-testid="uof-history-range">{(page - 1) * size + 1}–{Math.min(total, page * size)} of {total}</span>
          <span className="flex gap-2">
            <button type="button" className={BTN_GHOST} disabled={page <= 1} onClick={() => setPage(page - 1)}>‹ Previous</button>
            <button type="button" className={BTN_GHOST} disabled={page * size >= total} onClick={() => setPage(page + 1)} data-testid="uof-history-next">Next page ›</button>
          </span>
        </div>
      ) : null}
    </Card>
  );
}

/** A page under a tab (D1178): its phone bar's title. */
const SUB_TITLE = { forecast: 'Forecast', compare: 'Scenarios compared' };

export function UseOfFundsTabPage({ tab, sub = null, projectId, projectStatus = 'ready', onRetryProject, search = '', cards, action, phone = false, api = useOfFundsApi }) {
  const here = TABS.find((t) => t.id === tab) || TABS[0];
  let body;
  // No venture means no read is made: say the venture list failed, never a skeleton.
  if (projectStatus === 'unreadable') body = <Unreadable what="Your ventures" claim="This is not a claim that you have none." onRetry={onRetryProject} />;
  else if (!projectId) body = <div className="h-24 animate-pulse rounded-xl bg-axal-ground dark:bg-gray-800" data-testid="uof-loading" />;
  else if (tab === 'allocation') body = <Allocation projectId={projectId} search={search} api={api} phone={phone} />;
  else if (tab === 'milestones') body = <Milestones projectId={projectId} search={search} api={api} />;
  else if (tab === 'runway' && sub === 'forecast') body = <Forecast projectId={projectId} search={search} api={api} />;
  else if (tab === 'runway') body = <Runway projectId={projectId} search={search} api={api} />;
  else if (tab === 'scenarios' && sub === 'compare') body = <Compare projectId={projectId} search={search} api={api} />;
  else if (tab === 'scenarios') body = <Scenarios projectId={projectId} search={search} api={api} />;
  else if (tab === 'actuals') body = <Actuals projectId={projectId} api={api} />;
  else body = <History projectId={projectId} api={api} />;
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid={sub ? `uof-${sub}-page` : `uof-${tab}-page`}>
      {phone
        ? <CycleBar
            back={sub ? { label: here.label, to: tabHref(here, search) } : { label: TITLE, to: `${HOME_PATH}${tabSearch(search)}` }}
            title={SUB_TITLE[sub] || here.label}
            eadwynLabel={`Raise · ${TITLE}`}
          />
        : <CycleHeader cycle="raise" cards={cards} active={SLUG} action={action} title={TITLE} sub={LINE} search={tabSearch(search)} />}
      <UseOfFundsTabBar active={tab} search={search} />
      {body}
    </div>
  );
}
