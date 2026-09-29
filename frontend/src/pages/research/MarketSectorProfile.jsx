import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, ShieldCheck } from 'lucide-react';
import { Card } from '../../ui';
import { api } from '../../lib/api';
import data from '../../data/marketDirectory.json';
import { MARKET_CAP_BAND_LABEL, timeAgo } from '../../lib/signalsMeta';

function Fact({ label, value }) { return <div><div className="text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint">{label}</div><div className="mt-1 text-[13px] text-axal-ink dark:text-gray-100">{value || 'Not recorded'}</div></div>; }

export default function MarketSectorProfile({ role = 'founder' }) {
  const { slug } = useParams();
  const sector = (data.items || []).find((x) => x.slug === slug);
  const [signals, setSignals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => { if (!sector) return; setLoading(true); try { const r = await api.signals.list({ sector: sector.name, mode: role === 'advisor' ? 'advisor' : 'founder', limit: 50 }); setSignals(r?.signals || []); } catch (e) { setError(e?.message || 'Signals could not be loaded.'); } finally { setLoading(false); } }, [role, sector]);
  useEffect(() => { load(); }, [load]);
  if (!sector) return <Card variant="dashed"><h1 className="text-sm font-extrabold">Market not found</h1><Link to="/research/markets" className="mt-2 inline-block text-[12px] text-axal-violet underline">Back to markets</Link></Card>;
  const latest = signals[0];
  return <div data-testid="market-sector-profile" className="space-y-4">
    <Link to="/research/markets" className="inline-flex items-center gap-1 text-[12px] font-semibold text-axal-violet underline dark:text-violet-300"><ArrowLeft size={13} /> Markets</Link>
    <div><div className="text-[10px] font-extrabold uppercase tracking-[.1em] text-axal-faint">Sector market profile</div><h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{sector.name}</h1><p className="mt-1 text-[12.5px] text-axal-muted">Company universe and public evidence for this sector.</p></div>
    <Card className="border-violet-200 bg-violet-50/60 dark:border-violet-900 dark:bg-violet-950/20"><div className="flex items-start gap-2 text-[12px] leading-relaxed text-violet-950 dark:text-violet-100"><ShieldCheck size={15} className="mt-0.5 shrink-0" /><span><strong>Data boundary:</strong> the count is an Axal-provided taxonomy count. It is not TAM. Risk, growth, and signal strength below are shown only when supported by the public signal feed.</span></div></Card>
    <Card><div className="grid grid-cols-2 gap-4 sm:grid-cols-4"><Fact label="Taxonomy count" value={sector.company_count.toLocaleString()} /><Fact label="Market size" value="Not recorded · count is not TAM" /><Fact label="Growth direction" value={latest?.market?.growth_direction} /><Fact label="Risk" value={latest?.build?.risks} /></div></Card>
    {error && <Card variant="dashed"><p className="text-[12px] text-red-700 dark:text-red-300">{error}</p></Card>}
    <Card><div className="flex items-center justify-between gap-2"><div><h2 className="text-sm font-extrabold tracking-tight">Public signals</h2><p className="mt-1 text-[12px] text-axal-muted">Exact sector matches from the public-company evidence engine.</p></div><Link to="/signals" className="text-[12px] font-semibold text-axal-violet underline">Open full signals feed</Link></div>{loading ? <p className="mt-4 text-[12px] text-axal-muted">Checking the live public signal feed.</p> : !signals.length ? <p className="mt-4 rounded-lg border border-dashed border-axal-hairline px-3 py-4 text-[12px] leading-relaxed text-axal-muted">No exact live signal is recorded for this taxonomy label yet. That is an evidence gap, not a zero-growth or low-risk conclusion.</p> : <div className="mt-4 space-y-3">{signals.map((s) => <div key={s.id} className="rounded-lg border border-axal-hairline p-3 dark:border-gray-800"><div className="flex items-start justify-between gap-3"><h3 className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{s.title}</h3><span className="text-[11px] text-violet-700 dark:text-violet-300">Signal {s.rank_score ?? '—'}</span></div><p className="mt-1 text-[12px] leading-relaxed text-axal-muted">{s.thesis}</p><div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-axal-faint"><span>Size proxy: {MARKET_CAP_BAND_LABEL[s.market_cap_band] || s.market_cap_band || 'Not recorded'}</span><span>Confidence: {s.confidence_score ?? '—'}%</span><span>{(s.evidence_items || []).length} evidence items</span><span>Updated {timeAgo(s.updated_at)}</span></div></div>)}</div>}</Card>
    <Card><h2 className="text-sm font-extrabold tracking-tight">Next research actions</h2><ul className="mt-2 list-disc space-y-1 pl-5 text-[12px] leading-relaxed text-axal-muted"><li>Use the taxonomy count as a universe-sizing input only.</li><li>Open the signals feed to widen the sector label when exact matching is too narrow.</li><li>Add sourced TAM, growth, and risk evidence here only after reviewing the underlying public source.</li></ul><a href="https://query.wikidata.org/" target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-[12px] text-axal-violet underline">Public data query reference <ExternalLink size={12} /></a></Card>
  </div>;
}
