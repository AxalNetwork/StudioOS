import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, ShieldCheck } from 'lucide-react';
import { Card } from '../../ui';
import { api } from '../../lib/api';
import data from '../../data/marketDirectory.json';
import { MARKET_CAP_BAND_LABEL, timeAgo } from '../../lib/signalsMeta';

function Fact({ label, value }) { return <div><div className="text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint">{label}</div><div className="mt-1 text-[13px] text-axal-ink dark:text-gray-100">{value || 'Not recorded'}</div></div>; }

// The sector card's headline number is the supplied taxonomy count, and this
// page is where a reader finds out what actually backs it. The universe below
// is the source-backed half: records the directory holds, each one openable.
const UNIVERSE_PREVIEW = 48;

// The observation vocabulary, spelled the way a reader says it. A metric with no
// entry here renders its raw name rather than being hidden, so a new metric
// added by the write API shows up the day it is recorded instead of the day
// somebody remembers to edit this map.
const METRIC_LABEL = {
  supplied_company_count: 'Supplied company count',
  tam: 'TAM',
  sam: 'SAM',
  som: 'SOM',
  market_size: 'Market size',
  cagr: 'CAGR',
  growth_rate: 'Growth rate',
  vc_funding: 'VC funding',
  deal_count: 'Deal count',
  average_deal_size: 'Average deal size',
  median_deal_size: 'Median deal size',
  investor_count: 'Investor count',
  ipo_count: 'IPO count',
  ma_count: 'M&A count',
  exit_value: 'Exit value',
};

// Which of a market's own fields are supposed to hold something. Used only to
// tell a reader how complete the record is — the page shows every field's value
// or its absence, so this is a summary, not a gate.
const RECORD_FIELDS = [
  'canonical_name', 'sector', 'industry', 'subindustry', 'category', 'vertical', 'technology_category',
  'description', 'definition', 'inclusion_criteria', 'exclusion_criteria', 'market_stage',
  'market_maturity', 'fragmentation', 'concentration', 'consolidation_trend', 'demand_drivers',
  'customer_segments', 'buyer_types', 'use_cases', 'key_players', 'leading_companies',
  'emerging_companies', 'incumbents', 'competitive_intensity', 'barriers_to_entry', 'switching_costs',
  'substitutes', 'technologies', 'technology_trends', 'enabling_technologies', 'disruptive_technologies',
  'regulatory_environment', 'regulatory_changes', 'licensing_requirements', 'market_trends',
  'emerging_trends', 'declining_trends', 'catalysts', 'risks', 'market_start_date', 'inflection_points',
  'adoption_stage', 'forecast_horizon', 'axal_thesis', 'axal_relevance', 'axal_focus',
];

const FACET_SECTIONS = [
  ['industry_resolution', "How this market's universe was resolved"],
  ['trend', 'Trends'],
  ['emerging_trend', 'Emerging trends'],
  ['technology', 'Technologies'],
  ['customer_segment', 'Customer segments'],
  ['use_case', 'Use cases'],
  ['competitor', 'Competitors'],
  ['exit', 'Exits'],
  ['event', 'Events'],
  ['forecast', 'Forecasts'],
  ['regulation', 'Regulation'],
  ['risk', 'Risks'],
  ['catalyst', 'Catalysts'],
];

function hostOf(website) { try { return new URL(website).host.replace(/^www\./, ''); } catch { return website || 'Not recorded'; } }

// A number a reader can check: the figure, its unit, the period it is for, the
// source it came from and the day it was read. Every part is required by the
// dataset — a metric row cannot be written without a citation — so this renders
// what is there rather than defending against a half-filled row.
function MetricRow({ m }) {
  const label = METRIC_LABEL[m.metric_name] || m.metric_name;
  const figure = m.metric_value === null || m.metric_value === undefined ? (m.metric_text || 'Not recorded')
    : `${Number(m.metric_value).toLocaleString()}${m.metric_unit ? ` ${m.metric_unit}` : ''}`;
  const period = m.forecast_year && m.base_year && m.forecast_year !== m.base_year
    ? `${m.base_year}–${m.forecast_year}`
    : (m.base_year || (m.period_start ? `${m.period_start}${m.period_end ? `–${m.period_end}` : ''}` : 'Not recorded'));
  return <tr>
    <td className="py-2.5 pr-4 font-semibold text-axal-ink dark:text-gray-100">{label}<div className="mt-0.5 text-[11px] font-normal text-axal-faint">{m.geography || 'Global'}</div></td>
    <td className="py-2.5 pr-4 font-mono text-axal-ink dark:text-gray-100">{figure}{m.currency ? ` ${m.currency}` : ''}</td>
    <td className="py-2.5 pr-4 font-mono text-axal-muted">{period}</td>
    <td className="py-2.5 pr-4 text-axal-muted">{m.source_url
      ? <a href={m.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline hover:text-axal-violet">{m.source_name || 'Source'} <ExternalLink size={11} /></a>
      : (m.source_name || 'Not recorded')}</td>
    <td className="py-2.5 font-mono text-axal-faint">{String(m.retrieved_at || '').slice(0, 10) || 'Not recorded'}</td>
  </tr>;
}

export default function MarketSectorProfile({ role = 'founder' }) {
  const { slug } = useParams();
  const sector = (data.items || []).find((x) => x.slug === slug);
  const [signals, setSignals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [universe, setUniverse] = useState([]);
  const [universeTotal, setUniverseTotal] = useState(0);
  const [universeLoading, setUniverseLoading] = useState(true);
  const [universeError, setUniverseError] = useState('');
  // The market record itself (migration 368). One call returns the record, its
  // sourced observations, its company graph and the sources they lean on, so the
  // sections cannot disagree about what exists.
  const [record, setRecord] = useState(null);
  const [recordLoading, setRecordLoading] = useState(true);
  const [recordError, setRecordError] = useState('');
  const load = useCallback(async () => { if (!sector) return; setLoading(true); try { const r = await api.signals.list({ sector: sector.name, mode: role === 'advisor' ? 'advisor' : 'founder', limit: 50 }); setSignals(r?.signals || []); } catch (e) { setError(e?.message || 'Signals could not be loaded.'); } finally { setLoading(false); } }, [role, sector]);
  // Read the universe from the directory table rather than shipping a copy in
  // the bundle: the taxonomy label is what ties a company to this sector, and
  // the count reported here is the number of records that actually exist.
  const loadUniverse = useCallback(async () => {
    if (!sector) return;
    setUniverseLoading(true);
    try {
      const r = await api.research.companyDirectory({ sector: sector.name, limit: UNIVERSE_PREVIEW });
      setUniverse(r?.items || []);
      setUniverseTotal(Number(r?.total || (r?.items || []).length));
      setUniverseError('');
    } catch (e) {
      setUniverse([]);
      setUniverseTotal(0);
      setUniverseError(e?.message || 'The company universe could not be loaded.');
    } finally {
      setUniverseLoading(false);
    }
  }, [sector]);
  const loadRecord = useCallback(async () => {
    if (!sector) return;
    setRecordLoading(true);
    try {
      const r = await api.research.marketRecord(sector.slug);
      setRecord(r || null);
      setRecordError('');
    } catch (e) {
      setRecord(null);
      setRecordError(e?.message || 'The market record could not be loaded.');
    } finally {
      setRecordLoading(false);
    }
  }, [sector]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadUniverse(); }, [loadUniverse]);
  useEffect(() => { loadRecord(); }, [loadRecord]);
  const market = record?.market || null;
  const metrics = record?.metrics || [];
  const facets = record?.facets || [];
  const sources = record?.sources || [];
  const suppliedMetric = metrics.find((m) => m.metric_name === 'supplied_company_count') || null;
  const grouped = useMemo(() => {
    const out = {};
    for (const f of facets) (out[f.kind] = out[f.kind] || []).push(f);
    return out;
  }, [facets]);
  const recordFilled = market ? RECORD_FIELDS.filter((f) => market[f] !== null && market[f] !== undefined && market[f] !== '').length : 0;
  if (!sector) return <Card variant="dashed"><h1 className="text-sm font-extrabold">Market not found</h1><Link to="/research/markets" className="mt-2 inline-block text-[12px] text-axal-violet underline">Back to markets</Link></Card>;
  const latest = signals[0];
  const directoryUrl = `/research/companies?sector=${encodeURIComponent(sector.slug)}`;
  const facetSections = FACET_SECTIONS.filter(([kind]) => (grouped[kind] || []).length > 0);
  // Facet kinds with no entry in the section list still render, under their raw
  // kind, rather than being dropped for being new.
  const otherKinds = Object.keys(grouped).filter((k) => !FACET_SECTIONS.some(([kind]) => kind === k));
  return <div data-testid="market-sector-profile" className="space-y-4">
    <Link to="/research/markets" className="inline-flex items-center gap-1 text-[12px] font-semibold text-axal-violet underline dark:text-violet-300"><ArrowLeft size={13} /> Markets</Link>
    <div><div className="text-[10px] font-extrabold uppercase tracking-[.1em] text-axal-faint">Sector market profile</div><h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{sector.name}</h1><p className="mt-1 text-[12.5px] text-axal-muted">The market record, its sourced observations, and the companies in it.</p></div>
    <Card className="border-violet-200 bg-violet-50/60 dark:border-violet-900 dark:bg-violet-950/20"><div className="flex items-start gap-2 text-[12px] leading-relaxed text-violet-950 dark:text-violet-100"><ShieldCheck size={15} className="mt-0.5 shrink-0" /><span><strong>How to read this page:</strong> every figure below is one observation with the source it came from and the day it was read, and a figure nobody has sourced is shown as <em>not recorded</em> rather than estimated. Company records are Wikidata identity facts (CC0) — a name, a website, a country, a founding year — and carry no funding, valuation, revenue or market-size claim.</span></div></Card>
    <Card><div className="grid grid-cols-2 gap-4 sm:grid-cols-4"><Fact label="Supplied taxonomy count" value={suppliedMetric ? Number(suppliedMetric.metric_value).toLocaleString() : sector.company_count.toLocaleString()} /><Fact label="Recorded profiles" value={universeLoading ? 'Loading…' : universeTotal.toLocaleString()} /><Fact label="Sourced observations" value={recordLoading ? 'Loading…' : metrics.length.toLocaleString()} /><Fact label="Growth direction" value={latest?.market?.growth_direction} /></div>
      <p className="mt-3 text-[11px] leading-relaxed text-axal-faint">{suppliedMetric ? `The supplied count is recorded as an observation from ${suppliedMetric.source_name || 'Axal'}${suppliedMetric.retrieved_at ? ` on ${String(suppliedMetric.retrieved_at).slice(0, 10)}` : ''}; it is a discovery-universe count, not TAM.` : 'The count shown is the supplied taxonomy count; the market record does not hold it yet.'}{market ? ` ${recordFilled} of the record's ${RECORD_FIELDS.length} fields currently hold a value.` : ''}</p></Card>
    {(error || recordError) && <Card variant="dashed"><p className="text-[12px] text-red-700 dark:text-red-300">{error || recordError}</p></Card>}
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-sm font-extrabold tracking-tight">Sourced observations</h2><p className="mt-1 text-[12px] text-axal-muted">Each row is one published figure with its own source and date. A newer figure is a new row, not a correction — the earlier observation stands as the record of what was published.</p></div><Link to="/research/markets" className="text-[12px] font-semibold text-axal-violet underline">All markets</Link></div>
      {recordLoading ? <p className="mt-4 text-[12px] text-axal-muted">Loading the market record.</p> : !metrics.length ? <p className="mt-4 rounded-lg border border-dashed border-axal-hairline px-3 py-4 text-[12px] leading-relaxed text-axal-muted">No sourced observation is recorded for this market. That is a gap in coverage, not a zero: no market size, growth rate, funding total or deal count has been published here with a citation, and none is estimated to fill the space.</p> : <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[620px] text-left text-[12px]"><thead className="text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint"><tr><th className="py-2 pr-4">Observation</th><th className="py-2 pr-4">Figure</th><th className="py-2 pr-4">Period</th><th className="py-2 pr-4">Source</th><th className="py-2">Read</th></tr></thead><tbody className="divide-y divide-axal-hairline dark:divide-gray-800">{metrics.map((m) => <MetricRow key={m.market_metric_id} m={m} />)}</tbody></table></div>}
    </Card>
    <Card><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-sm font-extrabold tracking-tight">Company universe</h2><p className="mt-1 text-[12px] text-axal-muted">Every record the directory holds for this sector{universeTotal > universe.length ? `, first ${universe.length} shown` : ''}. In the dataset each row is a market → company relationship, not just a sector label.</p></div><Link to={directoryUrl} className="text-[12px] font-semibold text-axal-violet underline">Open the company directory</Link></div>{universeLoading ? <p className="mt-4 text-[12px] text-axal-muted">Loading the sector universe.</p> : universeError ? <p className="mt-4 rounded-lg border border-dashed border-axal-hairline px-3 py-4 text-[12px] leading-relaxed text-red-700 dark:text-red-300">{universeError}</p> : !universe.length ? <p className="mt-4 rounded-lg border border-dashed border-axal-hairline px-3 py-4 text-[12px] leading-relaxed text-axal-muted">No company record carries this taxonomy label yet. The count above is the supplied taxonomy count; this table holds the source-backed records.</p> : <><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[560px] text-left text-[12px]"><thead className="text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint"><tr><th className="py-2 pr-4">Company</th><th className="py-2 pr-4">Country</th><th className="py-2 pr-4">Founded</th><th className="py-2">Source</th></tr></thead><tbody className="divide-y divide-axal-hairline dark:divide-gray-800">{universe.map((x) => <tr key={x.uid}><td className="py-2.5 pr-4"><Link to={`/research/companies/company/${x.uid}`} className="font-semibold text-axal-violet underline dark:text-violet-300">{x.name}</Link><div className="mt-0.5 text-[11px] text-axal-faint">{hostOf(x.website)}</div></td><td className="py-2.5 pr-4 text-axal-muted">{x.country || 'Not recorded'}</td><td className="py-2.5 pr-4 font-mono text-axal-muted">{x.founded_year || 'Not recorded'}</td><td className="py-2.5"><a href={x.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-axal-faint underline hover:text-axal-violet">Wikidata <ExternalLink size={11} /></a></td></tr>)}</tbody></table></div>{universeTotal > universe.length && <p className="mt-3 text-[11px] text-axal-faint">Showing {universe.length} of {universeTotal.toLocaleString()} recorded profiles. The directory pages through the rest.</p>}</>}</Card>
    <Card><h2 className="text-sm font-extrabold tracking-tight">Funds and rounds in this market</h2><p className="mt-1 text-[12px] text-axal-muted">No licensed fund or deal register is connected to this deployment, so this section is empty by default rather than estimated. It fills from observations that arrive with a citation.</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><div className="rounded-lg border border-dashed border-axal-hairline px-3 py-3 text-[12px] leading-relaxed text-axal-muted"><div className="text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint">Funds</div>{recordLoading ? 'Loading…' : (record?.funds || []).length ? `${record.funds.length} recorded` : 'Not recorded'}</div><div className="rounded-lg border border-dashed border-axal-hairline px-3 py-3 text-[12px] leading-relaxed text-axal-muted"><div className="text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint">Rounds</div>{recordLoading ? 'Loading…' : (record?.investments || []).length ? `${record.investments.length} recorded` : 'Not recorded'}</div></div></Card>
    {facetSections.length > 0 && <Card><h2 className="text-sm font-extrabold tracking-tight">Recorded statements</h2><p className="mt-1 text-[12px] text-axal-muted">Trends, technologies, competitors, exits and definitions, each with the source it came from.</p><div className="mt-4 space-y-4">{facetSections.map(([kind, title]) => <div key={kind}><h3 className="text-[11px] font-extrabold uppercase tracking-[.08em] text-axal-faint">{title}</h3><ul className="mt-2 space-y-2">{grouped[kind].map((f) => <li key={f.id} className="rounded-lg border border-axal-hairline p-3 text-[12px] dark:border-gray-800"><div className="flex flex-wrap items-start justify-between gap-2"><span className="font-semibold text-axal-ink dark:text-gray-100">{f.label}{f.value !== null && f.value !== undefined ? <span className="ml-2 font-mono text-axal-muted">{Number(f.value).toLocaleString()}{f.unit ? ` ${f.unit}` : ''}</span> : null}</span>{f.source_url ? <a href={f.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-axal-faint underline hover:text-axal-violet">{f.source_id || 'Source'} <ExternalLink size={11} /></a> : <span className="text-[11px] text-axal-faint">{f.source_id || 'Not recorded'}</span>}</div>{f.detail && <p className="mt-1 leading-relaxed text-axal-muted">{f.detail}</p>}{f.observed_at && <div className="mt-1 text-[11px] text-axal-faint">Observed {String(f.observed_at).slice(0, 10)}</div>}</li>)}</ul></div>)}
      {otherKinds.map((kind) => <div key={kind}><h3 className="text-[11px] font-extrabold uppercase tracking-[.08em] text-axal-faint">{kind.replace(/_/g, ' ')}</h3><ul className="mt-2 space-y-2">{grouped[kind].map((f) => <li key={f.id} className="rounded-lg border border-axal-hairline p-3 text-[12px] dark:border-gray-800"><span className="font-semibold text-axal-ink dark:text-gray-100">{f.label}</span>{f.detail && <p className="mt-1 leading-relaxed text-axal-muted">{f.detail}</p>}</li>)}</ul></div>)}</div></Card>}
    {(market?.axal_thesis || market?.definition || market?.description) && <Card><h2 className="text-sm font-extrabold tracking-tight">Axal view</h2>{market.definition && <p className="mt-2 text-[12px] leading-relaxed text-axal-ink dark:text-gray-100"><strong>Definition.</strong> {market.definition}</p>}{market.description && <p className="mt-2 text-[12px] leading-relaxed text-axal-muted">{market.description}</p>}{market.axal_thesis && <p className="mt-2 text-[12px] leading-relaxed text-axal-muted"><strong>Axal thesis.</strong> {market.axal_thesis}</p>}</Card>}
    {sources.length > 0 && <Card><h2 className="text-sm font-extrabold tracking-tight">Sources behind this page</h2><ul className="mt-3 space-y-2">{sources.map((s) => <li key={s.source_id} className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-axal-hairline px-3 py-2 text-[12px] dark:border-gray-800"><span className="font-semibold text-axal-ink dark:text-gray-100">{s.name}<span className="ml-2 rounded-full border border-axal-hairline px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[.06em] text-axal-faint dark:border-gray-800">{s.source_type}</span></span><span className="text-axal-faint">{s.license || 'Licence not recorded'}{s.homepage ? <> · <a href={s.homepage} target="_blank" rel="noreferrer" className="underline hover:text-axal-violet">Open <ExternalLink size={11} className="inline" /></a></> : null}</span></li>)}</ul></Card>}
    <Card><div className="flex items-center justify-between gap-2"><div><h2 className="text-sm font-extrabold tracking-tight">Public signals</h2><p className="mt-1 text-[12px] text-axal-muted">Exact sector matches from the public-company evidence engine.</p></div><Link to="/signals" className="text-[12px] font-semibold text-axal-violet underline">Open full signals feed</Link></div>{loading ? <p className="mt-4 text-[12px] text-axal-muted">Checking the live public signal feed.</p> : !signals.length ? <p className="mt-4 rounded-lg border border-dashed border-axal-hairline px-3 py-4 text-[12px] leading-relaxed text-axal-muted">No exact live signal is recorded for this taxonomy label yet. That is an evidence gap, not a zero-growth or low-risk conclusion.</p> : <div className="mt-4 space-y-3">{signals.map((s) => <div key={s.id} className="rounded-lg border border-axal-hairline p-3 dark:border-gray-800"><div className="flex items-start justify-between gap-3"><h3 className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{s.title}</h3><span className="text-[11px] text-violet-700 dark:text-violet-300">Signal {s.rank_score ?? '—'}</span></div><p className="mt-1 text-[12px] leading-relaxed text-axal-muted">{s.thesis}</p><div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-axal-faint"><span>Size proxy: {MARKET_CAP_BAND_LABEL[s.market_cap_band] || s.market_cap_band || 'Not recorded'}</span><span>Confidence: {s.confidence_score ?? '—'}%</span><span>{(s.evidence_items || []).length} evidence items</span><span>Updated {timeAgo(s.updated_at)}</span></div></div>)}</div>}</Card>
    <Card><h2 className="text-sm font-extrabold tracking-tight">Next research actions</h2><ul className="mt-2 list-disc space-y-1 pl-5 text-[12px] leading-relaxed text-axal-muted"><li>Use the taxonomy count as a universe-sizing input only.</li><li>Open a recorded profile to confirm identity facts against its Wikidata source.</li><li>Record TAM, growth, funding or exit figures here only with the publication they came from — an unsourced number is not accepted by the API.</li><li>A newer figure is written as a new observation; the previous one stays as the record of what was published.</li></ul><a href="https://query.wikidata.org/" target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-[12px] text-axal-violet underline">Public data query reference <ExternalLink size={12} /></a></Card>
  </div>;
}