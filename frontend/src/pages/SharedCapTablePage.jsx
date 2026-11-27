// Build queue #120 — public cap-table share viewer.
//
// Anonymous, token-addressed, no auth. Everything rendered here was
// already redacted server-side for the link's audience
// (cloudflare-worker/src/services/captableShare.ts), so this component
// never receives data it must remember to hide — which is the point:
// client-side hiding still ships the private rows to the browser.
//
// Three failure states are distinguished on purpose:
//   410 → the link was real and has expired or been used up
//   403 → the link was never valid (or was tampered with)
//   404 → the cap table itself is gone
// A viewer can act on the first; a flat "forbidden" would read like a
// problem they could fix by logging in, which it is not.
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { PieChart, Lock, AlertTriangle, Clock } from 'lucide-react';
import { api } from '../lib/api';

const pct = (v) => (v == null ? '—' : `${Number(v).toFixed(2)}%`);
const money = (v) => (v == null ? '—' : `$${Number(v).toLocaleString()}`);
const shares = (v) => (v == null ? '—' : Number(v).toLocaleString());

const GROUP_COLOR = {
  Founders: 'bg-violet-500',
  Investors: 'bg-emerald-500',
  'Option pool': 'bg-amber-400',
  Other: 'bg-gray-400',
};

export default function SharedCapTablePage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [status, setStatus] = useState(0);

  useEffect(() => {
    let alive = true;
    api.capTableShared(token)
      .then((d) => { if (alive) setData(d); })
      .catch((e) => {
        if (!alive) return;
        setStatus(e?.status || 0);
        setErr(e?.message || 'This link could not be opened.');
      });
    return () => { alive = false; };
  }, [token]);

  if (err) {
    const expired = status === 410;
    const gone = status === 404;
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-8 text-center">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4 ${
            expired ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-gray-100 dark:bg-gray-800'
          }`}>
            {expired ? <Clock size={22} className="text-amber-600" />
              : gone ? <AlertTriangle size={22} className="text-gray-500" />
              : <Lock size={22} className="text-gray-500" />}
          </div>
          <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">
            {expired ? 'This link has expired' : gone ? 'No longer available' : 'Link not valid'}
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">{err}</p>
          {expired && (
            <p className="text-xs text-gray-500 mt-3">
              Share links are time-limited and view-limited by design. Ask whoever sent it for a fresh one.
            </p>
          )}
        </div>
      </div>
    );
  }

  if (!data) return <div className="min-h-screen flex items-center justify-center text-gray-500 text-sm">Loading…</div>;

  const isSummary = data.audience === 'summary';

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10 px-4">
      <div className="max-w-4xl mx-auto">
        <header className="mb-6">
          <div className="flex items-center gap-2.5">
            <PieChart size={22} className="text-violet-600" />
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{data.scenario_name}</h1>
          </div>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 font-semibold uppercase tracking-wide">
              {data.audience} view
            </span>
            <span className="text-xs text-gray-500">
              {data.rounds_completed} round{data.rounds_completed === 1 ? '' : 's'} completed
            </span>
          </div>
        </header>

        {/* The disclosure is shown to the VIEWER, not just the sender, so
            nobody mistakes a partial view for the whole cap table. */}
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 text-xs text-gray-600 dark:text-gray-400 mb-5 flex items-start gap-2">
          <Lock size={13} className="mt-0.5 flex-shrink-0 text-gray-400" />
          <span>{data.disclosure}</span>
        </div>

        {isSummary && (
          <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">Ownership</h2>
            <div className="h-4 rounded-full overflow-hidden flex bg-gray-100 dark:bg-gray-800 mb-4">
              {(data.summary || []).map((s) => (
                <div key={s.group} className={GROUP_COLOR[s.group] || GROUP_COLOR.Other}
                  style={{ width: `${s.pct}%` }} title={`${s.group} ${pct(s.pct)}`} />
              ))}
            </div>
            <ul className="space-y-2">
              {(data.summary || []).map((s) => (
                <li key={s.group} className="flex items-center justify-between text-sm">
                  <span className="inline-flex items-center gap-2 text-gray-700 dark:text-gray-300">
                    <span className={`w-3 h-3 rounded-sm ${GROUP_COLOR[s.group] || GROUP_COLOR.Other}`} />
                    {s.group}
                  </span>
                  <span className="tabular-nums font-medium text-gray-900 dark:text-gray-100">{pct(s.pct)}</span>
                </li>
              ))}
            </ul>
            {(data.summary || []).length === 0 && (
              <p className="text-sm text-gray-500">No ownership recorded yet.</p>
            )}
          </div>
        )}

        {!isSummary && (
          <div className="space-y-5">
            {(data.rounds || []).map((r, i) => (
              <section key={`${r.name}-${i}`} className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
                <div className="px-5 py-3 bg-gray-50 dark:bg-gray-900/60 border-b border-gray-100 dark:border-gray-800 flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100">{r.name}</h2>
                  <div className="flex gap-4 text-xs text-gray-600 dark:text-gray-400 flex-wrap">
                    <span>Pre-money <strong className="tabular-nums">{money(r.pre_money)}</strong></span>
                    <span>Raised <strong className="tabular-nums">{money(r.investment)}</strong></span>
                    <span>PPS <strong className="tabular-nums">${Number(r.price_per_share || 0).toFixed(4)}</strong></span>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[440px]">
                    <thead className="text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-100 dark:border-gray-800">
                      <tr>
                        <th className="text-left px-5 py-2">Stakeholder</th>
                        <th className="text-left px-3 py-2">Type</th>
                        <th className="text-right px-3 py-2">Shares</th>
                        <th className="text-right px-5 py-2">Ownership</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-gray-800/60">
                      {(r.ledger || []).map((h, j) => (
                        <tr key={`${h.holder}-${j}`}>
                          <td className="px-5 py-2 text-gray-900 dark:text-gray-100">{h.holder}</td>
                          <td className="px-3 py-2 text-gray-500 capitalize">{String(h.type || '').replace('_', ' ')}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">{shares(h.shares)}</td>
                          <td className="px-5 py-2 text-right tabular-nums font-medium text-gray-900 dark:text-gray-100">{pct(h.pct)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
            {(data.rounds || []).length === 0 && (
              <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-8 text-center text-sm text-gray-500">
                No priced rounds recorded yet.
              </div>
            )}
          </div>
        )}

        <footer className="mt-8 text-center text-[11px] text-gray-400">
          Shared via Axal · This is a cap-table model, not a 409A valuation or an offer of securities.
        </footer>
      </div>
    </div>
  );
}
