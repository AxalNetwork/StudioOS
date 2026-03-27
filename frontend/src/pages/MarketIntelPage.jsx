import React, { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, Minus, Globe, BarChart3, Zap, Building2 } from 'lucide-react';
import { api } from '../lib/api';

export default function MarketIntelPage() {
  const [pulse, setPulse] = useState([]);
  const [macro, setMacro] = useState(null);
  const [rounds, setRounds] = useState([]);
  const [benchmarks, setBenchmarks] = useState(null);
  const [conviction, setConviction] = useState([]);
  const [tab, setTab] = useState('pulse');

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
      <h1 className="text-2xl font-bold text-white mb-1">Market Intelligence</h1>
      <p className="text-sm text-gray-400 mb-6">Signal-to-Action pipeline for competitive advantage</p>

      <div className="flex gap-1 mb-6 overflow-x-auto pb-2">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
              tab === t.key ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
            }`}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'pulse' && (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {pulse.map((s, i) => (
            <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-white">{s.sector}</h3>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  s.sentiment === 'Aggressive' ? 'bg-emerald-100 text-emerald-700' :
                  s.sentiment === 'Cautious' ? 'bg-orange-500/20 text-orange-400' :
                  'bg-yellow-500/20 text-yellow-400'
                }`}>{s.sentiment}</span>
              </div>
              <div className="text-2xl font-bold text-violet-400 mb-3">{s.multiple}x</div>
              <div className="space-y-2 text-xs">
                <div>
                  <span className="text-gray-500">Tech Signal:</span>
                  <p className="text-gray-300 mt-0.5">{s.technographic_signal}</p>
                </div>
                <div>
                  <span className="text-gray-500">Hiring:</span>
                  <p className="text-gray-300 mt-0.5">{s.hiring_surge}</p>
                </div>
                <div className="pt-2 border-t border-gray-800">
                  <span className="text-violet-400 font-medium">Spin-out Opportunity:</span>
                  <p className="text-gray-200 mt-0.5">{s.gap_opportunity}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'macro' && macro && (
        <div>
          <div className="grid md:grid-cols-2 gap-4 mb-6">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-white mb-2">Exit Environment</h3>
              <p className="text-sm text-gray-300">{macro.exit_environment}</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-white mb-2">Interest Rate Impact</h3>
              <p className="text-sm text-gray-300">{macro.interest_rate_impact}</p>
            </div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left px-4 py-3 text-gray-400 font-medium">Sector</th>
                  <th className="text-right px-4 py-3 text-gray-400 font-medium">Avg P/E</th>
                  <th className="text-right px-4 py-3 text-gray-400 font-medium">YoY Growth</th>
                  <th className="text-center px-4 py-3 text-gray-400 font-medium">IPO Window</th>
                  <th className="text-center px-4 py-3 text-gray-400 font-medium">Trend</th>
                </tr>
              </thead>
              <tbody>
                {macro.sectors?.map((s, i) => (
                  <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="px-4 py-3 text-white font-medium">{s.name}</td>
                    <td className="px-4 py-3 text-right text-gray-300">{s.avg_pe}x</td>
                    <td className="px-4 py-3 text-right">
                      <span className={s.yoy_growth > 20 ? 'text-emerald-400' : s.yoy_growth > 10 ? 'text-blue-400' : 'text-gray-400'}>
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
                      {s.trend === 'up' ? <TrendingUp size={16} className="inline text-emerald-400" /> :
                       s.trend === 'down' ? <TrendingDown size={16} className="inline text-red-400" /> :
                       <Minus size={16} className="inline text-gray-400" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'private' && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Company</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Sector</th>
                <th className="text-right px-4 py-3 text-gray-400 font-medium">Amount</th>
                <th className="text-right px-4 py-3 text-gray-400 font-medium">Valuation</th>
                <th className="text-center px-4 py-3 text-gray-400 font-medium">Stage</th>
              </tr>
            </thead>
            <tbody>
              {rounds.map((r, i) => (
                <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="px-4 py-3 text-white font-medium">{r.company}</td>
                  <td className="px-4 py-3 text-gray-300">{r.sector}</td>
                  <td className="px-4 py-3 text-right text-emerald-400 font-medium">{r.amount}</td>
                  <td className="px-4 py-3 text-right text-gray-300">{r.valuation}</td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-xs px-2 py-0.5 bg-gray-800 text-gray-300 rounded-full">{r.stage}</span>
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
            <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-semibold text-white">{play.sector}</h3>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    play.play_type === 'Efficiency Play' ? 'bg-violet-500/20 text-violet-400' :
                    play.play_type === 'Replacement Play' ? 'bg-blue-100 text-blue-700' :
                    'bg-emerald-100 text-emerald-700'
                  }`}>{play.play_type}</span>
                </div>
                <span className="text-lg font-bold text-violet-400">{play.multiple}x</span>
              </div>
              <p className="text-sm text-gray-300 mb-2">{play.reasoning}</p>
              <div className="pt-2 border-t border-gray-800">
                <span className="text-xs text-gray-500">Recommended Spin-out: </span>
                <span className="text-xs text-emerald-400 font-medium">{play.gap_opportunity}</span>
              </div>
            </div>
          ))}
          {conviction.length === 0 && <p className="text-gray-500 text-sm">No high-conviction plays identified yet.</p>}
        </div>
      )}

      {tab === 'studio' && benchmarks && (
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
      )}
    </div>
  );
}

function BenchmarkCard({ label, value, target }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{label}</div>
      <div className="text-2xl font-bold text-white">{value}</div>
      <div className="text-[10px] text-gray-500 mt-1">Target: {target}</div>
    </div>
  );
}
