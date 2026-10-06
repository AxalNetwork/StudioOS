import React, { useCallback, useEffect, useState } from 'react';
import { Card, Skeleton, Unreadable, Unrecorded, NOT_RECORDED } from '../../ui';
import { researchOverviewApi } from '../../lib/api/researchOverview.js';

/**
 * D536 (#1082) — the Research overview panel, to `design/incoming/Research ·
 * Main.dc.html` (D546), mounted inside the signed-in desks: the founder desk,
 * the investor workspace, and the advisor and partner board. It reads one
 * route, `GET /api/research/overview`, and draws each section from that
 * section's own status, so one unreadable store never blanks the rest.
 *
 * DEPARTURES FROM THE CANVAS. The canvas's public top bar ("Sign in") and its
 * search box are left out: the overview is signed-in and sits inside a desk
 * that already has its own question box and zone links. "Browse …" links are
 * left out for the same reason, and because not every licence reaches every
 * zone the canvas links.
 *
 * HONESTY. A figure the route does not send is "Not recorded" with the
 * route's reason; a section whose read failed is "Unreadable"; neither is ever
 * drawn as 0. The index figures are monthly and the current month is month to
 * date. Government companies have no source at all and say so.
 */

const NUM = new Intl.NumberFormat('en-US');
export const fmt = (n) => NUM.format(Number(n));

/** A figure from a `{ value, reason }` total: the number, or "Not recorded" / "Unreadable" with the reason. */
export function Figure({ total, className = '' }) {
  const v = total?.value;
  if (v != null && Number.isFinite(Number(v))) return <span className={className}>{fmt(v)}</span>;
  if (total?.reason === 'Unreadable') return <span className="font-semibold text-red-700 dark:text-red-300" title="The read failed; this is not a zero">Unreadable</span>;
  return <Unrecorded reason={total?.reason}>{NOT_RECORDED}</Unrecorded>;
}

const isUnreadable = (s) => s?.status === 'unreadable';
const isOk = (s) => s?.status === 'ok';

/** True when every section was read and none holds anything: the empty state. */
export function nothingRecorded(data) {
  const keys = ['heat', 'demand_vs_supply', 'competition', 'money', 'signals'];
  const t = data?.totals;
  const pub = t?.market_split?.public;
  const totalsEmpty = !isOk(t) ? !isUnreadable(t)
    : ['companies', 'markets', 'funds'].every((k) => t[k]?.value == null && t[k]?.reason !== 'Unreadable')
      // The split's public count reads `signal_companies`, a store the three
      // directories do not cover: a listed company is a record.
      && pub?.value == null && pub?.status !== 'unreadable' && pub?.reason !== 'Unreadable';
  return totalsEmpty && keys.every((k) => data?.[k]?.status === 'not_recorded');
}

function SectionState({ section, what }) {
  if (isUnreadable(section)) {
    return <Unreadable what={what} claim="That is a failed read, not a sign that nothing is recorded." />;
  }
  return <p className="text-[12.5px] text-axal-muted dark:text-gray-400"><Unrecorded reason={section?.reason}>{NOT_RECORDED}</Unrecorded>{section?.reason ? <> · {section.reason}</> : null}</p>;
}

function Head({ title, sub }) {
  return <div className="mb-3"><h3 className="text-[15px] font-semibold tracking-tight text-axal-ink dark:text-gray-100">{title}</h3>{sub ? <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-axal-muted dark:text-gray-400">{sub}</p> : null}</div>;
}

function Cap({ children }) {
  return <p className="mt-3 text-[11.5px] leading-relaxed text-axal-muted dark:text-gray-400">{children}</p>;
}

function Tile({ label, total, line, foot, testId }) {
  return <Card padding="sm" data-testid={testId}>
    <div className="text-[11px] font-bold uppercase tracking-[.08em] text-axal-muted dark:text-gray-400">{label}</div>
    <div className="mt-1 font-mono text-2xl font-semibold text-axal-ink dark:text-gray-100"><Figure total={total} /></div>
    {line ? <div className="mt-1 text-[12px] text-axal-muted dark:text-gray-400">{line}</div> : null}
    {foot ? <div className="mt-2 text-[11px] text-axal-faint dark:text-gray-500">{foot}</div> : null}
  </Card>;
}

const asOf = (t) => (t?.as_of ? ` · as of ${String(t.as_of).slice(0, 10)}` : '');

function Totals({ totals }) {
  if (!isOk(totals)) return <SectionState section={totals} what="The directory totals" />;
  const t = totals;
  const supplied = t.supplied_companies;
  const lists = t.fund_sources;
  const tracked = t.sectors_tracked || {};
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="research-overview-totals">
    <Tile testId="tile-overview-companies" label="Companies" total={t.companies} line="in the company directory" foot={`research_company_directory · Wikidata${asOf(t.companies)}`} />
    <Tile testId="tile-overview-markets" label="Markets" total={t.markets}
      line={<>holding <Figure total={supplied} /> companies, as the taxonomy source counts them</>}
      foot={`research_market_directory · Axal sector taxonomy${asOf(t.markets)}`} />
    <Tile testId="tile-overview-funds" label="Funds" total={t.funds}
      line={lists?.value != null ? `from ${fmt(lists.value)} public fund list${lists.value === 1 ? '' : 's'}` : <>fund lists <Figure total={lists} /></>}
      foot={`research_fund_directory${asOf(t.funds)}`} />
    <Tile testId="tile-overview-countries" label="Countries" total={t.countries} line="where directory companies are based" foot={`research_company_directory${asOf(t.countries)}`} />
    <Tile testId="tile-overview-sectors" label="Sectors tracked" total={tracked} line="each read on six dimensions"
      foot={tracked.reason === 'Unreadable' ? 'market_intel_indexes · last computed: Unreadable'
        : `market_intel_indexes · last computed ${tracked.as_of ? String(tracked.as_of).slice(0, 16) : NOT_RECORDED.toLowerCase()}`} />
  </div>;
}

function Split({ totals }) {
  if (!isOk(totals)) return null;
  const s = totals.market_split || {};
  const card = (key, label, title, total, unit, note, source) => <Card padding="sm" data-testid={`split-${key}`}>
    <div className="text-[11px] font-bold uppercase tracking-[.08em] text-axal-muted dark:text-gray-400">{label}</div>
    {title ? <div className="mt-1 text-[13px] font-semibold text-axal-ink dark:text-gray-100">{title}</div> : null}
    <div className="mt-2 font-mono text-xl font-semibold text-axal-ink dark:text-gray-100"><Figure total={total} />{total?.value != null ? <span className="ml-1 text-[12px] font-normal text-axal-muted dark:text-gray-400">{unit}</span> : null}</div>
    <p className="mt-2 text-[12px] leading-relaxed text-axal-muted dark:text-gray-400">{note}</p>
    {source ? <div className="mt-2 text-[11px] text-axal-faint dark:text-gray-500">{source}{asOf(total)}</div> : null}
  </Card>;
  return <section className="mt-6" data-testid="research-overview-split">
    <Head title="Private, public and government companies" sub="No source records ownership for each company, so each count follows the list the record came from." />
    <div className="grid gap-3 md:grid-cols-3">
      {card('private', 'Private', 'Company directory', s.private, 'companies', s.private?.note || 'Directory records not known to be listed.', 'research_company_directory')}
      {card('public', 'Public', 'Listed companies', s.public, 'listed companies', s.public?.value != null ? 'Each with its symbol, exchange, market-cap band and employee band.' : (s.public?.reason || ''), 'signal_companies')}
      {card('government', 'Government', null, s.government, '', s.government?.reason || 'No source lists government-owned companies yet.', null)}
    </div>
  </section>;
}

const DIMS = ['demand', 'supply', 'capital', 'talent', 'research', 'sentiment'];

export function Delta({ pct }) {
  if (pct == null || !Number.isFinite(Number(pct))) return null;
  const n = Number(pct);
  // A change that rounds to 0.0% is no change: no arrow, no colour, so an
  // unchanged index never reads as a rise.
  if (Math.abs(n) < 0.05) return <span className="text-axal-muted dark:text-gray-400" title="Unchanged on last month">= 0.0%</span>;
  return <span className={n > 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}>{n > 0 ? '▲' : '▼'} {Math.abs(n).toFixed(1)}%</span>;
}

function Heat({ heat }) {
  return <section className="mt-6" data-testid="research-overview-heat">
    <Head title="Twelve sectors on six dimensions" sub="Each index runs from 0 to 100, worldwide, for the current month, month to date. The arrow compares it with the month before." />
    {!isOk(heat) ? <SectionState section={heat} what="The sector grid" /> : <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-[12px]">
          <thead><tr className="text-left text-[11px] uppercase tracking-[.07em] text-axal-muted dark:text-gray-400"><th className="py-2 pr-2">Sector</th>{DIMS.map((d) => <th key={d} className="px-2 py-2">{d}</th>)}</tr></thead>
          <tbody>{(heat.sectors || []).map((row) => <tr key={row.sector} className="border-t border-axal-hairline dark:border-gray-800">
            <td className="py-2 pr-2 font-medium text-axal-ink dark:text-gray-100">{row.sector}</td>
            {DIMS.map((d) => {
              const cell = row.dimensions?.[d];
              const v = cell?.value;
              return <td key={d} className="px-2 py-2" style={v != null ? { backgroundColor: `rgba(124, 58, 237, ${(Math.max(0, Math.min(100, Number(v))) / 100) * 0.3})` } : undefined}>
                {v != null ? <><span className="font-mono font-semibold text-axal-ink dark:text-gray-100">{Math.round(Number(v))}</span> <Delta pct={cell.delta_pct} /></> : <Unrecorded reason={cell?.reason}>{NOT_RECORDED}</Unrecorded>}
              </td>;
            })}
          </tr>)}</tbody>
        </table>
      </div>
      <Cap>market_intel_indexes · global · {heat.period_key} · month to date. Not recorded: no live source reported this month. Unreadable: the read failed; never drawn as 0.</Cap>
    </>}
  </section>;
}

function DemandSupply({ dvs }) {
  return <section className="mt-6" data-testid="research-overview-demand">
    <Head title="Where demand outruns supply" sub="Sectors whose demand index rose more than their supply index since last month: more people looking than new products arriving." />
    {!isOk(dvs) ? <SectionState section={dvs} what="Demand against supply" /> : <>
      <ol className="space-y-1.5 text-[12.5px]">{(dvs.sectors || []).slice(0, 5).map((o, i) => <li key={o.sector} className="flex flex-wrap items-baseline gap-3">
        <span className="w-5 font-mono text-axal-muted dark:text-gray-400">{i + 1}</span>
        <span className="min-w-[10rem] font-medium text-axal-ink dark:text-gray-100">{o.sector}</span>
        <span>Demand <Delta pct={o.demand_delta_pct} /></span><span>Supply <Delta pct={o.supply_delta_pct} /></span>
        <span className="font-mono font-semibold text-axal-ink dark:text-gray-100">+{o.gap_pct}pp</span>
      </li>)}</ol>
      <Cap>market_intel_indexes · demand and supply · global · {dvs.period_key} against the month before</Cap>
    </>}
  </section>;
}

/** Horizontal bars with the remainder and missing rows the canvas draws under them. */
function Bars({ title, sub, rows, tail = [], testId }) {
  const max = Math.max(1, ...rows.map((r) => Number(r.n) || 0));
  return <Card padding="sm" data-testid={testId}>
    <div className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{title}</div>
    {sub ? <div className="mb-2 text-[11.5px] text-axal-muted dark:text-gray-400">{sub}</div> : null}
    {rows.length === 0 ? <p className="text-[12px] text-axal-muted dark:text-gray-400"><Unrecorded>{NOT_RECORDED}</Unrecorded></p> : null}
    <ul className="space-y-1">{rows.map((r) => <li key={r.label} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2 text-[12px]">
      <span className="truncate text-axal-ink dark:text-gray-100" title={r.label}>{r.label}</span>
      <span className="h-2 rounded bg-violet-500/70 dark:bg-violet-400/60" style={{ width: `${(Number(r.n) / max) * 100}%` }} />
      <span className="font-mono text-axal-ink dark:text-gray-100">{fmt(r.n)}</span>
    </li>)}</ul>
    {tail.length ? <ul className="mt-2 space-y-1 border-t border-axal-hairline pt-2 text-[12px] dark:border-gray-800">{tail.map((t) => <li key={t.label} className="flex justify-between gap-2 text-axal-muted dark:text-gray-400"><span>{t.label}</span><span className="font-mono">{t.node}</span></li>)}</ul> : null}
  </Card>;
}

/** A count the route sent, or "Not recorded" when it sent none — never a 0 it was not given. */
export function countOf(n) {
  return n != null && n !== '' && Number.isFinite(Number(n)) ? fmt(n) : NOT_RECORDED;
}

/**
 * The records without a value: "Not recorded" and how many. When the route
 * sends no count, only "Not recorded" — the absence of a count is not 0.
 */
function Missing({ n }) {
  const count = countOf(n);
  return <><Unrecorded>{NOT_RECORDED}</Unrecorded>{count === NOT_RECORDED ? null : <> {count}</>}</>;
}

function Competition({ c }) {
  return <section className="mt-6" data-testid="research-overview-competition">
    <Head title="Who is already building" sub="The company directory by sector and by country. Sector labels are Wikidata's own words." />
    {!isOk(c) ? <SectionState section={c} what="The company directory" /> : <div className="grid gap-3 md:grid-cols-2">
      <Bars testId="bars-overview-sectors" title="Companies per sector label" sub={`Top ${(c.by_sector || []).length} labels by number of companies`}
        rows={(c.by_sector || []).map((r) => ({ label: r.label, n: r.companies }))}
        tail={[
          ...(c.other_sectors?.labels ? [{ label: `${fmt(c.other_sectors.labels)} other labels`, node: fmt(c.other_sectors.companies) }] : []),
          { label: 'No sector label', node: <Missing n={c.no_sector} /> },
        ]} />
      <Bars testId="bars-overview-countries" title="Where they are based" sub={`Top ${(c.by_country || []).length} countries by number of companies`}
        rows={(c.by_country || []).map((r) => ({ label: r.country, n: r.companies }))}
        tail={[
          ...(c.other_countries?.countries ? [{ label: `${fmt(c.other_countries.countries)} more countries`, node: fmt(c.other_countries.companies) }] : []),
          { label: 'No country', node: <Missing n={c.no_country} /> },
        ]} />
      <div className="md:col-span-2"><Cap>research_company_directory · {countOf(c.total_companies)} companies{c.as_of ? ` · as of ${c.as_of}` : ''}</Cap></div>
    </div>}
  </section>;
}

function Money({ m }) {
  return <section className="mt-6" data-testid="research-overview-money">
    <Head title="Where the money is" sub="HQ and stated focus are matched to countries and markets through the Research crosswalk; text it cannot place is counted apart, never dropped." />
    {!isOk(m) ? <SectionState section={m} what="The fund directory" /> : <div className="grid gap-3 md:grid-cols-2">
      <Bars testId="bars-overview-hq" title="Funds by HQ" sub="Countries by number of funds headquartered there"
        rows={(m.by_hq || []).map((r) => ({ label: r.hq, n: r.funds }))}
        tail={[
          ...(m.other_hq?.countries ? [{ label: `Other HQs (${fmt(m.other_hq.countries)} countries)`, node: fmt(m.other_hq.funds) }] : []),
          ...(m.hq_unmapped?.funds ? [{ label: 'HQ text not matched to a country', node: fmt(m.hq_unmapped.funds) }] : []),
          { label: 'No HQ', node: <Missing n={m.missing?.hq} /> },
        ]} />
      <Bars testId="bars-overview-focus" title="Funds by stated focus" sub="Markets by number of funds that name them"
        rows={(m.by_focus || []).map((r) => ({ label: r.focus, n: r.funds }))}
        tail={[
          ...(m.other_focus?.markets ? [{ label: `Other focus (${fmt(m.other_focus.markets)} markets)`, node: fmt(m.other_focus.funds) }] : []),
          ...(m.focus_unmapped?.funds ? [{ label: 'Focus not matched to a market', node: fmt(m.focus_unmapped.funds) }] : []),
          { label: 'No stated focus', node: <Missing n={m.missing?.focus} /> },
        ]} />
      <Bars testId="bars-overview-sizes" title="Fund sizes" sub="Number of funds in each size band, in euros, where the currency is known"
        rows={(m.size_bands || []).map((r) => ({ label: r.band, n: r.funds }))}
        tail={[{ label: 'Size missing or in no known currency', node: <Missing n={m.missing?.size} /> }]} />
      <Bars testId="bars-overview-vintages" title="Vintages"
        sub={m.vintage_range ? `Number of funds by vintage year, ${m.vintage_range.from} to ${m.vintage_range.to}` : 'Number of funds by vintage year'}
        rows={(m.vintages || []).slice().reverse().map((r) => ({ label: String(r.year), n: r.funds }))}
        tail={[{ label: 'Vintage missing', node: <Missing n={m.missing?.vintage} /> }]} />
      <div className="md:col-span-2"><Cap>research_fund_directory · {countOf(m.total_funds)} funds{m.as_of ? ` · as of ${m.as_of}` : ''}. {m.size_note}</Cap></div>
    </div>}
  </section>;
}

function Signals({ s }) {
  return <section className="mt-6" data-testid="research-overview-signals">
    <Head title="Latest opportunity signals" sub="Curated by the StudioOS team. Each states a thesis, why now, and what a founder could build." />
    {!isOk(s) ? <SectionState section={s} what="The signals" /> : <>
      <div className="grid gap-3 md:grid-cols-2">{(s.items || []).map((x) => <Card key={x.id} padding="sm" data-testid={`signal-overview-${x.id}`}>
        <div className="text-[11px] font-bold uppercase tracking-[.08em] text-violet-700 dark:text-violet-300">{x.sector}</div>
        <div className="text-[11.5px] text-axal-muted dark:text-gray-400">{x.region || NOT_RECORDED} · {x.country}</div>
        <div className="mt-1 text-[14px] font-semibold text-axal-ink dark:text-gray-100">{x.title}</div>
        <div className="mt-2 text-[11px] font-bold uppercase tracking-[.08em] text-axal-muted dark:text-gray-400">Why now</div>
        <p className="text-[12.5px] text-axal-ink dark:text-gray-200">{x.why_now || <Unrecorded>{NOT_RECORDED}</Unrecorded>}</p>
        <div className="mt-2 text-[11px] font-bold uppercase tracking-[.08em] text-axal-muted dark:text-gray-400">What a founder could build</div>
        <p className="text-[12.5px] text-axal-ink dark:text-gray-200">{x.build_opportunity?.headline || <Unrecorded>{NOT_RECORDED}</Unrecorded>}</p>
        <div className="mt-2 text-[11.5px] text-axal-muted dark:text-gray-400">Confidence {x.confidence_score != null ? <span className="font-mono font-semibold text-axal-ink dark:text-gray-100">{Math.round(Number(x.confidence_score))}/100</span> : <Unrecorded reason={x.confidence_reason}>{NOT_RECORDED}</Unrecorded>} · updated {String(x.updated_at || '').slice(0, 10) || NOT_RECORDED}</div>
      </Card>)}</div>
      <Cap>signals · {s.active_count != null ? `${fmt(s.active_count)} active` : 'active'} · newest first</Cap>
    </>}
  </section>;
}

/**
 * The panel as it draws one state: `{ phase: 'loading' }`,
 * `{ phase: 'error' }` (the request failed), or `{ phase: 'ready', data }`.
 */
export function ResearchOverviewView({ state, onRetry }) {
  const phase = state?.phase || 'loading';
  return <section className="mb-6 rounded-axal-lg border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900" aria-labelledby="research-overview-title" data-testid="research-overview-panel" data-state={phase === 'ready' && nothingRecorded(state.data) ? 'empty' : phase}>
    <div className="mb-4">
      <div className="text-[11px] font-bold uppercase tracking-[.08em] text-axal-muted dark:text-gray-400">StudioOS Research</div>
      <h2 id="research-overview-title" className="text-lg font-semibold tracking-tight text-axal-ink dark:text-gray-100">Markets, companies and funds</h2>
      <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-axal-muted dark:text-gray-400">See where demand is rising, who already builds there and where the money sits. Every figure names its source and the date it was read.</p>
    </div>
    {phase === 'loading' ? <div className="space-y-3" data-testid="research-overview-loading" aria-busy="true"><Skeleton h={72} /><Skeleton h={120} /><Skeleton h={160} /></div>
      : phase === 'error' ? <div data-testid="research-overview-error"><Unreadable what="The research overview" claim="This is not a sign that the directories are empty." onRetry={onRetry} /></div>
        : <ReadyBody data={state.data} />}
  </section>;
}

function ReadyBody({ data }) {
  const d = data || {};
  return <div data-testid="research-overview-body">
    {nothingRecorded(d) ? <p className="mb-4 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="research-overview-empty"><Unrecorded>{NOT_RECORDED}</Unrecorded> · No directory, index or signal holds a record yet. Each section below says why.</p> : null}
    <Totals totals={d.totals} />
    <Split totals={d.totals} />
    <Heat heat={d.heat} />
    <DemandSupply dvs={d.demand_vs_supply} />
    <Competition c={d.competition} />
    <Money m={d.money} />
    <Signals s={d.signals} />
    <p className="mt-6 text-[11.5px] leading-relaxed text-axal-muted dark:text-gray-400">StudioOS Research reads public records: Wikidata (CC0) for companies, the Axal sector taxonomy for markets, public fund lists, and public sources for the sector indexes. Figures are records from those sources, not forecasts. What no source holds reads "Not recorded".</p>
  </div>;
}

/** The panel: one read of the overview, retried on demand. */
export default function ResearchOverviewPanel({ load = researchOverviewApi.get }) {
  const [state, setState] = useState({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setState({ phase: 'loading' });
    Promise.resolve().then(() => load()).then(
      (data) => { if (alive) setState({ phase: 'ready', data }); },
      () => { if (alive) setState({ phase: 'error' }); },
    );
    return () => { alive = false; };
  }, [load, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return <ResearchOverviewView state={state} onRetry={retry} />;
}
