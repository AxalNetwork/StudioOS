import React, { useState, useEffect } from 'react';
import {
  X, ExternalLink, Hammer, Compass, Target, Route, Shield, AlertTriangle,
  Building2, ShieldCheck, BarChart3, Clock,
} from 'lucide-react';
import { api } from '../../lib/api';
import {
  signalTypeMeta, evidenceKindMeta, toneChip, confidenceTone, facetLabel,
  MARKET_CAP_BAND_LABEL, prettify, timeAgo,
} from '../../lib/signalsMeta';

/**
 * SignalEvidencePanel — right-hand slide-over with the full evidence + source
 * citations for one signal. This is where a founder (or advisor) inspects WHY a
 * signal is credible: the ranking breakdown, every evidence item with its
 * source and freshness, the supporting companies, and the full build angle.
 */
const RANK_FACTOR_LABEL = {
  evidence_volume: 'Evidence volume',
  freshness: 'Freshness',
  cross_source_agreement: 'Cross-source agreement',
  cap_diversity: 'Market-cap diversity',
  sector_repetition: 'Sector repetition',
  geo_concentration: 'Geographic concentration',
  customer_pain: 'Customer-pain strength',
  practicality: 'Buildability (practicality)',
};

function useLockBodyScroll() {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);
}

function Section({ title, icon: Icon, children }) {
  return (
    <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
      <div className="flex items-center gap-2 mb-2.5 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {Icon && <Icon size={13} className="text-violet-500" aria-hidden="true" />}
        {title}
      </div>
      {children}
    </div>
  );
}

function BuildField({ icon: Icon, label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2 mb-2.5 last:mb-0">
      <Icon size={14} className="mt-0.5 shrink-0 text-gray-400 dark:text-gray-500" aria-hidden="true" />
      <div>
        <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400">{label}</div>
        <div className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{value}</div>
      </div>
    </div>
  );
}

export default function SignalEvidencePanel({ signalId, mode = 'founder', onClose }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  useLockBodyScroll();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.signals.get(signalId, mode)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((e) => { if (!cancelled) setError(e.message || 'Failed to load signal'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [signalId, mode]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const signal = detail?.signal;
  const meta = signal ? signalTypeMeta(signal.type) : null;
  const TypeIcon = meta?.icon;
  const conf = signal ? confidenceTone(signal.confidence_score) : null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Signal evidence">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white dark:bg-gray-900 h-full overflow-y-auto shadow-xl animate-[slideIn_0.2s_ease-out]">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-5 py-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {meta && (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 mb-1.5">
                <TypeIcon size={12} /> {meta.label}
              </span>
            )}
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 leading-snug">
              {loading ? 'Loading signal…' : (signal?.title || 'Signal')}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {error && (
          <div className="m-5 p-4 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {loading && (
          <div className="p-5 space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-16 rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse" />
            ))}
          </div>
        )}

        {signal && !loading && (
          <>
            {/* Scores */}
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 grid grid-cols-3 gap-3">
              <ScoreTile label="Signal rank" value={signal.rank_score} tone="violet" icon={BarChart3} />
              <ScoreTile label="Confidence" value={signal.confidence_score} tone="emerald" icon={ShieldCheck} chip={conf?.label} />
              <ScoreTile label="Freshness" value={signal.freshness_score} tone="sky" icon={Clock} />
            </div>

            {/* Thesis + why now */}
            <Section title="Thesis" icon={Target}>
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{signal.thesis}</p>
            </Section>
            {signal.why_now && (
              <Section title="Why now">
                <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{signal.why_now}</p>
              </Section>
            )}

            {/* Facets */}
            <Section title="At a glance">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <Fact label="Region" value={`${signal.region}${signal.country ? ` · ${signal.country}` : ''}`} />
                <Fact label="Sector" value={signal.sector} />
                <Fact label="Niche" value={signal.niche} />
                <Fact label="Market cap" value={MARKET_CAP_BAND_LABEL[signal.market_cap_band] || signal.market_cap_band} />
                <Fact label="Maturity" value={prettify(signal.maturity_stage)} />
                <Fact label="Target buyers" value={(signal.target_customers || []).map((c) => facetLabel('customer_type', c)).join(', ')} />
              </dl>
            </Section>

            {/* Build angle */}
            {mode === 'advisor' ? (
              <Section title="Advisor guidance" icon={Compass}>
                <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed mb-3">{signal.advisor_note}</p>
                <BuildField icon={Hammer} label="If a founder builds it" value={signal.founder_opportunity} />
              </Section>
            ) : (
              <Section title="Build angle" icon={Hammer}>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3">{signal.build?.headline || signal.founder_opportunity}</p>
                <BuildField icon={Route} label="Entry wedge" value={signal.build?.wedge} />
                <BuildField icon={Target} label="Ideal customer" value={signal.build?.icp} />
                <BuildField icon={Route} label="Go-to-market" value={signal.build?.gtm} />
                <BuildField icon={Shield} label="Moat" value={signal.build?.moat} />
                <BuildField icon={AlertTriangle} label="Honest risks" value={signal.build?.risks} />
              </Section>
            )}

            {/* Related companies */}
            {detail.companies?.length > 0 && (
              <Section title="Representative public companies" icon={Building2}>
                <div className="overflow-x-auto -mx-1">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
                        <th className="text-left font-medium py-1 px-1">Company</th>
                        <th className="text-left font-medium py-1 px-1">Region</th>
                        <th className="text-left font-medium py-1 px-1">Cap</th>
                        <th className="text-left font-medium py-1 px-1">Size</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.companies.map((co) => (
                        <tr key={co.symbol} className="border-t border-gray-100 dark:border-gray-800">
                          <td className="py-1.5 px-1">
                            <div className="font-medium text-gray-900 dark:text-gray-100">{co.name}</div>
                            <div className="text-[11px] font-mono text-gray-400 dark:text-gray-500">{co.symbol}{co.exchange ? ` · ${co.exchange}` : ''}</div>
                          </td>
                          <td className="py-1.5 px-1 text-gray-600 dark:text-gray-400">{co.region || '—'}</td>
                          <td className="py-1.5 px-1 text-gray-600 dark:text-gray-400">{prettify(co.market_cap_band) || '—'}</td>
                          <td className="py-1.5 px-1 text-gray-600 dark:text-gray-400">{co.employee_band || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
            )}

            {/* Evidence items */}
            <Section title={`Evidence (${signal.evidence_items?.length || 0})`}>
              <ul className="space-y-2.5">
                {(signal.evidence_items || []).map((ev, i) => {
                  const em = evidenceKindMeta(ev.kind);
                  const EIcon = em.icon;
                  return (
                    <li key={ev.id || i} className="flex items-start gap-2.5">
                      <span className={`mt-0.5 shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full ${toneChip(em.tone)}`}>
                        <EIcon size={12} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-gray-800 dark:text-gray-200 leading-snug">
                          {ev.url ? (
                            <a href={ev.url} target="_blank" rel="noopener noreferrer" className="hover:text-violet-600 dark:hover:text-violet-400 inline-flex items-start gap-1">
                              {ev.title}
                              <ExternalLink size={11} className="mt-1 shrink-0 opacity-60" />
                            </a>
                          ) : ev.title}
                        </div>
                        <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
                          {em.label} · {(detail.sources.find((s) => s.key === ev.source_key)?.name) || ev.source_key} · {timeAgo(ev.observed_at)}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Section>

            {/* Ranking breakdown */}
            {signal.rank_breakdown && (
              <Section title="How this ranks" icon={BarChart3}>
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-2.5">
                  Ranking favours practical, buildable opportunities — not the biggest companies or the loudest headlines.
                </p>
                <div className="space-y-1.5">
                  {Object.entries(signal.rank_breakdown).map(([k, v]) => (
                    <div key={k} className="flex items-center gap-2">
                      <span className="text-xs text-gray-600 dark:text-gray-400 w-40 shrink-0">{RANK_FACTOR_LABEL[k] || prettify(k)}</span>
                      <div className="flex-1 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                        <div className="h-full bg-violet-500" style={{ width: `${Math.round((v || 0) * 100)}%` }} />
                      </div>
                      <span className="text-[11px] tabular-nums text-gray-400 dark:text-gray-500 w-8 text-right">{Math.round((v || 0) * 100)}</span>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Source attribution */}
            {detail.sources?.length > 0 && (
              <Section title="Source attribution" icon={ShieldCheck}>
                <div className="flex flex-wrap gap-1.5">
                  {detail.sources.map((s) => (
                    <span key={s.key} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300" title={s.notes || ''}>
                      {s.name}
                      <span className="text-[10px] text-gray-400 dark:text-gray-500">· {Math.round((s.quality_weight || 0) * 100)}% trust</span>
                    </span>
                  ))}
                </div>
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-2">
                  All evidence is derived from public data. Source trust weights and freshness feed the confidence score.
                </p>
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ScoreTile({ label, value, tone, icon: Icon, chip }) {
  const toneMap = {
    violet: 'text-violet-600 dark:text-violet-400',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    sky: 'text-sky-600 dark:text-sky-400',
  };
  return (
    <div className="text-center">
      <div className="flex items-center justify-center gap-1 text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
        {Icon && <Icon size={11} />} {label}
      </div>
      <div className={`text-xl font-semibold mt-0.5 ${toneMap[tone]}`}>{value}</div>
      {chip && <div className="text-[10px] text-gray-400 dark:text-gray-500">{chip}</div>}
    </div>
  );
}

function Fact({ label, value }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-gray-400 dark:text-gray-500">{label}</dt>
      <dd className="text-sm text-gray-800 dark:text-gray-200 truncate" title={value}>{value || '—'}</dd>
    </div>
  );
}
