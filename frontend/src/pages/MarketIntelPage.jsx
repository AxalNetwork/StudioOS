import React, { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, Minus, Globe, BarChart3, Zap, Building2, ChevronDown } from 'lucide-react';
import { api } from '../lib/api';

export default function MarketIntelPage() {
  const [pulse, setPulse] = useState([]);
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
      setMacro(m);
      setRounds(r.rounds || []);
      setBenchmarks(b);
      setConviction(c.high_conviction_plays || []);
    }).catch(() => {});
  }, []);

  const tabs = [
    { key: 'pulse', label: 'Market Pulse', icon: Zap },
    { key: 'macro', label: 'Public Markets', icon: Globe },
    { key: 'private', label: 'Private Rounds', icon: Building2 },
    { key: 'conviction', label: 'High Conviction', icon: TrendingUp },
    { key: 'studio', label: 'Studio Benchmarks', icon: BarChart3 },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Market Intelligence</h1>
      <p className="text-sm text-gray-600 mb-6">Signal-to-Action pipeline for competitive advantage</p>

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
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {pulse.map((s, i) => (
            <div key={i} className="bg-white border border-gray-200 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-900">{s.sector}</h3>
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
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'macro' && macro && (
        <div>
          <div className="grid md:grid-cols-2 gap-4 mb-6">
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Exit Environment</h3>
              <p className="text-sm text-gray-700">{macro.exit_environment}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Interest Rate Impact</h3>
              <p className="text-sm text-gray-700">{macro.interest_rate_impact}</p>
            </div>
          </div>
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
      )}

      {tab === 'conviction' && (
        <div className="space-y-4">
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

      {tab === 'studio' && benchmarks && (
        <div className="space-y-6">
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
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold mb-3">Decision Gate</div>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
              <BenchmarkCard label="Decision Gate Pass Rate" value={`${benchmarks.decision_gate_pass_rate}%`} target="> 65%" />
              <BenchmarkCard label="Avg Time to Spin-Out" value={`${benchmarks.avg_time_to_spinout_days} days`} target="< 90 days" />
              <BenchmarkCard label="Avg Founder Equity at Spin-Out" value={`${benchmarks.avg_founder_equity_at_spinout}%`} target="60-75%" />
              <BenchmarkCard label="Cost Per Spin-Out" value={benchmarks.cost_per_spinout} target="< $250k" />
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold mb-3">Post Spin-Out Performance</div>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
              <BenchmarkCard label="Follow-On Funding Rate" value={`${benchmarks.followon_funding_rate}%`} target="> 70%" />
              <BenchmarkCard label="Avg Valuation at First Round" value={benchmarks.avg_valuation_first_round} target="> $8M" />
              <BenchmarkCard label="Deployment Velocity" value={`${benchmarks.deployment_velocity}%`} target="> 40% / quarter" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BenchmarkCard({ label, value, target }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">{label}</div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      <div className="text-[10px] text-gray-600 mt-1">Target: {target}</div>
    </div>
  );
}
