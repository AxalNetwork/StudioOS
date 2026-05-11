import React, { useEffect, useState } from 'react';
import PageExplainer from '../components/PageExplainer';
import { TrendingUp, TrendingDown, Minus, Globe, BarChart3, Zap, Building2, ChevronDown, Info, Lightbulb, Users, Database, ExternalLink, Compass, Target, MapPin, BookOpen, Bookmark, Lock, Trash2 } from 'lucide-react';
import { openPaywall } from '../components/PaywallModal';
import { Link } from 'react-router-dom';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from 'recharts';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuthSync';

export default function MarketIntelPage() {
  const { user } = useAuth();
  const [pulse, setPulse] = useState([]);
  const [headlines, setHeadlines] = useState([]);
  const [pulseUpdatedAt, setPulseUpdatedAt] = useState(null);
  const [macro, setMacro] = useState(null);
  const [rounds, setRounds] = useState([]);
  const [benchmarks, setBenchmarks] = useState(null);
  const [conviction, setConviction] = useState([]);
  const [enriched, setEnriched] = useState([]);
  const [tab, setTab] = useState('compass');
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
    api.listProjects().then((rows) => {
      const list = (Array.isArray(rows) ? rows : [])
        .filter((p) => p.crunchbase_uuid)
        .map((p) => {
          let snap = null;
          try { snap = p.crunchbase_data_json ? JSON.parse(p.crunchbase_data_json) : null; } catch {}
          return {
            id: p.id,
            name: p.name,
            sector: p.sector,
            image_url: snap?.image_url || null,
            cb_url: snap?.cb_url || (snap?.permalink ? `https://www.crunchbase.com/organization/${snap.permalink}` : null),
            total_funding: p.total_funding ?? snap?.funding_total_usd ?? null,
            last_round: p.last_funding_round || (snap?.last_funding_type ? `${snap.last_funding_type}${snap.last_funding_at ? ` (${snap.last_funding_at})` : ''}` : null),
            employee_count: p.employee_count || snap?.employee_range || null,
            hq: p.hq || snap?.hq_location || null,
          };
        });
      setEnriched(list);
    }).catch(() => {});
  }, []);

  const fmtTime = (iso) => {
    if (!iso) return '';
    try { return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch { return ''; }
  };

  const tabs = [
    // Task #15 (AA-2) — Aggregator-backed lenses come first; they're the
    // primary surface for the new Market Intelligence experience.
    { key: 'compass', label: 'Sector Compass', icon: Compass },
    { key: 'founder_lens', label: 'Founder Lens', icon: Target },
    { key: 'investor_lens', label: 'Investor Lens', icon: TrendingUp },
    { key: 'geography', label: 'Geography Lens', icon: MapPin },
    { key: 'citations', label: 'Citations & Methodology', icon: BookOpen },
    { key: 'watchlist', label: 'Custom Watchlist', icon: Bookmark },
    // Legacy tabs (still useful — public markets, studio ops benchmarks, etc.)
    { key: 'pulse', label: 'Market Pulse', icon: Zap },
    { key: 'macro', label: 'Public Markets', icon: Globe },
    { key: 'private', label: 'Private Rounds', icon: Building2 },
    { key: 'conviction', label: 'High Conviction', icon: TrendingUp },
    { key: 'studio', label: 'Studio Benchmarks', icon: BarChart3 },
    { key: 'investor_signals', label: 'Axal Investor Signals', icon: Users },
  ];

  return (
    <div data-testid="market-intel-page" data-active-tab={tab}>
      <div className="flex items-end justify-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Market Intelligence</h1>
        <PageExplainer pageKey="market_intel" />
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
            <button key={t.key} data-testid={`mi-tab-${t.key}`} onClick={() => setTab(t.key)}
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
          {enriched.length > 0 && (
            <CompetitorEnrichmentBlock projects={enriched} />
          )}
          {enriched.length > 0 && (
            <FocusProjectCompetitorsBlock projects={enriched} />
          )}
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
      {tab === 'compass' && <SectorCompassTab user={user} />}
      {tab === 'founder_lens' && <FounderLensTab user={user} />}
      {tab === 'investor_lens' && <InvestorLensTab user={user} />}
      {tab === 'geography' && <GeographyLensTab user={user} />}
      {tab === 'citations' && <CitationsTab user={user} />}
      {tab === 'watchlist' && <WatchlistTab user={user} />}

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
  // One-time reprompt: persist dismissal in localStorage so existing
  // investors who have not finished the chatbot are nudged once per device,
  // not on every visit. Cleared automatically once they complete the
  // profile (completed_at flips truthy).
  const REPROMPT_KEY = 'investor_signals_reprompt_dismissed_v1';
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(REPROMPT_KEY) === '1'; } catch { return false; }
  });
  const showReprompt = isInvestor && profile && !profile.completed_at && !dismissed;
  const dismissReprompt = () => {
    try { localStorage.setItem(REPROMPT_KEY, '1'); } catch {}
    setDismissed(true);
  };

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
            <div className="flex gap-2">
              <Link to="/onboarding/investor" className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-md bg-violet-600 text-white hover:bg-violet-700">
                Open profiling chatbot
              </Link>
              <button onClick={dismissReprompt} className="text-xs font-medium px-3 py-1.5 rounded-md text-gray-700 hover:bg-violet-100">
                Don&apos;t remind me
              </button>
            </div>
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

          <SectorStageTicketTable buckets={snap.ticket_stats_by_sector_stage || []} />

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

function SectorStageTicketTable({ buckets }) {
  const visible = (buckets || []).filter(b => b.n != null);
  if (!buckets.length) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="text-sm font-semibold text-gray-900 mb-3">Average ticket by sector × stage</div>
        <div className="text-xs text-gray-500 italic">No data yet.</div>
      </div>
    );
  }
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 overflow-x-auto">
      <div className="text-sm font-semibold text-gray-900 mb-3">Average ticket by sector × stage</div>
      {visible.length === 0 && (
        <div className="text-xs text-gray-500 italic mb-2">Insufficient data — no sector × stage cell met the k=5 threshold yet.</div>
      )}
      {visible.length > 0 && (
        <table className="min-w-full text-xs">
          <thead className="text-gray-500">
            <tr>
              <th className="text-left py-2 pr-3 font-medium">Sector</th>
              <th className="text-left py-2 pr-3 font-medium">Stage</th>
              <th className="text-right py-2 pr-3 font-medium">n</th>
              <th className="text-right py-2 pr-3 font-medium">Median ticket</th>
              <th className="text-right py-2 pr-3 font-medium">IQR (low)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-gray-700">
            {visible.map((b, i) => (
              <tr key={i}>
                <td className="py-2 pr-3">{b.sector}</td>
                <td className="py-2 pr-3">{b.stage}</td>
                <td className="py-2 pr-3 text-right">{b.n}</td>
                <td className="py-2 pr-3 text-right">{fmtUsd(b.median_min)} – {fmtUsd(b.median_max)}</td>
                <td className="py-2 pr-3 text-right text-gray-500">{fmtUsd(b.iqr_min?.p25)} – {fmtUsd(b.iqr_min?.p75)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
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

// Competitor enrichment driven entirely by cached snapshots already on
// each project row (`crunchbase_data_json` → parsed in the parent's
// listProjects handler). No live API call, so no rate-limit dependency.
function CompetitorEnrichmentBlock({ projects }) {
  const rows = projects.map((p) => ({
    id: p.id,
    name: (p.name || '').slice(0, 24),
    fundingM: p.total_funding != null ? Math.round((p.total_funding / 1e6) * 10) / 10 : 0,
    image_url: p.image_url,
    sector: p.sector,
    hq: p.hq,
    last_round: p.last_round,
    employee_count: p.employee_count,
  })).sort((a, b) => b.fundingM - a.fundingM);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
            <Database size={14} className="text-violet-600" /> Portfolio funding (Crunchbase)
          </h3>
          <p className="text-[11px] text-gray-500 mt-0.5">Cached snapshots from your enriched projects. Use Project → Crunchbase to refresh.</p>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-violet-600 font-semibold">{projects.length} enriched</span>
      </div>

      <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-2">Logo grid</div>
      <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-8 gap-3 mb-5">
        {projects.map((e) => (
          <Link
            key={e.id}
            to={`/projects/${e.id}`}
            title={`${e.name}${e.sector ? ` — ${e.sector}` : ''}`}
            className="group flex flex-col items-center gap-1 p-2 rounded-lg border border-gray-200 hover:border-violet-400 hover:bg-violet-50/30 transition-colors"
          >
            {e.image_url ? (
              <img src={e.image_url} alt="" className="w-10 h-10 rounded object-cover bg-gray-100" loading="lazy" />
            ) : (
              <div className="w-10 h-10 rounded bg-gradient-to-br from-violet-100 to-indigo-100 flex items-center justify-center text-[10px] font-semibold text-violet-700">
                {(e.name || '?').slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="text-[10px] text-gray-700 truncate w-full text-center group-hover:text-violet-700">{e.name}</div>
          </Link>
        ))}
      </div>

      {rows.some((r) => r.fundingM > 0) && (
        <>
          <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-2">Funding history (USD millions raised, total)</div>
          <div style={{ width: '100%', height: Math.max(180, rows.length * 28) }}>
            <ResponsiveContainer>
              <BarChart layout="vertical" data={rows} margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                <XAxis type="number" tick={{ fontSize: 10, fill: '#6b7280' }} tickFormatter={(v) => `$${v}M`} />
                <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 10, fill: '#374151' }} />
                <Tooltip formatter={(v) => [`$${v}M raised`, 'Total funding']} labelStyle={{ fontSize: 11 }} contentStyle={{ fontSize: 11 }} />
                <Bar dataKey="fundingM" radius={[0, 4, 4, 0]} fill="#7c3aed" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}

// Task #11 — Crunchbase peer-company lookup for the focus project, surfaced
// inside Market Intelligence so partners analyzing the private-rounds tab
// don't have to bounce out to a project detail page. Mirrors the
// CrunchbaseProfileCard "Find competitors" pattern from ProjectDetail
// (same api call + same 412/429 banner copy). Free-tier (and other
// non-elevated tiers) get the upgrade pill instead of the live block.
function FocusProjectCompetitorsBlock({ projects }) {
  const { user } = useAuth();
  const tier = (user?.tier || user?.subscription_plan || 'free').toLowerCase();
  const isElevated = ['admin', 'partner', 'investor', 'mentor'].includes((user?.role || '').toLowerCase());
  const tierLocked = !isElevated && tier !== 'growth' && tier !== 'studio';

  const [focusId, setFocusId] = useState(projects[0]?.id || null);
  const [comps, setComps] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const focus = projects.find((p) => p.id === focusId) || projects[0];

  useEffect(() => {
    if (tierLocked || !focus) return;
    let cancelled = false;
    setLoading(true);
    setErr('');
    setComps(null);
    api.crunchbaseCompetitors(focus.id, 10)
      .then((res) => { if (!cancelled) setComps(res?.competitors || []); })
      .catch((e) => {
        if (cancelled) return;
        const code = e?.data?.error || '';
        if (code === 'crunchbase_not_connected') setErr("Crunchbase isn't connected. Connect it from Settings → Integrations.");
        else if (code === 'crunchbase_unauthorized') setErr('Crunchbase rejected the stored API key — reconnect from Settings → Integrations.');
        else if (e?.status === 429) setErr('Crunchbase Basic daily limit reached (200 calls/day). Try again tomorrow.');
        else setErr(e?.message || 'Failed to load competitors');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [focus?.id, tierLocked]);

  const onUpgradeClick = () => {
    try {
      window.dispatchEvent(new CustomEvent('studioos:tier_required', {
        detail: { required: 'growth', message: 'Crunchbase enrichment is a growth-tier feature.' },
      }));
    } catch {}
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
            <Database size={14} className="text-violet-600" /> Focus project — possible competitors
          </h3>
          <p className="text-[11px] text-gray-500 mt-0.5">Live Crunchbase lookup for the selected enriched project.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[11px] text-gray-600">Focus</label>
          <select
            value={focus?.id || ''}
            onChange={(e) => setFocusId(Number(e.target.value))}
            className="text-xs bg-gray-50 border border-gray-300 rounded px-2 py-1 text-gray-900 focus:outline-none focus:border-violet-500"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      </div>

      {tierLocked ? (
        <button
          onClick={onUpgradeClick}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-amber-50 border border-amber-300 text-amber-800 hover:bg-amber-100"
        >
          <span className="text-xs">
            Crunchbase competitor lookup is a growth-tier feature. Upgrade to surface peer companies for {focus?.name || 'your projects'}.
          </span>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-200 text-amber-900">UPGRADE</span>
        </button>
      ) : (
        <>
          {loading && <div className="text-xs text-gray-500">Loading competitors for {focus?.name}…</div>}
          {!loading && err && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">{err}</div>
          )}
          {!loading && !err && comps && comps.length === 0 && (
            <div className="text-xs text-gray-500">No competitor matches found in Crunchbase Basic.</div>
          )}
          {!loading && !err && comps && comps.length > 0 && (
            <ul className="space-y-1.5">
              {comps.map((c) => (
                <li key={c.uuid} className="flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 truncate">{c.name}</div>
                    {c.short_description && <div className="text-gray-600 truncate">{c.short_description}</div>}
                  </div>
                  {c.cb_url && (
                    <a href={c.cb_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-violet-600 hover:underline inline-flex items-center gap-1 whitespace-nowrap">
                      open <ExternalLink size={10} />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

// ─── Task #15 (AA-2) — Aggregator-backed Market Intelligence lenses ──────────
//
// All six tabs below read from the AA-1 worker endpoints. Tier gating is
// enforced server-side; on 402 the shared api.js helper auto-fires the
// `studioos:tier_required` event so PaywallModal opens without per-tab
// wiring. Each tab also surfaces an inline upsell card when the API
// returns a tier-required payload, so users see what they're missing
// without the modal flickering.
// -----------------------------------------------------------------------------

const SECTOR_OPTIONS = [
  'Agentic B2B', 'Bio-Automation', 'AI Infrastructure', 'Fintech / DeFi',
  'Climate / Energy', 'Healthcare', 'DevTools', 'Consumer AI', 'Robotics',
  'Cybersecurity',
];

function tierForUser(user) {
  if (!user) return 'free';
  if (user.role === 'investor') return String(user.investor_tier || 'free').toLowerCase();
  return String(user.subscription_tier || 'free').toLowerCase();
}
function isFullLensCaller(user) {
  if (!user) return false;
  if (['admin', 'partner', 'mentor'].includes(user.role)) return true;
  const t = tierForUser(user);
  if (user.role === 'investor') return t === 'professional' || t === 'institutional';
  return t === 'growth' || t === 'studio';
}

function normalizeTier(t) {
  if (t === 'investor_professional') return 'professional';
  if (t === 'investor_institutional') return 'institutional';
  return t || 'growth';
}

function MIError({ err, fallbackTier = 'growth' }) {
  if (!err) return null;
  if (err.status === 402) {
    const required = normalizeTier(err.data?.required || fallbackTier);
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
        <Lock size={16} className="text-amber-700 shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-amber-900">Upgrade to unlock this lens</div>
          <p className="text-xs text-amber-800 mt-1">
            {err.message || `This view requires the ${required} tier.`}
          </p>
          <button
            type="button"
            onClick={() => openPaywall(required, err.message || '')}
            className="mt-2 text-xs font-medium px-3 py-1.5 rounded-md bg-amber-700 text-white hover:bg-amber-800"
          >
            See plans
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md px-3 py-2">
      {err.message || 'Request failed'}
    </div>
  );
}

function LockPill({ required }) {
  return (
    <button
      type="button"
      onClick={() => openPaywall(required)}
      className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-violet-600 text-white hover:bg-violet-700"
    >
      <Lock size={10} /> {required}
    </button>
  );
}

function MiniBar({ value }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const tone = v >= 70 ? 'bg-emerald-500' : v >= 50 ? 'bg-violet-500' : v >= 30 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="h-1.5 bg-gray-100 rounded overflow-hidden">
      <div className={`${tone} h-full`} style={{ width: `${v}%` }} />
    </div>
  );
}

// Build a plain-English "why this sector" string from the per-dimension
// scores. Picks the top two dimensions (>=60) as drivers and the lowest
// (<=40) as drag. Falls back to a neutral string when the full lens isn't
// available (free callers).
function compassReasoning(s) {
  if (!s.dimensions) return 'Composite-only view — upgrade for the dimensional drivers.';
  const dims = Object.entries(s.dimensions).map(([k, v]) => ({ k, v: v.value, n: v.source_count }));
  const top = [...dims].sort((a, b) => b.v - a.v).slice(0, 2);
  const bottom = [...dims].sort((a, b) => a.v - b.v)[0];
  const drivers = top.filter((d) => d.v >= 55).map((d) => `${d.k} (${Math.round(d.v)})`);
  const drag = bottom && bottom.v <= 45 ? ` Drag from ${bottom.k} (${Math.round(bottom.v)}).` : '';
  if (drivers.length === 0) return `Mixed signals across all six dimensions.${drag}`;
  return `Driven by ${drivers.join(' and ')}.${drag}`;
}
function totalSourceCount(s) {
  if (!s.dimensions) return null;
  return Object.values(s.dimensions).reduce((a, v) => a + (v.source_count || 0), 0);
}
function ConfidenceChip({ n }) {
  if (n == null) return null;
  const label = n >= 12 ? 'High' : n >= 6 ? 'Medium' : n >= 2 ? 'Low' : 'Sparse';
  const tone = n >= 12 ? 'bg-emerald-100 text-emerald-700' : n >= 6 ? 'bg-violet-100 text-violet-700' : n >= 2 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600';
  return <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${tone}`} title={`${n} source rows in window`}>Confidence: {label}</span>;
}

function SectorCompassTab({ user }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api.miSectorCompass()
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setErr(e); });
    return () => { cancelled = true; };
  }, []);
  const full = isFullLensCaller(user);
  const sortedPicks = data?.sectors ? [...data.sectors].sort((a, b) => b.composite - a.composite).slice(0, 5) : [];
  return (
    <div className="space-y-4">
      <TabExplainer text="The Sector Compass ranks every tracked sector on a 0–100 composite — demand, supply, capital, talent, research, and sentiment, decayed by recency. Free callers see the headline composite; Growth+ unlocks the dimensional breakdown plus the 'why this sector is moving' reasoning." />
      {err && <MIError err={err} fallbackTier="growth" />}
      {!err && !data && <div className="text-sm text-gray-500">Loading sector compass…</div>}
      {data && (
        <>
          <div className="text-[11px] text-gray-500">
            Period {data.period_key} · computed {new Date(data.computed_at).toLocaleString()} · {data.lens === 'full' ? 'full lens' : 'free composite'}
          </div>
          {sortedPicks.length > 0 && (
            <div className="bg-gradient-to-r from-violet-50 to-indigo-50 border border-violet-200 rounded-xl p-4">
              <div className="text-[10px] uppercase tracking-widest text-violet-700 font-semibold mb-2">Top Sector Picks This Period</div>
              <ol className="space-y-1.5">
                {sortedPicks.map((p, i) => (
                  <li key={p.sector} className="flex items-start gap-3 text-xs">
                    <span className="text-violet-700 font-bold w-4">{i + 1}.</span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900">{p.sector}</span>
                        <span className="text-violet-600 font-bold">{Math.round(p.composite)}</span>
                      </div>
                      <div className="text-gray-700">{compassReasoning(p)}</div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(data.sectors || []).map((s) => (
              <div key={s.sector} className="bg-white border border-gray-200 rounded-xl p-5">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-gray-900">{s.sector}</h3>
                  <span className="text-2xl font-bold text-violet-600">{Math.round(s.composite)}</span>
                </div>
                <MiniBar value={s.composite} />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <ConfidenceChip n={totalSourceCount(s)} />
                </div>
                {s.dimensions ? (
                  <>
                    <p className="mt-3 text-xs text-gray-700 italic">{compassReasoning(s)}</p>
                    <ul className="mt-3 space-y-1.5 text-xs">
                      {Object.entries(s.dimensions).map(([k, v]) => (
                        <li key={k} className="flex items-center justify-between gap-2">
                          <span className="text-gray-600 capitalize w-20">{k}</span>
                          <div className="flex-1"><MiniBar value={v.value} /></div>
                          <span className="text-gray-700 font-medium w-8 text-right">{Math.round(v.value)}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <div className="mt-3 flex items-center justify-between text-xs text-gray-600">
                    <span>Per-dimension breakdown + reasoning</span>
                    {!full && <LockPill required="growth" />}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Per-sector citations drill-in. Used by Founder + Investor lenses to
// expose the underlying signal rows (jobs velocity, hiring, patents,
// research output, capital deployments) for a clicked sector. Lazy-loads
// on expansion to keep the parent table light.
function SectorCitationsDrill({ sector, dimensionFilter }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api.miCitations(sector, 25)
      .then((d) => {
        if (cancelled) return;
        const all = d.rows || [];
        setRows(dimensionFilter ? all.filter((r) => dimensionFilter.test(r.metric_key || '')) : all);
      })
      .catch((e) => { if (!cancelled) setErr(e); });
    return () => { cancelled = true; };
  }, [sector, dimensionFilter]);
  if (err) return <div className="text-xs text-red-600 px-3 py-2">{err.message || 'Failed to load citations'}</div>;
  if (!rows) return <div className="text-xs text-gray-500 px-3 py-2">Loading drill-in…</div>;
  if (rows.length === 0) return <div className="text-xs text-gray-500 italic px-3 py-2">No citation rows in the last 30 days.</div>;
  return (
    <ul className="divide-y divide-gray-100 bg-gray-50/50">
      {rows.slice(0, 10).map((r, i) => (
        <li key={i} className="px-4 py-1.5 text-[11px] flex items-center gap-3">
          <span className="font-mono text-gray-500 w-32 truncate">{r.source_key}</span>
          <span className="text-gray-700 flex-1 truncate">{r.metric_key}</span>
          <span className="text-gray-700 font-medium w-12 text-right">{Number(r.metric_value).toFixed(1)}</span>
          <span className="text-gray-400 w-24 text-right">{new Date(r.ts).toLocaleDateString()}</span>
          {r.citation_url && (
            <a href={r.citation_url} target="_blank" rel="noopener noreferrer" className="text-violet-600 hover:underline inline-flex items-center gap-1">
              <ExternalLink size={10} />
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

function founderReason(p) {
  if (p.opportunity_gap > 10) return `Strong demand-supply gap (+${p.opportunity_gap.toFixed(0)}) — early movers can land before incumbents respond.`;
  if (p.opportunity_gap > 0) return `Modest gap (+${p.opportunity_gap.toFixed(0)}) — viable for a focused team with a sharp wedge.`;
  if (p.opportunity_gap < -10) return `Crowded supply (${p.opportunity_gap.toFixed(0)}) — only enter with a 10× differentiator.`;
  return `Balanced market — execution beats positioning here.`;
}

function FounderLensTab({ user: _user }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [openSector, setOpenSector] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api.miFounderLens()
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setErr(e); });
    return () => { cancelled = true; };
  }, []);
  const top = data?.picks ? data.picks.slice(0, 5) : [];
  return (
    <div className="space-y-4">
      <TabExplainer text="Founder Lens highlights the biggest opportunity gaps — sectors where market demand is racing ahead of supply. Click any row to drill into the recent funding actors, hiring velocity, patent filings and research output rows that drive the score." />
      {err && <MIError err={err} fallbackTier="growth" />}
      {!err && !data && <div className="text-sm text-gray-500">Loading founder lens…</div>}
      {data && top.length > 0 && (
        <div className="bg-gradient-to-r from-emerald-50 to-violet-50 border border-emerald-200 rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-widest text-emerald-700 font-semibold mb-2">Top 5 Spin-Out Targets</div>
          <ol className="space-y-1.5">
            {top.map((p, i) => (
              <li key={p.sector} className="flex items-start gap-3 text-xs">
                <span className="text-emerald-700 font-bold w-4">{i + 1}.</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900">{p.sector}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${p.opportunity_gap > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-700'}`}>gap {p.opportunity_gap > 0 ? '+' : ''}{p.opportunity_gap.toFixed(1)}</span>
                  </div>
                  <div className="text-gray-700">{founderReason(p)}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
      {data && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-2 text-gray-600 font-medium">Sector</th>
                <th className="text-right px-4 py-2 text-gray-600 font-medium">Composite</th>
                <th className="text-right px-4 py-2 text-gray-600 font-medium">Demand</th>
                <th className="text-right px-4 py-2 text-gray-600 font-medium">Supply</th>
                <th className="text-right px-4 py-2 text-gray-600 font-medium">Opportunity Gap</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {(data.picks || []).map((p) => (
                <React.Fragment key={p.sector}>
                  <tr className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => setOpenSector(openSector === p.sector ? null : p.sector)}>
                    <td className="px-4 py-2 text-gray-900 font-medium">{p.sector}</td>
                    <td className="px-4 py-2 text-right text-gray-700">{Math.round(p.composite)}</td>
                    <td className="px-4 py-2 text-right text-gray-700">{Math.round(p.demand)}</td>
                    <td className="px-4 py-2 text-right text-gray-700">{Math.round(p.supply)}</td>
                    <td className={`px-4 py-2 text-right font-semibold ${p.opportunity_gap > 5 ? 'text-emerald-600' : p.opportunity_gap < -5 ? 'text-red-600' : 'text-gray-700'}`}>
                      {p.opportunity_gap > 0 ? '+' : ''}{p.opportunity_gap.toFixed(1)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <ChevronDown size={14} className={`inline text-gray-400 transition-transform ${openSector === p.sector ? 'rotate-180' : ''}`} />
                    </td>
                  </tr>
                  {openSector === p.sector && (
                    <tr><td colSpan={6} className="p-0">
                      <SectorCitationsDrill sector={p.sector} dimensionFilter={/jobs|hiring|patent|research|search|demand|supply/i} />
                    </td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function InvestorLensTab({ user }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [openSector, setOpenSector] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api.miInvestorLens()
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setErr(e); });
    return () => { cancelled = true; };
  }, []);
  const top = data?.ranked ? data.ranked.slice(0, 5) : [];
  // Institutional investors get a "print quarterly report" affordance.
  // Real PDF generation is server-side (out of scope here); this uses the
  // browser's native print dialog so users can save-as-PDF on demand.
  const investorTier = String(user?.investor_tier || 'free').toLowerCase();
  const isInstitutional = user?.role === 'investor' && investorTier === 'institutional';
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <TabExplainer text="Investor Lens ranks sectors by capital deployment + sentiment. Numbers come from the SEC EDGAR + Crunchbase pipelines (and any other LIVE-flagged providers). Click a row to see the citation rows behind capital scores. Reserved for Investor Pro+ subscribers." />
        <div className="flex items-center gap-2">
          {isInstitutional ? (
            <button
              type="button"
              onClick={() => window.print()}
              className="text-xs font-medium px-3 py-1.5 rounded-md border border-violet-300 text-violet-700 hover:bg-violet-50 inline-flex items-center gap-1"
              title="Open the browser print dialog — choose 'Save as PDF' to capture this quarter's lens."
            >
              <BookOpen size={12} /> Quarterly PDF
            </button>
          ) : user?.role === 'investor' && (
            <button
              type="button"
              onClick={() => openPaywall('institutional', 'Quarterly PDF reports are an Institutional benefit.')}
              className="text-xs font-medium px-3 py-1.5 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 inline-flex items-center gap-1"
            >
              <Lock size={12} /> Quarterly PDF (Institutional)
            </button>
          )}
        </div>
      </div>
      {err && <MIError err={err} fallbackTier="professional" />}
      {!err && !data && <div className="text-sm text-gray-500">Loading investor lens…</div>}
      {data && top.length > 0 && (
        <div className="bg-gradient-to-r from-blue-50 to-violet-50 border border-blue-200 rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-widest text-blue-700 font-semibold mb-2">Top 5 Capital-Allocator Targets</div>
          <ol className="space-y-1.5">
            {top.map((s, i) => (
              <li key={s.sector} className="flex items-start gap-3 text-xs">
                <span className="text-blue-700 font-bold w-4">{i + 1}.</span>
                <div className="flex-1">
                  <span className="font-semibold text-gray-900">{s.sector}</span>{' '}
                  <span className="text-blue-600 font-bold">{s.score.toFixed(1)}</span>
                  <div className="text-gray-700">Capital {Math.round(s.capital)} · Sentiment {Math.round(s.sentiment)} · Composite {Math.round(s.composite)}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
      {data && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-2 text-gray-600 font-medium">Sector</th>
                <th className="text-right px-4 py-2 text-gray-600 font-medium">Capital</th>
                <th className="text-right px-4 py-2 text-gray-600 font-medium">Sentiment</th>
                <th className="text-right px-4 py-2 text-gray-600 font-medium">Composite</th>
                <th className="text-right px-4 py-2 text-gray-600 font-medium">Score</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {(data.ranked || []).map((s) => (
                <React.Fragment key={s.sector}>
                  <tr className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => setOpenSector(openSector === s.sector ? null : s.sector)}>
                    <td className="px-4 py-2 text-gray-900 font-medium">{s.sector}</td>
                    <td className="px-4 py-2 text-right text-gray-700">{Math.round(s.capital)}</td>
                    <td className="px-4 py-2 text-right text-gray-700">{Math.round(s.sentiment)}</td>
                    <td className="px-4 py-2 text-right text-gray-700">{Math.round(s.composite)}</td>
                    <td className="px-4 py-2 text-right font-semibold text-violet-600">{s.score.toFixed(1)}</td>
                    <td className="px-4 py-2 text-right">
                      <ChevronDown size={14} className={`inline text-gray-400 transition-transform ${openSector === s.sector ? 'rotate-180' : ''}`} />
                    </td>
                  </tr>
                  {openSector === s.sector && (
                    <tr><td colSpan={6} className="p-0">
                      <SectorCitationsDrill sector={s.sector} dimensionFilter={/funding|capital|deal|round|investor|sentiment/i} />
                    </td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Heat-cell color ramp for the geography lens. Mirrors the MiniBar
// thresholds so a sector at 70+ reads as "hot" everywhere on the page.
function heatColor(v) {
  const x = Math.max(0, Math.min(100, v));
  if (x >= 75) return 'bg-red-500 text-white';
  if (x >= 60) return 'bg-orange-400 text-white';
  if (x >= 45) return 'bg-amber-300 text-gray-900';
  if (x >= 30) return 'bg-emerald-200 text-gray-900';
  return 'bg-blue-200 text-gray-900';
}

const GEO_REGIONS = [
  { key: 'na', label: 'North America' },
  { key: 'eu', label: 'Europe' },
  { key: 'apac', label: 'Asia / Pacific' },
  { key: 'latam', label: 'Latin America' },
  { key: 'mena', label: 'Middle East / Africa' },
];

function GeographyLensTab({ user: _user }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api.miGeography()
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setErr(e); });
    return () => { cancelled = true; };
  }, []);
  // Build a sector × region heat grid. The aggregator emits a single
  // 'global' band today, so per-region cells fall back to the global
  // composite with a "fallback" badge so users see WHY every region looks
  // identical instead of assuming the data is wrong.
  const globalBand = data?.geos?.find((g) => g.geo === 'global');
  const sectors = globalBand ? globalBand.sectors : [];
  return (
    <div className="space-y-4">
      <TabExplainer text="Geography Lens projects the composite onto regions as a sector × region heat grid. Today the aggregator emits a single 'global' band, so each region inherits the global composite — per-country rollups land as additional connectors come online." />
      {err && <MIError err={err} fallbackTier="professional" />}
      {!err && !data && <div className="text-sm text-gray-500">Loading geography lens…</div>}
      {data && sectors.length > 0 && (
        <>
          <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-1.5">
            Per-region rollups not yet emitted — every region currently mirrors the 'global' composite. Cells flagged <span className="px-1 py-0.5 rounded bg-amber-200 text-amber-900 font-medium text-[9px]">global fallback</span>.
          </div>
          <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-3 py-2 text-gray-600 font-medium">Sector</th>
                  {GEO_REGIONS.map((r) => (
                    <th key={r.key} className="text-center px-3 py-2 text-gray-600 font-medium whitespace-nowrap">{r.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sectors.map((s) => (
                  <tr key={s.sector} className="border-b border-gray-100">
                    <td className="px-3 py-2 text-gray-900 font-medium whitespace-nowrap">{s.sector}</td>
                    {GEO_REGIONS.map((r) => (
                      <td key={r.key} className="px-2 py-1.5 text-center">
                        <div className={`inline-block px-2 py-1 rounded font-bold text-sm ${heatColor(s.composite)}`} title={`Global fallback: ${Math.round(s.composite)}`}>
                          {Math.round(s.composite)}
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-gray-500">
            <span>Cooler</span>
            <span className="inline-block w-4 h-3 rounded bg-blue-200" />
            <span className="inline-block w-4 h-3 rounded bg-emerald-200" />
            <span className="inline-block w-4 h-3 rounded bg-amber-300" />
            <span className="inline-block w-4 h-3 rounded bg-orange-400" />
            <span className="inline-block w-4 h-3 rounded bg-red-500" />
            <span>Hotter</span>
          </div>
        </>
      )}
    </div>
  );
}

function CitationsTab({ user: _user }) {
  const [sector, setSector] = useState('');
  const [data, setData] = useState(null);
  const [sources, setSources] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api.miSources().then((d) => { if (!cancelled) setSources(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setData(null);
    setErr(null);
    api.miCitations(sector || null, 100)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setErr(e); });
    return () => { cancelled = true; };
  }, [sector]);
  return (
    <div className="space-y-4">
      <TabExplainer text="Every datapoint in the lenses traces back to a source row here. The source catalog tells you which providers are LIVE today (paid contracts wired) vs running on deterministic stubs." />
      {sources && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-xs font-semibold text-gray-900 mb-2">{sources.count} registered sources</div>
          <div className="flex flex-wrap gap-1.5">
            {sources.sources.map((s) => (
              <span key={s.key} className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${s.live ? 'bg-emerald-100 text-emerald-700' : s.paid ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-700'}`}>
                {s.display_name} {s.live ? '· LIVE' : s.paid ? '· paid (stubbed)' : '· stub'}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-600">Filter sector:</label>
        <select
          value={sector}
          onChange={(e) => setSector(e.target.value)}
          className="text-xs px-2 py-1 border border-gray-300 rounded-md bg-white"
        >
          <option value="">All sectors</option>
          {SECTOR_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {err && <MIError err={err} fallbackTier="growth" />}
      {!err && !data && <div className="text-sm text-gray-500">Loading citations…</div>}
      {data && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-3 py-2 text-gray-600 font-medium">Source</th>
                <th className="text-left px-3 py-2 text-gray-600 font-medium">Sector</th>
                <th className="text-left px-3 py-2 text-gray-600 font-medium">Metric</th>
                <th className="text-right px-3 py-2 text-gray-600 font-medium">Value</th>
                <th className="text-left px-3 py-2 text-gray-600 font-medium">Ingested</th>
                <th className="text-left px-3 py-2 text-gray-600 font-medium">Citation</th>
              </tr>
            </thead>
            <tbody>
              {(data.rows || []).map((r, i) => (
                <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-1.5 text-gray-700 font-mono">{r.source_key}</td>
                  <td className="px-3 py-1.5 text-gray-700">{r.sector}</td>
                  <td className="px-3 py-1.5 text-gray-700">{r.metric_key}</td>
                  <td className="px-3 py-1.5 text-right text-gray-700">{Number(r.metric_value).toFixed(2)}</td>
                  <td className="px-3 py-1.5 text-gray-500">{new Date(r.ts).toLocaleString()}</td>
                  <td className="px-3 py-1.5">
                    {r.citation_url ? (
                      <a href={r.citation_url} target="_blank" rel="noopener noreferrer" className="text-violet-600 hover:underline inline-flex items-center gap-1">
                        open <ExternalLink size={10} />
                      </a>
                    ) : <span className="text-gray-400">—</span>}
                  </td>
                </tr>
              ))}
              {data.rows && data.rows.length === 0 && (
                <tr><td colSpan="6" className="px-3 py-4 text-center text-gray-500">No rows in window — the aggregator runs hourly/daily/weekly per source.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function WatchlistTab({ user: _user }) {
  const [rows, setRows] = useState(null);
  const [pause, setPause] = useState({ paused_until: null, indefinite: false });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sector, setSector] = useState(SECTOR_OPTIONS[0]);
  const [cadence, setCadence] = useState('weekly');
  const [pausePreset, setPausePreset] = useState('1w');

  const reload = () => {
    setErr(null);
    api.miWatchlistList()
      .then((d) => {
        setRows(d.rows || []);
        setPause(d.digest_pause || { paused_until: null, indefinite: false });
      })
      .catch((e) => setErr(e));
  };
  useEffect(() => { reload(); }, []);

  const applyPause = async () => {
    setBusy(true);
    try {
      let until;
      if (pausePreset === 'indefinite') until = 'indefinite';
      else if (pausePreset === '1w') until = new Date(Date.now() + 7 * 86400000).toISOString();
      else if (pausePreset === '1m') until = new Date(Date.now() + 28 * 86400000).toISOString();
      else until = new Date(Date.now() + 7 * 86400000).toISOString();
      await api.miWatchlistPause(until);
      reload();
    } catch (e) { setErr(e); }
    finally { setBusy(false); }
  };
  const resumePause = async () => {
    setBusy(true);
    try { await api.miWatchlistPause(null); reload(); }
    catch (e) { setErr(e); }
    finally { setBusy(false); }
  };

  const add = async () => {
    setBusy(true);
    try {
      await api.miWatchlistAdd(sector, 'global', cadence);
      reload();
    } catch (e) { setErr(e); }
    finally { setBusy(false); }
  };
  const remove = async (id) => {
    setBusy(true);
    try { await api.miWatchlistRemove(id); reload(); }
    catch (e) { setErr(e); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <TabExplainer text="Pin sectors you want a weekly digest on. The cron-driven digest pipeline (the same one your other notifications use) will email you a recap of every composite move + new citations in your window." />
      {err && <MIError err={err} fallbackTier="growth" />}
      {/* Task #32 — pause sector digests without unpinning. */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        {pause.paused_until ? (
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-sm">
              <span className="font-medium text-amber-700">Sector digests are paused</span>
              <span className="text-gray-600">
                {' '}— {pause.indefinite
                  ? 'indefinitely'
                  : `until ${new Date(pause.paused_until).toLocaleDateString()}`}.
                Your pinned sectors are still saved.
              </span>
            </div>
            <button
              type="button"
              onClick={resumePause}
              disabled={busy}
              className="ml-auto px-3 py-1.5 rounded-md bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50"
            >
              Resume now
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">Pause digests</label>
              <select
                value={pausePreset}
                onChange={(e) => setPausePreset(e.target.value)}
                className="text-sm px-2 py-1.5 border border-gray-300 rounded-md bg-white"
              >
                <option value="1w">For 1 week</option>
                <option value="1m">For 1 month</option>
                <option value="indefinite">Indefinitely</option>
              </select>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={applyPause}
              className="px-3 py-1.5 rounded-md border border-gray-300 bg-white text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
            >
              Pause digests
            </button>
            <span className="text-xs text-gray-500">Stops the email digest while keeping every sector you've pinned.</span>
          </div>
        )}
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">Sector</label>
          <select value={sector} onChange={(e) => setSector(e.target.value)} className="text-sm px-2 py-1.5 border border-gray-300 rounded-md bg-white">
            {SECTOR_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">Cadence</label>
          <select value={cadence} onChange={(e) => setCadence(e.target.value)} className="text-sm px-2 py-1.5 border border-gray-300 rounded-md bg-white">
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={add}
          className="px-3 py-1.5 rounded-md bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50"
        >
          Add to watchlist
        </button>
      </div>
      {rows && rows.length === 0 && (
        <div className="text-sm text-gray-500 italic">No saved sectors yet — add one above to start receiving digests.</div>
      )}
      {rows && rows.length > 0 && (
        <ul className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="text-sm font-medium text-gray-900">{r.sector}</div>
                <div className="text-[11px] text-gray-500">{r.geo} · {r.cadence} · added {new Date(r.created_at).toLocaleDateString()}</div>
              </div>
              <button
                type="button"
                onClick={() => remove(r.id)}
                disabled={busy}
                className="text-xs text-red-600 hover:text-red-700 inline-flex items-center gap-1 disabled:opacity-50"
              >
                <Trash2 size={12} /> Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
