import React, { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, Minus, Globe, BarChart3, Zap, Building2, ChevronDown, Info, Lightbulb, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

export default function MarketIntelPage() {
  const [pulse, setPulse] = useState([]);
  const [headlines, setHeadlines] = useState([]);
  const [pulseUpdatedAt, setPulseUpdatedAt] = useState(null);
  const [macro, setMacro] = useState(null);
  const [rounds, setRounds] = useState([]);
  const [benchmarks, setBenchmarks] = useState(null);
  const [conviction, setConviction] = useState([]);
  const [tab, setTab] = useState('pulse');
  const [dropdownOpen, setDropdownOpen] = useState(false);

  useEffect(() => {
    Promise.all([
      api.marketPulse(),
      api.marketMacro(),
      api.privateRounds(),
      api.studioBenchmarks(),
      api.competitiveIntelligence(),
    ]).then(([p, m, r, b, c]) => {
      setPulse(p.signals || []);
      setHeadlines(p.headlines || []);
      setPulseUpdatedAt(p.updated_at || null);
      setMacro(m);
      setRounds(r.rounds || []);
      setBenchmarks(b);
      setConviction(c.high_conviction_plays || []);
    }).catch(() => {});
  }, []);

  const fmtTime = (iso) => {
    if (!iso) return '';
    try { return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch { return ''; }
  };

  const tabs = [
    { key: 'pulse', label: 'Market Pulse', icon: Zap },
    { key: 'macro', label: 'Public Markets', icon: Globe },
    { key: 'private', label: 'Private Rounds', icon: Building2 },
    { key: 'conviction', label: 'High Conviction', icon: TrendingUp },
    { key: 'studio', label: 'Studio Benchmarks', icon: BarChart3 },
    { key: 'investor_signals', label: 'Axal Investor Signals', icon: Users },
  ];

  return (
    <div>
      <div className="flex items-end justify-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Market Intelligence</h1>
          <p className="text-sm text-gray-600">Signal-to-Action pipeline for competitive advantage</p>
        </div>
        {(tab === 'studio' ? benchmarks?.updated_at : pulseUpdatedAt) && (
          <div className="text-xs text-gray-500">Last updated {fmtTime(tab === 'studio' ? benchmarks?.updated_at : pulseUpdatedAt)}</div>
        )}
      </div>

      {/* Why this matters — top-of-page explainer panel (Epic 0.4). Plain-English
          framing for partners/LPs new to the surface so each tab has context. */}
      <div className="mb-6 bg-gradient-to-r from-violet-50 to-indigo-50 border border-violet-200 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <Lightbulb size={18} className="text-violet-600 shrink-0 mt-0.5" />
          <div className="text-xs text-gray-700 leading-relaxed">
            <div className="font-semibold text-gray-900 mb-1">Why this matters</div>
            <p>
              Market Intelligence turns noisy public and private signals into a short list of where to deploy capital next.
              <span className="font-medium text-gray-900"> Private rounds</span> show direct competitors&apos; funding signals.
              <span className="font-medium text-gray-900"> Public comps</span> are exit benchmarks for your sector.
              <span className="font-medium text-gray-900"> High-conviction plays</span> are the bets we&apos;d take with concentrated capital this quarter, and
              <span className="font-medium text-gray-900"> Studio benchmarks</span> tell you whether our pipeline is healthier than the market.
            </p>
          </div>
        </div>
      </div>

      <div className="mb-6">
        {/* Desktop tabs */}
        <div className="hidden md:flex gap-1 overflow-x-auto pb-2">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                tab === t.key ? 'bg-violet-600 text-white' : 'bg-gray-200 text-gray-700 hover:text-gray-900'
              }`}>
              <t.icon size={14} /> {t.label}
            </button>
          ))}
        </div>

        {/* Mobile dropdown */}
        <div className="md:hidden relative">
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="w-full flex items-center justify-between px-4 py-3 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-900 hover:bg-gray-50 transition-colors"
          >
            <span className="flex items-center gap-2">
              {tabs.find(t => t.key === tab)?.icon && React.createElement(tabs.find(t => t.key === tab).icon, { size: 14 })}
              {tabs.find(t => t.key === tab)?.label}
            </span>
            <ChevronDown size={16} className={`transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {dropdownOpen && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-gray-300 rounded-lg shadow-lg z-50">
              {tabs.map(t => (
                <button
                  key={t.key}
                  onClick={() => {
                    setTab(t.key);
                    setDropdownOpen(false);
                  }}
                  className={`w-full flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b border-gray-100 last:border-b-0 ${
                    tab === t.key
                      ? 'bg-violet-50 text-violet-600'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <t.icon size={14} /> {t.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {tab === 'pulse' && (
        <div className="space-y-6">
          <TabExplainer text="Where the market is heading right now: hiring surges, technographic signals, and sentiment per sector. Aggressive sectors get higher multiples and more competition; cautious sectors are where contrarian bets pay off." />
          {headlines.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                  Live Headlines
                  <InfoTip text="Real-time public-source headlines. We track them so you don't have to refresh five tabs." />
                </h3>
                <span className="text-[10px] text-gray-500">Updated {fmtTime(pulseUpdatedAt)}</span>
              </div>
              <ul className="divide-y divide-gray-100">
                {headlines.map((h, i) => (
                  <li key={i} className="py-2 text-xs">
                    <a href={h.link} target="_blank" rel="noopener noreferrer" className="text-gray-900 hover:text-violet-600 font-medium block">
                      {h.title}
                    </a>
                    <div className="text-gray-500 mt-0.5">
                      <span className="text-violet-600">{h.source}</span>
                      {h.published && <> · {fmtTime(h.published)}</>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {pulse.map((s, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                    {s.sector}
                    <InfoTip text="Sector pulse: technographic signal + hiring surge + spin-out opportunity. The multiple is the public-comp valuation premium." />
                  </h3>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    s.sentiment === 'Aggressive' ? 'bg-emerald-100 text-emerald-700' :
                    s.sentiment === 'Cautious' ? 'bg-orange-100 text-orange-700' :
                    'bg-yellow-100 text-yellow-700'
                  }`}>{s.sentiment}</span>
                </div>
                <div className="text-2xl font-bold text-violet-600 mb-3">{s.multiple}x</div>
                <div className="space-y-2 text-xs">
                  <div>
                    <span className="text-gray-600">Tech Signal:</span>
                    <p className="text-gray-700 mt-0.5">{s.technographic_signal}</p>
                  </div>
                  <div>
                    <span className="text-gray-600">Hiring:</span>
                    <p className="text-gray-700 mt-0.5">{s.hiring_surge}</p>
                  </div>
                  <div className="pt-2 border-t border-gray-200">
                    <span className="text-violet-600 font-medium">Spin-out Opportunity:</span>
                    <p className="text-gray-800 mt-0.5">{s.gap_opportunity}</p>
                  </div>
                  <div className="pt-1 text-[10px] text-gray-400">Updated {fmtTime(pulseUpdatedAt)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'macro' && macro && (
        <div>
          <TabExplainer text="Public-market lens on the venture environment. P/E ratios, IPO windows, and YoY growth set the ceiling on what your portfolio can exit at — and tell you when LPs are open to risk." />
          <div className="grid md:grid-cols-2 gap-4 mb-8">
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-1.5">
                Exit Environment
                <InfoTip text="Are IPO and M&A windows open? When closed, distributions slow and LPs stop recycling capital." />
              </h3>
              <p className="text-sm text-gray-700">{macro.exit_environment}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-1.5">
                Interest Rate Impact
                <InfoTip text="Higher rates compress growth multiples. Watch this when pricing late-stage rounds." />
              </h3>
              <p className="text-sm text-gray-700">{macro.interest_rate_impact}</p>
            </div>
          </div>

          {macro.live_quotes && macro.live_quotes.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-6">
              <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">Live Tech Quotes</h3>
                <span className="text-[10px] text-gray-500">Updated {fmtTime(macro.quotes_updated_at)}</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left px-4 py-2 text-gray-600 font-medium">Symbol</th>
                    <th className="text-left px-4 py-2 text-gray-600 font-medium">Name</th>
                    <th className="text-right px-4 py-2 text-gray-600 font-medium">Price</th>
                    <th className="text-right px-4 py-2 text-gray-600 font-medium">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {macro.live_quotes.map((q) => (
                    <tr key={q.symbol} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-2 text-gray-900 font-mono font-medium">{q.symbol}</td>
                      <td className="px-4 py-2 text-gray-700">{q.name}</td>
                      <td className="px-4 py-2 text-right text-gray-900">${q.price}</td>
                      <td className={`px-4 py-2 text-right font-medium ${q.pct_change > 0 ? 'text-emerald-600' : q.pct_change < 0 ? 'text-red-600' : 'text-gray-600'}`}>
                        {q.pct_change > 0 ? '+' : ''}{q.pct_change}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">Sector</th>
                  <th className="text-right px-4 py-3 text-gray-600 font-medium">Avg P/E</th>
                  <th className="text-right px-4 py-3 text-gray-600 font-medium">YoY Growth</th>
                  <th className="text-center px-4 py-3 text-gray-600 font-medium">IPO Window</th>
                  <th className="text-center px-4 py-3 text-gray-600 font-medium">Trend</th>
                </tr>
              </thead>
              <tbody>
                {macro.sectors?.map((s, i) => (
                  <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-900 font-medium">{s.name}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{s.avg_pe}x</td>
                    <td className="px-4 py-3 text-right">
                      <span className={s.yoy_growth > 20 ? 'text-emerald-600' : s.yoy_growth > 10 ? 'text-blue-600' : 'text-gray-600'}>
                        {s.yoy_growth}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        s.ipo_window === 'Open' ? 'bg-emerald-100 text-emerald-700' :
                        s.ipo_window === 'Selective' ? 'bg-yellow-500/20 text-yellow-400' :
                        s.ipo_window === 'Opening' ? 'bg-blue-100 text-blue-700' :
                        'bg-orange-500/20 text-orange-400'
                      }`}>{s.ipo_window}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {s.trend === 'up' ? <TrendingUp size={16} className="inline text-emerald-600" /> :
                       s.trend === 'down' ? <TrendingDown size={16} className="inline text-red-600" /> :
                       <Minus size={16} className="inline text-gray-600" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'private' && (
        <div className="space-y-4">
          <TabExplainer text="Private rounds = direct competitors' funding signals. Who just raised, at what stage, and at what valuation tells you whether the sector is heating up — and where your portfolio is mispriced." />
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left px-4 py-3 text-gray-600 font-medium">Company</th>
                <th className="text-left px-4 py-3 text-gray-600 font-medium">Sector</th>
                <th className="text-right px-4 py-3 text-gray-600 font-medium">Amount</th>
                <th className="text-right px-4 py-3 text-gray-600 font-medium">Valuation</th>
                <th className="text-center px-4 py-3 text-gray-600 font-medium">Stage</th>
              </tr>
            </thead>
            <tbody>
              {rounds.map((r, i) => (
                <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-900 font-medium">{r.company}</td>
                  <td className="px-4 py-3 text-gray-700">{r.sector}</td>
                  <td className="px-4 py-3 text-right text-emerald-600 font-medium">{r.amount}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{r.valuation}</td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-xs px-2 py-0.5 bg-gray-200 text-gray-700 rounded-full">{r.stage}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>
      )}

      {tab === 'conviction' && (
        <div className="space-y-4">
          <TabExplainer text="Where we'd put concentrated bets right now. Each play is paired with a recommended spin-out the studio could ship to capture the gap." />
          {conviction.map((play, i) => (
            <div key={i} className="bg-white border border-gray-200 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-semibold text-gray-900">{play.sector}</h3>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    play.play_type === 'Efficiency Play' ? 'bg-violet-100 text-violet-700' :
                    play.play_type === 'Replacement Play' ? 'bg-blue-100 text-blue-700' :
                    'bg-emerald-100 text-emerald-700'
                  }`}>{play.play_type}</span>
                </div>
                <span className="text-lg font-bold text-violet-600">{play.multiple}x</span>
              </div>
              <p className="text-sm text-gray-700 mb-2">{play.reasoning}</p>
              <div className="pt-2 border-t border-gray-200">
                <span className="text-xs text-gray-600">Recommended Spin-out: </span>
                <span className="text-xs text-emerald-600 font-medium">{play.gap_opportunity}</span>
              </div>
            </div>
          ))}
          {conviction.length === 0 && <p className="text-gray-600 text-sm">No high-conviction plays identified yet.</p>}
        </div>
      )}

      {tab === 'investor_signals' && <InvestorSignalsTab />}

      {tab === 'studio' && benchmarks && (
        <div className="space-y-6">
          <TabExplainer text="How our studio is performing against the targets we set with LPs. Operations metrics measure speed; decision-gate metrics measure judgment; post-spin-out metrics measure outcomes." />
          <div>
            <div className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold mb-3">Studio Operations</div>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
              <BenchmarkCard label="Avg Time to Inc." value={`${benchmarks.avg_time_to_inc_days} days`} target="< 14 days" />
              <BenchmarkCard label="Founder Match Rate" value={`${benchmarks.founder_match_rate}%`} target="> 80%" />
              <BenchmarkCard label="API Reusability" value={`${benchmarks.api_reusability_score}%`} target="> 60%" />
              <BenchmarkCard label="Dry Powder" value={benchmarks.current_dry_powder} target="Active" />
              <BenchmarkCard label="Time to First Check" value={`${benchmarks.avg_time_to_first_check_days} days`} target="< 30 days" />
              <BenchmarkCard label="Idea → Funded Rate" value={`${benchmarks.conversion_idea_to_funded}%`} target="> 20%" />
              <BenchmarkCard label="Active Batch Size" value={benchmarks.active_batch_size} target="5-10" />
              <BenchmarkCard label="Portfolio Companies" value={benchmarks.portfolio_companies} target="Growing" />
              <BenchmarkCard label="Avg Time to First Revenue"
                value={benchmarks.avg_time_to_first_revenue_days != null
                  ? `${benchmarks.avg_time_to_first_revenue_days} days` : null}
                target="< 120 days" />
              <BenchmarkCard label="Founder Equity @ Series A"
                value={benchmarks.avg_founder_equity_at_series_a != null
                  ? `${benchmarks.avg_founder_equity_at_series_a}%` : null}
                target="> 55%" />
              <BenchmarkCard label="Burn Rate @ Spin-Out"
                value={benchmarks.avg_burn_rate_at_spinout} target="< $80k/mo" />
              <BenchmarkCard label="Cohort Survival (6mo)"
                value={benchmarks.cohort_survival_rate != null
                  ? `${benchmarks.cohort_survival_rate}%` : null}
                target="> 75%" />
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold mb-3">Decision Gate</div>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
              <BenchmarkCard label="Decision Gate Pass Rate" value={`${benchmarks.decision_gate_pass_rate}%`} target="> 65%" />
              <BenchmarkCard label="Avg Time to Spin-Out" value={`${benchmarks.avg_time_to_spinout_days} days`} target="< 90 days" />
              <BenchmarkCard label="Avg Founder Equity at Spin-Out" value={`${benchmarks.avg_founder_equity_at_spinout}%`} target="60-75%" />
              <BenchmarkCard label="Cost Per Spin-Out" value={benchmarks.cost_per_spinout} target="< $250k" />
              <BenchmarkCard label="AI Score ↔ Outcome"
                value={benchmarks.ai_score_outcome_correlation != null
                  ? `${benchmarks.ai_score_outcome_correlation}%` : null}
                target="> 70%" />
              <BenchmarkCard label="Avg Votes / Gate"
                value={benchmarks.avg_votes_per_decision_gate} target="> 5" />
              <BenchmarkCard label="Community ↔ Decision Alignment"
                value={benchmarks.community_vote_alignment_rate != null
                  ? `${benchmarks.community_vote_alignment_rate}%` : null}
                target="> 80%" />
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold mb-3">Post Spin-Out Performance</div>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
              <BenchmarkCard label="Follow-On Funding Rate" value={`${benchmarks.followon_funding_rate}%`} target="> 70%" />
              <BenchmarkCard label="Avg Valuation at First Round" value={benchmarks.avg_valuation_first_round} target="> $8M" />
              <BenchmarkCard label="Deployment Velocity" value={`${benchmarks.deployment_velocity}%`} target="> 40% / quarter" />
              <BenchmarkCard label="Avg Follow-On Round Size"
                value={benchmarks.avg_followon_round_size} target="> $5M" />
              <BenchmarkCard label="Time to First Liquidity (median)"
                value={benchmarks.median_time_to_first_liquidity_days != null
                  ? `${benchmarks.median_time_to_first_liquidity_days} days` : null}
                target="< 4 yrs" />
              <BenchmarkCard label="Projected Portfolio IRR"
                value={benchmarks.projected_portfolio_irr != null
                  ? `${benchmarks.projected_portfolio_irr}%` : null}
                target="> 18%" />
              <BenchmarkCard label="LP Return Multiple"
                value={benchmarks.lp_return_multiple != null
                  ? `${benchmarks.lp_return_multiple}x` : null}
                target="> 3.0x" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Axal Investor Signals (Task #4) ----------------------------------
// Pulls the most recent k-anonymized snapshot. Cells with n<5 render as
// "Insufficient data". Investors who haven't completed the chatbot see a
// one-time prompt linking them back to the profiling flow.
function InvestorSignalsTab() {
  const [snap, setSnap] = useState(null);
  const [trend, setTrend] = useState([]);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.getInvestorSignals().catch(e => ({ _err: e })),
      api.getInvestorProfile().catch(() => ({ profile: null })),
    ]).then(([s, p]) => {
      if (cancelled) return;
      if (s && s._err) {
        setErr(s._err.message || 'Failed to load Investor Signals');
      } else {
        setSnap(s?.snapshot || null);
        setTrend(s?.trend || []);
      }
      setProfile(p?.profile || null);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const role = (() => {
    try {
      const u = JSON.parse(localStorage.getItem('user') || 'null');
      return String(u?.role || '').toLowerCase();
    } catch { return ''; }
  })();
  const isInvestor = role === 'investor';
  const showReprompt = isInvestor && profile && !profile.completed_at;

  if (loading) {
    return <div className="text-sm text-gray-500 py-12 text-center">Loading anonymized investor signals…</div>;
  }
  if (err) {
    return <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{err}</div>;
  }

  return (
    <div className="space-y-6">
      <TabExplainer text="What investors across Axal are actively looking for, anonymized to k≥5. Cells where fewer than 5 investors share an answer are hidden as 'Insufficient data'." />

      {showReprompt && (
        <div className="bg-violet-50 border border-violet-200 rounded-lg p-4 flex items-start gap-3">
          <Users size={18} className="text-violet-600 shrink-0 mt-0.5" />
          <div className="flex-1 text-sm text-gray-700">
            <div className="font-semibold text-gray-900 mb-1">Help shape this dashboard</div>
            <p className="mb-2">You haven&apos;t finished the investor profiling chatbot yet. Spend 90 seconds answering 6 questions to be included in the next anonymized snapshot.</p>
            <Link to="/onboarding/investor" className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-md bg-violet-600 text-white hover:bg-violet-700">
              Open profiling chatbot
            </Link>
          </div>
        </div>
      )}

      {!snap && (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-sm text-gray-500">
          No snapshot yet — the aggregator runs every 6 hours. Check back soon.
        </div>
      )}

      {snap && (
        <>
          <div className="grid md:grid-cols-3 gap-4">
            <SignalsKPI label="Investors contributing" value={snap.n_total ?? 'Insufficient data'} sub={`Last computed ${new Date(snap.computed_at).toLocaleString()}`} />
            <SignalsKPI label="Min cell size (k-anonymity)" value={snap.min_cell_size} sub="Cells below this threshold are hidden" />
            <SignalsKPI label="Median ticket" value={snap.ticket_stats?.median_min != null ? `${fmtUsd(snap.ticket_stats.median_min)} – ${fmtUsd(snap.ticket_stats.median_max)}` : 'Insufficient data'} sub={snap.ticket_stats?.iqr_min ? `IQR ${fmtUsd(snap.ticket_stats.iqr_min.p25)} – ${fmtUsd(snap.ticket_stats.iqr_min.p75)}` : ''} />
          </div>

          <SignalsBars title="Sectors of interest" cells={snap.sectors} />
          <SignalsBars title="Stages" cells={snap.stages} />
          <SignalsBars title="Geographies" cells={snap.geos} />
          <SignalsBars title="Ticket size distribution" cells={snap.ticket_bands} />

          <ThesisCloud keywords={snap.thesis_keywords || []} />

          {trend.length > 1 && <TrendStrip trend={trend} />}
        </>
      )}
    </div>
  );
}

function fmtUsd(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${n}`;
}

function SignalsKPI({ label, value, sub }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">{label}</div>
      <div className="text-2xl font-bold text-gray-900">{value ?? '—'}</div>
      {sub && <div className="text-[11px] text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

function SignalsBars({ title, cells }) {
  const visible = (cells || []).filter(c => c.n != null);
  const maxN = visible.reduce((m, c) => Math.max(m, c.n || 0), 1);
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="text-sm font-semibold text-gray-900 mb-3">{title}</div>
      {visible.length === 0 && (
        <div className="text-xs text-gray-500 italic">Insufficient data — no cell met the k=5 threshold yet.</div>
      )}
      <div className="space-y-2">
        {(cells || []).map(c => {
          const insufficient = c.n == null;
          const widthPct = insufficient ? 0 : Math.round(((c.n || 0) / maxN) * 100);
          return (
            <div key={c.label} className="flex items-center gap-3">
              <div className="w-32 text-xs text-gray-700 truncate" title={c.label}>{c.label}</div>
              <div className="flex-1 h-4 bg-gray-100 rounded overflow-hidden">
                {!insufficient && (
                  <div className="h-full bg-violet-500" style={{ width: `${widthPct}%` }} />
                )}
              </div>
              <div className="w-32 text-right text-xs text-gray-600">
                {insufficient ? <span className="italic text-gray-400">Insufficient data</span> : `${c.n} (${c.pct}%)`}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ThesisCloud({ keywords }) {
  if (!keywords || !keywords.length) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="text-sm font-semibold text-gray-900 mb-3">Thesis cloud</div>
        <div className="text-xs text-gray-500 italic">No keyword reached the k=5 threshold yet.</div>
      </div>
    );
  }
  const max = keywords[0].n;
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="text-sm font-semibold text-gray-900 mb-3">Thesis cloud</div>
      <div className="flex flex-wrap gap-2 items-baseline">
        {keywords.map(k => {
          const scale = 0.85 + 0.9 * (k.n / max);
          return (
            <span
              key={k.keyword}
              className="text-violet-700"
              style={{ fontSize: `${scale}rem` }}
              title={`${k.n} investors`}
            >
              {k.keyword}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function TrendStrip({ trend }) {
  const max = trend.reduce((m, t) => Math.max(m, t.n || 0), 1);
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="text-sm font-semibold text-gray-900 mb-3">30-day participation trend</div>
      <div className="flex items-end gap-1 h-20">
        {trend.map((t, i) => {
          const h = Math.max(2, Math.round(((t.n || 0) / max) * 100));
          return (
            <div
              key={i}
              className="flex-1 bg-violet-200 rounded-t"
              style={{ height: `${h}%` }}
              title={`${new Date(t.at).toLocaleDateString()}: ${t.n} contributors`}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-gray-500 mt-1">
        <span>{trend[0] && new Date(trend[0].at).toLocaleDateString()}</span>
        <span>{trend[trend.length - 1] && new Date(trend[trend.length - 1].at).toLocaleDateString()}</span>
      </div>
    </div>
  );
}

function BenchmarkCard({ label, value, target }) {
  const empty = value == null || value === '' || value === 'null' || (typeof value === 'string' && value.includes('null'));
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">{label}</div>
      <div className={empty ? 'text-base font-medium text-gray-400 italic' : 'text-2xl font-bold text-gray-900'}>
        {empty ? '— Calculating…' : value}
      </div>
      <div className="text-[10px] text-gray-600 mt-1">Target: {target}</div>
    </div>
  );
}

// Lightweight tooltip: small info icon with native title + accessible label.
// Avoids a popover library; hover/focus reveals the explanation.
function InfoTip({ text }) {
  return (
    <span
      title={text}
      aria-label={text}
      tabIndex={0}
      className="inline-flex items-center text-gray-400 hover:text-violet-600 focus:text-violet-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded-full cursor-help"
    >
      <Info size={12} />
    </span>
  );
}

// Per-tab "Why this matters" mini-panel shown above tab content.
function TabExplainer({ text }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-[11px] text-gray-600 flex items-start gap-2">
      <Info size={13} className="text-violet-500 shrink-0 mt-0.5" />
      <span>{text}</span>
    </div>
  );
}
