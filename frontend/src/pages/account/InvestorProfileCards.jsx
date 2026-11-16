/** Investor Signals consent and matching preferences in Account privacy (#6288). */
import { useState } from 'react';
import { Ban, Loader2, Save, Scale } from 'lucide-react';
import Card from './AccountCard.jsx';
import InvestorProfileReadState from './InvestorProfileReadState.jsx';

// Task #4 — Investor Signals contribution toggle. Lives in Privacy because
// the data is fully anonymized (k≥5) but users may still want to opt out.
// Opting out flips contribute_to_signals=0; the next 6h aggregation cron
// will exclude this user automatically.
export function InvestorSignalsContributionCard({ flash, role, investorProfile }) {
  const { profile, error, busy, reload, save } = investorProfile;

  const toggle = async (next) => {
    try {
      if (await save('signals', { contribute_to_signals: next })) {
        flash(next ? 'Now contributing to Investor Signals' : 'Opted out — your data will be removed within 6 hours');
      }
    } catch (err) {
      flash(err.message || 'Failed to save', 'error');
    }
  };

  // Hide entirely from non-investor accounts that have never filled out a
  // profile (no value to surface). Investors always see it.
  const isInvestor = String(role || '').toLowerCase() === 'investor';
  if (!isInvestor && !profile?.completed_at) return null;

  if (error || profile === undefined) return (
    <Card title="Investor Signals"><InvestorProfileReadState error={error} reload={reload} /></Card>
  );
  if (!profile) return null;

  const completed = !!profile.completed_at;
  return (
    <Card
      title="Anonymized Investor Signals"
      description="Your sector, stage, geography, ticket size and thesis can power the platform-wide Axal VC Investor Signals dashboard. We only ever publish a cell when at least 5 investors share the same answer."
    >
      <div className="space-y-3">
        {!completed && (
          <div className="text-xs text-gray-600 dark:text-gray-400 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-md px-3 py-2">
            You haven&apos;t finished the investor profiling chatbot yet. <a href="/onboarding/investor" className="text-violet-600 hover:underline">Complete it now</a> to be included.
          </div>
        )}
        <label className="flex items-center gap-3 text-sm text-gray-800 dark:text-gray-200">
          <input type="checkbox" checked={!!profile.contribute_to_signals} disabled={busy}
            onChange={e => toggle(e.target.checked)}
            className="w-4 h-4 text-violet-600 border-gray-300 dark:border-gray-600 rounded focus:ring-violet-500" />
          Contribute my answers to anonymized Investor Signals (k ≥ 5)
        </label>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Opting out removes your contribution within 6 hours, the next time the aggregator runs.
        </p>
      </div>
    </Card>
  );
}

// Task #16 — Investor thesis editor (anti-thesis + value weights). Lives
// in Privacy alongside the Investor Signals toggle. Only investors see it.
export function InvestorThesisEditorCard({ flash, role, investorProfile }) {
  const { profile, error, busy, saving, reload, save } = investorProfile;
  const [draft, setDraft] = useState({});

  const saveMatching = async () => {
    try {
      if (await save('matching', draft)) {
        setDraft({});
        flash('Investor thesis updated');
      }
    } catch (err) {
      flash(err.message || 'Failed to save', 'error');
    }
  };

  const isInvestor = String(role || '').toLowerCase() === 'investor';
  if (!isInvestor && !profile?.completed_at) return null;

  if (error || profile === undefined) return (
    <Card title="Investor Thesis"><InvestorProfileReadState error={error} reload={reload} /></Card>
  );
  if (!profile) return null;

  const SECTOR_OPTIONS = ['AI/ML','Climate','Fintech','Healthtech','Consumer','Enterprise SaaS','Crypto','Bio','Defense','Robotics','Energy'];
  const STAGE_OPTIONS  = ['Pre-seed','Seed','Series A','Series B+','Growth'];
  const antiSectors = draft.anti_thesis_sectors ?? profile.anti_thesis_sectors ?? [];
  const antiStages = draft.anti_thesis_stages ?? profile.anti_thesis_stages ?? [];
  const vw = draft.value_weights ?? profile.value_weights ?? {};

  const toggleAnti = (key, val) => {
    setDraft((prev) => {
      const selected = prev[key] ?? profile[key] ?? [];
      const values = selected.includes(val) ? selected.filter(x => x !== val) : [...selected, val];
      return { ...prev, [key]: values };
    });
  };

  const setWeight = (dim, val) => {
    setDraft((prev) => ({ ...prev, value_weights: { ...(prev.value_weights ?? profile.value_weights), [dim]: val } }));
  };

  return (
    <Card
      title="Investor Thesis & Matching"
      description="Anti-thesis exclusions and value weights used to score founder-investor matches."
    >
      <div className="space-y-5">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Ban size={14} className="text-red-500" />
            <h4 className="text-xs font-semibold text-gray-800 dark:text-gray-200">Anti-thesis (hard exclusions)</h4>
          </div>
          <p className="text-xs text-gray-500 mb-2 dark:text-gray-400">We will NEVER match you with startups in these sectors or stages.</p>
          <div className="space-y-3">
            <div>
              <span className="text-xs font-medium text-gray-700 block mb-1 dark:text-gray-300">Sectors you avoid</span>
              <div className="flex flex-wrap gap-2">
                {SECTOR_OPTIONS.map(s => (
                  <button key={s} type="button" disabled={busy} onClick={() => toggleAnti('anti_thesis_sectors', s)}
                    className={`text-xs px-2.5 py-1 rounded-full border ${antiSectors.includes(s) ? 'bg-red-100 text-red-700 border-red-300' : 'bg-white text-gray-700 border-gray-300 hover:border-red-300'}`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="text-xs font-medium text-gray-700 block mb-1 dark:text-gray-300">Stages you avoid</span>
              <div className="flex flex-wrap gap-2">
                {STAGE_OPTIONS.map(s => (
                  <button key={s} type="button" disabled={busy} onClick={() => toggleAnti('anti_thesis_stages', s)}
                    className={`text-xs px-2.5 py-1 rounded-full border ${antiStages.includes(s) ? 'bg-red-100 text-red-700 border-red-300' : 'bg-white text-gray-700 border-gray-300 hover:border-red-300'}`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-2">
            <Scale size={14} className="text-violet-500" />
            <h4 className="text-xs font-semibold text-gray-800 dark:text-gray-200">Value weights</h4>
          </div>
          <p className="text-xs text-gray-500 mb-2 dark:text-gray-400">How much each dimension matters in matching. Weights are auto-normalised.</p>
          <div className="space-y-3">
            {[
              { key: 'mission_driven', label: 'Mission-driven founders' },
              { key: 'technical_depth', label: 'Technical depth' },
              { key: 'growth_trajectory', label: 'Growth trajectory' },
              { key: 'team_diversity', label: 'Team diversity' },
              { key: 'market_timing', label: 'Market timing' },
            ].map(({ key, label }) => {
              const v = typeof vw[key] === 'number' ? vw[key] : 0.5;
              return (
                <label key={key} className="block">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-700 dark:text-gray-300">{label}</span>
                    <span className="text-xs text-gray-500">{Math.round(v * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    disabled={busy}
                    min="0"
                    max="1"
                    step="0.05"
                    value={v}
                    onChange={(e) => setWeight(key, Number(e.target.value))}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-violet-600"
                  />
                </label>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={saveMatching} disabled={busy}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg">
            {saving === 'matching' ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
            {saving === 'matching' ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </Card>
  );
}
