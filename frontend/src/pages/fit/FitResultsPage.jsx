// Fit v2 — results screen (/fit/results). Renders the latest decision:
// outcome + playbook, culture vs role split, six values vs the Axal baseline,
// archetype primary/secondary, ten priority skills with validation badges,
// gaps / flags / consistency, and the confidence meter with "what would raise
// this" guidance. Reviewer overrides surface as the effective outcome.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Loader2, AlertCircle, Scale, ArrowRight, ShieldAlert, CheckCircle2,
  BadgeCheck, HelpCircle, RefreshCw,
} from 'lucide-react';
import { api } from '../../lib/api';
import { archetypeMeta, iconFor, humanize } from '../../lib/assessmentMeta';
import { OutcomeChip } from '../../components/fit/FitDecisionCard';

const CARD = 'rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5';
const H = 'text-sm font-semibold text-gray-900 dark:text-gray-100';
const SUB = 'text-xs text-gray-500 dark:text-gray-400';

const VALUE_LABELS = {
  integrity: 'Integrity',
  stewardship: 'Stewardship',
  curiosity: 'Curiosity',
  resilience: 'Resilience',
  collaboration: 'Collaboration',
  ambition: 'Compounding Ambition',
};

const SKILL_LABELS = {
  fitv2_fundraising_narrative: 'Fundraising & Capital Narrative',
  fitv2_market_research: 'Market Research',
  fitv2_analytical_judgment: 'Analytical Judgment',
  fitv2_product_thinking: 'Product Thinking',
  fitv2_sales_relationships: 'Sales & Relationships',
  fitv2_hiring: 'Hiring',
  fitv2_execution_management: 'Execution Management',
  fitv2_communication: 'Communication',
  fitv2_diligence: 'Diligence',
  fitv2_strategic_synthesis: 'Strategic Synthesis',
};

function ScoreBar({ value, max = 100, className = 'bg-violet-500' }) {
  const pct = Math.max(0, Math.min(100, (Number(value) || 0) / max * 100));
  return (
    <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
      <div className={`h-full rounded-full ${className}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function FitResultsPage() {
  const [state, setState] = useState({ loading: true, error: null, data: null });

  useEffect(() => {
    let alive = true;
    api.fit
      .resultsMe()
      .then((data) => { if (alive) setState({ loading: false, error: null, data }); })
      .catch((e) => { if (alive) setState({ loading: false, error: e?.message || 'failed', data: null }); });
    return () => { alive = false; };
  }, []);

  const { loading, error, data } = state;
  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-6 flex items-center justify-center min-h-[40vh] text-gray-400">
        <Loader2 className="animate-spin" size={22} />
      </div>
    );
  }
  if (error) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className={CARD}>
          <div className="flex items-start gap-2 text-sm text-red-700 dark:text-red-300">
            <AlertCircle size={15} className="mt-0.5 flex-shrink-0" /><span>{error}</span>
          </div>
        </div>
      </div>
    );
  }
  if (!data?.decision) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className={`${CARD} text-center py-10`}>
          <Scale size={28} className="mx-auto text-violet-600 dark:text-violet-400 mb-3" />
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">No fit decision yet</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Complete the staged assessment to get your three-layer profile and decision.</p>
          <Link to="/fit" className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 dark:bg-violet-500 dark:hover:bg-violet-600 text-white text-sm font-medium px-4 py-2">
            Take the Fit Assessment <ArrowRight size={15} />
          </Link>
        </div>
      </div>
    );
  }

  const d = data.decision;
  const baseline = data.baseline || {};
  const effective = data.effective_outcome || d.outcome;
  const overridden = data.reviewed && effective !== d.outcome;
  const primaryMeta = d.archetype_primary ? archetypeMeta(d.archetype_primary) : null;
  const secondaryMeta = d.archetype_secondary ? archetypeMeta(d.archetype_secondary) : null;
  const PrimaryIcon = primaryMeta ? iconFor(primaryMeta.icon) : Scale;
  const values = Object.entries(d.values || {});
  const skills = Object.entries(d.skills || {}).sort((a, b) => (b[1]?.score || 0) - (a[1]?.score || 0));
  const confidencePct = Math.round((d.confidence || 0) * 100);

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
      {/* Outcome banner */}
      <div className={CARD}>
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <OutcomeChip outcome={effective} label={data.effective_outcome_label || d.outcome_label} />
              {overridden ? (
                <span className={SUB}>partner-reviewed (engine said “{d.outcome_label}”)</span>
              ) : null}
              {data.requires_followup ? (
                <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300"><HelpCircle size={13} /> follow-up requested</span>
              ) : null}
            </div>
            <h1 className="mt-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
              {d.role_label} · {d.playbook?.definition}
            </h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{d.narrative}</p>
          </div>
          <Link to="/fit" className="inline-flex items-center gap-1.5 text-sm text-violet-600 dark:text-violet-400 hover:underline flex-shrink-0">
            <RefreshCw size={14} /> Retake / continue
          </Link>
        </div>
        <div className="mt-4 grid sm:grid-cols-3 gap-4">
          <div>
            <div className="flex items-baseline justify-between mb-1">
              <span className={SUB}>Culture fit</span>
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{Math.round(d.culture_score)}/100</span>
            </div>
            <ScoreBar value={d.culture_score} />
          </div>
          <div>
            <div className="flex items-baseline justify-between mb-1">
              <span className={SUB}>Role capability</span>
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{Math.round(d.role_score)}/100</span>
            </div>
            <ScoreBar value={d.role_score} className="bg-sky-500" />
          </div>
          <div>
            <div className="flex items-baseline justify-between mb-1">
              <span className={SUB}>Confidence</span>
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{confidencePct}%</span>
            </div>
            <ScoreBar value={confidencePct} className={confidencePct >= 60 ? 'bg-emerald-500' : 'bg-amber-500'} />
            <p className={`mt-1 ${SUB}`}>
              {confidencePct >= 60
                ? 'Consistent answers with evidence behind them.'
                : 'Raise this with more coverage, consistent answers, and concrete examples.'}
            </p>
          </div>
        </div>
      </div>

      {/* Next action */}
      <div className={CARD}>
        <h2 className={`${H} mb-2 flex items-center gap-2`}><CheckCircle2 size={15} className="text-emerald-500" /> What happens next</h2>
        <div className="grid sm:grid-cols-3 gap-4 text-sm text-gray-700 dark:text-gray-300">
          <div>
            <div className={`${SUB} mb-0.5`}>Recommended action</div>
            {d.playbook?.next_action}
          </div>
          <div>
            <div className={`${SUB} mb-0.5`}>Best environment</div>
            {d.playbook?.environment}
          </div>
          <div>
            <div className={`${SUB} mb-0.5`}>Validate next</div>
            {d.playbook?.validate_next}
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Values vs baseline */}
        <div className={CARD}>
          <h2 className={`${H} mb-3`}>Values — what you optimize for</h2>
          {values.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No values signal yet.</p>
          ) : (
            <div className="space-y-3">
              {values.map(([key, v]) => {
                const base = baseline[key];
                const short = base != null && v.score < base;
                return (
                  <div key={key}>
                    <div className="flex items-baseline justify-between mb-1">
                      <span className="text-sm text-gray-700 dark:text-gray-300">{VALUE_LABELS[key] || humanize(key)}</span>
                      <span className={`text-xs font-medium ${short ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {Math.round(v.score * 100)}{base != null ? ` / ${Math.round(base * 100)} bar` : ''}
                      </span>
                    </div>
                    <div className="relative">
                      <ScoreBar value={v.score * 100} className={short ? 'bg-amber-500' : 'bg-emerald-500'} />
                      {base != null ? (
                        <div
                          className="absolute top-[-2px] h-3 w-0.5 bg-gray-400 dark:bg-gray-500"
                          style={{ left: `${Math.round(base * 100)}%` }}
                          title={`Axal baseline ${Math.round(base * 100)}`}
                        />
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Archetype */}
        <div className={CARD}>
          <h2 className={`${H} mb-3`}>Operating archetype — how you work</h2>
          {primaryMeta ? (
            <div>
              <div className="flex items-center gap-3">
                <span
                  className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: `${primaryMeta.accent}22`, color: primaryMeta.accent }}
                >
                  <PrimaryIcon size={22} />
                </span>
                <div>
                  <div className="text-base font-semibold text-gray-900 dark:text-gray-100">{primaryMeta.label}</div>
                  <div className={SUB}>{primaryMeta.tagline}</div>
                </div>
              </div>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{primaryMeta.description}</p>
              {secondaryMeta ? (
                <p className={`mt-2 ${SUB}`}>Secondary: <span className="text-gray-700 dark:text-gray-300 font-medium">{secondaryMeta.label}</span> — {secondaryMeta.tagline}</p>
              ) : null}
              <p className={`mt-1 ${SUB}`}>Style is preference, not ability — it says where you thrive, not how good you are.</p>
            </div>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">Not enough operating-style signal yet — answer the archetype stage to classify.</p>
          )}
        </div>
      </div>

      {/* Skills */}
      <div className={CARD}>
        <h2 className={`${H} mb-3`}>Skills — what you can reliably execute</h2>
        {skills.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">No skills signal yet.</p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
            {skills.map(([slug, s]) => (
              <div key={slug}>
                <div className="flex items-baseline justify-between mb-1">
                  <span className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                    {SKILL_LABELS[slug] || humanize(slug)}
                    {s.validated ? (
                      <BadgeCheck size={14} className="text-emerald-500" title="Backed by evidence or scenario answers" />
                    ) : (
                      <span className="text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400">unvalidated</span>
                    )}
                  </span>
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{(s.score ?? 0).toFixed(1)}/5</span>
                </div>
                <ScoreBar value={(s.score || 0) * 20} className="bg-sky-500" />
              </div>
            ))}
          </div>
        )}
        <p className={`mt-3 ${SUB}`}>Self-ratings without an example are capped at 3.5 — attach evidence in the assessment to unlock the full scale.</p>
      </div>

      {/* Gaps + flags */}
      {(d.gaps?.length || d.flags?.length || d.contradictions > 0) ? (
        <div className={CARD}>
          <h2 className={`${H} mb-3 flex items-center gap-2`}><ShieldAlert size={15} className="text-amber-500" /> Watch items</h2>
          <ul className="space-y-1.5 text-sm text-gray-700 dark:text-gray-300">
            {(d.flags || []).map((f) => (
              <li key={f} className="flex items-start gap-2">
                <span className="mt-1 w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
                Red flag: {humanize(f)}
              </li>
            ))}
            {(d.gaps || []).map((g, i) => (
              <li key={`${g.key}-${i}`} className="flex items-start gap-2">
                <span className="mt-1 w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                {g.detail}
              </li>
            ))}
            {d.contradictions > 0 ? (
              <li className="flex items-start gap-2">
                <span className="mt-1 w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                {d.contradictions} answer pair{d.contradictions > 1 ? 's' : ''} disagree — a partner may probe these in review.
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      <p className={`${SUB} text-center pb-4`}>
        Scored deterministically by the Axal Fit v2 engine ({d.engine_version}, bank {d.bank_version}) · computed {d.computed_at ? new Date(d.computed_at).toLocaleString() : '—'} ·
        the score starts the conversation, a partner makes the call.
      </p>
    </div>
  );
}
