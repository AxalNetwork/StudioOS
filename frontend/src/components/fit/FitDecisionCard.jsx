// Fit v2 — compact latest-decision card. Used by ProfileFitSection (dashboard)
// and anywhere a one-glance fit summary is needed. Clean empty state → CTA to
// the staged assessment.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Scale, Loader2, AlertCircle, ArrowRight } from 'lucide-react';
import { api } from '../../lib/api';

export const OUTCOME_CLS = {
  high_fit: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700',
  conditional_fit: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 border-sky-300 dark:border-sky-700',
  specialist_fit: 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 border-violet-300 dark:border-violet-700',
  low_fit: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700',
  misaligned: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border-red-300 dark:border-red-700',
  insufficient_evidence: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600',
};

export function OutcomeChip({ outcome, label, className = '' }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${OUTCOME_CLS[outcome] || OUTCOME_CLS.insufficient_evidence} ${className}`}>
      {label || outcome}
    </span>
  );
}

export default function FitDecisionCard({ className = '' }) {
  const [state, setState] = useState({ loading: true, error: null, latest: null });

  useEffect(() => {
    let alive = true;
    api.fit
      .decisionsMe()
      .then((res) => { if (alive) setState({ loading: false, error: null, latest: res?.latest || null }); })
      .catch((e) => { if (alive) setState({ loading: false, error: e?.message || 'failed', latest: null }); });
    return () => { alive = false; };
  }, []);

  const { loading, error, latest } = state;
  let body;
  if (loading) {
    body = <div className="h-[90px] flex items-center justify-center text-gray-400"><Loader2 className="animate-spin" size={18} /></div>;
  } else if (error) {
    body = (
      <div className="flex items-start gap-2 text-sm text-red-700 dark:text-red-300">
        <AlertCircle size={15} className="mt-0.5 flex-shrink-0" /><span>Couldn’t load your fit decision. {error}</span>
      </div>
    );
  } else if (!latest) {
    body = (
      <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/40 p-4">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          The Fit Assessment measures your values, operating style, and skills separately — then gives you a real decision, not a label.
        </p>
        <Link to="/fit" className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-violet-600 dark:text-violet-400 hover:underline">
          Take the Fit Assessment <ArrowRight size={14} />
        </Link>
      </div>
    );
  } else {
    body = (
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <OutcomeChip outcome={latest.outcome} label={latest.outcome_label} />
          <span className="text-xs text-gray-500 dark:text-gray-400">as {latest.role_label || latest.role_context}</span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3 text-center">
          <div>
            <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">{Math.round(latest.culture_score)}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Culture fit</div>
          </div>
          <div>
            <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">{Math.round(latest.role_score)}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Role capability</div>
          </div>
          <div>
            <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">{Math.round((latest.confidence || 0) * 100)}%</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Confidence</div>
          </div>
        </div>
        <Link to="/fit/results" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-violet-600 dark:text-violet-400 hover:underline">
          Full results <ArrowRight size={14} />
        </Link>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 ${className}`}>
      <div className="flex items-center gap-2 mb-3">
        <Scale size={16} className="text-violet-600 dark:text-violet-400" />
        <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Fit decision</h4>
      </div>
      {body}
    </div>
  );
}
