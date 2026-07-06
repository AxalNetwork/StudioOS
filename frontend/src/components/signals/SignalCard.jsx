import React from 'react';
import { MapPin, Building2, Users2, ArrowUpRight, Hammer, Compass, Clock } from 'lucide-react';
import {
  signalTypeMeta, evidenceKindMeta, toneChip, confidenceTone,
  facetLabel, MARKET_CAP_BAND_LABEL, timeAgo,
} from '../../lib/signalsMeta';

/**
 * SignalCard — one ranked, founder-actionable signal.
 *
 * Renders (per spec): title · one-sentence thesis · region/country ·
 * sector/niche · target customers · representative public companies · why-now ·
 * confidence score · evidence chips · and a mode-specific action line
 * (Build angle in Founder mode, Advisor note in Advisor mode).
 *
 * Deliberately card-first and text-forward — NO price chart. The only quantified
 * visual is the confidence meter, which is about credibility, not price.
 */
function ScoreMeter({ score, label, barClass }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex-1 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden min-w-[48px]">
        <div className={`h-full ${barClass}`} style={{ width: `${Math.max(4, score)}%` }} />
      </div>
      <span className="text-xs tabular-nums text-gray-500 dark:text-gray-400 whitespace-nowrap">{label}</span>
    </div>
  );
}

function Chip({ children, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${className}`}>
      {children}
    </span>
  );
}

export default function SignalCard({ signal, mode = 'founder', onOpen, rank }) {
  const meta = signalTypeMeta(signal.type);
  const TypeIcon = meta.icon;
  const conf = confidenceTone(signal.confidence_score);
  const evidenceKinds = [...new Set((signal.evidence_items || []).map((e) => e.kind))];
  const companies = signal.related_companies || [];

  return (
    <article
      className="group bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 hover:border-violet-300 dark:hover:border-violet-700 hover:shadow-sm transition-all cursor-pointer"
      onClick={() => onOpen && onOpen(signal)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen && onOpen(signal); }
      }}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          {typeof rank === 'number' && (
            <span className="shrink-0 w-6 h-6 rounded-full bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-semibold flex items-center justify-center">
              {rank}
            </span>
          )}
          <Chip className="bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 shrink-0">
            <TypeIcon size={12} aria-hidden="true" />
            {meta.label}
          </Chip>
        </div>
        <Chip className={`${conf.chip} shrink-0`}>
          {conf.label} · {signal.confidence_score}%
        </Chip>
      </div>

      {/* Title + thesis */}
      <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 leading-snug flex items-start gap-1">
        <span className="min-w-0">{signal.title}</span>
        <ArrowUpRight size={16} className="mt-0.5 shrink-0 text-gray-300 dark:text-gray-600 group-hover:text-violet-500 transition-colors" />
      </h3>
      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 leading-relaxed">{signal.thesis}</p>

      {/* Meta row: region · sector · buyers */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 text-xs text-gray-500 dark:text-gray-400">
        <span className="inline-flex items-center gap-1">
          <MapPin size={12} /> {signal.region}{signal.country ? ` · ${signal.country}` : ''}
        </span>
        <span className="inline-flex items-center gap-1">
          <Building2 size={12} /> {signal.sector}
          <span className="text-gray-400 dark:text-gray-500">/ {signal.niche}</span>
        </span>
        {(signal.target_customers || []).length > 0 && (
          <span className="inline-flex items-center gap-1">
            <Users2 size={12} />
            {(signal.target_customers || []).map((c) => facetLabel('customer_type', c)).join(', ')}
          </span>
        )}
      </div>

      {/* Representative companies + market-cap band */}
      {companies.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mt-3">
          <span className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500 mr-0.5">Evidence from</span>
          {companies.slice(0, 5).map((sym) => (
            <span key={sym} className="text-xs font-mono px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
              {sym}
            </span>
          ))}
          <span className="text-[11px] text-gray-400 dark:text-gray-500 ml-1" title={MARKET_CAP_BAND_LABEL[signal.market_cap_band]}>
            {(MARKET_CAP_BAND_LABEL[signal.market_cap_band] || signal.market_cap_band)}
          </span>
        </div>
      )}

      {/* Evidence chips */}
      <div className="flex flex-wrap gap-1.5 mt-3">
        {evidenceKinds.map((k) => {
          const em = evidenceKindMeta(k);
          const EIcon = em.icon;
          return (
            <Chip key={k} className={toneChip(em.tone)}>
              <EIcon size={11} aria-hidden="true" />
              {em.label}
            </Chip>
          );
        })}
      </div>

      {/* Mode-specific action line */}
      <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800">
        {mode === 'advisor' ? (
          <div className="flex items-start gap-2">
            <Compass size={15} className="mt-0.5 shrink-0 text-sky-500" />
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">Advisor note</div>
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{signal.advisor_note}</p>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2">
            <Hammer size={15} className="mt-0.5 shrink-0 text-violet-500" />
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">Build angle</div>
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                {signal.build?.headline || signal.founder_opportunity}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Footer: rank/confidence meters + freshness */}
      <div className="grid grid-cols-2 gap-3 mt-3">
        <ScoreMeter score={signal.rank_score ?? 0} label={`Signal ${signal.rank_score ?? 0}`} barClass="bg-violet-500" />
        <ScoreMeter score={signal.freshness_score ?? 0} label="Fresh" barClass={conf.bar} />
      </div>
      <div className="flex items-center gap-1 mt-2 text-[11px] text-gray-400 dark:text-gray-500">
        <Clock size={11} /> Updated {timeAgo(signal.updated_at)}
      </div>
    </article>
  );
}
