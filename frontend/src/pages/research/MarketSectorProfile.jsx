import React, { useCallback, useEffect, useState } from 'react';
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

function hostOf(website) { try { return new URL(website).host.replace(/^www\./, ''); } catch { return website || 'Not recorded'; } }

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
  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadUniverse(); }, [loadUniverse]);
  if (!sector) return <Card variant="dashed"><h1 className="text-sm font-extrabold">Market not found</h1><Link to="/research/markets" className="mt-2 inline-block text-[12px] text-axal-violet underline">Back to markets</Link></Card>;
  const latest = signals[0];
  const directoryUrl = `/research/companies?sector=${encodeURIComponent(sector.slug)}`;
  return <div data-testid="market-sector-profile" className="space-y-4">
    <Link to="/research/markets" className="inline-flex items-center gap-1 text-[12px] font-semibold text-axal-violet underline dark:text-violet-300"><ArrowLeft size={13} /> Markets</Link>
    <div><div className="text-[10px] font-extrabold uppercase tracking-[.1em] text-axal-faint">Sector market profile</div><h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{sector.name}</h1><p className="mt-1 text-[12.5px] text-axal-muted">Company universe and public evidence for this sector.</p></div>
    <Card className="border-violet-200 bg-violet-50/60 dark:border-violet-900 dark:bg-violet-950/20"><div className="flex items-start gap-2 text-[12px] leading-relaxed text-violet-950 dark:text-violet-100"><ShieldCheck size={15} className="mt-0.5 shrink-0" /><span><strong>Data boundary:</strong> the taxonomy count is an Axal-provided discovery count and is not TAM. The recorded profiles below are source-backed identity metadata from Wikidata (CC0) and carry no funding, valuation, revenue or market-size claim.</span></div></Card>
    <Card><div className="grid grid-cols-2 gap-4 sm:grid-cols-4"><Fact label="Taxonomy count" value={sector.company_count.toLocaleString()} /><Fact label="Recorded profiles" value={universeLoading ? 'Loading…' : universeTotal.toLocaleString()} /><Fact label="Growth direction" value={latest?.market?.growth_direction} /><Fact label="Risk" value={latest?.build?.risks} /></div></Card>
    {error && <Card variant="dashed"><p className="text-[12px] text-red-700 dark:text-red-300">{error}</p></Card>}
    <Card><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-sm font-extrabold tracking-tight">Company universe</h2><p className="mt-1 text-[12px] text-axal-muted">Every record the directory holds for this sector{universeTotal > universe.length ? `, first ${universe.length} shown` : ''}.</p></div><Link to={directoryUrl} className="text-[12px] font-semibold text-axal-violet underline">Open the company directory</Link></div>{universeLoading ? <p className="mt-4 text-[12px] text-axal-muted">Loading the sector universe.</p> : universeError ? <p className="mt-4 rounded-lg border border-dashed border-axal-hairline px-3 py-4 text-[12px] leading-relaxed text-red-700 dark:text-red-300">{universeError}</p> : !universe.length ? <p className="mt-4 rounded-lg border border-dashed border-axal-hairline px-3 py-4 text-[12px] leading-relaxed text-axal-muted">No company record carries this taxonomy label yet. The count above is the supplied taxonomy count; this table holds the source-backed records.</p> : <><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[560px] text-left text-[12px]"><thead className="text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint"><tr><th className="py-2 pr-4">Company</th><th className="py-2 pr-4">Country</th><th className="py-2 pr-4">Founded</th><th className="py-2">Source</th></tr></thead><tbody className="divide-y divide-axal-hairline dark:divide-gray-800">{universe.map((x) => <tr key={x.uid}><td className="py-2.5 pr-4"><Link to={`/research/companies/company/${x.uid}`} className="font-semibold text-axal-violet underline dark:text-violet-300">{x.name}</Link><div className="mt-0.5 text-[11px] text-axal-faint">{hostOf(x.website)}</div></td><td className="py-2.5 pr-4 text-axal-muted">{x.country || 'Not recorded'}</td><td className="py-2.5 pr-4 font-mono text-axal-muted">{x.founded_year || 'Not recorded'}</td><td className="py-2.5"><a href={x.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-axal-faint underline hover:text-axal-violet">Wikidata <ExternalLink size={11} /></a></td></tr>)}</tbody></table></div>{universeTotal > universe.length && <p className="mt-3 text-[11px] text-axal-faint">Showing {universe.length} of {universeTotal.toLocaleString()} recorded profiles. The directory pages through the rest.</p>}</>}</Card>
    <Card><div className="flex items-center justify-between gap-2"><div><h2 className="text-sm font-extrabold tracking-tight">Public signals</h2><p className="mt-1 text-[12px] text-axal-muted">Exact sector matches from the public-company evidence engine.</p></div><Link to="/signals" className="text-[12px] font-semibold text-axal-violet underline">Open full signals feed</Link></div>{loading ? <p className="mt-4 text-[12px] text-axal-muted">Checking the live public signal feed.</p> : !signals.length ? <p className="mt-4 rounded-lg border border-dashed border-axal-hairline px-3 py-4 text-[12px] leading-relaxed text-axal-muted">No exact live signal is recorded for this taxonomy label yet. That is an evidence gap, not a zero-growth or low-risk conclusion.</p> : <div className="mt-4 space-y-3">{signals.map((s) => <div key={s.id} className="rounded-lg border border-axal-hairline p-3 dark:border-gray-800"><div className="flex items-start justify-between gap-3"><h3 className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{s.title}</h3><span className="text-[11px] text-violet-700 dark:text-violet-300">Signal {s.rank_score ?? '—'}</span></div><p className="mt-1 text-[12px] leading-relaxed text-axal-muted">{s.thesis}</p><div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-axal-faint"><span>Size proxy: {MARKET_CAP_BAND_LABEL[s.market_cap_band] || s.market_cap_band || 'Not recorded'}</span><span>Confidence: {s.confidence_score ?? '—'}%</span><span>{(s.evidence_items || []).length} evidence items</span><span>Updated {timeAgo(s.updated_at)}</span></div></div>)}</div>}</Card>
    <Card><h2 className="text-sm font-extrabold tracking-tight">Next research actions</h2><ul className="mt-2 list-disc space-y-1 pl-5 text-[12px] leading-relaxed text-axal-muted"><li>Use the taxonomy count as a universe-sizing input only.</li><li>Open a recorded profile to confirm identity facts against its Wikidata source.</li><li>Add sourced TAM, growth, and risk evidence here only after reviewing the underlying public source.</li></ul><a href="https://query.wikidata.org/" target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-[12px] text-axal-violet underline">Public data query reference <ExternalLink size={12} /></a></Card>
  </div>;
}