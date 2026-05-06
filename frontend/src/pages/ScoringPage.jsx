import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Target, ChevronDown, ChevronUp, Play, FileText, ShieldCheck, AlertTriangle, Lock, HelpCircle } from 'lucide-react';

function ModernSelect({ value, onChange, children, ...props }) {
  return (
    <div className="relative">
      <select value={value} onChange={onChange} {...props}
        className="w-full bg-white text-gray-900 border border-gray-300 rounded-lg px-4 py-2.5 text-sm appearance-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none transition-all cursor-pointer hover:border-gray-400">
        {children}
      </select>
      <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none" />
    </div>
  );
}

const defaultForm = {
  tam: 500000000, market_urgency: 7, market_trend: 4,
  team_expertise: 6, team_execution: 7, team_network: 3,
  mvp_time_days: 30, product_complexity: 2, product_dependencies: 1,
  cost_to_mvp: 50000, time_to_revenue_months: 6, burn_risk: 1,
  fit_alignment: 8, fit_synergy: 4,
  distribution_channels: 4, distribution_virality: 3,
  ai_adjustment: 0,
};

function ScoreBar({ label, value, max, color = 'violet' }) {
  const pct = Math.round((value / max) * 100);
  const colors = { violet: 'bg-violet-500', emerald: 'bg-emerald-500', blue: 'bg-blue-500', amber: 'bg-amber-500' };
  return (
    <div className="mb-2">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-600">{label}</span>
        <span className="text-gray-700">{value}/{max}</span>
      </div>
      <div className="h-2 bg-gray-50 rounded-full overflow-hidden">
        <div className={`h-full ${colors[color] || colors.violet} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function ScoringPage() {
  const [queue, setQueue] = useState([]);
  const [form, setForm] = useState(defaultForm);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedProject, setSelectedProject] = useState(null);
  // Epic 5: Practice mode (sandbox) is the default for founders. Sandbox runs
  // are unlimited, never visible to LPs, and never lock the project's official
  // 7-day cooldown. Toggle Off = Official run.
  const [practiceMode, setPracticeMode] = useState(true);
  const [cooldownInfo, setCooldownInfo] = useState(null); // { message, lockedUntilMs }

  useEffect(() => {
    api.scoringQueue().then(setQueue).catch(() => {});
  }, []);

  const runScore = async () => {
    setLoading(true);
    setCooldownInfo(null);
    try {
      const data = { ...form };
      if (selectedProject) data.project_id = selectedProject;
      // Server-side anti-cheat is the source of truth — we just signal intent.
      data.is_sandbox = practiceMode;
      const res = await api.scoreStartup(data);
      setResult(res);
    } catch (e) {
      // The 7-day cooldown surfaces as a 409 (post-T8: aligned with the
      // post-insert UNIQUE-index race response) with `code: official_cooldown`
      // and a structured `locked_until` ISO timestamp. Legacy 429 from older
      // workers is still tolerated for graceful rollout. Render a live
      // countdown (CooldownBanner) instead of just echoing the raw message.
      const msg = e?.message || 'Failed to score';
      const data = e?.data || {};
      const isCooldown = data?.code === 'official_cooldown'
        || e?.status === 409
        || e?.status === 429
        || /locked|cooldown|already scored/i.test(msg);
      if (isCooldown) {
        setCooldownInfo({ message: msg, locked_until: data?.locked_until || null });
      } else {
        alert(msg);
      }
    }
    setLoading(false);
  };

  const generateMemo = async () => {
    if (!selectedProject) return alert('Select a project first');
    try {
      const memo = await api.generateDealMemo(selectedProject);
      alert(`Deal Memo generated! Decision: ${memo.decision}`);
    } catch (e) {
      alert(e.message);
    }
  };

  const setField = (key, val) => setForm(f => ({ ...f, [key]: parseFloat(val) || 0 }));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Diligence & Scoring Engine</h1>
        <p className="text-sm text-gray-600">100-Point Startup Scoring Algorithm — The Brain</p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
              <div className="flex items-center gap-2">
                <Target size={16} className="text-violet-600" />
                <h2 className="font-semibold text-gray-900 text-sm">Score Input</h2>
              </div>
              {/* Practice / Official toggle (Epic 5). Practice runs are unlimited
                  and never visible to LPs/partners. */}
              <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden text-xs">
                <button
                  type="button"
                  onClick={() => setPracticeMode(true)}
                  className={`px-3 py-1.5 font-medium transition-colors ${practiceMode ? 'bg-violet-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                >
                  Practice mode
                </button>
                <button
                  type="button"
                  onClick={() => setPracticeMode(false)}
                  className={`px-3 py-1.5 font-medium transition-colors ${!practiceMode ? 'bg-emerald-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                >
                  Submit official
                </button>
              </div>
            </div>

            {/* Mode helper banner — explains LP-visibility consequences. */}
            <div className={`mb-4 rounded-lg px-3 py-2 text-xs flex items-start gap-2 ${practiceMode ? 'bg-violet-50 text-violet-800 border border-violet-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'}`}>
              {practiceMode ? <Target size={14} className="mt-0.5 flex-shrink-0" /> : <ShieldCheck size={14} className="mt-0.5 flex-shrink-0" />}
              <span>
                {practiceMode
                  ? 'Practice mode: unlimited runs to learn the rubric. Never visible to LPs or partners.'
                  : 'Official run: signed + locked for 7 days. Visible to partners after admin sign-off if anomalies are detected.'}
              </span>
            </div>

            <div className="mb-4">
              <label className="block text-xs text-gray-600 mb-1 font-medium">Link to Project (optional)</label>
              <ModernSelect
                value={selectedProject || ''}
                onChange={e => setSelectedProject(e.target.value ? parseInt(e.target.value) : null)}
              >
                <option value="">Standalone scoring</option>
                {queue.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </ModernSelect>
            </div>

            {cooldownInfo && (
              <CooldownBanner info={cooldownInfo} />
            )}

            {result?.requires_admin_review && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 text-red-900 px-3 py-2 text-xs flex items-start gap-2">
                <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                <span>
                  <strong>Anomaly detected — pending admin review.</strong> This score is held back from LPs/partners until an admin signs off.
                </span>
              </div>
            )}

            {result?.integrity_hash && !result?.requires_admin_review && !result?.is_sandbox && (
              <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-900 px-3 py-2 text-xs flex items-start gap-2">
                <ShieldCheck size={14} className="mt-0.5 flex-shrink-0" />
                <span>Signed &amp; verified · hash <code className="font-mono">{String(result.integrity_hash).slice(0, 12)}…</code></span>
              </div>
            )}

            <Section title="A. Market (25 pts)">
              <Field label="TAM (USD)" value={form.tam} onChange={v => setField('tam', v)} />
              <Field label="Urgency (0-10)" value={form.market_urgency} onChange={v => setField('market_urgency', v)} max={10} />
              <Field label="Trend momentum (0-5)" value={form.market_trend} onChange={v => setField('market_trend', v)} max={5} />
            </Section>

            <Section title="B. Founder / Team (20 pts)">
              <Field label="Domain expertise (0-8)" value={form.team_expertise} onChange={v => setField('team_expertise', v)} max={8} />
              <Field label="Execution speed (0-8)" value={form.team_execution} onChange={v => setField('team_execution', v)} max={8} />
              <Field label="Network leverage (0-4)" value={form.team_network} onChange={v => setField('team_network', v)} max={4} />
            </Section>

            <Section title="C. Product Feasibility (15 pts)">
              <Field label="MVP build time (days)" value={form.mvp_time_days} onChange={v => setField('mvp_time_days', v)} />
              <Field label="Complexity (0-5, lower=better)" value={form.product_complexity} onChange={v => setField('product_complexity', v)} max={5} />
              <Field label="Dependency risk (0-3)" value={form.product_dependencies} onChange={v => setField('product_dependencies', v)} max={3} />
            </Section>

            <Section title="D. Capital Efficiency (15 pts)">
              <Field label="Cost to MVP (USD)" value={form.cost_to_mvp} onChange={v => setField('cost_to_mvp', v)} />
              <Field label="Time to revenue (months)" value={form.time_to_revenue_months} onChange={v => setField('time_to_revenue_months', v)} />
              <Field label="Burn risk (0-3)" value={form.burn_risk} onChange={v => setField('burn_risk', v)} max={3} />
            </Section>

            <Section title="E. Strategic Fit (15 pts)">
              <Field label="Alignment (0-10)" value={form.fit_alignment} onChange={v => setField('fit_alignment', v)} max={10} />
              <Field label="Partner synergy (0-5)" value={form.fit_synergy} onChange={v => setField('fit_synergy', v)} max={5} />
            </Section>

            <Section title="F. Distribution (10 pts)">
              <Field label="Channels (0-5)" value={form.distribution_channels} onChange={v => setField('distribution_channels', v)} max={5} />
              <Field label="Virality (0-5)" value={form.distribution_virality} onChange={v => setField('distribution_virality', v)} max={5} />
            </Section>

            <Section title="AI Bonus Layer">
              <Field label="AI adjustment (-5 to +5)" value={form.ai_adjustment} onChange={v => setField('ai_adjustment', v)} />
            </Section>

            <div className="flex gap-3 mt-6">
              <button onClick={runScore} disabled={loading} style={{ color: '#ffffff' }} className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                <Play size={14} /> {loading ? 'Scoring...' : 'Run Full Score'}
              </button>
              {selectedProject && result && (
                <button onClick={generateMemo} className="flex items-center gap-2 px-5 py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-900 rounded-lg text-sm font-medium transition-colors">
                  <FileText size={14} /> Generate Deal Memo
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {result ? (
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <div className="text-center mb-6">
                <div className={`text-5xl font-bold ${
                  result.tier === 'TIER_1' ? 'text-emerald-400' :
                  result.tier === 'TIER_2' ? 'text-blue-400' : 'text-red-400'
                }`}>{result.total_score}</div>
                <div className="text-xs text-gray-600 mt-1">/ 100</div>
                <div className={`mt-2 inline-block px-3 py-1 rounded-full text-xs font-semibold ${
                  result.tier === 'TIER_1' ? 'bg-emerald-100 text-emerald-700' :
                  result.tier === 'TIER_2' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'
                }`}>{result.tier_label}</div>
              </div>

              <ScoreBar label="Market" value={result.breakdown.market.total} max={25} color="violet" />
              <ScoreBar label="Team" value={result.breakdown.team.total} max={20} color="emerald" />
              <ScoreBar label="Product" value={result.breakdown.product.total} max={15} color="blue" />
              <ScoreBar label="Capital" value={result.breakdown.capital.total} max={15} color="amber" />
              <ScoreBar label="Fit" value={result.breakdown.fit.total} max={15} color="violet" />
              <ScoreBar label="Distribution" value={result.breakdown.distribution.total} max={10} color="emerald" />
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
              <Target size={40} className="text-gray-700 mx-auto mb-3" />
              <p className="text-sm text-gray-500">Run a score to see results</p>
            </div>
          )}

          {queue.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h3 className="font-semibold text-gray-900 text-sm mb-3">Scoring Queue</h3>
              <div className="space-y-2">
                {queue.map(p => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedProject(p.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                      selectedProject === p.id ? 'bg-violet-500/20 text-violet-300' : 'bg-gray-50 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-gray-500">{p.sector}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mb-4">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 w-full text-left text-sm font-medium text-gray-700 mb-2">
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        {title}
      </button>
      {open && <div className="grid grid-cols-2 md:grid-cols-3 gap-3 pl-5">{children}</div>}
    </div>
  );
}

function formatRemaining(ms) {
  if (ms <= 0) return 'unlocking now';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function CooldownBanner({ info }) {
  const lockedUntil = info?.locked_until ? new Date(info.locked_until) : null;
  const valid = lockedUntil && !Number.isNaN(lockedUntil.getTime());
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!valid) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [valid]);
  const remainingMs = valid ? lockedUntil.getTime() - now : 0;
  return (
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2 text-xs flex items-start gap-2">
      <Lock size={14} className="mt-0.5 flex-shrink-0" />
      <div className="flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <strong>Official scoring is on cooldown for this project.</strong>
          {valid && (
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 border border-amber-300 px-1.5 py-0.5 font-mono">
              Unlocks in {formatRemaining(remainingMs)}
            </span>
          )}
          <span
            title="Each official run locks the project's scoring for 7 days so LP-facing numbers stay stable. Practice mode is unlimited and never visible to LPs. To unlock early (e.g. after a major intake change), ask an admin to run scoring with ?force=1."
            className="inline-flex items-center cursor-help opacity-70 hover:opacity-100"
          >
            <HelpCircle size={12} />
          </span>
        </div>
        <div className="opacity-80 mt-0.5">
          Switch to Practice mode to keep iterating; the 7-day window resets automatically.
          {valid && (
            <> Unlocks at <span className="font-mono">{lockedUntil.toLocaleString()}</span>.</>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, max }) {
  return (
    <div>
      <label className="block text-[11px] text-gray-500 mb-1">{label}</label>
      <input
        type="number"
        value={value}
        onChange={e => onChange(e.target.value)}
        max={max}
        className="w-full bg-gray-50 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-900 focus:border-violet-500 focus:outline-none"
      />
    </div>
  );
}
